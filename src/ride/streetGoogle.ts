/// <reference types="google.maps" />
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { Panorama } from './streetNavigation';

// Imbocco di via Marconi sul percorso della Ganda in public/world/bergamo/graph.json.
export const GAZZANIGA = { lat: 45.796655, lng: 9.837770 };
let configured = false;
export function loadStreet(key: string) {
  if (!configured) {
    setOptions({ key, v: 'quarterly', language: 'it' });
    configured = true;
  }
  return importLibrary('streetView');
}

export async function lookup(service: google.maps.StreetViewService, request: google.maps.StreetViewPanoRequest | google.maps.StreetViewLocationRequest): Promise<Panorama> {
  const { data } = await service.getPanorama(request);
  const loc = data.location;
  if (!loc?.latLng || !loc.pano) throw new Error('Panorama senza posizione.');
  return { id: loc.pano, lat: loc.latLng.lat(), lon: loc.latLng.lng(),
    links: (data.links ?? []).flatMap(link => link.pano && link.heading != null ? [{ id: link.pano, heading: link.heading }] : []) };
}

export async function locate(address: string): Promise<google.maps.LatLngLiteral> {
  const pair = address.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (pair) {
    const lat = Number(pair[1]), lng = Number(pair[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Coordinate fuori intervallo.');
    return { lat, lng };
  }
  const { Geocoder } = await importLibrary('geocoding');
  const { results } = await new Geocoder().geocode({ address });
  if (!results.length) throw new Error('Luogo non trovato.');
  return results[0].geometry.location.toJSON();
}

export { importLibrary };
