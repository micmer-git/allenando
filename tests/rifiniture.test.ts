import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLS, FLAG, WorldGraph, type WorldGraphFile } from '../src/open/graph';
import { crossingClearance, lowerWaterAt, planCrossings, WATER_RAMP, WATER_UNDER_DECK, WATER_UNDER_ROAD } from '../src/open/crossings';
import { deeperProbe, fitRingToRoads, junctionProbe, PASSAGE_H, ringPenetration, type JunctionShape, type RoadProbe } from '../src/open/footprints';
import { junctionAt, junctionCut, mitreAt } from '../src/open/junctions';
import { GRADE_WINDOW_M, WorldPath } from '../src/open/path';
import { createWorldField } from '../src/open/field';
import { decodeFeatures, type RideDef, type Terrain } from '../src/open/world';
import { runsInside } from '../src/open/tiles';

/*
 * Le rifiniture del mondo 3D (piano OROBIA 07/11, pista M): ponti con la luce (M.1), case fuori
 * dalla carreggiata e dall’asfalto degli incroci (M.2), innesto degli incroci (M.3), nastri continui
 * (M.4), il «%» dell'HUD (M.6), niente alberi sotto i ponti e l’acqua sotto le strade (M.8). Grafi piccoli disegnati qui, più il mondo vero.
 */

type P = [number, number];

function graphOf(nodes: (P | [number, number, number])[], edges: { a: number; b: number; flags?: number; cls?: number; hw?: number; via?: P[] }[]): WorldGraph {
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
    builtAt: '2026-11-07',
    attribution: '',
    names: [''],
    nodes: nodes.flatMap(([x, z, y = 0]) => [dm(x), dm(z), dm(y)]),
    edges: edges.map((e) => {
      const pts: P[] = [[nodes[e.a][0], nodes[e.a][1]], ...(e.via ?? []), [nodes[e.b][0], nodes[e.b][1]]];
      const ya = nodes[e.a][2] ?? 0;
      const yb = nodes[e.b][2] ?? 0;
      const coords: number[] = [];
      let px = 0;
      let pz = 0;
      let py = 0;
      pts.forEach(([x, z], i) => {
        const y = dm(ya + ((yb - ya) * i) / (pts.length - 1));
        coords.push(dm(x) - px, dm(z) - pz, y - py);
        px = dm(x);
        pz = dm(z);
        py = y;
      });
      return [e.a, e.b, 0, 0, e.cls ?? 3, e.flags ?? 0, dm(e.hw ?? 3), coords];
    }),
  };
  return new WorldGraph(file);
}

const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];

const inRing = (ring: { x: number; z: number }[], x: number, z: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};

