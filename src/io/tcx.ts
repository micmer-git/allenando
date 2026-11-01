import type { Ride } from '@/domain/types';
import { xmlEscape } from './xml';
import { buildRide, resampleTo1Hz, type SeriesPoint } from '@/domain/metrics';
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
      const ride = trackpointsToRide(pts, textOf(course.Name) ?? ctx.name ?? 'Percorso TCX', 'cycling', ctx, undefined);
      if (ride) rides.push(ride);
    }
  }
  return rides;
}

function activityToRide(activity: Record<string, unknown>, ctx: XmlDecodeContext): Ride | null {
  const sportRaw = textOf(activity['@Sport']) ?? 'Biking';
  const sport = /run/i.test(sportRaw) ? 'running' : 'cycling';
  const laps = asArray<Record<string, unknown>>(activity.Lap as Record<string, unknown>[]);
  const points = laps.flatMap((lap) => {
    const tracks = asArray<Record<string, unknown>>(lap.Track as Record<string, unknown>[]);
    return tracks.flatMap((track) => asArray<Record<string, unknown>>(track.Trackpoint as Record<string, unknown>[]));
  });
  const lapSeconds = laps.reduce((s, lap) => s + (numberOf(lap.TotalTimeSeconds) ?? 0), 0);
  const lapDistance = laps.reduce((s, lap) => s + (numberOf(lap.DistanceMeters) ?? 0), 0);
  const name = textOf(activity.Notes) ?? textOf(activity.Id) ?? ctx.name ?? 'Attività TCX';
  return trackpointsToRide(points, cleanName(name), sport, ctx, {
    duration: lapSeconds || undefined,
    distance: lapDistance || undefined,
  });
}

function trackpointsToRide(
  points: Record<string, unknown>[],
  name: string,
  sport: string,
  ctx: XmlDecodeContext,
  totals: { duration?: number; distance?: number } | undefined,
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
  return buildRide({
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
  const points = (ride.samples.length ? ride.samples : []).map((sample) => {
    const time = new Date(start.getTime() + sample.t * 1000).toISOString();
    const hr = sample.hr > 0 ? `<HeartRateBpm><Value>${Math.round(sample.hr)}</Value></HeartRateBpm>` : '';
    const cad = sample.cadence > 0 ? `<Cadence>${Math.round(sample.cadence)}</Cadence>` : '';
    return `<Trackpoint><Time>${time}</Time><DistanceMeters>${sample.distance.toFixed(2)}</DistanceMeters><AltitudeMeters>${sample.altitude.toFixed(2)}</AltitudeMeters>${hr}${cad}<Extensions><ns3:TPX><ns3:Watts>${Math.round(sample.power)}</ns3:Watts><ns3:Speed>${Math.max(0, sample.speed).toFixed(3)}</ns3:Speed></ns3:TPX></Extensions></Trackpoint>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2" xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Activities>
    <Activity Sport="Biking">
      <Id>${start.toISOString()}</Id>
      <Lap StartTime="${start.toISOString()}">
        <TotalTimeSeconds>${ride.durationSec.toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${ride.distanceM.toFixed(2)}</DistanceMeters>
        <Calories>${Math.round(ride.kcal ?? 0)}</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>${points.join('')}</Track>
      </Lap>
      <Notes>${xmlEscape(ride.name)}</Notes>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

function cleanName(name: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(name)) return 'Attività TCX';
  return name;
}
