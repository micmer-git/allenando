import { centerOf, projector, type GeoSample, type LatLon } from './geo';
import { createRouteTrack, type RouteTrack } from './track';

/** Dati di una salita come li scrive scripts/fetch-climbs.mjs. */
export interface RouteFile {
  id: string;
  name: string;
  side: string;
  region: string;
  verified: boolean;
  fetchedAt: string;
  sources: { road: string; elevation: string; attribution: string };
  waypoints: [number, number][];
  roads: { label: string; m: number }[];
  origin: LatLon;
  /** [lat, lon, quota] */
  track: [number, number, number][];
  terrain: DemGrid;
}

/** Griglia di quote in metri locali, z verso sud. heights[j * nx + i]. */
export interface DemGrid {
  step: number;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  heights: (number | null)[];
}

export interface RouteMeta {
  id: string;
  name: string;
  side: string;
  region: string;
  /** Semilarghezza stimata della carreggiata: OSM di rado ha il tag width. */
  halfWidth: number;
}

/** Le salite con la traccia vera nel pacchetto. */
export const VERIFIED_ROUTES: RouteMeta[] = [
  {
    id: 'selvino-nembro',
    name: 'Selvino',
    side: 'da Nembro',
    region: 'Val Seriana · Bergamo',
    halfWidth: 3,
  },
  {
    id: 'mortirolo-mazzo',
    name: 'Mortirolo',
    side: 'da Mazzo di Valtellina',
    region: 'Valtellina · Sondrio',
    halfWidth: 2.4,
  },
  {
    id: 'stelvio-prato',
    name: 'Stelvio',
    side: 'da Prato allo Stelvio',
    region: 'Val Venosta · Bolzano',
    halfWidth: 3,
  },
  {
    id: 'stelvio-bormio',
    name: 'Stelvio',
    side: 'da Bormio',
    region: 'Alta Valtellina · Sondrio',
    halfWidth: 3,
  },
];

export interface CatalogEntry {
  name: string;
  side?: string;
  region: string;
  /** id di VERIFIED_ROUTES se la traccia c'è, altrimenti assente: «traccia da acquisire». */
  routeId?: string;
}

/**
 * Il catalogo delle grandi salite italiane. Per quelle senza traccia non diamo numeri:
 * lunghezza e pendenza arrivano solo con una traccia vera, importata o verificata.
 */
export const CATALOG: CatalogEntry[] = [
  { name: 'Passo dello Stelvio', side: 'da Prato allo Stelvio', region: 'Alto Adige', routeId: 'stelvio-prato' },
  { name: 'Passo dello Stelvio', side: 'da Bormio', region: 'Lombardia', routeId: 'stelvio-bormio' },
  { name: 'Passo del Mortirolo', side: 'da Mazzo di Valtellina', region: 'Lombardia', routeId: 'mortirolo-mazzo' },
  { name: 'Selvino', side: 'da Nembro', region: 'Lombardia', routeId: 'selvino-nembro' },
  { name: 'Monte Zoncolan', side: 'da Ovaro', region: 'Friuli-Venezia Giulia' },
  { name: 'Passo di Gavia', side: 'da Ponte di Legno', region: 'Lombardia' },
  { name: 'Passo Giau', side: 'da Selva di Cadore', region: 'Veneto' },
  { name: 'Passo Fedaia', side: 'da Caprile', region: 'Veneto' },
  { name: 'Colle delle Finestre', side: 'da Susa', region: 'Piemonte' },
  { name: "Colle dell'Agnello", side: 'da Casteldelfino', region: 'Piemonte' },
  { name: 'Tre Cime di Lavaredo', side: 'da Misurina', region: 'Veneto' },
  { name: 'Passo Pordoi', side: 'da Arabba', region: 'Veneto' },
  { name: 'Passo Sella', side: 'da Canazei', region: 'Trentino' },
  { name: 'Blockhaus', side: 'da Roccamorice', region: 'Abruzzo' },
  { name: 'Etna', side: 'da Nicolosi', region: 'Sicilia' },
  { name: 'Monte Grappa', side: 'da Romano d’Ezzelino', region: 'Veneto' },
  { name: 'Plan de Corones', side: 'da San Vigilio di Marebbe', region: 'Alto Adige' },
  { name: 'Monte Bondone', side: 'da Trento', region: 'Trentino' },
  { name: 'Colle del Nivolet', side: 'da Ceresole Reale', region: 'Piemonte' },
  { name: 'Passo Manghen', side: 'da Borgo Valsugana', region: 'Trentino' },
];

export function routeMeta(id: string): RouteMeta | undefined {
  return VERIFIED_ROUTES.find((r) => r.id === id);
}

