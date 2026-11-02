import type { Ride, RideLap, RideSample } from './types';
import { elevationGain, haversine, validPosition } from './metrics';

/**
 * Replay di un'uscita vera: si ritaglia un tratto, si rilegge la potenza
 * (o la pendenza) e si corre contro il fantasma di sé stessi.
 *
 * Scelte sul tempo:
 * - Il tempo resta quello trascorso nel file (elapsed), pause comprese:
 *   niente compressione, così il fantasma arriva quando arrivava davvero.
 * - Un buco fra due campioni più lungo di PAUSE_GAP_SEC è una sosta:
 *   distanza e posizione restano ferme fino al campione dopo, potenza 0.
 *   Sotto la soglia si interpola linearmente.
 *
 * Le funzioni di interrogazione (powerAtTime, ghost…, gapSeconds) contano
 * tempo e distanza dal primo campione: sui campioni di sliceSection, che
 * partono da t=0 e distanza 0, coincidono con i valori grezzi.
 */

/** Oltre questo buco fra due campioni il ciclista era fermo. */
export const PAUSE_GAP_SEC = 10;
/** Un salto GPS che implica più di 30 m/s (108 km/h) è rumore. */
const SPIKE_SPEED_MS = 30;
/** Passo minimo fra due punti geografici o di profilo. */
const MIN_SPACING_M = 5;
/** Quota: sotto questa escursione la traccia è considerata senza altimetria. */
const MIN_ALTITUDE_RANGE_M = 0.5;

export type SectionSpec =
  | { kind: 'full' }
  | { kind: 'time'; fromSec: number; toSec: number }
  | { kind: 'distance'; fromM: number; toM: number }
  | { kind: 'lap'; index: number };

export interface GeoPoint {
  lat: number;
  lon: number;
  ele: number | null;
}

export interface ProfilePoint {
  distance: number;
  altitude: number;
}

export interface SectionSummary {
  durationSec: number;
  distanceM: number;
  gainM: number;
  avgPower: number | null;
  avgGradePct: number | null;
}

/**
 * - power: il rullo riproduce i watt dell'uscita (ERG).
 * - grade: il rullo riproduce la pendenza (simulazione), i watt li decide chi pedala.
 * - ghost: si corre contro il fantasma; il rullo segue il terreno se c'è.
 */
export type ReplayMode = 'power' | 'grade' | 'ghost';

export type TrainerCommand =
  | { kind: 'erg'; watts: number }
  | { kind: 'sim'; grade: number }
  | { kind: 'none' };

// ---------------------------------------------------------------------------
// Normalizzazione: ordinati, senza doppioni, distanza monotona.

interface Prepared {
  samples: RideSample[];
  t: Float64Array;
  d: Float64Array;
  power: boolean;
  altitude: boolean;
}

/** Cache per identità dell'array: i campioni vanno trattati come immutabili. */
const cache = new WeakMap<readonly RideSample[], Prepared>();

function prepare(samples: readonly RideSample[]): Prepared {
  const hit = cache.get(samples);
  if (hit) return hit;
  const clean = normalizeSamples(samples);
  const prepared: Prepared = {
    samples: clean,
    t: Float64Array.from(clean, (s) => s.t),
    d: Float64Array.from(clean, (s) => s.distance),
    power: hasPower(clean),
    altitude: hasAltitude(clean),
  };
  cache.set(samples, prepared);
  return prepared;
}

/**
 * Copia ordinata per tempo, un campione per istante (vince il primo), con distanza
 * cumulata sempre crescente. Se il file non ha distanza la ricava dal GPS
 * (haversine, salti scartati) o, in mancanza, da velocità × tempo.
 */
export function normalizeSamples(samples: readonly RideSample[]): RideSample[] {
  const sorted = samples
    .filter((s) => s && Number.isFinite(s.t))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.t - b.s.t || a.i - b.i)
    .map(({ s }) => s);
  const out: RideSample[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(s.t - prev.t) < 1e-6) {
      // Doppione: tengo il primo, ma recupero la posizione se mancava.
      if (!validPosition(prev.lat, prev.lon) && validPosition(s.lat, s.lon)) {
        prev.lat = s.lat;
        prev.lon = s.lon;
      }
      continue;
    }
    out.push({ ...s });
  }
  if (out.length === 0) return out;

  const fileDist = out.map((s) => (Number.isFinite(s.distance) ? s.distance : 0));
  const fileSpan = fileDist.reduce((m, d) => Math.max(m, d), fileDist[0]) - fileDist[0];
  let dist: number[];
  if (fileSpan > 1) {
    dist = fileDist;
  } else if (out.filter((s) => validPosition(s.lat, s.lon)).length >= 2) {
    dist = gpsDistance(out);
  } else {
    dist = speedDistance(out);
  }
  let running = dist[0];
  for (let i = 0; i < out.length; i++) {
    running = Math.max(running, dist[i]);
    out[i].distance = running;
  }
  return out;
}

