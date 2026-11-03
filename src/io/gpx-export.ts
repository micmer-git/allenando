import type { Ride } from '@/domain/types';
import { validPosition } from '@/domain/metrics';
import { xmlEscape } from './xml';

/**
 * GPX 1.1 con le estensioni Garmin TrackPointExtension (FC, cadenza) e la potenza come le
 * scrive Strava (`<power>`). Solo i punti con una posizione: un GPX senza coordinate non serve.
 * Per un giro senza GPS resta il FIT o il TCX.
 */
export function encodeGpx(ride: Ride, app = 'OROBIA'): string | null {
  const start = new Date(ride.startTime).getTime();
  const pts = ride.samples.filter((s) => validPosition(s.lat, s.lon));
  if (pts.length < 2) return null;
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<gpx version="1.1" creator="${xmlEscape(app)}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">`,
  );
  lines.push(`<metadata><name>${xmlEscape(ride.name)}</name><time>${new Date(start).toISOString()}</time></metadata>`);
  lines.push(`<trk><name>${xmlEscape(ride.name)}</name><type>VirtualRide</type><trkseg>`);
  for (const s of pts) {
    const ext: string[] = [];
    if (s.hr > 0) ext.push(`<gpxtpx:hr>${Math.round(s.hr)}</gpxtpx:hr>`);
    if (s.cadence > 0) ext.push(`<gpxtpx:cad>${Math.round(s.cadence)}</gpxtpx:cad>`);
    const tpx = ext.length ? `<gpxtpx:TrackPointExtension>${ext.join('')}</gpxtpx:TrackPointExtension>` : '';
    const power = s.power > 0 ? `<power>${Math.round(s.power)}</power>` : '';
    lines.push(
      `<trkpt lat="${s.lat!.toFixed(7)}" lon="${s.lon!.toFixed(7)}"><ele>${s.altitude.toFixed(1)}</ele><time>${new Date(start + s.t * 1000).toISOString()}</time>${power || tpx ? `<extensions>${power}${tpx}</extensions>` : ''}</trkpt>`,
    );
  }
  lines.push('</trkseg></trk></gpx>');
  return lines.join('\n');
}
