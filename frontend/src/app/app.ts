import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { catchError, finalize, forkJoin, of, switchMap } from 'rxjs';
import { ApiService, ResidentYearSummary, WeatherData, type HouseholdDetails, type ResidentDetails, type FloodReportDetails, type ReportReview } from './api.service';
import { LiveMapComponent } from './live-map.component';
import { PolygonEditorComponent } from './polygon-editor.component';
import { LocationPickerComponent } from './location-picker.component';
import { DssComponent } from './dss.component';
import { dashboardCount, editorFieldSections, shortRecordId, findTasks, recordedResidentOutcome } from './admin-ui';
import type { ResponseView } from './rescue.models';
import type { DssData } from './dss.models';
import {draftKey,draftValues,readDraft,writeDraft,removeDraft,type FormDraft} from './form-draft';

type PageId = 'dashboard' | 'map' | 'reports' | 'residents' | 'households' | 'evacuation' | 'statistics' | 'dss' | 'notifications' | 'users';
type PublicPage = 'home' | 'map' | 'report' | 'login';
type NavigationTask = { page: PageId; label: string; description: string; keywords?: string; resource?: string; responseView?: ResponseView };
type EditorOption = { value: string; label: string };
type EditorField = {
  name: string;
  label: string;
  type?: 'text' | 'tel' | 'email' | 'password' | 'number' | 'date' | 'color' | 'textarea' | 'select' | 'multiselect' | 'polygon' | 'location' | 'household-lookup';
  required?: boolean;
  placeholder?: string;
  options?: EditorOption[];
};

const options = (...values: string[]): EditorOption[] => values.map((value) => ({ value, label: value }));

