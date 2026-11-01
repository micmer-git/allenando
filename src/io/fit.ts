import { Decoder, Encoder, Profile, Stream, type ActivityMesg, type EventMesg, type FileIdMesg, type LapMesg, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import type { Ride, RideSample } from '@/domain/types';
import { buildRide, type SeriesPoint } from '@/domain/metrics';
import { resampleTo1Hz } from '@/domain/metrics';

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
    productName: 'Camilla Ride',
  } as FileIdMesg);

  encoder.onMesg(MesgNum.EVENT, {
    timestamp: start,
    event: 'timer',
    eventType: 'start',
  } as EventMesg);

  const samples = ride.samples.length > 0 ? ride.samples : [synthetic(ride)];
  for (const sample of samples) {
    const timestamp = new Date(start.getTime() + sample.t * 1000);
    encoder.onMesg(MesgNum.RECORD, {
      timestamp,
      distance: round(sample.distance, 2),
      altitude: round(sample.altitude, 1),
      speed: round(Math.max(0, sample.speed), 3),
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
  encoder.onMesg(MesgNum.LAP, { messageIndex: 0, ...lap } as LapMesg);
  encoder.onMesg(MesgNum.SESSION, {
    messageIndex: 0,
    sport: ride.sport === 'running' ? 'running' : 'cycling',
    subSport: ride.source === 'indoor' ? 'indoorCycling' : undefined,
    firstLapIndex: 0,
    numLaps: 1,
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
  };
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
  return buildRide({
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
