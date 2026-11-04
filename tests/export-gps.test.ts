import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { STANDARD_AIR } from '../src/domain/physics';
import { projector } from '../src/domain/geo';
import { createRouteTrack } from '../src/domain/track';
import { RideEngine } from '../src/sim/engine';
import { SimulatorSource } from '../src/sim/simulator';
import { encodeActivityFit, decodeFitActivity } from '../src/io/fit';
import { encodeGpx } from '../src/io/gpx-export';
import { decodeGpx } from '../src/io/gpx';

// una strada dritta verso nord da Piazza Vecchia, 2 km: la stessa proiezione del mondo
const ORIGIN = { lat: 45.7037, lon: 9.6623 };
const proj = projector(ORIGIN);

function ride(withGeo: boolean) {
  const pts = [];
  for (let d = 0; d <= 2000; d += 20) pts.push({ x: 0, z: -d, ele: 360 + d * 0.03 });
  const track = createRouteTrack(pts, { halfWidth: 3 });
  const engine = new RideEngine({
    track,
    source: new SimulatorSource(),
    physics: { massKg: 80, cda: 0.32, crr: 0.004, ...STANDARD_AIR },
    ftp: 250,
    maxHr: 186,
    restHr: 52,
    lthr: 166,
    weightKg: 72,
    withCamilla: false,
    crr: 0.004,
    cw: 0.39,
    geoAt: withGeo
      ? (d) => {
          const p = track.poseAt(d);
          return proj.toGeo(p.x, p.z);
        }
      : undefined,
  });
  engine.effort = 0.8;
  for (let i = 0; i < 20 * 90; i++) engine.tick(0.05); // 90 s
  engine.finish();
  return engine.toRide('Prova GPS');
}

describe('giro esportato con il GPS vero', () => {
  it('i campioni hanno latitudine e longitudine sulla strada', () => {
    const r = ride(true);
    const withPos = r.samples.filter((s) => s.lat != null && s.lon != null);
    expect(withPos.length).toBe(r.samples.length);
    const last = withPos[withPos.length - 1];
    // si va verso nord: la latitudine cresce, la longitudine resta quella dell'asse (± la corsia)
    expect(last.lat!).toBeGreaterThan(ORIGIN.lat);
    expect(Math.abs(last.lon! - ORIGIN.lon)).toBeLessThan(0.0002);
  });

  it('il FIT ha le posizioni e si dichiara giro virtuale', () => {
    const r = ride(true);
    const bytes = encodeActivityFit(r);
    const { messages } = new Decoder(Stream.fromByteArray(bytes)).read();
    const records = messages.recordMesgs ?? [];
    expect(records.filter((m: { positionLat?: number }) => m.positionLat != null).length).toBe(r.samples.length);
    expect(messages.sessionMesgs?.[0]?.subSport).toBe('virtualActivity');
    const back = decodeFitActivity(bytes, { ftp: 250, lthr: 166 });
    const p = back!.samples.find((s) => s.lat != null)!;
    expect(Math.abs(p.lat! - r.samples[0].lat!)).toBeLessThan(1e-5);
  });

  // Michele, 04/11: «fit to strava save also quota?» Sì: ogni punto ha la quota della strada,
  // nei campi vecchi e in quelli «enhanced» che Strava legge per primi, e la sessione il dislivello.
  it('il FIT ha la quota punto per punto e il dislivello', () => {
    const r = ride(true);
    const { messages } = new Decoder(Stream.fromByteArray(encodeActivityFit(r))).read();
    const records = (messages.recordMesgs ?? []) as { altitude?: number; enhancedAltitude?: number }[];
    expect(records.length).toBe(r.samples.length);
    const lastAlt = r.samples[r.samples.length - 1].altitude;
    expect(lastAlt).toBeGreaterThan(r.samples[0].altitude + 1);
    records.forEach((m, i) => {
      expect(Math.abs(m.enhancedAltitude! - r.samples[i].altitude)).toBeLessThan(0.3);
      expect(Math.abs(m.altitude! - r.samples[i].altitude)).toBeLessThan(0.3);
    });
    const s = messages.sessionMesgs![0] as { totalAscent?: number; totalDescent?: number; maxAltitude?: number };
    expect(s.totalAscent).toBeGreaterThan(0);
    expect(s.totalDescent).toBe(0);
    expect(Math.abs(s.maxAltitude! - lastAlt)).toBeLessThan(0.5);
  });

  it('senza GPS resta un giro indoor, senza coordinate inventate', () => {
    const r = ride(false);
    expect(r.samples.every((s) => s.lat == null)).toBe(true);
    const { messages } = new Decoder(Stream.fromByteArray(encodeActivityFit(r))).read();
    expect(messages.sessionMesgs?.[0]?.subSport).toBe('indoorCycling');
    expect(encodeGpx(r)).toBeNull();
  });

  it('il GPX si rilegge con la stessa traccia', () => {
    const r = ride(true);
    const gpx = encodeGpx(r)!;
    const back = decodeGpx(new TextEncoder().encode(gpx), { ftp: 250, lthr: 166, name: 'x' } as never);
    expect(back.length).toBe(1);
    expect(back[0].samples.filter((s) => s.lat != null).length).toBeGreaterThan(r.samples.length * 0.9);
  });
});