function validPhilippineContactNumber(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  if (text.length > 30 || !/^\+?[0-9() -]+$/.test(text)) return false;
  const digits = text.replace(/[() -]/g, '');
  const local = digits.startsWith('+63') ? `0${digits.slice(3)}` : digits;
  return /^09\d{9}$/.test(local) || /^0[2-8]\d{7,9}$/.test(local) || /^[1-9]\d{6,7}$/.test(local);
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, DatePipe, LiveMapComponent, PolygonEditorComponent, LocationPickerComponent, DssComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  menuOpen = false;
  taskQuery = '';
  centerMapOpen = false;
  centerRecordsOpen = false;
  @ViewChild(DssComponent) private dssWorkspace?: DssComponent;
  get navigationTasks() {
    const tasks: NavigationTask[] = [
      {page:'dss',label:'Plan evacuation & rescue',description:'Select residents and send a rescue team.',keywords:'dispatch evacuation priority mission',responseView:'residents'},
      {page:'dss',label:'Update rescue missions',description:'Track progress and confirm arrival.',keywords:'rescue escort pickup transport',responseView:'missions'},
      {page:'dss',label:'Set up rescue teams',description:'Assign volunteers and barangay tanods to crews.',keywords:'leader vehicle foot responder',responseView:'teams'},
      {page:'dss',label:'Missing & deceased residents',description:'Record outcomes and follow up missing residents.',keywords:'casualty casualties located death',responseView:'outcomes'},
      {page:'evacuation',label:'Volunteers & tanods',description:'Maintain responder contacts and availability.',keywords:'rescue crew staff',resource:'volunteers'},
      {page:'notifications',label:'Emergency hotlines',description:'Maintain public emergency contact numbers.',keywords:'phone contact help',resource:'emergency-contacts'},
      ...this.navItems.map(item=>({page:item.id,label:item.label,description:this.pageDetails[item.id].description}))
    ];
    return findTasks(tasks,this.visibleNavItems.map(item=>item.id),this.taskQuery);
  }
  openTask(task:NavigationTask) {
    this.setPage(task.page);
    if(task.resource)this.selectResource(task.resource);
    if(task.responseView){this.changeDetector.detectChanges();this.dssWorkspace?.selectTab('planner');this.dssWorkspace?.setResponseView(task.responseView);}
  }
  get currentSection(){return this.navGroups.find(group=>group.items.some(item=>item.id===this.activePage))?.label ?? '';}
  theme = document.documentElement.dataset['theme'] ?? 'system';
  residentImportOpen = false;
  residentImportCsv = '';
  residentImportName = '';
  residentImportCount = 0;
  residentImportBusy = false;
  residentImportError = '';

  openResidentImport() {
    this.residentImportOpen = true;
    this.residentImportError = ''; this.residentImportCount = 0;
    this.residentImportCsv = ''; this.residentImportName = '';
    this.changeDetector.detectChanges();
    document.querySelector<HTMLButtonElement>('.resident-import-modal .modal-close')?.focus();
  }

  closeResidentImport() {
    if (this.residentImportBusy) return;
    this.residentImportOpen = false;
    document.getElementById('resident-import-trigger')?.focus();
  }

  residentImportKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); this.closeResidentImport(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(document.querySelectorAll<HTMLElement>('.resident-import-modal button:not(:disabled), .resident-import-modal input:not(:disabled)'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  setTheme(value: string) {
    if (!['system', 'dark', 'light'].includes(value)) return;
    this.theme = value;
    document.documentElement.dataset['theme'] = value;
    try { localStorage.setItem('bantay-baha-theme', value); } catch { /* Preference still applies for this visit. */ }
  }

  downloadResidentTemplate() {
    const csv = 'household_number,full_name,date_of_birth,sex,address_line,priority_level,contact_number,vulnerability_type,emergency_contact_name,emergency_contact_number\r\n';
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'resident-import-template.csv'; link.click();
    URL.revokeObjectURL(url);
  }

  async selectResidentImport(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.residentImportCsv = ''; this.residentImportCount = 0; this.residentImportError = '';
    this.residentImportName = file?.name ?? '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 500_000) {
      this.residentImportError = 'Choose a CSV file no larger than 500 KB.';
      return;
    }
    this.residentImportBusy = true;
    try {
      this.residentImportCsv = await file.text();
      this.submitResidentImport(true);
    } catch {
      this.residentImportBusy = false;
      this.residentImportError = 'The file could not be read.';
      this.changeDetector.detectChanges();
    }
  }

  submitResidentImport(preview = false) {
    if (!this.residentImportCsv || (!preview && (!this.residentImportCount || this.residentImportBusy))) return;
    this.residentImportBusy = true;
    this.residentImportError = '';
    this.api.create<{ count: number; message: string }>('residents/import', { csv: this.residentImportCsv, preview }).pipe(finalize(() => {
      this.residentImportBusy = false;
      this.changeDetector.detectChanges();
    })).subscribe({
      next: result => {
        if (preview) this.residentImportCount = result.count;
        else {
          this.residentImportOpen = false;
          this.residentImportCsv = ''; this.residentImportCount = 0;
          this.successMessage = result.message;
          this.page = 1;
          this.loadResource();
        }
      },
      error: error => { this.residentImportCount = 0; this.residentImportError = error?.error?.message ?? 'Import failed. No residents were imported.'; }
    });
  }
  publicPage: PublicPage = 'home';
  activePage: PageId = 'dashboard';
  selectedReport: unknown;
  adminReportPhotoUrls: string[] = [];
  loading = false;
  loginLoading = false;
  sessionResolving = true;
  showPassword = false;
  recoveryOpen = false;
  resetToken = '';
  errorMessage = '';
  resourceLoadError = '';
  successMessage = '';
  publicToastMessage = '';
  editorOpen = false;
  editorStep = 0;
  editorStepsExpanded = false;
  editorReview: { title: string; fields: { label: string; value: string }[] }[] = [];
  editorDirty = false;
  editorDraft?:FormDraft;
  editorDraftPending=false;
  editorDraftSaved=false;
  editorDraftError='';
  editorDetailsLoading=false;
  publicDraft=readDraft(draftKey('public','flood-report'));
  publicDraftPending=!!this.publicDraft;
  publicDraftValues:Record<string,string|string[]>={};
  publicDraftSaved=false;
  publicDraftError='';
  get editorDraftKey(){return draftKey(this.api.user()?.userId??'anonymous',this.currentResource,this.editorId||'new');}
  get hasNewRecordDraft(){return !!readDraft(draftKey(this.api.user()?.userId??'anonymous',this.currentResource));}
  saveEditorDraft(){
    if(this.editorDraftPending||this.editorDetailsLoading)return;
    this.editorDirty=true;
    const form=document.querySelector<HTMLFormElement>('#record-editor form');if(!form)return;
    const values=draftValues(new FormData(form).entries(),this.editorFields.filter(f=>f.type==='password').map(f=>f.name));
    for(const field of this.editorFields.filter(f=>f.type==='multiselect')) values[field.name]=new FormData(form).getAll(field.name).map(String);
    const draft:FormDraft={values,step:this.editorStep,updatedAt:Date.now(),expectedStatus:this.editorReportStatus,hasPhotos:[...new FormData(form).values()].some(v=>v instanceof File&&v.size>0)};
    this.editorDraftSaved=writeDraft(this.editorDraftKey,draft);
    this.editorDraftError=this.editorDraftSaved?'':'Browser draft could not be saved. Keep this form open until you save the record.';
    this.editorDraft=draft;
  }
  resumeEditorDraft(){
    const draft=this.editorDraft;if(!draft||this.editorDetailsLoading)return;
    if(this.activePage==='reports'&&this.editorId&&draft.expectedStatus!==this.editorReportStatus){this.editorDraftError='This report changed since the draft was saved. Discard the draft and review its current details.';return;}
    const allowed=new Set([...this.editorFields.filter(f=>f.type!=='password').map(f=>f.name),'latitude','longitude','locationText','vulnerabilityOther','relationshipOther']);
    for(const [name,value] of Object.entries(draft.values))if(allowed.has(name))this.editorValues[name]=value;
    if(this.currentResource==='residents')this.updateResidentAge(String(this.editorValues['dateOfBirth']??''));
    this.editorStep=Math.min(draft.step,this.editorSections.length-1);this.editorDraftPending=false;this.editorDraftSaved=true;this.editorDirty=true;this.changeDetector.detectChanges();
  }
  discardBrowserDraft(){removeDraft(this.editorDraftKey);this.editorDraft=undefined;this.editorDraftPending=false;this.editorDraftSaved=false;this.editorDraftError='';}
  keepDraftAndClose(){this.saveEditorDraft();if(this.editorDraftSaved)this.closeEditor(false);}
  savePublicDraft(form:HTMLFormElement){
    if(this.publicDraftPending)return;
    const draft:FormDraft={values:draftValues(new FormData(form).entries()),step:0,updatedAt:Date.now(),hasPhotos:[...new FormData(form).values()].some(v=>v instanceof File&&v.size>0)};
    this.publicDraftSaved=writeDraft(draftKey('public','flood-report'),draft);
    this.publicDraftError=this.publicDraftSaved?'':'Browser draft unavailable. Keep this form open until the report is submitted.';
    this.publicDraft=draft;
  }
  resumePublicDraft(){this.publicDraftValues={...this.publicDraft?.values};this.publicDraftPending=false;this.publicDraftSaved=true;}
  clearPublicDraft(form:HTMLFormElement,picker:LocationPickerComponent){form.reset();picker.clear();removeDraft(draftKey('public','flood-report'));this.publicDraft=undefined;this.publicDraftValues={};this.publicDraftPending=false;this.publicDraftSaved=false;this.publicDraftError='';}
  reloadPublicDraft(){this.publicDraft=readDraft(draftKey('public','flood-report'));this.publicDraftPending=!!this.publicDraft;this.publicDraftValues={};this.publicDraftSaved=false;this.publicDraftError='';}
  discardEditorPrompt = false;
  private editorTrigger: HTMLElement | null = null;
  readonly shortRecordId = shortRecordId;

  get editorSections() {
    return editorFieldSections(this.currentResource, this.editorFields);
  }

  get editorIsWizard() { return this.editorSections.length > 1; }
  get editorStepCount() { return this.editorSections.length + 1; }
  get editorStepTitle() { return this.editorSections[this.editorStep]?.title ?? 'Review and save'; }

  changeEditorStep(step: number) {
    if (this.loading || this.discardEditorPrompt) return;
    const form = document.querySelector<HTMLFormElement>('#record-editor form');
    if (step > this.editorStep && form) {
      if (step === this.editorSections.length) {
        for (let index = 0; index < this.editorSections.length; index++) if (!this.validateEditorStep(form, index)) return;
        const values = new FormData(form);
        this.editorReview = this.editorSections.map(section => ({ title: section.title, fields: section.fields.map(field => {
          const raw = String(values.get(field.name) ?? '');
          let value = field.type === 'household-lookup' ? this.selectedHouseholdLabel : field.type === 'location' ? 'Pinned on map' : field.options?.find(option => option.value === raw)?.label ?? raw;
          if(this.editorOutcome&&field.name==='evacuationStatus')value=this.editorOutcome+' (recorded outcome)';
          if (raw === 'Other') value += `: ${values.get(field.name === 'vulnerabilityType' ? 'vulnerabilityOther' : 'relationshipOther') || 'Not specified'}`;
          return { label: field.label, value: value || 'Not provided' };
        }) }));
      } else if (!this.validateEditorStep(form, this.editorStep)) return;
    }
    this.editorStep = step;
    if(this.editorDirty)this.saveEditorDraft();
    this.editorStepsExpanded = false;
    this.changeDetector.detectChanges();
    const section = document.querySelector<HTMLElement>('#record-editor .editor-section:not([hidden]), #record-editor .editor-review:not([hidden])');
    section?.focus();
    section?.scrollIntoView({ block: 'nearest' });
  }

  private validateEditorStep(form: HTMLFormElement, step: number): boolean {
    const section = form.querySelectorAll<HTMLFieldSetElement>('.editor-section')[step];
    const invalid = Array.from(section?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea') ?? []).find(control => !control.checkValidity());
    const fields = this.editorSections[step]?.fields ?? [];
    const values = new FormData(form);
    let message = '';
    for (const field of fields.filter(field => ['contactNumber', 'emergencyContactNumber'].includes(field.name))) {
      if (!validPhilippineContactNumber(values.get(field.name))) {
        this.fieldErrors[field.name] = 'Enter a valid Philippine mobile or landline number.';
        this.editorStep = step;
        this.changeDetector.detectChanges();
        this.focusEditorField(form, field.name);
        return false;
      }
      delete this.fieldErrors[field.name];
    }
    if (fields.some(field => field.type === 'household-lookup') && !this.editorValue('householdId')) message = 'Select a household for this resident.';
    if (fields.some(field => field.type === 'location') && (!values.get('latitude') || !values.get('longitude'))) message = 'Pin the location on the map before continuing.';
    if (invalid || message) {
      this.editorStep = step;
      this.errorMessage = message;
      this.changeDetector.detectChanges();
      if (invalid) { invalid.reportValidity(); invalid.focus(); }
      else { (section?.querySelector<HTMLElement>('.lookup-trigger') ?? section)?.focus(); }
      return false;
    }
    this.errorMessage = '';
    return true;
  }

  get navGroups() {
    return [
      { label: 'Start here', ids: ['dashboard'] },
      { label: 'Flood response', ids: ['reports', 'map', 'dss', 'evacuation', 'notifications'] },
      { label: 'Community records', ids: ['residents', 'households'] },
      { label: 'Reporting & administration', ids: ['statistics', 'users'] }
    ].map(group => ({ label: group.label, items: group.ids.map(id=>this.visibleNavItems.find(item=>item.id===id)).filter((item): item is typeof this.navItems[number]=>!!item) })).filter(group => group.items.length);
  }

  dashboardAttention?: { pending: number | '—'; residents: number | '—'; shelters: number | '—' };
  zoneAssessment?: DssData;
  selectedZoneId = '';
  zoneAssessmentLoading = false;
  zoneAssessmentError = '';
  get selectedZone() { return this.zoneAssessment?.zones.find(zone => zone.id === this.selectedZoneId); }
  get selectedZoneShelters() { return this.zoneAssessment?.shelters.filter(shelter => shelter.zoneId === this.selectedZoneId) ?? []; }

  loadZoneAssessment() {
    this.zoneAssessmentLoading = true;
    this.zoneAssessmentError = '';
    this.api.decisionSupport({}).pipe(finalize(() => { this.zoneAssessmentLoading = false; this.changeDetector.detectChanges(); })).subscribe({
      next: data => this.zoneAssessment = data,
      error: () => this.zoneAssessmentError = 'Zone assessment could not be loaded. Retry to see current response details.'
    });
  }

  selectMapZone(id: string) {
    this.selectedZoneId = id;
    this.selectedMapFocus = undefined;
    const record = this.publicMapData['zones']?.find((zone: Record<string, unknown>) => zone['zone_id'] === id);
    if (record) this.selectedMapFocus = { id, resource: 'barangay-zones', record, nonce: Date.now() };
    this.changeDetector.detectChanges();
  }

  openResponseResidents(zone = '', status = 'For Evacuation') {
    this.setPage(this.canOpenDashboardMetric('residents') ? 'residents' : 'evacuation');
    if (this.activePage === 'evacuation') this.selectResource('residents');
    this.resourceFilters = { zone, status };
    this.loadResource();
  }

  openPendingReports() {
    if (!this.canReviewReports) return;
    this.setPage('reports');
    this.resourceFilters = { pending: 'true' };
    this.loadResource();
  }

  get editorRecordLabel() {
    const names: Record<string, string> = { residents: 'resident', households: 'household', users: 'user account', shelters: 'evacuation center', volunteers: 'volunteer', notifications: 'advisory', 'emergency-contacts': 'emergency hotline', 'barangay-zones': 'barangay zone', 'risk-zones': 'risk zone', 'evacuation-routes': 'evacuation route', 'flood-reports': 'flood report' };
    return names[this.currentResource] ?? 'record';
  }

  get activeFilterChips() {
    const labels: Record<string, string> = { incomplete:'Incomplete basics',emergencyContact:'Incomplete emergency contact',unassigned:'Evacuation center missing',missingZone:'Validated report without zones',pending: 'Awaiting review', zone: 'Zone', household: 'Household', vulnerability: 'Vulnerability', vulnerable: 'Vulnerable residents', status: 'Status', priority: 'Priority', severity: 'Severity', incidentType: 'Incident', dateFrom: 'From', dateTo: 'To', shelter: 'Evacuation center' };
    return Object.entries(this.resourceFilters).filter(([, value]) => value).map(([key, value]) => ({ key, label: labels[key] ?? key, value: key === 'zone' ? this.zoneOptions.find(option => option.value === value)?.label ?? shortRecordId(value) : key === 'household' ? this.householdOptions.find(option => option.value === value)?.label ?? shortRecordId(value) : key === 'pending' ? 'Submitted / Under Review' : value === 'true' ? 'Yes' : shortRecordId(value) }));
  }

  removeFilter(key: string) {
    if (key === 'search') this.searchTerm = '';
    else delete this.resourceFilters[key];
    this.page = 1;
    this.loadResource();
  }

  resetSearchAndFilters() {
    this.searchTerm = '';
    this.clearResourceFilters();
  }

  requestCloseEditor() {
    if (this.loading) return;
    if (!this.editorDirty) return this.closeEditor(false);
    this.discardEditorPrompt = true;
    this.changeDetector.detectChanges();
    document.getElementById('keep-editing')?.focus();
  }

  keepEditing() {
    this.discardEditorPrompt = false;
    this.changeDetector.detectChanges();
    document.querySelector<HTMLButtonElement>('#record-editor .modal-close')?.focus();
  }

  @HostListener('window:beforeunload', ['$event'])
  protectUnsavedEditor(event: BeforeUnloadEvent) {
    if (this.editorOpen && this.editorDirty) {
      this.saveEditorDraft();
      if(!this.editorDraftSaved||this.editorDraft?.hasPhotos){event.preventDefault();event.returnValue='';}
    }
  }

  editorKeydown(event: KeyboardEvent) {
    if (this.householdLookupOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); this.discardEditorPrompt ? this.keepEditing() : this.requestCloseEditor(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(document.querySelectorAll<HTMLElement>('#record-editor button:not(:disabled), #record-editor input:not([type=hidden]):not(:disabled), #record-editor select:not(:disabled), #record-editor textarea:not(:disabled), #record-editor a[href]')).filter(control => !control.closest('[inert]') && control.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  editorId = '';
  reportReviewOptions: EditorOption[] = [];
  reportReviews: ReportReview[] = [];
  reportReviewReady = false;
  editorReportStatus = '';
  householdDetails?: HouseholdDetails;
  residentDetails?:ResidentDetails;
  residentDetailsLoading=false;
  residentDetailsError='';
  private residentDetailsRequest=0;
  quality?:Record<string,number>;
  qualityError='';
  readonly qualityCards=[{key:'incomplete',title:'Incomplete resident basics',hint:'Name, birth date, sex, address, or household missing'}, {key:'emergencyContact',title:'Emergency contacts incomplete',hint:'Contact name or number missing'}, {key:'unassigned',title:'Evacuation center not assigned',hint:'Residents marked For Evacuation or Evacuated'}, {key:'pending',title:'Reports awaiting review',hint:'Submitted and under review'}, {key:'missingZone',title:'Validated reports without zones',hint:'Affected zones need to be linked'}];
  get householdReadiness(){const members=this.householdDetails?.members??[];return {contacts:members.filter(m=>m.flags.includes('Emergency contact incomplete')).length,unassigned:members.filter(m=>m.flags.includes('Evacuation center not assigned')).length,assistance:members.filter(m=>m.needsAssistance).length};}
  loadRecordQuality(){
    this.quality=undefined;this.qualityError='';
    this.api.get<Record<string,number>>('records','quality').subscribe({next:quality=>{this.quality=quality;this.changeDetector.detectChanges();},error:()=>{this.qualityError='Record quality checks could not be loaded. Refresh to retry.';this.changeDetector.detectChanges();}});
  }
  openQualityRecords(key:string){
    if(['pending','missingZone'].includes(key)){if(!this.canReviewReports)return;this.setPage('reports');}
    else {this.setPage(this.canOpenDashboardMetric('residents')?'residents':'evacuation');if(this.activePage==='evacuation')this.selectResource('residents');this.selectedResidentYear=this.currentResidentYear;}
    this.resourceFilters={[key]:'true'};this.loadResource();
  }
  openResidentDetails(row:{id:string},dialog:HTMLDialogElement){
    const request=++this.residentDetailsRequest;this.residentDetails=undefined;this.residentDetailsError='';this.residentDetailsLoading=true;dialog.showModal();
    this.api.get<ResidentDetails>('residents',row.id+'/details').subscribe({next:details=>{if(request!==this.residentDetailsRequest)return;this.residentDetails=details;this.residentDetailsLoading=false;this.changeDetector.detectChanges();},error:()=>{if(request!==this.residentDetailsRequest)return;this.residentDetailsError='Resident profile could not be loaded. Close and retry.';this.residentDetailsLoading=false;this.changeDetector.detectChanges();}});
  }
  editProfile(dialog:HTMLDialogElement){const id=this.residentDetails?.resident['resident_id'];if(!id)return;dialog.close();this.setPage('residents');this.api.get<Record<string,unknown>>('residents',id).subscribe({next:r=>{this.rawRecords.set(id,r);this.openEditor({id});},error:()=>{this.errorMessage='Resident could not be loaded for editing.';this.changeDetector.detectChanges();}});}
  householdDetailsLoading = false;
  householdDetailsError = '';
  private householdDetailsRequest = 0;
  editorValues: Record<string, unknown> = {};
  editorOutcome = '';
  fieldErrors: Record<string, string> = {};
  temporaryPassword = '';
  selectedMapFocus?: { id: string; resource: string; record: Record<string, unknown>; nonce: number };
  mapRefreshNonce = 0;
  householdOptions: EditorOption[] = [];
  householdLookupOpen = false;
  householdLookupQuery = '';
  zoneOptions: EditorOption[] = [];
  shelterOptions: EditorOption[] = [];
  private rawRecords = new Map<string, Record<string, unknown>>();
  private resourceRequestId = 0;
  private requestedAdminPage?: PageId;
  private readonly popStateHandler = () => this.restoreRoute();
  page = 1;
  totalPages = 1;
  totalItems = 0;
  searchTerm = '';
  sortBy = '';
  sortOrder: 'asc' | 'desc' = 'desc';
  resourceFilters: Record<string, string> = {};
  readonly currentResidentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date()));
  selectedResidentYear = this.currentResidentYear;
  residentYears = [this.currentResidentYear];
  residentYearSummary: ResidentYearSummary = {
    totalResidents: 0, totalHouseholds: 0, vulnerableResidents: 0, highPriorityResidents: 0,
    seniorCitizens: 0, children: 0, personsWithDisability: 0, pregnantResidents: 0, residentsWithMorbidity: 0
  };
  currentResource = '';
  overallRisk = 'Low';
  activeValidatedReports: number | '—' = 0;
  affectedZones: number | '—' = 0;
  priorityResidents: number | '—' = 0;
  pendingReportCount = 0;
  dashboardAlert?: Record<string, unknown>;
  dashboardNotifications: Record<string, unknown>[] = [];
  headerNotificationsOpen = false;
  headerNotificationsLoading = false;
  headerNotificationsError = '';
  publicNotifications: Record<string, unknown>[] = [];
  publicContacts: Record<string, unknown>[] = [];
  publicReports: Record<string, unknown>[] = [];
  publicMapData: Record<string, any> = { zones: [], shelters: [], riskZones: [] };
  weather?: WeatherData;
  existingBarangayZones: Array<Record<string, unknown>> = [];
  publicMapLayers = { barangayZones: true, shelters: true, riskZones: true, incidents: true, routes: false, rivers: true, floodHazards: true };
  publicMapLabelsVisible = false;
  adminMapLayers = { barangayZones: true, shelters: false, riskZones: false, incidents: false, routes: false, rivers: true, floodHazards: true };
  adminMapLabelsVisible = false;
  readonly evacuationMapLayers = { barangayZones: true, shelters: true, riskZones: false, incidents: false, routes: true, rivers: true, floodHazards: true };
  publicMapSections = { barangayZones: true, shelters: false, riskZones: false, incidents: false, announcements: false };
  readonly incidentTypes = ['River Flooding', 'Flash Flood', 'Road Flooding', 'Drainage Overflow', 'Rising Water', 'Other'];
  readonly incidentLevels = ['Information', 'Minor Incident', 'Major Incident'];
  selectedPublicMapFocus?: { id: string; resource: string; record: Record<string, unknown>; nonce: number };
  selectedPublicIncident?: Record<string, unknown>;
  dssInitialTab: 'overview'|'zones'|'reports'|'evacuation'|'methodology' = 'reports';
  viewingAdminIncident = false;
  today = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
  readonly liveNow = signal(new Date());
  private clockTimer?: number;
  private dashboardRefreshTimer?: number;
  private publicToastTimer?: number;
  private successMessageTimer?: number;

  navItems: { id: PageId; label: string; icon: string; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
    { id: 'dss', label: 'Decision Support (DSS)', icon: '◇' },
    { id: 'map', label: 'Live Map & GIS', icon: '⌖' },
    { id: 'reports', label: 'Flood Reports', icon: '!' },
    { id: 'residents', label: 'Residents', icon: '♙' },
    { id: 'households', label: 'Households', icon: '⌑' },
    { id: 'evacuation', label: 'Centers & Responders', icon: '⌂' },
    { id: 'statistics', label: 'Reports & Statistics', icon: '▥' },
    { id: 'notifications', label: 'Advisories & Hotlines', icon: '♢' },
    { id: 'users', label: 'User Accounts', icon: '⚙' }
  ];

  pageDetails: Record<PageId, { eyebrow: string; title: string; description: string; action: string }> = {
    dashboard: { eyebrow: 'START HERE', title: 'Dashboard', description: 'See what needs attention and open your next task.', action: '' },
    map: { eyebrow: 'GEOSPATIAL OPERATIONS', title: 'Live Map & GIS', description: 'Review barangay boundaries, risk zones, incidents, routes, and evacuation shelters.', action: 'Add map record' },
    reports: { eyebrow: 'INCIDENT MANAGEMENT', title: 'Flood Reports', description: 'Validate community reports and coordinate a timely response.', action: 'New report' },
    residents: { eyebrow: 'COMMUNITY RECORDS', title: 'Residents', description: 'Manage resident information, vulnerability, and evacuation priority.', action: 'Add resident' },
    households: { eyebrow: 'COMMUNITY RECORDS', title: 'Households', description: 'Organize residents by household, zone, and current risk.', action: 'Add household' },
    evacuation: { eyebrow: 'FLOOD RESPONSE', title: 'Centers & Responders', description: 'Manage evacuation centers, resident rosters, and responder availability. Dispatch rescue teams in DSS.', action: 'Add shelter' },
    statistics: { eyebrow: 'REPORTING', title: 'Reports & Statistics', description: 'Review incident statistics and flood susceptibility references.', action: 'Export summary' },
    dss: { eyebrow: 'DECISION SUPPORT', title: 'Decision Support System', description: 'Assess zone priorities, assistance needs, and shelter readiness.', action: 'Situation report' },
    notifications: { eyebrow: 'FLOOD RESPONSE', title: 'Advisories & Hotlines', description: 'Publish official flood advisories and maintain emergency phone numbers.', action: 'New advisory' },
    users: { eyebrow: 'SYSTEM ADMINISTRATION', title: 'User Accounts', description: 'Manage authorized local authority access and roles.', action: 'Add user' }
  };

  metrics = [
    { label: 'TOTAL RESIDENTS', value: '—', note: 'Loading current data…', icon: '♙', color: '#0066dc', tint: '#e9f3ff', page: 'residents' as PageId },
    { label: 'HOUSEHOLDS', value: '—', note: 'Loading current data…', icon: '⌑', color: '#7147c9', tint: '#f1ebff', page: 'households' as PageId },
    { label: 'VULNERABLE RESIDENTS', value: '—', note: 'Loading current data…', icon: '♡', color: '#cf7a00', tint: '#fff3dc', warn: true, page: 'residents' as PageId, filters: { vulnerable: 'true' } },
    { label: 'ACTIVE FLOOD REPORTS', value: '—', note: 'Loading current data…', icon: '!', color: '#d64545', tint: '#ffebeb', warn: true, page: 'reports' as PageId }
  ];

  reports = [
    { code: 'BB-2026-A81D20F3', location: 'Riverside Zone · Purok 1', description: 'Road flooding near the spillway', status: 'Validated', statusClass: 'validated', level: 'major', icon: '!', time: '18 min ago' },
    { code: 'BB-2026-3B21E930', location: 'Centro · National Road', description: 'Rising drainage water reported', status: 'Under review', statusClass: 'review', level: 'minor', icon: '≈', time: '42 min ago' },
    { code: 'BB-2026-9C602DA1', location: 'South Fields · Purok 4', description: 'Standing water across footpath', status: 'Submitted', statusClass: 'submitted', level: 'info', icon: 'i', time: '1 hr ago' }
  ];

  shelters = [
    { name: 'Colacling Elementary School', used: 54, capacity: 200, percent: 27 },
    { name: 'Barangay Multipurpose Hall', used: 94, capacity: 120, percent: 78 },
    { name: 'Upper Colacling Chapel', used: 12, capacity: 80, percent: 15 }
  ];
  evacuationCenters: Record<string, unknown>[] = [];
  selectedEvacuationCenterName = '';
  assignmentOpen = false;
  assignmentCenter?: Record<string, unknown>;
  assignmentResidents: Record<string, unknown>[] = [];
  selectedAssignmentResidentIds = new Set<string>();
  assignmentSearch = '';
  assignmentAt = '';
  assignmentEvacuationStatus: 'Safe' | 'For Monitoring' | 'For Evacuation' | 'Evacuated' = 'Evacuated';

  tableRows: Array<{ name: string; id: string; detail: string; priorityReason?: string; vulnerabilityReason?: string; status: string; updated: string }> = [
    { name: 'Riverside Zone', id: 'ZONE-001', detail: 'Purok 1 · High-risk area', status: 'Active', updated: '8 min ago' },
    { name: 'Colacling Elementary School', id: 'SH-001', detail: 'Capacity 200 · 54 occupied', status: 'Available', updated: '21 min ago' },
    { name: 'Station 1 – Spillway', id: 'ST-001', detail: '1.25 m · Monitoring', status: 'Online', updated: '6 min ago' },
    { name: 'Demo Resident 12-1', id: 'RES-036', detail: 'Elderly · High priority', status: 'Monitoring', updated: '1 hr ago' },
    { name: 'Public flood advisory', id: 'NTF-004', detail: 'Affected zones · Minor incident', status: 'Sent', updated: '2 hrs ago' }
  ];

  get currentPage() {
    const page=this.pageDetails[this.activePage];
    if(this.activePage==='evacuation'){
      const sections:Record<string,{title:string;description:string}>={
        shelters:{title:'Evacuation centers',description:'Check capacity, view resident rosters, and record confirmed arrivals.'},
        residents:{title:'Resident evacuation status',description:'Find a resident and review their current status and assigned center.'},
        volunteers:{title:'Volunteers & tanods',description:'Maintain responder contacts and availability. Build and dispatch crews in DSS.'},
        'emergency-contacts':{title:'Emergency hotlines',description:'Maintain the contact numbers used by officials and residents.'}
      };
      return {...page,...sections[this.currentResource]};
    }
    if(this.activePage==='notifications')return {...page,title:this.currentResource==='emergency-contacts'?'Emergency hotlines':'Public advisories'};
    return page;
  }
  get canReviewReports() { return ['Super Admin', 'Disaster Officer'].includes(this.api.user()?.role ?? ''); }
  get tableSortColumns() {
    const columns: Record<string, Array<{ label: string; field: string }>> = {
      users: [{ label: 'RECORD', field: 'full_name' }, { label: 'DETAILS', field: 'email' }, { label: 'STATUS', field: 'role' }, { label: 'UPDATED', field: 'created_at' }],
      residents: [{ label: 'RECORD', field: 'r.full_name' }, { label: 'DETAILS', field: 'r.address_line' }, { label: 'STATUS', field: 'r.evacuation_status' }, { label: 'UPDATED', field: 'r.updated_at' }],
      households: [{ label: 'RECORD', field: 'household_number' }, { label: 'DETAILS', field: 'address_line' }, { label: 'STATUS', field: 'verification_status' }, { label: 'UPDATED', field: 'updated_at' }],
      'flood-reports': [{ label: 'TIME', field: 'created_at' }, { label: 'ZONE / LOCATION', field: 'location_text' }, { label: 'FLOOD LEVEL', field: 'severity_level' }, { label: 'STATUS', field: 'status' }],
      'barangay-zones': [{ label: 'MAP RECORD', field: 'zone_name' }, { label: 'DETAILS', field: 'updated_at' }, { label: 'UPDATED', field: 'updated_at' }],
      'risk-zones': [{ label: 'MAP RECORD', field: 'risk_zone_name' }, { label: 'DETAILS', field: 'risk_level' }, { label: 'UPDATED', field: 'updated_at' }],
      shelters: [{ label: 'RECORD', field: 'shelter_name' }, { label: 'DETAILS', field: 'current_occupancy' }, { label: 'STATUS', field: 'status' }, { label: 'UPDATED', field: 'updated_at' }],
      volunteers: [{ label: 'RECORD', field: 'full_name' }, { label: 'DETAILS', field: 'availability_status' }, { label: 'STATUS', field: 'availability_status' }, { label: 'UPDATED', field: 'updated_at' }],
      'evacuation-routes': [{ label: 'RECORD', field: 'route_name' }, { label: 'DETAILS', field: 'status' }, { label: 'STATUS', field: 'status' }, { label: 'UPDATED', field: 'updated_at' }],
      'emergency-contacts': [{ label: 'RECORD', field: 'organization_name' }, { label: 'DETAILS', field: 'organization_name' }, { label: 'STATUS', field: 'status' }, { label: 'UPDATED', field: 'updated_at' }],
      notifications: [{ label: 'RECORD', field: 'title' }, { label: 'DETAILS', field: 'type' }, { label: 'STATUS', field: 'status' }, { label: 'UPDATED', field: 'updated_at' }],
      statistics: [{ label: 'RECORD', field: 'name' }, { label: 'DETAILS', field: 'detail' }, { label: 'STATUS', field: 'status' }, { label: 'UPDATED', field: 'updated' }]
    };
    if (this.activePage === 'residents' && this.currentResource === 'residents' && this.resourceFilters['priority'] === 'High') {
      return [
        { label: 'NAME', field: 'r.full_name' },
        { label: 'LOCATION', field: 'r.address_line' },
        { label: 'WHY HIGH PRIORITY', field: 'r.priority_level' },
        { label: 'STATUS', field: 'r.evacuation_status' }
      ];
    }
    if (this.activePage === 'residents' && this.currentResource === 'residents' && this.resourceFilters['vulnerable'] === 'true') {
      return [
        { label: 'NAME', field: 'r.full_name' },
        { label: 'LOCATION', field: 'r.address_line' },
        { label: 'WHY VULNERABLE', field: 'r.priority_level' },
        { label: 'STATUS', field: 'r.evacuation_status' }
      ];
    }
    return columns[this.currentResource] ?? [
      { label: 'RECORD', field: 'created_at' }, { label: 'DETAILS', field: 'created_at' },
      { label: 'STATUS', field: 'created_at' }, { label: 'UPDATED', field: 'created_at' }
    ];
  }
  get currentActionLabel() {
    if (this.currentResource === 'emergency-contacts') return 'Add emergency hotline';
    if (this.activePage === 'evacuation' && this.currentResource === 'residents') return 'Update resident status';
    if (this.activePage === 'map' && this.currentResource === 'barangay-zones') return 'Add barangay zone';
    if (this.activePage === 'map' && this.currentResource === 'risk-zones') return 'Add risk zone';
    if (this.activePage === 'map' && this.currentResource === 'shelters') return 'Add evacuation shelter';
    if (this.activePage === 'evacuation') return ({
      shelters: 'Add evacuation center',
      volunteers: 'Add responder',
      'emergency-contacts': 'Add emergency contact'
    } as Record<string, string>)[this.currentResource] ?? 'Add support record';
    return this.currentPage.action;
  }
  editorValue(name: string) { return String(this.editorValues[name] ?? ''); }
  get selectedHouseholdLabel() {
    return this.householdOptions.find((option) => option.value === this.editorValue('householdId'))?.label ?? '';
  }
  get filteredHouseholdOptions() {
    const query = this.householdLookupQuery.trim().toLowerCase();
    return query ? this.householdOptions.filter((option) => option.label.toLowerCase().includes(query)) : this.householdOptions;
  }
  get canManageCurrentResource() {
    if (this.activePage === 'map' && this.currentResource === 'flood-reports') return false;
    if (this.activePage === 'map' && ['barangay-zones', 'risk-zones'].includes(this.currentResource)) return this.api.user()?.role === 'Super Admin';
    return true;
  }
  get editorFields(): EditorField[] {
    if (this.activePage === 'map' && this.currentResource === 'shelters') return [
      { name: 'shelterName', label: 'Shelter name', required: true },
      { name: 'zoneId', label: 'Barangay zone', type: 'select', required: true, options: this.zoneOptions },
      { name: 'locationText', label: 'Location description', required: true },
      { name: 'locationPicker', label: 'Map location', type: 'location', required: true },
      { name: 'capacity', label: 'Capacity', type: 'number', required: true },
      { name: 'contactPerson', label: 'Contact person', required: true },
      { name: 'contactNumber', label: 'Contact number', required: true }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'status', label: 'Capacity status', type: 'select', required: true, options: options('Available', 'Near Capacity', 'Full', 'Unavailable') },
      { name: 'recordStatus', label: 'Center activation', type: 'select', required: true, options: options('Active', 'Inactive') }
    ];
    if (this.activePage === 'evacuation' && this.currentResource === 'volunteers') return [
      { name: 'fullName', label: 'Full name', required: true }, { name: 'contactNumber', label: 'Contact number', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'responderType', label: 'Responder type', type: 'select', required: true, options: options('Volunteer', 'Barangay Tanod') },
      { name: 'assignedZoneId', label: 'Assigned zone', type: 'select', options: this.zoneOptions },
      { name: 'availabilityStatus', label: 'Availability', type: 'select', required: true, options: options('Available', 'Assigned', 'Unavailable') },
      { name: 'notes', label: 'Notes', type: 'textarea' }
    ];
    if (this.currentResource === 'emergency-contacts') return [
      { name: 'organizationName', label: 'Organization', required: true }, { name: 'contactPerson', label: 'Contact person' },
      { name: 'phoneNumber', label: 'Phone number', required: true }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'isPublic', label: 'Public visibility', type: 'select', required: true, options: [{ value: 'true', label: 'Public' }, { value: 'false', label: 'Internal only' }] },
      { name: 'status', label: 'Status', type: 'select', required: true, options: options('Active', 'Inactive') }
    ];
    if (this.activePage === 'evacuation' && this.currentResource === 'residents') return [
      { name: 'fullName', label: 'Resident', required: true },
      { name: 'recordStatus', label: 'Registry record status', type: 'select', required: true, options: options('Active', 'Inactive') },
      { name: 'evacuationStatus', label: 'Evacuation status', type: 'select', required: true, options: options('Safe', 'For Monitoring', 'For Evacuation', 'Evacuated') },
      { name: 'evacuationShelterId', label: 'Evacuation center', type: 'select', options: this.shelterOptions }
    ];
    const fields: Partial<Record<PageId, EditorField[]>> = {
      users: [
        { name: 'fullName', label: 'Full name', required: true }, { name: 'username', label: 'Username', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'role', label: 'Role', type: 'select', required: true, options: options('Super Admin', 'Disaster Officer', 'Data Encoder') },
        { name: 'password', label: this.editorId ? 'New password (leave blank to keep current)' : 'Initial password', type: 'password', required: !this.editorId,
          placeholder: '12+ characters with uppercase, lowercase, and number' }
      ],
      residents: [
        { name: 'householdId', label: 'Household', type: 'household-lookup', required: true, options: this.householdOptions },
        { name: 'fullName', label: 'Full name', required: true },
        { name: 'age', label: 'Age (calculated)', type: 'number' },
        { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
        { name: 'sex', label: 'Sex', type: 'select', required: true, options: options('Female', 'Male', 'Intersex', 'Prefer not to say', 'Not recorded') },
        { name: 'contactNumber', label: 'Contact number', type: 'tel', placeholder: '0917 123 4567 or (054) 123 4567' }, { name: 'addressLine', label: 'Address', required: true },
        { name: 'relationshipToHead', label: 'Relationship to household head', type: 'select', options: options('Head', 'Daughter', 'Son', 'Wife', 'Husband', 'Grandson', 'Granddaughter', 'Relatives', 'Brother', 'Sister', 'Live-in partner', 'Nephew', 'Other') },
        { name: 'vulnerabilityType', label: 'Vulnerability', type: 'select', options: options('Elderly', 'Child', 'Disability', 'Pregnant', 'Mobility-limited', 'Other') },
        { name: 'maritalStatus', label: 'Marital status', type: 'select', options: options('Widow', 'Single', 'Married') },
        { name: 'outOfSchoolYouth', label: 'Out of school youth', type: 'select', options: options('Yes', 'No') },
        { name: 'occupation', label: 'Occupation' }, { name: 'education', label: 'Education' },
        { name: 'philsysNumber', label: 'PhilSys number' }, { name: 'philhealthNumber', label: 'PhilHealth number' },
        { name: 'fpUse', label: 'FP use', type: 'select', options: options('Yes', 'No') },
        { name: 'unmetNeeds', label: 'Unmet needs', type: 'select', options: options('Yes', 'No') },
        { name: 'pwdSpecify', label: 'PWD (specify)' }, { name: 'soloParent', label: 'Solo parent', type: 'select', options: options('Yes', 'No') },
        { name: 'morbidity', label: 'Morbidity (specify)' },
        { name: 'waterSourceLevel', label: 'Water source level', type: 'select', options: options('I', 'II', 'III') },
        { name: 'sanitaryToilet', label: 'Sanitary toilet', type: 'select', options: options('With', 'Without') },
        { name: 'canSwim', label: 'Can the resident swim?', type: 'select', options: options('Yes', 'No') },
        { name: 'houseType', label: 'Type of house', type: 'select', options: options('Concrete', 'Semi concrete', 'Light materials') },
        { name: 'emergencyContactName', label: 'Emergency contact name' }, { name: 'emergencyContactNumber', label: 'Emergency contact number', type: 'tel', placeholder: 'Mobile or landline number' },
        { name: 'priorityLevel', label: 'Priority level', type: 'select', required: true, options: options('Low', 'Medium', 'High') },
        { name: 'recordStatus', label: 'Registry record status', type: 'select', required: true, options: options('Active', 'Inactive') },
        { name: 'evacuationStatus', label: 'Evacuation status', type: 'select', required: true, options: options('Safe', 'For Monitoring', 'For Evacuation', 'Evacuated') },
        { name: 'evacuationShelterId', label: 'Evacuation center', type: 'select', options: this.shelterOptions }
      ],
      households: [
        { name: 'householdNumber', label: 'Household number', required: true },
        { name: 'zoneId', label: 'Zone', type: 'select', required: true, options: this.zoneOptions },
        { name: 'addressLine', label: 'Address', required: true }, { name: 'headOfHouseholdName', label: 'Head of household', required: true },
        { name: 'contactNumber', label: 'Contact number', type: 'tel', placeholder: '0917 123 4567 or (054) 123 4567' },
        { name: 'verificationStatus', label: 'Verification status', type: 'select', required: true, options: options('Pending Verification', 'Verified', 'Rejected') }
      ],
      map: this.currentResource === 'risk-zones' ? [
        { name: 'riskZoneName', label: 'Risk zone name', required: true },
        { name: 'riskLevel', label: 'Risk level', type: 'select', required: true, options: options('Low', 'Medium', 'High') },
        { name: 'polygonGeoJson', label: 'Boundary', type: 'polygon', required: true },
        { name: 'description', label: 'Description', type: 'textarea' }
      ] : [
        { name: 'zoneName', label: 'Barangay zone name', required: true },
        { name: 'zoneColor', label: 'Boundary color', type: 'color', required: true },
        { name: 'polygonGeoJson', label: 'Boundary', type: 'polygon', required: true },
        { name: 'description', label: 'Description', type: 'textarea' }
      ],
      evacuation: [
        { name: 'shelterName', label: 'Shelter name', required: true },
        { name: 'zoneId', label: 'Zone', type: 'select', required: true, options: this.zoneOptions },
        { name: 'locationText', label: 'Location description', required: true },
        { name: 'locationPicker', label: 'Map location', type: 'location', required: true },
        { name: 'capacity', label: 'Capacity', type: 'number', required: true },
        { name: 'contactPerson', label: 'Contact person', required: true },
        { name: 'contactNumber', label: 'Contact number', required: true }, { name: 'email', label: 'Email', type: 'email' },
        { name: 'status', label: 'Capacity status', type: 'select', required: true, options: options('Available', 'Near Capacity', 'Full', 'Unavailable') },
        { name: 'recordStatus', label: 'Center activation', type: 'select', required: true, options: options('Active', 'Inactive') }
      ],
      notifications: [
        { name: 'title', label: 'Title', required: true }, { name: 'message', label: 'Message', type: 'textarea', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: options('Flood Advisory', 'Evacuation Notice', 'Safety Advisory', 'System Update') },
        { name: 'severityLevel', label: 'Severity', type: 'select', required: true, options: options('Information', 'Minor Incident', 'Major Incident') },
        { name: 'targetAudience', label: 'Target audience', type: 'select', required: true, options: options('Public', 'Affected Zones', 'Internal Admin Users') },
        { name: 'zoneIds', label: 'Affected zones', type: 'multiselect', options: this.zoneOptions }
      ],
      reports: [
        ...(this.editorId ? [
          { name: 'status', label: 'Review decision', type: 'select' as const, required: true, options: this.reportReviewOptions },
          { name: 'severityLevel', label: 'Incident level', type: 'select' as const, required: true, options: options('Information', 'Minor Incident', 'Major Incident') },
          { name: 'validationNotes', label: 'Reviewer notes (required to reject or resolve)', type: 'textarea' as const, required:['Rejected','Resolved'].includes(String(this.editorValues['status'])) },
          { name: 'zoneIds', label: 'Affected Barangay Zones', type: 'multiselect' as const, required:['Validated','Resolved'].includes(String(this.editorValues['status'])), options: this.zoneOptions }
        ] : [
          { name: 'reporterName', label: 'Reporter name' },
          { name: 'reporterContactInfo', label: 'Reporter contact information' },
          { name: 'incidentType', label: 'Incident type', type: 'select' as const, required: true, options: options(...this.incidentTypes) },
          { name: 'severityLevel', label: 'Incident level', type: 'select' as const, required: true, options: options(...this.incidentLevels) },
          { name: 'locationPicker', label: 'Incident map location', type: 'location' as const, required: true },
          { name: 'description', label: 'Description', type: 'textarea' as const }
        ])
      ]
    };
    return fields[this.activePage] ?? [];
  }
  get visibleNavItems() {
    const role = this.api.user()?.role;
    return this.navItems.filter((item) => {
      if (item.id === 'users') return role === 'Super Admin';
      if (['reports', 'notifications'].includes(item.id)) return role === 'Super Admin' || role === 'Disaster Officer';
      if (['residents', 'households'].includes(item.id)) return role === 'Super Admin' || role === 'Data Encoder';
      return true;
    });
  }

  ngOnInit() {
    this.restoreRoute(true);
    window.addEventListener('popstate', this.popStateHandler);
    this.clockTimer = window.setInterval(() => {
      this.liveNow.set(new Date());
    }, 1_000);
    this.dashboardRefreshTimer = window.setInterval(() => {
      if (this.api.user() && this.activePage === 'dashboard' && !this.loading) this.loadDashboard();
      if (!this.api.user()) this.loadPublicData();
    }, 30_000);
    this.resetToken = new URLSearchParams(window.location.search).get('token') ?? '';
    if (this.resetToken) { this.publicPage = 'login'; this.recoveryOpen = true; }
    this.loadPublicData();
    this.loginLoading = true;
    this.api.refresh().pipe(finalize(() => {
      this.sessionResolving = false;
      this.finishLoginLoading();
    })).subscribe({
      next: ({ user }) => { if (!user.mustChangePassword) this.setPage(this.requestedAdminPage ?? 'dashboard', false); },
      error: () => undefined
    });
  }

  ngOnDestroy() {
    if (this.clockTimer) window.clearInterval(this.clockTimer);
    if (this.dashboardRefreshTimer) window.clearInterval(this.dashboardRefreshTimer);
    if (this.publicToastTimer) window.clearTimeout(this.publicToastTimer);
    if (this.successMessageTimer) window.clearTimeout(this.successMessageTimer);
    window.removeEventListener('popstate', this.popStateHandler);
  }

  get liveDateTime() {
    return new Intl.DateTimeFormat('en-PH', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    }).format(this.liveNow());
  }

  login(event: Event, username: string, password: string) {
    event.preventDefault();
    this.errorMessage = '';
    this.fieldErrors = {};
    const form = event.currentTarget as HTMLFormElement;
    const cleanUsername = username.trim();
    if (!cleanUsername) this.fieldErrors['username'] = 'Enter your username.';
    if (!password) this.fieldErrors['password'] = 'Enter your password.';
    if (Object.keys(this.fieldErrors).length) {
      this.focusEditorField(form, Object.keys(this.fieldErrors)[0]!);
      return;
    }
    this.loginLoading = true;
    this.api.login(cleanUsername, password).pipe(finalize(() => this.finishLoginLoading())).subscribe({
      next: ({ user }) => { if (!user.mustChangePassword) this.setPage(this.requestedAdminPage ?? 'dashboard'); },
      error: (error) => {
        const fields = error?.error?.fieldErrors;
        if (fields && typeof fields === 'object' && Object.keys(fields).length) {
          this.fieldErrors = fields;
          this.focusEditorField(form, Object.keys(fields)[0]!);
        } else this.errorMessage = error?.error?.message ?? 'Unable to connect to the BantayBaha API.';
      }
    });
  }

  requestRecovery(event: Event, email: string) {
    event.preventDefault();
    this.errorMessage = '';
    this.fieldErrors = {};
    const form = event.currentTarget as HTMLFormElement;
    const cleanEmail = email.trim();
    if (!cleanEmail) this.fieldErrors['email'] = 'Enter your registered email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) this.fieldErrors['email'] = 'Enter a valid email address.';
    if (Object.keys(this.fieldErrors).length) {
      this.focusEditorField(form, 'email');
      return;
    }
    this.loginLoading = true;
    this.api.forgotPassword(cleanEmail).pipe(finalize(() => this.finishLoginLoading())).subscribe({
      next: (value) => this.successMessage = value.message,
      error: (error) => this.errorMessage = error?.error?.message ?? 'Password recovery could not be completed.'
    });
  }

  performReset(event: Event, password: string) {
    event.preventDefault();
    this.errorMessage = '';
    this.fieldErrors = {};
    const form = event.currentTarget as HTMLFormElement;
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      this.fieldErrors['password'] = 'Use at least 12 characters with uppercase, lowercase, and a number.';
      this.focusEditorField(form, 'password');
      return;
    }
    this.loginLoading = true;
    this.api.resetPassword(this.resetToken, password).pipe(finalize(() => this.finishLoginLoading())).subscribe({
      next: () => {
        this.successMessage = 'Password updated. You can now sign in.';
        this.resetToken = '';
        this.recoveryOpen = false;
        history.replaceState({}, '', location.pathname);
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'Password recovery could not be completed.'
    });
  }

  logout() {
    this.api.logout().subscribe({
      next: () => this.navigatePublic('home'),
      error: () => {
        this.api.accessToken.set(null);
        this.api.user.set(null);
        this.navigatePublic('home');
      }
    });
  }

  navigatePublic(page: PublicPage, replace = false) {
    if(page==='report'&&this.publicPage!=='report')this.reloadPublicDraft();
    this.publicPage = page;
    this.requestedAdminPage = undefined;
    const path: Record<PublicPage, string> = {
      home: '/',
      map: '/live-map',
      report: '/report',
      login: '/login'
    };
    const method = replace || window.location.pathname === path[page] ? 'replaceState' : 'pushState';
    window.history[method]({}, '', path[page]);
    sessionStorage.setItem('bantayBahaRoute', path[page]);
    window.scrollTo({ top: 0 });
  }

  private restoreRoute(allowSavedFallback = false) {
    let path = window.location.pathname.replace(/\/+$/, '') || '/';
    const savedPath = sessionStorage.getItem('bantayBahaRoute');
    if (allowSavedFallback && path === '/' && savedPath && savedPath !== '/') {
      path = savedPath;
      window.history.replaceState({}, '', path);
    }
    const publicRoutes: Record<string, PublicPage> = {
      '/': 'home',
      '/live-map': 'map',
      '/report': 'report',
      '/login': 'login'
    };
    if (publicRoutes[path]) {
      if(publicRoutes[path]==='report'&&this.publicPage!=='report')this.reloadPublicDraft();
      this.publicPage = publicRoutes[path]!;
      this.requestedAdminPage = undefined;
      sessionStorage.setItem('bantayBahaRoute', path);
      return;
    }
    const match = path.match(/^\/admin\/([a-z-]+)$/);
    const page = match?.[1] as PageId | undefined;
    const validPages = this.navItems.map((item) => item.id);
    if (page && validPages.includes(page)) {
      this.requestedAdminPage = page;
      sessionStorage.setItem('bantayBahaRoute', path);
      if (this.api.user()) this.setPage(page, false);
      else this.publicPage = 'login';
      return;
    }
    this.navigatePublic('home', true);
  }

  loadPublicData() {
    forkJoin({
      notifications: this.api.publicNotifications(),
      contacts: this.api.publicEmergencyContacts(),
      reports: this.api.publicReports(),
      weather: this.api.currentWeather().pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ notifications, contacts, reports, weather }) => {
        this.publicNotifications = notifications.items;
        this.publicContacts = contacts.items;
        this.publicReports = reports.items;
        if (weather) this.weather = weather;
        this.changeDetector.detectChanges();
      },
      error: () => undefined
    });
  }

  updatePublicMapData(data: Record<string, unknown>) {
    this.publicMapData = data as Record<string, any>;
  }

  setPublicMapLayer(layer: keyof typeof this.publicMapLayers, visible: boolean) {
    this.publicMapLayers = { ...this.publicMapLayers, [layer]: visible };
  }
  get activeResourceFilterCount() {
    return Object.values(this.resourceFilters).filter((value) => String(value ?? '').trim()).length;
  }
  get isHistoricalResidentYear() { return this.selectedResidentYear !== this.currentResidentYear; }

  selectPublicMapLayer(layer: 'barangayZones' | 'riskZones' | 'shelters' | 'incidents') {
    this.selectedPublicMapFocus = undefined;
    this.publicMapLayers = {
      barangayZones: layer === 'barangayZones',
      riskZones: layer === 'riskZones',
      shelters: layer === 'shelters',
      incidents: layer === 'incidents',
      routes: false,
      rivers: this.publicMapLayers.rivers,
      floodHazards: this.publicMapLayers.floodHazards
    };
  }

  showAllPublicMapLayers() {
    this.selectedPublicMapFocus = undefined;
    this.publicMapLayers = { barangayZones: true, riskZones: true, shelters: true, incidents: true, routes: false, rivers: true, floodHazards: true };
  }

  get allPublicMapLayersVisible() {
    return this.publicMapLayers.barangayZones && this.publicMapLayers.riskZones
      && this.publicMapLayers.shelters && this.publicMapLayers.incidents && this.publicMapLayers.rivers && this.publicMapLayers.floodHazards;
  }

  togglePublicMapLabels() {
    this.publicMapLabelsVisible = !this.publicMapLabelsVisible;
  }

  togglePublicMapSection(section: keyof typeof this.publicMapSections) {
    const opening = !this.publicMapSections[section];
    this.publicMapSections = {
      barangayZones: false,
      shelters: false,
      riskZones: false,
      incidents: false,
      announcements: false,
      [section]: opening
    };
  }

  focusPublicMapRecord(resource: 'barangay-zones' | 'risk-zones' | 'shelters' | 'reports', record: Record<string, unknown>) {
    const id = String(record['zone_id'] ?? record['risk_zone_id'] ?? record['shelter_id'] ?? record['report_id'] ?? '');
    this.selectedPublicMapFocus = { id, resource, record, nonce: Date.now() };
    if (resource === 'reports') this.openPublicIncident(record);
  }

  focusAnnouncement(notice: Record<string, unknown>) {
    const reportId = notice['flood_report_id'];
    const report = (this.publicMapData['reports'] ?? []).find((item: Record<string, unknown>) => item['report_id'] === reportId);
    if (!report) return;
    this.selectedPublicMapFocus = { id: String(report['report_id']), resource: 'reports', record: report, nonce: Date.now() };
  }

  openPublicIncident(report: Record<string, unknown>) {
    this.viewingAdminIncident = false;
    this.selectedPublicIncident = report;
  }

  openAdminIncident(row: { id: string }) {
    const report = this.rawRecords.get(row.id);
    if (!report) return;
    this.viewingAdminIncident = true;
    this.selectedPublicIncident = report;
    this.clearAdminReportPhotos();
    this.loadAdminReportPhotos(row.id, report['photo_urls'] ?? report['photoUrls']);
    this.reportReviews=[];
    this.api.get<FloodReportDetails>('flood-reports',row.id).subscribe({next:details=>{
      if (!this.viewingAdminIncident || this.selectedPublicIncident?.['report_id'] !== row.id) return;
      this.selectedPublicIncident=details;this.reportReviews=details.reviews;this.changeDetector.detectChanges();
    },error:()=>{if (this.viewingAdminIncident && this.selectedPublicIncident?.['report_id']===row.id) this.selectedPublicIncident['history_error']='Report history could not be loaded. Close and retry.';this.changeDetector.detectChanges();}});
  }

  openHouseholdDetails(row: {id:string}, dialog:HTMLDialogElement) {
    const request=++this.householdDetailsRequest;
    this.householdDetails=undefined;this.householdDetailsError='';this.householdDetailsLoading=true;
    dialog.showModal();
    this.api.get<HouseholdDetails>('households',`${row.id}/details`).subscribe({next:details=>{
      if (request!==this.householdDetailsRequest) return;
      this.householdDetails=details;this.householdDetailsLoading=false;this.changeDetector.detectChanges();
    },error:error=>{
      if (request!==this.householdDetailsRequest) return;
      this.householdDetailsError=error?.error?.message ?? 'Household details could not be loaded. Close and retry.';
      this.householdDetailsLoading=false;this.changeDetector.detectChanges();
    }});
  }
  openHouseholdMembers(dialog:HTMLDialogElement) {
    const id=this.householdDetails?.household.household_id;
    if (!id) return;
    dialog.close();this.setPage('residents');this.selectedResidentYear=this.currentResidentYear;this.resourceFilters={household:id};this.loadResource();
  }

  viewReportLocation() {
    const report = this.selectedPublicIncident;
    if (!report) return;
    const id = String(report['report_id'] ?? '');
    this.closePublicIncident();
    this.setPage('map');
    this.selectResource('flood-reports');
    this.selectedMapFocus = { id, resource: 'reports', record: report, nonce: Date.now() };
  }

  closePublicIncident() {
    if (this.viewingAdminIncident) this.clearAdminReportPhotos();
    this.viewingAdminIncident = false;
    this.selectedPublicIncident = undefined;
  }

  submitPublicReport(event: Event, incidentType: string, severityLevel: string, description: string, reporterName: string, reporterContact: string, cameraPhotos: FileList | null, uploadedPhotos: FileList | null, locationPicker: LocationPickerComponent) {
    event.preventDefault();
    this.errorMessage = '';
    this.successMessage = '';
    const reportForm = event.currentTarget as HTMLFormElement;
    this.savePublicDraft(reportForm);
    const values = new FormData(reportForm);
    const location = String(values.get('locationText') ?? '');
    const latitude = String(values.get('latitude') ?? '');
    const longitude = String(values.get('longitude') ?? '');
    if (!location || !latitude || !longitude) {
      this.errorMessage = 'Pin the flood incident location on the map.';
      return;
    }
    const selectedPhotos = [...Array.from(cameraPhotos ?? []), ...Array.from(uploadedPhotos ?? [])];
    if (selectedPhotos.length > 5) {
      this.errorMessage = 'You can attach a maximum of 5 photos.';
      return;
    }
    const invalidPhoto = selectedPhotos.find((photo) => !['image/jpeg', 'image/png'].includes(photo.type) || photo.size > 5 * 1024 * 1024);
    if (invalidPhoto) {
      this.errorMessage = `“${invalidPhoto.name}” must be a JPEG or PNG no larger than 5 MB.`;
      return;
    }
    const form = new FormData();
    form.set('locationText', location);
    form.set('incidentType', incidentType);
    form.set('severityLevel', severityLevel);
    form.set('latitude', latitude);
    form.set('longitude', longitude);
    form.set('description', description);
    if (reporterName) form.set('reporterName', reporterName);
    if (reporterContact) form.set('reporterContactInfo', reporterContact);
    for (const photo of selectedPhotos) form.append('photos', photo);
    this.loading = true;
    this.api.submitFloodReport(form).pipe(finalize(() => this.finishLoading())).subscribe({
      next: ({ trackingCode }) => {
        this.clearPublicDraft(reportForm,locationPicker);
        this.errorMessage = '';
        this.showPublicToast(`Report submitted successfully. Tracking code: ${trackingCode}`);
        this.loadPublicData();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'The report could not be submitted.'
    });
  }

  dismissPublicToast() {
    this.publicToastMessage = '';
    if (this.publicToastTimer) window.clearTimeout(this.publicToastTimer);
    this.publicToastTimer = undefined;
  }

  private showPublicToast(message: string) {
    this.dismissPublicToast();
    this.publicToastMessage = message;
    this.publicToastTimer = window.setTimeout(() => {
      this.publicToastMessage = '';
      this.changeDetector.detectChanges();
    }, 8_000);
  }

  loadDashboard() {
    this.loadRecordQuality();
    this.dashboardAttention = undefined;
    this.refreshPendingReportCount();
    this.loading = true;
    forkJoin({
      summary: this.api.dashboardSummary(),
      reports: this.api.dashboardReports().pipe(catchError(() => of({ items: [] }))),
      alert: this.api.dashboardAlert().pipe(catchError(() => of({ alert: null }))),
      notifications: this.api.dashboardNotifications().pipe(catchError(() => of({ items: [] }))),
      shelters: this.api.list<Record<string, unknown>>('shelters', 1, 3).pipe(catchError(() => of({ items: [], page: 1, pageSize: 3, totalItems: 0, totalPages: 1 }))),
      risk: this.api.statistics('risk-summary').pipe(catchError(() => of({} as Record<string, unknown>))),
      weather: this.api.currentWeather().pipe(catchError(() => of(null)))
    }).pipe(finalize(() => this.finishLoading())).subscribe({
      next: ({ summary, reports, alert, notifications, shelters, risk, weather }) => {
        this.dashboardAttention = { pending: dashboardCount(summary.pendingReports), residents: dashboardCount(summary.forEvacuationResidents), shelters: dashboardCount(summary.nearCapacityShelters) };
        this.metrics[0]!.value = String(summary.totalResidents ?? 0);
        this.metrics[0]!.note = `${summary.highPriorityResidents ?? 0} high · ${summary.mediumPriorityResidents ?? 0} medium · ${summary.lowPriorityResidents ?? 0} low priority`;
        this.metrics[1]!.value = String(summary.totalHouseholds ?? 0);
        this.metrics[1]!.note = `Across ${summary.totalZones ?? 0} barangay zones`;
        this.metrics[2]!.value = String(summary.vulnerableResidents ?? 0);
        this.metrics[2]!.note = `${summary.highPriorityResidents ?? 0} residents marked high priority`;
        this.metrics[3]!.value = String(summary.activeReports ?? 0);
        this.metrics[3]!.note = `${summary.pendingReports ?? 0} awaiting review`;
        this.reports = reports.items.map((row) => this.mapReport(row));
        this.dashboardAlert = alert.alert ?? undefined;
        this.dashboardNotifications = notifications.items;
        this.overallRisk = String(risk['overallRiskLevel'] ?? 'Unknown');
        this.activeValidatedReports = dashboardCount(risk['activeValidatedReports']);
        this.affectedZones = dashboardCount(risk['affectedZones']);
        this.priorityResidents = dashboardCount(risk['priorityResidents']);
        if (weather) this.weather = weather;
        this.shelters = shelters.items.map((row) => ({
          name: String(row['shelter_name'] ?? row['shelterName'] ?? 'Shelter'),
          used: Number(row['resident_occupancy'] ?? row['current_occupancy'] ?? row['currentOccupancy'] ?? 0),
          capacity: Number(row['capacity'] ?? 0),
          percent: Number(row['capacity']) > 0
            ? Math.round(Number(row['resident_occupancy'] ?? row['current_occupancy'] ?? row['currentOccupancy'] ?? 0) / Number(row['capacity']) * 100)
            : 0
        }));
      },
      error: (error) => {
        this.metrics[0]!.value = '—';
        this.metrics[0]!.note = 'Current resident data unavailable';
        this.metrics[1]!.value = '—';
        this.metrics[1]!.note = 'Current household data unavailable';
        this.metrics[2]!.value = '—';
        this.metrics[2]!.note = 'Current resident data unavailable';
        this.metrics[3]!.value = '—';
        this.metrics[3]!.note = 'Current report data unavailable';
        this.errorMessage = error?.error?.message ?? 'Dashboard data could not be loaded.';
      }
    });
  }

  openDashboardReports() {
    if (this.canReviewReports) this.setPage('reports');
  }

  openDashboardNotifications() {
    if (this.canReviewReports) this.setPage('notifications');
  }

  changeTemporaryPassword(event: Event, currentPassword: string, newPassword: string, confirmation: string) {
    event.preventDefault();
    this.errorMessage = '';
    this.fieldErrors = {};
    const form = event.currentTarget as HTMLFormElement;
    if (newPassword !== confirmation) {
      this.fieldErrors['confirmation'] = 'Passwords do not match.';
      this.focusEditorField(form, 'confirmation');
      return;
    }
    if (newPassword.length < 12 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      this.fieldErrors['newPassword'] = 'Use at least 12 characters with uppercase, lowercase, and a number.';
      this.focusEditorField(form, 'newPassword');
      return;
    }
    this.loginLoading = true;
    this.api.changePassword(currentPassword, newPassword).pipe(finalize(() => this.finishLoginLoading())).subscribe({
      next: () => { this.fieldErrors = {}; this.setPage(this.requestedAdminPage ?? 'dashboard'); },
      error: (error) => {
        const fields = error?.error?.fieldErrors;
        if (fields && Object.keys(fields).length) {
          this.fieldErrors = fields;
          this.focusEditorField(form, Object.keys(fields)[0]!);
        } else this.errorMessage = error?.error?.message ?? 'Password could not be changed.';
      }
    });
  }

  toggleHeaderNotifications() {
    this.headerNotificationsOpen = !this.headerNotificationsOpen;
    if (!this.headerNotificationsOpen) return;
    this.loadHeaderNotifications();
  }

  loadHeaderNotifications() {
    this.headerNotificationsLoading = true;
    this.headerNotificationsError = '';
    this.api.dashboardNotifications().pipe(finalize(() => {
      this.headerNotificationsLoading = false;
      this.changeDetector.detectChanges();
    })).subscribe({
      next: ({ items }) => this.dashboardNotifications = items,
      error: () => this.headerNotificationsError = 'Recent advisories could not be loaded.'
    });
  }

  weatherDescription(code: number | undefined) {
    if (code === 0) return 'Clear sky';
    if ([1, 2].includes(code ?? -1)) return 'Partly cloudy';
    if (code === 3) return 'Overcast';
    if ([45, 48].includes(code ?? -1)) return 'Foggy';
    if ([51, 53, 55, 56, 57].includes(code ?? -1)) return 'Drizzle';
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code ?? -1)) return 'Rain showers';
    if ([95, 96, 99].includes(code ?? -1)) return 'Thunderstorm';
    return 'Weather unavailable';
  }

  weatherIcon(code: number | undefined) {
    if (code === 0) return '☀';
    if ([1, 2].includes(code ?? -1)) return '⛅';
    if ([3, 45, 48].includes(code ?? -1)) return '☁';
    if ([95, 96, 99].includes(code ?? -1)) return '⛈';
    return '🌧';
  }

  canOpenDashboardMetric(page: PageId) {
    return this.visibleNavItems.some((item) => item.id === page);
  }

  openDashboardMetric(metric: { page: PageId; filters?: Record<string, string> }) {
    if (!this.canOpenDashboardMetric(metric.page)) return;
    this.setPage(metric.page);
    if (!metric.filters) return;
    this.resourceFilters = { ...metric.filters };
    this.page = 1;
    this.loadResource();
  }

  openDssMetric(target: { page: string; resource?: string; filters?: Record<string, string> }) {
    const page = target.page as PageId;
    if (!this.canOpenDashboardMetric(page)) return;
    this.setPage(page);
    if (target.resource) this.selectResource(target.resource);
    if (target.filters) {
      this.resourceFilters = { ...target.filters };
      this.page = 1;
      this.loadResource();
    }
  }

  openHazardDss() {
    this.dssInitialTab = 'zones';
    this.setPage('statistics');
  }

  setPage(page: PageId, updateHistory = true) {
    if(updateHistory)requestAnimationFrame(()=>{window.scrollTo({top:0});document.getElementById('main-workspace')?.focus({preventScroll:true});});
    this.headerNotificationsOpen = false;
    this.activePage = page;
    this.requestedAdminPage = page;
    const path = `/admin/${page}`;
    if (updateHistory && window.location.pathname !== path) window.history.pushState({}, '', path);
    sessionStorage.setItem('bantayBahaRoute', path);
    this.menuOpen = false;
    if (page === 'dashboard') return this.loadDashboard();
    if (page === 'residents' || page === 'reports' || page === 'households') {
      this.loadZoneOptions();
      if (page === 'residents') this.loadHouseholdOptions();
    }
    if (page === 'map') {
      this.zoneAssessment = undefined;
      this.selectedZoneId = '';
      this.loadZoneAssessment();
      this.currentResource = 'barangay-zones';
      this.setAdminMapLayer('barangay-zones');
      this.page = 1;
      this.sortBy = '';
      this.loadResource();
      return;
    }
    if (page === 'statistics' || page === 'dss') {
      this.currentResource = page;
      this.sortBy = '';
      this.loading = false;
      return;
    }
    const resource: Partial<Record<PageId, string>> = {
      reports: 'flood-reports', residents: 'residents', households: 'households',
      evacuation: 'shelters', notifications: 'notifications', users: 'users'
    };
    const endpoint = resource[page];
    if (!endpoint) return;
    this.currentResource = endpoint;
    this.page = 1;
    this.searchTerm = '';
    this.sortBy = page === 'households' ? 'household_sort_key' : '';
    this.sortOrder = page === 'households' ? 'asc' : 'desc';
    this.resourceFilters = {};
    if (page === 'evacuation') this.loadEvacuationCenters();
    this.loadResource();
  }

  openNewAdvisory() {
    if (this.currentResource !== 'notifications') this.selectResource('notifications');
    this.openEditor();
  }

  selectResource(resource: string) {
    this.centerMapOpen=false;
    this.centerRecordsOpen=false;
    this.currentResource = resource;
    if (this.activePage === 'map') this.setAdminMapLayer(resource);
    this.selectedMapFocus = undefined;
    this.page = 1;
    this.searchTerm = '';
    this.sortBy = '';
    this.resourceFilters = {};
    this.selectedEvacuationCenterName = '';
    if (this.activePage === 'evacuation') this.loadEvacuationCenters();
    this.loadResource();
  }

  private setAdminMapLayer(resource: string) {
    this.adminMapLayers = {
      barangayZones: resource === 'barangay-zones',
      riskZones: resource === 'risk-zones',
      shelters: resource === 'shelters',
      incidents: resource === 'flood-reports',
      routes: false,
      rivers: this.adminMapLayers.rivers,
      floodHazards: this.adminMapLayers.floodHazards
    };
  }

  showAllAdminMapLayers() {
    this.selectedMapFocus = undefined;
    this.adminMapLayers = {
      barangayZones: true,
      riskZones: true,
      shelters: true,
      incidents: true,
      routes: false,
      rivers: true,
      floodHazards: true
    };
  }

  get allAdminMapLayersVisible() {
    return this.adminMapLayers.barangayZones
      && this.adminMapLayers.riskZones
      && this.adminMapLayers.shelters
      && this.adminMapLayers.incidents && this.adminMapLayers.rivers && this.adminMapLayers.floodHazards;
  }

  toggleAdminRivers() { this.adminMapLayers = { ...this.adminMapLayers, rivers: !this.adminMapLayers.rivers }; }
  toggleAdminFloodHazards() { this.adminMapLayers = { ...this.adminMapLayers, floodHazards: !this.adminMapLayers.floodHazards }; }

  toggleAdminMapLabels() {
    this.adminMapLabelsVisible = !this.adminMapLabelsVisible;
  }

  loadEvacuationCenters() {
    this.api.list<Record<string, unknown>>('shelters', 1, 100, '', 'shelter_name', 'asc').subscribe({
      next: ({ items }) => {
        this.evacuationCenters = items;
        this.changeDetector.detectChanges();
      },
      error: () => this.evacuationCenters = []
    });
  }

  viewShelterResidents(center: Record<string, unknown>) {
    this.currentResource = 'residents';
    this.page = 1;
    this.searchTerm = '';
    this.sortBy = 'r.full_name';
    this.sortOrder = 'asc';
    this.resourceFilters = { shelter: String(center['shelter_id']) };
    this.selectedEvacuationCenterName = String(center['shelter_name'] ?? 'Evacuation center');
    this.loadResource();
  }

  toggleEvacuationCenter(center: Record<string, unknown>, event: Event) {
    event.stopPropagation();
    const id = String(center['shelter_id']);
    const nextStatus = center['record_status'] === 'Active' ? 'Inactive' : 'Active';
    this.loading = true;
    this.api.update('shelters', id, { recordStatus: nextStatus }).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.successMessage = `${center['shelter_name']} is now ${String(nextStatus).toLowerCase()}.`;
        this.loadEvacuationCenters();
        if (this.currentResource === 'shelters') this.loadResource();
        this.mapRefreshNonce++;
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'The evacuation center status could not be updated.'
    });
  }

  loadResource() {
    if (!this.currentResource) return;
    this.errorMessage = '';
    this.resourceLoadError = '';
    const resource = this.currentResource;
    const requestId = ++this.resourceRequestId;
    this.loading = true;
    this.tableRows = [];
    this.rawRecords.clear();
    if (this.activePage === 'residents' && resource === 'residents') {
      this.api.residentsByYear<Record<string, unknown>>(
        this.selectedResidentYear, this.page, 20, this.searchTerm, this.sortBy || 'r.full_name', this.sortOrder, this.resourceFilters
      ).pipe(finalize(() => {
        if (requestId === this.resourceRequestId) {
          this.loading = false;
          this.changeDetector.detectChanges();
        }
      })).subscribe({
        next: ({ items, totalItems, totalPages, availableYears, summary }) => {
          if (requestId !== this.resourceRequestId || resource !== this.currentResource) return;
          this.totalItems = totalItems;
          this.totalPages = Math.max(1, totalPages);
          this.residentYears = availableYears;
          this.residentYearSummary = summary;
          this.tableRows = items.map((row, index) => {
            const mapped = this.mapTableRow(row, index);
            this.rawRecords.set(mapped.id, row);
            return mapped;
          });
          this.changeDetector.detectChanges();
        },
        error: (error) => {
          if (requestId !== this.resourceRequestId || resource !== this.currentResource) return;
          this.totalItems = 0;
          this.totalPages = 1;
          this.errorMessage = error?.error?.message ?? 'Resident snapshot data could not be loaded.';
          this.resourceLoadError = this.errorMessage;
          this.changeDetector.detectChanges();
        }
      });
      return;
    }
    this.api.list<Record<string, unknown>>(resource, this.page, 20, this.searchTerm, this.sortBy, this.sortOrder, this.resourceFilters).pipe(finalize(() => {
      if (requestId === this.resourceRequestId) {
        this.loading = false;
        this.changeDetector.detectChanges();
      }
    })).subscribe({
      next: ({ items, totalItems, totalPages }) => {
        if (requestId !== this.resourceRequestId || resource !== this.currentResource) return;
        this.totalItems = totalItems;
        this.totalPages = Math.max(1, totalPages);
        this.tableRows = items.map((row, index) => {
          const mapped = this.mapTableRow(row, index);
          this.rawRecords.set(mapped.id, row);
          return mapped;
        });
        this.changeDetector.detectChanges();
      },
      error: (error) => {
        if (requestId !== this.resourceRequestId || resource !== this.currentResource) return;
        this.totalItems = 0;
        this.totalPages = 1;
        this.errorMessage = error?.error?.message ?? `${this.currentPage.title} data could not be loaded.`;
        this.resourceLoadError = this.errorMessage;
        this.changeDetector.detectChanges();
      }
    });
  }

  searchResource(event: Event, value: string) {
    event.preventDefault();
    this.searchTerm = value.trim();
    this.page = 1;
    this.loadResource();
  }

  openResourceFilters(dialog: HTMLDialogElement) {
    for (const field of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name], select[name]')) {
      field.value = field.name === 'vulnerability' && this.resourceFilters['vulnerable'] === 'true'
        ? 'Any' : this.resourceFilters[field.name] ?? '';
    }
    dialog.showModal();
  }
  reviewViewedReport() {
    const id=String(this.selectedPublicIncident?.['report_id'] ?? '');
    if (!id) return;
    this.closePublicIncident();this.openEditor({id});
  }

  applyReportFilters(zone: string, severity: string, status: string, incidentType: string, dateFrom: string, dateTo: string) {
    this.resourceFilters = { zone, severity, status, incidentType, dateFrom, dateTo };
    this.page = 1;
    this.loadResource();
  }

  selectResidentYear(value: string) {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > this.currentResidentYear) return;
    this.selectedResidentYear = year;
    this.page = 1;
    this.searchTerm = '';
    this.resourceFilters = {};
    this.sortBy = 'r.full_name';
    this.sortOrder = 'asc';
    this.loadResource();
  }

  applyResidentFilters(zone: string, household: string, vulnerability: string, status: string, priority: string) {
    this.resourceFilters = vulnerability === 'Any'
      ? { zone, household, vulnerable: 'true', status, priority }
      : { zone, household, vulnerability, status, priority };
    this.page = 1;
    this.loadResource();
  }

  openResidentSummary(kind: 'residents' | 'households' | 'vulnerable' | 'priority') {
    if (kind === 'households') {
      this.setPage('households');
      return;
    }
    this.currentResource = 'residents';
    this.resourceFilters = kind === 'vulnerable'
      ? { vulnerable: 'true' }
      : kind === 'priority'
        ? { priority: 'High' }
        : {};
    this.page = 1;
    this.loadResource();
  }

  applyHouseholdFilter(zone: string) {
    this.resourceFilters = { zone };
    this.page = 1;
    this.loadResource();
  }

  clearResourceFilters() {
    this.resourceFilters = {};
    this.sortBy = this.currentResource === 'households' ? 'household_sort_key' : '';
    this.sortOrder = this.currentResource === 'households' ? 'asc' : 'desc';
    this.page = 1;
    this.loadResource();
  }

  openAssignResidents(center: Record<string, unknown>, event?: Event) {
    event?.stopPropagation();
    if (this.loading || center['record_status'] !== 'Active' || ['Full', 'Unavailable'].includes(String(center['status'])) || +(center['resident_occupancy'] || 0) >= +(center['capacity'] || 0)) return;
    this.assignmentCenter = center;
    this.assignmentOpen = true;
    this.assignmentSearch = '';
    this.assignmentAt = this.localDateTimeValue(new Date());
    this.assignmentEvacuationStatus = 'Evacuated';
    this.errorMessage = '';
    this.selectedAssignmentResidentIds.clear();
    this.loadAssignmentResidents();
  }

  closeAssignResidents() {
    this.assignmentOpen = false;
    this.assignmentCenter = undefined;
    this.assignmentResidents = [];
    this.selectedAssignmentResidentIds.clear();
  }

  loadAssignmentResidents() {
    this.api.list<Record<string, unknown>>('residents', 1, 100, this.assignmentSearch, 'r.full_name', 'asc').subscribe({
      next: ({ items }) => this.assignmentResidents = items.filter((resident) =>
        !(resident['evacuation_status'] === 'Evacuated' && resident['evacuation_shelter_id'] === this.assignmentCenter?.['shelter_id'])
      ),
      error: (error) => this.errorMessage = error?.error?.message ?? 'Residents could not be loaded.'
    });
  }

  toggleAssignmentResident(residentId: string, checked: boolean) {
    checked ? this.selectedAssignmentResidentIds.add(residentId) : this.selectedAssignmentResidentIds.delete(residentId);
  }

  saveResidentAssignments() {
    const shelterId = String(this.assignmentCenter?.['shelter_id'] ?? '');
    if (!shelterId || !this.selectedAssignmentResidentIds.size) {
      this.errorMessage = 'Select at least one resident to assign.';
      return;
    }
    const evacuationAt = new Date(this.assignmentAt);
    if (!this.assignmentAt || Number.isNaN(evacuationAt.getTime())) {
      this.errorMessage = 'Enter a valid evacuation date and time.';
      return;
    }
    const occupancy = Number(this.assignmentCenter?.['resident_occupancy'] ?? 0);
    const capacity = Number(this.assignmentCenter?.['capacity'] ?? 0);
    if (this.assignmentEvacuationStatus === 'Evacuated' && occupancy + this.selectedAssignmentResidentIds.size > capacity) {
      this.errorMessage = `Only ${Math.max(0, capacity - occupancy)} resident slot(s) remain in this evacuation center.`;
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.api.assignResidents(shelterId, [...this.selectedAssignmentResidentIds], evacuationAt.toISOString(), this.assignmentEvacuationStatus).pipe(finalize(() => this.finishLoading())).subscribe({
      next: ({ message }) => {
        this.closeAssignResidents();
        this.successMessage = message;
        this.loadEvacuationCenters();
        this.loadResource();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'Residents could not be assigned.'
    });
  }

  returnResidentHome(row: { id: string; name: string }) {
    if (!window.confirm(`Mark ${row.name} as Returned Home?`)) return;
    this.loading = true;
    this.api.returnResidentHome(row.id, new Date().toISOString()).pipe(finalize(() => this.finishLoading())).subscribe({
      next: ({ message }) => {
        this.successMessage = message;
        this.loadResource();
        this.loadEvacuationCenters();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'Resident could not be checked out.'
    });
  }

  private localDateTimeValue(date: Date) {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  changePage(next: number) {
    if (next < 1 || next > this.totalPages) return;
    this.page = next;
    this.loadResource();
  }

  sortColumn(field: string) {
    const apiField = this.currentResource === 'households' && field === 'household_number' ? 'household_sort_key' : field;
    if (this.sortBy === apiField) this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    else {
      this.sortBy = apiField;
      this.sortOrder = 'asc';
    }
    this.page = 1;
    if (this.currentResource === 'statistics') {
      const direction = this.sortOrder === 'asc' ? 1 : -1;
      this.tableRows = [...this.tableRows].sort((left, right) =>
        String((left as Record<string, unknown>)[field] ?? '').localeCompare(String((right as Record<string, unknown>)[field] ?? '')) * direction
      );
      return;
    }
    this.loadResource();
  }

  sortIndicator(field: string) {
    const apiField = this.currentResource === 'households' && field === 'household_number' ? 'household_sort_key' : field;
    return this.sortBy === apiField ? (this.sortOrder === 'asc' ? '↑' : '↓') : '↕';
  }

  updateResidentAge(dateOfBirth: string) {
    if (!dateOfBirth) {
      this.editorValues['age'] = '';
      return;
    }
    const birthDate = new Date(`${dateOfBirth}T00:00:00`);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const birthdayPassed = today.getMonth() > birthDate.getMonth()
      || (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
    if (!birthdayPassed) age--;
    this.editorValues['age'] = age >= 0 ? age : '';
  }

  private dateInputValue(value: unknown) {
    if (!value) return '';
    const text = String(value);
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? '';
  }

  openEditor(row?: { id: string }) {
    if (this.activePage === 'residents' && this.isHistoricalResidentYear) return;
    this.editorTrigger = document.activeElement as HTMLElement | null;
    this.editorStep = 0;
    this.editorStepsExpanded = false;
    this.editorReview = [];
    this.editorDirty = false;
    this.discardEditorPrompt = false;
    this.clearAdminReportPhotos();
    this.householdLookupOpen = false;
    this.householdLookupQuery = '';
    this.editorId = row?.id ?? '';
    this.editorDraft=readDraft(this.editorDraftKey);this.editorDraftPending=!!this.editorDraft;this.editorDraftSaved=false;this.editorDraftError='';this.editorDetailsLoading=false;
    this.reportReviewReady=false;this.reportReviewOptions=[];this.reportReviews=[];this.editorReportStatus='';
    const record = row ? this.rawRecords.get(row.id) : undefined;
    this.editorOutcome=this.currentResource==='residents'?recordedResidentOutcome(record?.['outcome']):'';
    this.editorValues = {};
    this.fieldErrors = {};
    this.existingBarangayZones = this.currentResource === 'barangay-zones'
      ? [...this.rawRecords.values()]
      : [];
    if (!record && this.currentResource === 'barangay-zones') this.editorValues['zoneColor'] = '#1764C1';
    if (!record && this.currentResource === 'emergency-contacts') {
      this.editorValues['isPublic'] = true;
      this.editorValues['status'] = 'Active';
    }
    if (record) {
      for (const field of this.editorFields) {
        const snake = field.name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        const value = record[field.name] ?? record[snake] ?? '';
        this.editorValues[field.name] = field.type === 'date' ? this.dateInputValue(value) : value;
      }
      if (this.activePage === 'residents') this.updateResidentAge(String(this.editorValues['dateOfBirth'] ?? ''));
      this.editorValues['isActive'] = Boolean(record['is_active'] ?? record['isActive']);
      this.editorValues['isPublic'] = Boolean(record['is_public'] ?? record['isPublic']);
      this.editorValues['latitude'] = record['latitude'] ?? '';
      this.editorValues['longitude'] = record['longitude'] ?? '';
      const routeGeoJson = record['route_geojson'] ?? record['routeGeoJson'];
      if (routeGeoJson && typeof routeGeoJson === 'object') this.editorValues['routeGeoJson'] = JSON.stringify(routeGeoJson, null, 2);
      this.editorValues['incidentType'] = record['incident_type'] ?? record['incidentType'] ?? '';
      this.editorValues['severityLevel'] = record['severity_level'] ?? record['severityLevel'] ?? 'Information';
      this.editorValues['locationText'] = this.displayLocation(record['location_text'] ?? record['locationText']);
      this.editorValues['description'] = record['description'] ?? '';
      this.editorValues['status'] = record['status'] ?? '';
      this.editorValues['vulnerabilityOther'] = record['vulnerability_other'] ?? record['vulnerabilityOther'] ?? '';
      this.editorValues['relationshipOther'] = record['relationship_other'] ?? record['relationshipOther'] ?? '';
    }
    this.editorOpen = true;
    this.changeDetector.detectChanges();
    document.querySelector<HTMLButtonElement>('#record-editor .modal-close')?.focus();
    this.errorMessage = '';
    this.successMessage = '';
    if (this.activePage === 'residents') this.loadHouseholdOptions();
    if (this.editorFields.some((field) => ['zoneId', 'zoneIds', 'assignedZoneId', 'originZoneId'].includes(field.name))) this.loadZoneOptions();
    if (this.editorFields.some((field) => ['destinationShelterId', 'evacuationShelterId'].includes(field.name))) this.loadShelterOptions();
    if (this.activePage === 'reports' && this.editorId) {
      this.editorDetailsLoading=true;
      this.loadAdminReportPhotos(this.editorId, record?.['photo_urls'] ?? record?.['photoUrls']);
      this.api.get<FloodReportDetails>('flood-reports', this.editorId).subscribe({
        next: (report) => {
          if (!this.editorOpen || this.editorId!==row?.id) return;
          this.editorReportStatus=String(report['status']);
          this.editorValues['severityLevel']=report['severity_level'];
          this.reportReviewOptions=report.allowed_statuses.map(status=>({value:status,label:status}));
          this.reportReviews=report.reviews;
          this.editorValues['validationNotes']=report['validation_notes'] ?? '';
          this.editorValues['status']=this.reportReviewOptions.some(option=>option.value===this.editorReportStatus)?this.editorReportStatus:this.reportReviewOptions[0]?.value ?? '';
          this.reportReviewReady=true;
          this.editorDetailsLoading=false;
          const assigned = report['affected_zone_ids'];
          let zoneIds: unknown[] = [];
          try { zoneIds = Array.isArray(assigned) ? assigned : typeof assigned === 'string' ? JSON.parse(assigned) : []; }
          catch { zoneIds = []; }
          this.editorValues['zoneIds'] = zoneIds.filter(Boolean).map(String);
          this.changeDetector.detectChanges();
        },
        error: (error) => {this.editorDetailsLoading=false;this.errorMessage = error?.error?.message ?? 'Report details could not be loaded.';}
      });
    }
    if (this.currentResource === 'notifications' && this.editorId) {
      this.editorDetailsLoading=true;
      this.api.get<Record<string, unknown>>('notifications', this.editorId).subscribe({
        next: (notification) => {
          if (!this.editorOpen || this.editorId !== row?.id) return;
          for (const field of this.editorFields) {
            const snake = field.name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
            if (field.name === 'zoneIds') continue;
            this.editorValues[field.name] = notification[field.name] ?? notification[snake] ?? '';
          }
          this.editorValues['zoneIds'] = (notification['zone_ids'] as unknown[] ?? []).map(String);
          this.editorValues['status'] = notification['status'] ?? '';
          this.editorDetailsLoading=false;
          this.changeDetector.detectChanges();
        },
        error: (error) => {this.editorDetailsLoading=false;this.errorMessage = error?.error?.message ?? 'Notification details could not be loaded.';}
      });
    }
  }

  openHouseholdLookup() {
    this.householdLookupQuery = '';
    this.householdLookupOpen = true;
  }

  selectHousehold(option: EditorOption) {
    this.editorDirty = true;
    this.editorValues['householdId'] = option.value;
    this.householdLookupOpen = false;
    this.householdLookupQuery = '';
    this.changeDetector.detectChanges();this.saveEditorDraft();
  }

  focusMapRecord(row: { id: string }) {
    const record = this.rawRecords.get(row.id);
    if (!record) return;
    if(this.activePage==='evacuation')this.centerMapOpen=true;
    if (this.currentResource === 'barangay-zones') this.selectedZoneId = row.id;
    this.selectedMapFocus = {
      id: row.id,
      resource: this.currentResource,
      record,
      nonce: Date.now()
    };
    if (this.currentResource === 'flood-reports') this.openPublicIncident(record);
  }

  deleteEmergencyHotline(id: string) {
    if (this.currentResource !== 'emergency-contacts' || !this.canManageCurrentResource || this.loading) return;
    const record = this.rawRecords.get(id);
    if (!record) return;
    if (!window.confirm(`Delete ${record['organization_name']}? This also removes the hotline from the public emergency contacts.`)) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.loading = true;
    this.api.delete('emergency-contacts', id).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        if (this.editorOpen && this.editorId === id) this.closeEditor();
        this.successMessage = 'Emergency hotline deleted successfully.';
        this.loadResource();
        this.loadPublicData();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'The emergency hotline could not be deleted.'
    });
  }

  deleteEvacuationRecord(id: string) {
    if (this.activePage !== 'evacuation' || !id || !this.canManageCurrentResource || this.loading) return;
    const record = this.rawRecords.get(id);
    const labels: Record<string, string> = {
      shelters: 'shelter',
      volunteers: 'volunteer',
      'evacuation-routes': 'evacuation route',
      'emergency-contacts': 'emergency contact'
    };
    const label = labels[this.currentResource] ?? 'record';
    const name = String(record?.['shelter_name'] ?? record?.['full_name'] ?? record?.['route_name'] ?? `this ${label}`);
    const warning = this.currentResource === 'shelters'
      ? ' Assigned residents will be returned to the For Evacuation list, and routes ending at this center will be removed.'
      : '';
    if (!window.confirm(`Delete ${name}?${warning} This action cannot be undone.`)) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.loading = true;
    this.api.delete(this.currentResource, id).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.selectedMapFocus = undefined;
        this.mapRefreshNonce++;
        if (this.editorOpen && this.editorId === id) this.closeEditor();
        this.successMessage = `${label[0]!.toUpperCase()}${label.slice(1)} deleted successfully.`;
        this.loadResource();
        if (this.currentResource === 'shelters') this.loadEvacuationCenters();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? `The ${label} could not be deleted.`
    });
  }

  deleteSelectedResident(row?: { id: string; name: string }) {
    const residentId = row?.id ?? this.editorId;
    if (this.activePage !== 'residents' || this.isHistoricalResidentYear || !this.canManageCurrentResource || !residentId || this.loading) return;
    const name = row?.name ?? String(this.editorValues['fullName'] ?? 'this resident');
    if (!window.confirm(`Delete ${name}? This action cannot be undone.`)) return;
    this.loading = true;
    this.api.delete('residents', residentId).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        if (this.editorOpen && this.editorId === residentId) this.closeEditor();
        this.successMessage = 'Resident deleted successfully.';
        this.loadResource();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'The resident could not be deleted.'
    });
  }

  deleteCommunityRecord(row: { id: string; name: string }) {
    if (!row.id || !['residents', 'households'].includes(this.currentResource) || !this.canManageCurrentResource || this.loading) return;
    const label = this.currentResource === 'residents' ? 'resident' : 'household';
    const householdWarning = this.currentResource === 'households' ? ' A household with resident records cannot be deleted.' : '';
    if (!window.confirm(`Delete ${label} ${row.name}?${householdWarning} This action cannot be undone.`)) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.loading = true;
    this.api.delete(this.currentResource, row.id).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.successMessage = `${label[0]!.toUpperCase()}${label.slice(1)} deleted successfully.`;
        this.loadResource();
        if (this.currentResource === 'households') this.loadHouseholdOptions();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? `The ${label} could not be deleted.`
    });
  }

  private loadHouseholdOptions() {
    this.api.list<Record<string, unknown>>('households', 1, 100, '', 'household_number', 'asc').subscribe({
      next: ({ items, totalPages }) => {
        if (totalPages <= 1) {
          this.setHouseholdOptions(items);
          return;
        }
        const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) =>
          this.api.list<Record<string, unknown>>('households', index + 2, 100, '', 'household_number', 'asc')
        );
        forkJoin(remainingPages).subscribe({
          next: (pages) => this.setHouseholdOptions([items, ...pages.map((page) => page.items)].flat()),
          error: () => this.errorMessage = 'The complete household list could not be loaded. Please try again.'
        });
      },
      error: () => this.errorMessage = 'Households could not be loaded. Add or verify a household before creating a resident.'
    });
  }

  private setHouseholdOptions(households: Record<string, unknown>[]) {
    this.householdOptions = households.map((household) => ({
      value: String(household['household_id']),
      label: `${household['household_number']} — ${household['head_of_household_name']}`
    }));
  }

  private loadZoneOptions() {
    this.loadAllOptions('barangay-zones', 'zone_name', (zone) => ({
      value: String(zone['zone_id']),
      label: String(zone['zone_name'])
    }), (values) => this.zoneOptions = values, 'Zones');
  }

  private loadShelterOptions() {
    this.loadAllOptions('shelters', 'shelter_name', (shelter) => ({
      value: String(shelter['shelter_id']),
      label: `${shelter['shelter_name']} — ${shelter['status']}`
    }), (values) => this.shelterOptions = values, 'Shelters');
  }

  private loadAllOptions(
    resource: string,
    sortBy: string,
    mapOption: (record: Record<string, unknown>) => EditorOption,
    assign: (values: EditorOption[]) => void,
    label: string
  ) {
    this.api.list<Record<string, unknown>>(resource, 1, 100, '', sortBy, 'asc').subscribe({
      next: ({ items, totalPages }) => {
        if (totalPages <= 1) {
          assign(items.map(mapOption));
          return;
        }
        const remaining = Array.from({ length: totalPages - 1 }, (_, index) =>
          this.api.list<Record<string, unknown>>(resource, index + 2, 100, '', sortBy, 'asc')
        );
        forkJoin(remaining).subscribe({
          next: (pages) => assign([items, ...pages.map((page) => page.items)].flat().map(mapOption)),
          error: () => this.errorMessage = `${label} could not be fully loaded. Please try again.`
        });
      },
      error: () => this.errorMessage = `${label} could not be loaded. Create the required record first.`
    });
  }

  saveEditor(event: Event) {
    this.saveEditorDraft();
    event.preventDefault();
    if (this.activePage==='reports' && this.editorId && !this.reportReviewReady) {
      this.errorMessage='Wait for the report details to load before saving a review.';return;
    }
    this.errorMessage = '';
    this.successMessage = '';
    const form = event.currentTarget as HTMLFormElement;
    if (this.editorIsWizard) {
      if (this.editorStep < this.editorSections.length) { this.changeEditorStep(this.editorStep + 1); return; }
      for (let step = 0; step < this.editorSections.length; step++) if (!this.validateEditorStep(form, step)) return;
    }
    this.fieldErrors = {};
    const formData = new FormData(form);
    const raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;
    for (const field of this.editorFields) {
      if (typeof raw[field.name] === 'string') raw[field.name] = String(raw[field.name]).trim();
      if (field.required && !['location', 'polygon', 'household-lookup', 'multiselect'].includes(field.type ?? '') && !raw[field.name]) {
        this.fieldErrors[field.name] = `${field.label} is required.`;
      }
      if (field.type === 'email' && raw[field.name] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw[field.name]))) {
        this.fieldErrors[field.name] = 'Enter a valid email address.';
      }
      if (field.type === 'tel' && raw[field.name] && !validPhilippineContactNumber(raw[field.name])) {
        this.fieldErrors[field.name] = 'Enter a valid Philippine mobile or landline number.';
      }
      if (field.type === 'number' && raw[field.name] !== '' && (!Number.isFinite(Number(raw[field.name])) || Number(raw[field.name]) < 0)) {
        this.fieldErrors[field.name] = `${field.label} must be zero or greater.`;
      }
      if (field.type === 'password' && raw[field.name] && (String(raw[field.name]).length < 12 || !/[A-Z]/.test(String(raw[field.name])) || !/[a-z]/.test(String(raw[field.name])) || !/\d/.test(String(raw[field.name])))) {
        this.fieldErrors[field.name] = 'Use at least 12 characters with uppercase, lowercase, and a number.';
      }
    }
    if (raw['dateOfBirth'] && new Date(String(raw['dateOfBirth'])) > new Date()) this.fieldErrors['dateOfBirth'] = 'Date of birth cannot be in the future.';
    if (raw['vulnerabilityType'] === 'Other' && !String(raw['vulnerabilityOther'] ?? '').trim()) this.fieldErrors['vulnerabilityType'] = 'Specify the other vulnerability.';
    if (raw['relationshipToHead'] === 'Other' && !String(raw['relationshipOther'] ?? '').trim()) this.fieldErrors['relationshipToHead'] = 'Specify the relationship to the household head.';
    if (Object.keys(this.fieldErrors).length) {
      this.focusEditorField(form, Object.keys(this.fieldErrors)[0]!);
      return;
    }
    if (this.currentResource === 'notifications') {
      const notification = this.notificationPayload(form);
      if (!notification) return;
      Object.assign(raw, notification);
    }
    if (this.activePage === 'reports' && !this.editorId) {
      const photos = formData.getAll('photos').filter((value): value is File => value instanceof File && value.size > 0);
      if (photos.length > 5) {
        this.errorMessage = 'You can attach a maximum of 5 photos.';
        return;
      }
      if (photos.some((photo) => !['image/jpeg', 'image/png'].includes(photo.type) || photo.size > 5 * 1024 * 1024)) {
        this.errorMessage = 'Each photo must be a JPEG or PNG file no larger than 5 MB.';
        return;
      }
    }
    if (this.editorFields.some((field) => field.type === 'household-lookup')) {
      raw['householdId'] = this.editorValue('householdId');
      if (!raw['householdId']) {
        this.errorMessage = 'Select a household for this resident.';
        return;
      }
    }
    for (const field of this.editorFields) if (field.type === 'multiselect') raw[field.name] = formData.getAll(field.name).map(String);
    if (this.editorFields.some((field) => field.type === 'location') && (!raw['latitude'] || !raw['longitude'])) {
      this.errorMessage = `Pin the ${this.activePage === 'reports' ? 'flood incident' : 'shelter'} location on the map.`;
      return;
    }
    if (raw['latitude'] !== undefined) raw['latitude'] = Number(raw['latitude']);
    if (raw['longitude'] !== undefined) raw['longitude'] = Number(raw['longitude']);
    for (const field of this.editorFields) {
      if (field.type === 'number' && raw[field.name] !== '') raw[field.name] = Number(raw[field.name]);
    }
    if (typeof raw['zoneIds'] === 'string') raw['zoneIds'] = raw['zoneIds'].split(',').map((value) => value.trim()).filter(Boolean);
    for (const jsonField of ['polygonGeoJson', 'routeGeoJson']) if (typeof raw[jsonField] === 'string') {
      if (jsonField === 'polygonGeoJson' && !raw[jsonField]) {
        this.errorMessage = 'Draw a boundary with at least three points on the map.';
        return;
      }
      try { raw[jsonField] = JSON.parse(String(raw[jsonField])); }
      catch { this.errorMessage = jsonField === 'polygonGeoJson' ? 'Draw a valid polygon boundary on the map.' : 'Route GeoJSON must be valid JSON.'; return; }
    }
    if (typeof raw['isPublic'] === 'string') raw['isPublic'] = raw['isPublic'].toLowerCase() === 'true';
    if (this.currentResource === 'residents' && raw['evacuationStatus'] === 'Evacuated' && !raw['evacuationShelterId']) {
      this.errorMessage = 'Select the evacuation center where the resident is staying.';
      return;
    }
    const resources: Partial<Record<PageId, string>> = { users: 'users', residents: 'residents', households: 'households', map: this.currentResource || 'barangay-zones', evacuation: this.currentResource || 'shelters', notifications: this.currentResource || 'notifications' };
    this.loading = true;
    const request = this.activePage === 'reports' && !this.editorId
      ? this.api.submitFloodReport(formData)
      : this.activePage === 'reports'
      ? this.api.updateReportStatus(this.editorId, { ...raw, expectedStatus:this.editorReportStatus } as { expectedStatus:string; status: string; severityLevel: string; validationNotes?: string; zoneIds: string[] })
      : this.editorId
        ? this.api.update(resources[this.activePage]!, this.editorId, raw)
        : this.api.create(resources[this.activePage]!, raw);
    request.pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        const operation = this.editorId ? 'updated' : 'created';
        const savedResource = this.activePage;
        this.closeEditor();
        this.loadResource();
        if (this.activePage === 'evacuation') this.loadEvacuationCenters();
        if (this.currentResource === 'emergency-contacts') this.loadPublicData();
        this.successMessage = savedResource === 'residents'
          ? `Resident information ${operation} successfully saved.`
          : `Record ${operation} successfully.`;
        if (this.successMessageTimer) window.clearTimeout(this.successMessageTimer);
        this.successMessageTimer = window.setTimeout(() => {
          this.successMessage = '';
          this.changeDetector.detectChanges();
        }, 4_000);
        if (this.activePage === 'reports') this.refreshPendingReportCount();
      },
      error: (error) => this.handleEditorError(error, form, 'The record could not be saved.')
    });
  }

  deleteFloodReport(reportId: string) {
    if (this.activePage !== 'reports' || !reportId || this.api.user()?.role !== 'Super Admin' || this.loading) return;
    const trackingCode = String(this.rawRecords.get(reportId)?.['tracking_code'] ?? reportId);
    if (!window.confirm(`Permanently delete flood report ${trackingCode}? It will disappear from reports and maps. Linked advisories will remain.`)) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.loading = true;
    this.api.delete('flood-reports', reportId).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.selectedMapFocus = undefined;
        this.selectedPublicIncident = undefined;
        this.mapRefreshNonce++;
        if (this.editorOpen && this.editorId === reportId) this.closeEditor();
        this.successMessage = 'Flood report deleted successfully.';
        this.loadResource();
        this.loadPublicData();
        this.refreshPendingReportCount();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'The flood report could not be deleted.'
    });
  }

  private notificationPayload(form: HTMLFormElement): Record<string, unknown> | null {
    const values = new FormData(form);
    const payload = {
      title: String(values.get('title') ?? '').trim(),
      message: String(values.get('message') ?? '').trim(),
      type: String(values.get('type') ?? ''),
      severityLevel: String(values.get('severityLevel') ?? ''),
      targetAudience: String(values.get('targetAudience') ?? ''),
      zoneIds: values.getAll('zoneIds').map(String)
    };
    this.fieldErrors = {};
    for (const [name, label] of [['title', 'Title'], ['message', 'Message'], ['type', 'Type'], ['severityLevel', 'Severity'], ['targetAudience', 'Target audience']]) {
      if (!payload[name as keyof typeof payload]) this.fieldErrors[name] = `${label} is required.`;
    }
    if (payload.targetAudience === 'Affected Zones' && !payload.zoneIds.length) this.fieldErrors['zoneIds'] = 'Select at least one affected zone.';
    if (Object.keys(this.fieldErrors).length) {
      this.focusEditorField(form, Object.keys(this.fieldErrors)[0]!);
      return null;
    }
    if (payload.targetAudience !== 'Affected Zones') payload.zoneIds = [];
    return payload;
  }

  private focusEditorField(form: HTMLFormElement, name: string) {
    const step = this.editorSections.findIndex(section => section.fields.some(field => field.name === name));
    if (this.editorIsWizard && step >= 0) { this.editorStep = step; this.changeDetector.detectChanges(); }
    window.requestAnimationFrame(() => (form.elements.namedItem(name) as HTMLElement | null)?.focus());
  }

  private handleEditorError(error: any, form: HTMLFormElement, fallback: string) {
    const fields = error?.error?.fieldErrors;
    if (fields && typeof fields === 'object' && Object.keys(fields).length) {
      this.fieldErrors = fields as Record<string, string>;
      this.focusEditorField(form, Object.keys(this.fieldErrors)[0]!);
    } else {
      this.errorMessage = error?.error?.message ?? fallback;
    }
  }

  private refreshPendingReportCount() {
    const role = this.api.user()?.role;
    if (role !== 'Super Admin' && role !== 'Disaster Officer') {
      this.pendingReportCount = 0;
      return;
    }
    this.api.pendingFloodReportCount().subscribe({
      next: ({ pendingCount }) => {
        this.pendingReportCount = pendingCount;
        this.changeDetector.detectChanges();
      },
      error: () => this.pendingReportCount = 0
    });
  }

  closeEditor(clearDraft=true) {
    if(clearDraft)this.discardBrowserDraft();
    this.clearAdminReportPhotos();
    this.householdLookupOpen = false;
    this.householdLookupQuery = '';
    this.editorOpen = false;
    this.editorDirty = false;
    this.discardEditorPrompt = false;
    this.editorId = '';
    this.editorValues = {};
    this.fieldErrors = {};
    this.errorMessage = '';
    this.changeDetector.detectChanges();
    this.editorTrigger?.focus();
  }

  reportPhotoCount(report: Record<string, unknown>) {
    const photos = report['photo_urls'] ?? report['photoUrls'];
    try {
      const values = Array.isArray(photos) ? photos : typeof photos === 'string' ? JSON.parse(photos) : [];
      return Array.isArray(values) ? values.length : 0;
    } catch {
      return 0;
    }
  }

  publicReportPhotoUrl(reportId: unknown, index: number) {
    return this.api.publicReportPhotoUrl(reportId, index);
  }

  reportPhotoIndexes(report: Record<string, unknown>) {
    return Array.from({ length: this.reportPhotoCount(report) }, (_, index) => index);
  }

  reportTableRecord(row: { id: string }) {
    return this.rawRecords.get(row.id) ?? {};
  }

  reportFloodLevel(row: { id: string }) {
    const severity = String(this.reportTableRecord(row)['severity_level'] ?? 'Information');
    return severity === 'Major Incident' ? 'High' : severity === 'Minor Incident' ? 'Medium' : 'Low';
  }

  reportFloodLevelClass(row: { id: string }) {
    return this.reportFloodLevel(row).toLowerCase();
  }

  reportStatusLabel(row: { id: string }) {
    const status = String(this.reportTableRecord(row)['status'] ?? 'Submitted');
    return status;
  }

  reportStatusClass(row: { id: string }) {
    return String(this.reportTableRecord(row)['status'] ?? 'Submitted').toLowerCase().replace(/\s+/g, '-');
  }

  reportLocation(row: { id: string }) {
    return this.displayLocation(this.reportTableRecord(row)['location_text'] ?? 'Location not provided');
  }

  displayLocation(value: unknown) {
    const text = String(value ?? '').replace(/\s*\(-?\d{1,2}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?\)/g, '').trim();
    return text || 'Pinned map location';
  }

  reportCreatedTime(row: { id: string }) {
    const value = this.reportTableRecord(row)['created_at'];
    if (!value) return '—';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
  }

  private loadAdminReportPhotos(reportId: string, photos: unknown) {
    let count = 0;
    try {
      const values = Array.isArray(photos) ? photos : typeof photos === 'string' ? JSON.parse(photos) : [];
      count = Array.isArray(values) ? values.length : 0;
    } catch {
      count = 0;
    }
    if (!count) return;
    forkJoin(Array.from({ length: count }, (_, index) => this.api.reportPhoto(reportId, index).pipe(catchError(() => of(null))))).subscribe({
      next: (blobs) => {
        this.clearAdminReportPhotos();
        this.adminReportPhotoUrls = blobs.filter((blob): blob is Blob => blob instanceof Blob).map((blob) => URL.createObjectURL(blob));
        this.changeDetector.detectChanges();
      }
    });
  }

  private clearAdminReportPhotos() {
    for (const url of this.adminReportPhotoUrls) URL.revokeObjectURL(url);
    this.adminReportPhotoUrls = [];
  }

  private finishLoading() {
    this.loading = false;
    this.changeDetector.detectChanges();
  }

  private finishLoginLoading() {
    this.loginLoading = false;
    this.changeDetector.detectChanges();
  }

  deleteZone(id: string) {
    if (!id || !['barangay-zones', 'risk-zones'].includes(this.currentResource) || this.api.user()?.role !== 'Super Admin' || this.loading) return;
    const isRiskZone = this.currentResource === 'risk-zones';
    const record = this.rawRecords.get(id);
    const zoneName = String(record?.[isRiskZone ? 'risk_zone_name' : 'zone_name'] ?? `this ${isRiskZone ? 'risk' : 'barangay'} zone`);
    const warning = isRiskZone ? '' : ' Linked report and notification tags will be removed. Evacuation routes beginning in this zone will also be removed.';
    if (!window.confirm(`Delete ${zoneName}?${warning} This cannot be undone.`)) return;
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.api.delete(this.currentResource, id).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.selectedMapFocus = undefined;
        this.mapRefreshNonce++;
        if (this.editorOpen && this.editorId === id) this.closeEditor();
        this.successMessage = `${isRiskZone ? 'Risk' : 'Barangay'} zone deleted successfully.`;
        this.loadResource();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message ?? 'The barangay zone could not be deleted.';
        window.alert(this.errorMessage);
      }
    });
  }

  notificationAction(action: 'send' | 'archive') {
    if (!this.editorId) return;
    const form = document.querySelector<HTMLFormElement>('.editor-modal form');
    if (!form) return;
    this.errorMessage = '';
    this.successMessage = '';
    const payload = action === 'send' ? this.notificationPayload(form) : null;
    if (action === 'send' && !payload) return;
    this.loading = true;
    const request = action === 'send'
      ? this.api.update('notifications', this.editorId, payload!).pipe(switchMap(() => this.api.sendNotification(this.editorId)))
      : this.api.archiveNotification(this.editorId);
    request.pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.closeEditor();
        this.successMessage = `Notification ${action === 'send' ? 'sent' : 'archived'} successfully.`;
        this.setPage('notifications');
      },
      error: (error) => this.handleEditorError(error, form, `Notification could not be ${action === 'send' ? 'sent' : 'archived'}.`)
    });
  }

  setNotificationRead(isRead: boolean) {
    this.errorMessage = '';
    this.successMessage = '';
    this.loading = true;
    this.api.setNotificationRead(this.editorId, isRead).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => this.successMessage = isRead ? 'Notification marked as read.' : 'Notification marked as unread.',
      error: (error) => this.errorMessage = error?.error?.message ?? 'Read status could not be updated.'
    });
  }

  setSelectedUserActive(isActive: boolean) {
    this.errorMessage = '';
    this.successMessage = '';
    this.loading = true;
    this.api.setUserActive(this.editorId, isActive).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.closeEditor();
        this.successMessage = `Account ${isActive ? 'activated' : 'deactivated'} successfully.`;
        this.setPage('users');
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'Account status could not be changed.'
    });
  }

  resetSelectedUserPassword() {
    this.errorMessage = '';
    this.successMessage = '';
    this.loading = true;
    this.api.initiateUserPasswordReset(this.editorId).pipe(finalize(() => this.finishLoading())).subscribe({
      next: ({ message }) => this.successMessage = message,
      error: (error) => this.errorMessage = error?.error?.message ?? 'Password reset could not be initiated.'
    });
  }

  generateSelectedUserTemporaryPassword() {
    if (!this.editorId || this.loading) return;
    this.errorMessage = '';
    this.temporaryPassword = '';
    this.loading = true;
    this.api.generateTemporaryPassword(this.editorId).pipe(finalize(() => this.finishLoading())).subscribe({
      next: ({ temporaryPassword }) => { this.temporaryPassword = temporaryPassword; },
      error: (error) => this.errorMessage = error?.error?.message ?? 'Temporary password could not be generated.'
    });
  }

  private mapReport(row: Record<string, unknown>) {
    const severity = String(row['severity_level'] ?? row['severityLevel'] ?? 'Information');
    const status = String(row['status'] ?? 'Submitted');
    return {
      code: String(row['tracking_code'] ?? row['trackingCode'] ?? ''),
      location: this.displayLocation(row['location_text'] ?? row['locationText']),
      description: String(row['description'] ?? ''),
      status,
      statusClass: status === 'Validated' ? 'validated' : status === 'Under Review' ? 'review' : 'submitted',
      level: severity === 'Major Incident' ? 'major' : severity === 'Minor Incident' ? 'minor' : 'info',
      icon: severity === 'Major Incident' ? '!' : severity === 'Minor Incident' ? '≈' : 'i',
      time: this.formatDate(row['created_at'] ?? row['createdAt'])
    };
  }

  householdMemberCount(row: {id:string}) {
    return dashboardCount(this.rawRecords.get(row.id)?.['member_count']);
  }

  private mapTableRow(row: Record<string, unknown>, index: number) {
    const values = Object.values(row).filter((value) => value !== null && typeof value !== 'object');
    return {
      name: String(row['full_name'] ?? row['risk_zone_name'] ?? row['zone_name'] ?? row['household_number'] ?? row['title'] ?? row['shelter_name'] ?? row['route_name'] ?? row['organization_name'] ?? values[1] ?? `Record ${index + 1}`),
      id: String(
        row['user_id']
        ?? row['resident_id']
        ?? row['report_id']
        ?? row['household_id']
        ?? row['shelter_id']
        ?? row['volunteer_id']
        ?? row['route_id']
        ?? row['emergency_contact_id']
        ?? row['notification_id']
        ?? row['risk_zone_id']
        ?? row['zone_id']
        ?? values[0]
        ?? ''
      ),
      detail: row['report_id']
        ? `${String(row['incident_type'] ?? 'Other')} · ${this.displayLocation(row['location_text'])}`
        : row['shelter_id']
          ? `${row['resident_occupancy'] ?? row['current_occupancy'] ?? 0}/${row['capacity'] ?? 0} residents · ${this.displayLocation(row['location_text'])}`
          : row['volunteer_id']
            ? String((row['responder_type'] ?? 'Volunteer') + ' · ' + (row['contact_number'] || 'No contact number recorded'))
            : row['route_id']
              ? String(row['description'] ?? `Shelter: ${row['destination_shelter_id'] ?? ''}`)
              : row['emergency_contact_id']
                ? String(row['phone_number'] ?? row['email'] ?? '')
                : row['resident_id']
                  ? `${row['household_number'] ?? 'No household'} · ${row['zone_name'] ?? 'No zone'} · ${row['household_address'] ?? row['address_line'] ?? 'No address'}`
                  : String(row['email'] ?? row['address_line'] ?? row['message'] ?? (row['location_text'] ? this.displayLocation(row['location_text']) : values[2]) ?? ''),
      priorityReason: row['resident_id'] ? this.residentPriorityReason(row, true) : '',
      vulnerabilityReason: row['resident_id'] ? this.residentPriorityReason(row, false) : '',
      status: String(['Missing','Deceased'].includes(String(row['outcome'])) ? row['outcome'] : row['record_status'] ?? row['verification_status'] ?? row['availability_status'] ?? row['status'] ?? row['risk_level'] ?? row['role'] ?? (row['is_active'] ? 'Active' : 'Inactive')),
      updated: this.formatDate(row['source_updated_at'] ?? row['updated_at'] ?? row['source_created_at'] ?? row['created_at'])
    };
  }

  private residentPriorityReason(row: Record<string, unknown>, includeAssistanceFactors: boolean) {
    const reasons = new Set<string>();
    const age = Number(row['age']);
    const meaningful = (value: unknown) => {
      const text = String(value ?? '').trim();
      return text && !['NO', 'N/A', 'NONE'].includes(text.toUpperCase()) ? text : '';
    };
    if (Number.isFinite(age) && age >= 60) reasons.add('Senior citizen');
    if (Number.isFinite(age) && age < 18) reasons.add('Child');
    const vulnerability = meaningful(row['vulnerability_type']);
    if (vulnerability) reasons.add(vulnerability === 'Elderly' ? 'Senior citizen' : vulnerability);
    const vulnerabilityOther = meaningful(row['vulnerability_other']);
    if (vulnerabilityOther) reasons.add(vulnerabilityOther);
    const disability = meaningful(row['pwd_specify']);
    if (disability) reasons.add(`Disability: ${disability}`);
    const morbidity = meaningful(row['morbidity']);
    if (morbidity) reasons.add(`Morbidity: ${morbidity}`);
    if (includeAssistanceFactors && String(row['can_swim'] ?? '').trim().toLowerCase() === 'no') reasons.add('Cannot swim');
    if (includeAssistanceFactors && String(row['house_type'] ?? '').trim().toLowerCase() === 'light materials') reasons.add('Light-material house');
    return reasons.size ? [...reasons].join(' · ') : includeAssistanceFactors ? 'Manually marked High priority' : 'Recorded as vulnerable';
  }

  private formatDate(value: unknown) {
    if (!value) return '—';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
}
