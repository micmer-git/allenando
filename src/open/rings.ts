import { wrap } from '@/domain/geo';
import { CLS, FLAG, type Edge, type WorldGraph } from './graph';

/*
 * Le rotatorie come si disegnano: un anello solo e liscio invece di tanti archi OSM con le
 * giunte a spigolo, le bocche dei rami raccordate con un arco di cerchio (il cordolo gira,
 * non fa l'angolo retto), il cordolo esterno solo fra una bocca e l'altra, e fra un ingresso e
 * un'uscita vicini l'isola spartitraffico. Solo geometria: la disegnano tiles.ts (asfalto,
 * cordoli, segni) e streets.ts (aiuola, linea e cartello di precedenza).
 *
 * Il bordo dell'anello è r(θ) intorno al centro: i punti OSM, medie su una finestra di qualche
 * metro, campionati ad angolo regolare. Una rotatoria con 6 nodi OSM era un esagono; così è tonda.
 * Se la forma non si lascia descrivere così (anelli a stella, turbo-rotatorie, giri attorno a un
 * isolato) resta `smooth = false` e si disegna arco per arco come prima.
 */

export interface Pt {
  x: number;
  y: number;
  z: number;
}

export interface Fillet {
  /** distanza dal nodo, lungo il ramo, dove il raccordo tocca il bordo del ramo */
  t1: number;
  /** raggio del raccordo */
  r: number;
  /** centro del cerchio del raccordo (fuori dall'asfalto) */
  fx: number;
  fz: number;
  /** tangenza sul bordo esterno dell'anello e sul bordo del ramo */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** l'angolo vivo fra il bordo del ramo e il bordo dell'anello, che il raccordo smussa */
  px: number;
  pz: number;
}

export interface RingBranch {
  edge: number;
  node: number;
  /** il ramo tocca l'anello col suo nodo a */
  atA: boolean;
  hw: number;
  cls: number;
  /** direzione dal nodo verso fuori, in pianta */
  ux: number;
  uz: number;
  /** angolo del nodo intorno al centro */
  th: number;
  /** distanza dal nodo, lungo il ramo, dove la mezzeria esce dal bordo esterno */
  t0: number;
  /** raccordi [sinistra, destra] di chi esce dall'anello lungo il ramo; null dove non c'è */
  fillets: [Fillet | null, Fillet | null];
  /** da qui (metri dal nodo) il ramo ha di nuovo i suoi cordoli, marciapiedi e banchine */
  clear: number;
}

export interface RingGeo {
  cx: number;
  cz: number;
  /** il punto che decide quale mattonella la disegna (la media dei nodi OSM) */
  ox: number;
  oz: number;
  /** semilarghezza della carreggiata dell'anello */
  hw: number;
  /** la classe più importante dell'anello */
  cls: number;
  cobbles: boolean;
  meanR: number;
  edges: number[];
  smooth: boolean;
  /** campioni ad angolo regolare (da −π): raggio della mezzeria e quota */
  n: number;
  rad: Float64Array;
  ys: Float64Array;
  branches: RingBranch[];
  /** tratti del bordo esterno col cordolo, [da, a] in radianti con a > da (a può passare π) */
  curbs: [number, number][];
  /** isole spartitraffico fra un ingresso e un'uscita vicini: anelli chiusi */
  splitters: Pt[][];
  /** i punti OSM in ordine d'angolo, per le rotatorie non lisce */
  pts: Pt[];
}

/**
 * Un gruppo di archi d'anello uniti per nodi. La geometria si calcola la prima volta che serve
 * (la mattonella che la disegna, o un ramo che la tocca): tutte insieme erano 100-300 ms fermi
 * al primo fotogramma.
 */
interface Group {
  edges: Edge[];
  /** dove sta, per decidere quale mattonella la disegna: la media dei nodi, stabile */
  ox: number;
  oz: number;
  geo: RingGeo | null | undefined;
}

