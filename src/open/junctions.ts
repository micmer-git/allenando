import { wrap } from '@/domain/geo';
import { CLS, FLAG, type Edge, type WorldGraph } from './graph';

/*
 * L'innesto degli incroci (piano OROBIA 07/11, M.3 e M.4). Solo geometria, senza three.js: la
 * disegna tiles.ts.
 *
 * Prima ogni nastro arrivava squadrato fino al nodo: ai nodi con tre o più strade le teste si
 * sovrapponevano alla stessa quota (sfarfallio fra due strade della stessa classe), la banchina di
 * una tagliava l'asfalto dell'altra, e fra due nastri che si piegano restava un cuneo di terreno
 * scoperto. Qui:
 *
 * - ai nodi con 3+ strade la superficie dell'incrocio è un poligono unico: i nastri si tagliano a
 *   `cut` metri dal nodo, e fra un nastro e l'altro il bordo è un raccordo d'angolo ad arco di
 *   cerchio (raggio per classe, 3–6 m), oppure un segmento dritto dove l'angolo è piatto o
 *   rientrante. Il poligono sta un paio di centimetri sopra tutti i nastri, le cui teste finiscono
 *   sotto, come già fa l'anello delle rotatorie; i cordoli seguono il bordo del poligono;
 * - ai nodi con 2 strade (cambio di nome, di classe, ponte↔strada) le due teste si tagliano sulla
 *   bisettrice: nessun cuneo scoperto, nessuna sovrapposizione (`mitreAt`).
 *
 * Convenzione come nel resto del mondo aperto: per una direzione h avanti è (sin h, cos h) su
 * (x, z) e il lato sinistro è L = (cos h, −sin h).
 */

/** Raggio del raccordo d'angolo per classe di strada (il minore delle due strade che si incontrano). */
export function filletRadius(cls: number): number {
  if (cls <= CLS.secondary) return 6;
  if (cls <= CLS.unclassified) return 4.5;
  return 3;
}

/** Quanto può sporgere il taglio di un nastro dal nodo, metri. */
const CUT_MAX = 22;
/** Un raccordo non si spinge oltre tanto dal suo spigolo (angoli molto acuti). */
const TANGENT_MAX = 12;

export interface JunctionVertex {
  x: number;
  z: number;
  /** quota dell'asfalto in questo punto (senza il sollevamento) */
  y: number;
  /** quota a metà strada fra il nodo e questo punto */
  yh: number;
}

export interface JunctionCurb {
  pts: { x: number; y: number; z: number; ox: number; oz: number }[];
}

export interface JunctionArm {
  edge: number;
  atA: boolean;
  /** direzione in pianta dal nodo verso fuori */
  ux: number;
  uz: number;
  hw: number;
  cls: number;
  /** da qui (metri dal nodo lungo l'arco) il nastro ha di nuovo banchine, cordoli e segni */
  cut: number;
}

export interface JunctionGeo {
  node: number;
  cx: number;
  cz: number;
  cy: number;
  /** classe più importante fra le strade del nodo */
  cls: number;
  /** tutte le strade del nodo sono in pietra o pedonali */
  stone: boolean;
  arms: JunctionArm[];
  /** il bordo del poligono, in ordine intorno al nodo (chiuso: l'ultimo si ricongiunge al primo) */
  ring: JunctionVertex[];
  /** i tratti del bordo che non sono il taglio di un nastro: lì va il cordolo */
  curbs: JunctionCurb[];
}

interface Index {
  geo: Map<number, JunctionGeo | null>;
  cut: Map<string, number>;
}

const cache = new WeakMap<WorldGraph, Index>();

function index(graph: WorldGraph): Index {
  let have = cache.get(graph);
  if (!have) {
    have = { geo: new Map(), cut: new Map() };
    cache.set(graph, have);
  }
  return have;
}

/** La direzione in pianta con cui l'arco lascia il nodo (verso fuori). */
function awayHeading(graph: WorldGraph, e: Edge, atA: boolean): number {
  return atA ? graph.pose(e.id, 0, 1).heading : graph.pose(e.id, e.length, -1).heading;
}

/**
 * Il taglio del nastro `edge` al nodo `node`: metri dal nodo oltre i quali il nastro riprende i
 * suoi bordi. 0 se il nodo non ha un innesto (meno di tre strade, rotatoria, galleria).
 */
