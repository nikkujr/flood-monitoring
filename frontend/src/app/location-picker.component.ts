import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import { environment } from '../environments/environment';
import { ApiService } from './api.service';

@Component({
  selector: 'app-location-picker',
  standalone: true,
  template: `
    <div class="picker-help">Tap the map to {{ hasLocation ? 'move' : 'place' }} the {{ locationLabel }} pin{{ restrictToColacling ? ' inside a configured barangay zone' : '' }}.</div>
    <div class="picker-wrap">
      <div class="picker-style" role="group" aria-label="Map style"><button type="button" [class.active]="mapStyle === 'roadmap'" (click)="setMapStyle('roadmap')">Road map</button><button type="button" [class.active]="mapStyle === 'satellite'" (click)="setMapStyle('satellite')">Satellite</button></div>
      <div class="picker-map" [id]="mapId" aria-label="Evacuation shelter location picker"></div>
    </div>
    <input #latitudePayload type="hidden" name="latitude" [value]="latitude" />
    <input #longitudePayload type="hidden" name="longitude" [value]="longitude" />
    @if (includeLocationText) { <input #locationTextPayload type="hidden" name="locationText" [value]="generatedLocationText" /> }
    <div class="picker-actions">
      <span>{{ hasLocation ? (detectedZoneName || 'Location pinned') : 'No location pinned' }}</span>
      <button type="button" class="locate-button" (click)="useCurrentLocation()" [disabled]="locating">{{ locating ? 'Locating…' : 'Share current location' }}</button>
      <button type="button" (click)="clear()" [disabled]="!hasLocation">Clear</button>
    </div>
    @if (mapLoading) { <div class="picker-help" role="status">Loading barangay zones…</div> }
    @if (mapError) { <div class="picker-error" role="alert">{{ mapError }} <button type="button" (click)="loadOperationalMap()">Retry</button></div> }
    @if (hasLocation && detectedZoneName) { <div class="detected-zone"><i>✓</i><span><small>Detected barangay zone</small><b>{{ detectedZoneName }}</b></span></div> }
    @if (locationError) { <div class="picker-error" role="alert">{{ locationError }}</div> }
  `,
  styles: [`
    :host{display:block}.picker-help{font-size:9px;font-weight:500;color:#758398;margin-bottom:7px}.picker-error{margin-top:7px;color:#c33b3b;font-size:9px;font-weight:600}
    .picker-wrap{position:relative}.picker-map{height:330px;border:1px solid #dce3ec;border-radius:10px;overflow:hidden}
    .picker-style{position:absolute;z-index:1000;top:10px;right:10px;display:flex;padding:3px;border:1px solid #d8e0ea;border-radius:8px;background:#fff;box-shadow:0 2px 8px #15304a2e}.picker-style button{border:0;border-radius:6px;background:transparent;color:#40506a;padding:7px 10px;cursor:pointer}.picker-style button.active{background:#0758c7;color:#fff}
    .picker-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px}.picker-actions span{margin-right:auto;color:#758398;font-size:9px}
    .picker-actions button{border:1px solid #dce3ec;background:#fff;color:#40506a;border-radius:7px;padding:6px 9px;font-size:9px}
    .picker-actions .locate-button{border-color:#a9c8ed;color:#0758c7}
    .picker-error button{border:0;background:transparent;color:#0758c7;font-weight:700;cursor:pointer}.detected-zone{display:flex;align-items:center;gap:8px;margin-top:8px;padding:9px 11px;border:1px solid #b9ddc9;border-radius:8px;background:#effaf4;color:#236b45}.detected-zone i{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#2d9661;color:#fff;font-size:10px;font-style:normal;font-weight:800}.detected-zone small,.detected-zone b{display:block}.detected-zone small{font-size:7px;text-transform:uppercase;letter-spacing:.6px}.detected-zone b{margin-top:1px;font-size:10px}
    @media(max-width:760px){.picker-map{height:clamp(270px,44dvh,360px)}.picker-actions{align-items:stretch}.picker-actions span{flex:1 1 100%;margin:0;overflow-wrap:anywhere}.picker-actions button{flex:1 1 130px;min-height:40px}}
  `]
})
export class LocationPickerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() initialLatitude: unknown = '';
  @Input() initialLongitude: unknown = '';
  @Input() locationLabel = 'shelter';
  @Input() includeLocationText = false;
  @Input() restrictToColacling = false;
  @Input() showOperationalMap = false;
  @ViewChild('latitudePayload') private latitudePayload?: ElementRef<HTMLInputElement>;
  @ViewChild('longitudePayload') private longitudePayload?: ElementRef<HTMLInputElement>;
  @ViewChild('locationTextPayload') private locationTextPayload?: ElementRef<HTMLInputElement>;
  readonly mapId = `location-picker-${Math.random().toString(36).slice(2)}`;
  latitude = '';
  longitude = '';
  mapStyle: 'roadmap' | 'satellite' = 'roadmap';
  mapLoading = false;
  mapError = '';
  locationError = '';
  locating = false;
  detectedZoneName = '';
  private map?: L.Map;
  private marker?: L.CircleMarker;
  private operationalOverlay = L.layerGroup();
  private baseLayer?: L.TileLayer;
  private satelliteLabels?: L.TileLayer;
  private barangayZones: Array<Record<string, any>> = [];
  private destroyed = false;

  constructor(private readonly api: ApiService, private readonly changeDetector: ChangeDetectorRef) {}

  get hasLocation() { return this.latitude !== '' && this.longitude !== ''; }
  get generatedLocationText() { return this.hasLocation ? `${this.detectedZoneName || 'Colacling'} · Pinned map location` : ''; }

  ngOnChanges() {
    this.latitude = this.coordinate(this.initialLatitude);
    this.longitude = this.coordinate(this.initialLongitude);
    this.renderMarker();
  }

  ngAfterViewInit() {
    const center: L.LatLngExpression = this.hasLocation ? [Number(this.latitude), Number(this.longitude)] : environment.mapCenter;
    this.map = L.map(this.mapId, {
      minZoom: environment.mapMinZoom,
      maxZoom: Math.min(environment.mapMaxZoom, 18)
    }).setView(center, environment.mapInitialZoom);
    this.setMapStyle('roadmap');
    this.operationalOverlay.addTo(this.map);
    if (this.restrictToColacling || this.showOperationalMap) this.loadOperationalMap();
    this.map.on('click', ({ latlng }) => {
      this.setLocation(latlng);
      this.changeDetector.detectChanges();
    });
    this.renderMarker();
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.map?.remove();
  }

  setMapStyle(style: 'roadmap' | 'satellite') {
    if (!this.map) return;
    this.baseLayer?.remove();
    this.satelliteLabels?.remove();
    this.mapStyle = style;
    this.baseLayer = L.tileLayer(style === 'roadmap' ? environment.mapTileUrl : environment.mapSatelliteTileUrl, {
      maxZoom: 18,
      attribution: style === 'roadmap' ? '© Esri, HERE, Garmin, FAO, NOAA, USGS, and contributors' : '© Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }).addTo(this.map);
    if (style === 'satellite') {
      this.satelliteLabels = L.tileLayer(environment.mapSatelliteLabelsTileUrl, { maxZoom: 18, opacity: .9, attribution: '© Esri' }).addTo(this.map);
    }
  }

  setLocation(location: L.LatLng) {
    if (this.restrictToColacling && (!this.barangayZones.length || !this.findZone(location))) {
      this.locationError = this.barangayZones.length
        ? 'Choose a location inside a configured barangay zone.'
        : 'Barangay zones are not available yet. Please retry loading the map.';
      return;
    }
    this.locationError = '';
    this.latitude = location.lat.toFixed(7);
    this.longitude = location.lng.toFixed(7);
    this.detectZone(location);
    this.syncPayloads();
    this.renderMarker();
    this.locationError = '';
  }

  useCurrentLocation() {
    if (!navigator.geolocation) {
      this.locationError = 'Location sharing is not supported by this browser.';
      return;
    }
    this.locating = true;
    this.locationError = '';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (this.destroyed) return;
        this.locating = false;
        const location = L.latLng(coords.latitude, coords.longitude);
        if (this.restrictToColacling && (!this.barangayZones.length || !this.findZone(location))) {
          this.locationError = this.barangayZones.length
            ? 'Your current location is outside the configured barangay zones.'
            : 'Barangay zones are not available yet. Please retry loading the map.';
          return;
        }
        this.latitude = location.lat.toFixed(7);
        this.longitude = location.lng.toFixed(7);
        this.detectZone(location);
        this.syncPayloads();
        this.renderMarker();
        this.changeDetector.detectChanges();
      },
      (error) => {
        if (this.destroyed) return;
        this.locating = false;
        this.locationError = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access or pin the incident manually.'
          : 'Your current location could not be determined. Try again or pin it manually.';
        this.changeDetector.detectChanges();
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  }

  loadOperationalMap() {
    this.mapLoading = true;
    this.mapError = '';
    this.api.liveMap().subscribe({
      next: (data: any) => {
        if (this.destroyed) return;
        this.mapLoading = false;
        this.operationalOverlay.clearLayers();
        this.barangayZones = data['zones'] ?? [];
        if (this.restrictToColacling && !this.barangayZones.length) this.mapError = 'No barangay zones are configured for report pinning.';
        if (this.restrictToColacling && !this.barangayZones.length) this.mapError = 'No barangay zones are configured for report pinning.';
        if (this.hasLocation) this.detectZone(L.latLng(Number(this.latitude), Number(this.longitude)));
        this.drawOperationalZones(data['zones'] ?? [], false);
        if (this.restrictToColacling && !this.hasLocation && this.barangayZones.length && this.map) {
          const zoneLayers = L.featureGroup(this.operationalOverlay.getLayers());
          if (zoneLayers.getBounds().isValid()) this.map.fitBounds(zoneLayers.getBounds(), { padding: [25, 25], maxZoom: 16 });
        }
        this.drawOperationalZones(data['riskZones'] ?? [], true);
        for (const shelter of data['shelters'] ?? []) {
          L.circleMarker([Number(shelter.latitude), Number(shelter.longitude)], {
            radius: 7, color: '#fff', weight: 2, fillColor: '#18895c', fillOpacity: 1
          }).bindTooltip(String(shelter.shelter_name ?? 'Evacuation shelter')).addTo(this.operationalOverlay);
        }
        for (const report of data['reports'] ?? []) {
          L.circleMarker([Number(report.latitude), Number(report.longitude)], {
            radius: 6, color: '#fff', weight: 2, fillColor: '#d95050', fillOpacity: 1
          }).bindTooltip(String(report.location_text ?? 'Validated flood report').replace(/\s*\(-?\d{1,2}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?\)/g, '')).addTo(this.operationalOverlay);
        }
        for (const route of data['routes'] ?? []) {
          const geo = typeof route.route_geojson === 'string' ? JSON.parse(route.route_geojson) : route.route_geojson;
          L.geoJSON(geo, { style: { color: '#6e49b8', weight: 3, dashArray: '7 6' } })
            .bindTooltip(String(route.route_name ?? 'Evacuation route')).addTo(this.operationalOverlay);
        }
        this.changeDetector.detectChanges();
      },
      error: () => {
        if (this.destroyed) return;
        this.mapLoading = false;
        this.mapError = 'Map data could not be loaded.';
        this.changeDetector.detectChanges();
      }
    });
  }

  private drawOperationalZones(zones: Array<Record<string, any>>, riskZone: boolean) {
    const colors: Record<string, string> = { Low: '#43a267', Medium: '#e6a625', High: '#d95050' };
    for (const zone of zones) {
      try {
        const value = zone['polygon_geojson'] ?? zone['polygonGeoJson'];
        const geo = typeof value === 'string' ? JSON.parse(value) : value;
        const color = riskZone ? colors[zone['risk_level']] ?? '#3176bd' : zone['zone_color'] ?? '#1764c1';
          L.geoJSON(geo, { style: { color, fillColor: color, fillOpacity: riskZone ? .2 : .08, weight: 2, dashArray: riskZone ? undefined : '8 5' } })
          .bindTooltip(String(zone['zone_name'] ?? zone['risk_zone_name'] ?? 'Map zone')).addTo(this.operationalOverlay);
      } catch {
        continue;
      }
    }
  }

  private detectZone(point: L.LatLng) {
    this.detectedZoneName = this.findZone(point);
    this.syncPayloads();
  }

  private findZone(point: L.LatLng) {
    for (const zone of this.barangayZones) {
      try {
        const value = zone['polygon_geojson'] ?? zone['polygonGeoJson'];
        const geometry = typeof value === 'string' ? JSON.parse(value) : value;
        const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
        if (polygons.some((polygon: number[][][]) => this.isInsidePolygon(point, polygon))) {
          return String(zone['zone_name'] ?? 'Barangay zone');
        }
      } catch {
        continue;
      }
    }
    return '';
  }

  private isInsidePolygon(point: L.LatLng, polygon: number[][][]) {
    if (!this.isInsideRing(point, polygon[0] ?? [])) return false;
    return !polygon.slice(1).some((hole) => this.isInsideRing(point, hole));
  }

  private isInsideRing(point: L.LatLng, ring: number[][]) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const [x, y] = ring[index] ?? [];
      const [previousX, previousY] = ring[previous] ?? [];
      const intersects = ((y > point.lat) !== (previousY > point.lat)) && point.lng < (previousX - x) * (point.lat - y) / (previousY - y) + x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  clear() {
    this.latitude = '';
    this.longitude = '';
    this.detectedZoneName = '';
    this.syncPayloads();
    this.renderMarker();
  }

  private coordinate(value: unknown) {
    const number = Number(value);
    return value === '' || value === null || value === undefined || !Number.isFinite(number) ? '' : number.toFixed(7);
  }

  private syncPayloads() {
    if (this.latitudePayload) this.latitudePayload.nativeElement.value = this.latitude;
    if (this.longitudePayload) this.longitudePayload.nativeElement.value = this.longitude;
    if (this.locationTextPayload) this.locationTextPayload.nativeElement.value = this.generatedLocationText;
  }

  private renderMarker() {
    if (!this.map) return;
    this.marker?.remove();
    this.marker = undefined;
    if (!this.hasLocation) return;
    const location = L.latLng(Number(this.latitude), Number(this.longitude));
    this.marker = L.circleMarker(location, { radius: 9, color: '#fff', weight: 3, fillColor: '#16845b', fillOpacity: 1 }).addTo(this.map);
    this.map.panTo(location);
  }
}
