import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAG, WorldGraph, type WorldGraphFile } from '../src/open/graph';
import { WorldSession } from '../src/open/session';
import { isPaintedCrossing, poiKind, snapSignals } from '../src/open/snap';
import { decodeFeatures, type FeaturesFile, type WorldData } from '../src/open/world';
import { projector } from '../src/domain/geo';

/*
 * La strada: rotatorie (una domanda sola, uscite numerate), semafori agganciati agli incroci,
 * features.json vecchi e nuovi. Grafi piccoli disegnati qui, più qualche controllo sul mondo vero.
 */

type P = [number, number];

/** Un grafo da una lista di nodi e archi dritti (o con punti in mezzo). */
function graphOf(nodes: P[], edges: { a: number; b: number; flags?: number; cls?: number; name?: string; via?: P[] }[]): WorldGraph {
  const names = [''];
  const intern = (s: string) => {
    let i = names.indexOf(s);
    if (i < 0) i = names.push(s) - 1;
    return i;
  };
  const dm = (v: number) => Math.round(v * 10);
  const file: WorldGraphFile = {
    v: 1,
    id: 'prova',
    name: 'prova',
    origin: { lat: 45.7, lon: 9.7 },
    bounds: { x0: -1000, z0: -1000, x1: 1000, z1: 1000 },
    tile: 2000,
    demStep: 25,
    far: { step: 250, nx: 2, nz: 2, x0: -1000, z0: -1000 },
    builtAt: '2026-11-03',
    attribution: '',
    names,
    nodes: nodes.flatMap(([x, z]) => [dm(x), dm(z), 0]),
    edges: edges.map((e) => {
      const pts: P[] = [nodes[e.a], ...(e.via ?? []), nodes[e.b]];
      const coords: number[] = [];
      let px = 0;
      let pz = 0;
      for (const [x, z] of pts) {
        coords.push(dm(x) - px, dm(z) - pz, 0);
        px = dm(x);
        pz = dm(z);
      }
      return [e.a, e.b, intern(e.name ?? ''), 0, e.cls ?? 3, e.flags ?? 0, 30, coords];
    }),
  };
  return new WorldGraph(file);
}

const RING = FLAG.roundabout | FLAG.oneway;

/**
 * Rotatoria di raggio 20 m al centro, quattro rami lunghi 300 m. x verso est, z verso sud: da sud
 * (0, 20) a est (20, 0), nord, ovest è il senso antiorario visto dall'alto, come in Italia.
 */
function roundabout() {
  const nodes: P[] = [
    [0, 20], // 0 anello sud
    [20, 0], // 1 anello est
    [0, -20], // 2 anello nord
    [-20, 0], // 3 anello ovest
    [0, 320], // 4 capo sud
    [320, 0], // 5 capo est
    [0, -320], // 6 capo nord
    [-320, 0], // 7 capo ovest
  ];
  const edges = [
    { a: 0, b: 1, flags: RING, via: [[14, 14]] as P[] },
    { a: 1, b: 2, flags: RING, via: [[14, -14]] as P[] },
    { a: 2, b: 3, flags: RING, via: [[-14, -14]] as P[] },
    { a: 3, b: 0, flags: RING, via: [[-14, 14]] as P[] },
    { a: 4, b: 0, name: 'via Sud' }, // 4: si entra da sud
    { a: 1, b: 5, name: 'via Est' }, // 5
    { a: 2, b: 6, name: 'via Sud' }, // 6: stesso nome, dritto
    { a: 3, b: 7, name: 'via Ovest' }, // 7
  ];
  return graphOf(nodes, edges);
}

function worldOf(graph: WorldGraph): WorldData {
  const features = decodeFeatures({ rivers: [], lakes: [], peaks: [], places: [], walls: [], rails: [], cables: [], landmarks: [] });
  const proj = projector(graph.origin);
  return { graph, rides: [], features, proj, toGeo: (x, z) => proj.toGeo(x, z) };
}

