import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from '@/world/builders';
import { DECAL, poiGeometry, RAIL_POST_STEP, railFrames, sculptureGeometry, SIGN, signPlateGeometry, sideYaw, sweepBeam, type Placed, type RailFrame, type SignKind, type Tri } from '@/world/roadside';
import { CLS, FLAG, type Dir, type Edge, type WorldGraph } from './graph';
import type { WorldField } from './field';
import { bendAt, junctionClear, Mesh, roadLift, runsInside, URBAN, type TileMeshes, type TileSpec } from './tiles';
import type { PoiKind, RoadMarks, TrafficSignal, WorldFeatures } from './world';

/*
 * L'arredo vicino al ciclista (mattonelle entro due anelli): guardrail a doppia onda, delineatori,
 * ringhiere dei ponti, semafori sempre verdi, cartelli, strisce pedonali, denti di squalo e linee
 * d'arresto, STOP e biciclette per terra, aiuole delle rotatorie, modellini dei luoghi da passare,
 * cippi delle provinciali e delle statali. Si costruisce a fette come il resto della mattonella.
 *
 * Ogni oggetto appartiene alla mattonella in cui cade il suo piede (o il suo primo paletto):
 * due mattonelle vicine non lo disegnano due volte.
 */

export type RoadsideKind = 'railPost' | 'reflector' | 'delineator' | 'signPole' | 'signal' | 'shrub' | 'bridgePost';
export type RoadsideItems = Record<RoadsideKind, Placed[]>;
export const ROADSIDE_KINDS: readonly RoadsideKind[] = ['railPost', 'reflector', 'delineator', 'signPole', 'signal', 'shrub', 'bridgePost'];
export const emptyItems = (): RoadsideItems => ({ railPost: [], reflector: [], delineator: [], signPole: [], signal: [], shrub: [], bridgePost: [] });

export interface StreetDetail {
  /** lame dei guardrail e corrimano dei ponti (lamiera zincata) */
  beam: THREE.BufferGeometry | null;
  /** strisce pedonali, denti di squalo, linee d'arresto, mini rotatorie dipinte */
  paint: THREE.BufferGeometry | null;
  /** STOP e biciclette per terra (atlante) */
  decal: THREE.BufferGeometry | null;
  /** aiuole delle rotatorie: cordolo, fiori, prato (colori di vertice) */
  island: THREE.BufferGeometry | null;
  /** cartelli, fronte e retro */
  signs: THREE.BufferGeometry | null;
  signBacks: THREE.BufferGeometry | null;
  /** modellini dei luoghi e sculture (colori di vertice) */
  props: THREE.BufferGeometry | null;
  /** cippi: uno per sigla, con la scritta */
  stones: { x: number; y: number; z: number; h: number; ref: string; cap: string }[];
  items: RoadsideItems;
  /** alberi in mezzo alle rotatorie */
  trees: TileMeshes['trees'];
}

// ---------- indici, una volta per mondo ----------

interface Ring {
  cx: number;
  cz: number;
  hw: number;
  lift: number;
  /** punti dell'anello in ordine d'angolo intorno al centro */
  pts: { x: number; y: number; z: number }[];
}

interface StreetIndex {
  crossings: Map<number, number[]>;
  yields: Map<number, RoadMarks['yields']>;
  signalNodes: Map<number, TrafficSignal>;
  signalMid: Map<number, TrafficSignal[]>;
  mini: Set<number>;
  rings: Ring[];
  ringNodes: Set<number>;
}

const indexCache = new WeakMap<WorldFeatures, StreetIndex>();

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

/** Le rotatorie del grafo: archi dell'anello uniti per nodi, centro e punti in ordine d'angolo. */
export function findRings(graph: WorldGraph): Ring[] {
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
  for (const e of ringEdges) push(groups, find(e.a), e);
  const out: Ring[] = [];
  for (const list of groups.values()) {
    const pts: { x: number; y: number; z: number }[] = [];
    let hw = 0;
    let cls: number = CLS.cycleway;
    for (const e of list) {
      hw = Math.max(hw, e.hw);
      cls = Math.min(cls, e.cls);
      for (let s = 0; s < e.length; s += 2) {
        const p = graph.pose(e.id, s, 1);
        pts.push({ x: p.x, y: p.y, z: p.z });
      }
    }
    if (pts.length < 6) continue;
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
    if (sectors.size < 7) continue;
    pts.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
    out.push({ cx, cz, hw, lift: roadLift(cls), pts });
  }
  return out;
}

