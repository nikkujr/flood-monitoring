import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import { environment } from '../environments/environment';
import { ApiService } from './api.service';

@Component({
  selector: 'app-location-picker',
  standalone: true,
  template: `
    <div class="picker-help">Press Pin location, then click {{ restrictToColacling ? 'inside the Colacling boundary' : 'the ' + locationLabel + ' position' }} on the map.</div>
    <div class="picker-wrap">
      <div class="picker-map" [id]="mapId" aria-label="Evacuation shelter location picker"></div>
      @if (pinning) {
        <button type="button" class="pin-surface" (click)="setLocation($event)" aria-label="Pin shelter location">
          <span>Click to pin {{ locationLabel }}</span>
        </button>
      }
    </div>
    <input #latitudePayload type="hidden" name="latitude" [value]="latitude" />
    <input #longitudePayload type="hidden" name="longitude" [value]="longitude" />
    @if (includeLocationText) { <input #locationTextPayload type="hidden" name="locationText" [value]="generatedLocationText" /> }
    <div class="picker-actions">
      <span>{{ hasLocation ? (detectedZoneName ? detectedZoneName + ' · ' : '') + latitude + ', ' + longitude : 'No location pinned' }}</span>
      <button type="button" class="locate-button" (click)="useCurrentLocation()" [disabled]="locating">{{ locating ? 'Locating…' : 'Share current location' }}</button>
      <button type="button" class="pin-toggle" (click)="pinning = !pinning">{{ pinning ? 'Cancel pinning' : (hasLocation ? 'Move pin' : 'Pin location') }}</button>
      <button type="button" (click)="clear()" [disabled]="!hasLocation">Clear</button>
    </div>
    @if (hasLocation && detectedZoneName) { <div class="detected-zone"><i>✓</i><span><small>Detected barangay zone</small><b>{{ detectedZoneName }}</b></span></div> }
    @if (locationError) { <div class="picker-error" role="alert">{{ locationError }}</div> }
  `,
  styles: [`
    :host{display:block}.picker-help{font-size:9px;font-weight:500;color:#758398;margin-bottom:7px}.picker-error{margin-top:7px;color:#c33b3b;font-size:9px;font-weight:600}
    .picker-wrap{position:relative}.picker-map{height:330px;border:1px solid #dce3ec;border-radius:10px;overflow:hidden}
    .pin-surface{position:absolute;inset:0;z-index:500;border:0;border-radius:10px;background:transparent;cursor:crosshair;padding:0}
    .pin-surface span{position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#0758c7;color:#fff;border-radius:20px;padding:6px 11px;font-size:9px;box-shadow:0 3px 10px #083b7d45;pointer-events:none}
    .picker-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px}.picker-actions span{margin-right:auto;color:#758398;font-size:9px}
    .picker-actions button{border:1px solid #dce3ec;background:#fff;color:#40506a;border-radius:7px;padding:6px 9px;font-size:9px}
    .picker-actions .locate-button{border-color:#a9c8ed;color:#0758c7}
    .picker-actions .pin-toggle{background:#0758c7;color:#fff;border-color:#0758c7}.detected-zone{display:flex;align-items:center;gap:8px;margin-top:8px;padding:9px 11px;border:1px solid #b9ddc9;border-radius:8px;background:#effaf4;color:#236b45}.detected-zone i{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#2d9661;color:#fff;font-size:10px;font-style:normal;font-weight:800}.detected-zone small,.detected-zone b{display:block}.detected-zone small{font-size:7px;text-transform:uppercase;letter-spacing:.6px}.detected-zone b{margin-top:1px;font-size:10px}
    @media(max-width:760px){.picker-map{height:clamp(270px,44dvh,360px)}.picker-actions{align-items:stretch}.picker-actions span{flex:1 1 100%;margin:0;overflow-wrap:anywhere}.picker-actions button{flex:1 1 130px;min-height:40px}.pin-surface span{width:max-content;max-width:calc(100% - 20px);text-align:center;white-space:normal}}
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
  pinning = false;
  locationError = '';
  locating = false;
  detectedZoneName = '';
  private map?: L.Map;
  private marker?: L.CircleMarker;
  private operationalOverlay = L.layerGroup();
  private boundaryGeometry?: GeoJSON.Geometry;
  private boundaryLayer?: L.GeoJSON;
  private barangayZones: Array<Record<string, any>> = [];

  constructor(private readonly api: ApiService) {}

  get hasLocation() { return this.latitude !== '' && this.longitude !== ''; }
  get generatedLocationText() { return this.hasLocation ? `${this.detectedZoneName ? this.detectedZoneName + ' · ' : ''}Pinned map location (${this.latitude}, ${this.longitude})` : ''; }

  ngOnChanges() {
    this.latitude = this.coordinate(this.initialLatitude);
    this.longitude = this.coordinate(this.initialLongitude);
    this.renderMarker();
  }

  ngAfterViewInit() {
    const center: L.LatLngExpression = this.hasLocation ? [Number(this.latitude), Number(this.longitude)] : environment.mapCenter;
    this.map = L.map(this.mapId, {
      minZoom: environment.mapMinZoom,
      maxZoom: environment.mapMaxZoom
    }).setView(center, environment.mapInitialZoom);
    L.tileLayer(environment.mapTileUrl, {
      maxZoom: environment.mapMaxZoom,
      attribution: '© Esri, HERE, Garmin, FAO, NOAA, USGS, and contributors'
    }).addTo(this.map);
    L.tileLayer(environment.mapHydroTileUrl, {
      maxZoom: environment.mapMaxZoom,
      opacity: .85,
      attribution: '© Esri'
    }).addTo(this.map);
    this.operationalOverlay.addTo(this.map);
    if (this.restrictToColacling || this.showOperationalMap) this.loadColaclingBoundary();
    if (this.restrictToColacling || this.showOperationalMap) this.loadOperationalMap();
    this.renderMarker();
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  ngOnDestroy() {
    this.map?.remove();
  }

  setLocation(event: MouseEvent) {
    if (!this.map) return;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const location = this.map.containerPointToLatLng(L.point(event.clientX - bounds.left, event.clientY - bounds.top));
    if (this.restrictToColacling && (!this.boundaryGeometry || !this.isInsideBoundary(location))) {
      this.locationError = this.boundaryGeometry
        ? 'Choose a location inside the Colacling, Lupi boundary.'
        : 'The Colacling boundary is still loading. Try again in a moment.';
      return;
    }
    this.locationError = '';
    this.latitude = location.lat.toFixed(7);
    this.longitude = location.lng.toFixed(7);
    this.detectZone(location);
    this.pinning = false;
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
        this.locating = false;
        const location = L.latLng(coords.latitude, coords.longitude);
        if (this.restrictToColacling && (!this.boundaryGeometry || !this.isInsideBoundary(location))) {
          this.locationError = this.boundaryGeometry
            ? 'Your current location is outside the Colacling, Lupi boundary.'
            : 'The Colacling boundary is still loading. Try again in a moment.';
          return;
        }
        this.latitude = location.lat.toFixed(7);
        this.longitude = location.lng.toFixed(7);
        this.detectZone(location);
        this.pinning = false;
        this.syncPayloads();
        this.renderMarker();
      },
      (error) => {
        this.locating = false;
        this.locationError = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access or pin the incident manually.'
          : 'Your current location could not be determined. Try again or pin it manually.';
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  }

  private loadColaclingBoundary() {
    const query = 'https://ulap-nga.georisk.gov.ph/arcgis/rest/services/PSA/BarangayPopMF/MapServer/0/query?geometry=122.8852784%2C13.7828976&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&f=geojson';
    fetch(query)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((collection: GeoJSON.FeatureCollection) => {
        const feature = collection.features[0];
        if (!this.map || !feature?.geometry) return;
        this.boundaryGeometry = feature.geometry;
        this.boundaryLayer?.remove();
        this.boundaryLayer = L.geoJSON(feature, {
          style: { color: '#0758c7', weight: 3, fillColor: '#2f80d8', fillOpacity: .08, dashArray: '7 5' }
        }).bindPopup('<strong>Colacling (Del Rosario)</strong><br>Report locations must be inside this boundary').addTo(this.map);
        this.map.fitBounds(this.boundaryLayer.getBounds(), { padding: [25, 25], maxZoom: 16 });
      })
      .catch(() => { this.locationError = 'The Colacling boundary could not be loaded.'; });
  }

  private loadOperationalMap() {
    this.api.liveMap().subscribe({
      next: (data: any) => {
        this.operationalOverlay.clearLayers();
        this.barangayZones = data['zones'] ?? [];
        if (this.hasLocation) this.detectZone(L.latLng(Number(this.latitude), Number(this.longitude)));
        this.drawOperationalZones(data['zones'] ?? [], false);
        this.drawOperationalZones(data['riskZones'] ?? [], true);
        for (const shelter of data['shelters'] ?? []) {
          L.circleMarker([Number(shelter.latitude), Number(shelter.longitude)], {
            radius: 7, color: '#fff', weight: 2, fillColor: '#18895c', fillOpacity: 1
          }).bindTooltip(String(shelter.shelter_name ?? 'Evacuation shelter')).addTo(this.operationalOverlay);
        }
        for (const report of data['reports'] ?? []) {
          L.circleMarker([Number(report.latitude), Number(report.longitude)], {
            radius: 6, color: '#fff', weight: 2, fillColor: '#d95050', fillOpacity: 1
          }).bindTooltip(String(report.location_text ?? 'Validated flood report')).addTo(this.operationalOverlay);
        }
        for (const route of data['routes'] ?? []) {
          const geo = typeof route.route_geojson === 'string' ? JSON.parse(route.route_geojson) : route.route_geojson;
          L.geoJSON(geo, { style: { color: '#6e49b8', weight: 3, dashArray: '7 6' } })
            .bindTooltip(String(route.route_name ?? 'Evacuation route')).addTo(this.operationalOverlay);
        }
      },
      error: () => undefined
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
    this.detectedZoneName = '';
    for (const zone of this.barangayZones) {
      try {
        const value = zone['polygon_geojson'] ?? zone['polygonGeoJson'];
        const geometry = typeof value === 'string' ? JSON.parse(value) : value;
        const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
        if (polygons.some((polygon: number[][][]) => this.isInsidePolygon(point, polygon))) {
          this.detectedZoneName = String(zone['zone_name'] ?? 'Barangay zone');
          this.syncPayloads();
          return;
        }
      } catch {
        continue;
      }
    }
  }

  private isInsideBoundary(point: L.LatLng) {
    const geometry = this.boundaryGeometry;
    if (!geometry) return false;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    return polygons.some((polygon) => this.isInsidePolygon(point, polygon as number[][][]));
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
