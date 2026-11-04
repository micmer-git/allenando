import { Decoder, Encoder, Profile, Stream, type ActivityMesg, type EventMesg, type FileIdMesg, type LapMesg, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import type { Ride, RideLap, RideSample } from '@/domain/types';
import { buildRide, validPosition, type SeriesPoint } from '@/domain/metrics';
import { resampleTo1Hz } from '@/domain/metrics';
import { fillLapDistances } from '@/domain/replay';

/** Il FIT scrive le coordinate in semicerchi: 2^31 semicerchi = 180°. */
const SEMICIRCLES_PER_DEGREE = 2 ** 31 / 180;

export function semicirclesToDegrees(value: number): number {
  return value / SEMICIRCLES_PER_DEGREE;
}

export function degreesToSemicircles(value: number): number {
  return Math.round(value * SEMICIRCLES_PER_DEGREE);
}

export interface FitDecodeContext {
  ftp: number;
  lthr: number;
  name?: string;
}

/** Codifica un giro in un file FIT Activity leggibile da Garmin Connect e Strava. */
export function encodeActivityFit(ride: Ride): Uint8Array {
  const encoder = new Encoder();
  const start = new Date(ride.startTime);
  const end = new Date(start.getTime() + ride.durationSec * 1000);
  const MesgNum = Profile.MesgNum;

  encoder.onMesg(MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    serialNumber: 1001,
    timeCreated: start,
    productName: 'OROBIA',
  } as FileIdMesg);

  encoder.onMesg(MesgNum.EVENT, {
    timestamp: start,
    event: 'timer',
    eventType: 'start',
  } as EventMesg);

  const samples = ride.samples.length > 0 ? ride.samples : [synthetic(ride)];
  // un giro indoor con la traccia del mondo è un «giro virtuale»: Strava lo mette sulla mappa
  // vera ma lo tiene fuori dai segmenti all'aperto, come fa con i giri di Zwift
  const virtual = ride.source === 'indoor' && samples.some((s) => validPosition(s.lat, s.lon));
  for (const sample of samples) {
    const timestamp = new Date(start.getTime() + sample.t * 1000);
    const gps = validPosition(sample.lat, sample.lon);
    encoder.onMesg(MesgNum.RECORD, {
      timestamp,
      positionLat: gps ? degreesToSemicircles(sample.lat!) : undefined,
      positionLong: gps ? degreesToSemicircles(sample.lon!) : undefined,
      distance: round(sample.distance, 2),
      // la quota della strada: i campi «enhanced» sono quelli che scrivono i Garmin e che Strava
      // legge per primi; i vecchi restano per chi legge solo quelli
      altitude: round(sample.altitude, 1),
      enhancedAltitude: round(sample.altitude, 1),
      speed: round(Math.max(0, sample.speed), 3),
      enhancedSpeed: round(Math.max(0, sample.speed), 3),
      power: Math.max(0, Math.round(sample.power)),
      heartRate: sample.hr > 0 ? Math.round(sample.hr) : undefined,
      cadence: sample.cadence > 0 ? Math.round(sample.cadence) : undefined,
      grade: round(sample.grade * 100, 2),
    } as RecordMesg);
  }

  encoder.onMesg(MesgNum.EVENT, {
    timestamp: end,
    event: 'timer',
    eventType: 'stopAll',
  } as EventMesg);

  const lap = sessionFields(ride, start, end);
  const laps = ride.laps?.filter((l) => Number.isFinite(l.startSec) && l.endSec > l.startSec) ?? [];
  if (laps.length > 0) {
    // Un messaggio LAP per giro del file, con tempi e distanze del giro.
    laps.forEach((l, index) => {
      const lapStart = new Date(start.getTime() + l.startSec * 1000);
      const lapEnd = new Date(start.getTime() + l.endSec * 1000);
      const lapDistance =
        l.distanceStartM != null && l.distanceEndM != null ? l.distanceEndM - l.distanceStartM : undefined;
      encoder.onMesg(MesgNum.LAP, {
        messageIndex: index,
        timestamp: lapEnd,
        startTime: lapStart,
        totalElapsedTime: l.endSec - l.startSec,
        totalTimerTime: l.endSec - l.startSec,
        totalDistance: lapDistance != null ? round(Math.max(0, lapDistance), 2) : undefined,
        event: 'lap',
        eventType: 'stop',
      } as LapMesg);
    });
  } else {
    encoder.onMesg(MesgNum.LAP, { messageIndex: 0, ...lap } as LapMesg);
  }
  encoder.onMesg(MesgNum.SESSION, {
    messageIndex: 0,
    sport: ride.sport === 'running' ? 'running' : 'cycling',
    subSport: virtual ? 'virtualActivity' : ride.source === 'indoor' ? 'indoorCycling' : undefined,
    firstLapIndex: 0,
    numLaps: Math.max(1, laps.length),
    thresholdPower: ride.ftp > 0 ? Math.round(ride.ftp) : undefined,
    ...lap,
  } as SessionMesg);
  encoder.onMesg(MesgNum.ACTIVITY, {
    timestamp: end,
    totalTimerTime: ride.durationSec,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
  } as ActivityMesg);

  return encoder.close();
}

