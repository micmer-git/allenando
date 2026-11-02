import type { Ride, RideLap, RideSample } from '@/domain/types';
import { xmlEscape } from './xml';
import { buildRide, resampleTo1Hz, validPosition, type SeriesPoint } from '@/domain/metrics';
import { fillLapDistances } from '@/domain/replay';
import { asArray, decodeXml, findNumber, numberOf, parseXml, textOf } from './xml';
import type { XmlDecodeContext } from './gpx';

export function decodeTcx(data: Uint8Array, ctx: XmlDecodeContext): Ride[] {
  const doc = parseXml(decodeXml(data)) as Record<string, unknown>;
  const root = (doc.TrainingCenterDatabase ?? doc) as Record<string, unknown>;
  const activitiesNode = root.Activities as Record<string, unknown> | undefined;
  const activities = asArray<Record<string, unknown>>(
    (activitiesNode?.Activity ?? root.Activity) as Record<string, unknown>[],
  );
  const rides: Ride[] = [];
  for (const activity of activities) {
    const ride = activityToRide(activity, ctx);
    if (ride) rides.push(ride);
  }
  if (rides.length === 0) {
    const coursesNode = root.Courses as Record<string, unknown> | undefined;
    const courses = asArray<Record<string, unknown>>(coursesNode?.Course as Record<string, unknown>[]);
    for (const course of courses) {
      const track = course.Track as Record<string, unknown> | undefined;
      const pts = asArray<Record<string, unknown>>(track?.Trackpoint as Record<string, unknown>[]);
      const ride = trackpointsToRide(pts, textOf(course.Name) ?? ctx.name ?? 'Percorso TCX', 'cycling', ctx, undefined, []);
      if (ride) rides.push(ride);
    }
  }
  return rides;
}

function activityToRide(activity: Record<string, unknown>, ctx: XmlDecodeContext): Ride | null {
  const sportRaw = textOf(activity['@Sport']) ?? 'Biking';
  const sport = /run/i.test(sportRaw) ? 'running' : 'cycling';
  const laps = asArray<Record<string, unknown>>(activity.Lap as Record<string, unknown>[]);
  const lapPoints = laps.map((lap) => {
    const tracks = asArray<Record<string, unknown>>(lap.Track as Record<string, unknown>[]);
    return tracks.flatMap((track) => asArray<Record<string, unknown>>(track.Trackpoint as Record<string, unknown>[]));
  });
  const points = lapPoints.flat();
  const lapSeconds = laps.reduce((s, lap) => s + (numberOf(lap.TotalTimeSeconds) ?? 0), 0);
  const lapDistance = laps.reduce((s, lap) => s + (numberOf(lap.DistanceMeters) ?? 0), 0);
  const name = textOf(activity.Notes) ?? textOf(activity.Id) ?? ctx.name ?? 'Attività TCX';
  const bounds = laps.map((lap, i) => lapBounds(lap, lapPoints[i]));
  return trackpointsToRide(
    points,
    cleanName(name),
    sport,
    ctx,
    { duration: lapSeconds || undefined, distance: lapDistance || undefined },
    bounds,
  );
}

/** Confini di un <Lap>, in secondi epoch (NaN se il file non ha orari). */
interface LapBound {
  start: number;
  end: number;
  seconds?: number;
  distance?: number;
}

/**
 * L'inizio è StartTime (o il primo trackpoint); la fine è l'ultimo trackpoint,
 * che conta anche le pause, o inizio + TotalTimeSeconds se il lap è vuoto.
 */
function lapBounds(lap: Record<string, unknown>, points: Record<string, unknown>[]): LapBound {
  const times = points.map((pt) => Date.parse(textOf(pt.Time) ?? '') / 1000).filter(Number.isFinite);
  const seconds = numberOf(lap.TotalTimeSeconds);
  const declared = Date.parse(textOf(lap['@StartTime']) ?? '') / 1000;
  // reduce e non Math.min(...): un lap lungo ha decine di migliaia di punti.
  const first = times.reduce((m, t) => Math.min(m, t), Number.POSITIVE_INFINITY);
  const lastPoint = times.reduce((m, t) => Math.max(m, t), Number.NEGATIVE_INFINITY);
  const start = Number.isFinite(declared) ? declared : times.length ? first : Number.NaN;
  const end = Number.isFinite(lastPoint) && lastPoint > start ? lastPoint : start + (seconds ?? Number.NaN);
  return { start, end, seconds, distance: numberOf(lap.DistanceMeters) };
}

