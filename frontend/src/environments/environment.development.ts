export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000/api',
  mapCenter: [13.7828976, 122.8852784] as [number, number],
  mapInitialZoom: 14,
  mapMinZoom: 12,
  mapMaxZoom: 20,
  googleMapsApiKey: '',
  mapTileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  mapSatelliteTileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  mapSatelliteLabelsTileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
  ,mapHydroTileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Hydro_Reference_Overlay/MapServer/tile/{z}/{y}/{x}'
};
