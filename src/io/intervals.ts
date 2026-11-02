import { gunzipSync } from 'fflate';
import type { Ride, RideLap, RideSample } from '@/domain/types';
import { buildRide, validPosition } from '@/domain/metrics';
import { fillLapDistances } from '@/domain/replay';

/**
 * Client Intervals.icu (API ufficiale, https://intervals.icu/api/v1/docs/).
 *
 * Autenticazione Basic: utente letterale `API_KEY`, password la chiave personale
 * (Impostazioni → Developer Settings). L'atleta `0` è il proprietario della chiave.
 *
 * La chiave vive solo negli argomenti delle funzioni: non si scrive in console,
 * in localStorage, negli errori o negli URL. Chi chiama decide se e dove tenerla.
 *
 * CORS: l'API risponde al preflight con Access-Control-Allow-Origin uguale
 * all'origine e Allow-Headers che include `authorization`, quindi la chiamata
 * diretta dal browser è possibile. Se un proxy o un'estensione la bloccano,
 * fetch lancia TypeError e qui diventa un errore 'network' con il ripiego
 * dell'import manuale.
 */

export const INTERVALS_BASE = 'https://intervals.icu/api/v1';

/** Tipi di stream chiesti per il replay. */
export const STREAM_TYPES = [
  'time',
  'watts',
  'heartrate',
  'cadence',
  'altitude',
  'latlng',
  'distance',
  'velocity_smooth',
] as const;

export interface IntervalsOptions {
  apiKey: string;
  /** `0` = l'atleta proprietario della chiave. */
  athleteId?: string;
  fetchImpl?: typeof fetch;
}

export type IntervalsErrorKind = 'auth' | 'not-found' | 'network' | 'unavailable' | 'http' | 'format';

export class IntervalsError extends Error {
  readonly kind: IntervalsErrorKind;
  readonly status?: number;
  constructor(kind: IntervalsErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'IntervalsError';
    this.kind = kind;
    this.status = status;
  }
}

const MANUAL_HINT = 'In alternativa esporta il file FIT, GPX o TCX e importalo a mano.';

export const STRAVA_REASON =
  "Attività arrivata da Strava: per i termini d'uso di Strava, Intervals.icu non ne espone i dati via API. " +
  'Importa il file originale (FIT, GPX o TCX) dal dispositivo o da Garmin Connect.';

export interface IntervalsActivity {
  /** Id Intervals, es. `i12345`. */
  id: string;
  name: string;
  /** ISO 8601. UTC se Intervals lo fornisce, altrimenti l'ora locale dichiarata. */
  startTime: string;
  type: string;
  distanceM: number;
  movingTimeSec: number;
  elevationGainM: number;
  hasPower: boolean;
  /** STRAVA, GARMIN_CONNECT, UPLOAD, … come lo dà Intervals. */
  source: string;
  /** Vero per le schede vuote (Strava): niente stream, niente file. */
  unavailable?: boolean;
  unavailableReason?: string;
}

// ---------------------------------------------------------------------------
// Trasporto.

function authHeader(apiKey: string): string {
  const key = (apiKey ?? '').trim();
  if (!key) throw new IntervalsError('auth', 'Manca la chiave API di Intervals.icu.');
  // Le chiavi sono ASCII: un carattere fuori range è quasi sempre un incolla sbagliato.
  if (!/^[\x20-\x7e]+$/.test(key)) {
    throw new IntervalsError('auth', 'La chiave API contiene caratteri non validi.');
  }
  return `Basic ${btoa(`API_KEY:${key}`)}`;
}

