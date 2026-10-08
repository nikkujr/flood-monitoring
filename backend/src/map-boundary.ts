import { readFileSync } from 'node:fs';

// PSA Colacling boundary retrieved 2026-10-09 from https://portal.georisk.gov.ph/arcgis/rest/services/PSA/Barangay/MapServer/4.
export const colaclingBoundary = JSON.parse(readFileSync(new URL('../data/colacling-boundary.geojson', import.meta.url), 'utf8'));

export function pointInsideGeometry(latitude: number, longitude: number, value: unknown): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  try {
    const geo = typeof value === 'string' ? JSON.parse(value) : value as any;
    if (geo?.type === 'FeatureCollection') return geo.features.some((f: any) => pointInsideGeometry(latitude, longitude, f));
    if (geo?.type === 'Feature') return pointInsideGeometry(latitude, longitude, geo.geometry);
    const polygons = geo?.type === 'Polygon' ? [geo.coordinates] : geo?.type === 'MultiPolygon' ? geo.coordinates : [];
    const ringPosition = (ring: number[][]) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x, y] = ring[i]!, [px, py] = ring[j]!;
        if (Math.abs((longitude - x!) * (py! - y!) - (latitude - y!) * (px! - x!)) < 1e-10
          && longitude >= Math.min(x!, px!) && longitude <= Math.max(x!, px!)
          && latitude >= Math.min(y!, py!) && latitude <= Math.max(y!, py!)) return 0;
        if ((y! > latitude) !== (py! > latitude) && longitude < (px! - x!) * (latitude - y!) / (py! - y!) + x!) inside = !inside;
      }
      return inside ? 1 : -1;
    };
    return polygons.some((polygon: number[][][]) => ringPosition(polygon[0] ?? []) >= 0
      && !polygon.slice(1).some(hole => ringPosition(hole) === 1));
  } catch { return false; }
}