interface Index {
  groups: Group[];
  byEdge: Map<number, Group>;
  byNode: Map<number, Group>;
  /** per mattonella del grafo (celle da 250 m): i gruppi che ci cadono */
  cells: Map<string, Group[]>;
}

const cache = new WeakMap<WorldGraph, Index>();
const CELLS = 250;

function index(graph: WorldGraph): Index {
  let have = cache.get(graph);
  if (!have) {
    const groups = groupRings(graph);
    const byEdge = new Map<number, Group>();
    const byNode = new Map<number, Group>();
    const cells = new Map<string, Group[]>();
    for (const g of groups) {
      for (const e of g.edges) {
        byEdge.set(e.id, g);
        byNode.set(e.a, g);
        byNode.set(e.b, g);
      }
      const k = `${Math.floor(g.ox / CELLS)}_${Math.floor(g.oz / CELLS)}`;
      const l = cells.get(k);
      if (l) l.push(g);
      else cells.set(k, [g]);
    }
    have = { groups, byEdge, byNode, cells };
    cache.set(graph, have);
  }
  return have;
}

function geoOf(graph: WorldGraph, g: Group): RingGeo | null {
  if (g.geo === undefined) {
    g.geo = buildRing(graph, g.edges);
    if (g.geo) {
      g.geo.ox = g.ox;
      g.geo.oz = g.oz;
    }
  }
  return g.geo;
}

/** Tutte le rotatorie del grafo (per le prove e le analisi: le calcola tutte). */
export function ringsOf(graph: WorldGraph): RingGeo[] {
  const out: RingGeo[] = [];
  for (const g of index(graph).groups) {
    const r = geoOf(graph, g);
    if (r) out.push(r);
  }
  return out;
}

/** Le rotatorie che spettano al rettangolo [x0, x1) × [z0, z1): ognuna a una mattonella sola. */
export function ringsIn(graph: WorldGraph, x0: number, z0: number, x1: number, z1: number): RingGeo[] {
  const ix = index(graph);
  const out: RingGeo[] = [];
  for (let cx = Math.floor(x0 / CELLS); cx <= Math.floor(x1 / CELLS); cx++) {
    for (let cz = Math.floor(z0 / CELLS); cz <= Math.floor(z1 / CELLS); cz++) {
      for (const g of ix.cells.get(`${cx}_${cz}`) ?? []) {
        if (g.ox < x0 || g.ox >= x1 || g.oz < z0 || g.oz >= z1) continue;
        const r = geoOf(graph, g);
        if (r) out.push(r);
      }
    }
  }
  return out;
}

/** La rotatoria liscia di cui l'arco fa parte, se c'è. */
export function smoothRingOf(graph: WorldGraph, edge: number): RingGeo | null {
  const g = index(graph).byEdge.get(edge);
  const r = g ? geoOf(graph, g) : null;
  return r && r.smooth ? r : null;
}

/** Il ramo di una rotatoria liscia che arriva al nodo a (`atA`) o b dell'arco. */
export function ringBranch(graph: WorldGraph, edge: number, atA: boolean): RingBranch | null {
  const e = graph.edges[edge];
  const g = index(graph).byNode.get(atA ? e.a : e.b);
  if (!g || g.edges.some((r) => r.id === edge)) return null;
  const r = geoOf(graph, g);
  return r?.branches.find((b) => b.edge === edge && b.atA === atA) ?? null;
}

/** Raggio della mezzeria e quota all'angolo th. */
export function ringAt(g: RingGeo, th: number): { r: number; y: number } {
  const f = ((wrap(th) + Math.PI) / (Math.PI * 2)) * g.n;
  const i = Math.floor(f) % g.n;
  const j = (i + 1) % g.n;
  const u = f - Math.floor(f);
  return { r: g.rad[i] + (g.rad[j] - g.rad[i]) * u, y: g.ys[i] + (g.ys[j] - g.ys[i]) * u };
}