describe('ponti e sottopassi (M.1)', () => {
  it('un ponte sopra una strada vuole 6,1 m, una strada sopra una galleria ciclabile la volta più il guscio', () => {
    const road = { flags: 0, hw: 3, cls: CLS.tertiary };
    const bridge = { flags: FLAG.bridge, hw: 3.6, cls: CLS.primary };
    const tube = { flags: FLAG.tunnel, hw: 1.3, cls: CLS.cycleway };
    expect(crossingClearance(bridge, road)).toMatchObject({ upper: 0, need: 6.1, moveUpper: 1 });
    expect(crossingClearance(road, bridge)).toMatchObject({ upper: 1, need: 6.1 });
    const c = crossingClearance(road, tube)!;
    expect(c.upper).toBe(0);
    expect(c.moveUpper).toBe(0);
    expect(c.need).toBeGreaterThan(4);
    expect(c.need).toBeLessThan(5.5);
    expect(crossingClearance(road, road)).toBeNull();
  });

  it('due piante che si attraversano si trovano, due che si toccano in un nodo no', () => {
    const g = graphOf(
      [
        [-100, 0],
        [100, 0],
        [0, -100],
        [0, 100],
        [100, 100],
      ],
      [
        { a: 0, b: 1 },
        { a: 2, b: 3 },
        { a: 1, b: 4 },
      ],
    );
    const x = planCrossings(g.edges.map((e) => ({ xs: e.xs, zs: e.zs, a: e.a, b: e.b })));
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ i: 0, j: 1 });
    expect(x[0].x).toBeCloseTo(0, 5);
    expect(x[0].si).toBeCloseTo(100, 5);
  });

  it('nel mondo vero nessun ponte o galleria incrocia un’altra strada senza la luce', () => {
    const crossings = planCrossings(graph.edges.map((e) => ({ xs: e.xs, zs: e.zs, a: e.a, b: e.b })));
    expect(crossings.length).toBeGreaterThan(150);
    const yAt = (e: (typeof graph.edges)[number], s: number) => graph.pose(e.id, s).y;
    const tight: string[] = [];
    let judged = 0;
    for (const c of crossings) {
      const a = graph.edges[c.i];
      const b = graph.edges[c.j];
      const cl = crossingClearance(a, b);
      if (!cl) continue;
      judged++;
      const up = cl.upper === 0 ? yAt(a, c.si) : yAt(b, c.sj);
      const low = cl.upper === 0 ? yAt(b, c.sj) : yAt(a, c.si);
      // separate nell'altro verso con la montagna in mezzo (la Galleria Lovere sopra la SS671): va bene così
      if (up - low <= -cl.need) continue;
      if (up - low < cl.need - 0.3) tight.push(`${a.id} ${a.name || a.ref} × ${b.id} ${b.name || b.ref}: ${(up - low).toFixed(1)} m su ${cl.need.toFixed(1)}`);
    }
    expect(judged).toBeGreaterThan(100);
    expect(tight).toEqual([]);
  }, 60000);

  it('a Gazzaniga la SS671 passa sopra Piazzale Costituzione e il sottopasso ciclabile sotto la statale', () => {
    const ss = graph.edges.find((e) => e.id === 11625)!;
    const piazzale = graph.edges.find((e) => e.id === 6928)!;
    expect(ss.flags & FLAG.bridge).toBeTruthy();
    expect(ss.name).toContain('Val Seriana');
    expect(piazzale.name).toBe('Piazzale Costituzione');
    const deck = graph.pose(ss.id, ss.length / 2).y;
    const under = graph.pose(piazzale.id, 18).y;
    expect(deck - under).toBeGreaterThan(5.8);
    const tube = graph.edges[11439];
    expect(tube.flags & FLAG.tunnel).toBeTruthy();
    const road = graph.edges[3789];
    expect(graph.pose(road.id, 740).y - graph.pose(tube.id, tube.length / 2).y).toBeGreaterThan(4);
  });
});

