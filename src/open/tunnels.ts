import * as THREE from 'three';
import { ASPHALT_REPEAT_M } from '@/world/builders';
import { CLS, FLAG, type Edge, type WorldGraph } from './graph';
import type { Mesh, P } from './tiles';

/*
 * Le gallerie. Prima erano una volta di 8 lati sopra l'asfalto, aperta ai fianchi (da dentro si
 * vedeva il cielo attraverso il monte, perché il terreno visto da sotto non si disegna), illuminata
 * dal sole come fuori, e a ogni imbocco un arco sospeso davanti al pendio: la strada d'accesso
 * scavava il monte per 40 m oltre il portale.
 *
 * Adesso è un tubo chiuso: marciapiedi di servizio col cordolo, pareti chiare in basso, volta
 * scura, due file di lampade ogni 9 m. La luce è cotta nei colori (materiale senza luci): piena
 * all'imbocco, poi cala nei primi 45 m fino a un terzo, con le pozze delle lampade. Fuori, un
 * guscio di calcestruzzo che scende fino al terreno (nessun tubo sospeso nel vuoto), e oltre ogni
 * imbocco 12 m di galleria artificiale sulla strada d'accesso con il portale in testa: è lì che il
 * terreno, a maglie di 8-25 m, non riesce a fare la parete verticale del monte.
 *
 * Il terreno che entra nel tubo non si disegna: lo shader del terreno scarta i pixel dentro la
 * sagoma delle gallerie vicine (`TunnelCut`). Così da dentro non c'è un prato sulla carreggiata, e
 * da fuori, dove il pendio è più basso della volta, si vede il guscio.
 */

export interface TubeSize {
  /** semilarghezza interna, da parete a parete */
  W: number;
  /** quota dell'imposta della volta sopra la strada */
  hs: number;
  /** freccia della volta */
  R: number;
  /** marciapiedi di servizio */
  walk: boolean;
}

export function tubeSize(e: Edge): TubeSize {
  const foot = e.cls === CLS.cycleway || e.cls === CLS.pedestrian;
  const W = e.hw + (foot ? 0.45 : 0.9);
  return { W, hs: foot ? 2 : 2.4, R: Math.min(4, W * (foot ? 0.85 : 0.75)), walk: !foot };
}

/** Spessore del guscio di calcestruzzo. */
const SHELL = 0.6;
/** Galleria artificiale oltre l'imbocco OSM, sulla strada d'accesso. */
const EXT = 12;
/** Passo delle lampade. */
const LAMP = 9;

interface Portal {
  tunnel: number;
  /** l'imbocco è al nodo a della galleria */
  atA: boolean;
  node: number;
  /** la strada d'accesso e la galleria artificiale su di lei (0 = niente) */
  approach: number;
  appAtA: boolean;
  ext: number;
}

/** Una galleria per lo shader del terreno e per gli alberi: la linea della strada col suo tubo. */
export interface TubeLine {
  pts: { x: number; y: number; z: number }[];
  /** semilarghezza esterna, imposta, freccia esterna */
  wo: number;
  hs: number;
  ro: number;
}

interface TunnelIndex {
  dist: Map<number, number>;
  byTunnel: Map<number, Portal[]>;
  byApproach: Map<string, number>;
  tubes: TubeLine[];
  grid: Map<string, number[]>;
}

const cache = new WeakMap<WorldGraph, TunnelIndex>();
const GRID = 64;

