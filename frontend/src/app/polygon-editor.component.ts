import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-polygon-editor',
  standalone: true,
  template: `
    <div class="polygon-help">Press Start drawing, then click around the boundary. Add at least three points; the shape closes automatically.</div>
    <div class="polygon-map-wrap">
      <div class="polygon-map" [id]="mapId" aria-label="Polygon boundary editor"></div>
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
    :host{display:block}.polygon-help{font-size:9px;font-weight:500;color:#758398;margin-bottom:7px}
    .polygon-map-wrap{position:relative}.polygon-map{height:330px;border:1px solid #dce3ec;border-radius:10px;overflow:hidden}
    .draw-surface{position:absolute;inset:0;z-index:500;border:0;border-radius:10px;background:transparent;cursor:crosshair;padding:0}
    .draw-surface span{position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#0758c7;color:#fff;border-radius:20px;padding:6px 11px;font-size:9px;box-shadow:0 3px 10px #083b7d45;pointer-events:none}
    .polygon-actions{display:flex;align-items:center;gap:8px;margin-top:8px}.polygon-actions span{margin-right:auto;color:#758398;font-size:9px}
    .polygon-actions button{border:1px solid #dce3ec;background:#fff;color:#40506a;border-radius:7px;padding:6px 9px;font-size:9px}
    .polygon-actions .draw-toggle{background:#0758c7;color:#fff;border-color:#0758c7}
  `]
})
export class PolygonEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('polygonPayload') private polygonPayload?: ElementRef<HTMLInputElement>;
  @Input() name = 'polygonGeoJson';
  @Input() value: unknown = '';
  readonly mapId = `polygon-editor-${Math.random().toString(36).slice(2)}`;
  points: L.LatLng[] = [];
  geoJson = '';
  drawing = false;
  private map?: L.Map;
  private shape?: L.Polygon;

  ngOnChanges() {
    this.readValue();
    this.render();
  }

  ngAfterViewInit() {
    this.map = L.map(this.mapId).setView([13.7795, 122.8708], 16);
    L.tileLayer(environment.mapTileUrl, {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(this.map);
    this.render();
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  ngOnDestroy() {
    this.map?.remove();
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