function gpsDistance(samples: RideSample[]): number[] {
  const out: number[] = [];
  let total = 0;
  let anchor: RideSample | null = null;
  for (const s of samples) {
    if (validPosition(s.lat, s.lon)) {
      if (anchor) {
        const step = haversine(anchor.lat!, anchor.lon!, s.lat!, s.lon!);
        const dt = Math.max(1, s.t - anchor.t);
        if (step / dt <= SPIKE_SPEED_MS) {
          total += step;
          anchor = s;
        }
      } else {
        anchor = s;
      }
    }
    out.push(total);
  }
  return out;
}

function speedDistance(samples: RideSample[]): number[] {
  const out: number[] = [0];
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    // Nei buchi lunghi il ciclista era fermo: non si inventano metri.
    if (dt > 0 && dt <= PAUSE_GAP_SEC) {
      const v = (Math.max(0, samples[i].speed || 0) + Math.max(0, samples[i - 1].speed || 0)) / 2;
      total += v * dt;
    }
    out.push(total);
  }
  return out;
}

/** Indice i con t[i] <= x < t[i+1], limitato a [0, n-2]. */
function locate(arr: Float64Array, x: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Valore interpolato al tempo grezzo x. Nelle soste vale `hold` (fermo) o zero. */
function interpAt(p: Prepared, x: number, value: (s: RideSample) => number, inPause: 'hold' | 'zero'): number {
  const n = p.samples.length;
  if (n === 0) return 0;
  if (n === 1 || x <= p.t[0]) return value(p.samples[0]);
  if (x >= p.t[n - 1]) return value(p.samples[n - 1]);
  const i = locate(p.t, x);
  const a = p.samples[i];
  const b = p.samples[i + 1];
  const dt = b.t - a.t;
  if (dt > PAUSE_GAP_SEC) return inPause === 'hold' ? value(a) : 0;
  const u = (x - a.t) / dt;
  return value(a) + (value(b) - value(a)) * u;
}

/** Campione completo interpolato al tempo grezzo x (per i bordi dei tratti). */
function sampleAt(p: Prepared, x: number): RideSample {
  const n = p.samples.length;
  if (n === 1 || x <= p.t[0]) return { ...p.samples[0], t: x };
  if (x >= p.t[n - 1]) return { ...p.samples[n - 1], t: x };
  const i = locate(p.t, x);
  const a = p.samples[i];
  const b = p.samples[i + 1];
  const dt = b.t - a.t;
  if (dt > PAUSE_GAP_SEC) {
    return { ...a, t: x, power: 0, cadence: 0, speed: 0 };
  }
  const u = (x - a.t) / dt;
  const lerp = (va: number, vb: number) => va + (vb - va) * u;
  const out: RideSample = {
    t: x,
    power: lerp(a.power, b.power),
    hr: lerp(a.hr, b.hr),
    cadence: lerp(a.cadence, b.cadence),
    speed: lerp(a.speed, b.speed),
    distance: lerp(a.distance, b.distance),
    altitude: lerp(a.altitude, b.altitude),
    grade: lerp(a.grade, b.grade),
  };
  if (validPosition(a.lat, a.lon) && validPosition(b.lat, b.lon)) {
    out.lat = lerp(a.lat!, b.lat!);
    out.lon = lerp(a.lon!, b.lon!);
  } else if (validPosition(a.lat, a.lon)) {
    out.lat = a.lat;
    out.lon = a.lon;
  }
  return out;
}

/** Primo istante grezzo in cui la distanza cumulata raggiunge x. Null oltre la fine. */
function timeAtRawDistance(p: Prepared, x: number): number | null {
  const n = p.samples.length;
  if (n === 0) return null;
  if (x <= p.d[0]) return p.t[0];
  if (x > p.d[n - 1] + 1e-6) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p.d[mid] >= x) hi = mid;
    else lo = mid + 1;
  }
  const i = lo;
  if (i === 0) return p.t[0];
  const ta = p.t[i - 1];
  const tb = p.t[i];
  const da = p.d[i - 1];
  const db = p.d[i];
  // Metri comparsi durante una sosta: il fantasma li ha "fatti" alla ripartenza.
  if (tb - ta > PAUSE_GAP_SEC || db <= da) return tb;
  return ta + ((x - da) / (db - da)) * (tb - ta);
}