export function junctionCut(graph: WorldGraph, node: number, edge: number): number {
  const ix = index(graph);
  const k = `${node}:${edge}`;
  const have = ix.cut.get(k);
  if (have !== undefined) return have;
  const g = junctionAt(graph, node);
  const v = g?.arms.find((a) => a.edge === edge)?.cut ?? 0;
  ix.cut.set(k, v);
  return v;
}

/**
 * Ai nodi con due sole strade le teste dei nastri si tagliano sulla bisettrice: la direzione del
 * taglio e di quanto allargare la sezione (1 / cos(Δ/2), al più 1,6) perché i bordi combacino.
 * Null dove non serve (nodo con una o tre+ strade, gallerie, rotatorie, strade dritte).
 */
export function mitreAt(graph: WorldGraph, edge: number, atA: boolean): { h: number; w: number } | null {
  const e = graph.edges[edge];
  if (e.flags & (FLAG.tunnel | FLAG.roundabout)) return null;
  const node = atA ? e.a : e.b;
  if (graph.adjStart[node + 1] - graph.adjStart[node] !== 2) return null;
  let other = -1;
  for (let i = graph.adjStart[node]; i < graph.adjStart[node + 1]; i++) if (graph.adjEdges[i] !== edge) other = graph.adjEdges[i];
  if (other < 0) return null;
  const f = graph.edges[other];
  if (f.flags & (FLAG.tunnel | FLAG.roundabout) || f.a === f.b || e.a === e.b) return null;
  // nel verso di chi percorre e fino al nodo e prosegue su f
  const h1 = atA ? graph.pose(e.id, 0, -1).heading : graph.pose(e.id, e.length, 1).heading;
  const h2 = awayHeading(graph, f, f.a === node);
  const d = wrap(h2 - h1);
  if (Math.abs(d) < 0.01) return null;
  const w = Math.min(1.6, 1 / Math.max(0.3, Math.cos(d / 2)));
  // la direzione va resa nel verso con cui tiles.ts campiona il nastro (da a verso b)
  const h = wrap(h1 + d / 2);
  return { h: atA ? wrap(h + Math.PI) : h, w };
}

interface Arm extends JunctionArm {
  th: number;
  /** sinistra del nastro, vista da chi esce dal nodo */
  lx: number;
  lz: number;
  /** tangenti dei raccordi sui due bordi: distanza dal nodo lungo il nastro (sinistra, destra) */
  tanL: number;
  tanR: number;
}

/** La geometria dell'incrocio al nodo, o null se il nodo non ne ha una (si calcola una volta). */
export function junctionAt(graph: WorldGraph, node: number): JunctionGeo | null {
  const ix = index(graph);
  if (ix.geo.has(node)) return ix.geo.get(node)!;
  const g = buildJunction(graph, node);
  ix.geo.set(node, g);
  return g;
}

