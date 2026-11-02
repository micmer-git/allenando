import { describe, expect, it } from 'vitest';
import type { Ride, RideSample } from '../src/domain/types';
import { haversine } from '../src/domain/metrics';
import {
  gapSeconds,
  geoPointsFromSamples,
  ghostDistanceAt,
  ghostTimeAtDistance,
  hasAltitude,
  hasGps,
  hasPower,
  powerAtDistance,
  powerAtTime,
  profileFromSamples,
  sectionSummary,
  sliceSection,
  trainerCommandFor,
} from '../src/domain/replay';

// Tutti i percorsi qui sono DEMO: rette sintetiche, nessuna salita vera.
const DEMO_LAT = 45.2;
const DEMO_LON = 9.3;
const M_PER_DEG_LAT = 111_320;

/** DEMO: 600 s a 8 m/s, 150 W per 300 s poi 250 W, salita costante del 5%. */
function demoSamples(n = 601, opts: { gps?: boolean; power?: boolean } = {}): RideSample[] {
  const gps = opts.gps ?? true;
  const power = opts.power ?? true;
  return Array.from({ length: n }, (_, i) => {
    const s: RideSample = {
      t: i,
      power: power ? (i < 300 ? 150 : 250) : 0,
      hr: 140,
      cadence: 90,
      speed: 8,
      distance: i * 8,
      altitude: 200 + i * 8 * 0.05,
      grade: 0.05,
    };
    if (gps) {
      s.lat = DEMO_LAT + (i * 8) / M_PER_DEG_LAT;
      s.lon = DEMO_LON;
    }
    return s;
  });
}

function demoRide(samples: RideSample[] = demoSamples(), partial: Partial<Ride> = {}): Ride {
  return {
    id: 'demo',
    name: 'DEMO replay',
    sport: 'cycling',
    source: 'import',
    startTime: '2026-10-01T07:00:00.000Z',
    durationSec: samples.length ? samples[samples.length - 1].t : 0,
    distanceM: samples.length ? samples[samples.length - 1].distance : 0,
    elevationGainM: 0,
    tssSource: 'none',
    powerZoneSec: [0, 0, 0, 0, 0, 0, 0],
    hrZoneSec: [0, 0, 0, 0, 0, 0, 0],
    withCamilla: false,
    ftp: 250,
    samples,
    laps: [
      { startSec: 0, endSec: 300, name: 'DEMO giro 1' },
      { startSec: 300, endSec: 600, name: 'DEMO giro 2' },
    ],
    ...partial,
  };
}

describe('sliceSection', () => {
  it('full: tutto, ribasato a t=0 e distanza 0, quota assoluta', () => {
    const out = sliceSection(demoRide(), { kind: 'full' });
    expect(out).toHaveLength(601);
    expect(out[0].t).toBe(0);
    expect(out[0].distance).toBe(0);
    expect(out[0].altitude).toBe(200);
    expect(out[600].distance).toBe(4800);
  });

  it('time: bordi esatti e ribasati', () => {
    const out = sliceSection(demoRide(), { kind: 'time', fromSec: 100.5, toSec: 200 });
    expect(out[0].t).toBe(0);
    expect(out[0].distance).toBe(0);
    expect(out[0].altitude).toBeCloseTo(200 + 100.5 * 8 * 0.05, 6);
    expect(out[out.length - 1].t).toBeCloseTo(99.5, 9);
    expect(out[out.length - 1].distance).toBeCloseTo(796, 6);
    expect(out[0].lat).toBeCloseTo(DEMO_LAT + 804 / M_PER_DEG_LAT, 9);
  });

  it('distance: dal metro 800 al 1600 sono 100 s', () => {
    const out = sliceSection(demoRide(), { kind: 'distance', fromM: 800, toM: 1600 });
    expect(out[out.length - 1].t).toBeCloseTo(100, 6);
    expect(out[out.length - 1].distance).toBeCloseTo(800, 6);
  });

  it('lap: usa i confini del giro; indice inesistente → []', () => {
    const out = sliceSection(demoRide(), { kind: 'lap', index: 1 });
    expect(out[0].power).toBe(250);
    expect(out[out.length - 1].t).toBe(300);
    expect(sliceSection(demoRide(), { kind: 'lap', index: 5 })).toEqual([]);
    expect(sliceSection(demoRide(demoSamples(), { laps: undefined }), { kind: 'lap', index: 0 })).toEqual([]);
  });

  it('fuori dall’uscita o uscita vuota → []', () => {
    expect(sliceSection(demoRide(), { kind: 'time', fromSec: 900, toSec: 1000 })).toEqual([]);
    expect(sliceSection(demoRide(), { kind: 'distance', fromM: 9000, toM: 9500 })).toEqual([]);
    expect(sliceSection(demoRide([]), { kind: 'full' })).toEqual([]);
  });

  it('campioni disordinati e doppioni danno lo stesso risultato', () => {
    const clean = demoSamples(121);
    const messy = [...clean].reverse();
    messy.push({ ...clean[50] }, { ...clean[51], power: 999 });
    const a = sliceSection(demoRide(clean), { kind: 'time', fromSec: 10, toSec: 90 });
    const b = sliceSection(demoRide(messy), { kind: 'time', fromSec: 10, toSec: 90 });
    expect(b).toHaveLength(a.length);
    expect(b.map((s) => s.t)).toEqual(a.map((s) => s.t));
    expect(b.map((s) => s.distance)).toEqual(a.map((s) => s.distance));
  });

  it('senza distanza nel file la ricava da velocità × tempo', () => {
    const samples = demoSamples(101, { gps: false }).map((s) => ({ ...s, distance: 0 }));
    const out = sliceSection(demoRide(samples), { kind: 'full' });
    expect(out[100].distance).toBeCloseTo(800, 6);
  });

  it('senza distanza ma con GPS la ricava con haversine', () => {
    const samples = demoSamples(101).map((s) => ({ ...s, distance: 0, speed: 0 }));
    const out = sliceSection(demoRide(samples), { kind: 'full' });
    expect(out[100].distance).toBeGreaterThan(795);
    expect(out[100].distance).toBeLessThan(805);
  });
});

