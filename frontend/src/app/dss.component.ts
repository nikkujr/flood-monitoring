import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, Subscription, catchError, combineLatest, finalize, forkJoin, map, of, switchMap, timer, type Observable } from 'rxjs';
import { ApiService, type ZoneStatusPreview } from './api.service';
import type { DssData } from './dss.models';
import { searchResidents } from './admin-ui';
import { buildEvacuationPlan } from './evacuation-plan';
import {RescueComponent} from './rescue.component';
import type {ResponseView} from './rescue.models';

const emptyFilters = (): Record<string,string> => ({
  zone:'', risk:'', from:'', to:'', severity:'', evacuationStatus:'', vulnerability:''
});
const philippineDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});

@Component({selector:'app-dss',standalone:true,imports:[FormsModule,DatePipe,RescueComponent],templateUrl:'./dss.component.html',styleUrl:'./dss.component.scss'})
export class DssComponent implements OnInit, OnDestroy {
  @Output() navigate = new EventEmitter<{ page: string; resource?: string; filters?: Record<string, string> }>();
  @Input() initialTab: 'overview'|'zones'|'reports'|'evacuation'|'methodology' = 'reports';
  @Input() mode: 'dss'|'statistics'|'planner'|'assistance' = 'dss';
  private readonly api = inject(ApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly refresh = new BehaviorSubject(0);
  private subscription?: Subscription;
  private bulkPreviewSubscription?: Subscription;
  data: DssData | null = null;
  reportData: DssData | null = null;
  reportFilterLabels: string[] = [];
  loading = true;
  error = '';
  bulkZoneId = '';
  bulkZoneName = '';
  bulkViewOnly = false;
  bulkStatus = 'For Evacuation';
  bulkPreview: ZoneStatusPreview | null = null;
  bulkLoading = false;
  bulkSaving = false;
  bulkError = '';
  bulkSuccess = '';
  bulkSelectedIds = new Set<string>();
  bulkSearch = '';
  readonly bulkStatuses = ['Safe', 'For Monitoring', 'For Evacuation'];
  get canMarkResidents() { return ['Super Admin', 'Disaster Officer', 'Data Encoder'].includes(this.api.user()?.role ?? ''); }
  get bulkEligibleResidents() { return this.bulkPreview?.residents.filter(r => r.recordStatus === 'Active' && r.status !== 'Evacuated' && !['Missing','Deceased'].includes(r.outcome??'')) ?? []; }
  get bulkVisibleResidents() { return searchResidents(this.bulkPreview?.residents ?? [], this.bulkSearch); }
  get bulkVisibleEligibleResidents() { return this.bulkVisibleResidents.filter(r => r.recordStatus === 'Active' && r.status !== 'Evacuated' && !['Missing','Deceased'].includes(r.outcome??'')); }
  get bulkVisibleSelectedCount() { return this.bulkVisibleEligibleResidents.filter(r => this.bulkSelectedIds.has(r.id)).length; }
  get bulkChangedCount() { return this.bulkEligibleResidents.filter(r => this.bulkSelectedIds.has(r.id) && r.status !== this.bulkStatus).length; }
  get bulkAllSelected() { return this.bulkVisibleEligibleResidents.length > 0 && this.bulkVisibleSelectedCount === this.bulkVisibleEligibleResidents.length; }
  toggleBulkResident(id: string, checked: boolean) { checked ? this.bulkSelectedIds.add(id) : this.bulkSelectedIds.delete(id); }
  markAllBulkResidents(checked: boolean) { for (const resident of this.bulkVisibleEligibleResidents) this.toggleBulkResident(resident.id, checked); }
  filters: Record<string,string> = emptyFilters();
  draftFilters: Record<string,string> = emptyFilters();
  activeTab: 'overview'|'zones'|'reports'|'evacuation'|'methodology'|'planner' = 'overview';
  weeklyDate = this.localDate(new Date());
  weeklyDownloadMessage = '';
  weeklyData: DssData | null = null;
  weeklyError = '';
  planBaseline:DssData|null=null;
  planScenario:DssData|null=null;
  plan:ReturnType<typeof buildEvacuationPlan>|null=null;
  planLoading=false;
  planError='';
  planSuccess='';
  planSearch='';
  responseView:ResponseView='residents';
  @ViewChild('responseHeading') responseHeading?:ElementRef<HTMLHeadingElement>;
  setResponseView(view:ResponseView){this.responseView=view;this.responseHeading?.nativeElement.scrollIntoView({block:'start'});this.responseHeading?.nativeElement.focus({preventScroll:true});}
  planPage=1;
  get planPageCount(){return Math.max(1,Math.ceil(this.visiblePlanRows.length/20));}
  get pagedPlanRows(){return this.visiblePlanRows.slice((Math.min(this.planPage,this.planPageCount)-1)*20,Math.min(this.planPage,this.planPageCount)*20);}
  movePlanPage(delta:number){this.planPage=Math.max(1,Math.min(this.planPageCount,this.planPage+delta));}
  allowOtherZones=true;
  scenarioZone='';
  scenarioMajorReports=0;
  scenarioDirty=false;
  scenarioClosedCenters=new Set<string>();
  planSelectedIds=new Set<string>();
  missionResidentIds=new Set<string>();
  get waitingForTeam(){return this.plan?.assignments.filter(a=>!this.missionResidentIds.has(a.person.id)).length??0;}
  updateMissionResidents(ids:Set<string>){this.missionResidentIds=ids;for(const id of ids)this.planSelectedIds.delete(id);}
  arrivalRows:NonNullable<typeof this.plan>['assignments']=[];
  arrivalShelter:DssData['shelters'][number]|null=null;
  arrivalConfirmed=false;
  arrivalAt='';
  arrivalSaving=false;
  get visiblePlanRows() {
    return this.plan?.assignments.filter(a=>[a.person.name,a.person.household,a.person.zone,a.shelter?.name??''].join(' ').toLowerCase().includes(this.planSearch.trim().toLowerCase()))??[];
  }
  get planCenters() {return (this.planScenario??this.planBaseline)?.shelters??[];}
  get baselinePlan() {return this.planBaseline?buildEvacuationPlan(this.planBaseline,this.allowOtherZones):null;}
  get planAllSelected() {const rows=this.visiblePlanRows.filter(a=>a.shelter&&!this.missionResidentIds.has(a.person.id));return rows.length>0&&rows.every(a=>this.planSelectedIds.has(a.person.id));}
  togglePlanResident(id:string,selected:boolean) {selected?this.planSelectedIds.add(id):this.planSelectedIds.delete(id);}
  toggleAllPlanResidents(selected:boolean) {for(const row of this.visiblePlanRows) if(row.shelter&&!this.missionResidentIds.has(row.person.id))this.togglePlanResident(row.person.id,selected);}
  toggleScenarioCenter(id:string,closed:boolean) {closed?this.scenarioClosedCenters.add(id):this.scenarioClosedCenters.delete(id);}
  scenarioChanged() {this.scenarioDirty=true;this.planSelectedIds.clear();this.planSuccess='';}
  get planPreviewOnly() {return !!this.planScenario||this.scenarioDirty;}
  get changedPlanZones() {return this.planScenario?.zones.filter(z=>{const baseline=this.planBaseline?.zones.find(b=>b.id===z.id);return z.risk!==baseline?.risk||z.activeReports!==baseline?.activeReports;})??[];}
  baselineZoneRisk(id:string) {return this.planBaseline?.zones.find(z=>z.id===id)?.risk??'Unknown';}
  rebuildPlan() {const data=this.planScenario??this.planBaseline;this.plan=data?buildEvacuationPlan(data,this.allowOtherZones):null;this.planSelectedIds.clear();this.planPage=1;}
  returnToLivePlan(){if(this.planLoading||this.arrivalSaving)return;this.setResponseView('residents');this.refreshPlan();}
  refreshPlan(simulate=false) {
    if(this.planLoading||this.arrivalSaving)return;
    this.planLoading=true;this.planError='';this.plan=null;this.planScenario=null;this.planSelectedIds.clear();
    const request:Observable<{baseline:DssData;simulated:DssData|null}>=simulate?this.api.simulateDecisionSupport({zoneId:this.scenarioZone||undefined,additionalMajorReports:Number(this.scenarioMajorReports),unavailableShelterIds:[...this.scenarioClosedCenters]}):this.api.decisionSupport({}).pipe(map(baseline=>({baseline,simulated:null})));
    this.subscription?.add(request.pipe(finalize(()=>{this.planLoading=false;this.cdr.markForCheck();})).subscribe({next:result=>{
      this.planBaseline=result.baseline;this.planScenario=result.simulated;
      if(!simulate){this.scenarioZone='';this.scenarioMajorReports=0;this.scenarioClosedCenters.clear();}
      this.scenarioDirty=false;this.rebuildPlan();
    },error:error=>this.planError=error?.error?.message??'The plan could not be loaded. Refresh to retry.'}));
  }
  reviewPlanArrivals(center:DssData['shelters'][number],dialog:HTMLDialogElement) {
    if(this.planPreviewOnly||this.planLoading||this.arrivalSaving||!this.canMarkResidents)return;
    this.arrivalRows=this.plan?.assignments.filter(a=>a.shelter?.id===center.id&&this.planSelectedIds.has(a.person.id))??[];
    if(!this.arrivalRows.length||this.arrivalRows.length>100)return;
    this.arrivalShelter=center;this.arrivalConfirmed=false;this.planError='';
    const now=new Date();this.arrivalAt=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
    dialog.showModal();
  }
  selectedForCenter(id:string) {return this.plan?.assignments.filter(a=>a.shelter?.id===id&&this.planSelectedIds.has(a.person.id)).length??0;}
  dispatchPlan(center:DssData['shelters'][number],rescue:RescueComponent){
    if(this.planPreviewOnly||this.planLoading||this.arrivalSaving||!this.canMarkResidents)return;
    const rows=this.plan?.assignments.filter(a=>a.shelter?.id===center.id&&this.planSelectedIds.has(a.person.id))??[];
    if(!rows.length||rows.length>100)return;
    rescue.prepare(rows.map(a=>({id:a.person.id,name:a.person.name,household:a.person.household,address:a.person.address,status:a.person.status})),center);
    rescue.instructions=[...new Set(rows.flatMap(a=>[...a.person.assistance,...a.person.vulnerabilities]))].join('; ').slice(0,1000);
  }
  savePlanArrivals(dialog:HTMLDialogElement) {
    if(this.planPreviewOnly||this.arrivalSaving||!this.canMarkResidents||!this.arrivalConfirmed||!this.arrivalShelter||!this.arrivalRows.length||!this.arrivalAt||!Number.isFinite(Date.parse(this.arrivalAt)))return;
    this.arrivalSaving=true;this.planError='';
    this.subscription?.add(this.api.assignResidents(this.arrivalShelter.id,this.arrivalRows.map(a=>a.person.id),new Date(this.arrivalAt).toISOString(),'Evacuated',Object.fromEntries(this.arrivalRows.map(a=>[a.person.id,a.person.status]))).pipe(finalize(()=>{this.arrivalSaving=false;this.cdr.markForCheck();})).subscribe({
      next:result=>{this.planSuccess=result.message;dialog.close();this.arrivalSaving=false;this.refreshPlan();this.reload();},
      error:error=>{this.planError=error?.error?.message??'The arrivals could not be confirmed. Refresh to check resident statuses before retrying.';dialog.close();this.plan=null;this.planSelectedIds.clear();}
    }));
  }
  get tabs() {
    return this.mode === 'dss' ? [
      {id:'overview' as const,label:'Response overview'},
      {id:'zones' as const,label:'Zone assessment'},
      {id:'evacuation' as const,label:'Assistance assessment'},
      {id:'planner' as const,label:'Evacuation planner'},
      {id:'methodology' as const,label:'Decision rules'}
    ] : [
      {id:'reports' as const,label:'Incident statistics'},
      {id:'zones' as const,label:'Flood susceptibility reference'}
    ];
  }
  zoneOptions: {id:string;name:string}[] = [];
  readonly risks = ['Low','Moderate','High','Critical'];
  readonly severities = ['Information','Minor Incident','Major Incident'];
  readonly statuses = ['Safe','For Monitoring','For Evacuation','Evacuated'];
  readonly vulnerabilities = ['Any','Senior citizen','PWD','Pregnant','Child','Morbidity','Other'];
  readonly geoAnalyticsUrl = 'https://geoanalytics.georisk.gov.ph/';
  readonly geoAnalyticsLocation = {
    region: 'Region V (Bicol Region)', province: 'Camarines Sur', municipality: 'Lupi',
    barangay: 'Colacling (Del Rosario)', hazard: 'Flood'
  };
  readonly geoAnalyticsAssessment = [
    {label:'Safe',percent:72,area:1619586,color:'#e5e7eb'},
    {label:'Low susceptibility',percent:15.4,area:346411,color:'#d9c8ff'},
    {label:'Moderate susceptibility',percent:7,area:157460,color:'#a946ed'},
    {label:'High susceptibility',percent:5.6,area:125968,color:'#5d16e8'}
  ];
  readonly geoAnalyticsTotalArea = 2249425;
  readonly geoAnalyticsProneArea = 630745;
  readonly geoAnalyticsPronePercent = 28.04;
  readonly geoAnalyticsChart = 'conic-gradient(#e5e7eb 0 72%, #d9c8ff 72% 87.4%, #a946ed 87.4% 94.4%, #5d16e8 94.4% 100%)';
  pages: Record<string,number> = {vulnerable:1,evacuation:1,households:1};
  ngOnInit() {
    this.activeTab = this.mode === 'planner' ? 'planner' : this.mode === 'assistance' ? 'evacuation' : this.mode === 'dss' ? 'overview' : this.initialTab;
    this.subscription = combineLatest([timer(0,30_000),this.refresh]).pipe(switchMap(()=>{
      if (this.filters['from'] && this.filters['to'] && this.filters['from']>this.filters['to']) {
        this.loading=false;this.error='Start date must not be after end date.';return of({data:null,weeklyData:null});
      }
      this.loading=true; this.error='';
      this.weeklyError='';
      return forkJoin({
        data:this.api.decisionSupport({...this.filters}).pipe(catchError(error=>{
          this.error=error?.error?.message ?? 'Decision-support data could not be loaded. Please retry.';return of(null);
        })),
        weeklyData:this.mode==='statistics'?this.api.decisionSupport(this.weeklyPeriod).pipe(catchError(error=>{
          this.weeklyError=error?.error?.message ?? 'The weekly report could not be loaded. Refresh to retry.';return of(null);
        })):of(null)
      }).pipe(finalize(()=>{this.loading=false;this.cdr.markForCheck();}));
    })).subscribe(({data,weeklyData})=>{
      this.data=data;
      this.weeklyData=weeklyData;
      if (data) {
        this.zoneOptions=data.zoneOptions;
        for (const kind of ['vulnerable','evacuation','households']) this.pages[kind]=Math.min(this.pages[kind]!,this.pageCount(kind));
      }
      this.cdr.markForCheck();
    });
    if (this.mode === 'planner') this.refreshPlan();
  }
  get pageTitle() { return {dss:'Decision Support System',statistics:'Reports & Statistics',planner:'Evacuation Planner',assistance:'Assistance Assessment'}[this.mode]; }
  get priorityZones() { return [...(this.data?.zones ?? [])].sort((a,b)=>this.risks.indexOf(b.risk)-this.risks.indexOf(a.risk)||a.name.localeCompare(b.name,undefined,{numeric:true})); }
  ngOnDestroy() { this.subscription?.unsubscribe();this.refresh.complete(); }
  openBulkStatus(zone: DssData['zones'][number], dialog: HTMLDialogElement, viewOnly = false) {
    this.bulkPreviewSubscription?.unsubscribe();
    this.bulkZoneId = zone.id;
    this.bulkZoneName = zone.name;
    this.bulkViewOnly = viewOnly;
    this.bulkStatus = 'For Evacuation';
    this.bulkPreview = null;
    this.bulkSelectedIds = new Set();
    this.bulkSearch = '';
    this.bulkError = '';
    this.bulkSuccess = '';
    this.bulkLoading = true;
    dialog.showModal();
    this.bulkPreviewSubscription = this.api.previewZoneResidentStatus(zone.id).pipe(finalize(() => {
      this.bulkLoading = false; this.cdr.markForCheck();
    })).subscribe({
      next: preview => {
        if (!this.bulkViewOnly && preview.risk !== 'Critical') this.bulkError = 'This zone is no longer Critical. Refresh the DSS assessment.';
        else this.bulkPreview = preview;
      },
      error: error => this.bulkError = error?.error?.message ?? 'Could not load the residents for this zone. Close and try again.'
    });
    this.subscription?.add(this.bulkPreviewSubscription);
  }
  saveBulkStatus(dialog: HTMLDialogElement) {
    if (this.bulkViewOnly || !this.bulkPreview || this.bulkSaving || !this.bulkChangedCount) return;
    this.bulkSaving = true;
    this.bulkError = '';
    this.subscription?.add(this.api.markZoneResidents(this.bulkZoneId, this.bulkStatus, this.bulkPreview.revision, [...this.bulkSelectedIds]).pipe(finalize(() => {
      this.bulkSaving = false; this.cdr.markForCheck();
    })).subscribe({
      next: result => { this.bulkSuccess = result.message; dialog.close(); this.reload(); },
      error: error => {
        this.bulkError = error?.error?.message ?? 'The update could not be confirmed. Close and reopen to check the current statuses before retrying.';
        this.bulkPreview = null;
      }
    }));
  }
  changeFilters() { this.data=null;this.pages={vulnerable:1,evacuation:1,households:1};this.reload(); }
  openFilters(dialog: HTMLDialogElement) {
    this.draftFilters={...emptyFilters(),...this.filters};
    dialog.showModal();
  }
  applyFilters() {
    this.filters=Object.fromEntries(Object.entries(this.draftFilters).filter(([,value])=>value));
    this.changeFilters();
  }
  reset() {this.draftFilters=emptyFilters();this.filters=emptyFilters();this.changeFilters();}
  get activeFilterCount() {return Object.values(this.filters).filter(Boolean).length;}
  get activeFilterLabels() {
    const zoneName=this.zoneOptions.find(zone=>zone.id===this.filters['zone'])?.name;
    return [
      zoneName?`Zone: ${zoneName}`:null,
      this.filters['risk']?`Risk: ${this.filters['risk']}`:null,
      this.filters['from']?`From: ${this.filters['from']}`:null,
      this.filters['to']?`To: ${this.filters['to']}`:null,
      this.filters['severity']?`Severity: ${this.filters['severity']}`:null,
      this.filters['evacuationStatus']?`Status: ${this.filters['evacuationStatus']}`:null,
      this.filters['vulnerability']?`Vulnerability: ${this.filters['vulnerability']}`:null
    ].filter((label):label is string=>!!label);
  }
  reload() {this.refresh.next(this.refresh.value+1);}
  previewReport() {
    if (!this.data || this.loading || this.error) return;
    this.reportData=this.data;
    this.reportFilterLabels=[...this.activeFilterLabels];
    this.cdr.detectChanges();
    document.getElementById('situation-report-title')?.focus();
  }
  closeReport() {
    this.reportData=null;
    this.cdr.detectChanges();
    document.querySelector<HTMLButtonElement>('.heading-actions button')?.focus();
  }
  printReport() {window.print();}
  selectTab(tab: typeof this.activeTab) {this.activeTab=tab;if(tab==='planner'&&!this.planBaseline)this.refreshPlan();}
  level(value:string|null) {return (value??'unknown').toLowerCase().replace(/ /g,'-');}
  pageCount(kind:string) {
    const total=kind==='households'?this.data?.priorityHouseholds.length:kind==='vulnerable'?this.data?.vulnerable.length:this.data?.evacuation.length;
    return Math.max(1,Math.ceil((total??0)/20));
  }
  movePage(kind:string,delta:number) {this.pages[kind]=Math.max(1,Math.min(this.pageCount(kind),this.pages[kind]!+delta));}
  get metrics(): Array<{label:string;value:number;icon:string;page:string;resource?:string;filters?:Record<string,string>}> {
    if (!this.data) return [];
    const m=this.data.metrics;
    return [
      {label:'Active validated reports',value:m.activeReports,icon:'!',page:'reports',filters:{status:'Validated'}},
      {label:'Affected zones',value:m.affectedZones,icon:'⌖',page:'map'},
      {label:'Residents needing assistance',value:m.priorityResidents,icon:'♙',page:'evacuation',resource:'residents'},
      {label:'Potentially affected vulnerable',value:m.affectedVulnerable,icon:'♡',page:'residents',filters:{vulnerable:'true'}}
    ];
  }
  openMetric(metric: {page:string;resource?:string;filters?:Record<string,string>}) {this.navigate.emit(metric);}
  openHazardMap() {this.navigate.emit({page:'map'});}
  get reportStatuses() {
    if (!this.data) return [];
    const incidents=this.data.incidents;
    return [
      {label:'Active validated',value:incidents.active,className:'active'},
      {label:'Pending verification',value:incidents.pending,className:'pending'},
      {label:'Resolved',value:incidents.resolved,className:'resolved'},
      {label:'Rejected',value:incidents.rejected,className:'rejected'}
    ];
  }
  get statusDonut() {
    const values=this.reportStatuses.map(item=>item.value);
    const total=values.reduce((sum,value)=>sum+value,0);
    if (!total) return 'conic-gradient(#e5ebf2 0 100%)';
    const colors=['#1764c1','#e4a11b','#35a36f','#9aa6b5'];
    let cursor=0;
    return `conic-gradient(${values.map((value,index)=>{
      const start=cursor; cursor+=value/total*100;
      return `${colors[index]} ${start}% ${cursor}%`;
    }).join(',')})`;
  }
  get maxSeverity() { return Math.max(1,...(this.data?.incidents.bySeverity.map(item=>item.count)??[])); }
  get maxZoneReports() { return Math.max(1,...(this.data?.zones.map(zone=>zone.totalReports)??[])); }
  get zoneAxisTicks() {
    const maximum = this.maxZoneReports;
    return [maximum, maximum * .75, maximum * .5, maximum * .25, 0].map(value => Math.round(value));
  }
  private localDate(date: Date) {
    return philippineDate.format(date);
  }
  private weekBounds(value: string) {
    const date=new Date(`${value}T12:00:00+08:00`);
    const monday=new Date(date);monday.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
    const sunday=new Date(monday);sunday.setUTCDate(monday.getUTCDate()+6);
    return {from:this.localDate(monday),to:this.localDate(sunday)};
  }
  get weeklyPeriod() {return this.weekBounds(this.weeklyDate);}
  get weeklyPeriodApplied() {const period=this.weeklyPeriod;return !!this.weeklyData&&!this.loading&&this.weeklyData.filters['from']===period.from&&this.weeklyData.filters['to']===period.to;}
  weeklyRecordDate(value:string) {return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)?value.replace(' ','T')+'+08:00':value;}
  get weeklyRecords() {const period=this.weeklyPeriod;return (this.weeklyData?.incidents.records??[]).filter(record=>{const date=this.localDate(new Date(this.weeklyRecordDate(record.createdAt)));return date>=period.from&&date<=period.to;});}
  get weeklySummary() {
    const records=this.weeklyRecords;
    return {total:records.length,validated:records.filter(record=>record.status==='Validated').length,pending:records.filter(record=>['Submitted','Under Review'].includes(record.status)).length,resolved:records.filter(record=>record.status==='Resolved').length,rejected:records.filter(record=>record.status==='Rejected').length};
  }
  get weeklyStatus() {
    const records=this.weeklyRecords.filter(record=>record.status==='Validated');
    if(records.some(record=>record.severity==='Major Incident'))return 'Major incident recorded';
    if(records.some(record=>record.severity==='Minor Incident'))return 'Minor incident recorded';
    return records.length?'Information reports recorded':'No validated incident recorded';
  }
  get weeklyAffectedZones() {return new Set(this.weeklyRecords.filter(record=>record.status==='Validated').flatMap(record=>record.zones)).size;}
  get weeklyDailyRows() {
    const rows=[] as {date:string;total:number;validated:number;pending:number;major:number;zones:string[]}[];
    const start=new Date(`${this.weeklyPeriod.from}T12:00:00+08:00`);
    for(let offset=0;offset<7;offset++){
      const day=new Date(start);day.setUTCDate(start.getUTCDate()+offset);const date=this.localDate(day);
      const records=this.weeklyRecords.filter(record=>this.localDate(new Date(this.weeklyRecordDate(record.createdAt)))===date);
      rows.push({date,total:records.length,validated:records.filter(record=>record.status==='Validated').length,pending:records.filter(record=>['Submitted','Under Review'].includes(record.status)).length,major:records.filter(record=>record.severity==='Major Incident').length,zones:[...new Set(records.flatMap(record=>record.zones))]});
    }
    return rows;
  }
  applyWeeklyPeriod() {
    this.weeklyData=null;this.weeklyDownloadMessage='';this.reload();
  }
  changeWeeklyDate(value: string) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value)))return;
    this.weeklyDate=value;
    this.applyWeeklyPeriod();
  }
  private escapeHtml(value: unknown) {
    return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
  }
  private weeklyTimestamp(value:string) {
    return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'medium'}).format(new Date(this.weeklyRecordDate(value)));
  }
  private weeklyReportMarkup() {
    if(!this.weeklyData)return '';
    const escape=(value:unknown)=>this.escapeHtml(value);
    const summary=this.weeklySummary;
    const dailyRows=this.weeklyDailyRows.map(row=>`<tr><td>${escape(row.date)}</td><td>${row.total}</td><td>${row.validated}</td><td>${row.pending}</td><td>${row.major}</td><td>${escape(row.zones.join(', ')||'None recorded')}</td></tr>`).join('');
    const incidentRows=this.weeklyRecords.map(record=>`<tr><td><b>${escape(record.code)}</b><br>${escape(record.location)}</td><td>${escape(record.incidentType)}</td><td>${escape(record.zones.join(', ')||'Not assigned')}</td><td>${escape(record.severity)}</td><td>${escape(record.status)}</td><td>${escape(this.weeklyTimestamp(record.createdAt))}</td></tr>`).join('')||'<tr><td colspan="6">No incident reports were recorded during this week.</td></tr>';
    return `<!doctype html><html><head><meta charset="utf-8"><title>Weekly Flood Monitoring Report</title><style>@page{size:A4 landscape;margin:14mm}body{font-family:Arial,sans-serif;color:#182638;font-size:11pt;line-height:1.4}header{border-bottom:3px solid #182638;margin-bottom:18px}h1{font-size:22pt;margin:5px 0}.subtitle{font-size:9pt;letter-spacing:.5px;font-weight:bold}.summary{display:table;width:100%;table-layout:fixed;margin:18px 0}.summary span{display:table-cell;padding:10px;border:1px solid #ccd5df}.summary b{display:block;font-size:18pt}table{width:100%;border-collapse:collapse;margin:8px 0 18px;font-size:9pt}th,td{padding:7px;border:1px solid #ccd5df;text-align:left;vertical-align:top}th{background:#edf1f5}h2{margin:22px 0 8px;font-size:14pt}footer{border-top:1px solid #ccd5df;padding-top:8px;font-size:8pt;color:#435368}tr{break-inside:avoid}</style></head><body><header><div class="subtitle">BANTAYBAHA · BARANGAY COLACLING, LUPI, CAMARINES SUR</div><h1>Weekly Flood Monitoring Report</h1><p><b>Reporting period:</b> ${escape(this.weeklyPeriod.from)} to ${escape(this.weeklyPeriod.to)}</p><p><b>Generated:</b> ${escape(this.weeklyTimestamp(this.weeklyData.generatedAt))}</p></header><div class="summary"><span><b>${summary.total}</b>Total records</span><span><b>${summary.validated}</b>Validated</span><span><b>${summary.pending}</b>Pending verification</span><span><b>${this.weeklyAffectedZones}</b>Affected zones</span></div><p><b>Weekly status:</b> ${escape(this.weeklyStatus)}</p><h2>Daily record summary</h2><table><thead><tr><th>Date</th><th>Total</th><th>Validated</th><th>Pending</th><th>Major</th><th>Affected zones</th></tr></thead><tbody>${dailyRows}</tbody></table><h2>Incident records</h2><table><thead><tr><th>Tracking code / location</th><th>Type</th><th>Affected zones</th><th>Severity</th><th>Status</th><th>Reported</th></tr></thead><tbody>${incidentRows}</tbody></table><footer>Dates are based on report creation time. Validated records are verified reports; pending records require review.</footer></body></html>`;
  }
  downloadWeeklyReport() {
    if(!this.weeklyPeriodApplied)return;
    const url=URL.createObjectURL(new Blob(['\uFEFF',this.weeklyReportMarkup()],{type:'application/msword'}));
    const link=document.createElement('a');link.href=url;link.download=`weekly-flood-monitoring-${this.weeklyPeriod.from}-to-${this.weeklyPeriod.to}.doc`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url));
    this.weeklyDownloadMessage='Weekly report downloaded as a Word document.';
  }
  printWeeklyReport() {
    if(!this.weeklyPeriodApplied)return;
    const className='weekly-report-print';
    const cleanup=()=>document.body.classList.remove(className);
    document.body.classList.add(className);
    window.addEventListener('afterprint',cleanup,{once:true});
    window.print();
    setTimeout(cleanup,1000);
  }
  get shelterSummary() {
    const shelters=this.data?.shelters??[];
    return {
      capacity:shelters.reduce((sum,item)=>sum+item.capacity,0),
      occupancy:shelters.reduce((sum,item)=>sum+(item.occupancy??0),0),
      available:shelters.reduce((sum,item)=>sum+(item.available??0),0)
    };
  }
}
