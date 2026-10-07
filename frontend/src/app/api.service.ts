import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { tap } from 'rxjs';
import { environment } from '../environments/environment';
import type { DssData } from './dss.models';

export interface SessionUser {
  userId: string;
  fullName: string;
  username: string;
  email: string;
  role: 'Super Admin' | 'Disaster Officer' | 'Data Encoder';
  mustChangePassword: boolean;
}
export interface ZoneStatusPreview {
  zone: string; risk: string; revision: string; eligibleCount: number; evacuatedCount: number; inactiveCount: number;
  statusCounts: Record<string, number>;
  residents: { id: string; name: string; household: string; status: string; recordStatus: string }[];
}
export interface ReportReview {
  review_id:number; from_status:string; to_status:string; severity_level:string; notes:string;
  affected_zones:string[]; reviewer_name:string; created_at:string;
}
export interface FloodReportDetails extends Record<string,unknown> {reviews:ReportReview[];allowed_statuses:string[]}
export interface HouseholdDetails {
  household:{household_id:string;household_number:string;head_of_household_name:string;address_line:string;contact_number:string;verification_status:string;updated_at:string;zone_name:string};
  members:{id:string;name:string;relationship:string;status:string;recordStatus:string;priority:string;vulnerabilities:string[];assistance:string[];shelter:string|null;updatedAt:string;flags:string[];needsAssistance:boolean}[];
}
export interface ResidentDetails {resident:Record<string,any>;vulnerabilities:string[];flags:string[];needsAssistance:boolean;history:{assignment_id:string;action:string;evacuation_at:string;created_at:string;shelter_name:string|null;recorded_by:string|null}[]}

export interface WeatherData {
  location: string;
  timezone: string;
  updatedAt: string;
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    precipitation: number;
    rain: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  forecast: Array<{ date: string; weatherCode: number; temperatureMax: number; temperatureMin: number; precipitationProbability: number; precipitation: number }>;
  source: string;
}

export interface ResidentYearSummary {
  totalResidents: number;
  totalHouseholds: number;
  vulnerableResidents: number;
  highPriorityResidents: number;
  seniorCitizens: number;
  children: number;
  personsWithDisability: number;
  pregnantResidents: number;
  residentsWithMorbidity: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = environment.apiBaseUrl;
  readonly accessToken = signal<string | null>(null);
  readonly user = signal<SessionUser | null>(null);

  constructor(private readonly http: HttpClient) {}

  clearSession() {
    this.accessToken.set(null);
    this.user.set(null);
  }

  login(username: string, password: string) {
    return this.http.post<{ accessToken: string; user: SessionUser }>(
      `${this.baseUrl}/auth/login`, { username, password }, { withCredentials: true }
    ).pipe(tap(({ accessToken, user }) => {
      this.accessToken.set(accessToken);
      this.user.set(user);
    }));
  }

  refresh() {
    return this.http.post<{ accessToken: string; user: SessionUser }>(
      `${this.baseUrl}/auth/refresh`, {}, { withCredentials: true }
    ).pipe(tap(({ accessToken, user }) => {
      this.accessToken.set(accessToken);
      this.user.set(user);
    }));
  }

  logout() {
    return this.http.post<void>(`${this.baseUrl}/auth/logout`, {}, { withCredentials: true })
      .pipe(tap(() => this.clearSession()));
  }

