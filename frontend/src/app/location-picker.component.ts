import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-location-picker',
  standalone: true,
  template: `
    <div class="picker-help">Press Pin location, then click the {{ locationLabel }} position on the map.</div>
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
      <span>{{ hasLocation ? (latitude + ', ' + longitude) : 'No location pinned' }}</span>
      <button type="button" class="pin-toggle" (click)="pinning = !pinning">{{ pinning ? 'Cancel pinning' : (hasLocation ? 'Move pin' : 'Pin location') }}</button>
      <button type="button" (click)="clear()" [disabled]="!hasLocation">Clear</button>
    </div>
  `,
  styles: [`
    :host{display:block}.picker-help{font-size:9px;font-weight:500;color:#758398;margin-bottom:7px}
    .picker-wrap{position:relative}.picker-map{height:330px;border:1px solid #dce3ec;border-radius:10px;overflow:hidden}
    .pin-surface{position:absolute;inset:0;z-index:500;border:0;border-radius:10px;background:transparent;cursor:crosshair;padding:0}
    .pin-surface span{position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#0758c7;color:#fff;border-radius:20px;padding:6px 11px;font-size:9px;box-shadow:0 3px 10px #083b7d45;pointer-events:none}
    .picker-actions{display:flex;align-items:center;gap:8px;margin-top:8px}.picker-actions span{margin-right:auto;color:#758398;font-size:9px}
    .picker-actions button{border:1px solid #dce3ec;background:#fff;color:#40506a;border-radius:7px;padding:6px 9px;font-size:9px}
    .picker-actions .pin-toggle{background:#0758c7;color:#fff;border-color:#0758c7}
  `]
})
export class LocationPickerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() initialLatitude: unknown = '';
  @Input() initialLongitude: unknown = '';
  @Input() locationLabel = 'shelter';
  @Input() includeLocationText = false;
  @ViewChild('latitudePayload') private latitudePayload?: ElementRef<HTMLInputElement>;
  @ViewChild('longitudePayload') private longitudePayload?: ElementRef<HTMLInputElement>;
  @ViewChild('locationTextPayload') private locationTextPayload?: ElementRef<HTMLInputElement>;
  readonly mapId = `location-picker-${Math.random().toString(36).slice(2)}`;
  latitude = '';
  longitude = '';
  pinning = false;
  private map?: L.Map;
  private marker?: L.CircleMarker;

  get hasLocation() { return this.latitude !== '' && this.longitude !== ''; }
  get generatedLocationText() { return this.hasLocation ? `Pinned map location (${this.latitude}, ${this.longitude})` : ''; }

  ngOnChanges() {
    this.latitude = this.coordinate(this.initialLatitude);
    this.longitude = this.coordinate(this.initialLongitude);
    this.renderMarker();
  }

  ngAfterViewInit() {
    const center: L.LatLngExpression = this.hasLocation ? [Number(this.latitude), Number(this.longitude)] : [13.7795, 122.8708];
    this.map = L.map(this.mapId).setView(center, 16);
    L.tileLayer(environment.mapTileUrl, {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(this.map);
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
    this.latitude = location.lat.toFixed(7);
    this.longitude = location.lng.toFixed(7);
    this.pinning = false;
    this.syncPayloads();
    this.renderMarker();
  }

  clear() {
    this.latitude = '';
    this.longitude = '';
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