describe('soste', () => {
  /** DEMO: 100 s in movimento, sosta di 300 s senza campioni, altri 100 s. */
  function withPause(): RideSample[] {
    const a = demoSamples(101);
    const b = demoSamples(101).map((s) => ({ ...s, t: s.t + 400, distance: s.distance + 800 }));
    return [...a, ...b.slice(1)];
  }

  it('il fantasma resta fermo durante la sosta e il tempo resta quello del file', () => {
    const samples = withPause();
    expect(ghostDistanceAt(samples, 150)).toBeCloseTo(800, 6);
    expect(ghostDistanceAt(samples, 399)).toBeCloseTo(800, 6);
    expect(ghostDistanceAt(samples, 450)).toBeCloseTo(800 + 50 * 8, 6);
    expect(ghostTimeAtDistance(samples, 1200)).toBeCloseTo(450, 6);
    expect(powerAtTime(samples, 250, 0)).toBe(0);
    expect(sectionSummary(samples).durationSec).toBe(500);
  });
});

describe('cosa c’è nella traccia', () => {
  it('hasPower, hasGps, hasAltitude', () => {
    expect(hasPower(demoSamples())).toBe(true);
    expect(hasPower(demoSamples(601, { power: false }))).toBe(false);
    expect(hasGps(demoSamples())).toBe(true);
    expect(hasGps(demoSamples(601, { gps: false }))).toBe(false);
    const halfGps = demoSamples(100).map((s, i) => (i % 2 ? { ...s, lat: undefined, lon: undefined } : s));
    expect(hasGps(halfGps)).toBe(false);
    expect(hasAltitude(demoSamples())).toBe(true);
    expect(hasAltitude(demoSamples().map((s) => ({ ...s, altitude: 0 })))).toBe(false);
    expect(hasPower([])).toBe(false);
  });
});

describe('potenza', () => {
  it('powerAtTime interpola, liscia il gradino e torna null fuori', () => {
    const s = demoSamples();
    expect(powerAtTime(s, 100)).toBeCloseTo(150, 6);
    expect(powerAtTime(s, 450)).toBeCloseTo(250, 6);
    const step = powerAtTime(s, 299.5, 3)!;
    expect(step).toBeGreaterThan(160);
    expect(step).toBeLessThan(240);
    expect(powerAtTime(s, 700)).toBeNull();
    expect(powerAtTime(s, -1)).toBeNull();
    expect(powerAtTime(demoSamples(601, { power: false }), 10)).toBeNull();
  });

  it('powerAtDistance interpola sulla distanza e torna null oltre la fine', () => {
    const s = demoSamples();
    expect(powerAtDistance(s, 800)).toBeCloseTo(150, 6);
    expect(powerAtDistance(s, 4000)).toBeCloseTo(250, 6);
    expect(powerAtDistance(s, 4801)).toBeNull();
    expect(powerAtDistance(demoSamples(601, { power: false }), 100)).toBeNull();
  });
});

describe('fantasma', () => {
  it('ghostDistanceAt si ferma alla fine', () => {
    const s = demoSamples();
    expect(ghostDistanceAt(s, 0)).toBe(0);
    expect(ghostDistanceAt(s, 10.5)).toBeCloseTo(84, 6);
    expect(ghostDistanceAt(s, 9999)).toBe(4800);
    expect(ghostDistanceAt([], 10)).toBe(0);
  });

  it('ghostTimeAtDistance e null oltre la fine', () => {
    const s = demoSamples();
    expect(ghostTimeAtDistance(s, 84)).toBeCloseTo(10.5, 6);
    expect(ghostTimeAtDistance(s, 4800)).toBeCloseTo(600, 6);
    expect(ghostTimeAtDistance(s, 4801)).toBeNull();
  });

  it('gapSeconds: positivo se sono davanti', () => {
    const s = demoSamples();
    expect(gapSeconds(s, 800, 90)).toBeCloseTo(10, 6);
    expect(gapSeconds(s, 800, 110)).toBeCloseTo(-10, 6);
    expect(gapSeconds(s, 5000, 500)).toBeNull();
  });

  it('funziona anche su un tratto ritagliato', () => {
    const lap = sliceSection(demoRide(), { kind: 'lap', index: 1 });
    expect(ghostTimeAtDistance(lap, 800)).toBeCloseTo(100, 6);
    expect(powerAtTime(lap, 10)).toBeCloseTo(250, 6);
  });
});

