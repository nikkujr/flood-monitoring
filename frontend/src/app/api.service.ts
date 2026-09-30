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
}

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
      .pipe(tap(() => { this.accessToken.set(null); this.user.set(null); }));
  }

  forgotPassword(email: string) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, password: string) {
    return this.http.post<void>(`${this.baseUrl}/auth/reset-password`, { token, password });
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

  assignResidents(shelterId: string, residentIds: string[], evacuationAt: string) {
    return this.http.post<{ message: string; assignedCount: number }>(`${this.baseUrl}/shelters/${shelterId}/assignments`, { residentIds, evacuationAt });
  }

  returnResidentHome(residentId: string, returnedAt: string) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/residents/${residentId}/return-home`, { returnedAt });
  }

  updateReportStatus(id: string, body: { status: string; severityLevel: string; validationNotes?: string; zoneIds: string[] }) {
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
