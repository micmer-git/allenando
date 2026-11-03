import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldGraph, type Leg, type WorldGraphFile } from '../src/open/graph';
import { suggestLoops } from '../src/open/loops';
import type { RideDef } from '../src/open/world';
import { WORLD_EDGES, WORLD_ID, WORLD_RIDES } from '../src/multiplayer/world-rides';

// Il mondo di Bergamo come lo scarica la pagina: grafo e percorsi generati da build-world.
const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const file = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile;
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
const graph = new WorldGraph(file);

const legsOf = (r: RideDef): Leg[] => r.legs.map(([edge, dir]) => ({ edge, dir }));

describe('mondo di Bergamo', () => {
  it('il server della classifica conosce lo stesso mondo della pagina', () => {
    expect(graph.id).toBe(WORLD_ID);
    expect(file.edges.length).toBe(WORLD_EDGES);
    expect(Object.keys(WORLD_RIDES).sort()).toEqual(rides.map((r) => r.id).sort());
  });

  it('ci sono le due valli e la città', () => {
    const areas = new Set(rides.map((r) => r.area));
    for (const a of ['citta', 'brembana', 'seriana']) expect(areas.has(a as RideDef['area'])).toBe(true);
  });

  for (const r of rides) {
    describe(r.id, () => {
      const legs = legsOf(r);

      it('è una strada sola: ogni tratto parte dove finisce il precedente, nel verso ammesso', () => {
        for (let i = 0; i < legs.length; i++) {
          expect(graph.allowed(legs[i].edge, legs[i].dir), `tratto ${i} contromano`).toBe(true);
          if (i > 0) expect(graph.startNode(legs[i].edge, legs[i].dir), `buco al tratto ${i}`).toBe(graph.endNode(legs[i - 1].edge, legs[i - 1].dir));
        }
      });

      it('lunghezza e dislivello dichiarati sono quelli della strada', () => {
        expect(Math.abs(graph.legsLength(legs) - r.lengthM) / r.lengthM).toBeLessThan(0.02);
        expect(Math.abs(graph.legsGain(legs) - r.gainM)).toBeLessThan(Math.max(25, r.gainM * 0.1));
      });

      it('pendenze da strada vera, non da muro', () => {
        expect(r.maxGrade).toBeGreaterThan(0);
        expect(r.maxGrade).toBeLessThan(0.25);
        expect(r.climbGrade).toBeLessThanOrEqual(r.maxGrade + 1e-9);
      });

      it('almeno cinque luoghi da riconoscere, vicini alla strada e in ordine', () => {
        expect(r.landmarks.length).toBeGreaterThanOrEqual(5);
        for (let i = 0; i < r.landmarks.length; i++) {
          expect(r.landmarks[i].at).toBeGreaterThanOrEqual(0);
          expect(r.landmarks[i].at).toBeLessThanOrEqual(r.lengthM + 1);
          if (i > 0) expect(r.landmarks[i].at).toBeGreaterThanOrEqual(r.landmarks[i - 1].at);
        }
      });
    });
  }

  it('dalla stazione di Bergamo suggerisce un anello che torna al via', () => {
    const first = legsOf(rides.find((r) => r.id === 'citta-alta')!)[0];
    const start = graph.startNode(first.edge, first.dir);
    const loops = suggestLoops(graph, start, { targetM: 20000, taste: 'misto', directions: 6 });
    expect(loops.length).toBeGreaterThan(0);
    const l = loops[0];
    expect(graph.startNode(l.legs[0].edge, l.legs[0].dir)).toBe(start);
    const last = l.legs[l.legs.length - 1];
    expect(graph.endNode(last.edge, last.dir)).toBe(start);
    expect(l.lengthM).toBeGreaterThan(12000);
    expect(l.lengthM).toBeLessThan(30000);
  });
});
