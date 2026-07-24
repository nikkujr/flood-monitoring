import { AfterViewInit, Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import * as L from 'leaflet';
import { ApiService } from './api.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-live-map',
  standalone: true,
  template: '<div class="leaflet-host" [class.full]="full" [class.viewport]="viewport" [id]="mapId" aria-label="Live flood map"></div>',
  styles: [`:host{display:block}.leaflet-host{height:360px;width:100%;border-radius:12px;overflow:hidden}.leaflet-host.full{height:min(68vh,720px)}.leaflet-host.viewport{height:100%;min-height:520px}`]
})
export class LiveMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() full = false;
  @Input() viewport = false;
  @Input() focusRecord?: { id: string; resource: string; record: Record<string, unknown>; nonce: number };
  @Input() visibleLayers?: { barangayZones: boolean; shelters: boolean; riskZones: boolean; incidents?: boolean; routes?: boolean };
  @Output() dataUpdated = new EventEmitter<Record<string, unknown>>();
  @Output() incidentSelected = new EventEmitter<Record<string, unknown>>();
  readonly mapId = `bantay-map-${Math.random().toString(36).slice(2)}`;
  private map?: L.Map;
  private overlay = L.layerGroup();
  private focusOverlay = L.layerGroup();
  private timer?: number;
  private lastData?: Record<string, any>;

  constructor(private readonly api: ApiService) {}

  ngAfterViewInit() {
    this.map = L.map(this.mapId).setView([13.7795, 122.8708], 15);
    L.tileLayer(environment.mapTileUrl, {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(this.map);
    this.overlay.addTo(this.map);
    this.focusOverlay.addTo(this.map);
    this.refresh();
    this.focusSelectedRecord();
    this.timer = window.setInterval(() => this.refresh(), 30_000);
  }

  ngOnDestroy() {
    if (this.timer) window.clearInterval(this.timer);
    this.map?.remove();
  }

  ngOnChanges() {
    if (this.lastData) this.render(this.lastData);
    this.focusSelectedRecord();
  }

  private refresh() {
    this.api.liveMap().subscribe({
      next: (value) => {
        this.lastData = value as Record<string, any>;
        this.render(this.lastData);
        this.dataUpdated.emit(value as Record<string, unknown>);
      },
      error: () => undefined
    });
  }

  private focusSelectedRecord() {
    if (!this.map || !this.focusRecord) return;
    const { resource, record } = this.focusRecord;
    this.focusOverlay.clearLayers();
    if (resource === 'shelters' || resource === 'reports') {
      const latitude = Number(record['latitude']);
      const longitude = Number(record['longitude']);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const location = L.latLng(latitude, longitude);
      L.circleMarker(location, { radius: 15, color: '#0758c7', weight: 4, fillColor: resource === 'shelters' ? '#18895c' : '#e6a625', fillOpacity: .65 }).addTo(this.focusOverlay);
      this.map.setView(location, Math.max(this.map.getZoom(), 17), { animate: true });
      return;
    }
    if (resource === 'barangay-zones' || resource === 'risk-zones' || resource === 'evacuation-routes') {
      try {
        const value = resource === 'evacuation-routes'
          ? record['route_geojson'] ?? record['routeGeoJson']
          : record['polygon_geojson'] ?? record['polygonGeoJson'];
        const geo = typeof value === 'string' ? JSON.parse(value) : value;
        const layer = L.geoJSON(geo as any, { style: { color: resource === 'evacuation-routes' ? '#6e49b8' : '#0758c7', weight: 5, fillColor: '#75a9e8', fillOpacity: .2 } }).addTo(this.focusOverlay);
        this.map.fitBounds(layer.getBounds(), { padding: [35, 35], maxZoom: 17, animate: true });
      } catch {
        return;
      }
    }
  }

  private render(data: Record<string, any>) {
    if (!this.map) return;
    this.overlay.clearLayers();
    const riskColors: Record<string, string> = { Low: '#43a267', Medium: '#e6a625', High: '#d95050' };
    if (this.visibleLayers?.barangayZones !== false) for (const zone of data['zones'] ?? []) {
      const geo = typeof zone.polygon_geojson === 'string' ? JSON.parse(zone.polygon_geojson) : zone.polygon_geojson;
      L.geoJSON(geo, { style: { color: '#1764c1', fillColor: '#ffffff', fillOpacity: .04, weight: 3, dashArray: '8 5' } })
        .bindPopup(`<strong>${this.escape(zone.zone_name)}</strong><br>Barangay zone`)
        .addTo(this.overlay);
    }
    if (this.visibleLayers?.riskZones !== false) for (const zone of data['riskZones'] ?? []) {
      const geo = typeof zone.polygon_geojson === 'string' ? JSON.parse(zone.polygon_geojson) : zone.polygon_geojson;
      L.geoJSON(geo, { style: { color: riskColors[zone.risk_level] ?? '#3176bd', fillOpacity: .28, weight: 2 } })
        .bindPopup(`<strong>${this.escape(zone.risk_zone_name)}</strong><br>${this.escape(zone.risk_level)} risk`)
        .addTo(this.overlay);
    }
    if (this.visibleLayers?.shelters !== false) for (const shelter of data['shelters'] ?? []) this.marker(shelter.latitude, shelter.longitude, '#18895c', '⌂', `<strong>${this.escape(shelter.shelter_name)}</strong><br>${shelter.current_occupancy}/${shelter.capacity} occupied`);
    if (this.visibleLayers?.incidents !== false) for (const report of data['reports'] ?? []) {
      const isMajorIncident = report.severity_level === 'Major Incident';
      this.marker(
        report.latitude,
        report.longitude,
        isMajorIncident ? '#d95050' : '#e6a625',
        '!',
        '',
        isMajorIncident
      ).on('click', () => this.incidentSelected.emit(report));
    }
    if (this.visibleLayers?.routes !== false) for (const route of data['routes'] ?? []) {
      const geo = typeof route.route_geojson === 'string' ? JSON.parse(route.route_geojson) : route.route_geojson;
      L.geoJSON(geo, { style: { color: '#6e49b8', weight: 4, dashArray: '7 6' } }).bindPopup(this.escape(route.route_name)).addTo(this.overlay);
    }
  }

  private marker(lat: unknown, lng: unknown, color: string, symbol: string, popup: string, pulse = false) {
    const marker = L.marker([Number(lat), Number(lng)], {
      icon: L.divIcon({
        className: pulse ? 'major-incident-marker' : '',
        html: `<span class="incident-map-marker" style="background:${color}">${symbol}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    }).addTo(this.overlay);
    if (popup) marker.bindPopup(popup);
    return marker;
  }

  private escape(value: unknown) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  }

}