function buildJunction(graph: WorldGraph, node: number): JunctionGeo | null {
  const ids = graph.edgesAt(node);
  if (ids.length < 3) return null;
  const arms: Arm[] = [];
  let cls = 7;
  let stone = true;
  for (const id of ids) {
    const e = graph.edges[id];
    if (e.flags & (FLAG.tunnel | FLAG.roundabout) || e.a === e.b || e.length < 1) return null;
    // un arco che tocca il nodo da entrambi i capi non esiste (a === b escluso): un braccio per arco
    const atA = e.a === node;
    const h = awayHeading(graph, e, atA);
    const ux = Math.sin(h);
    const uz = Math.cos(h);
    arms.push({ edge: id, atA, ux, uz, hw: e.hw, cls: e.cls, cut: 0, th: Math.atan2(uz, ux), lx: Math.cos(h), lz: -Math.sin(h), tanL: 0, tanR: 0 });
    cls = Math.min(cls, e.cls);
    if (!(e.flags & FLAG.cobbles) && e.cls !== CLS.pedestrian && e.cls !== CLS.cycleway) stone = false;
  }
  arms.sort((p, q) => p.th - q.th);
  const cx = graph.nodeX[node];
  const cz = graph.nodeZ[node];
  const cy = graph.nodeY[node];
  const n = arms.length;
  const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;
  interface Wedge {
    /** il raccordo: centro, raggio, tangenti (distanze dal nodo lungo i due nastri) */
    fx: number;
    fz: number;
    r: number;
    ti: number;
    tj: number;
    /** l'angolo fra i due nastri, radianti (< π: spigolo da raccordare) */
    alpha: number;
  }
  const wedges: (Wedge | null)[] = [];
  for (let i = 0; i < n; i++) {
    const A = arms[i];
    const B = arms[(i + 1) % n];
    let alpha = B.th - A.th;
    if (i === n - 1) alpha += Math.PI * 2;
    if (alpha < 0) alpha += Math.PI * 2;
    // il bordo destro di A (−L) e il sinistro di B (+L) chiudono questo spicchio
    const ax = cx - A.lx * A.hw;
    const az = cz - A.lz * A.hw;
    const bx = cx + B.lx * B.hw;
    const bz = cz + B.lz * B.hw;
    const den = cross(A.ux, A.uz, B.ux, B.uz);
    if (alpha >= Math.PI - 0.06 || Math.abs(den) < 1e-6) {
      wedges.push(null);
      continue;
    }
    const t1 = cross(bx - ax, bz - az, B.ux, B.uz) / den;
    const t2 = cross(bx - ax, bz - az, A.ux, A.uz) / den;
    // lo spigolo: dove i due bordi si incontrano
    const sx = ax + A.ux * t1;
    const sz = az + A.uz * t1;
    let r = Math.min(filletRadius(A.cls), filletRadius(B.cls));
    let dT = r / Math.tan(alpha / 2);
    if (dT > TANGENT_MAX) {
      dT = TANGENT_MAX;
      r = dT * Math.tan(alpha / 2);
    }
    const ti = t1 + dT;
    const tj = t2 + dT;
    const limA = Math.min(CUT_MAX, graph.edges[A.edge].length / 2 - 0.3);
    const limB = Math.min(CUT_MAX, graph.edges[B.edge].length / 2 - 0.3);
    if (ti > limA || tj > limB) {
      // il nastro è corto o lo spigolo è lontano: raccordo più piccolo, o niente
      const room = Math.min(limA - t1, limB - t2);
      if (room < 0.4) {
        wedges.push(null);
        continue;
      }
      dT = room;
      r = dT * Math.tan(alpha / 2);
    }
    if (t1 + dT < 0.3 || t2 + dT < 0.3) {
      wedges.push(null);
      continue;
    }
    // il centro del raccordo sta sulla bisettrice dello spigolo, fuori dall'asfalto
    const bxn = A.ux + B.ux;
    const bzn = A.uz + B.uz;
    const bl = Math.hypot(bxn, bzn) || 1;
    const dist = r / Math.sin(alpha / 2);
    wedges.push({ fx: sx + (bxn / bl) * dist, fz: sz + (bzn / bl) * dist, r, ti: t1 + dT, tj: t2 + dT, alpha });
  }
  // il taglio di ogni nastro: oltre le tangenti dei suoi raccordi e oltre la testa delle altre strade
  for (let i = 0; i < n; i++) {
    const A = arms[i];
    const left = wedges[(i - 1 + n) % n];
    const right = wedges[i];
    A.tanL = left ? left.tj : 0;
    A.tanR = right ? right.ti : 0;
    let other = 0;
    for (const B of arms) if (B !== A) other = Math.max(other, B.hw);
    const lim = Math.min(CUT_MAX, graph.edges[A.edge].length / 2 - 0.1);
    A.cut = Math.min(lim, Math.max(A.tanL + 0.3, A.tanR + 0.3, other + 1));
  }
  const yAlong = (A: Arm, t: number) => {
    const e = graph.edges[A.edge];
    const s = Math.min(e.length, Math.max(0, t));
    return graph.pose(e.id, A.atA ? s : e.length - s, 1).y;
  };
  const ring: JunctionVertex[] = [];
  const curbs: JunctionCurb[] = [];
  const vtx = (x: number, z: number, y: number, yh: number): JunctionVertex => ({ x, z, y, yh });
  for (let i = 0; i < n; i++) {
    const A = arms[i];
    const B = arms[(i + 1) % n];
    const w = wedges[i];
    // il taglio del nastro A: a sinistra, poi a destra (si gira nel verso degli angoli crescenti)
    const yc = yAlong(A, A.cut);
    const yc2 = yAlong(A, A.cut / 2);
    ring.push(vtx(cx + A.ux * A.cut + A.lx * A.hw, cz + A.uz * A.cut + A.lz * A.hw, yc, yc2));
    ring.push(vtx(cx + A.ux * A.cut - A.lx * A.hw, cz + A.uz * A.cut - A.lz * A.hw, yc, yc2));
    const curb: JunctionCurb = { pts: [] };
    const push = (x: number, z: number, y: number, yh: number, ox: number, oz: number) => {
      ring.push(vtx(x, z, y, yh));
      curb.pts.push({ x, y, z, ox, oz });
    };
    // dal taglio di A alla sua tangente, lungo il bordo destro di A
    const nAx = -A.lx;
    const nAz = -A.lz;
    curb.pts.push({ x: cx + A.ux * A.cut + nAx * A.hw, y: yc, z: cz + A.uz * A.cut + nAz * A.hw, ox: nAx, oz: nAz });
    if (w) {
      const yi = yAlong(A, w.ti);
      const yj = yAlong(B, w.tj);
      const yi2 = yAlong(A, w.ti / 2);
      const yj2 = yAlong(B, w.tj / 2);
      if (w.ti < A.cut - 0.05) push(cx + A.ux * w.ti + nAx * A.hw, cz + A.uz * w.ti + nAz * A.hw, yi, yi2, nAx, nAz);
      // l'arco del raccordo, dalla tangente su A a quella su B, intorno al centro f
      const px = cx + A.ux * w.ti + nAx * A.hw;
      const pz = cz + A.uz * w.ti + nAz * A.hw;
      const qx = cx + B.ux * w.tj + B.lx * B.hw;
      const qz = cz + B.uz * w.tj + B.lz * B.hw;
      const a0 = Math.atan2(pz - w.fz, px - w.fx);
      let da = Math.atan2(qz - w.fz, qx - w.fx) - a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const steps = Math.max(2, Math.ceil((Math.abs(da) * w.r) / 1.2));
      for (let k = 1; k < steps; k++) {
        const u = k / steps;
        const ang = a0 + da * u;
        const x = w.fx + Math.cos(ang) * w.r;
        const z = w.fz + Math.sin(ang) * w.r;
        // il fuori è verso il centro del raccordo
        push(x, z, yi + (yj - yi) * u, yi2 + (yj2 - yi2) * u, (w.fx - x) / w.r, (w.fz - z) / w.r);
      }
      push(qx, qz, yj, yj2, B.lx, B.lz);
      if (w.tj < B.cut - 0.05) curb.pts.push({ x: cx + B.ux * B.cut + B.lx * B.hw, y: yAlong(B, B.cut), z: cz + B.uz * B.cut + B.lz * B.hw, ox: B.lx, oz: B.lz });
    } else {
      // angolo piatto o rientrante: le due teste dei nastri, così il cuneo fra loro è coperto
      const hx = cx + nAx * A.hw;
      const hz = cz + nAz * A.hw;
      const kx = cx + B.lx * B.hw;
      const kz = cz + B.lz * B.hw;
      // fuori: perpendicolare alla corda fra le due teste, dalla parte opposta al nodo
      let ox = -(kz - hz);
      let oz = kx - hx;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol;
      oz /= ol;
      if (ox * (hx - cx) + oz * (hz - cz) < 0) {
        ox = -ox;
        oz = -oz;
      }
      push(hx, hz, cy, cy, ox, oz);
      push(kx, kz, cy, cy, ox, oz);
      curb.pts.push({ x: cx + B.ux * B.cut + B.lx * B.hw, y: yAlong(B, B.cut), z: cz + B.uz * B.cut + B.lz * B.hw, ox: B.lx, oz: B.lz });
    }
    curbs.push(curb);
  }
  const out: JunctionGeo = { node, cx, cz, cy, cls, stone, arms: arms.map(({ edge, atA, ux, uz, hw, cls: c, cut }) => ({ edge, atA, ux, uz, hw, cls: c, cut })), ring, curbs };
  return out;
}

/** Gli incroci con innesto il cui nodo cade nel rettangolo. */
export function junctionsIn(graph: WorldGraph, edgeIds: Iterable<number>, x0: number, z0: number, x1: number, z1: number): JunctionGeo[] {
  const nodes = new Set<number>();
  for (const id of edgeIds) {
    const e = graph.edges[id];
    nodes.add(e.a);
    nodes.add(e.b);
  }
  const out: JunctionGeo[] = [];
  for (const node of nodes) {
    const x = graph.nodeX[node];
    const z = graph.nodeZ[node];
    if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
    const g = junctionAt(graph, node);
    if (g) out.push(g);
  }
  return out;
}