function streetIndex(graph: WorldGraph, features: WorldFeatures): StreetIndex {
  const have = indexCache.get(features);
  if (have) return have;
  const crossings = new Map<number, number[]>();
  for (const c of features.marks.crossings) push(crossings, c.edge, c.s);
  const yields = new Map<number, RoadMarks['yields']>();
  for (const y of features.marks.yields) push(yields, y.edge, y);
  const signalNodes = new Map<number, TrafficSignal>();
  const signalMid = new Map<number, TrafficSignal[]>();
  for (const s of features.signals) {
    if (s.node >= 0) signalNodes.set(s.node, s);
    else push(signalMid, s.edge, s);
  }
  const rings = findRings(graph);
  const ringNodes = new Set<number>();
  for (const e of graph.edges) {
    if (!(e.flags & FLAG.roundabout)) continue;
    ringNodes.add(e.a);
    ringNodes.add(e.b);
  }
  const idx: StreetIndex = { crossings, yields, signalNodes, signalMid, mini: new Set(features.marks.mini), rings, ringNodes };
  indexCache.set(features, idx);
  return idx;
}

// ---------- pezzi per terra ----------

const tmpV = { x: 0, y: 0, z: 0 };

/** Un triangolo con la faccia in su, qualunque sia l'ordine dei vertici. */
function triUp(m: Mesh, a: typeof tmpV, b: typeof tmpV, c: typeof tmpV, uv?: [number, number, number, number, number, number], col?: THREE.Color): void {
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  const k = m.vertex(a.x, a.y, a.z, uv?.[0] ?? 0, uv?.[1] ?? 0, col);
  m.vertex(b.x, b.y, b.z, uv?.[2] ?? 0, uv?.[3] ?? 0, col);
  m.vertex(c.x, c.y, c.z, uv?.[4] ?? 0, uv?.[5] ?? 0, col);
  if (ny >= 0) m.idx.push(k, k + 1, k + 2);
  else m.idx.push(k, k + 2, k + 1);
}

/**
 * Un rettangolo sulla carreggiata, nel verso di marcia `dir`: comincia a `s` (lato di chi arriva)
 * e va avanti di `len` metri; da `l0` a `l1` di lato (sinistra positiva per chi va in `dir`).
 * `uv` = [u sinistra, u destra]: v va da 0 (vicino) a 1 (lontano).
 */
function quad(m: Mesh, graph: WorldGraph, e: Edge, dir: Dir, s: number, len: number, l0: number, l1: number, lift: number, uv?: [number, number]): void {
  const sa = Math.min(e.length, Math.max(0, s));
  const sb = Math.min(e.length, Math.max(0, s + dir * len));
  const a = graph.pose(e.id, sa, dir);
  const b = graph.pose(e.id, sb, dir);
  const corner = (p: typeof a, l: number) => ({ x: p.x + Math.cos(p.heading) * l, y: p.y + lift, z: p.z - Math.sin(p.heading) * l });
  const A0 = corner(a, l0);
  const A1 = corner(a, l1);
  const B0 = corner(b, l0);
  const B1 = corner(b, l1);
  const u0 = uv?.[0] ?? 0;
  const u1 = uv?.[1] ?? 1;
  triUp(m, A0, A1, B0, [u0, 0, u1, 0, u0, 1]);
  triUp(m, A1, B1, B0, [u1, 0, u1, 1, u0, 1]);
}

/** Denti di squalo sulla metà di destra (o su tutta, nei sensi unici), con la punta verso chi arriva. */
function teeth(m: Mesh, graph: WorldGraph, e: Edge, dir: Dir, sLine: number, oneway: boolean, lift: number): void {
  const left = oneway ? e.hw - 0.2 : -0.1;
  const right = -(e.hw - 0.2);
  const base = graph.pose(e.id, sLine, dir);
  const tip = graph.pose(e.id, Math.min(e.length, Math.max(0, sLine - dir * 0.6)), dir);
  for (let l = left - 0.25; l - 0.25 >= right - 1e-6; l -= 0.8) {
    const at = (p: typeof base, off: number) => ({ x: p.x + Math.cos(p.heading) * off, y: p.y + lift, z: p.z - Math.sin(p.heading) * off });
    triUp(m, at(base, l + 0.25), at(base, l - 0.25), at(tip, l));
  }
}

