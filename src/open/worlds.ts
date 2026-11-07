import { loadKv, saveKv } from '@/db/db';

/**
 * I mondi che l'app conosce, e quale si sta usando. Un mondo è una cartella `public/world/<id>/`
 * costruita da scripts/world/build-world.ts; qui ci sono le cose che servono PRIMA di caricarlo
 * (nome, coordinate, come si chiamano le sue zone) e la memoria dell'ultimo scelto.
 *
 * ⚠ Da saldare con la pista S1: `WORLDS` in src/open/world.ts è la tabella di S1 (id, nome,
 * HORIZON, FAR_STEP…). Questo file aggiunge quello che serve alle pagine; al merge i campi
 * comuni (id, name, lat, lon) si leggono da lì e `WORLD_CATALOG` diventa una vista su `WORLDS`.
 */

export interface WorldInfo {
  id: string;
  /** il nome lungo: «Bergamo e le valli» */
  name: string;
  /** il nome corto, per i gettoni e le righe strette: «Bergamo» */
  short: string;
  /** una riga: cosa c'è dentro */
  blurb: string;
  /** il centro, per il meteo e il sole */
  lat: number;
  lon: number;
  /** le zone dei percorsi (`RideDef.area`) e il loro nome */
  areas: Record<string, string>;
  /** i paesi da cui parte il giro libero; vuoto = i paesi grandi dei dati */
  towns: string[];
  /** la quota tipica delle strade: sopra, la quota resta sempre a schermo (F.4) */
  highAlt: number;
  /** il riquadro geografico, per riconoscere il mondo di un giro dal suo GPS: [lat sud, lon ovest, lat nord, lon est] */
  box: [number, number, number, number];
}

export const DEFAULT_WORLD = 'bergamo';

export const WORLD_CATALOG: WorldInfo[] = [
  {
    id: 'bergamo',
    name: 'Bergamo e le valli',
    short: 'Bergamo',
    blurb: 'Città Alta, Val Brembana, Val Seriana',
    lat: 45.8675,
    lon: 9.8,
    areas: { citta: 'Bergamo città', seriana: 'Val Seriana', brembana: 'Val Brembana', valli: 'Fra le due valli' },
    towns: ['Bergamo', 'Città Alta', 'Ponteranica', 'Alzano Lombardo', 'Nembro', 'Albino', 'Gazzaniga', 'Ponte Nossa', 'Clusone', 'Castione della Presolana', 'Villa d’Almè', 'Zogno', 'San Pellegrino Terme', 'San Giovanni Bianco', 'Piazza Brembana', 'Branzi', 'Serina', 'Selvino'],
    highAlt: 1000,
    box: [45.45, 9.3, 46.3, 10.3],
  },
  {
    id: 'sellaronda',
    name: 'Sellaronda',
    short: 'Sellaronda',
    blurb: 'Sella, Pordoi, Gardena, Campolongo e la Marmolada',
    lat: 46.51,
    lon: 11.81,
    areas: { sella: 'Il giro del Sella', passi: 'I passi', fassa: 'Val di Fassa', gardena: 'Val Gardena', badia: 'Alta Badia', marmolada: 'Marmolada' },
    towns: ['Selva di Val Gardena', 'Corvara in Badia', 'Arabba', 'Canazei', 'Colfosco', 'Campitello di Fassa'],
    highAlt: 1000,
    box: [46.3, 11.55, 46.68, 12.1],
  },
];

/**
 * Il mondo di un giro salvato: il campo `world` se c'è (giri dal 07/11/2026), il prefisso del
 * `routeId` («bergamo:ganda»), altrimenti dove cade il GPS. Null per le salite verificate e i
 * giri importati da fuori.
 */