function index(graph: WorldGraph): TunnelIndex {
  const have = cache.get(graph);
  if (have) return have;
  const tun = (e: Edge) => (e.flags & FLAG.tunnel) !== 0;
  const tunnels = graph.edges.filter(tun);
  // distanza dall'imbocco più vicino lungo le gallerie: la profondità di ogni punto
  const dist = new Map<number, number>();
  const portals: Portal[] = [];
  const byTunnel = new Map<number, Portal[]>();
  const byApproach = new Map<string, number>();
  const queue: [number, number][] = [];
  for (const e of tunnels) {
    for (const atA of [true, false]) {
      const node = atA ? e.a : e.b;
      const deg = graph.adjStart[node + 1] - graph.adjStart[node];
      let open = deg <= 1;
      // l'imbocco: ci arriva una strada che non è in galleria; la più allineata è l'accesso
      const out = atA ? graph.pose(e.id, 0, -1).heading : graph.pose(e.id, e.length, 1).heading;
      let best = -1;
      let bestCos = 0.5;
      for (let i = graph.adjStart[node]; i < graph.adjStart[node + 1]; i++) {
        const q = graph.edges[graph.adjEdges[i]];
        if (q.id === e.id || tun(q)) continue;
        open = true;
        const h = q.a === node ? graph.pose(q.id, 0, 1).heading : graph.pose(q.id, q.length, -1).heading;
        const c = Math.cos(h - out);
        if (c > bestCos) {
          bestCos = c;
          best = q.id;
        }
      }
      if (!open) continue;
      const q = best >= 0 ? graph.edges[best] : null;
      // fra due gallerie vicine la strada scoperta si divide a metà, i due portali non si sovrappongono
      const far = q ? (q.a === node ? q.b : q.a) : -1;
      let twin = false;
      if (q) for (let i = graph.adjStart[far]; i < graph.adjStart[far + 1]; i++) if (tun(graph.edges[graph.adjEdges[i]])) twin = true;
      const ext = q && !(q.flags & FLAG.bridge) ? Math.min(EXT, twin ? (q.length - 3) / 2 : q.length - 3) : 0;
      const p: Portal = { tunnel: e.id, atA, node, approach: best, appAtA: q ? q.a === node : true, ext: ext >= 3 ? ext : 0 };
      portals.push(p);
      const l = byTunnel.get(e.id);
      if (l) l.push(p);
      else byTunnel.set(e.id, [p]);
      if (q && p.ext) byApproach.set(`${q.id}:${p.appAtA ? 'a' : 'b'}`, p.ext);
      dist.set(node, 0);
      queue.push([node, 0]);
    }
  }
  // Dijkstra sulle sole gallerie (sono poche: basta una coda ordinata a mano)
  while (queue.length) {
    queue.sort((a, b) => b[1] - a[1]);
    const [n, d] = queue.pop()!;
    if (d > (dist.get(n) ?? Infinity)) continue;
    for (let i = graph.adjStart[n]; i < graph.adjStart[n + 1]; i++) {
      const e = graph.edges[graph.adjEdges[i]];
      if (!tun(e)) continue;
      const m = e.a === n ? e.b : e.a;
      const nd = d + e.length;
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd);
        queue.push([m, nd]);
      }
    }
  }
  // le linee dei tubi, con le gallerie artificiali in testa e in coda
  const tubes: TubeLine[] = [];
  const grid = new Map<string, number[]>();
  for (const e of tunnels) {
    const size = tubeSize(e);
    const pts: TubeLine['pts'] = [];
    const ext = (atA: boolean) => (byTunnel.get(e.id) ?? []).find((p) => p.atA === atA && p.ext > 0);
    const pa = ext(true);
    if (pa) for (const q of extensionPoints(graph, pa, 4).reverse()) pts.push({ x: q.x, y: q.y, z: q.z });
    for (let k = 0; k < e.xs.length; k++) pts.push({ x: e.xs[k], y: e.ys[k], z: e.zs[k] });
    const pb = ext(false);
    if (pb) for (const q of extensionPoints(graph, pb, 4)) pts.push({ x: q.x, y: q.y, z: q.z });
    const line: TubeLine = { pts: simplify(pts, 0.4), wo: size.W + SHELL + 0.1, hs: size.hs, ro: size.R + SHELL + 0.1 };
    const id = tubes.push(line) - 1;
    // tutte le celle che il tubo attraversa (un tubo dritto è un segmento solo, lungo centinaia di metri)
    const cells = new Set<string>();
    const pad = line.wo + 3;
    for (let k = 0; k < line.pts.length - 1; k++) {
      const a = line.pts[k];
      const b = line.pts[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (GRID / 2)));
      for (let j = 0; j <= n; j++) {
        const x = a.x + ((b.x - a.x) * j) / n;
        const z = a.z + ((b.z - a.z) * j) / n;
        for (const dx of [-pad, pad]) for (const dz of [-pad, pad]) cells.add(`${Math.floor((x + dx) / GRID)}_${Math.floor((z + dz) / GRID)}`);
      }
    }
    for (const k of cells) {
      const l = grid.get(k);
      if (l) l.push(id);
      else grid.set(k, [id]);
    }
  }
  const idx: TunnelIndex = { dist, byTunnel, byApproach, tubes, grid };
  cache.set(graph, idx);
  return idx;
}

