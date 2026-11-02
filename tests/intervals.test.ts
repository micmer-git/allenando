import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Ride } from '../src/domain/types';
import { sliceSection } from '../src/domain/replay';
import { encodeActivityFit } from '../src/io/fit';
import { parseUpload } from '../src/io/import';
import {
  IntervalsError,
  fetchActivityLaps,
  fetchActivityStreams,
  fetchOriginalFile,
  listActivities,
  rideFromIntervals,
  sniffActivityFile,
} from '../src/io/intervals';

// Tutto qui è DEMO: chiave finta, atleta finto, risposte sintetiche.
const DEMO_KEY = 'DEMO-key-0000';

interface Call {
  url: string;
  headers: Record<string, string>;
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    return handler(url);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const DEMO_ACTIVITIES = [
  {
    id: 'i900001',
    name: 'DEMO giro con potenza',
    start_date_local: '2026-10-10T08:00:00',
    start_date: '2026-10-10T06:00:00Z',
    type: 'Ride',
    distance: 42000.5,
    moving_time: 5400,
    total_elevation_gain: 610,
    device_watts: true,
    icu_average_watts: 190,
    source: 'GARMIN_CONNECT',
  },
  {
    id: 'i900002',
    icu_athlete_id: 'i0',
    start_date_local: '2026-10-09T18:00:00',
    source: 'STRAVA',
    _note: 'STRAVA activities are not available via the API',
  },
  {
    id: 'i900003',
    name: 'DEMO corsa senza potenza',
    start_date_local: '2026-10-08T07:00:00',
    type: 'Run',
    distance: 10000,
    moving_time: 3000,
    source: 'UPLOAD',
  },
];

describe('Intervals.icu: elenco', () => {
  it('chiama l’endpoint giusto con Basic API_KEY e normalizza', async () => {
    const { impl, calls } = mockFetch(() => json(DEMO_ACTIVITIES));
    const list = await listActivities({ apiKey: DEMO_KEY, fetchImpl: impl }, '2026-10-01', '2026-10-31');
    expect(calls[0].url).toBe('https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-10-01&newest=2026-10-31');
    expect(calls[0].headers.Authorization).toBe(`Basic ${btoa(`API_KEY:${DEMO_KEY}`)}`);
    expect(calls[0].url).not.toContain(DEMO_KEY);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({
      id: 'i900001',
      name: 'DEMO giro con potenza',
      startTime: '2026-10-10T06:00:00.000Z',
      type: 'Ride',
      distanceM: 42000.5,
      movingTimeSec: 5400,
      elevationGainM: 610,
      hasPower: true,
      source: 'GARMIN_CONNECT',
    });
    expect(list[2].hasPower).toBe(false);
  });

  it('le schede Strava restano in elenco ma non disponibili, col motivo', async () => {
    const { impl } = mockFetch(() => json(DEMO_ACTIVITIES));
    const list = await listActivities({ apiKey: DEMO_KEY, fetchImpl: impl }, '2026-10-01', '2026-10-31');
    const strava = list[1];
    expect(strava.unavailable).toBe(true);
    expect(strava.unavailableReason).toMatch(/Strava/);
    expect(strava.unavailableReason).toMatch(/FIT/);
    expect(list[0].unavailable).toBeUndefined();
  });

  it('usa l’atleta indicato', async () => {
    const { impl, calls } = mockFetch(() => json([]));
    await listActivities({ apiKey: DEMO_KEY, athleteId: 'i42', fetchImpl: impl }, '2026-01-01', '2026-01-31');
    expect(calls[0].url).toContain('/athlete/i42/activities?');
  });
});

describe('Intervals.icu: errori', () => {
  const run = (handler: (url: string) => Response | Promise<Response>) =>
    listActivities({ apiKey: DEMO_KEY, fetchImpl: mockFetch(handler).impl }, '2026-10-01', '2026-10-31');

  it('401 e 403 → auth', async () => {
    await expect(run(() => json({ status: 401, error: 'Unauthorized' }, 401))).rejects.toMatchObject({ kind: 'auth', status: 401 });
    await expect(run(() => json({}, 403))).rejects.toMatchObject({ kind: 'auth', status: 403 });
  });

  it('404 → not-found', async () => {
    await expect(run(() => json({}, 404))).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('TypeError di fetch (rete o CORS) → network, col ripiego dell’import manuale', async () => {
    const err = await run(() => {
      throw new TypeError('Failed to fetch');
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntervalsError);
    expect((err as IntervalsError).kind).toBe('network');
    expect((err as IntervalsError).message).toMatch(/FIT, GPX o TCX/);
  });

  it('chiave vuota → auth senza chiamare la rete; la chiave non finisce mai nel messaggio', async () => {
    const { impl, calls } = mockFetch(() => json([]));
    await expect(listActivities({ apiKey: '  ', fetchImpl: impl }, '2026-10-01', '2026-10-02')).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(0);
    const err = (await run(() => json({}, 401)).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain(DEMO_KEY);
    expect(JSON.stringify(err)).not.toContain(DEMO_KEY);
  });

  it('JSON rotto → format', async () => {
    await expect(run(() => new Response('<html>', { status: 200 }))).rejects.toMatchObject({ kind: 'format' });
  });
});

describe('Intervals.icu: stream', () => {
  it('latlng con data/data2, null rispettati, URL con i tipi', async () => {
    const { impl, calls } = mockFetch(() =>
      json([
        { type: 'time', data: [0, 1, 2, 3, 20] },
        { type: 'watts', data: [100, 200, null, 220, 0] },
        { type: 'heartrate', data: [120, 121, 122, 123, 110] },
        { type: 'cadence', data: [80, 85, 86, 87, 0] },
        { type: 'altitude', data: [300, 300.5, 301, 301.5, 302] },
        { type: 'distance', data: [0, 7, 14, null, 30] },
        { type: 'velocity_smooth', data: [7, 7, 7, 7, 0] },
        { type: 'latlng', data: [45.3, 45.30006, null, 45.30018, 45.3002], data2: [9.4, 9.4, null, 9.4, 9.4] },
      ]),
    );
    const samples = await fetchActivityStreams({ apiKey: DEMO_KEY, fetchImpl: impl }, 'i900001');
    expect(calls[0].url).toBe(
      'https://intervals.icu/api/v1/activity/i900001/streams.json?types=time,watts,heartrate,cadence,altitude,latlng,distance,velocity_smooth',
    );
    expect(samples).toHaveLength(5);
    expect(samples[1]).toMatchObject({ t: 1, power: 200, hr: 121, cadence: 85, distance: 7, altitude: 300.5, lat: 45.30006, lon: 9.4 });
    expect(samples[2].power).toBe(0);
    expect(samples[2].lat).toBeUndefined();
    expect(samples[3].distance).toBe(14);
    expect(samples[4].t).toBe(20);
  });

  it('latlng a coppie [lat, lng] e senza stream time (1 Hz)', async () => {
    const { impl } = mockFetch(() =>
      json([
        { type: 'watts', data: [150, 160, 170] },
        { type: 'latlng', data: [[45.3, 9.4], [45.3001, 9.4], [0, 0]] },
      ]),
    );
    const samples = await fetchActivityStreams({ apiKey: DEMO_KEY, fetchImpl: impl }, 'i900001');
    expect(samples.map((s) => s.t)).toEqual([0, 1, 2]);
    expect(samples[1].lat).toBe(45.3001);
    expect(samples[2].lat).toBeUndefined();
  });

  it('scheda Strava al posto degli stream → unavailable', async () => {
    const { impl } = mockFetch(() => json({ id: 'i900002', source: 'STRAVA', _note: 'DEMO' }));
    await expect(fetchActivityStreams({ apiKey: DEMO_KEY, fetchImpl: impl }, 'i900002')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

describe('Intervals.icu: giri', () => {
  it('icu_intervals con start_time/end_time', async () => {
    const { impl, calls } = mockFetch(() =>
      json({
        id: 'i900001',
        icu_intervals: [
          { id: 2, type: 'RECOVERY', label: 'DEMO recupero', start_time: 300, end_time: 420, start_index: 300, end_index: 420 },
          { id: 1, type: 'WORK', label: 'DEMO 5m', start_time: 0, end_time: 300, start_index: 0, end_index: 300 },
        ],
      }),
    );
    const laps = await fetchActivityLaps({ apiKey: DEMO_KEY, fetchImpl: impl }, 'i900001');
    expect(calls[0].url).toBe('https://intervals.icu/api/v1/activity/i900001?intervals=true');
    expect(laps).toEqual([
      { startSec: 0, endSec: 300, name: 'DEMO 5m' },
      { startSec: 300, endSec: 420, name: 'DEMO recupero' },
    ]);
  });

  it('solo indici: li traduce coi campioni e aggiunge le distanze', async () => {
    const samples = Array.from({ length: 61 }, (_, i) => ({
      t: i * 2,
      power: 200,
      hr: 0,
      cadence: 0,
      speed: 5,
      distance: i * 10,
      altitude: 0,
      grade: 0,
    }));
    const { impl } = mockFetch(() => json({ id: 'i900001', icu_intervals: [{ type: 'WORK', start_index: 10, end_index: 40 }, { foo: 1 }] }));
    const laps = await fetchActivityLaps({ apiKey: DEMO_KEY, fetchImpl: impl }, 'i900001', samples);
    expect(laps).toEqual([{ startSec: 20, endSec: 80, name: 'WORK', distanceStartM: 100, distanceEndM: 400 }]);
  });

  it('scheda Strava → unavailable', async () => {
    const { impl } = mockFetch(() => json({ id: 'i900002', source: 'STRAVA', _note: 'DEMO' }));
    await expect(fetchActivityLaps({ apiKey: DEMO_KEY, fetchImpl: impl }, 'i900002')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

describe('Intervals.icu: file originale', () => {
  function demoFitRide(): Ride {
    const samples = Array.from({ length: 90 }, (_, i) => ({
      t: i,
      power: 180 + (i % 5) * 10,
      hr: 130,
      cadence: 88,
      speed: 8,
      distance: i * 8,
      altitude: 100,
      grade: 0,
    }));
    return {
      id: 'demo',
      name: 'DEMO file',
      sport: 'cycling',
      source: 'import',
      startTime: '2026-10-10T06:00:00.000Z',
      durationSec: 89,
      distanceM: 712,
      elevationGainM: 0,
      tssSource: 'power',
      powerZoneSec: [0, 0, 0, 0, 0, 0, 0],
      hrZoneSec: [0, 0, 0, 0, 0, 0, 0],
      withCamilla: false,
      ftp: 250,
      samples,
    };
  }

  it('decomprime il gzip e il FIT entra nell’import esistente', async () => {
    const fit = encodeActivityFit(demoFitRide());
    const { impl, calls } = mockFetch(() => new Response(gzipSync(fit), { status: 200 }));
    const buf = await fetchOriginalFile({ apiKey: DEMO_KEY, fetchImpl: impl }, 'i900001');
    expect(calls[0].url).toBe('https://intervals.icu/api/v1/activity/i900001/file');
    const bytes = new Uint8Array(buf);
    expect(bytes.length).toBe(fit.length);
    expect(sniffActivityFile(bytes)).toBe('fit');
    const parsed = parseUpload('DEMO.fit', bytes, { ftp: 250, lthr: 165 });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rides[0].distanceM).toBeCloseTo(712, 0);
  });

  it('un file non compresso passa così com’è', async () => {
    const fit = encodeActivityFit(demoFitRide());
    const { impl } = mockFetch(() => new Response(new Uint8Array(fit), { status: 200 }));
    const buf = await fetchOriginalFile({ apiKey: DEMO_KEY, fetchImpl: impl }, 'i900001');
    expect(new Uint8Array(buf)).toEqual(fit);
  });

  it('sniffActivityFile riconosce TCX e GPX', () => {
    expect(sniffActivityFile(new TextEncoder().encode('<?xml version="1.0"?><TrainingCenterDatabase>'))).toBe('tcx');
    expect(sniffActivityFile(new TextEncoder().encode('<?xml version="1.0"?><gpx version="1.1">'))).toBe('gpx');
    expect(sniffActivityFile(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('Intervals.icu: Ride', () => {
  it('rideFromIntervals costruisce un Ride importato con externalId e giri', async () => {
    const { impl } = mockFetch(() => json(DEMO_ACTIVITIES));
    const [meta] = await listActivities({ apiKey: DEMO_KEY, fetchImpl: impl }, '2026-10-01', '2026-10-31');
    const samples = Array.from({ length: 121 }, (_, i) => ({
      t: i,
      power: i < 60 ? 150 : 250,
      hr: 140,
      cadence: 90,
      speed: 8,
      distance: i * 8,
      altitude: 100,
      grade: 0,
      lat: 45.3 + (i * 8) / 111_320,
      lon: 9.4,
    }));
    const ride = rideFromIntervals(meta, samples, [{ startSec: 60, endSec: 120, name: 'DEMO' }], 250, 165);
    expect(ride.source).toBe('import');
    expect(ride.externalId).toBe('intervals:i900001');
    expect(ride.id).toBe('icu-i900001');
    expect(ride.name).toBe('DEMO giro con potenza');
    expect(ride.startTime).toBe('2026-10-10T06:00:00.000Z');
    expect(ride.durationSec).toBe(120);
    expect(ride.distanceM).toBe(42000.5);
    expect(ride.tssSource).toBe('power');
    expect(ride.laps).toHaveLength(1);
    const lap = sliceSection(ride, { kind: 'lap', index: 0 });
    expect(lap[0].power).toBe(250);
    expect(lap[lap.length - 1].distance).toBeCloseTo(480, 6);
  });
});
