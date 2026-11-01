import type { Ride, RideSample, TssSource } from './types';
import { hrZoneIndex, powerZoneIndex } from './zones';

/** Media aritmetica. Lista vuota → 0. */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/**
 * Potenza normalizzata di Coggan.
 * Campioni assunti a 1 Hz. Sotto i 30 s non c'è finestra mobile:
 * si usa la radice quarta della media delle potenze alla quarta.
 */
export function normalizedPower(powers: number[]): number {
  if (powers.length === 0) return 0;
  const clean = powers.map((p) => (p > 0 ? p : 0));
  const window = 30;
  if (clean.length < window) {
    let acc = 0;
    for (const p of clean) acc += p ** 4;
    return (acc / clean.length) ** 0.25;
  }
  let rolling = 0;
  for (let i = 0; i < window; i++) rolling += clean[i];
  let acc = 0;
  let n = 0;
  for (let i = window; i <= clean.length; i++) {
    const avg = rolling / window;
    acc += avg ** 4;
    n++;
    if (i < clean.length) rolling += clean[i] - clean[i - window];
  }
  return (acc / n) ** 0.25;
}

export function intensityFactor(np: number, ftp: number): number {
  if (!(ftp > 0) || !(np > 0)) return 0;
  return np / ftp;
}

/** TSS = t(s) · NP · IF / (FTP · 3600) · 100. */
export function trainingStressScore(durationSec: number, np: number, ftp: number): number {
  if (!(ftp > 0) || !(durationSec > 0) || !(np > 0)) return 0;
  const iff = np / ftp;
  return (durationSec * np * iff) / (ftp * 3600) * 100;
}

/**
 * hrTSS semplificato: (t/3600) · (FC media / LTHR)² · 100.
 * È una stima, usata solo quando manca la potenza.
 */
export function hrTrainingStress(durationSec: number, avgHr: number, lthr: number): number {
  if (!(lthr > 0) || !(durationSec > 0) || !(avgHr > 0)) return 0;
  const hrIf = avgHr / lthr;
  return (durationSec / 3600) * hrIf * hrIf * 100;
}

/** FTP stimata da un test a rampa: 75% della migliore media su 60 s. */
export function estimateFtpFromRamp(powers: number[]): number {
  if (powers.length === 0) return 0;
  const window = Math.min(60, powers.length);
  let sum = 0;
  let best = 0;
  for (let i = 0; i < powers.length; i++) {
    sum += Math.max(0, powers[i]);
    if (i >= window) sum -= Math.max(0, powers[i - window]);
    if (i >= window - 1) best = Math.max(best, sum / window);
  }
  return Math.round(best * 0.75);
}

/**
 * Dislivello positivo con isteresi: i gradini più piccoli della soglia
 * non contano da soli, ma una salita lenta si accumula lo stesso.
 */
export function elevationGain(altitudes: number[], thresholdM = 0.4): number {
  if (altitudes.length < 2) return 0;
  let gain = 0;
  let ref = altitudes[0];
  for (let i = 1; i < altitudes.length; i++) {
    const d = altitudes[i] - ref;
    if (d >= thresholdM) {
      gain += d;
      ref = altitudes[i];
    } else if (d <= -thresholdM) {
      ref = altitudes[i];
    }
  }
  return gain;
}

export function timeInPowerZones(samples: RideSample[], ftp: number, durationSec: number): number[] {
  return timeInZones(samples, durationSec, (s) => powerZoneIndex(s.power, ftp));
}

export function timeInHrZones(samples: RideSample[], lthr: number, durationSec: number): number[] {
  return timeInZones(samples, durationSec, (s) => hrZoneIndex(s.hr, lthr));
}

function timeInZones(
  samples: RideSample[],
  durationSec: number,
  zoneOf: (s: RideSample) => number,
): number[] {
  const zones = [0, 0, 0, 0, 0, 0, 0];
  if (samples.length === 0 || durationSec <= 0) return zones;
  if (samples.length === 1) {
    zones[zoneOf(samples[0]) - 1] += durationSec;
    return zones;
  }
  for (let i = 0; i < samples.length; i++) {
    const dt =
      i === 0 ? samples[1].t - samples[0].t : samples[i].t - samples[i - 1].t;
    const safe = Number.isFinite(dt) && dt > 0 ? dt : 0;
    zones[zoneOf(samples[i]) - 1] += safe;
  }
  return zones;
}

function avgOf(values: number[], predicate: (n: number) => boolean): number | undefined {
  let s = 0;
  let n = 0;
  for (const v of values) {
    if (predicate(v)) {
      s += v;
      n++;
    }
  }
  return n > 0 ? s / n : undefined;
}

function maxOf(values: number[], predicate: (n: number) => boolean): number | undefined {
  let m = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (predicate(v) && v > m) m = v;
  }
  return Number.isFinite(m) ? m : undefined;
}

export interface BuildRideInput {
  id: string;
  name: string;
  sport?: string;
  source: Ride['source'];
  fileType?: Ride['fileType'];
  startTime: Date;
  durationSec: number;
  samples: RideSample[];
  ftp: number;
  lthr: number;
  withCamilla: boolean;
  workoutId?: string;
  workoutName?: string;
  /** TSS già presente nel file, usato se la traccia di potenza non è variabile. */
  fileTss?: number;
  fileNp?: number;
  distanceM?: number;
}

