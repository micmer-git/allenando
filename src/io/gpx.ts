import type { Ride } from '@/domain/types';
import { buildRide, haversine, resampleTo1Hz, type SeriesPoint } from '@/domain/metrics';
import { asArray, decodeXml, findNumber, numberOf, parseXml, textOf } from './xml';

export interface XmlDecodeContext {
  ftp: number;
  lthr: number;
  name?: string;
}

export function decodeGpx(data: Uint8Array, ctx: XmlDecodeContext): Ride[] {
  const doc = parseXml(decodeXml(data)) as Record<string, unknown>;
  const gpx = (doc.gpx ?? doc) as Record<string, unknown>;
  const tracks = asArray<Record<string, unknown>>(gpx.trk as Record<string, unknown>[]);
  const rides: Ride[] = [];
  for (const trk of tracks) {
    const points = asArray<Record<string, unknown>>(trk.trkseg as Record<string, unknown>[]).flatMap((seg) =>
      asArray<Record<string, unknown>>(seg.trkpt as Record<string, unknown>[]),
    );
    const ride = pointsToRide(points, textOf(trk.name) ?? ctx.name ?? 'Traccia GPX', ctx);
    if (ride) rides.push(ride);
  }
  if (rides.length === 0) {
    const routes = asArray<Record<string, unknown>>(gpx.rte as Record<string, unknown>[]);
    for (const rte of routes) {
      const points = asArray<Record<string, unknown>>(rte.rtept as Record<string, unknown>[]);
      const ride = pointsToRide(points, textOf(rte.name) ?? ctx.name ?? 'Percorso GPX', ctx);
      if (ride) rides.push(ride);
    }
  }
  return rides;
}

function pointsToRide(points: Record<string, unknown>[], name: string, ctx: XmlDecodeContext): Ride | null {
  if (points.length === 0) return null;
  const raw: SeriesPoint[] = [];
  for (const pt of points) {
    const extensions = pt.extensions;
    raw.push({
      t: parseTime(textOf(pt.time)) ?? Number.NaN,
      lat: numberOf(pt['@lat']),
      lon: numberOf(pt['@lon']),
      altitude: numberOf(pt.ele),
      power: findNumber(extensions, ['power', 'Power', 'Watts', 'watts']),
      hr: findNumber(extensions, ['hr', 'HeartRate', 'heartrate']),
      cadence: findNumber(extensions, ['cad', 'cadence', 'Cadence']),
    });
  }
  const firstTimed = raw.find((p) => Number.isFinite(p.t));
  const anchor = firstTimed?.t ?? 0;
  let travelled = 0;
  let prevLat: number | undefined;
  let prevLon: number | undefined;
  let prevT = 0;
  const shifted: SeriesPoint[] = raw.map((p, index) => {
    const t = Number.isFinite(p.t) ? p.t - anchor : prevT + 1;
    if (p.lat != null && p.lon != null && prevLat != null && prevLon != null) {
      travelled += haversine(prevLat, prevLon, p.lat, p.lon);
    }
    if (p.lat != null) prevLat = p.lat;
    if (p.lon != null) prevLon = p.lon;
    const dt = index === 0 ? 0 : t - prevT;
    const speed = dt > 0 ? (travelled - (index === 0 ? 0 : travelled)) / dt : undefined;
    prevT = t;
    return { ...p, t, distance: travelled, speed };
  });
  // La velocità qui sopra è sbagliata perché travelled è già aggiornato.
  // La ricalcolo in un secondo passaggio, più chiaro.
  for (let i = 0; i < shifted.length; i++) {
    if (i === 0) {
      shifted[i].speed = shifted.length > 1 ? undefined : 0;
      continue;
    }
    const dt = shifted[i].t - shifted[i - 1].t;
    const dd = (shifted[i].distance ?? 0) - (shifted[i - 1].distance ?? 0);
    shifted[i].speed = dt > 0 ? dd / dt : 0;
  }
  if (shifted.length > 1) shifted[0].speed = shifted[1].speed;

  const samples = resampleTo1Hz(shifted);
  const duration = samples.length > 1 ? samples[samples.length - 1].t : Math.max(1, shifted.length - 1);
  const start = new Date(anchor * 1000);
  return buildRide({
    id: '',
    name,
    sport: 'cycling',
    source: 'import',
    fileType: 'gpx',
    startTime: Number.isNaN(start.getTime()) || anchor < 1_000_000_000 ? new Date() : start,
    durationSec: Math.max(duration, 1),
    samples,
    ftp: ctx.ftp,
    lthr: ctx.lthr,
    withCamilla: false,
    distanceM: travelled,
  });
}

function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}