/**
 * Dove sta il cordolo del ramo, a `t` metri dal nodo: lo scostamento dalla mezzeria sul lato
 * `side` (0 sinistra, 1 destra di chi esce). Dentro il raccordo il cordolo si allarga.
 */
export function curbOffset(b: RingBranch, side: 0 | 1, t: number): number {
  const f = b.fillets[side];
  if (!f || t >= f.t1) return b.hw;
  const d = Math.min(f.r, f.t1 - t);
  return b.hw + f.r - Math.sqrt(f.r * f.r - d * d);
}

// ---------- costruzione ----------

interface Mouth {
  b: RingBranch;
  /** angoli del bordo della bocca, relativi al nodo: lo = verso gli angoli che scendono */
  lo: number;
  hi: number;
  /** quale raccordo sta dalla parte di lo e di hi */
  sideLo: 0 | 1;
  sideHi: 0 | 1;
}

function groupRings(graph: WorldGraph): Group[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const ringEdges = graph.edges.filter((e) => e.flags & FLAG.roundabout);
  for (const e of ringEdges) {
    if (!parent.has(e.a)) parent.set(e.a, e.a);
    if (!parent.has(e.b)) parent.set(e.b, e.b);
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<number, Edge[]>();
  for (const e of ringEdges) {
    const k = find(e.a);
    const l = groups.get(k);
    if (l) l.push(e);
    else groups.set(k, [e]);
  }
  const out: Group[] = [];
  for (const list of groups.values()) {
    const nodes = new Set<number>();
    for (const e of list) {
      nodes.add(e.a);
      nodes.add(e.b);
    }
    let ox = 0;
    let oz = 0;
    for (const n of nodes) {
      ox += graph.nodeX[n];
      oz += graph.nodeZ[n];
    }
    out.push({ edges: list, ox: ox / nodes.size, oz: oz / nodes.size, geo: undefined });
  }
  return out;
}

function buildRing(graph: WorldGraph, list: Edge[]): RingGeo | null {
  const pts: Pt[] = [];
  let hw = 0;
  let cls: number = CLS.cycleway;
  let cobbles = false;
  for (const e of list) {
    hw = Math.max(hw, e.hw);
    cls = Math.min(cls, e.cls);
    if (e.flags & FLAG.cobbles) cobbles = true;
    for (let s = 0; s < e.length; s += 1.5) {
      const p = graph.pose(e.id, s, 1);
      pts.push({ x: p.x, y: p.y, z: p.z });
    }
  }
  if (pts.length < 6) return null;
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= pts.length;
  cz /= pts.length;
  // un anello vero gira tutto intorno al centro: senza, è una «circular» aperta e non ha aiuola
  const sectors = new Set(pts.map((p) => Math.floor(((Math.atan2(p.z - cz, p.x - cx) + Math.PI) / (Math.PI * 2)) * 8) % 8));
  if (sectors.size < 7) return null;
  pts.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
  // la forma si prende dai vertici OSM, che stanno sulla curva vera: i punti a metà corda di un
  // anello con pochi nodi stanno più dentro (un ottagono di 20 m ha 1,5 m di freccia)
  const polar: { th: number; r: number; y: number }[] = [];
  for (const e of list) {
    for (let k = 0; k < e.xs.length - 1; k++) {
      polar.push({ th: Math.atan2(e.zs[k] - cz, e.xs[k] - cx), r: Math.hypot(e.xs[k] - cx, e.zs[k] - cz), y: e.ys[k] });
    }
  }
  polar.sort((a, b) => a.th - b.th);
  const meanR = polar.reduce((s, p) => s + p.r, 0) / polar.length;
  let maxGap = 0;
  for (let i = 0; i < polar.length; i++) {
    const a = polar[i].th;
    const b = i + 1 < polar.length ? polar[i + 1].th : polar[0].th + Math.PI * 2;
    maxGap = Math.max(maxGap, b - a);
  }
  const geo: RingGeo = {
    cx,
    cz,
    ox: cx,
    oz: cz,
    hw,
    cls,
    cobbles,
    meanR,
    edges: list.map((e) => e.id),
    smooth: false,
    n: 0,
    rad: new Float64Array(0),
    ys: new Float64Array(0),
    branches: [],
    curbs: [],
    splitters: [],
    pts,
  };
  if (meanR < 4 || meanR > 90 || meanR < hw + 1.5) return geo;

  // r(θ) e y(θ) ad angolo regolare: i punti nei cassetti d'angolo, una media mobile di ±4 m
  // d'arco (due passate: triangolare), poi tre passate di [1 2 1]
  const n = Math.max(24, Math.min(200, Math.round((Math.PI * 2 * meanR) / 1.5)));
  const w0 = new Float64Array(n);
  const r0 = new Float64Array(n);
  const y0 = new Float64Array(n);
  for (const p of polar) {
    const f = ((p.th + Math.PI) / (Math.PI * 2)) * n;
    const i = Math.floor(f) % n;
    const u = f - Math.floor(f);
    const j = (i + 1) % n;
    w0[i] += 1 - u;
    r0[i] += p.r * (1 - u);
    y0[i] += p.y * (1 - u);
    w0[j] += u;
    r0[j] += p.r * u;
    y0[j] += p.y * u;
  }
  // ±2 m d'arco, o più dove i vertici sono radi: nessun cassetto resta senza punti
  const half = Math.max(1, Math.round((Math.max(2 / meanR, maxGap * 0.6) / (Math.PI * 2)) * n));
  const box = (a: Float64Array) => {
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let d = -half; d <= half; d++) s += a[(k + d + n) % n];
      out[k] = s;
    }
    return out;
  };
  const W = box(box(w0));
  const SR = box(box(r0));
  const SY = box(box(y0));
  const rad = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (W[k] <= 1e-6) return geo;
    rad[k] = SR[k] / W[k];
    ys[k] = SY[k] / W[k];
  }
  for (let pass = 0; pass < 3; pass++) {
    const r0 = Float64Array.from(rad);
    const y0 = Float64Array.from(ys);
    for (let k = 0; k < n; k++) {
      const a = (k + n - 1) % n;
      const b = (k + 1) % n;
      rad[k] = (r0[a] + 2 * r0[k] + r0[b]) / 4;
      ys[k] = (y0[a] + 2 * y0[k] + y0[b]) / 4;
    }
  }
  geo.n = n;
  geo.rad = rad;
  geo.ys = ys;
  // la forma liscia deve restare sulla strada vera: altrimenti non è un anello semplice
  for (const p of polar) if (Math.abs(ringAt(geo, p.th).r - p.r) > Math.max(1.6, meanR * 0.12)) return geo;
  for (let k = 0; k < n; k++) if (rad[k] < hw + 1.2) return geo;
  geo.smooth = true;
  branchesOf(graph, geo, list);
  return geo;
}

