import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadRides } from '../src/db/db';
import { projector } from '../src/domain/geo';
import { STANDARD_AIR } from '../src/domain/physics';
import { getTrack } from '../src/domain/track';
import { RideGame, rideFrame } from '../src/game/rideGame';
import { MAX_TURNS, turnChoices, type TurnOptionLike } from '../src/game/turns';
import { WorldGraph, type WorldGraphFile } from '../src/open/graph';
import { WorldSession } from '../src/open/session';
import { decodeFeatures, type RideDef, type WorldData } from '../src/open/world';
import { AUTO_PAUSE_SEC, RideEngine } from '../src/sim/engine';
import { clearCheckpoint, loadCheckpoint, rideFromCheckpoint, RideKeeper, resumePath, sameRide, sameRideSearch, possibileRipresaPrecedente, type KeeperMeta } from '../src/sim/recovery';
import type { TelemetrySource, TrainerSnapshot } from '../src/sim/source';
import { SimulatorSource } from '../src/sim/simulator';
import { useApp } from '../src/store/useApp';

/** Un rullo finto: potenza e cadenza a mano, simulatore o Bluetooth. */
class Pedals implements TelemetrySource {
  hr = 120;
  constructor(
    public power: number,
    public cadence: number,
    readonly mode: 'simulator' | 'bluetooth' = 'simulator',
  ) {}
  snapshot(): TrainerSnapshot {
    return { mode: this.mode, deviceName: null, services: { ftms: false, power: false, hr: false, csc: false }, control: 'none', simulation: 'none', status: 'connected', busy: false };
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

function engineWith(source: TelemetrySource, track = getTrack()): RideEngine {
  return new RideEngine({
    track,
    source,
    physics: { massKg: 80, cda: 0.32, crr: 0.004, ...STANDARD_AIR },
    ftp: 250,
    maxHr: 186,
    restHr: 52,
    lthr: 166,
    weightKg: 72,
    workout: null,
    withCamilla: false,
    crr: 0.004,
    cw: 0.39,
  });
}

const ride = (e: RideEngine, sec: number, dt = 0.05) => {
  for (let t = 0; t < sec; t += dt) e.tick(dt);
};

function keeperFor(engine: RideEngine, search = 'route=selvino-nembro'): RideKeeper {
  const meta: KeeperMeta = {
    name: () => 'Selvino da Nembro',
    where: () => ({ search, rebase: false }),
    ftp: 250,
    lthr: 166,
    routeId: () => 'selvino-nembro',
    game: () => ({ results: [], pois: [] }),
  };
  return new RideKeeper(engine, meta, (r) => useApp.getState().saveRide(r));
}

describe('2.1 il giro si salva da solo, e riprende', () => {
  beforeEach(async () => {
    await clearCheckpoint();
  });

  it('al «Termina» il giro è nel diario senza toccare niente', async () => {
    const engine = engineWith(new SimulatorSource());
    ride(engine, 60);
    const keeper = keeperFor(engine);
    await keeper.checkpoint();
    expect(await loadCheckpoint()).not.toBeNull();
    const { ride: done, saved } = keeper.finish();
    await saved;
    const rides = await loadRides();
    const inDb = rides.find((r) => r.id === done.id);
    expect(inDb).toBeTruthy();
    expect(inDb!.durationSec).toBeGreaterThanOrEqual(59);
    expect(inDb!.routeId).toBe('selvino-nembro');
    // salvato: il punto di ripresa non serve più
    expect(await loadCheckpoint()).toBeNull();
  });

  it('ogni punto di ripresa riapre il giro con tempo e km uguali entro 1 s', async () => {
    const a = engineWith(new SimulatorSource());
    a.effort = 1.1;
    ride(a, 60);
    const keeper = keeperFor(a);
    expect(await keeper.checkpoint()).toBe(true);
    const cp = await loadCheckpoint();
    expect(cp).not.toBeNull();
    expect(resumePath(cp!)).toBe('/ride?route=selvino-nembro&resume=1');
    expect(sameRide(cp!, new URLSearchParams('route=selvino-nembro&resume=1'))).toBe(true);
    expect(sameRide(cp!, new URLSearchParams('route=selvino-nembro&at=300'))).toBe(false);

    const b = engineWith(new SimulatorSource());
    b.restore(cp!.engine);
    expect(Math.abs(b.elapsed - a.elapsed)).toBeLessThan(1);
    expect(Math.abs(b.odometer - a.odometer)).toBeLessThan(1);
    expect(b.rideId).toBe(a.rideId);
    expect(b.startedAt.toISOString()).toBe(a.startedAt.toISOString());
    // si riparte da lì: i campioni continuano in ordine, l'id resta quello
    ride(b, 30);
    const r = b.toRide('Selvino da Nembro');
    expect(r.id).toBe(a.rideId);
    const ts = r.samples.map((s) => s.t);
    expect(ts).toEqual([...ts].sort((x, y) => x - y));
    expect(new Set(ts).size).toBe(ts.length);
    expect(r.durationSec).toBeGreaterThanOrEqual(89);
    expect(r.distanceM).toBeGreaterThan(a.odometer);
  });

  it('un giro troppo corto non lascia punti di ripresa', async () => {
    const e = engineWith(new SimulatorSource());
    ride(e, 5);
    expect(await keeperFor(e).checkpoint()).toBe(false);
    expect(await loadCheckpoint()).toBeNull();
  });

  it('il giro libero ripreso ricomincia il percorso da 0 ma non il contachilometri', async () => {
    const a = engineWith(new SimulatorSource());
    ride(a, 40);
    const originSearch = 'world=bergamo&edge=4&s=10&dir=-1';
    const meta: KeeperMeta = { name: () => 'Giro libero', where: () => ({ search: 'world=bergamo&edge=12&s=30.4&dir=1', originSearch, rebase: true }), ftp: 250, lthr: 166, routeId: () => undefined, game: () => ({ results: [], pois: ['p1'] }) };
    const keeper = new RideKeeper(a, meta, (r) => useApp.getState().saveRide(r));
    await keeper.checkpoint();
    const cp = (await loadCheckpoint())!;
    expect(cp.engine.distance).toBe(0);
    expect(cp.engine.base).toBeCloseTo(a.odometer, 3);
    expect(cp.game.pois).toEqual(['p1']);
    const initial = new URLSearchParams(originSearch);
    expect(sameRide(cp, initial)).toBe(true);
    expect(sameRideSearch(cp.search, initial)).toBe(false);
    const restored = new URLSearchParams(resumePath(cp).split('?')[1]);
    expect(restored.get('edge')).toBe('12');
    expect(restored.get('s')).toBe('30.4');
    expect(restored.get('dir')).toBe('1');
    expect(sameRideSearch(cp.search, restored)).toBe(true);
    expect(sameRide(cp, new URLSearchParams('world=bergamo&edge=99'))).toBe(false);
    const legacy = { ...cp, originSearch: undefined };
    expect(sameRide(legacy, initial)).toBe(false);
    expect(possibileRipresaPrecedente(legacy, initial)).toBe(true);
    expect(possibileRipresaPrecedente(legacy, new URLSearchParams('world=sellaronda&edge=4'))).toBe(false);
    expect(possibileRipresaPrecedente(cp, initial)).toBe(false);
    const b = engineWith(new SimulatorSource());
    b.restore(cp.engine);
    ride(b, 10);
    expect(b.toRide('x').distanceM).toBeGreaterThan(a.odometer);
    expect(b.samples[b.samples.length - 1].distance).toBeGreaterThan(a.odometer);
  });

  it('«Salva com\'è» fa un giro vero dal punto di ripresa', async () => {
    const a = engineWith(new SimulatorSource());
    ride(a, 45);
    await keeperFor(a).checkpoint();
    const r = rideFromCheckpoint((await loadCheckpoint())!);
    expect(r.id).toBe(a.rideId);
    expect(r.name).toBe('Selvino da Nembro');
    expect(r.samples.length).toBe(a.samples.length);
    expect(r.distanceM).toBeCloseTo(a.odometer, 3);
  });
});

describe('2.10 pausa automatica col rullo', () => {
  it('0 W e 0 rpm per 3 s mettono in pausa, la prima pedalata riparte', () => {
    const pedals = new Pedals(0, 0, 'bluetooth');
    const e = engineWith(pedals);
    ride(e, AUTO_PAUSE_SEC - 0.5);
    expect(e.phase).toBe('riding');
    ride(e, 1);
    expect(e.phase).toBe('paused');
    expect(e.autoPaused).toBe(true);
    const t = e.elapsed;
    ride(e, 5);
    expect(e.elapsed).toBe(t);
    pedals.power = 180;
    pedals.cadence = 85;
    e.tick(0.05);
    expect(e.phase).toBe('riding');
    expect(e.autoPaused).toBe(false);
    ride(e, 2);
    expect(e.elapsed).toBeGreaterThan(t);
  });

  it('una pausa a mano non riparte da sola', () => {
    const pedals = new Pedals(200, 90, 'bluetooth');
    const e = engineWith(pedals);
    ride(e, 2);
    e.pause();
    ride(e, 2);
    expect(e.phase).toBe('paused');
    expect(e.autoPaused).toBe(false);
  });

  it('mai col simulatore', () => {
    const e = engineWith(new Pedals(0, 0, 'simulator'));
    ride(e, 10);
    expect(e.phase).toBe('riding');
    expect(e.autoPaused).toBe(false);
  });
});

describe('2.7 la scelta all\'incrocio', () => {
  const opt = (turn: number, label: string, toward = '', onRoute = false, extra: Partial<TurnOptionLike> = {}): TurnOptionLike => ({ turn, uTurn: false, label, toward, onRoute, ...extra });

  it('al massimo tre frecce, e quella del percorso dice «Percorso»', () => {
    const options = [opt(100, 'Via Masone', 'Città Alta'), opt(40, 'Via San Tomaso', 'Città Alta', true), opt(0, 'Via Pignolo', 'Borgo Palazzo'), opt(-80, 'Viale Papa Giovanni XXIII', 'Bergamo'), opt(170, 'Via Tasso', '', false, { uTurn: true })];
    const c = turnChoices(options, 1);
    expect(c.length).toBeLessThanOrEqual(MAX_TURNS);
    expect(c.find((x) => x.onRoute)?.name).toBe('Percorso');
    expect(c.some((x) => x.uTurn)).toBe(false);
    expect(c.some((x) => x.selected)).toBe(true);
  });

  it('due strade verso lo stesso paese prendono il nome della via', () => {
    const c = turnChoices([opt(90, 'Via Masone', 'Città Alta'), opt(-45, 'Via Pignolo', 'Città Alta')], 0);
    const names = c.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(['Via Masone', 'Via Pignolo']);
  });

  it('nomi sempre diversi, anche senza paese né via', () => {
    const cases: TurnOptionLike[][] = [
      [opt(30, ''), opt(80, ''), opt(-60, '')],
      [opt(0, 'Via Roma'), opt(10, 'Via Roma'), opt(-90, 'Via Roma')],
      [opt(60, '', 'Nembro'), opt(70, '', 'Nembro'), opt(-60, '', 'Nembro', true)],
      [opt(45, 'Rotatoria', '', false, { exit: 3 }), opt(0, 'Rotatoria', '', false, { exit: 2 }), opt(-45, 'Rotatoria', '', false, { exit: 1 })],
    ];
    for (const options of cases) {
      for (let sel = 0; sel < options.length; sel++) {
        const names = turnChoices(options, sel).map((x) => x.name);
        expect(new Set(names).size, names.join(' | ')).toBe(names.length);
        for (const n of names) expect(n.charAt(0), n).toBe(n.charAt(0).toUpperCase());
      }
    }
  });

  it('la scelta fatta resta fra le frecce anche quando le uscite sono tante', () => {
    const options = [opt(150, 'A', 'Uno'), opt(100, 'B', 'Due'), opt(60, 'C', 'Tre'), opt(0, 'D', 'Quattro'), opt(-60, 'E', 'Cinque'), opt(-120, 'F', 'Sei')];
    for (let sel = 0; sel < options.length; sel++) {
      const c = turnChoices(options, sel);
      expect(c.length).toBe(3);
      expect(c.some((x) => x.index === sel && x.selected)).toBe(true);
    }
  });
});

describe('2.2 niente corsa prima del mondo', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
  const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
  const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
  const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as Parameters<typeof decodeFeatures>[0]);
  const proj = projector(graph.origin);
  const data: WorldData = { graph, rides, features, proj, toGeo: (x, z) => proj.toGeo(x, z) };

  it('prima di «pronto»: tempo fermo, nessun tratto, nessun punto caldo; poi il GPM di Città Alta parte', () => {
    const def = rides.find((r) => r.id === 'citta-alta')!;
    const session = new WorldSession(data, { ride: def }, 0);
    const engine = engineWith(new Pedals(260, 90), session.path);
    const game = new RideGame({ engine, track: session.path, world: { data, session }, nick: '', weightKg: 72, pbs: {}, sim: () => true, scale: () => 1, ranked: false });
    const world = { data, session };
    for (let i = 0; i < 400; i++) rideFrame(engine, world, game, 0.05, false);
    expect(engine.elapsed).toBe(0);
    expect(engine.distance).toBe(0);
    expect(game.live.length).toBe(0);
    expect(game.poiToast).toBeNull();
    expect(game.results.length).toBe(0);
    // la posa c'è già: il 3D sa dove caricare
    expect(Math.hypot(session.pose.x, session.pose.z)).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) rideFrame(engine, world, game, 0.05, true);
    expect(engine.elapsed).toBeGreaterThan(9);
    expect(game.live.length + game.results.length).toBeGreaterThan(0);
  });
});