function sessionFields(ride: Ride, start: Date, end: Date) {
  return {
    timestamp: end,
    startTime: start,
    totalElapsedTime: ride.durationSec,
    totalTimerTime: ride.durationSec,
    totalDistance: round(ride.distanceM, 2),
    totalCalories: ride.kcal != null ? Math.round(ride.kcal) : undefined,
    avgSpeed: ride.avgSpeed != null ? round(ride.avgSpeed, 3) : undefined,
    avgHeartRate: ride.avgHr,
    maxHeartRate: ride.maxHr,
    avgCadence: ride.avgCadence,
    avgPower: ride.avgPower != null ? Math.round(ride.avgPower) : undefined,
    maxPower: ride.maxPower != null ? Math.round(ride.maxPower) : undefined,
    normalizedPower: ride.np != null ? Math.round(ride.np) : undefined,
    trainingStressScore: ride.tss,
    intensityFactor: ride.intensityFactor,
    totalAscent: Math.round(ride.elevationGainM),
    ...altitudeRange(ride.samples),
  };
}

/** Discesa totale e quote estreme, dai campioni: con la salita, il riassunto della quota. */
function altitudeRange(samples: RideSample[]): { totalDescent?: number; maxAltitude?: number; minAltitude?: number } {
  if (samples.length < 2) return {};
  let down = 0;
  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i].altitude;
    if (!Number.isFinite(a)) continue;
    max = Math.max(max, a);
    min = Math.min(min, a);
    if (i > 0 && Number.isFinite(samples[i - 1].altitude) && a < samples[i - 1].altitude) down += samples[i - 1].altitude - a;
  }
  if (!Number.isFinite(max)) return {};
  return { totalDescent: Math.round(down), maxAltitude: round(max, 1), minAltitude: round(min, 1) };
}