/** Punto della retta o + u·t alla distanza `R` da (cx, cz), il più lontano lungo u; null se non la tocca. */
function hitCircle(ox: number, oz: number, ux: number, uz: number, cx: number, cz: number, R: number): number | null {
  const qx = ox - cx;
  const qz = oz - cz;
  const b = qx * ux + qz * uz;
  const c = qx * qx + qz * qz - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  return -b + Math.sqrt(disc);
}

function branchesOf(graph: WorldGraph, g: RingGeo, list: Edge[]): void {
  const ringSet = new Set(list.map((e) => e.id));
  const nodes = new Set<number>();
  for (const e of list) {
    nodes.add(e.a);
    nodes.add(e.b);
  }
  const outer = (th: number) => ringAt(g, th).r + g.hw;
  for (const node of nodes) {
    const nx = graph.nodeX[node];
    const nz = graph.nodeZ[node];
    for (let i = graph.adjStart[node]; i < graph.adjStart[node + 1]; i++) {
      const e = graph.edges[graph.adjEdges[i]];
      if (ringSet.has(e.id) || e.a === e.b || e.length < 2) continue;
      const atA = e.a === node;
      const D = Math.min(e.length, g.hw + 8);
      const far = graph.pose(e.id, atA ? D : e.length - D, 1);
      let ux = far.x - nx;
      let uz = far.z - nz;
      const ul = Math.hypot(ux, uz);
      if (ul < 0.5) continue;
      ux /= ul;
      uz /= ul;
      // un ramo che punta verso il centro non è un ramo (taglia l'aiuola): niente bocca
      if ((nx - g.cx) * ux + (nz - g.cz) * uz < 0) continue;
      const th = Math.atan2(nz - g.cz, nx - g.cx);
      const t0 = Math.max(0, hitCircle(nx, nz, ux, uz, g.cx, g.cz, outer(th)) ?? g.hw);
      const footpath = e.cls === CLS.cycleway || e.cls === CLS.pedestrian;
      const R = footpath ? 0 : Math.max(4, Math.min(10, g.meanR * 0.6));
      const fillets: [Fillet | null, Fillet | null] = [null, null];
      if (R > 0) {
        for (const side of [0, 1] as const) {
          const s = side === 0 ? 1 : -1;
          // sinistra di chi va lungo u: (uz, −ux)
          const vx = uz * s;
          const vz = -ux * s;
          const off = e.hw + R;
          let Ro = outer(th);
          let t = 0;
          let ok = true;
          for (let it = 0; it < 3; it++) {
            const hit = hitCircle(nx + vx * off, nz + vz * off, ux, uz, g.cx, g.cz, Ro + R);
            if (hit == null) {
              ok = false;
              break;
            }
            t = hit;
            Ro = outer(Math.atan2(nz + vz * off + uz * t - g.cz, nx + vx * off + ux * t - g.cx));
          }
          if (!ok || t < t0 - 0.5 || t > Math.min(e.length - 1, 30)) continue;
          const fx = nx + vx * off + ux * t;
          const fz = nz + vz * off + uz * t;
          const k = Ro / (Ro + R);
          const tp = hitCircle(nx + vx * e.hw, nz + vz * e.hw, ux, uz, g.cx, g.cz, outer(th));
          if (tp == null) continue;
          fillets[side] = {
            t1: t,
            r: R,
            fx,
            fz,
            ax: g.cx + (fx - g.cx) * k,
            az: g.cz + (fz - g.cz) * k,
            bx: nx + vx * e.hw + ux * t,
            bz: nz + vz * e.hw + uz * t,
            px: nx + vx * e.hw + ux * tp,
            pz: nz + vz * e.hw + uz * tp,
          };
        }
      }
      const t1 = Math.max(fillets[0]?.t1 ?? 0, fillets[1]?.t1 ?? 0);
      g.branches.push({ edge: e.id, node, atA, hw: e.hw, cls: e.cls, ux, uz, th, t0, fillets, clear: Math.max(t0 + 0.8, t1) });
    }
  }
  mouths(graph, g);
}

