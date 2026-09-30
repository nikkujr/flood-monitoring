declare module 'leaflet.gridlayer.googlemutant' {
	import * as L from 'leaflet';
	export default class GoogleMutant extends L.GridLayer {
		constructor(options?: L.GridLayerOptions & { type?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid' });
	}
}