/** Linea d'arresto: 50 cm di bianco pieno sulla metà di destra (o su tutta). */
function stopLine(m: Mesh, graph: WorldGraph, e: Edge, dir: Dir, sLine: number, oneway: boolean, lift: number): void {
  quad(m, graph, e, dir, sLine - dir * 0.5, 0.5, oneway ? e.hw - 0.15 : -0.05, -(e.hw - 0.15), lift);
}

// ---------- il lavoro ----------

const CAP_SS = '#c3262b';
const CAP_SP = '#e2b21c';
const FLOWERS = ['#3f6e2f', '#4c7d35', '#56873a', '#d77fa1', '#e2c34a', '#f2efe6', '#b2435c'];
const GRASS = new THREE.Color('#5d8f3c');
const GRASS2 = new THREE.Color('#6a9a44');
const BED = new THREE.Color('#6e5238');
const CURB = new THREE.Color('#d8d4ca');
const CURB_FACE = new THREE.Color('#bdb8ae');

/** Fin dove un modellino sta dal bordo strada, per tipo: una chiesa non sta sul ciglio. */
const POI_SETBACK: Partial<Record<PoiKind, number>> = {
  fontanella: 1.4,
  edicola: 1.5,
  croce: 1.5,
  bici: 2,
  belvedere: 2,
  bar: 3,
  fontana: 3.5,
  campanile: 3.5,
  chiesa: 5,
  santuario: 7,
  castello: 5,
  torre: 5,
  rifugio: 5,
};

const poiGeoCache = new Map<PoiKind, THREE.BufferGeometry | null>();
const plateCache = new Map<string, THREE.BufferGeometry>();
const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);
const one = new THREE.Vector3(1, 1, 1);
const pos4 = new THREE.Vector3();

function placed(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry: number): THREE.BufferGeometry {
  q4.setFromAxisAngle(yAxis, ry);
  m4.compose(pos4.set(x, y, z), q4, one);
  return geo.clone().applyMatrix4(m4);
}

function mergeOrNull(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!g) return null;
  g.computeBoundingSphere();
  return g;
}