/** Le bocche sul bordo esterno, unite dove si toccano, e il cordolo nei tratti che restano. */
function mouths(graph: WorldGraph, g: RingGeo): void {
  const list: Mouth[] = [];
  for (const b of g.branches) {
    // dove il bordo della bocca tocca l'anello: la tangenza del raccordo, o lo spigolo del ramo
    const ends: number[] = [];
    for (const side of [0, 1] as const) {
      const f = b.fillets[side];
      if (f) {
        ends.push(wrap(Math.atan2(f.az - g.cz, f.ax - g.cx) - b.th));
        continue;
      }
      const s = side === 0 ? 1 : -1;
      const ox = graph.nodeX[b.node] + b.uz * s * (b.hw + 0.3);
      const oz = graph.nodeZ[b.node] - b.ux * s * (b.hw + 0.3);
      const t = hitCircle(ox, oz, b.ux, b.uz, g.cx, g.cz, ringAt(g, b.th).r + g.hw) ?? 0;
      ends.push(wrap(Math.atan2(oz + b.uz * t - g.cz, ox + b.ux * t - g.cx) - b.th));
    }
    const lo = Math.min(ends[0], ends[1]);
    const hi = Math.max(ends[0], ends[1]);
    list.push({ b, lo: b.th + lo, hi: b.th + hi, sideLo: ends[0] <= ends[1] ? 0 : 1, sideHi: ends[0] <= ends[1] ? 1 : 0 });
  }
  if (!list.length) {
    g.curbs.push([-Math.PI, Math.PI]);
    return;
  }
  list.sort((p, q) => p.b.th - q.b.th);
  // bocche che si toccano: niente cordolo in mezzo, niente raccordi affacciati, l'isola spartitraffico
  const merged: { lo: number; hi: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const next = list[(i + 1) % list.length];
    // in senso antiorario da m alla successiva: l'ultima torna alla prima facendo il giro
    const turn = i === list.length - 1 ? Math.PI * 2 : 0;
    const gap = next.lo + turn - m.hi;
    const span = next.b.th + turn - m.b.th;
    if (list.length > 1 && gap < 0.02 + 1.2 / g.meanR && span > 0) {
      m.b.fillets[m.sideHi] = null;
      next.b.fillets[next.sideLo] = null;
      const isle = splitter(graph, g, m, next);
      if (isle) {
        g.splitters.push(isle.pts);
        m.b.clear = Math.max(m.b.clear, isle.ta + 0.3);
        next.b.clear = Math.max(next.b.clear, isle.tb + 0.3);
      }
    }
  }
  // gli intervalli delle bocche (ricalcolati dopo aver tolto i raccordi affacciati), uniti
  for (const m of list) merged.push({ lo: m.lo, hi: m.hi });
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const next = list[(i + 1) % list.length];
    const gap = next.lo + (i === list.length - 1 ? Math.PI * 2 : 0) - m.hi;
    if (list.length > 1 && gap < 0.02 + 1.2 / g.meanR) {
      // si uniscono: la bocca di m arriva fino all'inizio di quella dopo
      merged[i].hi = merged[i].hi + Math.max(0, gap) + 1e-6;
      merged[(i + 1) % list.length].lo = merged[i].hi;
    }
  }
  // il cordolo nei tratti fra una bocca e la successiva
  for (let i = 0; i < merged.length; i++) {
    const a = merged[i].hi;
    let b = merged[(i + 1) % merged.length].lo;
    while (b < a) b += Math.PI * 2;
    if (merged.length === 1) b = merged[0].lo + Math.PI * 2;
    if ((b - a) * g.meanR > 0.8) g.curbs.push([a, b]);
  }
}