const powerOf = (s: RideSample) => s.power;
const distanceOf = (s: RideSample) => s.distance;

// ---------------------------------------------------------------------------
// Ritaglio.

/**
 * Campioni del tratto richiesto, ribasati: il primo ha t=0 e distanza 0,
 * la quota resta assoluta. I bordi sono interpolati esattamente.
 * Tempi e distanze di `spec` sono sugli assi del Ride (gli stessi dei lap):
 * secondi dall'inizio dell'attività e distanza cumulata del file.
 * Tratto vuoto o fuori dall'uscita → [].
 */
export function sliceSection(ride: Ride, spec: SectionSpec): RideSample[] {
  const p = prepare(ride.samples);
  const n = p.samples.length;
  if (n === 0) return [];
  const t0 = p.t[0];
  const tN = p.t[n - 1];
  let from: number;
  let to: number;
  switch (spec.kind) {
    case 'full':
      from = t0;
      to = tN;
      break;
    case 'time':
      from = Math.min(spec.fromSec, spec.toSec);
      to = Math.max(spec.fromSec, spec.toSec);
      break;
    case 'distance': {
      const lo = Math.min(spec.fromM, spec.toM);
      const hi = Math.max(spec.fromM, spec.toM);
      const a = timeAtRawDistance(p, lo);
      if (a == null) return [];
      from = a;
      to = timeAtRawDistance(p, hi) ?? tN;
      break;
    }
    case 'lap': {
      const lap = ride.laps?.[spec.index];
      if (!lap || !Number.isFinite(lap.startSec) || !Number.isFinite(lap.endSec)) return [];
      from = Math.min(lap.startSec, lap.endSec);
      to = Math.max(lap.startSec, lap.endSec);
      break;
    }
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  from = Math.max(from, t0);
  to = Math.min(to, tN);
  if (to < from || (to === from && n > 1 && spec.kind !== 'full')) return [];

  const first = sampleAt(p, from);
  const raw: RideSample[] = [first];
  for (const s of p.samples) {
    if (s.t > from && s.t < to) raw.push(s);
  }
  if (to > from) raw.push(sampleAt(p, to));
  const d0 = first.distance;
  return raw.map((s) => ({ ...s, t: s.t - from, distance: Math.max(0, s.distance - d0) }));
}

/** Completa le distanze dei lap che non le hanno, leggendole dai campioni. */
export function fillLapDistances(laps: RideLap[], samples: readonly RideSample[]): RideLap[] {
  const p = prepare(samples);
  const n = p.samples.length;
  if (n < 2 || p.d[n - 1] - p.d[0] < 1) return laps;
  return laps.map((lap) => ({
    ...lap,
    distanceStartM: lap.distanceStartM ?? interpAt(p, lap.startSec, distanceOf, 'hold'),
    distanceEndM: lap.distanceEndM ?? interpAt(p, lap.endSec, distanceOf, 'hold'),
  }));
}

// ---------------------------------------------------------------------------
// Cosa c'è nella traccia.

/** Potenza vera: almeno il 5% dei campioni sopra zero. */
export function hasPower(samples: readonly RideSample[]): boolean {
  if (samples.length === 0) return false;
  let n = 0;
  for (const s of samples) if (s.power > 0) n++;
  return n > 0 && n >= samples.length * 0.05;
}

/** GPS vero: almeno l'80% dei campioni con coordinate valide. */
export function hasGps(samples: readonly RideSample[]): boolean {
  if (samples.length === 0) return false;
  let n = 0;
  for (const s of samples) if (validPosition(s.lat, s.lon)) n++;
  return n >= samples.length * 0.8;
}

/**
 * Altimetria vera: quote finite che si muovono di almeno mezzo metro.
 * Una traccia tutta a 0 (quota assente nel file) non conta.
 */
export function hasAltitude(samples: readonly RideSample[]): boolean {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const s of samples) {
    if (!Number.isFinite(s.altitude)) continue;
    lo = Math.min(lo, s.altitude);
    hi = Math.max(hi, s.altitude);
  }
  return Number.isFinite(lo) && hi - lo >= MIN_ALTITUDE_RANGE_M;
}

// ---------------------------------------------------------------------------
// Potenza e fantasma.

/**
 * Potenza al secondo t dall'inizio, media centrata su `smoothSec` secondi
 * (trapezi ogni 0,25 s). Null senza potenza o fuori dall'uscita.
 */
