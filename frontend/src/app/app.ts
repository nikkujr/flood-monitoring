import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { finalize, forkJoin } from 'rxjs';
import { ApiService } from './api.service';
import { LiveMapComponent } from './live-map.component';
import { PolygonEditorComponent } from './polygon-editor.component';
import { LocationPickerComponent } from './location-picker.component';

type PageId = 'dashboard' | 'map' | 'reports' | 'residents' | 'households' | 'evacuation' | 'statistics' | 'notifications' | 'users';
type PublicPage = 'home' | 'map' | 'report' | 'login';
type EditorOption = { value: string; label: string };
type EditorField = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'date' | 'textarea' | 'select' | 'multiselect' | 'polygon' | 'location' | 'household-lookup';
  required?: boolean;
  placeholder?: string;
  options?: EditorOption[];
};

const options = (...values: string[]): EditorOption[] => values.map((value) => ({ value, label: value }));

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LiveMapComponent, PolygonEditorComponent, LocationPickerComponent],
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
  publicMapLayers = { barangayZones: true, shelters: true, riskZones: true };
  readonly evacuationMapLayers = { barangayZones: true, shelters: true, riskZones: false, incidents: false, routes: true };
  publicMapSections = { barangayZones: true, shelters: false, riskZones: false, incidents: false, announcements: false };
  readonly incidentTypes = ['River Flooding', 'Flash Flood', 'Road Flooding', 'Drainage Overflow', 'Rising Water', 'Other'];
  readonly incidentLevels = ['Information', 'Minor Incident', 'Major Incident'];
  selectedPublicMapFocus?: { id: string; resource: string; record: Record<string, unknown>; nonce: number };
  selectedPublicIncident?: Record<string, unknown>;
  today = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
  readonly liveNow = signal(new Date());
  private clockTimer?: number;
  private publicToastTimer?: number;

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
    { label: 'TOTAL RESIDENTS', value: '1,248', note: '↑ 12 this month', icon: '♙', color: '#0066dc', tint: '#e9f3ff' },
    { label: 'HOUSEHOLDS', value: '386', note: 'Across 5 zones', icon: '⌑', color: '#7147c9', tint: '#f1ebff' },
    { label: 'VULNERABLE RESIDENTS', value: '94', note: '14 high priority', icon: '♡', color: '#cf7a00', tint: '#fff3dc', warn: true },
    { label: 'ACTIVE FLOOD REPORTS', value: '3', note: '1 needs review', icon: '!', color: '#d64545', tint: '#ffebeb', warn: true }
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
      'flood-reports': [{ label: 'RECORD', field: 'location_text' }, { label: 'DETAILS', field: 'severity_level' }, { label: 'STATUS', field: 'status' }, { label: 'UPDATED', field: 'updated_at' }],
      'barangay-zones': [{ label: 'MAP RECORD', field: 'zone_name' }, { label: 'DETAILS', field: 'updated_at' }, { label: 'STATUS', field: 'zone_name' }, { label: 'UPDATED', field: 'updated_at' }],
      'risk-zones': [{ label: 'MAP RECORD', field: 'risk_zone_name' }, { label: 'DETAILS', field: 'risk_level' }, { label: 'STATUS', field: 'risk_level' }, { label: 'UPDATED', field: 'updated_at' }],
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
      { name: 'currentOccupancy', label: 'Current occupancy', type: 'number', required: true }, { name: 'contactPerson', label: 'Contact person', required: true },
      { name: 'contactNumber', label: 'Contact number', required: true }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: options('Available', 'Near Capacity', 'Full', 'Unavailable') }
    ];
    if (this.activePage === 'evacuation' && this.currentResource === 'volunteers') return [
      { name: 'fullName', label: 'Full name', required: true }, { name: 'contactNumber', label: 'Contact number', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'assignedZoneId', label: 'Assigned zone', type: 'select', options: this.zoneOptions },
      { name: 'availabilityStatus', label: 'Availability', type: 'select', required: true, options: options('Available', 'Assigned', 'Unavailable') },
      { name: 'notes', label: 'Notes', type: 'textarea' }
    ];
    if (this.activePage === 'evacuation' && this.currentResource === 'emergency-contacts') return [
      { name: 'organizationName', label: 'Organization', required: true }, { name: 'contactPerson', label: 'Contact person' },
      { name: 'phoneNumber', label: 'Phone number', required: true }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'isPublic', label: 'Public visibility', type: 'select', required: true, options: [{ value: 'true', label: 'Public' }, { value: 'false', label: 'Internal only' }] },
      { name: 'status', label: 'Status', type: 'select', required: true, options: options('Active', 'Inactive') }
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
        { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
        { name: 'sex', label: 'Sex', type: 'select', required: true, options: options('Female', 'Male', 'Intersex', 'Prefer not to say') },
        { name: 'contactNumber', label: 'Contact number' }, { name: 'addressLine', label: 'Address', required: true },
        { name: 'vulnerabilityType', label: 'Vulnerability', type: 'select', options: options('Elderly', 'Child', 'Disability', 'Pregnant', 'Mobility-limited') },
        { name: 'priorityLevel', label: 'Priority level', type: 'select', required: true, options: options('Low', 'Medium', 'High') },
        { name: 'evacuationStatus', label: 'Evacuation status', type: 'select', required: true, options: options('Safe', 'For Monitoring', 'For Evacuation', 'Evacuated') }
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
        { name: 'polygonGeoJson', label: 'Boundary', type: 'polygon', required: true },
        { name: 'description', label: 'Description', type: 'textarea' }
      ],
      evacuation: [
        { name: 'shelterName', label: 'Shelter name', required: true },
        { name: 'zoneId', label: 'Zone', type: 'select', required: true, options: this.zoneOptions },
        { name: 'locationText', label: 'Location description', required: true },
        { name: 'locationPicker', label: 'Map location', type: 'location', required: true },
        { name: 'capacity', label: 'Capacity', type: 'number', required: true },
        { name: 'currentOccupancy', label: 'Current occupancy', type: 'number', required: true }, { name: 'contactPerson', label: 'Contact person', required: true },
        { name: 'contactNumber', label: 'Contact number', required: true }, { name: 'email', label: 'Email', type: 'email' },
        { name: 'status', label: 'Status', type: 'select', required: true, options: options('Available', 'Near Capacity', 'Full', 'Unavailable') }
      ],
      notifications: [
        { name: 'title', label: 'Title', required: true }, { name: 'message', label: 'Message', type: 'textarea', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: options('Flood Advisory', 'Evacuation Notice', 'Safety Advisory', 'System Update') },
        { name: 'severityLevel', label: 'Severity', type: 'select', required: true, options: options('Information', 'Minor Incident', 'Major Incident') },
        { name: 'targetAudience', label: 'Target audience', type: 'select', required: true, options: options('Public', 'Affected Zones', 'Internal Admin Users') },
        { name: 'zoneIds', label: 'Zone IDs', placeholder: 'Comma-separated for Affected Zones' }
      ],
      reports: [
        { name: 'status', label: 'New status', type: 'select', required: true, options: options('Under Review', 'Validated', 'Rejected', 'Resolved') },
        { name: 'severityLevel', label: 'Incident level', type: 'select', required: true, options: options('Information', 'Minor Incident', 'Major Incident') },
        { name: 'validationNotes', label: 'Reviewer notes', type: 'textarea', required: true },
        { name: 'zoneIds', label: 'Affected Barangay Zones', type: 'multiselect', required: true, options: this.zoneOptions }
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
    if (this.publicToastTimer) window.clearTimeout(this.publicToastTimer);
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
      reports: this.api.publicReports()
    }).subscribe({
      next: ({ notifications, contacts, reports }) => {
        this.publicNotifications = notifications.items;
        this.publicContacts = contacts.items;
        this.publicReports = reports.items;
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
  }

  focusAnnouncement(notice: Record<string, unknown>) {
    const reportId = notice['flood_report_id'];
    const report = (this.publicMapData['reports'] ?? []).find((item: Record<string, unknown>) => item['report_id'] === reportId);
    if (!report) return;
    this.selectedPublicMapFocus = { id: String(report['report_id']), resource: 'reports', record: report, nonce: Date.now() };
  }

  openPublicIncident(report: Record<string, unknown>) {
    this.selectedPublicIncident = report;
  }

  closePublicIncident() {
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
    const form = new FormData();
    form.set('locationText', location);
    form.set('incidentType', incidentType);
    form.set('severityLevel', severityLevel);
    form.set('latitude', latitude);
    form.set('longitude', longitude);
    form.set('description', description);
    if (reporterName) form.set('reporterName', reporterName);
    if (reporterContact) form.set('reporterContactInfo', reporterContact);
    for (const photo of Array.from(photos ?? [])) form.append('photos', photo);
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
      reports: this.api.dashboardReports(),
      alert: this.api.dashboardAlert(),
      notifications: this.api.dashboardNotifications(),
      shelters: this.api.list<Record<string, unknown>>('shelters', 1, 3),
      risk: this.api.statistics('risk-summary'),
      priorities: this.api.statistics('evacuation-priorities')
    }).pipe(finalize(() => this.finishLoading())).subscribe({
      next: ({ summary, reports, alert, notifications, shelters, risk, priorities }) => {
        this.metrics[0]!.value = String(summary.totalResidents ?? 0);
        this.metrics[0]!.note = `${summary.highPriorityResidents ?? 0} high-priority residents`;
        this.metrics[1]!.value = String(summary.totalHouseholds ?? 0);
        this.metrics[1]!.note = `Across ${summary.totalZones ?? 0} barangay zones`;
        this.metrics[2]!.value = String(summary.vulnerableResidents ?? 0);
        this.metrics[2]!.note = `${summary.highPriorityResidents ?? 0} marked high priority`;
        this.metrics[3]!.value = String(summary.activeReports ?? 0);
        this.metrics[3]!.note = `${summary.pendingReports ?? 0} awaiting review`;
        this.reports = reports.items.map((row) => this.mapReport(row));
        this.dashboardAlert = alert.alert ?? undefined;
        this.dashboardNotifications = notifications.items;
        this.overallRisk = String(risk['overallRiskLevel'] ?? 'Low');
        this.activeValidatedReports = Number(risk['activeValidatedReports'] ?? 0);
        this.affectedZones = Number(risk['affectedZones'] ?? 0);
        this.priorityResidents = ((priorities['items'] as unknown[] | undefined) ?? []).length;
        this.shelters = shelters.items.map((row) => ({
          name: String(row['shelter_name'] ?? row['shelterName'] ?? 'Shelter'),
          used: Number(row['current_occupancy'] ?? row['currentOccupancy'] ?? 0),
          capacity: Number(row['capacity'] ?? 0),
          percent: Number(row['capacity']) > 0
            ? Math.round(Number(row['current_occupancy'] ?? row['currentOccupancy'] ?? 0) / Number(row['capacity']) * 100)
            : 0
        }));
      },
      error: (error) => this.errorMessage = error?.error?.message ?? 'Dashboard data could not be loaded.'
    });
  }

  openDashboardReports() {
    if (this.canReviewReports) this.setPage('reports');
  }

  openDashboardNotifications() {
    if (this.canReviewReports) this.setPage('notifications');
  }

  setPage(page: PageId, updateHistory = true) {
    this.activePage = page;
    this.requestedAdminPage = page;
    const path = `/admin/${page}`;
    if (updateHistory && window.location.pathname !== path) window.history.pushState({}, '', path);
    sessionStorage.setItem('bantayBahaRoute', path);
    this.menuOpen = false;
    if (page === 'dashboard') return this.loadDashboard();
    if (page === 'map') {
      this.currentResource = 'barangay-zones';
      this.page = 1;
      this.sortBy = '';
      this.loadResource();
      return;
    }
    if (page === 'statistics') {
      this.currentResource = 'statistics';
      this.sortBy = '';
      this.loading = true;
      forkJoin({
        summary: this.api.statistics('risk-summary'),
        zones: this.api.statistics('zone-breakdown'),
        priorities: this.api.statistics('evacuation-priorities')
      }).pipe(finalize(() => this.finishLoading())).subscribe({
        next: ({ summary, zones, priorities }) => {
          const zoneItems = (zones['items'] as Record<string, unknown>[] | undefined) ?? [];
          const priorityItems = (priorities['items'] as Record<string, unknown>[] | undefined) ?? [];
          this.tableRows = [
            { name: `Overall risk: ${summary['overallRiskLevel']}`, id: 'CURRENT RISK', detail: `${summary['activeValidatedReports']} validated reports`, status: String(summary['overallRiskLevel']), updated: 'Live' },
            ...zoneItems.map((row, index) => this.mapTableRow(row, index)),
            ...priorityItems.map((row, index) => this.mapTableRow(row, index))
          ];
        },
        error: (error) => this.errorMessage = error?.error?.message ?? 'Decision-support data could not be loaded.'
      });
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
    this.sortBy = '';
    this.loadResource();
  }

  selectResource(resource: string) {
    this.currentResource = resource;
    this.selectedMapFocus = undefined;
    this.page = 1;
    this.searchTerm = '';
    this.sortBy = '';
    this.loadResource();
  }

  loadResource() {
    if (!this.currentResource) return;
    const resource = this.currentResource;
    const requestId = ++this.resourceRequestId;
    this.loading = true;
    this.tableRows = [];
    this.rawRecords.clear();
    this.api.list<Record<string, unknown>>(resource, this.page, 20, this.searchTerm, this.sortBy, this.sortOrder).pipe(finalize(() => {
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

  changePage(next: number) {
    if (next < 1 || next > this.totalPages) return;
    this.page = next;
    this.loadResource();
  }

  sortColumn(field: string) {
    if (this.sortBy === field) this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    else {
      this.sortBy = field;
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
    return this.sortBy === field ? (this.sortOrder === 'asc' ? '↑' : '↓') : '↕';
  }

  openEditor(row?: { id: string }) {
    this.clearAdminReportPhotos();
    this.householdLookupOpen = false;
    this.householdLookupQuery = '';
    this.editorId = row?.id ?? '';
    const record = row ? this.rawRecords.get(row.id) : undefined;
    this.editorValues = {};
    if (record) {
      for (const field of this.editorFields) {
        const snake = field.name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        this.editorValues[field.name] = record[field.name] ?? record[snake] ?? '';
      }
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
    }
    this.editorOpen = true;
    this.errorMessage = '';
    this.successMessage = '';
    if (this.activePage === 'residents') this.loadHouseholdOptions();
    if (this.editorFields.some((field) => ['zoneId', 'zoneIds', 'assignedZoneId', 'originZoneId'].includes(field.name))) this.loadZoneOptions();
    if (this.editorFields.some((field) => field.name === 'destinationShelterId')) this.loadShelterOptions();
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
        this.closeEditor();
        this.successMessage = `${label[0]!.toUpperCase()}${label.slice(1)} deleted successfully.`;
        this.loadResource();
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
    event.preventDefault();
    this.errorMessage = '';
    this.successMessage = '';
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;
    if (this.editorFields.some((field) => field.type === 'household-lookup')) {
      raw['householdId'] = this.editorValue('householdId');
      if (!raw['householdId']) {
        this.errorMessage = 'Select a household for this resident.';
        return;
      }
    }
    for (const field of this.editorFields) if (field.type === 'multiselect') raw[field.name] = formData.getAll(field.name).map(String);
    if (this.editorFields.some((field) => field.type === 'location') && (!raw['latitude'] || !raw['longitude'])) {
      this.errorMessage = 'Pin the shelter location on the map.';
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
    const resources: Partial<Record<PageId, string>> = { users: 'users', residents: 'residents', households: 'households', map: this.currentResource || 'barangay-zones', evacuation: this.currentResource || 'shelters', notifications: 'notifications' };
    this.loading = true;
    const request = this.activePage === 'reports'
      ? this.api.updateReportStatus(this.editorId, raw as { status: string; severityLevel: string; validationNotes: string; zoneIds: string[] })
      : this.editorId
        ? this.api.update(resources[this.activePage]!, this.editorId, raw)
        : this.api.create(resources[this.activePage]!, raw);
    request.pipe(finalize(() => this.finishLoading())).subscribe({
      next: () => {
        const operation = this.editorId ? 'updated' : 'created';
        this.closeEditor();
        this.successMessage = `Record ${operation} successfully.`;
        this.loadResource();
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

  private loadAdminReportPhotos(reportId: string, photos: unknown) {
    let count = 0;
    try {
      const values = Array.isArray(photos) ? photos : typeof photos === 'string' ? JSON.parse(photos) : [];
      count = Array.isArray(values) ? values.length : 0;
    } catch {
      count = 0;
    }
    if (!count) return;
    forkJoin(Array.from({ length: count }, (_, index) => this.api.reportPhoto(reportId, index))).subscribe({
      next: (blobs) => {
        this.clearAdminReportPhotos();
        this.adminReportPhotoUrls = blobs.map((blob) => URL.createObjectURL(blob));
        this.changeDetector.detectChanges();
      },
      error: () => this.errorMessage = 'One or more report photos could not be loaded.'
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
          ? `${row['current_occupancy'] ?? 0}/${row['capacity'] ?? 0} occupied · ${row['location_text'] ?? ''}`
          : row['volunteer_id']
            ? String(row['assigned_zone_id'] ? `Assigned zone: ${row['assigned_zone_id']}` : row['email'] ?? 'Unassigned')
            : row['route_id']
              ? String(row['description'] ?? `Shelter: ${row['destination_shelter_id'] ?? ''}`)
              : row['emergency_contact_id']
                ? String(row['phone_number'] ?? row['email'] ?? '')
                : String(row['email'] ?? row['address_line'] ?? row['message'] ?? row['location_text'] ?? values[2] ?? ''),
      status: String(row['verification_status'] ?? row['availability_status'] ?? row['status'] ?? row['risk_level'] ?? row['role'] ?? (row['is_active'] ? 'Active' : 'Inactive')),
      updated: this.formatDate(row['updated_at'] ?? row['created_at'])
    };
  }

  private formatDate(value: unknown) {
    if (!value) return '—';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
}