describe('case fuori dalla carreggiata (M.2)', () => {
  const straight: RoadProbe = (x, z) => (Math.abs(z) > 20 ? null : { hw: 3, d: Math.abs(z), px: x, pz: 0, heading: Math.PI / 2, edge: 0 });

  it('un morso piccolo sposta la casa, uno grande la ritaglia, una strada che passa dentro la fa voltata', () => {
    const near: P[] = [
      [0, 2.5],
      [10, 2.5],
      [10, 12],
      [0, 12],
    ];
    const s = fitRingToRoads(near, 7, 0, straight);
    expect(s.action).toBe('spostata');
    expect(ringPenetration(s.ring, straight).max).toBeLessThan(0.02);
    expect(Math.min(...s.ring.map((p) => p[1]))).toBeGreaterThan(3.8);
    const deep: P[] = [
      [0, 0.5],
      [10, 0.5],
      [10, 12],
      [0, 12],
    ];
    const r = fitRingToRoads(deep, 7, 0, straight);
    expect(r.action).toBe('ritagliata');
    expect(ringPenetration(r.ring, straight).max).toBeLessThan(0.02);
    expect(Math.max(...r.ring.map((p) => p[1]))).toBeCloseTo(12, 1);
    const across: P[] = [
      [0, -6],
      [10, -6],
      [10, 6],
      [0, 6],
    ];
    expect(fitRingToRoads(across, 9, 0, straight).action).toBe('passaggio');
    expect(fitRingToRoads(across, 9, 0, straight).minH).toBe(PASSAGE_H);
    expect(fitRingToRoads(across, 4, 0, straight).action).toBe('tolta');
    const far: P[] = [
      [0, 30],
      [10, 30],
      [10, 40],
      [0, 40],
    ];
    expect(fitRingToRoads(far, 7, 0, straight).action).toBe('ferma');
  });

  it('una casa nel raccordo d’angolo di un incrocio esce dall’asfalto', () => {
    const g = graphOf(
      [
        [-300, 0],
        [0, 0],
        [300, 0],
        [0, 300],
      ],
      [
        { a: 0, b: 1, cls: CLS.secondary, hw: 3.2 },
        { a: 1, b: 2, cls: CLS.secondary, hw: 3.2 },
        { a: 3, b: 1, cls: CLS.secondary, hw: 3.2 },
      ],
    );
    const j = junctionAt(g, 1)!;
    const center: RoadProbe = (x, z) => {
      const hit = g.nearestBorder(x, z, 12);
      if (!hit) return null;
      const p = g.pose(hit.edge, hit.s);
      return { hw: g.edges[hit.edge].hw, d: hit.d, px: p.x, pz: p.z, heading: p.heading, edge: hit.edge };
    };
    const probe = deeperProbe(center, junctionProbe([{ cx: j.cx, cz: j.cz, ring: j.ring }]));
    // l'angolo sud-est: fuori dalla fascia dei due nastri (4 m dalle mezzerie), dentro il raccordo da 6 m
    const corner: P[] = [
      [4.3, 4.3],
      [14, 4.3],
      [14, 14],
      [4.3, 14],
    ];
    expect(ringPenetration(corner, center).max).toBeLessThan(0);
    expect(ringPenetration(corner, probe).max).toBeGreaterThan(0.5);
    const fit = fitRingToRoads(corner, 7, 0, probe);
    expect(['spostata', 'ritagliata']).toContain(fit.action);
    expect(ringPenetration(fit.ring, probe).max).toBeLessThanOrEqual(0.05);
  });

  it('nel mondo vero nessuna impronta entra nella fascia della strada né nell’asfalto di un incrocio', () => {
    const center: RoadProbe = (x, z) => {
      const hit = graph.nearestBorder(x, z, 12, (e) => !(e.flags & FLAG.tunnel));
      if (!hit) return null;
      const p = graph.pose(hit.edge, hit.s);
      return { hw: graph.edges[hit.edge].hw, d: hit.d, px: p.x, pz: p.z, heading: p.heading, edge: hit.edge };
    };
    // gli incroci sui ponti non contano, come i ponti (sotto un viadotto la casa ci sta)
    const shapes: JunctionShape[] = [];
    for (let n = 0; n < graph.nodeCount; n++) {
      if (graph.edgesAt(n).length < 3) continue;
      const j = junctionAt(graph, n);
      if (!j || j.arms.some((a) => graph.edges[a.edge].flags & FLAG.bridge)) continue;
      shapes.push({ cx: j.cx, cz: j.cz, ring: j.ring });
    }
    expect(shapes.length).toBeGreaterThan(10000);
    const probe = deeperProbe(center, junctionProbe(shapes));
    let buildings = 0;
    let passages = 0;
    const bad: string[] = [];
    for (const f of readdirSync(join(dir, 'b'))) {
      const t = JSON.parse(readFileSync(join(dir, 'b', f), 'utf8')) as { o: [number, number]; b: number[][] };
      for (const rec of t.b) {
        buildings++;
        const ring: P[] = [];
        let px = 0;
        let pz = 0;
        for (let i = 4; i < rec.length; i += 2) {
          px += rec[i];
          pz += rec[i + 1];
          ring.push([t.o[0] + px / 10, t.o[1] + pz / 10]);
        }
        if (rec[2] / 10 >= PASSAGE_H - 0.5) {
          passages++;
          continue;
        }
        // un punto al metro: lo spigolo di un incrocio entra anche fra due punti a 2 m
        const pen = ringPenetration(ring, probe, undefined, 1);
        // un viadotto alto sopra la casa non conta: la casa gli sta sotto. Il margine: i vertici
        // sono scritti in decimetri e una corda fra due punti rientra di qualche centimetro in curva
        if (pen.max <= 0.15) continue;
        const at = `${f} ${ring[0].map((v) => v.toFixed(0))}: ${pen.max.toFixed(2)} m`;
        if (pen.edge < 0) bad.push(`${at} nell’incrocio a ${shapes[-1 - pen.edge].cx.toFixed(0)},${shapes[-1 - pen.edge].cz.toFixed(0)}`);
        else if (!(graph.edges[pen.edge].flags & FLAG.bridge)) bad.push(`${at} in ${graph.edges[pen.edge].name}`);
      }
    }
    expect(buildings).toBeGreaterThan(100000);
    expect(passages).toBeGreaterThan(50);
    expect(bad.length, bad.slice(0, 20).join('\n')).toBe(0);
  }, 180000);
});