function trackpointsToRide(
  points: Record<string, unknown>[],
  name: string,
  sport: string,
  ctx: XmlDecodeContext,
  totals: { duration?: number; distance?: number } | undefined,
  bounds: LapBound[],
): Ride | null {
  if (points.length === 0 && !(totals?.duration && totals.duration > 0)) return null;
  const series: SeriesPoint[] = [];
  for (const pt of points) {
    const when = Date.parse(textOf(pt.Time) ?? '');
    const hrNode = pt.HeartRateBpm as Record<string, unknown> | number | undefined;
    const hr =
      hrNode && typeof hrNode === 'object' ? numberOf(hrNode.Value) : numberOf(hrNode);
    const extensions = pt.Extensions;
    series.push({
      t: Number.isFinite(when) ? when / 1000 : series.length,
      distance: numberOf(pt.DistanceMeters),
      altitude: numberOf(pt.AltitudeMeters),
      hr: hr ?? findNumber(extensions, ['hr', 'HeartRate']),
      cadence: numberOf(pt.Cadence) ?? findNumber(extensions, ['cad', 'Cadence', 'RunCadence']),
      power: findNumber(extensions, ['Watts', 'watts', 'Power', 'power']),
      speed: findNumber(extensions, ['Speed', 'speed']),
      ...tcxPosition(pt.Position),
    });
  }
  if (series.length === 0) {
    const n = Math.min(1800, Math.max(1, Math.round(totals?.duration ?? 1)));
    const step = (totals?.duration ?? n) / n;
    for (let i = 0; i < n; i++) {
      series.push({
        t: i * step,
        distance: totals?.distance != null ? (totals.distance * i) / n : 0,
      });
    }
  }
  const t0 = series[0].t;
  const shifted = series.map((p) => ({ ...p, t: p.t - t0 }));
  fillMissingDistance(shifted);
  const samples = resampleTo1Hz(shifted);
  const duration =
    totals?.duration && totals.duration > 0
      ? totals.duration
      : samples.length > 1
        ? samples[samples.length - 1].t
        : shifted.length;
  const startMs = Number.isFinite(series[0].t) && series[0].t > 10_000_000 ? series[0].t * 1000 : Date.now();
  const distance = totals?.distance ?? (samples.length ? samples[samples.length - 1].distance : 0);
  const hasClock = points.length > 0 && Number.isFinite(t0) && t0 > 10_000_000;
  const laps = tcxLaps(bounds, hasClock ? t0 : null, samples);
  const ride = buildRide({
    id: '',
    name,
    sport,
    source: 'import',
    fileType: 'tcx',
    startTime: new Date(startMs),
    durationSec: duration,
    samples,
    ftp: ctx.ftp,
    lthr: ctx.lthr,
    withCamilla: false,
    distanceM: distance,
  });
  if (laps.length > 0) ride.laps = laps;
  return ride;
}

function tcxPosition(node: unknown): { lat?: number; lon?: number } {
  if (!node || typeof node !== 'object') return {};
  const pos = node as Record<string, unknown>;
  const lat = numberOf(pos.LatitudeDegrees);
  const lon = numberOf(pos.LongitudeDegrees);
  return validPosition(lat, lon) ? { lat, lon } : {};
}

/**
 * Giri relativi al primo trackpoint. Senza orari nel file si mettono in fila
 * con TotalTimeSeconds. Distanze dai campioni, o sommando DistanceMeters.
 */
function tcxLaps(bounds: LapBound[], t0: number | null, samples: RideSample[]): RideLap[] {
  const laps: RideLap[] = [];
  const sums: { from?: number; to?: number }[] = [];
  let clock = 0;
  let cumulative = 0;
  for (const b of bounds) {
    let startSec: number;
    let endSec: number;
    if (t0 != null && Number.isFinite(b.start) && Number.isFinite(b.end)) {
      startSec = Math.max(0, b.start - t0);
      endSec = b.end - t0;
    } else {
      startSec = clock;
      endSec = clock + (b.seconds ?? 0);
    }
    clock = endSec;
    if (!(endSec > startSec)) continue;
    sums.push(b.distance != null ? { from: cumulative, to: cumulative + b.distance } : {});
    cumulative += b.distance ?? 0;
    laps.push({ startSec, endSec, name: `Giro ${laps.length + 1}` });
  }
  const filled = fillLapDistances(laps, samples);
  return filled.map((l, i) =>
    l.distanceStartM != null ? l : { ...l, distanceStartM: sums[i].from, distanceEndM: sums[i].to },
  );
}