export function powerAtTime(samples: readonly RideSample[], t: number, smoothSec = 3): number | null {
  const p = prepare(samples);
  const n = p.samples.length;
  if (!p.power || n === 0 || !Number.isFinite(t) || t < 0) return null;
  const t0 = p.t[0];
  const tN = p.t[n - 1];
  const x = t0 + t;
  if (x > tN + 1e-9) return null;
  if (!(smoothSec > 0)) return interpAt(p, x, powerOf, 'zero');
  const lo = Math.max(t0, x - smoothSec / 2);
  const hi = Math.min(tN, x + smoothSec / 2);
  return averageOver(lo, hi, 0.25, (u) => interpAt(p, u, powerOf, 'zero'));
}

/**
 * Potenza al metro d dall'inizio, media pesata sulla distanza su `smoothM` metri:
 * i secondi da fermo non pesano. Null senza potenza o oltre la fine.
 */
export function powerAtDistance(samples: readonly RideSample[], d: number, smoothM = 30): number | null {
  const p = prepare(samples);
  const n = p.samples.length;
  if (!p.power || n === 0 || !Number.isFinite(d) || d < 0) return null;
  const d0 = p.d[0];
  const total = p.d[n - 1] - d0;
  if (d > total + 1e-9) return null;
  const powerAtD = (u: number) => {
    const x = timeAtRawDistance(p, d0 + u);
    return x == null ? 0 : interpAt(p, x, powerOf, 'zero');
  };
  if (!(smoothM > 0)) return powerAtD(d);
  const lo = Math.max(0, d - smoothM / 2);
  const hi = Math.min(total, d + smoothM / 2);
  return averageOver(lo, hi, smoothM / 12, powerAtD);
}

function averageOver(lo: number, hi: number, step: number, f: (x: number) => number): number {
  if (!(hi - lo > 1e-9)) return f(lo);
  const k = Math.max(1, Math.ceil((hi - lo) / step));
  const h = (hi - lo) / k;
  let acc = (f(lo) + f(hi)) / 2;
  for (let i = 1; i < k; i++) acc += f(lo + i * h);
  return (acc * h) / (hi - lo);
}

/** Metri che l'uscita originale aveva percorso al secondo t. Si ferma alla fine. */
export function ghostDistanceAt(samples: readonly RideSample[], t: number): number {
  const p = prepare(samples);
  if (p.samples.length === 0 || !Number.isFinite(t)) return 0;
  return interpAt(p, p.t[0] + Math.max(0, t), distanceOf, 'hold') - p.d[0];
}

/** Secondo in cui l'uscita originale ha raggiunto il metro d. Null oltre la fine. */
export function ghostTimeAtDistance(samples: readonly RideSample[], d: number): number | null {
  const p = prepare(samples);
  if (p.samples.length === 0 || !Number.isFinite(d)) return null;
  const x = timeAtRawDistance(p, p.d[0] + Math.max(0, d));
  return x == null ? null : x - p.t[0];
}

/**
 * Distacco in secondi, misurato sulla distanza: quando il fantasma era qui
 * meno quando ci sono io. Positivo = sono davanti. Null oltre la fine del fantasma.
 */
export function gapSeconds(
  samples: readonly RideSample[],
  riderDistanceM: number,
  riderElapsedSec: number,
): number | null {
  if (!Number.isFinite(riderElapsedSec)) return null;
  const ghostT = ghostTimeAtDistance(samples, riderDistanceM);
  return ghostT == null ? null : ghostT - riderElapsedSec;
}

// ---------------------------------------------------------------------------
// Geometria per il mondo 3D.

/**
 * Punti geografici in ordine, almeno 5 m l'uno dall'altro, senza i salti GPS
 * (più di 30 m/s rispetto all'ultimo punto buono). Se tre punti di fila sembrano
 * salti, era sbagliato il riferimento: si riparte da lì. L'ultimo punto buono
 * prende il posto dell'ultimo tenuto, così la traccia finisce dove finiva.
 */
export function geoPointsFromSamples(samples: readonly RideSample[]): GeoPoint[] {
  const p = prepare(samples);
  const withEle = p.altitude;
  const out: GeoPoint[] = [];
  let anchor: RideSample | null = null;
  let kept: RideSample | null = null;
  let streak = 0;
  const point = (s: RideSample): GeoPoint => ({
    lat: s.lat!,
    lon: s.lon!,
    ele: withEle && Number.isFinite(s.altitude) ? s.altitude : null,
  });
  for (const s of p.samples) {
    if (!validPosition(s.lat, s.lon)) continue;
    if (anchor) {
      const jump = haversine(anchor.lat!, anchor.lon!, s.lat!, s.lon!);
      const dt = Math.max(1, s.t - anchor.t);
      if (jump / dt > SPIKE_SPEED_MS) {
        streak++;
        if (streak < 3) continue;
        // Il riferimento era il salto: se era l'unico punto tenuto, via anche lui.
        if (out.length === 1) {
          out.length = 0;
          kept = null;
        }
      }
    }
    streak = 0;
    anchor = s;
    if (!kept || haversine(kept.lat!, kept.lon!, s.lat!, s.lon!) >= MIN_SPACING_M) {
      out.push(point(s));
      kept = s;
    }
  }
  if (anchor && kept && anchor !== kept && out.length >= 2) {
    out[out.length - 1] = point(anchor);
  }
  return out;
}