/** Douglas-Peucker in pianta e in quota: un tubo dritto è un segmento solo. */
function simplify<T extends { x: number; y: number; z: number }>(pts: T[], tol: number): T[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = pts[i];
    const b = pts[j];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    let far = -1;
    let fd = tol;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k];
      const u = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
      const d = Math.max(Math.hypot(p.x - a.x - dx * u, p.z - a.z - dz * u), Math.abs(p.y - (a.y + (b.y - a.y) * u)));
      if (d > fd) {
        fd = d;
        far = k;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([i, far], [far, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** I punti della galleria artificiale, dall'imbocco in fuori, ogni `step` metri. */
function extensionPoints(graph: WorldGraph, p: Portal, step: number): P[] {
  const q = graph.edges[p.approach];
  const out: P[] = [];
  const n = Math.max(1, Math.ceil(p.ext / step));
  for (let k = 0; k <= n; k++) {
    const t = (p.ext * k) / n;
    const pose = graph.pose(q.id, p.appAtA ? t : q.length - t, p.appAtA ? 1 : -1);
    out.push({ x: pose.x, y: pose.y, z: pose.z, h: pose.heading, d: -t });
  }
  return out;
}

/**
 * Quanti metri della strada d'accesso, dal nodo a (`atA`) o b, stanno dentro la galleria
 * artificiale: lì niente marciapiedi, guardrail, lampioni.
 */
export function portalClear(graph: WorldGraph, edge: number, atA: boolean): number {
  const ext = index(graph).byApproach.get(`${edge}:${atA ? 'a' : 'b'}`);
  return ext ? ext + 2 : 0;
}

/** Profondità in galleria del punto a `s` metri dal nodo a: distanza dall'imbocco più vicino. */
export function tunnelDepth(graph: WorldGraph, e: Edge, s: number): number {
  const ix = index(graph);
  return Math.min((ix.dist.get(e.a) ?? 0) + s, (ix.dist.get(e.b) ?? 0) + e.length - s);
}

/** Il punto (x, z) a quota y sta dentro (o sotto) la sagoma di una galleria? Per gli alberi. */
export function inTube(graph: WorldGraph, x: number, z: number, y: number, margin = 1.5): boolean {
  const ix = index(graph);
  const list = ix.grid.get(`${Math.floor(x / GRID)}_${Math.floor(z / GRID)}`);
  if (!list) return false;
  for (const id of list) {
    const t = ix.tubes[id];
    for (let k = 0; k < t.pts.length - 1; k++) {
      const a = t.pts[k];
      const b = t.pts[k + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
      const d = Math.hypot(x - a.x - dx * u, z - a.z - dz * u);
      if (d > t.wo + margin) continue;
      if (y < a.y + (b.y - a.y) * u + t.hs + t.ro + margin) return true;
    }
  }
  return false;
}

// ---------- geometria ----------

/** la luce in fondo alla galleria (lineare: a schermo è circa la metà di quella dell'imbocco) */
const LIGHT_DEEP = 0.2;
const C_ROAD = new THREE.Color('#ffffff');
const C_KERB = new THREE.Color('#b9b4a8');
const C_WALK = new THREE.Color('#8f8b82');
const C_DADO = new THREE.Color('#d9d5ca');
const C_STRIPE = new THREE.Color('#2f2f2c');
const C_WALL = new THREE.Color('#7a766e');
const C_VAULT = new THREE.Color('#5d5a54');
const C_LINE = new THREE.Color('#f2f1ea');
const C_LAMP = new THREE.Color('#fff1cf');
const tmpC = new THREE.Color();

interface TP extends P {
  /** profondità in galleria (negativa nella galleria artificiale) */
  depth: number;
  /** ascissa per il passo delle lampade */
  phase: number;
}

/** La luce cotta: piena all'imbocco, un terzo in fondo, le pozze sotto le lampade. */
function lightAt(p: TP): number {
  const k = Math.min(1, Math.max(0, p.depth / 45));
  const deep = k * k * (3 - 2 * k);
  const x = (((p.phase % LAMP) + LAMP) % LAMP) - LAMP / 2;
  const pool = Math.max(0, 1 - Math.abs(x) / 3.2);
  return 1 - (1 - LIGHT_DEEP) * deep + 0.24 * pool * pool * deep;
}

function lit(c: THREE.Color, p: TP): THREE.Color {
  return tmpC.copy(c).multiplyScalar(lightAt(p));
}

/** Una fascia del tubo fra due punti della sezione (l a sinistra, y in su), lungo i campioni. */
function band(m: Mesh, pts: TP[], l0: number, y0: number, l1: number, y1: number, col: THREE.Color | null): void {
  let prev = -1;
  for (const p of pts) {
    const lx = Math.cos(p.h);
    const lz = -Math.sin(p.h);
    const c = col ? lit(col, p) : undefined;
    const i = m.vertex(p.x + lx * l0, p.y + y0, p.z + lz * l0, 0, 0, c);
    m.vertex(p.x + lx * l1, p.y + y1, p.z + lz * l1, 0, 0, c);
    if (prev >= 0) m.idx.push(prev, i, prev + 1, prev + 1, i, i + 1);
    prev = i;
  }
}

/** La sezione della volta: punti da sinistra (φ = 0) a destra (φ = π). */
function vault(W: number, hs: number, R: number, n = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = (i / n) * Math.PI;
    out.push([Math.cos(f) * W, hs + Math.sin(f) * R]);
  }
  return out;
}

export interface TunnelMeshes {
  /** carreggiata in galleria: trama dell'asfalto e luce cotta */
  road: Mesh;
  /** dentro: marciapiedi, pareti, volta, lampade, segni (colori di vertice, senza luci) */
  inner: Mesh;
  /** fuori: guscio e portali in calcestruzzo */
  shell: Mesh;
}

/**
 * Il tubo di un arco in galleria, per le corse dell'arco dentro la mattonella (`runs`, campionate
 * ogni 1,5 m), più le gallerie artificiali e i portali ai suoi imbocchi.
 */
export function tunnelGeometry(
  graph: WorldGraph,
  terrainHeight: (x: number, z: number) => number,
  e: Edge,
  runs: P[][],
  rect: { x0: number; z0: number; x1: number; z1: number },
  lift: number,
  m: TunnelMeshes,
): void {
  const ix = index(graph);
  const size = tubeSize(e);
  const da = ix.dist.get(e.a) ?? 0;
  const db = ix.dist.get(e.b) ?? 0;
  const inside = (p: { x: number; z: number }) => p.x >= rect.x0 && p.x < rect.x1 && p.z >= rect.z0 && p.z < rect.z1;
  const oneway = (e.flags & (FLAG.oneway | FLAG.onewayRev)) !== 0;
  const repeat = e.flags & FLAG.unpaved ? 5 : e.flags & FLAG.cobbles ? 4 : ASPHALT_REPEAT_M;
  for (const run of runs) {
    if (run.length < 2) continue;
    const pts: TP[] = run.map((p) => ({ ...p, y: p.y + lift, depth: Math.min(da + p.d, db + e.length - p.d), phase: da + p.d }));
    // la carreggiata, con la luce cotta
    let prev = -1;
    for (const p of pts) {
      const lx = Math.cos(p.h);
      const lz = -Math.sin(p.h);
      const c = lit(C_ROAD, p);
      const i = m.road.vertex(p.x + lx * e.hw, p.y, p.z + lz * e.hw, 0, p.d / repeat, c);
      m.road.vertex(p.x - lx * e.hw, p.y, p.z - lz * e.hw, 1, p.d / repeat, c);
      if (prev >= 0) m.road.idx.push(prev, prev + 1, i, prev + 1, i + 1, i);
      prev = i;
    }
    // i segni: margini e, nei doppi sensi, la continua (in galleria non si sorpassa)
    if (e.hw >= 1.6 && !(e.flags & FLAG.unpaved)) {
      band(m.inner, pts, e.hw - 0.2, 0.012, e.hw - 0.32, 0.012, C_LINE);
      band(m.inner, pts, -e.hw + 0.32, 0.012, -e.hw + 0.2, 0.012, C_LINE);
      if (!oneway && e.hw >= 2.7) band(m.inner, pts, 0.06, 0.014, -0.06, 0.014, C_LINE);
    }
    tube(m, pts, e, size, terrainHeight);
    lamps(m, pts, size);
  }
  // gli imbocchi di quest'arco: la galleria artificiale sulla strada d'accesso e il portale
  for (const p of ix.byTunnel.get(e.id) ?? []) {
    const ext = p.ext ? extensionPoints(graph, p, 1.5) : [];
    if (ext.length > 1) {
      const pts: TP[] = ext.map((q) => ({ ...q, y: q.y + lift, depth: q.d, phase: (p.atA ? da : db) + q.d }));
      // solo i pezzi nella mattonella (più un campione oltre il bordo, per non lasciare fessure)
      let cur: TP[] = [];
      const flush = () => {
        if (cur.length > 1) {
          tube(m, cur, e, size, terrainHeight);
          lamps(m, cur, size);
        }
        cur = [];
      };
      for (let k = 0; k < pts.length; k++) {
        if (inside(pts[k])) {
          if (!cur.length && k > 0) cur.push(pts[k - 1]);
          cur.push(pts[k]);
        } else if (cur.length) {
          cur.push(pts[k]);
          flush();
        }
      }
      flush();
    }
    // il portale in testa: in fondo alla galleria artificiale, o sull'imbocco se non c'è
    const head: P | null = ext.length > 1 ? ext[ext.length - 1] : null;
    let at: P;
    if (head) at = head;
    else {
      const pose = graph.pose(e.id, p.atA ? 0 : e.length, p.atA ? -1 : 1);
      at = { x: pose.x, y: pose.y, z: pose.z, h: pose.heading, d: 0 };
    }
    if (inside(at)) portal(m.shell, { ...at, y: at.y + lift }, size);
  }
}

/** Dentro e fuori del tubo, sui campioni. */
function tube(m: TunnelMeshes, pts: TP[], e: Edge, s: TubeSize, terrainHeight: (x: number, z: number) => number): void {
  const { W, hs, R } = s;
  // dentro: cordolo, marciapiede, zoccolo scuro, pareti chiare, parete grigia, volta
  for (const side of [1, -1]) {
    if (s.walk) {
      band(m.inner, pts, side * e.hw, -0.02, side * e.hw, 0.18, C_KERB);
      band(m.inner, pts, side * e.hw, 0.18, side * W, 0.18, C_WALK);
    } else band(m.inner, pts, side * e.hw, 0, side * W, 0, C_WALK);
    const f = s.walk ? 0.18 : 0;
    band(m.inner, pts, side * W, f, side * W, f + 0.25, C_STRIPE);
    band(m.inner, pts, side * W, f + 0.25, side * W, Math.min(hs, 2.1), C_DADO);
    if (hs > 2.1) band(m.inner, pts, side * W, 2.1, side * W, hs, C_WALL);
  }
  const arc = vault(W, hs, R);
  for (let i = 0; i < arc.length - 1; i++) band(m.inner, pts, arc[i][0], arc[i][1], arc[i + 1][0], arc[i + 1][1], C_VAULT);
  // fuori: il guscio, con i fianchi che scendono fino al terreno
  const Wo = W + SHELL;
  const outer = vault(Wo, hs, R + SHELL, 8);
  for (let i = 0; i < outer.length - 1; i++) band(m.shell, pts, outer[i][0], outer[i][1], outer[i + 1][0], outer[i + 1][1], null);
  for (const side of [1, -1]) {
    let prev = -1;
    for (const p of pts) {
      const lx = Math.cos(p.h) * side * Wo;
      const lz = -Math.sin(p.h) * side * Wo;
      const ground = terrainHeight(p.x + lx, p.z + lz);
      const i = m.shell.vertex(p.x + lx, p.y + hs, p.z + lz);
      m.shell.vertex(p.x + lx, Math.min(p.y - SHELL, ground - 0.5), p.z + lz);
      if (prev >= 0) m.shell.idx.push(prev, i, prev + 1, prev + 1, i, i + 1);
      prev = i;
    }
  }
}

/** Due file di lampade sulla volta, ogni LAMP metri: piastre luminose da 1,2 × 0,3 m. */
function lamps(m: TunnelMeshes, pts: TP[], s: TubeSize): void {
  const at = (p: { x: number; y: number; z: number; h: number }, f: number, along: number, across: number) => {
    const lx = Math.cos(p.h);
    const lz = -Math.sin(p.h);
    const fx = Math.sin(p.h);
    const fz = Math.cos(p.h);
    // un filo sotto la volta, verso il centro della sezione
    const ff = f + across / Math.max(1, s.R);
    const l = Math.cos(ff) * (s.W - 0.06);
    const y = s.hs + Math.sin(ff) * (s.R - 0.06);
    return [p.x + lx * l + fx * along, p.y + y, p.z + lz * l + fz * along] as const;
  };
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    // una lampada dove la fase passa per un multiplo del passo (la fase può anche scendere)
    const n0 = Math.floor(a.phase / LAMP);
    const n1 = Math.floor(b.phase / LAMP);
    if (n0 === n1) continue;
    const u = (Math.max(n0, n1) * LAMP - a.phase) / (b.phase - a.phase || 1);
    const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, h: a.h };
    const along = 0;
    for (const f of [Math.PI * 0.32, Math.PI * 0.68]) {
      const v = [at(p, f, along - 0.6, -0.15), at(p, f, along + 0.6, -0.15), at(p, f, along - 0.6, 0.15), at(p, f, along + 0.6, 0.15)];
      const i = m.inner.vertex(v[0][0], v[0][1], v[0][2], 0, 0, C_LAMP);
      m.inner.vertex(v[1][0], v[1][1], v[1][2], 0, 0, C_LAMP);
      m.inner.vertex(v[2][0], v[2][1], v[2][2], 0, 0, C_LAMP);
      m.inner.vertex(v[3][0], v[3][1], v[3][2], 0, 0, C_LAMP);
      m.inner.idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
}

/**
 * Il portale: una parete di calcestruzzo di 80 cm attorno all'apertura, larga 2,2 m in più per
 * parte, alta 1,4 m sopra la volta e piantata 1,5 m sotto la strada, con la testa e i fianchi.
 */
function portal(m: Mesh, p: P, s: TubeSize): void {
  const Wo = s.W + SHELL;
  const side = Wo + 2.2;
  const top = s.hs + s.R + SHELL + 1.4;
  const low = -1.5;
  const lx = Math.cos(p.h);
  const lz = -Math.sin(p.h);
  const fx = Math.sin(p.h) * 0.8;
  const fz = Math.cos(p.h) * 0.8;
  // l'apertura, da sinistra in basso, sopra la volta, a destra in basso
  const hole: [number, number][] = [[s.W, low], [s.W, s.hs], ...vault(s.W, s.hs, s.R, 12).slice(1, -1), [-s.W, s.hs], [-s.W, low]];
  // il bordo esterno: i fianchi dritti fino all'imposta, poi verso la testa a raggiera dal centro della volta
  const rim = hole.map(([l, y]): [number, number] => {
    if (y <= s.hs + 1e-6) return [Math.sign(l) * side, y];
    const dl = l;
    const dy = y - s.hs;
    const k = Math.min(dl !== 0 ? side / Math.abs(dl) : Infinity, (top - s.hs) / dy);
    return [dl * k, s.hs + dy * k];
  });
  const put = (l: number, y: number, back: number) => m.vertex(p.x + lx * l + fx * back, p.y + y, p.z + lz * l + fz * back);
  for (const back of [0, 1]) {
    for (let i = 0; i < hole.length - 1; i++) {
      const a = put(hole[i][0], hole[i][1], back);
      put(rim[i][0], rim[i][1], back);
      put(hole[i + 1][0], hole[i + 1][1], back);
      put(rim[i + 1][0], rim[i + 1][1], back);
      m.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  // la testa e i fianchi: il bordo esterno, fra la faccia davanti e quella dietro
  for (let i = 0; i < rim.length - 1; i++) {
    const a = put(rim[i][0], rim[i][1], 0);
    put(rim[i + 1][0], rim[i + 1][1], 0);
    put(rim[i][0], rim[i][1], 1);
    put(rim[i + 1][0], rim[i + 1][1], 1);
    m.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  // l'intradosso dell'apertura nello spessore del portale
  for (let i = 0; i < hole.length - 1; i++) {
    const a = put(hole[i][0], hole[i][1], 0);
    put(hole[i + 1][0], hole[i + 1][1], 0);
    put(hole[i][0], hole[i][1], 1);
    put(hole[i + 1][0], hole[i + 1][1], 1);
    m.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

// ---------- il terreno che non entra nel tubo ----------

/** Quanti segmenti di galleria vede al massimo lo shader del terreno. */
export const CUT_MAX = 24;

export interface TunnelCut {
  uTunN: { value: number };
  /** x, y, z del punto a, semilarghezza esterna */
  uTunA: { value: THREE.Vector4[] };
  /** x, y, z del punto b, freccia esterna */
  uTunB: { value: THREE.Vector4[] };
  /** imposta, e se il segmento chiude il tubo in a (1) e in b (2) */
  uTunC: { value: THREE.Vector2[] };
  /** dove è stato scelto l'ultima volta */
  at: { x: number; z: number } | null;
}

export function createTunnelCut(): TunnelCut {
  return {
    uTunN: { value: 0 },
    uTunA: { value: Array.from({ length: CUT_MAX }, () => new THREE.Vector4()) },
    uTunB: { value: Array.from({ length: CUT_MAX }, () => new THREE.Vector4()) },
    uTunC: { value: Array.from({ length: CUT_MAX }, () => new THREE.Vector2()) },
    at: null,
  };
}

/** Sceglie i segmenti di galleria più vicini a (x, z), entro 400 m. Si rifà ogni 40 m. */
export function updateTunnelCut(cut: TunnelCut, graph: WorldGraph, x: number, z: number): void {
  if (cut.at && Math.hypot(cut.at.x - x, cut.at.z - z) < 40) return;
  cut.at = { x, z };
  const ix = index(graph);
  const found: { d: number; t: TubeLine; k: number }[] = [];
  const seen = new Set<number>();
  const r = Math.ceil(400 / GRID);
  const gx = Math.floor(x / GRID);
  const gz = Math.floor(z / GRID);
  for (let i = -r; i <= r; i++) {
    for (let j = -r; j <= r; j++) {
      for (const id of ix.grid.get(`${gx + i}_${gz + j}`) ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const t = ix.tubes[id];
        for (let k = 0; k < t.pts.length - 1; k++) {
          const a = t.pts[k];
          const b = t.pts[k + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const len2 = dx * dx + dz * dz || 1;
          const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
          const d = Math.hypot(x - a.x - dx * u, z - a.z - dz * u);
          if (d < 400) found.push({ d, t, k });
        }
      }
    }
  }
  found.sort((p, q) => p.d - q.d);
  const n = Math.min(CUT_MAX, found.length);
  for (let i = 0; i < n; i++) {
    const { t, k } = found[i];
    const a = t.pts[k];
    const b = t.pts[k + 1];
    cut.uTunA.value[i].set(a.x, a.y, a.z, t.wo);
    cut.uTunB.value[i].set(b.x, b.y, b.z, t.ro);
    cut.uTunC.value[i].set(t.hs, (k === 0 ? 1 : 0) + (k === t.pts.length - 2 ? 2 : 0));
  }
  cut.uTunN.value = n;
}

/**
 * Il pezzo di shader del terreno: scarta i pixel dentro la sagoma esterna di una galleria vicina.
 * Ai capi del tubo il taglio si ferma netto (lì c'è il portale); fra due segmenti sborda di
 * mezzo metro, così nelle curve non resta uno spicchio di prato.
 */
export function patchTerrainShader(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, cut: TunnelCut): void {
  shader.uniforms.uTunN = cut.uTunN;
  shader.uniforms.uTunA = cut.uTunA;
  shader.uniforms.uTunB = cut.uTunB;
  shader.uniforms.uTunC = cut.uTunC;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vTunPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTunPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vTunPos;
uniform int uTunN;
uniform vec4 uTunA[${CUT_MAX}];
uniform vec4 uTunB[${CUT_MAX}];
uniform vec2 uTunC[${CUT_MAX}];`,
    )
    .replace(
      'void main() {',
      `void main() {
  for (int i = 0; i < ${CUT_MAX}; i++) {
    if (i >= uTunN) break;
    vec3 A = uTunA[i].xyz;
    vec3 B = uTunB[i].xyz;
    vec2 ab = B.xz - A.xz;
    float L2 = max(dot(ab, ab), 1e-4);
    float t = dot(vTunPos.xz - A.xz, ab) / L2;
    float ends = uTunC[i].y;
    float ea = mod(ends, 2.0) > 0.5 ? 0.0 : 0.5 / sqrt(L2);
    float eb = ends > 1.5 ? 0.0 : 0.5 / sqrt(L2);
    if (t < -ea || t > 1.0 + eb) continue;
    float tc = clamp(t, 0.0, 1.0);
    float d = length(vTunPos.xz - (A.xz + ab * tc));
    float W = uTunA[i].w;
    if (d > W) continue;
    float h = vTunPos.y - mix(A.y, B.y, tc);
    float hmax = uTunC[i].x + uTunB[i].w * sqrt(max(0.0, 1.0 - d * d / (W * W)));
    if (h > -0.8 && h < hmax) discard;
  }`,
    );
}
