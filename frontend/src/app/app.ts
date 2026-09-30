import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import { ApiService, ResidentYearSummary, WeatherData } from './api.service';
import { LiveMapComponent } from './live-map.component';
import { PolygonEditorComponent } from './polygon-editor.component';
import { LocationPickerComponent } from './location-picker.component';
import { DssComponent } from './dss.component';

type PageId = 'dashboard' | 'map' | 'reports' | 'residents' | 'households' | 'evacuation' | 'statistics' | 'notifications' | 'users';
type PublicPage = 'home' | 'map' | 'report' | 'login';
type EditorOption = { value: string; label: string };
type EditorField = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'date' | 'color' | 'textarea' | 'select' | 'multiselect' | 'polygon' | 'location' | 'household-lookup';
  required?: boolean;
  placeholder?: string;
  options?: EditorOption[];
};

const options = (...values: string[]): EditorOption[] => values.map((value) => ({ value, label: value }));

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, LiveMapComponent, PolygonEditorComponent, LocationPickerComponent, DssComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  menuOpen = false;
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
  successMessage = '';
  publicToastMessage = '';
  editorOpen = false;
  editorId = '';
  editorValues: Record<string, unknown> = {};
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
  activeValidatedReports = 0;
  affectedZones = 0;
  priorityResidents = 0;
  pendingReportCount = 0;
  dashboardAlert?: Record<string, unknown>;
  dashboardNotifications: Record<string, unknown>[] = [];
  publicNotifications: Record<string, unknown>[] = [];
  publicContacts: Record<string, unknown>[] = [];
  publicReports: Record<string, unknown>[] = [];
  publicMapData: Record<string, any> = { zones: [], shelters: [], riskZones: [] };
  weather?: WeatherData;
  existingBarangayZones: Array<Record<string, unknown>> = [];
  publicMapLayers = { barangayZones: true, shelters: true, riskZones: true, incidents: true, routes: false };
  publicMapLabelsVisible = false;
  adminMapLayers = { barangayZones: true, shelters: false, riskZones: false, incidents: false, routes: false };
  adminMapLabelsVisible = false;
  readonly evacuationMapLayers = { barangayZones: true, shelters: true, riskZones: false, incidents: false, routes: true };
  publicMapSections = { barangayZones: true, shelters: false, riskZones: false, incidents: false, announcements: false };
  readonly incidentTypes = ['River Flooding', 'Flash Flood', 'Road Flooding', 'Drainage Overflow', 'Rising Water', 'Other'];
  readonly incidentLevels = ['Information', 'Minor Incident', 'Major Incident'];
  selectedPublicMapFocus?: { id: string; resource: string; record: Record<string, unknown>; nonce: number };
  selectedPublicIncident?: Record<string, unknown>;
  viewingAdminIncident = false;
  today = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
  readonly liveNow = signal(new Date());
  private clockTimer?: number;
  private dashboardRefreshTimer?: number;
  private publicToastTimer?: number;
  private successMessageTimer?: number;

  navItems: { id: PageId; label: string; icon: string; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
    { id: 'map', label: 'Live Map & GIS', icon: '⌖' },
    { id: 'reports', label: 'Flood Reports', icon: '!' },
    { id: 'residents', label: 'Residents', icon: '♙' },
    { id: 'households', label: 'Households', icon: '⌑' },
    { id: 'evacuation', label: 'Evacuation Support', icon: '◇' },
    { id: 'statistics', label: 'Reports & Statistics', icon: '▥' },
    { id: 'notifications', label: 'Notifications', icon: '♢' },
    { id: 'users', label: 'User Accounts', icon: '⚙' }
  ];

  pageDetails: Record<PageId, { eyebrow: string; title: string; description: string; action: string }> = {
    dashboard: { eyebrow: '', title: '', description: '', action: '' },
    map: { eyebrow: 'GEOSPATIAL OPERATIONS', title: 'Live Map & GIS', description: 'Review barangay boundaries, risk zones, incidents, routes, and evacuation shelters.', action: 'Add map record' },
    reports: { eyebrow: 'INCIDENT MANAGEMENT', title: 'Flood Reports', description: 'Validate community reports and coordinate a timely response.', action: 'New report' },
    residents: { eyebrow: 'COMMUNITY RECORDS', title: 'Residents', description: 'Manage resident information, vulnerability, and evacuation priority.', action: 'Add resident' },
    households: { eyebrow: 'COMMUNITY RECORDS', title: 'Households', description: 'Organize residents by household, zone, and current risk.', action: 'Add household' },
    evacuation: { eyebrow: 'RESPONSE OPERATIONS', title: 'Evacuation Support', description: 'Coordinate shelters, volunteers, and emergency contacts.', action: 'Add shelter' },
    statistics: { eyebrow: 'DECISION SUPPORT', title: 'Reports & Statistics', description: 'Turn validated reports and zone data into actionable priorities.', action: 'Export summary' },
    notifications: { eyebrow: 'PUBLIC INFORMATION', title: 'Notifications', description: 'Create, send, and archive official flood advisories.', action: 'New advisory' },
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

  tableRows = [
    { name: 'Riverside Zone', id: 'ZONE-001', detail: 'Purok 1 · High-risk area', status: 'Active', updated: '8 min ago' },
    { name: 'Colacling Elementary School', id: 'SH-001', detail: 'Capacity 200 · 54 occupied', status: 'Available', updated: '21 min ago' },
    { name: 'Station 1 – Spillway', id: 'ST-001', detail: '1.25 m · Monitoring', status: 'Online', updated: '6 min ago' },
    { name: 'Demo Resident 12-1', id: 'RES-036', detail: 'Elderly · High priority', status: 'Monitoring', updated: '1 hr ago' },
    { name: 'Public flood advisory', id: 'NTF-004', detail: 'Affected zones · Minor incident', status: 'Sent', updated: '2 hrs ago' }
  ];

  get currentPage() { return this.pageDetails[this.activePage]; }
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
      shelters: 'Add shelter',
      volunteers: 'Add volunteer',
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
      { name: 'recordStatus', label: 'Resident status', type: 'select', required: true, options: options('Active', 'Inactive') },
      { name: 'evacuationStatus', label: 'Evacuation status', type: 'select', required: true, options: options('Safe', 'For Monitoring', 'For Evacuation', 'Evacuated') },
      { name: 'evacuationShelterId', label: 'Evacuation center', type: 'select', options: this.shelterOptions }
    ];
    const fields: Partial<Record<PageId, EditorField[]>> = {
      users: [
        { name: 'fullName', label: 'Full name', required: true }, { name: 'username', label: 'Username', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'role', label: 'Role', type: 'select', required: true, options: options('Super Admin', 'Disaster Officer', 'Data Encoder') },
        { name: 'password', label: 'Initial password', type: 'password', required: !this.editorId }
      ],
      residents: [
        { name: 'householdId', label: 'Household', type: 'household-lookup', required: true, options: this.householdOptions },
        { name: 'fullName', label: 'Full name', required: true },
        { name: 'age', label: 'Age', type: 'number' },
        { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
        { name: 'sex', label: 'Sex', type: 'select', required: true, options: options('Female', 'Male', 'Intersex', 'Prefer not to say', 'Not recorded') },
        { name: 'contactNumber', label: 'Contact number' }, { name: 'addressLine', label: 'Address', required: true },
        { name: 'relationshipToHead', label: 'Relationship to household head', type: 'select', options: options('Head', 'Daughter', 'Son', 'Wife', 'Husband', 'Grandson', 'Granddaughter', 'Relatives', 'Brother', 'Sister', 'Live-in partner', 'Nephew', 'Other') },
        { name: 'vulnerabilityType', label: 'Vulnerability', type: 'select', options: options('Elderly', 'Child', 'Disability', 'Pregnant', 'Mobility-limited', 'Other') },
        { name: 'maritalStatus', label: 'Status', type: 'select', options: options('Widow', 'Single', 'Married') },
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
        { name: 'emergencyContactName', label: 'Emergency contact name' }, { name: 'emergencyContactNumber', label: 'Emergency contact number' },
        { name: 'priorityLevel', label: 'Priority level', type: 'select', required: true, options: options('Low', 'Medium', 'High') },
        { name: 'recordStatus', label: 'Resident status', type: 'select', required: true, options: options('Active', 'Inactive') },
        { name: 'evacuationStatus', label: 'Evacuation status', type: 'select', required: true, options: options('Safe', 'For Monitoring', 'For Evacuation', 'Evacuated') },
        { name: 'evacuationShelterId', label: 'Evacuation center', type: 'select', options: this.shelterOptions }
      ],
      households: [
        { name: 'householdNumber', label: 'Household number', required: true },
        { name: 'zoneId', label: 'Zone', type: 'select', required: true, options: this.zoneOptions },
        { name: 'addressLine', label: 'Address', required: true }, { name: 'headOfHouseholdName', label: 'Head of household', required: true },
        { name: 'contactNumber', label: 'Contact number' },
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
        { name: 'zoneIds', label: 'Zone IDs', placeholder: 'Comma-separated for Affected Zones' }
      ],
      reports: [
        ...(this.editorId ? [
          { name: 'status', label: 'New status', type: 'select' as const, required: true, options: options('Under Review', 'Validated', 'Rejected', 'Resolved') },
          { name: 'severityLevel', label: 'Incident level', type: 'select' as const, required: true, options: options('Information', 'Minor Incident', 'Major Incident') },
          { name: 'validationNotes', label: 'Reviewer notes (optional)', type: 'textarea' as const },
          { name: 'zoneIds', label: 'Affected Barangay Zones', type: 'multiselect' as const, required: true, options: this.zoneOptions }
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
      next: () => this.setPage(this.requestedAdminPage ?? 'dashboard', false),
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

  login(username: string, password: string) {
    this.errorMessage = '';
    this.loginLoading = true;
    this.api.login(username, password).pipe(finalize(() => this.finishLoginLoading())).subscribe({
      next: () => this.setPage(this.requestedAdminPage ?? 'dashboard'),
      error: (error) => this.errorMessage = error?.error?.message ?? 'Unable to connect to the BantayBaha API.'
    });
  }

  requestRecovery(event: Event, email: string) {
    event.preventDefault();
    this.errorMessage = '';
    this.loginLoading = true;
    this.api.forgotPassword(email).pipe(finalize(() => this.finishLoginLoading())).subscribe({
      next: (value) => this.successMessage = value.message,
      error: (error) => this.errorMessage = error?.error?.message ?? 'Password recovery could not be completed.'
    });
  }

  performReset(event: Event, password: string) {
    event.preventDefault();
    this.errorMessage = '';
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
      routes: false
    };
  }

  showAllPublicMapLayers() {
    this.selectedPublicMapFocus = undefined;
    this.publicMapLayers = { barangayZones: true, riskZones: true, shelters: true, incidents: true, routes: false };
  }

  get allPublicMapLayersVisible() {
    return this.publicMapLayers.barangayZones && this.publicMapLayers.riskZones
      && this.publicMapLayers.shelters && this.publicMapLayers.incidents;
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

  submitPublicReport(event: Event, incidentType: string, severityLevel: string, description: string, reporterName: string, reporterContact: string, photos: FileList | null, locationPicker: LocationPickerComponent) {
    event.preventDefault();
    this.errorMessage = '';
    this.successMessage = '';
    const reportForm = event.currentTarget as HTMLFormElement;
    const values = new FormData(reportForm);
    const location = String(values.get('locationText') ?? '');
    const latitude = String(values.get('latitude') ?? '');
    const longitude = String(values.get('longitude') ?? '');
    if (!location || !latitude || !longitude) {
      this.errorMessage = 'Pin the flood incident location on the map.';
      return;
    }
    const selectedPhotos = Array.from(photos ?? []);
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
        reportForm.reset();
        locationPicker.clear();
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
    this.refreshPendingReportCount();
    this.loading = true;
    forkJoin({
      summary: this.api.dashboardSummary(),
      reports: this.api.dashboardReports().pipe(catchError(() => of({ items: [] }))),
      alert: this.api.dashboardAlert().pipe(catchError(() => of({ alert: null }))),
      notifications: this.api.dashboardNotifications().pipe(catchError(() => of({ items: [] }))),
      shelters: this.api.list<Record<string, unknown>>('shelters', 1, 3).pipe(catchError(() => of({ items: [], page: 1, pageSize: 3, totalItems: 0, totalPages: 1 }))),
      risk: this.api.statistics('risk-summary').pipe(catchError(() => of({} as Record<string, unknown>))),
      priorities: this.api.statistics('evacuation-priorities').pipe(catchError(() => of({ items: [] } as Record<string, unknown>)))
      ,weather: this.api.currentWeather().pipe(catchError(() => of(null)))
    }).pipe(finalize(() => this.finishLoading())).subscribe({
      next: ({ summary, reports, alert, notifications, shelters, risk, priorities, weather }) => {
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
        this.overallRisk = String(risk['overallRiskLevel'] ?? 'Low');
        this.activeValidatedReports = Number(risk['activeValidatedReports'] ?? 0);
        this.affectedZones = Number(risk['affectedZones'] ?? 0);
        this.priorityResidents = ((priorities['items'] as unknown[] | undefined) ?? []).length;
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

  setPage(page: PageId, updateHistory = true) {
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
      this.currentResource = 'barangay-zones';
      this.setAdminMapLayer('barangay-zones');
      this.page = 1;
      this.sortBy = '';
      this.loadResource();
      return;
    }
    if (page === 'statistics') {
      this.currentResource = 'statistics';
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
      routes: false
    };
  }

  showAllAdminMapLayers() {
    this.selectedMapFocus = undefined;
    this.adminMapLayers = {
      barangayZones: true,
      riskZones: true,
      shelters: true,
      incidents: true,
      routes: false
    };
  }

  get allAdminMapLayersVisible() {
    return this.adminMapLayers.barangayZones
      && this.adminMapLayers.riskZones
      && this.adminMapLayers.shelters
      && this.adminMapLayers.incidents;
  }

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
    this.assignmentCenter = center;
    this.assignmentOpen = true;
    this.assignmentSearch = '';
    this.assignmentAt = this.localDateTimeValue(new Date());
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
    if (occupancy + this.selectedAssignmentResidentIds.size > capacity) {
      this.errorMessage = `Only ${Math.max(0, capacity - occupancy)} resident slot(s) remain in this evacuation center.`;
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.api.assignResidents(shelterId, [...this.selectedAssignmentResidentIds], evacuationAt.toISOString()).pipe(finalize(() => this.finishLoading())).subscribe({
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
    this.clearAdminReportPhotos();
    this.householdLookupOpen = false;
    this.householdLookupQuery = '';
    this.editorId = row?.id ?? '';
    const record = row ? this.rawRecords.get(row.id) : undefined;
    this.editorValues = {};
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
      this.editorValues['locationText'] = record['location_text'] ?? record['locationText'] ?? '';
      this.editorValues['description'] = record['description'] ?? '';
      this.editorValues['vulnerabilityOther'] = record['vulnerability_other'] ?? record['vulnerabilityOther'] ?? '';
      this.editorValues['relationshipOther'] = record['relationship_other'] ?? record['relationshipOther'] ?? '';
    }
    this.editorOpen = true;
    this.errorMessage = '';
    this.successMessage = '';
    if (this.activePage === 'residents') this.loadHouseholdOptions();
    if (this.editorFields.some((field) => ['zoneId', 'zoneIds', 'assignedZoneId', 'originZoneId'].includes(field.name))) this.loadZoneOptions();
    if (this.editorFields.some((field) => ['destinationShelterId', 'evacuationShelterId'].includes(field.name))) this.loadShelterOptions();
    if (this.activePage === 'reports' && this.editorId) {
      this.loadAdminReportPhotos(this.editorId, record?.['photo_urls'] ?? record?.['photoUrls']);
      this.api.get<Record<string, unknown>>('flood-reports', this.editorId).subscribe({
        next: (report) => {
          const assigned = report['affected_zone_ids'];
          let zoneIds: unknown[] = [];
          try { zoneIds = Array.isArray(assigned) ? assigned : typeof assigned === 'string' ? JSON.parse(assigned) : []; }
          catch { zoneIds = []; }
          this.editorValues['zoneIds'] = zoneIds.filter(Boolean).map(String);
          this.changeDetector.detectChanges();
        },
        error: (error) => this.errorMessage = error?.error?.message ?? 'Report details could not be loaded.'
      });
    }
  }

  openHouseholdLookup() {
    this.householdLookupQuery = '';
    this.householdLookupOpen = true;
  }

  selectHousehold(option: EditorOption) {
    this.editorValues['householdId'] = option.value;
    this.householdLookupOpen = false;
    this.householdLookupQuery = '';
  }

  focusMapRecord(row: { id: string }) {
    const record = this.rawRecords.get(row.id);
    if (!record) return;
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

  deleteSelectedEvacuationRecord() {
    if (this.activePage !== 'evacuation' || !this.editorId || !this.canManageCurrentResource || this.loading) return;
    const labels: Record<string, string> = {
      shelters: 'shelter',
      volunteers: 'volunteer',
      'evacuation-routes': 'evacuation route',
      'emergency-contacts': 'emergency contact'
    };
    const label = labels[this.currentResource] ?? 'record';
    if (!window.confirm(`Delete this ${label}? This action cannot be undone.`)) return;
    this.loading = true;
    this.api.delete(this.currentResource, this.editorId).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.selectedMapFocus = undefined;
        this.mapRefreshNonce++;
        this.closeEditor();
        this.successMessage = `${label[0]!.toUpperCase()}${label.slice(1)} deleted successfully.`;
        this.loadResource();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? `The ${label} could not be deleted.`
    });
  }

  deleteSelectedResident() {
    if (this.activePage !== 'residents' || !this.editorId || this.loading) return;
    const name = String(this.editorValues['fullName'] ?? 'this resident');
    if (!window.confirm(`Delete ${name}? This action cannot be undone.`)) return;
    this.loading = true;
    this.api.delete('residents', this.editorId).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.closeEditor();
        this.successMessage = 'Resident deleted successfully.';
        this.loadResource();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'The resident could not be deleted.'
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
    event.preventDefault();
    this.errorMessage = '';
    this.successMessage = '';
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;
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
      ? this.api.updateReportStatus(this.editorId, raw as { status: string; severityLevel: string; validationNotes?: string; zoneIds: string[] })
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
      error: (error) => this.errorMessage = error?.error?.message ?? 'The record could not be saved.'
    });
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

  closeEditor() {
    this.clearAdminReportPhotos();
    this.householdLookupOpen = false;
    this.householdLookupQuery = '';
    this.editorOpen = false;
    this.editorId = '';
    this.editorValues = {};
    this.errorMessage = '';
    this.changeDetector.detectChanges();
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
    return ({ Submitted: 'New', 'Under Review': 'Monitored', Validated: 'Verified' } as Record<string, string>)[status] ?? status;
  }

  reportStatusClass(row: { id: string }) {
    return String(this.reportTableRecord(row)['status'] ?? 'Submitted').toLowerCase().replace(/\s+/g, '-');
  }

  reportLocation(row: { id: string }) {
    return String(this.reportTableRecord(row)['location_text'] ?? 'Location not provided');
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

  deleteSelectedZone() {
    if (!this.editorId || !['barangay-zones', 'risk-zones'].includes(this.currentResource) || this.api.user()?.role !== 'Super Admin') return;
    const isRiskZone = this.currentResource === 'risk-zones';
    const zoneName = String(this.editorValues[isRiskZone ? 'riskZoneName' : 'zoneName'] ?? `this ${isRiskZone ? 'risk' : 'barangay'} zone`);
    if (!window.confirm(`Delete ${zoneName}? This cannot be undone.`)) return;
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.api.delete(this.currentResource, this.editorId).pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.selectedMapFocus = undefined;
        this.mapRefreshNonce++;
        this.closeEditor();
        this.successMessage = `${isRiskZone ? 'Risk' : 'Barangay'} zone deleted successfully.`;
        this.loadResource();
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'The barangay zone could not be deleted.'
    });
  }

  notificationAction(action: 'send' | 'archive') {
    if (!this.editorId) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.loading = true;
    const request = action === 'send' ? this.api.sendNotification(this.editorId) : this.api.archiveNotification(this.editorId);
    request.pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        this.closeEditor();
        this.successMessage = `Notification ${action === 'send' ? 'sent' : 'archived'} successfully.`;
        this.setPage('notifications');
      },
      error: (error) => this.errorMessage = error?.error?.message ?? `Notification could not be ${action === 'send' ? 'sent' : 'archived'}.`
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

  private mapReport(row: Record<string, unknown>) {
    const severity = String(row['severity_level'] ?? row['severityLevel'] ?? 'Information');
    const status = String(row['status'] ?? 'Submitted');
    return {
      code: String(row['tracking_code'] ?? row['trackingCode'] ?? ''),
      location: String(row['location_text'] ?? row['locationText'] ?? ''),
      description: String(row['description'] ?? ''),
      status,
      statusClass: status === 'Validated' ? 'validated' : status === 'Under Review' ? 'review' : 'submitted',
      level: severity === 'Major Incident' ? 'major' : severity === 'Minor Incident' ? 'minor' : 'info',
      icon: severity === 'Major Incident' ? '!' : severity === 'Minor Incident' ? '≈' : 'i',
      time: this.formatDate(row['created_at'] ?? row['createdAt'])
    };
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
        ? `${String(row['incident_type'] ?? 'Other')} · ${String(row['location_text'] ?? '')}`
        : row['shelter_id']
          ? `${row['resident_occupancy'] ?? row['current_occupancy'] ?? 0}/${row['capacity'] ?? 0} residents · ${row['location_text'] ?? ''}`
          : row['volunteer_id']
            ? String(row['assigned_zone_id'] ? `Assigned zone: ${row['assigned_zone_id']}` : row['email'] ?? 'Unassigned')
            : row['route_id']
              ? String(row['description'] ?? `Shelter: ${row['destination_shelter_id'] ?? ''}`)
              : row['emergency_contact_id']
                ? String(row['phone_number'] ?? row['email'] ?? '')
                : row['resident_id']
                  ? `${row['household_number'] ?? 'No household'} · ${row['zone_name'] ?? 'No zone'} · ${row['household_address'] ?? row['address_line'] ?? 'No address'}`
                  : String(row['email'] ?? row['address_line'] ?? row['message'] ?? row['location_text'] ?? values[2] ?? ''),
      status: String(row['record_status'] ?? row['verification_status'] ?? row['availability_status'] ?? row['status'] ?? row['risk_level'] ?? row['role'] ?? (row['is_active'] ? 'Active' : 'Inactive')),
      updated: this.formatDate(row['source_updated_at'] ?? row['updated_at'] ?? row['source_created_at'] ?? row['created_at'])
    };
  }

  private formatDate(value: unknown) {
    if (!value) return '—';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
}
