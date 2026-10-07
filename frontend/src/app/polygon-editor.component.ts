import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-polygon-editor',
  standalone: true,
  template: `
    <div class="polygon-help">Press Start drawing, then click around the boundary. Add at least three points; the shape closes automatically.</div>
    <div class="polygon-map-wrap">
      <div class="polygon-map" [id]="mapId" aria-label="Polygon boundary editor"></div>
      <div class="boundary-key"><i></i> Official Colacling, Lupi boundary</div>
      @if (drawing) {
        <button type="button" class="draw-surface" (click)="addBoundaryPoint($event)" aria-label="Place boundary point">
          <span>Click to place boundary points</span>
        </button>
      }
    </div>
    <input #polygonPayload type="hidden" [name]="name" [value]="geoJson" />
    <div class="polygon-actions">
      <span>{{ points.length }} boundary points</span>
      <button type="button" class="draw-toggle" (click)="drawing = !drawing">{{ drawing ? 'Finish drawing' : 'Start drawing' }}</button>
      <button type="button" (click)="undo()" [disabled]="!points.length">Undo point</button>
      <button type="button" (click)="clear()" [disabled]="!points.length">Clear</button>
    </div>
  `,
  styles: [`
    :host{display:block}.polygon-help{font-size:9px;font-weight:500;color:var(--muted);margin-bottom:7px}
    .polygon-map-wrap{position:relative}.polygon-map{height:330px;border:1px solid var(--border);border-radius:10px;overflow:hidden}.boundary-key{position:absolute;right:10px;bottom:10px;z-index:400;display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--surface);box-shadow:0 2px 8px #15304a2e;border-radius:6px;color:var(--muted);font-size:9px;font-weight:600}.boundary-key i{width:20px;border-top:3px dashed #0758c7}
    .draw-surface{position:absolute;inset:0;z-index:500;border:0;border-radius:10px;background:transparent;cursor:crosshair;padding:0}
    .draw-surface span{position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#0758c7;color:#fff;border-radius:20px;padding:6px 11px;font-size:9px;box-shadow:0 3px 10px #083b7d45;pointer-events:none}
    .polygon-actions{display:flex;align-items:center;gap:8px;margin-top:8px}.polygon-actions span{margin-right:auto;color:var(--muted);font-size:9px}
    .polygon-actions button{border:1px solid var(--border);background:var(--surface);color:var(--muted);border-radius:7px;padding:6px 9px;font-size:9px}
    .polygon-actions .draw-toggle{background:#0758c7;color:#fff;border-color:#0758c7}
    @media(max-width:760px){.polygon-map{height:clamp(270px,44dvh,360px)}.polygon-actions{align-items:stretch;flex-wrap:wrap}.polygon-actions span{flex:1 1 100%;margin:0}.polygon-actions button{flex:1 1 110px;min-height:40px}.draw-surface span{width:max-content;max-width:calc(100% - 20px);text-align:center;white-space:normal}.boundary-key{left:8px;right:auto;max-width:calc(100% - 16px)}}
  `]
})
export class PolygonEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Output() changed = new EventEmitter<void>();
  @ViewChild('polygonPayload') private polygonPayload?: ElementRef<HTMLInputElement>;
  @Input() name = 'polygonGeoJson';
  @Input() value: unknown = '';
  @Input() existingZones: Array<Record<string, unknown>> = [];
  readonly mapId = `polygon-editor-${Math.random().toString(36).slice(2)}`;
  points: L.LatLng[] = [];
  geoJson = '';
  drawing = false;
  private map?: L.Map;
  private shape?: L.Polygon;
  private officialBoundary?: L.GeoJSON;
  private existingZoneLayer = L.layerGroup();

  ngOnChanges() {
    this.readValue();
    this.renderExistingZones();
    this.render();
  }

  ngAfterViewInit() {
    this.map = L.map(this.mapId, {
      minZoom: environment.mapMinZoom,
      maxZoom: environment.mapMaxZoom
    }).setView(environment.mapCenter, environment.mapInitialZoom);
    L.tileLayer(environment.mapTileUrl, {
      maxZoom: environment.mapMaxZoom,
      attribution: '© Esri, HERE, Garmin, FAO, NOAA, USGS, and contributors'
    }).addTo(this.map);
    this.existingZoneLayer.addTo(this.map);
    this.renderExistingZones();
    this.loadOfficialBoundary();
    this.render();
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  ngOnDestroy() {
    this.map?.remove();
  }

  private loadOfficialBoundary() {
    const query = 'https://ulap-nga.georisk.gov.ph/arcgis/rest/services/PSA/BarangayPopMF/MapServer/0/query?geometry=122.8852784%2C13.7828976&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&f=geojson';
    fetch(query)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((collection: GeoJSON.FeatureCollection) => {
        if (!this.map || !collection.features[0]) return;
        this.officialBoundary?.remove();
        this.officialBoundary = L.geoJSON(collection.features[0], {
          style: { color: '#0758c7', weight: 4, fill: false, dashArray: '7 5' }
        }).bindPopup('<strong>Colacling (Del Rosario)</strong><br>Official barangay boundary').addTo(this.map);
        this.map.fitBounds(this.officialBoundary.getBounds(), { padding: [25, 25], maxZoom: 16 });
      })
      .catch(() => undefined);
  }

  private renderExistingZones() {
    if (!this.map) return;
    this.existingZoneLayer.clearLayers();
    for (const zone of this.existingZones) {
      try {
        const value = zone['polygon_geojson'] ?? zone['polygonGeoJson'];
        const geo = typeof value === 'string' ? JSON.parse(value) : value;
        const color = /^#[0-9a-f]{6}$/i.test(String(zone['zone_color'] ?? '')) ? String(zone['zone_color']) : '#64748b';
        L.geoJSON(geo as any, {
          style: { color, fill: false, weight: 3, dashArray: '6 4' }
        }).bindTooltip(String(zone['zone_name'] ?? 'Existing zone')).addTo(this.existingZoneLayer);
      } catch {
        continue;
      }
    }
  }

  addBoundaryPoint(event: MouseEvent) {
    if (!this.map) return;
    const surface = event.currentTarget as HTMLElement;
    const bounds = surface.getBoundingClientRect();
    const point = L.point(event.clientX - bounds.left, event.clientY - bounds.top);
    this.points = [...this.points, this.map.containerPointToLatLng(point)];
    this.updateValue();
  }

  undo() {
    this.points = this.points.slice(0, -1);
    this.updateValue();
  }

  clear() {
    this.points = [];
    this.updateValue();
  }

  private readValue() {
    if (!this.value) return;
    try {
      const geo = typeof this.value === 'string' ? JSON.parse(this.value) : this.value as any;
      if (geo?.type !== 'Polygon' || !Array.isArray(geo.coordinates?.[0])) return;
      const ring = geo.coordinates[0] as Array<[number, number]>;
      const withoutClosingPoint = ring.length > 1 && ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1] ? ring.slice(0, -1) : ring;
      this.points = withoutClosingPoint.map(([lng, lat]) => L.latLng(lat, lng));
      this.updateGeoJson();
    } catch {
      this.points = [];
      this.geoJson = '';
    }
  }

  private updateValue() {
    this.updateGeoJson();
    this.render();
    this.changed.emit();
  }

  private updateGeoJson() {
    if (this.points.length < 3) {
      this.geoJson = '';
      if (this.polygonPayload) this.polygonPayload.nativeElement.value = '';
      return;
    }
    const coordinates = this.points.map((point) => [point.lng, point.lat]);
    this.geoJson = JSON.stringify({ type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] });
    if (this.polygonPayload) this.polygonPayload.nativeElement.value = this.geoJson;
  }

  private render() {
    if (!this.map) return;
    this.shape?.remove();
    this.shape = undefined;
    if (!this.points.length) return;
    this.shape = L.polygon(this.points, { color: '#0758c7', fillColor: '#2f80d8', fillOpacity: .2, weight: 3 }).addTo(this.map);
    if (this.points.length >= 2) this.map.fitBounds(this.shape.getBounds(), { padding: [25, 25], maxZoom: 17 });
  }
}