const fileCache = new Map<string, Promise<RouteFile>>();

export function loadRouteFile(id: string): Promise<RouteFile> {
  let p = fileCache.get(id);
  if (!p) {
    const base = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/';
    p = fetch(`${base}routes/${id}.json`).then((res) => {
      if (!res.ok) throw new Error(`traccia ${id} non disponibile (${res.status})`);
      return res.json() as Promise<RouteFile>;
    });
    p.catch(() => fileCache.delete(id));
    fileCache.set(id, p);
  }
  return p;
}

export interface LoadedRoute {
  id: string;
  title: string;
  subtitle: string;
  track: RouteTrack;
  dem: DemGrid | null;
  origin: LatLon;
  attribution: string;
  /** true per le salite del pacchetto; false per una traccia importata dall'utente. */
  verified: boolean;
}

export function trackFromRouteFile(file: RouteFile, halfWidth = 3): LoadedRoute {
  const proj = projector(file.origin);
  const pts = file.track.map(([lat, lon, ele]) => ({ ...proj.toLocal({ lat, lon }), ele }));
  return {
    id: file.id,
    title: file.name,
    subtitle: file.side,
    track: createRouteTrack(pts, { halfWidth }),
    dem: file.terrain,
    origin: file.origin,
    attribution: file.sources.attribution,
    verified: file.verified,
  };
}

/** Una traccia qualunque (GPX importato, giro con GPS): niente terreno DEM, strada vera. */
export function trackFromGeo(id: string, title: string, samples: GeoSample[], subtitle = ''): LoadedRoute {
  const origin = centerOf(samples);
  const proj = projector(origin);
  const pts = samples.map((s) => ({ ...proj.toLocal(s), ele: s.ele }));
  return {
    id,
    title,
    subtitle,
    track: createRouteTrack(pts, { halfWidth: 3 }),
    dem: null,
    origin,
    attribution: '',
    verified: false,
  };
}

export interface RouteStats {
  lengthM: number;
  startAlt: number;
  endAlt: number;
  gainM: number;
  avgGrade: number;
  /** Pendenza media del chilometro più duro. */
  maxKmGrade: number;
  /** Pendenza massima su 100 m. */
  max100Grade: number;
  hairpins: number;
}

export function routeStats(track: RouteTrack): RouteStats {
  const pts = track.points;
  let gain = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].y > pts[i - 1].y) gain += pts[i].y - pts[i - 1].y;
  const windowGrade = (w: number) => {
    let best = 0;
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
      while (j < pts.length - 1 && pts[j].distance - pts[i].distance < w) j++;
      if (pts[j].distance - pts[i].distance < w * 0.98) break;
      best = Math.max(best, (pts[j].y - pts[i].y) / (pts[j].distance - pts[i].distance));
    }
    return best;
  };
  const start = pts[0].y + track.altitudeBase;
  const end = pts[pts.length - 1].y + track.altitudeBase;
  return {
    lengthM: track.length,
    startAlt: start,
    endAlt: end,
    gainM: gain,
    avgGrade: (end - start) / track.length,
    maxKmGrade: windowGrade(1000),
    max100Grade: windowGrade(100),
    hairpins: track.hairpins.length,
  };
}

/** Link ufficiale a Google Maps in modalità Street View: si apre fuori dall'app. */
/**
 * Link al visore ufficiale di Google Street View (Maps URLs, apertura in una scheda nuova).
 * Solo un collegamento: nessuna immagine viene scaricata, copiata o usata nel mondo 3D.
 */
export function streetViewUrl(p: LatLon, heading?: number, pitch = 0): string {
  const h = heading != null && Number.isFinite(heading) ? `&heading=${Math.round(((heading % 360) + 360) % 360) % 360}&pitch=${Number.isFinite(pitch) ? Math.round(Math.max(-80,Math.min(80,pitch))) : 0}&fov=90` : '';
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat.toFixed(5)},${p.lon.toFixed(5)}${h}`;
}

/** Lo stesso punto nel visore di Mapillary (foto CC BY-SA dei contributori). */
export function mapillaryUrl(p: LatLon): string {
  return `https://www.mapillary.com/app/?lat=${p.lat.toFixed(5)}&lng=${p.lon.toFixed(5)}&z=17`;
}

/**
 * Da direzione del mondo 3D a rotta bussola (0 = nord, 90 = est). Nel mondo avanti è
 * (sin h, cos h) su (x, z), x è est e z è sud.
 */
export function headingToBearing(heading: number): number {
  const east = Math.sin(heading);
  const north = -Math.cos(heading);
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function osmUrl(p: LatLon, zoom = 14): string {
  return `https://www.openstreetmap.org/#map=${zoom}/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}`;
}