describe('innesto degli incroci (M.3)', () => {
  // una T: la provinciale da ovest a est, la comunale che arriva da sud
  const tee = () =>
    graphOf(
      [
        [-300, 0],
        [0, 0],
        [300, 0],
        [0, 300],
      ],
      [
        { a: 0, b: 1, cls: CLS.secondary, hw: 3.2 },
        { a: 1, b: 2, cls: CLS.secondary, hw: 3.2 },
        { a: 3, b: 1, cls: CLS.residential, hw: 2.8 },
      ],
    );

  it('alla T la superficie è un poligono unico coi raccordi, che copre le teste dei nastri', () => {
    const g = tee();
    const j = junctionAt(g, 1)!;
    expect(j).not.toBeNull();
    expect(j.arms).toHaveLength(3);
    // ogni nastro è tagliato oltre la testa delle altre strade e non oltre 22 m
    for (const a of j.arms) {
      expect(a.cut).toBeGreaterThan(3.2);
      expect(a.cut).toBeLessThanOrEqual(22);
      expect(junctionCut(g, 1, a.edge)).toBe(a.cut);
    }
    // due raccordi (sud-ovest e sud-est) ad arco, nessuno sul lato nord dove la strada è dritta
    expect(j.ring.length).toBeGreaterThan(12);
    for (const v of j.ring) expect(Number.isFinite(v.x + v.z + v.y + v.yh)).toBe(true);
    // il poligono è a stella intorno al nodo: gli angoli dei vertici crescono
    let turns = 0;
    for (let i = 0; i < j.ring.length; i++) {
      const a = j.ring[i];
      const b = j.ring[(i + 1) % j.ring.length];
      let d = Math.atan2(b.z - j.cz, b.x - j.cx) - Math.atan2(a.z - j.cz, a.x - j.cx);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (d < -1e-6) turns++;
    }
    expect(turns).toBe(0);
    // le teste squadrate dei tre nastri stanno dentro il poligono
    for (const a of j.arms) {
      const lx = Math.cos(Math.atan2(a.ux, a.uz));
      const lz = -Math.sin(Math.atan2(a.ux, a.uz));
      expect(inRing(j.ring, j.cx + lx * a.hw * 0.98, j.cz + lz * a.hw * 0.98)).toBe(true);
      expect(inRing(j.ring, j.cx - lx * a.hw * 0.98, j.cz - lz * a.hw * 0.98)).toBe(true);
    }
    // i raccordi stanno fuori da entrambi i nastri: il bordo si allarga, non si stringe
    const farthest = Math.max(...j.ring.map((v) => Math.hypot(v.x - j.cx, v.z - j.cz)));
    expect(farthest).toBeGreaterThan(5);
    // il cordolo segue il bordo fra un taglio e l'altro: tre tratti
    expect(j.curbs).toHaveLength(3);
    for (const c of j.curbs) expect(c.pts.length).toBeGreaterThanOrEqual(2);
  });

  it('niente innesto ai nodi di due strade, alle rotatorie e alle gallerie', () => {
    const g = graphOf(
      [
        [-300, 0],
        [0, 0],
        [300, 0],
        [0, 300],
      ],
      [
        { a: 0, b: 1 },
        { a: 1, b: 2 },
        { a: 3, b: 1, flags: FLAG.tunnel },
      ],
    );
    expect(junctionAt(g, 1)).toBeNull();
    expect(junctionAt(g, 0)).toBeNull();
    expect(junctionCut(g, 0, 0)).toBe(0);
  });

  it('nel mondo vero ogni incrocio di tre o più strade (fuori da rotatorie e gallerie) ha il suo innesto, con numeri sani', () => {
    let nodes = 0;
    let built = 0;
    for (let n = 0; n < graph.nodeCount; n++) {
      const ids = graph.edgesAt(n);
      if (ids.length < 3) continue;
      if (ids.some((id) => graph.edges[id].flags & (FLAG.roundabout | FLAG.tunnel) || graph.edges[id].a === graph.edges[id].b || graph.edges[id].length < 1)) continue;
      nodes++;
      const j = junctionAt(graph, n);
      if (!j) continue;
      built++;
      for (const v of j.ring) if (!Number.isFinite(v.x + v.z + v.y + v.yh)) throw new Error(`nodo ${n}: vertice non finito`);
      for (const a of j.arms) if (!(a.cut > 0 && a.cut <= 22)) throw new Error(`nodo ${n}: taglio ${a.cut}`);
    }
    expect(nodes).toBeGreaterThan(10000);
    expect(built).toBe(nodes);
  }, 60000);
});

