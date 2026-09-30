import { AfterViewInit, Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import * as L from 'leaflet';
import GoogleMutant from 'leaflet.gridlayer.googlemutant';
import { ApiService } from './api.service';
import { environment } from '../environments/environment';

type MapStyle = 'roadmap' | 'satellite' | 'hybrid' | 'terrain';

@Component({
  selector: 'app-live-map',
  standalone: true,
  styleUrl: './live-map.component.scss',
  template: `
    <div class="map-shell" [class.full]="full" [class.viewport]="viewport">
      <div class="map-style-control" role="group" aria-label="Map style">
        <button type="button" [class.active]="mapStyle === 'roadmap'" (click)="setMapStyle('roadmap')">Roadmap</button>
        <button type="button" [class.active]="mapStyle === 'satellite'" (click)="setMapStyle('satellite')">Satellite</button>
      </div>
      <div class="leaflet-host" [id]="mapId" aria-label="Live flood map"></div>
      @if (mapLoading) { <div class="map-status" role="status">Loading map data…</div> }
      @if (mapError) { <div class="map-status error" role="alert">{{ mapError }} <button type="button" (click)="refresh()">Retry</button></div> }
      @if (full) {
        <details class="map-legend-control" open>
          <summary><span>Map legend</span><small>Visible layers</small></summary>
          <div class="legend-items" aria-label="Map symbols">
            @if (visibleLayers?.barangayZones !== false) {
              <p class="legend-group-title">Flood risk</p>
              <span><i class="legend-area low"></i><b>Low</b></span>
              <span><i class="legend-area moderate"></i><b>Moderate</b></span>
              <span><i class="legend-area high"></i><b>High</b></span>
              <span><i class="legend-area critical"></i><b>Critical</b></span>
              <span><i class="legend-line boundary"></i>Barangay boundary</span>
            }
            @if (visibleLayers?.riskZones !== false) { <span><i class="legend-area risk-zone"></i>Risk-zone overlay</span> }
            @if (visibleLayers?.incidents !== false) {
              <p class="legend-group-title">Locations & routes</p>
              <span><i class="legend-marker incident">!</i>Minor incident</span>
              <span><i class="legend-marker major">!</i>Major incident</span>
            }
            @if (visibleLayers?.shelters !== false) { <span><i class="legend-marker shelter" aria-hidden="true">⌂</i>Evacuation center</span> }
            @if (visibleLayers?.routes !== false) { <span><i class="legend-line route"></i>Evacuation route</span> }
          </div>
        </details>
      }
    </div>
  `,
  styles: [`:host{display:block}.map-shell{position:relative;height:360px;width:100%;border-radius:12px;overflow:hidden}.leaflet-host{height:100%;width:100%}.map-shell.full{height:min(68vh,720px)}.map-shell.viewport{height:100%;min-height:520px}.map-style-control{position:absolute;right:12px;top:12px;z-index:1000;display:flex;padding:3px;background:#fff;border:1px solid #d8e0ea;border-radius:8px;box-shadow:0 2px 8px #15304a2e}.map-style-control button{border:0;background:transparent;color:#40506a;border-radius:6px;padding:6px 9px;font:600 11px/1.1 inherit;cursor:pointer}.map-style-control button.active{background:#0758c7;color:#fff}.map-legend-control{position:absolute;left:12px;bottom:28px;z-index:1000;width:min(235px,calc(100% - 24px));background:#fffffff2;border:1px solid #d5dee9;border-radius:9px;box-shadow:0 3px 12px #17334f2b;color:#344861}.map-legend-control summary{padding:9px 11px;cursor:pointer;font:700 10px/1.2 inherit;list-style:none}.map-legend-control summary::-webkit-details-marker{display:none}.map-legend-control summary:after{content:'−';float:right;color:#708198}.map-legend-control:not([open]) summary:after{content:'+'}.legend-items{display:grid;grid-template-columns:1fr 1fr;gap:8px 11px;padding:0 11px 11px;border-top:1px solid #e5eaf0;padding-top:9px}.legend-items span{display:flex;align-items:center;gap:7px;min-width:0;font:500 8px/1.25 inherit}.legend-items i{display:inline-grid;place-items:center;flex:0 0 auto;font-style:normal}.legend-area{width:14px;height:10px;border-radius:2px;background:#43a26766;border:2px solid #43a267}.legend-area.moderate{background:#e6a62566;border-color:#e6a625}.legend-area.high{background:#d9505066;border-color:#d95050}.legend-area.critical{background:#8f1d2c66;border-color:#8f1d2c}.legend-area.risk-zone{background:#8b5cf64d;border-color:#8b5cf6}.legend-line{width:17px;height:0;border-top:3px dashed #1764c1}.legend-line.route{border-top-color:#6e49b8}.legend-marker{width:18px;height:18px;border-radius:50%;background:#e6a625;color:#fff;font-size:10px;font-weight:800}.legend-marker.major{background:#d95050}.legend-marker.shelter{background:#18895c}@media(max-width:600px){.map-legend-control{width:min(205px,calc(100% - 24px))}.legend-items{grid-template-columns:1fr}.legend-items span{font-size:9px}}`]
})
export class LiveMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() full = false;
  @Input() viewport = false;
  @Input() showLabels = false;
  @Input() refreshNonce = 0;
  @Input() focusRecord?: { id: string; resource: string; record: Record<string, unknown>; nonce: number };
  @Input() visibleLayers?: { barangayZones: boolean; shelters: boolean; riskZones: boolean; incidents?: boolean; routes?: boolean };
  @Output() dataUpdated = new EventEmitter<Record<string, unknown>>();
  @Output() incidentSelected = new EventEmitter<Record<string, unknown>>();
  readonly mapId = `bantay-map-${Math.random().toString(36).slice(2)}`;
  private map?: L.Map;
  private overlay = L.layerGroup();
  private focusOverlay = L.layerGroup();
  private timer?: number;
  private resizeObserver?: ResizeObserver;
  private resizeFrame?: number;
  private lastData?: Record<string, any>;
  private officialBoundary?: GeoJSON.GeoJsonObject;
  private boundaryFitted = false;
  private visibleLayerKey = '';
  mapStyle: MapStyle = 'roadmap';
  mapLoading = true;
  mapError = '';
  private fallbackLayers?: Partial<Record<MapStyle, L.TileLayer>>;
  private googleLayers: Partial<Record<MapStyle, L.Layer>> = {};
  private activeBaseLayer?: L.Layer;
  private satelliteLabels?: L.TileLayer;

  constructor(private readonly api: ApiService) {}

  ngAfterViewInit() {
    this.map = L.map(this.mapId, {
      minZoom: environment.mapMinZoom,
      maxZoom: Math.min(environment.mapMaxZoom, 18)
    }).setView(environment.mapCenter, environment.mapInitialZoom);
    const mapElement = document.getElementById(this.mapId);
    if (mapElement && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.resizeFrame) window.cancelAnimationFrame(this.resizeFrame);
        this.resizeFrame = window.requestAnimationFrame(() => this.map?.invalidateSize({ pan: false }));
      });
      this.resizeObserver.observe(mapElement);
    }
    const roadmapLayer = L.tileLayer(environment.mapTileUrl, {
      maxZoom: 18,
      attribution: '© Esri, HERE, Garmin, FAO, NOAA, USGS, and contributors'
    });
    const satelliteLayer = L.tileLayer(environment.mapSatelliteTileUrl, {
      maxZoom: 18,
      attribution: '© Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    });
    const terrainLayer = L.tileLayer(environment.mapTileUrl, {
      maxZoom: 18,
      attribution: '© Esri, HERE, Garmin, FAO, NOAA, USGS, and contributors'
    });
    this.satelliteLabels = L.tileLayer(environment.mapSatelliteLabelsTileUrl, {
      maxZoom: 18,
      opacity: .9,
      attribution: '© Esri'
    });
    L.tileLayer(environment.mapHydroTileUrl, {
      maxZoom: 18,
      opacity: .85,
      attribution: '© Esri'
    }).addTo(this.map);
    this.fallbackLayers = { roadmap: roadmapLayer, satellite: satelliteLayer, hybrid: satelliteLayer, terrain: terrainLayer };
    roadmapLayer.addTo(this.map);
    this.activeBaseLayer = roadmapLayer;
    this.overlay.addTo(this.map);
    this.focusOverlay.addTo(this.map);
    this.refresh();
    this.focusSelectedRecord();
    this.timer = window.setInterval(() => this.refresh(), 30_000);
  }

  ngOnDestroy() {
    if (this.timer) window.clearInterval(this.timer);
    this.resizeObserver?.disconnect();
    if (this.resizeFrame) window.cancelAnimationFrame(this.resizeFrame);
    this.map?.remove();
  }

  ngOnChanges() {
    if (this.map && this.refreshNonce) this.refresh();
    if (this.map) this.render(this.lastData ?? {});
    this.focusSelectedRecord();
  }

  async setMapStyle(style: MapStyle, force = false) {
    if (!this.map || !this.fallbackLayers || (!force && this.mapStyle === style)) return;
    let nextLayer: L.Layer;
    let useFallback = false;
    try {
      if (!environment.googleMapsApiKey) throw new Error('Google Maps API key is not configured');
      await this.loadGoogleMapsApi();
      this.googleLayers[style] ??= new GoogleMutant({ type: style, maxZoom: 18 });
      nextLayer = this.googleLayers[style]!;
    } catch {
      nextLayer = this.fallbackLayers[style]!;
      useFallback = true;
    }
    nextLayer.addTo(this.map);
    if (this.activeBaseLayer && this.activeBaseLayer !== nextLayer) this.activeBaseLayer.remove();
    this.satelliteLabels?.remove();
    if (useFallback && (style === 'satellite' || style === 'hybrid')) this.satelliteLabels?.addTo(this.map);
    this.activeBaseLayer = nextLayer;
    this.mapStyle = style;
  }

  private loadGoogleMapsApi() {
    if ((window as any).google?.maps) return Promise.resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps-api]');
    if (existing) return new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Maps API failed to load')), { once: true });
    });
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(environment.googleMapsApiKey)}`;
      script.async = true;
      script.defer = true;
      script.dataset['googleMapsApi'] = 'true';
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Google Maps API failed to load')), { once: true });
      document.head.appendChild(script);
    });
  }

  refresh() {
    this.mapLoading = !this.lastData;
    this.mapError = '';
    this.api.liveMap().subscribe({
      next: (value) => {
        this.mapLoading = false;
        this.lastData = value as Record<string, any>;
        this.render(this.lastData);
        this.dataUpdated.emit(value as Record<string, unknown>);
      },
      error: () => { this.mapLoading = false; this.mapError = 'Map data could not be loaded.'; }
    });
  }

  private focusSelectedRecord() {
    if (!this.map) return;
    this.focusOverlay.clearLayers();
    if (!this.focusRecord) return;
    const { resource, record } = this.focusRecord;
    if (resource === 'shelters' || resource === 'reports') {
      const latitude = Number(record['latitude']);
      const longitude = Number(record['longitude']);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const location = L.latLng(latitude, longitude);
      L.circleMarker(location, { radius: 15, color: '#0758c7', weight: 4, fillColor: resource === 'shelters' ? '#18895c' : '#e6a625', fillOpacity: .65 }).addTo(this.focusOverlay);
      this.map.flyTo(location, Math.max(this.map.getZoom(), 17));
      return;
    }
    if (resource === 'barangay-zones' || resource === 'risk-zones' || resource === 'evacuation-routes') {
      try {
        const value = resource === 'evacuation-routes'
          ? record['route_geojson'] ?? record['routeGeoJson']
          : record['polygon_geojson'] ?? record['polygonGeoJson'];
        const geo = typeof value === 'string' ? JSON.parse(value) : value;
        const layer = L.geoJSON(geo as any, { style: { color: resource === 'evacuation-routes' ? '#6e49b8' : '#0758c7', weight: 5, fillColor: '#75a9e8', fillOpacity: .2 } }).addTo(this.focusOverlay);
      } catch {
        return;
      }
    }
  }

  private render(data: Record<string, any>) {
    if (!this.map) return;
    const visibleLayerKey = JSON.stringify(this.visibleLayers ?? {});
    if (visibleLayerKey !== this.visibleLayerKey) {
      this.visibleLayerKey = visibleLayerKey;
      this.boundaryFitted = false;
    }
    this.overlay.clearLayers();
    if (this.visibleLayers?.barangayZones !== false) this.drawOfficialBoundary();
    const visibleBounds = this.visibleLayers?.barangayZones !== false && this.officialBoundary
      ? L.geoJSON(this.officialBoundary).getBounds()
      : L.latLngBounds([]);
    const riskColors: Record<string, string> = { Low: '#43a267', Medium: '#e6a625', Moderate: '#e6a625', High: '#d95050', Critical: '#8f1d2c' };
    const zoneBoundaryColors = ['#1764c1', '#8b5cf6', '#0f9f9a', '#d97706', '#dc4567', '#4d7c0f', '#0891b2'];
    if (this.visibleLayers?.barangayZones !== false) for (const [index, zone] of (data['zones'] ?? []).entries()) {
      const geo = typeof zone.polygon_geojson === 'string' ? JSON.parse(zone.polygon_geojson) : zone.polygon_geojson;
      const assessedRisk = String(zone.assessed_risk_level ?? 'Low');
      const configuredColor = /^#[0-9a-f]{6}$/i.test(String(zone.zone_color ?? '')) ? String(zone.zone_color) : zoneBoundaryColors[index % zoneBoundaryColors.length];
      const color = Number(zone.active_report_count ?? 0) > 0 ? riskColors[assessedRisk] ?? configuredColor : configuredColor;
      const layer = L.geoJSON(geo, { style: { color, fillColor: color, fillOpacity: Number(zone.active_report_count ?? 0) > 0 ? .24 : .08, weight: 3, dashArray: '8 5' } })
        .bindPopup(`<strong>${this.escape(zone.zone_name)}</strong><br>${this.escape(assessedRisk)} assessed risk<br>${Number(zone.active_report_count ?? 0)} active validated report(s)`)
        .addTo(this.overlay);
      if (this.showLabels) layer.bindTooltip(this.escape(zone.zone_name), { permanent: true, direction: 'center', className: 'map-feature-label zone-label' });
      visibleBounds.extend(layer.getBounds());
    }
    if (this.visibleLayers?.riskZones !== false) for (const zone of data['riskZones'] ?? []) {
      const geo = typeof zone.polygon_geojson === 'string' ? JSON.parse(zone.polygon_geojson) : zone.polygon_geojson;
      const layer = L.geoJSON(geo, { style: { color: riskColors[zone.risk_level] ?? '#3176bd', fillOpacity: .28, weight: 2 } })
        .bindPopup(`<strong>${this.escape(zone.risk_zone_name)}</strong><br>${this.escape(zone.risk_level)} risk`)
        .addTo(this.overlay);
      if (this.showLabels) layer.bindTooltip(this.escape(zone.risk_zone_name), { permanent: true, direction: 'center', className: 'map-feature-label risk-label' });
      visibleBounds.extend(layer.getBounds());
    }
    if (this.visibleLayers?.shelters !== false) for (const shelter of data['shelters'] ?? []) {
      const shelterMarker = this.marker(shelter.latitude, shelter.longitude, '#18895c', '⌂', `<strong>${this.escape(shelter.shelter_name)}</strong><br>${shelter.current_occupancy}/${shelter.capacity} occupied`);
      if (this.showLabels) shelterMarker.bindTooltip(this.escape(shelter.shelter_name), {
        permanent: true,
        direction: 'top',
        offset: L.point(0, -15),
        className: 'map-feature-label shelter-map-label'
      });
      visibleBounds.extend([Number(shelter.latitude), Number(shelter.longitude)]);
    }
    if (this.visibleLayers?.incidents !== false) for (const report of data['reports'] ?? []) {
      const isMajorIncident = report.severity_level === 'Major Incident';
      const reportMarker = this.marker(
        report.latitude,
        report.longitude,
        isMajorIncident ? '#d95050' : '#e6a625',
        '!',
        '',
        isMajorIncident
      ).on('click', () => this.incidentSelected.emit(report));
      if (this.showLabels) reportMarker.bindTooltip(this.escape(report.incident_type ?? String(report.location_text ?? 'Flood report').replace(/\s*\(-?\d{1,2}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?\)/g, '')), {
        permanent: true,
        direction: 'top',
        offset: L.point(0, -15),
        className: `map-feature-label report-map-label${isMajorIncident ? ' major' : ''}`
      });
      visibleBounds.extend([Number(report.latitude), Number(report.longitude)]);
    }
    if (this.visibleLayers?.routes !== false) for (const route of data['routes'] ?? []) {
      const geo = typeof route.route_geojson === 'string' ? JSON.parse(route.route_geojson) : route.route_geojson;
      const layer = L.geoJSON(geo, { style: { color: '#6e49b8', weight: 4, dashArray: '7 6' } }).bindPopup(this.escape(route.route_name)).addTo(this.overlay);
      visibleBounds.extend(layer.getBounds());
    }
    if (!this.boundaryFitted && visibleBounds.isValid()) {
      this.map.fitBounds(visibleBounds, { padding: [24, 24], maxZoom: 16 });
      this.boundaryFitted = true;
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

  private loadOfficialBoundary() {
    const query = 'https://ulap-nga.georisk.gov.ph/arcgis/rest/services/PSA/BarangayPopMF/MapServer/0/query?geometry=122.8852784%2C13.7828976&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&f=geojson';
    fetch(query)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((collection: GeoJSON.FeatureCollection) => {
        const feature = collection.features[0];
        if (!feature || !this.map) return;
        this.officialBoundary = feature;
        this.render(this.lastData ?? {});
      })
      .catch(() => undefined);
  }

  private drawOfficialBoundary() {
    if (!this.map || !this.officialBoundary) return;
    L.geoJSON(this.officialBoundary, {
      style: { color: '#0758c7', weight: 4, fillColor: '#2f80d8', fillOpacity: .08, dashArray: '7 5' }
    }).bindPopup('<strong>Colacling (Del Rosario)</strong><br>Official barangay boundary').addTo(this.overlay);
  }

  private escape(value: unknown) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  }


}
