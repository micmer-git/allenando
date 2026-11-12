import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projector } from '../src/domain/geo';
import { CLS, WorldGraph } from '../src/open/graph';
import { GANDA_NAME, GANDA_PLAN, gandaClimb, pedalaFromPoint, pickRoad, roadStart } from '../src/open/partenze';
import { WorldSession } from '../src/open/session';
import { decodeFeatures, type WorldData } from '../src/open/world';
import { sceltaGanda } from '../src/pages/pedala/scelta';
import { intentoDaSearch } from '../src/ride/intento';

const json = (name: string) => JSON.parse(readFileSync(`public/world/bergamo/${name}.json`, 'utf8'));
const graph = new WorldGraph(json('graph'));
const proj = projector(graph.origin);
const data: WorldData = { graph, features: decodeFeatures(json('features')), rides: json('rides'), proj, toGeo: proj.toGeo };

describe('partenze sulla rete stradale', () => {
  it('dal sopralluogo conserva strada, punto e verso inverso fino alla sessione', () => {
    const edge = graph.edges[4689];
    const exact = roadStart(graph, edge.id, edge.length * 0.36, -1)!;
    const link = new URL(pedalaFromPoint(exact), 'https://example.test');
    const point = intentoDaSearch(link.searchParams)?.dove;
    expect(point).toMatchObject({ kind: 'libero', world: 'bergamo', edge: edge.id, dir: -1 });
    if (point?.kind !== 'libero') throw new Error('Punto di partenza assente');
    const session = new WorldSession(data, point, 0);
    const first = session.path.edgeAt(0);
    expect(first).toMatchObject({ edge: edge.id, dir: -1 });
    expect(Math.abs(first.s - exact.s)).toBeLessThan(0.051);
    expect(session.path.edgeAt(5).s).toBeCloseTo(first.s - 5);
  });

  it('sceglie anche una ciclabile, scarta i tocchi lontani e rispetta il senso unico', () => {
    const cycleway = graph.edges.find(edge => edge.cls === CLS.cycleway && edge.length > 120)!;
    const middle = graph.pose(cycleway.id, cycleway.length * 0.5);
    const hit = pickRoad(graph, middle.x, middle.z, 1.2);
    expect(hit?.edge).toBe(cycleway.id);
    expect(hit?.s).toBeCloseTo(cycleway.length * 0.5, 1);
    expect(pickRoad(graph, graph.bounds.x0 - 3000, graph.bounds.z0 - 3000, 150)).toBeNull();
    expect(roadStart(graph, 4685, -10, -1)).toMatchObject({ s: 0, dir: 1 });
    expect(roadStart(graph, -1, 200)).toBeNull();
  });

  it('la salita condivisa parte da Gazzaniga e arriva al Passo sulla rete connessa', () => {
    const legs = gandaClimb(data);
    const first = legs[0], last = legs[legs.length - 1];
    const foot = graph.pose(first.edge, first.dir === 1 ? 0 : graph.edges[first.edge].length);
    expect(graph.edges[first.edge].name).toBe('Via Guglielmo Marconi');
    // Via Marconi esiste anche in un altro paese attraversato dallo stesso giro.
    expect(Math.hypot(foot.x - 2924.4, foot.z - 7877.6)).toBeLessThan(3);
    const pass = data.features.landmarks.find(l => l.id === 'passo-di-ganda')!;
    const node = graph.endNode(last.edge, last.dir);
    expect(Math.hypot(graph.nodeX[node] - pass.x, graph.nodeZ[node] - pass.z)).toBeLessThan(3);
    for (const [i, leg] of legs.entries()) {
      expect(graph.allowed(leg.edge, leg.dir)).toBe(true);
      if (i) expect(graph.startNode(leg.edge, leg.dir)).toBe(graph.endNode(legs[i - 1].edge, legs[i - 1].dir));
    }
    const session = new WorldSession(data, { legs, name: GANDA_NAME }, 0);
    expect(session.path.length).toBeGreaterThan(9560);
    expect(session.path.length).toBeLessThan(9600);
    const scelta = sceltaGanda(data);
    expect(scelta?.dove).toEqual({ kind: 'piano', world: 'bergamo', plan: GANDA_PLAN });
    expect(scelta?.vista.lunghezzaM).toBeCloseTo(session.path.length, -1);
    expect(scelta?.vista.dislivelloM).toBeGreaterThan(660);
  });
});