describe('nastri continui (M.4)', () => {
  it('a un nodo di due strade che si piegano le teste si tagliano sulla bisettrice e combaciano', () => {
    const g = graphOf(
      [
        [-200, 0],
        [0, 0],
        [150, 150],
      ],
      [
        { a: 0, b: 1, hw: 3 },
        { a: 1, b: 2, hw: 3 },
      ],
    );
    const mA = mitreAt(g, 0, false)!;
    const mB = mitreAt(g, 1, true)!;
    expect(mA).not.toBeNull();
    expect(mB).not.toBeNull();
    // stessa direzione di taglio e stesso allargamento (1/cos 22,5°)
    expect(Math.abs(mA.h - mB.h)).toBeLessThan(1e-6);
    expect(mA.w).toBeCloseTo(1 / Math.cos(Math.PI / 8), 5);
    // i due nastri, campionati come fa tiles.ts, finiscono e cominciano sugli stessi due spigoli
    const [endA] = runsInside(g, g.edges[0], -1000, -1000, 1000, 1000, 3);
    const [startB] = runsInside(g, g.edges[1], -1000, -1000, 1000, 1000, 3);
    const last = endA[endA.length - 1];
    const first = startB[0];
    const corner = (p: typeof last, side: number) => [p.x + Math.cos(p.h) * (p.w ?? 1) * 3 * side, p.z - Math.sin(p.h) * (p.w ?? 1) * 3 * side];
    for (const side of [1, -1]) {
      const a = corner(last, side);
      const b = corner(first, side);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.02);
    }
    // dritte: niente da tagliare
    const s = graphOf(
      [
        [-200, 0],
        [0, 0],
        [200, 0],
      ],
      [
        { a: 0, b: 1 },
        { a: 1, b: 2 },
      ],
    );
    expect(mitreAt(s, 0, false)).toBeNull();
  });

  it('nel mondo vero a ogni nodo di due strade i due nastri combaciano entro 2 cm e alla stessa quota', () => {
    let nodes = 0;
    let bent = 0;
    let gaps = 0;
    for (let n = 0; n < graph.nodeCount; n++) {
      const ids = graph.edgesAt(n);
      if (ids.length !== 2) continue;
      const [e, f] = ids.map((id) => graph.edges[id]);
      if ((e.flags | f.flags) & (FLAG.tunnel | FLAG.roundabout) || e.a === e.b || f.a === f.b) continue;
      nodes++;
      const atA = e.a === n;
      const fAtA = f.a === n;
      const me = mitreAt(graph, e.id, atA);
      const mf = mitreAt(graph, f.id, fAtA);
      const he = atA ? graph.pose(e.id, 0, 1).heading : graph.pose(e.id, e.length, 1).heading;
      const hf = fAtA ? graph.pose(f.id, 0, 1).heading : graph.pose(f.id, f.length, 1).heading;
      let d = Math.abs(he - hf);
      while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
      if (d > 0.05) bent++;
      if (!me !== !mf) {
        gaps++;
        continue;
      }
      // la quota: i due nastri finiscono sul nodo
      const ye = atA ? e.ys[0] : e.ys[e.ys.length - 1];
      const yf = fAtA ? f.ys[0] : f.ys[f.ys.length - 1];
      if (Math.abs(ye - yf) > 0.02) gaps++;
      if (!me || !mf) continue;
      const hw = Math.min(e.hw, f.hw);
      // il taglio: stessa direzione (a meno del verso) e stesso allargamento
      let dh = Math.abs(me.h - mf.h);
      while (dh > Math.PI) dh = Math.abs(dh - Math.PI * 2);
      if (Math.min(dh, Math.abs(dh - Math.PI)) * hw * me.w > 0.02 || Math.abs(me.w - mf.w) * hw > 0.02) gaps++;
    }
    expect(nodes).toBeGreaterThan(3000);
    // prima: a ogni nodo con una piega le teste squadrate lasciavano un cuneo scoperto
    expect(bent).toBeGreaterThan(1000);
    expect(gaps).toBe(0);
  });

  it('al bordo di una mattonella le due corse condividono il segmento di confine', () => {
    const g = graphOf(
      [
        [-500, 10],
        [500, 10],
      ],
      [{ a: 0, b: 1 }],
    );
    const left = runsInside(g, g.edges[0], -1000, -1000, 0, 1000, 3);
    const right = runsInside(g, g.edges[0], 0, -1000, 1000, 1000, 3);
    const lastLeft = left[0][left[0].length - 1];
    const firstRight = right[0][0];
    expect(lastLeft.x).toBeGreaterThan(0);
    expect(firstRight.x).toBeLessThan(0);
    // ogni corsa ha un punto oltre il confine: gli ultimi due di sinistra sono fra i primi tre di destra
    const head = right[0].slice(0, 3).map((p) => p.d);
    for (const p of left[0].slice(-2)) expect(head).toContain(p.d);
  });
});