describe('geometria', () => {
  it('geoPointsFromSamples: passo ≥ 5 m, ordine, quota, salti scartati', () => {
    const s = demoSamples(201);
    s[100] = { ...s[100], lat: s[100].lat! + 0.01 }; // salto GPS DEMO di ~1 km in 1 s
    s[120] = { ...s[120], lat: undefined, lon: undefined };
    const pts = geoPointsFromSamples(s);
    expect(pts.length).toBeGreaterThan(150);
    for (let i = 1; i < pts.length; i++) {
      const step = haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
      expect(step).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(step).toBeLessThan(30);
      expect(pts[i].lat).toBeGreaterThan(pts[i - 1].lat);
    }
    expect(pts[0].ele).toBe(200);
    expect(pts[pts.length - 1].lat).toBeCloseTo(s[200].lat!, 9);
  });

  it('geoPointsFromSamples: decima i campioni troppo fitti', () => {
    const dense = demoSamples(101).map((s) => ({ ...s, lat: DEMO_LAT + (s.t * 2) / M_PER_DEG_LAT }));
    const pts = geoPointsFromSamples(dense);
    // 200 m a passi di 2 m: si tiene un punto ogni 6 m (il primo oltre i 5).
    expect(pts.length).toBeLessThanOrEqual(41);
    expect(pts.length).toBeGreaterThanOrEqual(30);
  });

  it('geoPointsFromSamples: un primo punto sbagliato non butta via la traccia', () => {
    const s = demoSamples(50);
    s[0] = { ...s[0], lat: DEMO_LAT + 0.5 };
    const pts = geoPointsFromSamples(s);
    expect(pts.length).toBeGreaterThan(40);
    expect(pts[0].lat).toBeLessThan(DEMO_LAT + 0.01);
  });

  it('geoPointsFromSamples: senza quota ele è null, senza GPS []', () => {
    const flat = demoSamples(50).map((s) => ({ ...s, altitude: 0 }));
    expect(geoPointsFromSamples(flat)[0].ele).toBeNull();
    expect(geoPointsFromSamples(demoSamples(50, { gps: false }))).toEqual([]);
  });

  it('profileFromSamples per un’uscita con quota e senza GPS', () => {
    const prof = profileFromSamples(demoSamples(101, { gps: false }));
    expect(prof[0]).toEqual({ distance: 0, altitude: 200 });
    expect(prof[prof.length - 1].distance).toBe(800);
    expect(prof[prof.length - 1].altitude).toBeCloseTo(240, 6);
    expect(profileFromSamples(demoSamples(101).map((s) => ({ ...s, altitude: 0 })))).toEqual([]);
  });
});

describe('sectionSummary', () => {
  it('durata, distanza, dislivello, potenza media e pendenza media', () => {
    const sum = sectionSummary(demoSamples());
    expect(sum.durationSec).toBe(600);
    expect(sum.distanceM).toBe(4800);
    expect(sum.gainM).toBeCloseTo(240, 0);
    expect(sum.avgPower).toBeCloseTo(200, 0);
    expect(sum.avgGradePct).toBeCloseTo(5, 6);
    const none = sectionSummary(demoSamples(601, { power: false }).map((s) => ({ ...s, altitude: 0 })));
    expect(none.avgPower).toBeNull();
    expect(none.avgGradePct).toBeNull();
    expect(sectionSummary([]).durationSec).toBe(0);
  });
});

describe('trainerCommandFor', () => {
  it('ERG e simulazione non si mescolano mai', () => {
    expect(trainerCommandFor('power', { targetPower: 212.4, grade: 0.05 })).toEqual({ kind: 'erg', watts: 212 });
    expect(trainerCommandFor('grade', { targetPower: 212, grade: 0.05 })).toEqual({ kind: 'sim', grade: 0.05 });
    expect(trainerCommandFor('ghost', { targetPower: 212, grade: 0.03 })).toEqual({ kind: 'sim', grade: 0.03 });
    expect(trainerCommandFor('ghost', { targetPower: 212, grade: null })).toEqual({ kind: 'none' });
    expect(trainerCommandFor('power', { targetPower: null, grade: 0.05 })).toEqual({ kind: 'none' });
    expect(trainerCommandFor('grade', { grade: 0.4 })).toEqual({ kind: 'sim', grade: 0.25 });
    for (const mode of ['power', 'grade', 'ghost'] as const) {
      const cmd = trainerCommandFor(mode, { targetPower: 200, grade: 0.02 });
      expect(Object.keys(cmd).sort()).toEqual(cmd.kind === 'erg' ? ['kind', 'watts'] : cmd.kind === 'sim' ? ['grade', 'kind'] : ['kind']);
    }
  });
});
