import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { projector } from '../src/domain/geo';
import { STANDARD_AIR } from '../src/domain/physics';
import { esportabile } from '../src/domain/types';
import { commitProgress, NOTHING_COMMITTED, type CommitDeps } from '../src/game/commit';
import { EMPTY_CAREER, normalize } from '../src/game/career';
import { RideGame } from '../src/game/rideGame';
import { WorldGraph, type WorldGraphFile } from '../src/open/graph';
import { EMPTY_PROGRESS } from '../src/open/progress';
import { WorldSession } from '../src/open/session';
import { decodeFeatures, type RideDef, type WorldData } from '../src/open/world';
import { RideEngine } from '../src/sim/engine';
import { rideFromCheckpoint } from '../src/sim/recovery';
import type { TelemetrySource, TrainerSnapshot } from '../src/sim/source';

const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as Parameters<typeof decodeFeatures>[0]);
const proj = projector(graph.origin);
const world: WorldData = { graph, rides, features, proj, toGeo: (x, z) => proj.toGeo(x, z) };

class Sim implements TelemetrySource {
  readonly mode = 'simulator' as const;
  power = 300;
  hr = 150;
  cadence = 90;
  snapshot(): TrainerSnapshot {
    return { mode: 'simulator', deviceName: null, services: { ftms: false, power: false, hr: false, csc: false }, control: 'none', simulation: 'none', status: 'idle', busy: false };
  }
  subscribe(): () => void {
    return () => undefined;
  }
  update(): void {}
  useSimulator(): Promise<void> {
    return Promise.resolve();
  }
  connectBluetooth(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): void {}
}

/** La Città Alta pedalata tutta, fino al traguardo. */
function giroFatto(prova: boolean, at = 0) {
  const session = new WorldSession(world, { ride: rides.find((r) => r.id === 'citta-alta')! }, 0);
  const engine = new RideEngine({
    track: session.path,
    source: new Sim(),
    physics: { massKg: 80, cda: 0.3, crr: 0.004, ...STANDARD_AIR },
    ftp: 280,
    maxHr: 186,
    restHr: 52,
    lthr: 166,
    weightKg: 72,
    withCamilla: false,
    crr: 0.004,
    cw: 0.37,
    autoPause: false,
  });
  engine.startAt(at);
  engine.prova = prova;
  engine.timeScale = 10;
  const game = new RideGame({ engine, track: session.path, world: { data: world, session }, nick: 'Michele', weightKg: 72, pbs: {}, sim: () => true, scale: () => 10, ranked: !prova, prova });
  for (let i = 0; i < 200_000 && !engine.arrived; i++) {
    engine.tick(0.05);
    session.step(engine, 0.05);
    game.tick(0.05);
  }
  return { session, engine, game };
}

function deps() {
  const career = normalize(EMPTY_CAREER);
  const d = {
    loadProgress: vi.fn(async () => ({ ...EMPTY_PROGRESS, xp: 1200 })),
    postResult: vi.fn(async () => ({ ok: true, rank: 3 })),
    postXp: vi.fn(async () => true),
    setProgress: vi.fn(async () => undefined),
    career: () => career,
    setCareer: vi.fn(async () => undefined),
    now: () => new Date('2026-11-11T18:00:00Z'),
    accoda: vi.fn(async () => undefined),
  } satisfies CommitDeps;
  return { d, career };
}

describe('Modalità prova (A11)', () => {
  it('un giro di prova: zero postResult e postXp, carriera e punti invariati, nel Diario col gettone', async () => {
    const { session, engine, game } = giroFatto(true);
    expect(engine.arrived).toBe(true);
    const { d, career } = deps();
    const before = JSON.stringify(career);
    const out = await commitProgress(
      { engine, game, session, replay: false, workout: null, profile: { name: 'Michele', weightKg: 72, ftp: 280 }, sim: true, rain: false, daytime: 'vera', together: false, committed: { ...NOTHING_COMMITTED } },
      d,
    );
    expect(d.postResult).not.toHaveBeenCalled();
    expect(d.postXp).not.toHaveBeenCalled();
    expect(d.setProgress).not.toHaveBeenCalled();
    expect(d.setCareer).not.toHaveBeenCalled();
    expect(JSON.stringify(career)).toBe(before);
    expect(out.xp.total).toBe(0);
    expect(out.outcome.total).toBe(0);
    expect(out.xp.level.xp).toBe(1200);
    // i record dei tratti non si toccano
    expect(Object.keys((game as unknown as { pbs: Record<string, unknown> }).pbs)).toHaveLength(0);
    const ride = engine.toRide('Città Alta');
    expect(ride.prova).toBe(true);
    expect(esportabile(ride)).toBe(false);
  }, 60_000);

  it('lo stesso giro col rullo: il tempo va in classifica e i punti contano', async () => {
    const { session, engine, game } = giroFatto(false);
    const { d } = deps();
    await commitProgress(
      { engine, game, session, replay: false, workout: null, profile: { name: 'Michele', weightKg: 72, ftp: 280 }, sim: false, rain: false, daytime: 'vera', together: false, committed: { ...NOTHING_COMMITTED } },
      d,
    );
    expect(d.postResult).toHaveBeenCalledTimes(1);
    expect(d.postXp).toHaveBeenCalledTimes(1);
    expect(d.setCareer).toHaveBeenCalledTimes(1);
    const ride = engine.toRide('Città Alta');
    expect(ride.prova).toBeUndefined();
    expect(esportabile(ride)).toBe(true);
  }, 60_000);

  it('il tempo da una partenza intermedia non entra nella classifica del percorso completo', async () => {
    const { session, engine, game } = giroFatto(false,1000);
    const { d } = deps();
    expect(engine.arrived).toBe(true);
    expect(engine.odometer).toBeCloseTo(engine.track.length-1000,5);
    await commitProgress(
      { engine,game,session,replay:false,workout:null,profile:{name:'M',weightKg:72,ftp:280},
        sim:false,rain:false,daytime:'vera',together:false,committed:{...NOTHING_COMMITTED} },d);
    expect(d.postResult).not.toHaveBeenCalled();
    expect(d.setCareer).toHaveBeenCalled();
  }, 60_000);

  it('il punto di ripresa di un giro di prova torna nel Diario come prova', () => {
    const { engine } = giroFatto(true);
    const ride = rideFromCheckpoint({ v: 1, savedAt: '', search: 'world=bergamo&ride=citta-alta', name: 'Prova', ftp: 280, lthr: 166, engine: engine.checkpoint(), game: { results: [], pois: [] } });
    expect(ride.prova).toBe(true);
  }, 60_000);
});