export function worldOfRide(ride: { world?: string; routeId?: string; samples?: readonly { lat?: number; lon?: number }[] }): string | null {
  if (isWorldId(ride.world)) return ride.world;
  const prefix = ride.routeId?.split(':')[0];
  if (ride.routeId?.includes(':') && isWorldId(prefix)) return prefix;
  const s = ride.samples?.find((q) => typeof q.lat === 'number' && typeof q.lon === 'number' && Number.isFinite(q.lat) && Number.isFinite(q.lon) && !(q.lat === 0 && q.lon === 0));
  if (!s) return null;
  for (const w of WORLD_CATALOG) {
    const [s0, w0, n1, e1] = w.box;
    if (s.lat! >= s0 && s.lat! <= n1 && s.lon! >= w0 && s.lon! <= e1) return w.id;
  }
  return null;
}

const BY_ID = new Map(WORLD_CATALOG.map((w) => [w.id, w]));

export function isWorldId(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id);
}

export function worldInfo(id: string | null | undefined): WorldInfo {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_WORLD)!;
}

export function worldName(id: string | null | undefined): string {
  return worldInfo(id).name;
}

const LAST_KEY = 'orobia.world';

/** L'ultimo mondo scelto (sincrono, da localStorage; la copia in kv la legge `loadLastWorld`). */
export function lastWorld(): string {
  try {
    const v = localStorage.getItem(LAST_KEY);
    if (isWorldId(v)) return v;
  } catch {
    // modalità privata o niente storage: il mondo di partenza
  }
  return DEFAULT_WORLD;
}

export function rememberWorld(id: string): void {
  if (!isWorldId(id)) return;
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // il kv sotto basta
  }
  void saveKv('mondo', id).catch(() => undefined);
}

/** L'ultimo mondo anche dal database (un telefono che ha svuotato localStorage ma non IndexedDB). */
export async function loadLastWorld(): Promise<string> {
  const local = lastWorld();
  if (local !== DEFAULT_WORLD) return local;
  const kv = await loadKv<string>('mondo').catch(() => undefined);
  return isWorldId(kv) ? kv : local;
}

/** Il mondo chiesto dall'indirizzo (`?world=`), se è uno dei nostri; altrimenti l'ultimo. */
export function worldFromParams(params: { get(k: string): string | null }): string {
  const v = params.get('world');
  return isWorldId(v) ? v : lastWorld();
}

/**
 * Il manifesto di un mondo, scritto da scripts/world-manifest.mjs in public/world/<id>/manifest.json:
 * i file con il loro peso, il totale, i km di strade e quanti percorsi ha. Serve alla scelta del
 * mondo (riga con i numeri) e allo scarico per l'uso senza rete, senza tirare giù il grafo.
 */
export interface WorldManifest {
  id: string;
  builtAt: string;
  /** [percorso relativo alla cartella del mondo, byte] */
  files: [string, number][];
  bytes: number;
  roadsKm: number;
  rides: number;
}

export function worldBaseUrl(id: string): string {
  const base = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/';
  return `${base}world/${id}/`;
}

const manifests = new Map<string, Promise<WorldManifest | null>>();

export function fetchManifest(id: string, fetcher: typeof fetch = fetch): Promise<WorldManifest | null> {
  let p = manifests.get(id);
  if (!p) {
    p = fetcher(`${worldBaseUrl(id)}manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<WorldManifest>) : null))
      .then((m) => (m && Array.isArray(m.files) ? m : null))
      .catch(() => null);
    p.then((m) => {
      // un mondo non ancora costruito si richiede la prossima volta
      if (!m) manifests.delete(id);
    });
    manifests.set(id, p);
  }
  return p;
}

/** «1.482 km di strade · 14 percorsi», dai numeri del manifesto. */
export function worldFacts(m: Pick<WorldManifest, 'roadsKm' | 'rides'>): string {
  const km = new Intl.NumberFormat('it-IT', { useGrouping: 'always', maximumFractionDigits: 0 } as Intl.NumberFormatOptions).format(Math.round(m.roadsKm));
  return `${km} km di strade · ${m.rides} ${m.rides === 1 ? 'percorso' : 'percorsi'}`;
}
