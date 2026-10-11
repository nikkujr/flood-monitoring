import area from "@turf/area";
import bbox from "@turf/bbox";
import intersect from "@turf/intersect";
import { feature, featureCollection } from "@turf/helpers";

type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface FloodAssessmentItem {
  code: "SAFE" | "LF" | "MF" | "HF" | "VHF";
  label: string;
  percent: number;
  area: number;
  color: string;
}

export interface FloodAssessment {
  generatedAt: string;
  sourceUpdatedAt: string | null;
  source: { name: string; url: string; methodologyUrl: string };
  location: { region: string; province: string; municipality: string; barangay: string; hazard: string };
  totalArea: number;
  proneArea: number;
  pronePercent: number;
  assessment: FloodAssessmentItem[];
  cached: boolean;
  status: "live" | "cached" | "baseline";
  warning: string | null;
}

const layerUrl = process.env.MGB_FLOOD_LAYER_URL
  ?? "https://controlmap.mgb.gov.ph/arcgis/rest/services/GeospatialDataInventory/GDI_Detailed_Flood_Susceptibility/FeatureServer/0";
const cacheTtlMs = Math.max(60_000, Number(process.env.MGB_FLOOD_CACHE_TTL_MS ?? 86_400_000));
let cache: { expiresAt: number; value: FloodAssessment } | undefined;

const baseline: FloodAssessment = {
  generatedAt: "2018-01-01T00:00:00.000Z", sourceUpdatedAt: null, cached: true, status: "baseline",
  warning: "The DENR-MGB service is unavailable; showing the saved 2018 assessment until synchronization succeeds.",
  source: { name: "DENR-MGB 2018 saved assessment", url: layerUrl, methodologyUrl: "https://georisk.gov.ph/geoanalytics/data-and-methods" },
  location: { region: "Region V (Bicol Region)", province: "Camarines Sur", municipality: "Lupi", barangay: "Colacling (Del Rosario)", hazard: "Flood" },
  totalArea: 2_249_425, proneArea: 630_745, pronePercent: 28.04,
  assessment: [
    { code: "SAFE", label: "Safe", percent: 72, area: 1_619_586, color: "#e5e7eb" },
    { code: "LF", label: "Low susceptibility", percent: 15.4, area: 346_411, color: "#d9c8ff" },
    { code: "MF", label: "Moderate susceptibility", percent: 7, area: 157_460, color: "#a946ed" },
    { code: "HF", label: "High susceptibility", percent: 5.6, area: 125_968, color: "#5d16e8" },
    { code: "VHF", label: "Very high susceptibility", percent: 0, area: 0, color: "#001f73" }
  ]
};

const classes = [
  { code: "LF" as const, label: "Low susceptibility", color: "#d9c8ff" },
  { code: "MF" as const, label: "Moderate susceptibility", color: "#a946ed" },
  { code: "HF" as const, label: "High susceptibility", color: "#5d16e8" },
  { code: "VHF" as const, label: "Very high susceptibility", color: "#001f73" }
];

const roundedArea = (value: number) => Math.round(value);
const roundedPercent = (value: number) => Math.round(value * 100) / 100;

async function sourceLastUpdated(): Promise<string | null> {
  try {
    const response = await fetch(`${layerUrl}?f=json`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const metadata = await response.json() as { editingInfo?: { lastEditDate?: number } };
    return metadata.editingInfo?.lastEditDate ? new Date(metadata.editingInfo.lastEditDate).toISOString() : null;
  } catch { return null; }
}

export async function loadFloodAssessment(boundary: PolygonGeometry, force = false): Promise<FloodAssessment> {
  if (!force && cache && cache.expiresAt > Date.now()) return { ...cache.value, cached: true };
  const boundaryFeature = feature(boundary);
  const [xmin, ymin, xmax, ymax] = bbox(boundaryFeature);
  const params = new URLSearchParams({
    f: "geojson", where: "1=1", geometry: `${xmin},${ymin},${xmax},${ymax}`,
    geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields: "FloodSusc", outSR: "4326", returnGeometry: "true"
  });
  let collection: GeoJSON.FeatureCollection<PolygonGeometry, { FloodSusc?: string }> & { error?: { message?: string } };
  try {
    const response = await fetch(`${layerUrl}/query?${params}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`DENR-MGB flood service returned HTTP ${response.status}`);
    collection = await response.json() as typeof collection;
    if (collection.error) throw new Error(collection.error.message ?? "DENR-MGB flood query failed");
    if (!Array.isArray(collection.features)) throw new Error("DENR-MGB returned an invalid flood dataset");
  } catch (error) {
    console.error("DENR-MGB synchronization failed", error);
    if (cache) return { ...cache.value, cached: true, status: "cached", warning: "The DENR-MGB service is unavailable; showing the last synchronized assessment." };
    return baseline;
  }

  const totalArea = area(boundaryFeature);
  const areaByCode = new Map<string, number>();
  for (const hazard of collection.features) {
    const code = String(hazard.properties?.FloodSusc ?? "").toUpperCase();
    if (!classes.some(item => item.code === code) || !hazard.geometry) continue;
    try {
      const clipped = intersect(featureCollection([boundaryFeature, feature(hazard.geometry)]));
      if (clipped) areaByCode.set(code, (areaByCode.get(code) ?? 0) + area(clipped));
    } catch { /* Skip a malformed source polygon without losing the complete assessment. */ }
  }

  const rawProneArea = classes.reduce((sum, item) => sum + (areaByCode.get(item.code) ?? 0), 0);
  const proneArea = Math.min(totalArea, rawProneArea);
  const safeArea = Math.max(0, totalArea - proneArea);
  const assessment: FloodAssessmentItem[] = [
    { code: "SAFE", label: "Safe", color: "#e5e7eb", area: roundedArea(safeArea), percent: roundedPercent(safeArea / totalArea * 100) },
    ...classes.map(item => {
      const itemArea = areaByCode.get(item.code) ?? 0;
      return { ...item, area: roundedArea(itemArea), percent: roundedPercent(itemArea / totalArea * 100) };
    })
  ];
  const value: FloodAssessment = {
    generatedAt: new Date().toISOString(), sourceUpdatedAt: await sourceLastUpdated(),
    source: { name: "DENR-MGB Detailed Flood Susceptibility", url: layerUrl, methodologyUrl: "https://georisk.gov.ph/geoanalytics/data-and-methods" },
    location: { region: "Region V (Bicol Region)", province: "Camarines Sur", municipality: "Lupi", barangay: "Colacling (Del Rosario)", hazard: "Flood" },
    totalArea: roundedArea(totalArea), proneArea: roundedArea(proneArea), pronePercent: roundedPercent(proneArea / totalArea * 100),
    assessment, cached: false, status: "live", warning: null
  };
  cache = { expiresAt: Date.now() + cacheTtlMs, value };
  return value;
}
