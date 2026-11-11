import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STANDARD_AIR, type PhysicsParams } from '../src/domain/physics';
import { giriPer, stimaSecondi, wattMedi } from '../src/domain/stima';
import { createRouteTrack, type Track } from '../src/domain/track';
import { builtinById } from '../src/domain/workouts';
import { WorldGraph, type Leg, type WorldGraphFile } from '../src/open/graph';
import { profiloDiLegs } from '../src/open/passaggi';
import { WorldPath } from '../src/open/path';
import type { RideDef } from '../src/open/world';
import { RideEngine } from '../src/sim/engine';
import { SimulatorSource } from '../src/sim/simulator';

const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
const legsOf = (id: string): Leg[] => rides.find((r) => r.id === id)!.legs.map(([edge, dir]) => ({ edge, dir }));

const fisica: PhysicsParams = { massKg: 83, cda: 0.32, crr: 0.004, ...STANDARD_AIR };

/** Il motore vero, col simulatore in ERG agli stessi watt, fino all'arrivo. */
function motore(track: Track, watt: number): number {
  const e = new RideEngine({
    track,
    source: new SimulatorSource(),
    physics: fisica,
    ftp: 250,
    maxHr: 186,
    restHr: 52,
    lthr: 166,
    weightKg: 75,
    withCamilla: false,
    crr: 0.004,
    cw: 0.32 * 1.225,
    tipo: 'fissa',
    watt,
  });
  e.timeScale = 10;
  for (let i = 0; i < 200_000 && !e.arrived; i++) e.tick(0.1);
  return e.elapsed;
}

function pathOf(legs: Leg[]): WorldPath {
  const first = legs[0];
  const p = new WorldPath(graph, { edge: first.edge, dir: first.dir, s: first.dir > 0 ? 0 : graph.edges[first.edge].length });
  for (let i = 1; i < legs.length; i++) p.append(legs[i].edge, legs[i].dir);
  return p;
}

describe('stima del giro (A14): la fisica del motore sul profilo', () => {
  it('sulla Ganda, a 200 W: entro il 10 % del motore', () => {
    const legs = legsOf('ganda');
    const stima = stimaSecondi(profiloDiLegs(graph, legs), 200, fisica);
    const vero = motore(pathOf(legs), 200);
    expect(Math.abs(stima - vero) / vero).toBeLessThan(0.1);
  }, 60_000);

  it('su 10 km piatti, a 180 W: entro il 10 % del motore', () => {
    const pts = Array.from({ length: 1001 }, (_, i) => ({ x: 0, z: i * 10, ele: 250 }));
    const track = createRouteTrack(pts, { halfWidth: 3 });
    const profilo = Array.from({ length: 101 }, (_, i) => ({ distance: i * 100, altitude: 250 }));
    const stima = stimaSecondi(profilo, 180, fisica);
    const vero = motore(track, 180);
    expect(Math.abs(stima - vero) / vero).toBeLessThan(0.1);
  }, 60_000);

  it('più watt, giro più corto; niente watt, niente stima', () => {
    const profilo = profiloDiLegs(graph, legsOf('citta-alta'));
    expect(stimaSecondi(profilo, 300, fisica)).toBeLessThan(stimaSecondi(profilo, 150, fisica));
    expect(stimaSecondi(profilo, 0, fisica)).toBe(0);
    expect(stimaSecondi([], 200, fisica)).toBe(0);
  });

  it('i watt medi di un allenamento: la media pesata dei bersagli', () => {
    const w = { id: 'x', builtin: false, kind: 'endurance' as const, steps: [
      { id: 'a', durationSec: 600, powerPct: 50 },
      { id: 'b', durationSec: 1200, powerPct: 80 },
    ] };
    expect(wattMedi(w, 250)).toBeCloseTo((600 * 125 + 1200 * 200) / 1800, 5);
    expect(wattMedi(builtinById('risveglio')!, 250)).toBeGreaterThan(0);
  });

  it('i giri per una durata: per eccesso, da 1 a 20', () => {
    expect(giriPer(54 * 60, 25 * 60)).toBe(3);
    expect(giriPer(50 * 60, 25 * 60)).toBe(2);
    expect(giriPer(60, 25 * 60)).toBe(1);
    expect(giriPer(10 * 3600, 60)).toBe(20);
    expect(giriPer(0, 100)).toBe(1);
    expect(giriPer(100, 0)).toBe(1);
  });
});