function synthetic(ride: Ride): RideSample {
  return {
    t: 0,
    power: ride.avgPower ?? 0,
    hr: ride.avgHr ?? 0,
    cadence: ride.avgCadence ?? 0,
    speed: ride.avgSpeed ?? 0,
    distance: 0,
    altitude: 0,
    grade: 0,
  };
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

interface FitRecord {
  timestamp?: Date | number;
  power?: number;
  heartRate?: number;
  cadence?: number;
  speed?: number;
  enhancedSpeed?: number;
  distance?: number;
  altitude?: number;
  enhancedAltitude?: number;
  grade?: number;
  /** Semicerchi. */
  positionLat?: number;
  positionLong?: number;
}

interface FitLap {
  startTime?: Date | number;
  timestamp?: Date | number;
  totalElapsedTime?: number;
  totalTimerTime?: number;
  totalDistance?: number;
}

interface FitSession {
  startTime?: Date | number;
  timestamp?: Date | number;
  totalTimerTime?: number;
  totalElapsedTime?: number;
  totalDistance?: number;
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;
  trainingStressScore?: number;
  intensityFactor?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  avgSpeed?: number;
  totalAscent?: number;
  totalCalories?: number;
  sport?: string | number;
  thresholdPower?: number;
}

export function decodeFitActivity(data: Uint8Array, ctx: FitDecodeContext): Ride | null {
  const stream = Stream.fromByteArray(Array.from(data));
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) return null;
  const { messages, errors } = decoder.read();
  if (errors.length && !messages.recordMesgs?.length && !messages.sessionMesgs?.length) {
    return null;
  }
  const session = (messages.sessionMesgs?.[0] ?? undefined) as FitSession | undefined;
  const records = (messages.recordMesgs ?? []) as FitRecord[];
  const fileCreated = messages.fileIdMesgs?.[0]?.timeCreated;
  const start =
    toDate(session?.startTime) ??
    toDate(records[0]?.timestamp) ??
    toDate(fileCreated instanceof Date || typeof fileCreated === 'number' ? fileCreated : undefined) ??
    new Date();

  const points: SeriesPoint[] = [];
  for (const rec of records) {
    const when = toDate(rec.timestamp);
    if (!when) continue;
    points.push({
      t: (when.getTime() - start.getTime()) / 1000,
      power: num(rec.power),
      hr: num(rec.heartRate),
      cadence: num(rec.cadence),
      speed: num(rec.enhancedSpeed ?? rec.speed),
      distance: num(rec.distance),
      altitude: num(rec.enhancedAltitude ?? rec.altitude),
      grade: rec.grade != null ? rec.grade / 100 : undefined,
      ...fitPosition(rec),
    });
  }

  let samples = resampleTo1Hz(points.filter((p) => p.t >= -1));
  const timer = session?.totalTimerTime ?? session?.totalElapsedTime;
  let duration = samples.length > 1 ? samples[samples.length - 1].t : timer ?? 0;
  if (samples.length === 0 && timer && timer > 0) {
    const n = Math.min(3600, Math.max(1, Math.round(timer)));
    const step = timer / n;
    samples = Array.from({ length: n }, (_, i) => ({
      t: i * step,
      power: session?.avgPower ?? 0,
      hr: session?.avgHeartRate ?? 0,
      cadence: session?.avgCadence ?? 0,
      speed: session?.avgSpeed ?? 0,
      distance: session?.totalDistance != null ? (session.totalDistance * i) / n : 0,
      altitude: 0,
      grade: 0,
    }));
    duration = timer;
  }
  if (timer && timer > duration) duration = timer;

  const sport = typeof session?.sport === 'string' ? session.sport : 'cycling';
  const laps = fitLaps((messages.lapMesgs ?? []) as FitLap[], start, samples);
  const ride = buildRide({
    id: '',
    name: ctx.name ?? 'Attività FIT',
    sport: sport === 'running' ? 'running' : 'cycling',
    source: 'import',
    fileType: 'fit',
    startTime: start,
    durationSec: Math.max(0, duration),
    samples,
    ftp: ctx.ftp,
    lthr: ctx.lthr,
    withCamilla: false,
    fileTss: num(session?.trainingStressScore),
    fileNp: num(session?.normalizedPower),
    distanceM: num(session?.totalDistance) ?? (samples.length ? samples[samples.length - 1].distance : 0),
  });
  if (laps.length > 0) ride.laps = laps;
  return ride;
}

/** Coordinate del record in gradi; assenti (non 0,0) se il GPS non c'era. */
function fitPosition(rec: FitRecord): { lat?: number; lon?: number } {
  const lat = num(rec.positionLat);
  const lon = num(rec.positionLong);
  if (lat == null || lon == null) return {};
  const deg = { lat: semicirclesToDegrees(lat), lon: semicirclesToDegrees(lon) };
  return validPosition(deg.lat, deg.lon) ? deg : {};
}

/**
 * Messaggi LAP → giri in secondi dall'inizio dell'attività. La fine viene dal
 * timestamp del lap o, in mancanza, da inizio + tempo trascorso. Le distanze
 * cumulate si leggono dai campioni; senza distanza nei campioni si sommano
 * le distanze dei lap.
 */
function fitLaps(raw: FitLap[], start: Date, samples: RideSample[]): RideLap[] {
  const laps: RideLap[] = [];
  let cumulative = 0;
  let allDistances = true;
  const sums: { from: number; to: number }[] = [];
  for (const lap of raw) {
    const lapStart = toDate(lap.startTime);
    if (!lapStart) continue;
    const startSec = (lapStart.getTime() - start.getTime()) / 1000;
    const stamp = toDate(lap.timestamp);
    const elapsed = num(lap.totalElapsedTime) ?? num(lap.totalTimerTime);
    const endSec =
      stamp && stamp.getTime() > lapStart.getTime()
        ? (stamp.getTime() - start.getTime()) / 1000
        : elapsed != null
          ? startSec + elapsed
          : Number.NaN;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) continue;
    const distance = num(lap.totalDistance);
    if (distance == null) allDistances = false;
    sums.push({ from: cumulative, to: cumulative + (distance ?? 0) });
    cumulative += distance ?? 0;
    laps.push({ startSec, endSec, name: `Giro ${laps.length + 1}` });
  }
  const filled = fillLapDistances(laps, samples);
  if (filled.some((l) => l.distanceStartM != null) || !allDistances) return filled;
  return filled.map((l, i) => ({ ...l, distanceStartM: sums[i].from, distanceEndM: sums[i].to }));
}

function toDate(value: Date | number | undefined): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value * 1000 + 631065600000);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