describe('il «%» dell’HUD (M.6)', () => {
  it('sulla Val Seriana a Gazzaniga, a 25 km/h, la pendenza mostrata non salta di più di 2 punti al secondo in piano', () => {
    const ride = rides.find((r) => r.id === 'val-seriana')!;
    const [first, ...rest] = ride.legs;
    const path = new WorldPath(graph, { edge: first[0], dir: first[1], s: first[1] > 0 ? 0 : graph.edges[first[0]].length });
    path.appendLegs(rest.map(([edge, dir]) => ({ edge, dir })));
    expect(GRADE_WINDOW_M).toBe(30);
    const v = 25 / 3.6;
    let worst = 0;
    let worstOld = 0;
    let prev = path.poseAt(0).grade;
    // come era prima: la pendenza su ±10 m, dagli stessi punti
    const old = (d: number) => {
      const i = Math.round(d / 2);
      const a = path.points[Math.max(0, i - 5)];
      const b = path.points[Math.min(path.points.length - 1, i + 5)];
      return (b.y - a.y) / (b.distance - a.distance || 1);
    };
    let prevOld = old(0);
    for (let d = v; d < path.length; d += v) {
      const g = path.poseAt(d).grade;
      const go = old(d);
      if (Math.abs(g) < 0.04 && Math.abs(prev) < 0.04) worst = Math.max(worst, Math.abs(g - prev));
      if (Math.abs(go) < 0.04 && Math.abs(prevOld) < 0.04) worstOld = Math.max(worstOld, Math.abs(go - prevOld));
      prev = g;
      prevOld = go;
    }
    // l'HUD mostra una cifra decimale: 2,0 punti è il limite (2,004 si legge 2,0)
    expect(worst).toBeLessThanOrEqual(0.0205);
    expect(worstOld).toBeGreaterThan(worst);
  });
});