/** Profilo distanza-quota per le uscite con altimetria ma senza GPS. Passo ≥ 5 m. */
export function profileFromSamples(samples: readonly RideSample[]): ProfilePoint[] {
  const p = prepare(samples);
  if (!p.altitude) return [];
  const d0 = p.d[0];
  const out: ProfilePoint[] = [];
  let lastD = Number.NEGATIVE_INFINITY;
  for (const s of p.samples) {
    if (!Number.isFinite(s.altitude)) continue;
    const d = s.distance - d0;
    if (d - lastD >= MIN_SPACING_M) {
      out.push({ distance: d, altitude: s.altitude });
      lastD = d;
    }
  }
  const last = p.samples[p.samples.length - 1];
  const lastDist = last.distance - d0;
  if (out.length >= 2 && lastDist > out[out.length - 1].distance) {
    out[out.length - 1] = { distance: lastDist, altitude: last.altitude };
  }
  return out;
}

/** Numeri del tratto. Potenza media pesata sul tempo, soste escluse. */
export function sectionSummary(samples: readonly RideSample[]): SectionSummary {
  const p = prepare(samples);
  const s = p.samples;
  const n = s.length;
  if (n === 0) return { durationSec: 0, distanceM: 0, gainM: 0, avgPower: null, avgGradePct: null };
  const durationSec = s[n - 1].t - s[0].t;
  const distanceM = s[n - 1].distance - s[0].distance;
  const gainM = p.altitude ? elevationGain(s.map((x) => x.altitude), 0.25) : 0;
  let avgPower: number | null = null;
  if (p.power) {
    let acc = 0;
    let time = 0;
    for (let i = 1; i < n; i++) {
      const dt = s[i].t - s[i - 1].t;
      if (dt <= 0 || dt > PAUSE_GAP_SEC) continue;
      acc += ((s[i].power + s[i - 1].power) / 2) * dt;
      time += dt;
    }
    avgPower = time > 0 ? acc / time : s.reduce((a, x) => a + x.power, 0) / n;
    avgPower = Math.round(avgPower * 10) / 10;
  }
  const avgGradePct =
    p.altitude && distanceM >= 50
      ? Math.round(((s[n - 1].altitude - s[0].altitude) / distanceM) * 1000) / 10
      : null;
  return {
    durationSec,
    distanceM,
    gainM: Math.round(gainM * 10) / 10,
    avgPower,
    avgGradePct,
  };
}

// ---------------------------------------------------------------------------
// Comando al rullo.

/**
 * Un solo comando FTMS per volta. Sul Fitness Machine Control Point l'ERG
 * (opcode 0x05, Set Target Power) e la simulazione (opcode 0x11, Indoor Bike
 * Simulation Parameters) si escludono: l'ultimo ricevuto cambia modalità al rullo.
 * Mandarli entrambi a ogni giro farebbe saltare il rullo fra watt fissi e
 * pendenza, quindi qui esce sempre esattamente un tipo.
 *
 * - power → erg con i watt dell'uscita (arrotondati, 0–2000); senza watt validi → none.
 * - grade → sim con la pendenza in frazione (0.05 = 5%), limitata a ±25%; senza pendenza → none.
 * - ghost → sim sul terreno se la pendenza c'è, altrimenti none: il rullo non
 *   impone mai watt contro il fantasma, sarebbe una gara truccata.
 */
export function trainerCommandFor(
  mode: ReplayMode,
  input: { targetPower?: number | null; grade?: number | null },
): TrainerCommand {
  const grade = input.grade;
  const sim = (): TrainerCommand =>
    typeof grade === 'number' && Number.isFinite(grade)
      ? { kind: 'sim', grade: Math.min(0.25, Math.max(-0.25, grade)) }
      : { kind: 'none' };
  switch (mode) {
    case 'power': {
      const w = input.targetPower;
      if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) return { kind: 'none' };
      return { kind: 'erg', watts: Math.min(2000, Math.round(w)) };
    }
    case 'grade':
    case 'ghost':
      return sim();
  }
}