describe('rotatorie', () => {
  it('le uscite si contano nel verso dell’anello, la prima è a destra e l’ultima è tornare indietro', () => {
    const g = roundabout();
    const exits = g.roundaboutExits(4, 1)!;
    expect(exits).not.toBeNull();
    expect(exits.map((e) => e.exit)).toEqual([1, 2, 3, 4]);
    expect(exits.map((e) => e.edge)).toEqual([5, 6, 7, 4]);
    expect(exits.map((e) => e.via.length)).toEqual([1, 2, 3, 4]);
    // la prima a destra (svolta negativa), la terza a sinistra, la quarta è l'inversione
    expect(exits[0].turn).toBeLessThan(-45);
    expect(Math.abs(exits[1].turn)).toBeLessThan(20);
    expect(exits[2].turn).toBeGreaterThan(45);
    expect(exits[3].uTurn).toBe(true);
    for (const e of exits) expect(e.roundabout).toBe(true);
    // l'anello si percorre in fila, senza buchi
    for (const e of exits) {
      let node = g.endNode(4, 1);
      for (const l of e.via) {
        expect(g.startNode(l.edge, l.dir)).toBe(node);
        node = g.endNode(l.edge, l.dir);
      }
      expect(g.startNode(e.edge, e.dir)).toBe(node);
    }
  });

  it('senza rotatoria non ci sono uscite numerate', () => {
    const g = roundabout();
    expect(g.roundaboutExits(5, -1)).not.toBeNull(); // da est si entra nell'anello
    expect(g.roundaboutExits(5, 1)).toBeNull(); // verso il capo est: nessun anello
  });

  it('una domanda sola all’ingresso, poi l’anello si segue da solo', () => {
    const g = roundabout();
    const session = new WorldSession(worldOf(g), { edge: 4, dir: 1, s: 0 }, 0);
    const internals = session as unknown as { updateJunction(d: number): void };
    // giro libero: dopo l'anello si esce dritti (stesso nome), non alla prima
    const legs = session.path.legs.map((l) => l.edge);
    expect(legs.slice(0, 4)).toEqual([4, 0, 1, 6]);
    internals.updateJunction(250);
    const j = session.junction!;
    expect(j).not.toBeNull();
    expect(j.roundabout).toBe(true);
    // da sinistra a destra: l'ultima uscita prima, la prima per ultima
    expect(j.options.map((o) => o.exit)).toEqual([4, 3, 2, 1]);
    expect(j.options[j.selected].exit).toBe(2);
    // si sceglie la prima uscita: un pezzo d'anello e via Est
    session.choose(j.options.findIndex((o) => o.exit === 1));
    expect(session.path.legs.slice(0, 3).map((l) => l.edge)).toEqual([4, 0, 5]);
    // sull'anello non si chiede niente
    const ringStart = session.path.legs[1].from;
    internals.updateJunction(ringStart + 5);
    expect(session.junction).toBeNull();
  });
});

describe('semafori', () => {
  // incrocio a quattro bracci al centro, bracci di 300 m
  const nodes: P[] = [
    [0, 0],
    [0, 300],
    [300, 0],
    [0, -300],
    [-300, 0],
  ];
  const g = graphOf(nodes, [
    { a: 1, b: 0 },
    { a: 0, b: 2 },
    { a: 0, b: 3 },
    { a: 4, b: 0 },
  ]);

  it('i semafori dei bracci di un incrocio diventano uno solo, sull’incrocio', () => {
    const s = snapSignals(g, [
      { x: 1, z: 9 },
      { x: 8, z: -1 },
      { x: -1, z: -12 },
      { x: 0.5, z: 0.5 },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].node).toBe(0);
    expect(s[0].x).toBe(0);
    expect(s[0].z).toBe(0);
  });

  it('a metà strada è un semaforo pedonale, e due vicini sono lo stesso', () => {
    const s = snapSignals(g, [
      { x: 2, z: 150 },
      { x: -1, z: 160 },
      { x: 150, z: 3 },
    ]);
    expect(s).toHaveLength(2);
    for (const m of s) expect(m.node).toBe(-1);
    // agganciato sulla mezzeria
    expect(Math.abs(s[0].x)).toBeLessThan(0.01);
    expect(Math.abs(s[1].z)).toBeLessThan(0.01);
  });

  it('lontano da ogni strada non c’è semaforo', () => {
    expect(snapSignals(g, [{ x: 100, z: 100 }])).toHaveLength(0);
  });
});