/** Il punto sul bordo del ramo, lato `s` (+1 sinistra di chi esce), a t metri dal nodo. */
function edgeSide(graph: WorldGraph, b: RingBranch, t: number, s: number): Pt {
  const e = graph.edges[b.edge];
  const tt = Math.min(e.length, Math.max(0, t));
  const p = graph.pose(b.edge, b.atA ? tt : e.length - tt, b.atA ? 1 : -1);
  const lx = Math.cos(p.heading) * s * b.hw;
  const lz = -Math.sin(p.heading) * s * b.hw;
  return { x: p.x + lx, y: p.y, z: p.z + lz };
}

/** Distanza in pianta di (x, z) dalla carreggiata del ramo, nei primi 45 m dal nodo (negativa dentro). */
function outside(e: Edge, atA: boolean, x: number, z: number): number {
  let best = Infinity;
  const m = e.xs.length - 1;
  for (let k = 0; k < m; k++) {
    if (atA ? e.cum[k] > 45 : e.cum[k + 1] < e.length - 45) continue;
    const ax = e.xs[k];
    const az = e.zs[k];
    const dx = e.xs[k + 1] - ax;
    const dz = e.zs[k + 1] - az;
    const len2 = dx * dx + dz * dz || 1;
    const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(x - ax - dx * u, z - az - dz * u));
  }
  return best - e.hw;
}