async function request(opts: IntervalsOptions, path: string, accept: string): Promise<Response> {
  const headers = { Authorization: authHeader(opts.apiKey), Accept: accept };
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${INTERVALS_BASE}${path}`, { method: 'GET', headers });
  } catch {
    // TypeError del browser: rete assente, DNS o CORS. Il dettaglio non si legge da JS.
    throw new IntervalsError('network', `Intervals.icu non risponde dal browser (rete o CORS). ${MANUAL_HINT}`);
  }
  if (res.ok) return res;
  if (res.status === 401 || res.status === 403) {
    throw new IntervalsError('auth', 'Chiave API di Intervals.icu rifiutata: controllala nelle impostazioni Developer.', res.status);
  }
  if (res.status === 404) {
    throw new IntervalsError('not-found', 'Attività o atleta non trovati su Intervals.icu.', 404);
  }
  if (res.status === 429) {
    throw new IntervalsError('http', 'Troppe richieste a Intervals.icu: riprova fra un minuto.', 429);
  }
  throw new IntervalsError('http', `Intervals.icu ha risposto ${res.status}. ${MANUAL_HINT}`, res.status);
}

async function getJson(opts: IntervalsOptions, path: string): Promise<unknown> {
  const res = await request(opts, path, 'application/json');
  try {
    return await res.json();
  } catch {
    throw new IntervalsError('format', 'Risposta di Intervals.icu non leggibile.');
  }
}

function athletePath(opts: IntervalsOptions): string {
  return `/athlete/${encodeURIComponent(opts.athleteId ?? '0')}`;
}

function activityPath(id: string): string {
  return `/activity/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Elenco attività.

/**
 * Attività fra due date locali (YYYY-MM-DD), dalla più recente.
 * Le attività Strava arrivano come schede vuote (`_note`, source STRAVA):
 * restano in elenco ma marcate `unavailable` con il motivo.
 */
export async function listActivities(
  opts: IntervalsOptions,
  oldest: string,
  newest: string,
): Promise<IntervalsActivity[]> {
  const query = `oldest=${encodeURIComponent(oldest)}&newest=${encodeURIComponent(newest)}`;
  const body = await getJson(opts, `${athletePath(opts)}/activities?${query}`);
  if (!Array.isArray(body)) throw new IntervalsError('format', 'Elenco attività di Intervals.icu non valido.');
  return body.filter(isRecord).map(normalizeActivity).filter((a) => a.id !== '');
}

export function normalizeActivity(raw: Record<string, unknown>): IntervalsActivity {
  const source = str(raw.source) ?? '';
  const name = str(raw.name);
  const distance = num(raw.distance) ?? num(raw.icu_distance);
  const moving = num(raw.moving_time) ?? num(raw.elapsed_time);
  const streams = Array.isArray(raw.stream_types) ? raw.stream_types : [];
  const activity: IntervalsActivity = {
    id: str(raw.id) ?? (typeof raw.id === 'number' ? String(raw.id) : ''),
    name: name ?? 'Attività Intervals',
    startTime: startTimeOf(raw),
    type: str(raw.type) ?? 'Ride',
    distanceM: distance ?? 0,
    movingTimeSec: moving ?? 0,
    elevationGainM: num(raw.total_elevation_gain) ?? 0,
    hasPower:
      raw.device_watts === true ||
      (num(raw.icu_average_watts) ?? 0) > 0 ||
      (num(raw.average_watts) ?? 0) > 0 ||
      streams.includes('watts'),
    source,
  };
  // Scheda vuota: dichiarata Strava, o con la nota di Intervals, o senza alcun dato.
  const stub = source.toUpperCase() === 'STRAVA' || typeof raw._note === 'string' || (name == null && distance == null && moving == null);
  if (stub) {
    activity.unavailable = true;
    activity.unavailableReason =
      source.toUpperCase() === 'STRAVA' || typeof raw._note === 'string'
        ? STRAVA_REASON
        : `Intervals.icu non fornisce i dati di questa attività. ${MANUAL_HINT}`;
  }
  return activity;
}

function startTimeOf(raw: Record<string, unknown>): string {
  for (const value of [str(raw.start_date), str(raw.start_date_local)]) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date(0).toISOString();
}

// ---------------------------------------------------------------------------
// Stream.

interface RawStream {
  type?: unknown;
  data?: unknown;
  data2?: unknown;
}

/**
 * Stream dell'attività → campioni. Il tempo è quello dello stream `time`
 * (secondi dall'inizio, con i buchi delle pause): non si ricampiona, così il
 * replay vede le soste. Senza `time` si assume 1 Hz.
 */
export async function fetchActivityStreams(opts: IntervalsOptions, id: string): Promise<RideSample[]> {
  const types = STREAM_TYPES.join(',');
  const body = await getJson(opts, `${activityPath(id)}/streams.json?types=${types}`);
  if (!Array.isArray(body)) {
    if (isRecord(body) && (body.source === 'STRAVA' || typeof body._note === 'string')) {
      throw new IntervalsError('unavailable', STRAVA_REASON);
    }
    throw new IntervalsError('format', 'Stream di Intervals.icu non validi.');
  }
  return streamsToSamples(body.filter(isRecord) as RawStream[]);
}

export function streamsToSamples(streams: RawStream[]): RideSample[] {
  const byType = new Map<string, RawStream>();
  for (const s of streams) if (typeof s.type === 'string') byType.set(s.type, s);
  const series = (type: string): (number | null)[] => numbers(byType.get(type)?.data);
  const time = series('time');
  const watts = series('watts');
  const hr = series('heartrate');
  const cadence = series('cadence');
  const altitude = series('altitude');
  const distance = series('distance');
  const speed = series('velocity_smooth');
  const [lats, lons] = latLng(byType.get('latlng'));
  const n = Math.max(time.length, watts.length, hr.length, distance.length, lats.length, altitude.length, speed.length);
  const out: RideSample[] = [];
  for (let i = 0; i < n; i++) {
    const t = time.length ? time[i] : i;
    if (t == null || !Number.isFinite(t)) continue;
    const sample: RideSample = {
      t,
      power: Math.max(0, watts[i] ?? 0),
      hr: Math.max(0, hr[i] ?? 0),
      cadence: Math.max(0, cadence[i] ?? 0),
      speed: Math.max(0, speed[i] ?? 0),
      distance: distance[i] ?? Number.NaN,
      altitude: altitude[i] ?? 0,
      grade: 0,
    };
    const lat = lats[i];
    const lon = lons[i];
    if (lat != null && lon != null && validPosition(lat, lon)) {
      sample.lat = lat;
      sample.lon = lon;
    }
    out.push(sample);
  }
  out.sort((a, b) => a.t - b.t);
  // Distanza mancante in un punto: tengo l'ultima nota (o 0 all'inizio).
  let last = 0;
  for (const s of out) {
    if (Number.isFinite(s.distance)) last = s.distance;
    else s.distance = last;
  }
  return out;
}

/** latlng arriva come `data` = latitudini e `data2` = longitudini, o come coppie [lat, lng]. */
function latLng(stream: RawStream | undefined): [(number | null)[], (number | null)[]] {
  if (!stream || !Array.isArray(stream.data)) return [[], []];
  if (Array.isArray(stream.data2)) return [numbers(stream.data), numbers(stream.data2)];
  const lats: (number | null)[] = [];
  const lons: (number | null)[] = [];
  for (const item of stream.data) {
    if (Array.isArray(item) && item.length >= 2) {
      lats.push(numOrNull(item[0]));
      lons.push(numOrNull(item[1]));
    } else if (isRecord(item)) {
      lats.push(numOrNull(item.lat));
      lons.push(numOrNull(item.lng ?? item.lon));
    } else {
      lats.push(null);
      lons.push(null);
    }
  }
  return [lats, lons];
}

// ---------------------------------------------------------------------------
// Giri.

/**
 * Intervalli di Intervals.icu (`icu_intervals`) → giri. Si usano start_time/end_time
 * (secondi dall'inizio); senza, start_index/end_index sui campioni passati, o come
 * secondi se i campioni non ci sono. Le distanze cumulate vengono dai campioni.
 */
export async function fetchActivityLaps(
  opts: IntervalsOptions,
  id: string,
  samples?: readonly RideSample[],
): Promise<RideLap[]> {
  const body = await getJson(opts, `${activityPath(id)}?intervals=true`);
  if (!isRecord(body)) throw new IntervalsError('format', 'Attività di Intervals.icu non valida.');
  if (body.source === 'STRAVA' || typeof body._note === 'string') {
    throw new IntervalsError('unavailable', STRAVA_REASON);
  }
  return intervalsToLaps(Array.isArray(body.icu_intervals) ? body.icu_intervals : [], samples);
}

export function intervalsToLaps(raw: unknown[], samples?: readonly RideSample[]): RideLap[] {
  const at = (index: number | undefined): number | undefined => {
    if (index == null) return undefined;
    if (samples && samples.length) {
      const s = samples[Math.min(samples.length - 1, Math.max(0, Math.round(index)))];
      return s?.t;
    }
    return index;
  };
  const laps: RideLap[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const startSec = num(item.start_time) ?? at(num(item.start_index));
    let endSec = num(item.end_time) ?? at(num(item.end_index));
    if (endSec == null && startSec != null) {
      const elapsed = num(item.elapsed_time) ?? num(item.moving_time);
      if (elapsed != null) endSec = startSec + elapsed;
    }
    if (startSec == null || endSec == null || !(endSec > startSec)) continue;
    const lap: RideLap = { startSec, endSec };
    const name = str(item.label) ?? str(item.type);
    if (name) lap.name = name;
    laps.push(lap);
  }
  laps.sort((a, b) => a.startSec - b.startSec);
  return samples && samples.length ? fillLapDistances(laps, samples) : laps;
}

// ---------------------------------------------------------------------------
// File originale.

/**
 * File originale caricato su Intervals (spesso FIT compresso gzip).
 * Se i primi due byte sono la firma gzip (1f 8b) lo decomprime.
 */
export async function fetchOriginalFile(opts: IntervalsOptions, id: string): Promise<ArrayBuffer> {
  const res = await request(opts, `${activityPath(id)}/file`, 'application/octet-stream, */*');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new IntervalsError('network', `Download del file interrotto. ${MANUAL_HINT}`);
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = gunzipSync(bytes);
    } catch {
      throw new IntervalsError('format', 'File compresso di Intervals.icu non leggibile.');
    }
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Riconosce il formato dai primi byte, per dare il nome giusto all'import. */
export function sniffActivityFile(data: ArrayBuffer | Uint8Array): 'fit' | 'tcx' | 'gpx' | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length >= 12 && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === '.FIT') return 'fit';
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 1024));
  if (/<TrainingCenterDatabase/i.test(head)) return 'tcx';
  if (/<gpx/i.test(head)) return 'gpx';
  return null;
}

// ---------------------------------------------------------------------------
// Ride.

export function rideFromIntervals(
  meta: IntervalsActivity,
  samples: RideSample[],
  laps: RideLap[],
  ftp: number,
  lthr: number,
): Ride {
  const last = samples.length ? samples[samples.length - 1] : undefined;
  const duration = last && last.t > 0 ? last.t - samples[0].t : meta.movingTimeSec;
  const ride = buildRide({
    id: `icu-${meta.id}`,
    name: meta.name,
    sport: /run/i.test(meta.type) ? 'running' : 'cycling',
    source: 'import',
    startTime: new Date(meta.startTime),
    durationSec: Math.max(0, duration),
    samples,
    ftp,
    lthr,
    withCamilla: false,
    distanceM: meta.distanceM > 0 ? meta.distanceM : last?.distance ?? 0,
  });
  ride.externalId = `intervals:${meta.id}`;
  if (laps.length > 0) ride.laps = laps;
  return ride;
}

// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numbers(data: unknown): (number | null)[] {
  return Array.isArray(data) ? data.map(numOrNull) : [];
}
