import buffer from '@turf/buffer';
import union from '@turf/union';
import { feature, featureCollection } from '@turf/helpers';

export function operationalBoundary(zones: Array<Record<string, any>>): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | undefined {
  const zoneFeatures: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>> = [];
  for (const zone of zones) {
    try {
      const raw = zone['polygon_geojson'] ?? zone['polygonGeoJson'];
      const geometry = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') zoneFeatures.push(feature(geometry));
    } catch { /* Ignore invalid legacy geometry. */ }
  }
  if (!zoneFeatures.length) return undefined;

  // Close tiny digitizing gaps between adjacent zones before dissolving them.
  const expanded = buffer(featureCollection(zoneFeatures), 0.02, { units: 'kilometers', steps: 4 });
  if (!expanded || !expanded.features.length) return undefined;
  const dissolved = union(expanded);
  if (!dissolved) return undefined;
  const outline = buffer(dissolved, -0.02, { units: 'kilometers', steps: 4 }) ?? dissolved;
  outline.properties = { name: 'Colacling boundary', source: 'Exterior perimeter of configured barangay zones' };
  return outline;
}