function triGeometry(t: Tri): THREE.BufferGeometry | null {
  if (!t.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
  g.setIndex(t.idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function* streetJob(graph: WorldGraph, field: WorldField, features: WorldFeatures, spec: TileSpec): Generator<void, StreetDetail, void> {
  const ix = streetIndex(graph, features);
  const x0 = spec.x0;
  const z0 = spec.z0;
  const x1 = spec.x0 + spec.size;
  const z1 = spec.z0 + spec.size;
  const own = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1;
  const near = (x: number, z: number, m: number) => x >= x0 - m && x < x1 + m && z >= z0 - m && z < z1 + m;
  const beam: Tri = { pos: [], idx: [] };
  const paint = new Mesh();
  const decal = new Mesh();
  const island = new Mesh();
  const items = emptyItems();
  const signParts: THREE.BufferGeometry[] = [];
  const backParts: THREE.BufferGeometry[] = [];
  const propParts: THREE.BufferGeometry[] = [];
  const stones: StreetDetail['stones'] = [];
  const trees: TileMeshes['trees'] = [];

  const addSign = (kind: SignKind, x: number, y: number, z: number, ry: number, back = true, pole = true) => {
    const cell = SIGN[kind];
    for (const b of back ? [false, true] : [false]) {
      const key = `${cell}:${b}`;
      let g = plateCache.get(key);
      if (!g) {
        g = signPlateGeometry(cell, b);
        plateCache.set(key, g);
      }
      (b ? backParts : signParts).push(placed(g, x, y, z, ry));
    }
    if (pole) items.signPole.push({ x, y, z, ry });
  };
  /** Un cartello a destra di chi va in `dir`, a `s`, rivolto verso di lui. */
  const signRight = (e: Edge, dir: Dir, s: number, kind: SignKind, off = e.hw + 0.9) => {
    const p = graph.pose(e.id, Math.min(e.length, Math.max(0, s)), dir);
    const x = p.x - Math.cos(p.heading) * off;
    const z = p.z + Math.sin(p.heading) * off;
    if (!own(x, z)) return;
    addSign(kind, x, p.y - 0.05, z, p.heading);
  };

  const ids = new Set<number>();
  for (let x = x0 - 50; x <= x1 + 50; x += 90) for (let z = z0 - 50; z <= z1 + 50; z += 90) for (const id of graph.edgesNear(x, z, 70)) ids.add(id);

  let count = 0;
  for (const id of ids) {
    const e = graph.edges[id];
    const L = e.length;
    const bridge = (e.flags & FLAG.bridge) !== 0;
    const tun = (e.flags & FLAG.tunnel) !== 0;
    const ring = (e.flags & FLAG.roundabout) !== 0;
    const oneway = (e.flags & (FLAG.oneway | FLAG.onewayRev)) !== 0;
    const lift = roadLift(e.cls);
    const markLift = lift + 0.016;
    const endA = junctionClear(graph, e.a, id);
    const endB = junctionClear(graph, e.b, id);
    const road = e.cls !== CLS.cycleway && e.cls !== CLS.pedestrian;

    // --- guardrail e delineatori: strade fuori dai paesi, dove il terreno scende ---
    const wantBy: Record<number, Map<number, boolean>> = { 1: new Map(), [-1]: new Map() };
    if (road && !bridge && !tun && !ring && e.cls <= CLS.unclassified) {
      for (const side of [1, -1] as const) {
        const want = wantBy[side];
        const ks: number[] = [];
        const at = new Map<number, ReturnType<WorldGraph['pose']>>();
        for (let k = 0; 2 + k * RAIL_POST_STEP <= L - 2; k++) {
          const s = 2 + k * RAIL_POST_STEP;
          if (s < endA + 6 || s > L - endB - 6) continue;
          const p = graph.pose(id, s, 1);
          if (!near(p.x, p.z, 50)) continue;
          const lx = Math.cos(p.heading) * side;
          const lz = -Math.sin(p.heading) * side;
          const px = p.x + lx * (e.hw + 6);
          const pz = p.z + lz * (e.hw + 6);
          const other = field.roadAt(px, pz, 6);
          want.set(k, p.y - field.terrain.height(px, pz) > 3.2 && !(other && other.edgeDist < 1));
          ks.push(k);
          at.set(k, p);
        }
        // un buco di un paletto si chiude
        for (const k of ks) if (!want.get(k) && want.get(k - 1) && want.get(k + 1)) want.set(k, true);
        // le file: almeno tre paletti; terminali solo dove la fila finisce davvero
        let run: number[] = [];
        const flush = () => {
          if (run.length >= 3) {
            const o = e.hw + 0.7 + 0.155;
            const posts = run.map((k) => {
              const p = at.get(k)!;
              return { x: p.x + Math.cos(p.heading) * side * o, y: p.y + lift - 0.02, z: p.z - Math.sin(p.heading) * side * o, h: p.heading };
            });
            const frames = railFrames(posts, side);
            // a chi appartiene ogni pezzo di lama: alla mattonella del paletto da cui parte
            const ownedPost = posts.map((p) => own(p.x, p.z));
            const segOwned = (j: number) => {
              const pi = Math.min(posts.length - 1, Math.max(0, j - 3));
              return j < 3 ? ownedPost[0] : ownedPost[pi];
            };
            let from = -1;
            for (let j = 0; j < frames.length - 1; j++) {
              if (segOwned(j)) {
                if (from < 0) from = j;
              } else if (from >= 0) {
                sweepBeam(beam, frames.slice(from, j + 1) as RailFrame[]);
                from = -1;
              }
            }
            if (from >= 0) sweepBeam(beam, frames.slice(from) as RailFrame[]);
            posts.forEach((p, i) => {
              if (!ownedPost[i]) return;
              const item = { x: p.x, y: p.y - 0.08, z: p.z, ry: sideYaw(p.h, side) };
              items.railPost.push(item);
              if (run[i] % 3 === 0) items.reflector.push(item);
            });
          }
          run = [];
        };
        for (const k of ks) {
          if (want.get(k) && (run.length === 0 || run[run.length - 1] === k - 1)) run.push(k);
          else {
            flush();
            if (want.get(k)) run.push(k);
          }
        }
        flush();
      }
      // delineatori ogni 40 m (20 in curva), solo fuori dai paesi e dove non c'è guardrail
      for (let j = 1; j * 10 < L - 8; j++) {
        const s = j * 10;
        if (s < endA + 8 || s > L - endB - 8) continue;
        if (j % 2 !== 0) continue;
        const p = graph.pose(id, s, 1);
        if (!near(p.x, p.z, 2)) continue;
        if (j % 4 !== 0 && bendAt(graph, e, s) < 0.35) continue;
        if (URBAN.has(field.terrain.cover(p.x, p.z))) continue;
        const k = Math.round((s - 2) / RAIL_POST_STEP);
        for (const side of [1, -1] as const) {
          let rail = false;
          for (let q = k - 3; q <= k + 3; q++) if (wantBy[side].get(q)) rail = true;
          if (rail) continue;
          const off = e.hw + 0.75;
          const x = p.x + Math.cos(p.heading) * side * off;
          const z = p.z - Math.sin(p.heading) * side * off;
          if (!own(x, z)) continue;
          items.delineator.push({ x, y: p.y + lift - 0.12, z, ry: sideYaw(p.heading, side) });
        }
      }
    }

    // --- ponti: ringhiera sul cordolo, montanti ogni 2 m ---
    if (bridge && !tun) {
      for (let s = 1; s < L - 0.5; s += 2) {
        const p = graph.pose(id, s, 1);
        for (const side of [1, -1] as const) {
          const x = p.x + Math.cos(p.heading) * side * (e.hw + 0.4);
          const z = p.z - Math.sin(p.heading) * side * (e.hw + 0.4);
          if (own(x, z)) items.bridgePost.push({ x, y: p.y + lift + 0.3, z, ry: p.heading });
        }
      }
      for (const pts of runsInside(graph, e, x0, z0, x1, z1, 3)) {
        if (pts.length < 2) continue;
        for (const side of [1, -1]) {
          const off = side * (e.hw + 0.4);
          for (const [y0, y1] of [
            [lift + 1.32, lift + 1.4],
            [lift + 0.86, lift + 0.92],
          ]) {
            let prev = -1;
            for (const p of pts) {
              const lx = Math.cos(p.h);
              const lz = -Math.sin(p.h);
              const b = beam.pos.length / 3;
              beam.pos.push(p.x + lx * off, p.y + y0, p.z + lz * off, p.x + lx * off, p.y + y1, p.z + lz * off);
              if (prev >= 0) beam.idx.push(prev, b, prev + 1, prev + 1, b, b + 1);
              prev = b;
            }
          }
        }
      }
    }

    // --- piste ciclabili: la bicicletta per terra ogni 80 m ---
    if (e.cls === CLS.cycleway && !tun) {
      for (let s = 40; s < L - 20; s += 80) {
        const p = graph.pose(id, s, 1);
        if (!own(p.x, p.z)) continue;
        const w = Math.min(0.9, e.hw * 0.7);
        quad(decal, graph, e, 1, s - 0.9, 1.8, w / 2, -w / 2, markLift, [DECAL.bici / 4, (DECAL.bici + 1) / 4]);
      }
    }

    if (road && !tun) {
      // --- strisce pedonali da OSM ---
      const cross = ix.crossings.get(id) ?? [];
      for (const s of cross) {
        const p = graph.pose(id, s, 1);
        if (!own(p.x, p.z)) continue;
        const len = e.cls <= CLS.secondary ? 4 : 3;
        for (let l = -e.hw + 0.35; l + 0.5 <= e.hw - 0.3 + 1e-6; l += 1) quad(paint, graph, e, 1, s - len / 2, len, l + 0.5, l, markLift);
        if (e.hw >= 2.4 && e.cls <= CLS.residential) {
          if (graph.allowed(id, 1)) signRight(e, 1, s - 2.5, 'pedoni');
          if (graph.allowed(id, -1)) signRight(e, -1, s + 2.5, 'pedoni');
        }
      }

      // --- semafori a metà strada (pedonali): uno per verso, linea d'arresto, strisce se OSM non le ha ---
      for (const sig of ix.signalMid.get(id) ?? []) {
        for (const dir of [1, -1] as Dir[]) {
          if (!graph.allowed(id, dir)) continue;
          const s = sig.s - dir * 4;
          if (s < 1 || s > L - 1) continue;
          const p = graph.pose(id, s, dir);
          const x = p.x - Math.cos(p.heading) * (e.hw + 0.6);
          const z = p.z + Math.sin(p.heading) * (e.hw + 0.6);
          if (!own(x, z)) continue;
          items.signal.push({ x, y: p.y + lift - 0.1, z, ry: p.heading });
          stopLine(paint, graph, e, dir, s, oneway, markLift);
        }
        const p = graph.pose(id, sig.s, 1);
        if (own(p.x, p.z) && !cross.some((c) => Math.abs(c - sig.s) < 6)) {
          for (let l = -e.hw + 0.35; l + 0.5 <= e.hw - 0.3 + 1e-6; l += 1) quad(paint, graph, e, 1, sig.s - 1.5, 3, l + 0.5, l, markLift);
        }
      }

      // --- ai capi: semaforo, rotatoria, stop o dare precedenza ---
      for (const dir of [1, -1] as Dir[]) {
        if (!graph.allowed(id, dir)) continue;
        const node = dir > 0 ? e.b : e.a;
        const deg = graph.adjStart[node + 1] - graph.adjStart[node];
        if (deg < 3 && !ix.mini.has(node)) continue;
        const clear = Math.max(3.5, junctionClear(graph, node, id) || 3.5);
        if (L < clear + 6) continue;
        const sLine = dir > 0 ? L - clear : clear;
        const pLine = graph.pose(id, sLine, dir);
        const mine = own(pLine.x, pLine.z);
        if (ix.signalNodes.has(node)) {
          // semaforo all'incrocio: palo a destra, lanterna verso chi arriva, sempre verde
          const x = pLine.x - Math.cos(pLine.heading) * (e.hw + 0.6);
          const z = pLine.z + Math.sin(pLine.heading) * (e.hw + 0.6);
          if (own(x, z)) items.signal.push({ x, y: pLine.y + lift - 0.1, z, ry: pLine.heading });
          if (mine) stopLine(paint, graph, e, dir, sLine, oneway, markLift);
          continue;
        }
        if (ring) continue;
        const entry = ix.ringNodes.has(node);
        let mark: 'yield' | 'stop' | null = null;
        let at = sLine;
        if (entry || ix.mini.has(node)) mark = 'yield';
        else {
          const osm = (ix.yields.get(id) ?? []).find((y) => y.toward === dir && Math.abs((dir > 0 ? L - y.s : y.s) - clear) < 40);
          if (osm) {
            mark = osm.stop ? 'stop' : 'yield';
            // il cartello OSM sta sulla linea; se è sul nodo, la linea va dove finisce l'altra strada
            const fromEnd = dir > 0 ? L - osm.s : osm.s;
            if (fromEnd > clear) at = osm.s;
          } else {
            // senza dati: chi arriva da una strada molto minore dà precedenza alla maggiore
            let major: number = CLS.cycleway;
            for (let i = graph.adjStart[node]; i < graph.adjStart[node + 1]; i++) {
              const o = graph.edges[graph.adjEdges[i]];
              if (o.id !== id && o.cls !== CLS.cycleway) major = Math.min(major, o.cls);
            }
            if (e.cls >= major + 2 || (e.cls > major && major <= CLS.primary)) mark = 'yield';
          }
        }
        if (!mark) continue;
        const pAt = graph.pose(id, at, dir);
        if (!own(pAt.x, pAt.z)) continue;
        if (mark === 'stop') {
          stopLine(paint, graph, e, dir, at, oneway, markLift);
          const w = Math.min(2.2, (oneway ? e.hw * 2 : e.hw) * 0.8);
          const lc = oneway ? 0 : -e.hw / 2;
          quad(decal, graph, e, dir, at - dir * 3.4, 2.4, lc + w / 2, lc - w / 2, markLift, [DECAL.stop / 4, (DECAL.stop + 1) / 4]);
          signRight(e, dir, at - dir * 0.5, 'stop');
        } else {
          teeth(paint, graph, e, dir, at, oneway, markLift);
          signRight(e, dir, at - dir * 0.5, 'precedenza');
          if (entry && L > clear + 30) signRight(e, dir, at - dir * 22, 'rotatoria');
        }
      }

      // --- cippi delle statali e delle provinciali, uno ogni chilometro ---
      const ref = /^(S[PSR])\s*([0-9]+[a-z]?)/i.exec(e.ref);
      if (ref && L > 500) {
        for (let s = 400 + Math.floor(hash2(id, 1) * 200); s < L - 60; s += 1000) {
          const p = graph.pose(id, s, 1);
          const off = e.hw + 1.1;
          const x = p.x - Math.cos(p.heading) * off;
          const z = p.z + Math.sin(p.heading) * off;
          if (!own(x, z)) continue;
          stones.push({ x, y: p.y - 0.15, z, h: p.heading, ref: `${ref[1].toUpperCase()} ${ref[2]}`, cap: ref[1].toUpperCase() === 'SS' ? CAP_SS : CAP_SP });
        }
      }
    }
    if (++count % 30 === 0) yield;
  }

  // --- mini rotatorie dipinte: un disco bianco sull'incrocio ---
  for (const node of ix.mini) {
    const x = graph.nodeX[node];
    const z = graph.nodeZ[node];
    if (!own(x, z)) continue;
    let cls: number = CLS.cycleway;
    for (let i = graph.adjStart[node]; i < graph.adjStart[node + 1]; i++) cls = Math.min(cls, graph.edges[graph.adjEdges[i]].cls);
    const y = graph.nodeY[node] + roadLift(cls) + 0.02;
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      triUp(paint, { x, y, z }, { x: x + Math.cos(a0) * 1.6, y, z: z + Math.sin(a0) * 1.6 }, { x: x + Math.cos(a1) * 1.6, y, z: z + Math.sin(a1) * 1.6 });
    }
  }
  yield;

  // --- aiuole delle rotatorie ---
  for (const r of ix.rings) {
    if (!own(r.cx, r.cz)) continue;
    const inner = r.pts.map((p) => {
      const dx = p.x - r.cx;
      const dz = p.z - r.cz;
      const d = Math.hypot(dx, dz) || 1;
      return { x: p.x, y: p.y + r.lift, z: p.z, ux: dx / d, uz: dz / d, rr: d - r.hw - 0.3 };
    });
    const meanR = inner.reduce((s, p) => s + p.rr, 0) / inner.length;
    let cy = 0;
    for (const p of inner) cy += p.y;
    cy /= inner.length;
    if (meanR < 1.6) {
      // troppo piccola per un'aiuola: un disco dipinto
      const rad = Math.max(1.2, meanR + 0.4);
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2;
        const a1 = ((i + 1) / 16) * Math.PI * 2;
        triUp(paint, { x: r.cx, y: cy + 0.02, z: r.cz }, { x: r.cx + Math.cos(a0) * rad, y: cy + 0.02, z: r.cz + Math.sin(a0) * rad }, { x: r.cx + Math.cos(a1) * rad, y: cy + 0.02, z: r.cz + Math.sin(a1) * rad });
      }
      continue;
    }
    const n = inner.length;
    const ringAt = (p: (typeof inner)[number], rr: number, y: number) => ({ x: r.cx + p.ux * rr, y, z: r.cz + p.uz * rr });
    const top = 0.18;
    const mound = cy + top + Math.min(0.9, meanR * 0.06);
    for (let i = 0; i < n; i++) {
      const p = inner[i];
      const q = inner[(i + 1) % n];
      const rp = Math.max(0.5, p.rr);
      const rq = Math.max(0.5, q.rr);
      // fianco del cordolo, dall'asfalto in su
      const a = ringAt(p, rp, p.y - 0.02);
      const b = ringAt(q, rq, q.y - 0.02);
      const c = ringAt(p, rp, p.y + top);
      const d = ringAt(q, rq, q.y + top);
      const k = island.vertex(a.x, a.y, a.z, 0, 0, CURB_FACE);
      island.vertex(b.x, b.y, b.z, 0, 0, CURB_FACE);
      island.vertex(c.x, c.y, c.z, 0, 0, CURB_FACE);
      island.vertex(d.x, d.y, d.z, 0, 0, CURB_FACE);
      island.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      // testa del cordolo (25 cm), aiuola fiorita, prato fino al centro un po' rialzato
      const c2 = ringAt(p, rp - 0.25, p.y + top);
      const d2 = ringAt(q, rq - 0.25, q.y + top);
      triUp(island, c, d, c2, undefined, CURB);
      triUp(island, d, d2, c2, undefined, CURB);
      const bedR = meanR > 4 ? 1.1 : 0.5;
      const c3 = ringAt(p, Math.max(0.3, rp - 0.25 - bedR), p.y + top + 0.05);
      const d3 = ringAt(q, Math.max(0.3, rq - 0.25 - bedR), q.y + top + 0.05);
      triUp(island, c2, d2, c3, undefined, BED);
      triUp(island, d2, d3, c3, undefined, BED);
      triUp(island, c3, d3, { x: r.cx, y: mound, z: r.cz }, undefined, i % 2 ? GRASS : GRASS2);
    }
    // cespugli e fiori lungo l'aiuola, ogni 2,2 m circa
    if (meanR > 3) {
      const rr = meanR - 0.25 - 0.55;
      const count2 = Math.max(6, Math.floor((2 * Math.PI * rr) / 2.2));
      for (let i = 0; i < count2; i++) {
        const a = (i / count2) * Math.PI * 2;
        const h = hash2(r.cx + i, r.cz - i);
        items.shrub.push({ x: r.cx + Math.cos(a) * rr, y: cy + top, z: r.cz + Math.sin(a) * rr, ry: h * 6.28, s: 0.7 + h * 0.6, c: FLOWERS[Math.floor(h * FLOWERS.length) % FLOWERS.length] });
      }
    }
    // in mezzo: un albero, o sulle grandi una ruota di bicicletta in corten
    const pick = hash2(r.cx * 0.13, r.cz * 0.29);
    if (meanR > 9 && pick < 0.45) propParts.push(placed(sculptureGeometryShared(), r.cx, mound - 0.1, r.cz, pick * 40));
    else if (meanR > 4) trees.push({ kind: pick < 0.7 ? 'broadleaf' : 'cypress', x: r.cx, y: mound - 0.1, z: r.cz, s: Math.min(1.2, 0.55 + meanR * 0.05), r: pick * 6.28, tint: pick });
  }
  yield;

  // --- i luoghi da passare ---
  for (const poi of features.pois) {
    if (!own(poi.x, poi.z) || poi.building) continue;
    let geo = poiGeoCache.get(poi.kind);
    if (geo === undefined) {
      geo = poiGeometry(poi.kind);
      poiGeoCache.set(poi.kind, geo);
    }
    const e = graph.edges[poi.edge];
    if (!e) continue;
    const road = graph.pose(poi.edge, Math.min(e.length, poi.s), 1);
    let dx = poi.x - road.x;
    let dz = poi.z - road.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.05) {
      dx = Math.cos(road.heading);
      dz = -Math.sin(road.heading);
      d = 1;
    }
    const min = e.hw + (POI_SETBACK[poi.kind] ?? 2);
    const k = d < min ? min / d : 1;
    const x = road.x + dx * k;
    const z = road.z + dz * k;
    // +z del modellino lontano dalla strada: la facciata (−z) guarda chi passa
    const away = Math.atan2(dx, dz);
    const y = field.height(x, z, spec.spacing) - 0.05;
    if (geo) propParts.push(placed(geo, x, y, z, poi.kind === 'belvedere' ? away + Math.PI : away));
    if (poi.kind === 'bici') addSign('bici', x - (dx / d) * 1.2 + Math.cos(away) * 1.4, y, z - (dz / d) * 1.2 - Math.sin(away) * 1.4, away);
    if (poi.kind === 'belvedere') {
      // il cartello marrone a bordo strada, dalla parte del belvedere, per chi arriva nei due versi
      const off = e.hw + 1.1;
      const sx = road.x + (dx / d) * off;
      const sz = road.z + (dz / d) * off;
      addSign('belvedere', sx, road.y - 0.05, sz, road.heading, false);
      addSign('belvedere', sx, road.y - 0.05, sz, road.heading + Math.PI, false, false);
    }
  }

  return {
    beam: triGeometry(beam),
    paint: paint.build(),
    decal: decal.build(),
    island: island.build(),
    signs: mergeOrNull(signParts),
    signBacks: mergeOrNull(backParts),
    props: mergeOrNull(propParts),
    stones,
    items,
    trees,
  };
}

let sculpture: THREE.BufferGeometry | null = null;
/** La scultura delle rotatorie grandi, una geometria per tutte. */
function sculptureGeometryShared(): THREE.BufferGeometry {
  if (!sculpture) sculpture = sculptureGeometry();
  return sculpture;
}