/**
 * L'isola fra due rami vicini (di solito l'ingresso e l'uscita della stessa strada, due sensi
 * unici in OSM): dal bordo dell'anello lungo i due bordi affacciati, finché i due rami non si
 * toccano (o si allargano oltre 9 m, o dopo 30 m).
 */
function splitter(graph: WorldGraph, g: RingGeo, m: Mouth, next: Mouth): { pts: Pt[]; ta: number; tb: number } | null {
  const A = m.b;
  const B = next.b;
  if (A.cls === CLS.cycleway || A.cls === CLS.pedestrian || B.cls === CLS.cycleway || B.cls === CLS.pedestrian) return null;
  const sA = m.sideHi === 0 ? 1 : -1;
  const sB = next.sideLo === 0 ? 1 : -1;
  const eA = graph.edges[A.edge];
  const eB = graph.edges[B.edge];
  const run = (br: RingBranch, s: number, other: Edge, otherAtA: boolean, self: Edge): { pts: Pt[]; t: number; atRing: boolean } => {
    const pts: Pt[] = [];
    let t = br.t0;
    // dal bordo dell'anello in fuori
    for (; t < br.t0 + 6; t += 0.5) {
      const p = edgeSide(graph, br, t, s);
      if (Math.hypot(p.x - g.cx, p.z - g.cz) > ringAt(g, Math.atan2(p.z - g.cz, p.x - g.cx)).r + g.hw + 0.05) break;
    }
    const tStart = t;
    // i due rami possono toccarsi all'anello e aprirsi più in là (una Y): l'isola comincia dove si aprono
    let atRing = false;
    for (; t <= Math.min(self.length, 30); t += 1) {
      const p = edgeSide(graph, br, t, s);
      const gap = outside(other, otherAtA, p.x, p.z);
      const open = gap >= 0.5 && gap <= 9;
      if (!pts.length) {
        if (open) {
          atRing = t - tStart < 1.5;
          pts.push(p);
        } else if (t - tStart > 15) break;
        continue;
      }
      if (!open) break;
      pts.push(p);
    }
    return { pts, t: pts.length >= 3 ? t : 0, atRing };
  };
  const a = run(A, sA, eB, B.atA, eA);
  const b = run(B, sB, eA, A.atA, eB);
  if (a.pts.length < 3 || b.pts.length < 3 || !a.t || !b.t) return null;
  // chiusa lungo il bordo dell'anello, da b a a; se si apre più in là, chiusa dritta
  const th0 = Math.atan2(b.pts[0].z - g.cz, b.pts[0].x - g.cx);
  let th1 = Math.atan2(a.pts[0].z - g.cz, a.pts[0].x - g.cx);
  if (Math.abs(wrap(th1 - th0)) > 1.2) return null;
  th1 = th0 + wrap(th1 - th0);
  const arc: Pt[] = [];
  const steps = a.atRing && b.atRing ? Math.max(1, Math.ceil((Math.abs(th1 - th0) * g.meanR) / 1.2)) : 0;
  for (let i = 1; i < steps; i++) {
    const th = th0 + ((th1 - th0) * i) / steps;
    const at = ringAt(g, th);
    const r = at.r + g.hw + 0.05;
    arc.push({ x: g.cx + Math.cos(th) * r, y: at.y, z: g.cz + Math.sin(th) * r });
  }
  const pts = [...a.pts, ...b.pts.slice().reverse(), ...arc];
  // troppo piccola per un'isola vera
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p.x * q.z - q.x * p.z;
  }
  if (Math.abs(area / 2) < 3) return null;
  return { pts, ta: a.t, tb: b.t };
}
