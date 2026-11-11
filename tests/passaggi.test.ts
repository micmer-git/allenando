import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projector } from '../src/domain/geo';
import { STANDARD_AIR } from '../src/domain/physics';
import type { Workout } from '../src/domain/types';
import { WorldGraph, type Leg, type WorldGraphFile } from '../src/open/graph';
import { chiuso, passaggi, percorribili, rovescia } from '../src/open/passaggi';
import { WorldSession } from '../src/open/session';
import { decodeFeatures, type RideDef, type WorldData } from '../src/open/world';
import { RideEngine } from '../src/sim/engine';
import type { TelemetrySource, TrainerSnapshot } from '../src/sim/source';

const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as Parameters<typeof decodeFeatures>[0]);
const proj = projector(graph.origin);
const world: WorldData = { graph, rides, features, proj, toGeo: (x, z) => proj.toGeo(x, z) };
const ride = (id: string) => rides.find((r) => r.id === id)!;
const legsOf = (id: string): Leg[] => ride(id).legs.map(([edge, dir]) => ({ edge, dir }));

class FixedPower implements TelemetrySource {
  readonly mode = 'simulator' as const;
  hr = 140;
  cadence = 90;
  constructor(public power: number) {}
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

/** Una pedalata nel mondo senza React: motore e sessione come in rideFrame, e l'allenamento che continua come in RideGame. */
function pedala(id: string, giri: number, workout: Workout | null) {
  const session = new WorldSession(world, { ride: ride(id) }, 0, { giri });
  const engine = new RideEngine({
    track: session.path,
    source: new FixedPower(320),
    physics: { massKg: 80, cda: 0.3, crr: 0.004, ...STANDARD_AIR },
    ftp: 300,
    maxHr: 186,
    restHr: 52,
    lthr: 166,
    weightKg: 72,
    workout,
    withCamilla: false,
    crr: 0.004,
    cw: 0.37,
    autoPause: false,
  });
  engine.timeScale = 10;
  const run = (maxSec = 6 * 3600) => {
    for (let i = 0; i < maxSec * 2 && engine.phase !== 'finished'; i++) {
      engine.tick(0.05);
      session.step(engine, 0.05);
      if (engine.workout && !engine.workoutDone) session.allenamentoContinua(engine.distance);
    }
  };
  return { session, engine, run };
}

const minuti = (min: number): Workout => ({ id: 'w', builtin: false, kind: 'endurance', steps: [{ id: 's', durationSec: Math.round(min * 60), powerPct: 70 }] });

describe('anelli e percorsi aperti', () => {
  it('la Ganda si chiude su sé stessa, Selvino no', () => {
    expect(chiuso(graph, legsOf('ganda'))).toBe(true);
    expect(chiuso(graph, legsOf('selvino'))).toBe(false);
  });

  it('3 passaggi su un anello: 3 volte la sua lunghezza', () => {
    const legs = legsOf('ganda');
    const one = graph.legsLength(legs);
    expect(Math.abs(graph.legsLength(passaggi(legs, 3, true)) - 3 * one)).toBeLessThan(1);
    const s = new WorldSession(world, { ride: ride('ganda') }, 0, { giri: 3 });
    expect(Math.abs(s.path.length - 3 * one)).toBeLessThan(1);
    expect(s.giri).toBe(3);
    expect(s.traguardi().map((t) => Math.round(t / one))).toEqual([1, 2, 3]);
  });

  it('va e torna: le tratte pari sono l’andata rovesciata', () => {
    const legs = legsOf('selvino');
    const p = passaggi(legs, 3, false);
    expect(p).toHaveLength(legs.length * 3);
    expect(p.slice(0, legs.length)).toEqual(legs);
    expect(p.slice(legs.length, 2 * legs.length)).toEqual(rovescia(legs));
    expect(p.slice(2 * legs.length)).toEqual(legs);
    // la strada torna dove era partita, senza buchi
    const back = percorribili(graph, rovescia(legs));
    expect(graph.endNode(back.at(-1)!.edge, back.at(-1)!.dir)).toBe(graph.startNode(legs[0].edge, legs[0].dir));
    for (let i = 1; i < back.length; i++) expect(graph.startNode(back[i].edge, back[i].dir)).toBe(graph.endNode(back[i - 1].edge, back[i - 1].dir));
    for (const l of back) expect(graph.allowed(l.edge, l.dir)).toBe(true);
  });

  it('un passaggio solo, senza giri: tutto come prima', () => {
    const s = new WorldSession(world, { ride: ride('selvino') }, 0);
    expect(s.giri).toBe(1);
    expect(Math.abs(s.path.length - graph.legsLength(legsOf('selvino')))).toBeLessThan(1);
  });
});

describe('i giri in corsa', () => {
  it('Libera, 2 giri: «Giro 1 di 2» → «Giro 2 di 2», e si chiude al secondo traguardo coi due tempi', () => {
    const { session, engine, run } = pedala('citta-alta', 2, null);
    expect(session.giro).toBe(1);
    const [t1] = session.traguardi();
    for (let i = 0; i < 100_000 && engine.distance < t1 + 50; i++) {
      engine.tick(0.05);
      session.step(engine, 0.05);
    }
    expect(session.giro).toBe(2);
    expect(session.traguardoFra(engine.distance)).toBeGreaterThan(0);
    run();
    expect(engine.arrived).toBe(true);
    expect(session.giriFatti.map((g) => g.giro)).toEqual([1, 2]);
    expect(session.giriFatti.every((g) => g.sec > 60)).toBe(true);
    expect(engine.giri).toBe(2);
  }, 60_000);

  it('l’allenamento non è finito al traguardo dell’ultimo giro: un giro in più, da solo', () => {
    // un giro della Città Alta a 320 W sta sotto i 12 minuti: 18 minuti vogliono un giro in più
    const { session, engine, run } = pedala('citta-alta', 1, minuti(18));
    run();
    expect(session.giri).toBe(2);
    expect(session.toasts.some((t) => t.title === 'Giro in più') || session.giriFatti.length === 2).toBe(true);
    expect(engine.workoutDone).toBe(true);
    expect(engine.arrived).toBe(true);
    expect(session.giriFatti).toHaveLength(2);
    expect(engine.elapsed).toBeGreaterThan(18 * 60);
  }, 60_000);

  it('l’allenamento finisce prima: il rullo torna libero e si chiude al traguardo dell’ultimo giro', () => {
    const { session, engine, run } = pedala('citta-alta', 2, minuti(5));
    run();
    expect(engine.workoutDone).toBe(true);
    expect(engine.mode).toBe('free');
    expect(session.giri).toBe(2);
    expect(session.giriFatti).toHaveLength(2);
    expect(engine.arrived).toBe(true);
  }, 60_000);

  it('il tetto dei 20 giri: oltre si prosegue libero', () => {
    const s = new WorldSession(world, { ride: ride('citta-alta') }, 0, { giri: 99 });
    expect(s.giri).toBe(20);
    s.allenamentoContinua(s.path.length - 10);
    expect(s.giri).toBe(20);
    expect(s.routeEnd).not.toBeNull();
  });
});