function fillMissingDistance(points: SeriesPoint[]): void {
  let dist = points[0]?.distance ?? 0;
  if (points[0] && points[0].distance == null) points[0].distance = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].distance == null) {
      const dt = Math.max(0, points[i].t - points[i - 1].t);
      const speed = points[i].speed ?? points[i - 1].speed ?? 0;
      dist += speed * dt;
      points[i].distance = dist;
    } else {
      dist = points[i].distance ?? dist;
    }
    if (points[i].speed == null) {
      const dt = points[i].t - points[i - 1].t;
      const dd = (points[i].distance ?? 0) - (points[i - 1].distance ?? 0);
      if (dt > 0) points[i].speed = dd / dt;
    }
  }
}

export function encodeTcx(ride: Ride): string {
  const start = new Date(ride.startTime);
  const trackpoint = (sample: RideSample) => {
    const time = new Date(start.getTime() + sample.t * 1000).toISOString();
    const pos = validPosition(sample.lat, sample.lon)
      ? `<Position><LatitudeDegrees>${sample.lat!.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${sample.lon!.toFixed(7)}</LongitudeDegrees></Position>`
      : '';
    const hr = sample.hr > 0 ? `<HeartRateBpm><Value>${Math.round(sample.hr)}</Value></HeartRateBpm>` : '';
    const cad = sample.cadence > 0 ? `<Cadence>${Math.round(sample.cadence)}</Cadence>` : '';
    return `<Trackpoint><Time>${time}</Time>${pos}<DistanceMeters>${sample.distance.toFixed(2)}</DistanceMeters><AltitudeMeters>${sample.altitude.toFixed(2)}</AltitudeMeters>${hr}${cad}<Extensions><ns3:TPX><ns3:Watts>${Math.round(sample.power)}</ns3:Watts><ns3:Speed>${Math.max(0, sample.speed).toFixed(3)}</ns3:Speed></ns3:TPX></Extensions></Trackpoint>`;
  };
  const lapXml = (startIso: string, seconds: number, meters: number, kcal: number, points: string) => `
      <Lap StartTime="${startIso}">
        <TotalTimeSeconds>${seconds.toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${meters.toFixed(2)}</DistanceMeters>
        <Calories>${Math.round(kcal)}</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>${points}</Track>
      </Lap>`;
  const laps = ride.laps?.filter((l) => l.endSec > l.startSec) ?? [];
  let body: string;
  if (laps.length > 1) {
    // Un <Lap> per giro: ogni trackpoint va nel giro in cui cade, l'ultimo giro tiene la fine.
    body = laps
      .map((l, i) => {
        const last = i === laps.length - 1;
        const inside = ride.samples.filter((s) => s.t >= l.startSec && (last ? s.t <= l.endSec : s.t < l.endSec));
        const meters =
          l.distanceStartM != null && l.distanceEndM != null
            ? l.distanceEndM - l.distanceStartM
            : inside.length > 1
              ? inside[inside.length - 1].distance - inside[0].distance
              : 0;
        const lapStart = new Date(start.getTime() + l.startSec * 1000).toISOString();
        return lapXml(lapStart, l.endSec - l.startSec, Math.max(0, meters), 0, inside.map(trackpoint).join(''));
      })
      .join('');
  } else {
    const points = ride.samples.map(trackpoint).join('');
    body = lapXml(start.toISOString(), ride.durationSec, ride.distanceM, ride.kcal ?? 0, points);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2" xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Activities>
    <Activity Sport="Biking">
      <Id>${start.toISOString()}</Id>${body}
      <Notes>${xmlEscape(ride.name)}</Notes>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

function cleanName(name: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(name)) return 'Attività TCX';
  return name;
}