  forgotPassword(email: string) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, password: string) {
    return this.http.post<void>(`${this.baseUrl}/auth/reset-password`, { token, password });
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.http.post<{ accessToken: string; user: SessionUser }>(
      `${this.baseUrl}/auth/change-password`, { currentPassword, newPassword }, { withCredentials: true }
    ).pipe(tap(({ accessToken, user }) => {
      this.accessToken.set(accessToken);
      this.user.set(user);
    }));
  }

  generateTemporaryPassword(id: string) {
    return this.http.post<{ temporaryPassword: string }>(`${this.baseUrl}/users/${id}/temporary-password`, {});
  }

  list<T>(resource: string, page = 1, pageSize = 20, search = '', sortBy = '', sortOrder: 'asc' | 'desc' = 'desc', filters: Record<string, string> = {}) {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize).set('search', search).set('sortOrder', sortOrder);
    if (sortBy) params = params.set('sortBy', sortBy);
    for (const [name, value] of Object.entries(filters)) if (value) params = params.set(`filter_${name}`, value);
    return this.http.get<{ items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number }>(
      `${this.baseUrl}/${resource}`, { params }
    );
  }

  get<T>(resource: string, id: string) {
    return this.http.get<T>(`${this.baseUrl}/${resource}/${id}`);
  }

  create<T>(resource: string, body: Record<string, unknown>) {
    return this.http.post<T>(`${this.baseUrl}/${resource}`, body);
  }

  update(resource: string, id: string, body: Record<string, unknown>) {
    return this.http.put<void>(`${this.baseUrl}/${resource}/${id}`, body);
  }

  delete(resource: string, id: string) {
    return this.http.delete<void>(`${this.baseUrl}/${resource}/${id}`);
  }

  residentsByYear<T>(year: number, page = 1, pageSize = 20, search = '', sortBy = '', sortOrder: 'asc' | 'desc' = 'asc', filters: Record<string, string> = {}) {
    let params = new HttpParams().set('year', year).set('page', page).set('pageSize', pageSize).set('search', search).set('sortOrder', sortOrder);
    if (sortBy) params = params.set('sortBy', sortBy);
    for (const [name, value] of Object.entries(filters)) if (value) params = params.set(`filter_${name}`, value);
    return this.http.get<{ items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number; year: number; currentYear: number; availableYears: number[]; summary: ResidentYearSummary }>(
      `${this.baseUrl}/residents/yearly`, { params }
    );
  }

  assignResidents(shelterId: string, residentIds: string[], evacuationAt: string, evacuationStatus: 'Safe' | 'For Monitoring' | 'For Evacuation' | 'Evacuated', expectedStatuses?:Record<string,string>) {
    return this.http.post<{ message: string; assignedCount: number }>(`${this.baseUrl}/shelters/${shelterId}/assignments`, { residentIds, evacuationAt, evacuationStatus, expectedStatuses });
  }

  simulateDecisionSupport(scenario:{zoneId?:string;additionalMajorReports:number;unavailableShelterIds:string[]}) {
    return this.http.post<{baseline:DssData;simulated:DssData}>(`${this.baseUrl}/statistics/dss/simulation`,scenario);
  }

  previewZoneResidentStatus(zoneId: string) {
    return this.http.get<ZoneStatusPreview>(`${this.baseUrl}/statistics/dss/zones/${zoneId}/resident-status`);
  }

  markZoneResidents(zoneId: string, status: string, revision: string, residentIds: string[]) {
    return this.http.post<{ message: string; updatedCount: number }>(`${this.baseUrl}/statistics/dss/zones/${zoneId}/resident-status`, { status, revision, residentIds });
  }

  returnResidentHome(residentId: string, returnedAt: string) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/residents/${residentId}/return-home`, { returnedAt });
  }

  updateReportStatus(id: string, body: { expectedStatus:string; status: string; severityLevel: string; validationNotes?: string; zoneIds: string[] }) {
    return this.http.put<void>(`${this.baseUrl}/flood-reports/${id}/status`, body);
  }

  pendingFloodReportCount() {
    return this.http.get<{ pendingCount: number }>(`${this.baseUrl}/flood-reports/pending-count`);
  }

  reportPhoto(reportId: string, index: number) {
    return this.http.get(`${this.baseUrl}/flood-reports/${reportId}/photos/${index}`, { responseType: 'blob' });
  }

  publicReportPhotoUrl(reportId: unknown, index: number) {
    return `${this.baseUrl}/flood-reports/public/${encodeURIComponent(String(reportId))}/photos/${index}`;
  }

  sendNotification(id: string) { return this.http.post<void>(`${this.baseUrl}/notifications/${id}/send`, {}); }
  archiveNotification(id: string) { return this.http.post<void>(`${this.baseUrl}/notifications/${id}/archive`, {}); }
  setNotificationRead(id: string, isRead: boolean) { return this.http.put<void>(`${this.baseUrl}/notifications/${id}/read-status`, { isRead }); }
  setUserActive(id: string, isActive: boolean) { return this.http.put<void>(`${this.baseUrl}/users/${id}/active-status`, { isActive }); }
  initiateUserPasswordReset(id: string) { return this.http.post<{ message: string }>(`${this.baseUrl}/users/${id}/reset-password`, {}); }

  liveMap() { return this.http.get(`${this.baseUrl}/map/live`); }
  currentWeather() { return this.http.get<WeatherData>(`${this.baseUrl}/weather/current`); }
  dashboardSummary() {
    return this.http.get<{
      totalResidents: number;
      totalHouseholds: number;
      vulnerableResidents: number;
      highPriorityResidents: number;
      mediumPriorityResidents: number;
      lowPriorityResidents: number;
      totalZones: number;
      activeReports: number;
      pendingReports: number;
      forEvacuationResidents: number;
      nearCapacityShelters: number;
    }>(`${this.baseUrl}/dashboard/summary`);
  }

  dashboardReports() {
    return this.http.get<{ items: Record<string, unknown>[] }>(`${this.baseUrl}/dashboard/recent-reports`);
  }

  dashboardAlert() {
    return this.http.get<{ alert: Record<string, unknown> | null }>(`${this.baseUrl}/dashboard/alert`);
  }

  dashboardNotifications() {
    return this.http.get<{ items: Record<string, unknown>[] }>(`${this.baseUrl}/dashboard/notifications`);
  }

  publicReports() {
    return this.http.get<{ items: Record<string, unknown>[] }>(`${this.baseUrl}/flood-reports/public`);
  }

  publicNotifications() {
    return this.http.get<{ items: Record<string, unknown>[] }>(`${this.baseUrl}/notifications/public`);
  }

  publicEmergencyContacts() {
    return this.http.get<{ items: Record<string, unknown>[] }>(`${this.baseUrl}/emergency-contacts/public`);
  }

  submitFloodReport(form: FormData) {
    return this.http.post<{ reportId: string; trackingCode: string; status: string; zoneId: string | null; zoneName: string | null }>(`${this.baseUrl}/flood-reports`, form);
  }

  statistics(resource: 'risk-summary' | 'zone-breakdown' | 'evacuation-priorities') {
    return this.http.get<Record<string, unknown>>(`${this.baseUrl}/statistics/${resource}`);
  }

  decisionSupport(filters: Record<string, string>) {
    let params = new HttpParams();
    for (const [name, value] of Object.entries(filters)) if (value) params = params.set(name, value);
    return this.http.get<DssData>(`${this.baseUrl}/statistics/dss`, { params });
  }

}