describe('features.json', () => {
  const old: FeaturesFile = { rivers: [], lakes: [], peaks: [], places: [], walls: [], rails: [], cables: [], landmarks: [] };

  it('un file di prima del 03/11/2026 si legge ancora: liste vuote', () => {
    const f = decodeFeatures(old);
    expect(f.pois).toEqual([]);
    expect(f.signals).toEqual([]);
    expect(f.marks).toEqual({ crossings: [], yields: [], mini: [] });
  });

  it('i campi nuovi si leggono, i tipi sconosciuti si scartano', () => {
    const f = decodeFeatures({
      ...old,
      pois: [
        ['n1', 'fontanella', '', 10, 20, 300, 5, 12.5, 3.2, 0],
        ['a2', 'chiesa', 'San Rocco', 1, 2, 400, 6, 1, 20, 1],
        ['n3', 'astronave', 'boh', 0, 0, 0, 0, 0, 0, 0],
      ],
      signals: [[42, 7, 3.5, 100, 200, 250]],
      marks: { c: [7, 125], y: [8, 40, -1, 1], m: [42] },
    });
    expect(f.pois).toHaveLength(2);
    expect(f.pois[0]).toEqual({ id: 'n1', kind: 'fontanella', name: '', x: 10, z: 20, y: 300, edge: 5, s: 12.5, off: 3.2, building: false });
    expect(f.pois[1].building).toBe(true);
    expect(f.signals[0]).toEqual({ node: 42, edge: 7, s: 3.5, x: 100, z: 200, y: 250 });
    expect(f.marks.crossings).toEqual([{ edge: 7, s: 12.5 }]);
    expect(f.marks.yields).toEqual([{ edge: 8, s: 4, toward: -1, stop: true }]);
    expect(f.marks.mini).toEqual([42]);
  });

  it('che luogo è', () => {
    expect(poiKind({ amenity: 'drinking_water' })).toBe('fontanella');
    expect(poiKind({ tourism: 'viewpoint' })).toBe('belvedere');
    expect(poiKind({ amenity: 'place_of_worship', religion: 'christian', name: 'Santuario della Cornabusa' })).toBe('santuario');
    expect(poiKind({ building: 'church', name: 'San Rocco' })).toBe('chiesa');
    expect(poiKind({ amenity: 'place_of_worship', religion: 'muslim' })).toBeNull();
    expect(poiKind({ man_made: 'tower', 'tower:type': 'communication' })).toBeNull();
    expect(poiKind({ man_made: 'campanile' })).toBe('campanile');
    expect(poiKind({ historic: 'wayside_shrine' })).toBe('edicola');
    expect(poiKind({ shop: 'bicycle' })).toBe('bici');
    expect(isPaintedCrossing({ highway: 'crossing', crossing: 'unmarked' })).toBe(false);
    expect(isPaintedCrossing({ highway: 'crossing', crossing: 'zebra' })).toBe(true);
  });
});

describe('il mondo vero', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
  const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
  const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as FeaturesFile);

  it('le rotatorie ci sono, a senso unico, e da quasi ogni ingresso si esce', () => {
    const rings = graph.edges.filter((e) => e.flags & FLAG.roundabout);
    expect(rings.length).toBeGreaterThan(200);
    const oneway = rings.filter((e) => e.flags & (FLAG.oneway | FLAG.onewayRev));
    expect(oneway.length / rings.length).toBeGreaterThan(0.97);
    let entries = 0;
    let ok = 0;
    for (const e of graph.edges) {
      if (e.flags & FLAG.roundabout) continue;
      for (const d of [1, -1] as const) {
        if (!graph.allowed(e.id, d)) continue;
        const end = graph.endNode(e.id, d);
        if (!graph.edgesAt(end).some((id) => graph.isRing(id))) continue;
        entries++;
        const ex = graph.roundaboutExits(e.id, d);
        if (ex && ex.length >= 2) ok++;
      }
    }
    expect(entries).toBeGreaterThan(300);
    expect(ok / entries).toBeGreaterThan(0.9);
  });

  it('semafori, strisce e luoghi stanno sul grafo', () => {
    expect(features.signals.length).toBeGreaterThan(100);
    for (const s of features.signals) {
      expect(s.edge).toBeGreaterThanOrEqual(0);
      expect(s.edge).toBeLessThan(graph.edges.length);
      if (s.node >= 0) expect(s.node).toBeLessThan(graph.nodeCount);
    }
    expect(features.marks.crossings.length).toBeGreaterThan(500);
    for (const c of features.marks.crossings) expect(c.s).toBeLessThanOrEqual(graph.edges[c.edge].length + 0.1);
    expect(features.pois.length).toBeGreaterThan(500);
    const ids = new Set(features.pois.map((p) => p.id));
    expect(ids.size).toBe(features.pois.length);
    for (const p of features.pois) expect(p.edge).toBeLessThan(graph.edges.length);
    expect(features.pois.some((p) => p.kind === 'fontanella')).toBe(true);
    expect(features.pois.some((p) => p.kind === 'belvedere')).toBe(true);
  });
});