describe('l’acqua sotto le strade (M.8)', () => {
  it('sotto un ponte l’acqua scende sotto la trave, con una rampa corta, e lontano resta com’era', () => {
    const xz: P[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= 20; i++) {
      xz.push([i * 30, 0]);
      ys.push(110 - i * 0.3);
    }
    // un ponte con l'asfalto a 108 a 300 m: l'acqua (107) deve stare sotto 108 − 2,2
    const top = 108 - WATER_UNDER_DECK;
    const out = lowerWaterAt(xz, ys, [{ s: 300, top, half: 6 }]);
    expect(out.lowered).toBe(1);
    const at = (s: number) => out.ys[out.xz.findIndex((p) => Math.abs(p[0] - s) < 1e-6)];
    expect(at(300)).toBeCloseTo(top, 5);
    expect(at(294)).toBeCloseTo(top, 5);
    expect(at(306)).toBeCloseTo(top, 5);
    // la rampa al 5%: a 24 m dal bordo della fascia l'acqua è 1,2 m sopra il fondo, a 240 m è di nuovo la sua
    expect(at(270)).toBeCloseTo(Math.min(110 - 9 * 0.3, top + 24 * WATER_RAMP), 5);
    expect(at(240)).toBeCloseTo(110 - 8 * 0.3, 5);
    expect(at(0)).toBe(110);
    expect(at(600)).toBeCloseTo(104, 5);
    // l'acqua non sale mai sopra quella di prima
    for (let i = 0; i < out.xz.length; i++) {
      const s = out.xz[i][0];
      const k = Math.min(19, Math.floor(s / 30));
      expect(out.ys[i]).toBeLessThanOrEqual(ys[k] + ((ys[k + 1] - ys[k]) * (s - k * 30)) / 30 + 1e-9);
    }
    // un ponte alto non tocca niente
    expect(lowerWaterAt(xz, ys, [{ s: 300, top: 120, half: 6 }]).lowered).toBe(0);
  });

  it('nel mondo vero nessun fiume passa sopra l’asfalto né dentro la trave di un ponte', () => {
    const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')));
    const R = features.rivers.length;
    const rivers = features.rivers.map((r) => {
      const xs: number[] = [];
      const zs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < r.pts.length; i += 3) {
        xs.push(r.pts[i]);
        zs.push(r.pts[i + 1]);
        ys.push(r.pts[i + 2]);
      }
      return { xs, zs, ys };
    });
    const lines = [...rivers.map((r, i) => ({ xs: r.xs, zs: r.zs, a: -1 - 2 * i, b: -2 - 2 * i })), ...graph.edges.map((e) => ({ xs: e.xs, zs: e.zs, a: e.a, b: e.b }))];
    let crossings = 0;
    let bridges = 0;
    const wet: string[] = [];
    for (const c of planCrossings(lines)) {
      if (c.i < R === c.j < R) continue;
      const ri = c.i < R ? c.i : c.j;
      const r = rivers[ri];
      const e = graph.edges[(c.i < R ? c.j : c.i) - R];
      const sR = c.i < R ? c.si : c.sj;
      const sE = c.i < R ? c.sj : c.si;
      if (e.flags & FLAG.tunnel) continue;
      crossings++;
      const bridge = (e.flags & FLAG.bridge) !== 0;
      if (bridge) bridges++;
      let acc = 0;
      let k = 0;
      for (; k < r.xs.length - 2; k++) {
        const seg = Math.hypot(r.xs[k + 1] - r.xs[k], r.zs[k + 1] - r.zs[k]);
        if (acc + seg >= sR) break;
        acc += seg;
      }
      const seg = Math.hypot(r.xs[k + 1] - r.xs[k], r.zs[k + 1] - r.zs[k]) || 1;
      const water = r.ys[k] + ((r.ys[k + 1] - r.ys[k]) * (sR - acc)) / seg;
      const road = graph.pose(e.id, sE).y;
      // le quote sono scritte in decimetri: 10 cm di tolleranza
      if (water > road - (bridge ? WATER_UNDER_DECK : WATER_UNDER_ROAD) + 0.1) wet.push(`${features.rivers[ri].name || 'torrente'} × ${e.id} ${e.name || e.ref}: acqua ${water.toFixed(1)}, strada ${road.toFixed(1)}${bridge ? ' (ponte)' : ''}`);
    }
    expect(crossings).toBeGreaterThan(500);
    expect(bridges).toBeGreaterThan(300);
    expect(wet.length, wet.slice(0, 20).join('\n')).toBe(0);
  }, 60000);
});

describe('niente alberi sotto i ponti (M.8)', () => {
  it('il campo sa dove c’è un impalcato', () => {
    const g = graphOf(
      [
        [0, -200, 10],
        [0, 200, 10],
      ],
      [{ a: 0, b: 1, flags: FLAG.bridge, hw: 3 }],
    );
    const terrain = { height: () => 0, cover: () => 0 } as unknown as Terrain;
    const field = createWorldField(g, terrain, decodeFeatures({ rivers: [], lakes: [], peaks: [], places: [], walls: [], rails: [], cables: [], landmarks: [] }));
    expect(field.nearBridge(0, 0)).toBe(true);
    expect(field.nearBridge(4.5, 0)).toBe(true);
    expect(field.nearBridge(12, 0)).toBe(false);
    // il ponte non raccorda il terreno sotto di sé
    expect(field.height(0, 0, 10)).toBe(0);
  });
});