export function buildRide(input: BuildRideInput): Ride {
  const samples = input.samples;
  const duration = Math.max(0, input.durationSec);
  const powers = samples.map((s) => s.power);
  const hasPower = powers.some((p) => p > 0);
  const avgPower = hasPower ? average(powers.filter((p) => p >= 0)) : undefined;
  let variable = false;
  if (hasPower && powers.length >= 20) {
    const mean = average(powers);
    let v = 0;
    for (const p of powers) v += (p - mean) ** 2;
    variable = v / powers.length > 1;
  }

  let np: number | undefined;
  let tss: number | undefined;
  let intensity: number | undefined;
  let tssSource: TssSource = 'none';

  if (hasPower && (variable || input.fileTss == null)) {
    np = normalizedPower(powers);
    intensity = intensityFactor(np, input.ftp);
    tss = trainingStressScore(duration, np, input.ftp);
    tssSource = 'power';
  } else if (input.fileTss != null && input.fileTss > 0) {
    tss = input.fileTss;
    np = input.fileNp != null && input.fileNp > 0 ? input.fileNp : undefined;
    intensity = np != null ? intensityFactor(np, input.ftp) : undefined;
    tssSource = 'file';
  } else if (hasPower && avgPower != null) {
    np = normalizedPower(powers);
    intensity = intensityFactor(np, input.ftp);
    tss = trainingStressScore(duration, np, input.ftp);
    tssSource = 'power';
  }

  const hrs = samples.map((s) => s.hr);
  const avgHr = avgOf(hrs, (h) => h > 0);
  const maxHr = maxOf(hrs, (h) => h > 0);
  if (tssSource === 'none' && avgHr != null) {
    tss = hrTrainingStress(duration, avgHr, input.lthr);
    tssSource = tss > 0 ? 'hr' : 'none';
    if (tssSource === 'none') tss = undefined;
  }

  const distanceFromSamples = samples.length ? samples[samples.length - 1].distance : 0;
  const distanceM = input.distanceM != null ? input.distanceM : distanceFromSamples;
  const altitudes = samples.map((s) => s.altitude);
  const cadence = avgOf(
    samples.map((s) => s.cadence),
    (c) => c > 0,
  );

  return {
    id: input.id,
    name: input.name,
    sport: input.sport ?? 'cycling',
    source: input.source,
    fileType: input.fileType,
    startTime: input.startTime.toISOString(),
    durationSec: duration,
    distanceM: Math.max(0, distanceM),
    elevationGainM: elevationGain(altitudes, 0.25),
    avgPower: avgPower != null ? round1(avgPower) : undefined,
    maxPower: maxOf(powers, (p) => p > 0),
    np: np != null ? round1(np) : undefined,
    intensityFactor: intensity != null && intensity > 0 ? Math.round(intensity * 1000) / 1000 : undefined,
    tss: tss != null ? Math.round(tss * 10) / 10 : undefined,
    tssSource,
    avgHr: avgHr != null ? Math.round(avgHr) : undefined,
    maxHr: maxHr != null ? Math.round(maxHr) : undefined,
    avgCadence: cadence != null ? Math.round(cadence) : undefined,
    avgSpeed: duration > 0 ? distanceM / duration : 0,
    kcal: avgPower != null && duration > 0 ? Math.round((avgPower * duration) / 1000) : undefined,
    powerZoneSec: timeInPowerZones(samples, input.ftp, duration),
    hrZoneSec: timeInHrZones(samples, input.lthr, duration),
    withCamilla: input.withCamilla,
    workoutId: input.workoutId,
    workoutName: input.workoutName,
    ftp: input.ftp,
    samples,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface SeriesPoint {
  t: number;
  power?: number;
  hr?: number;
  cadence?: number;
  speed?: number;
  distance?: number;
  altitude?: number;
  grade?: number;
  lat?: number;
  lon?: number;
}

/** Ricampiona una traccia irregolare a 1 Hz con interpolazione lineare. */
export function resampleTo1Hz(points: SeriesPoint[], maxSeconds = 6 * 3600): RideSample[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const t0 = sorted[0].t;
  const t1 = sorted[sorted.length - 1].t;
  if (!(t1 > t0)) {
    return [toSample(sorted[0], 0)];
  }
  const span = Math.min(maxSeconds, t1 - t0);
  const out: RideSample[] = [];
  let j = 0;
  const steps = Math.ceil(span);
  for (let s = 0; s <= steps; s++) {
    const t = t0 + Math.min(s, span);
    while (j < sorted.length - 2 && sorted[j + 1].t < t) j++;
    const a = sorted[j];
    const b = sorted[Math.min(j + 1, sorted.length - 1)];
    const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    out.push({
      t: t - t0,
      power: lerpOpt(a.power, b.power, u) ?? 0,
      hr: lerpOpt(a.hr, b.hr, u) ?? 0,
      cadence: lerpOpt(a.cadence, b.cadence, u) ?? 0,
      speed: lerpOpt(a.speed, b.speed, u) ?? 0,
      distance: lerpOpt(a.distance, b.distance, u) ?? 0,
      altitude: lerpOpt(a.altitude, b.altitude, u) ?? 0,
      grade: lerpOpt(a.grade, b.grade, u) ?? 0,
    });
  }
  return out;
}

function toSample(p: SeriesPoint, t: number): RideSample {
  return {
    t,
    power: p.power ?? 0,
    hr: p.hr ?? 0,
    cadence: p.cadence ?? 0,
    speed: p.speed ?? 0,
    distance: p.distance ?? 0,
    altitude: p.altitude ?? 0,
    grade: p.grade ?? 0,
  };
}

function lerpOpt(a: number | undefined, b: number | undefined, u: number): number | undefined {
  if (a == null && b == null) return undefined;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * u;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Distanza haversine in metri. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
