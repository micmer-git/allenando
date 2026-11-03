import * as THREE from 'three';
import { groundColor, hash2 } from '@/world/builders';
import { CLS, FLAG, type Edge, type WorldGraph } from './graph';
import type { WorldField } from './field';
import { BUILDING_KIND, COVER, type Building, type Place, type WorldFeatures } from './world';
import { addBuilding, BLANK_UV, ringArea, Tris } from './buildings';

/*
 * Le mattonelle del mondo vicino al ciclista: terreno raccordato alle strade, nastri d'asfalto
 * (ponti e gallerie compresi), edifici estrusi dalle impronte OSM, alberi dove il suolo è bosco,
 * fiumi e binari. Tutto si calcola a fette (generatori) per non bloccare i fotogrammi.
 *
 * Convenzione dei nastri come in world/builders.ts: per una direzione h il vettore laterale
 * L = (cos h, 0, −sin h) punta a SINISTRA di chi va nel verso dell'arco.
 */

export interface TileSpec {
  tx: number;
  tz: number;
  x0: number;
  z0: number;
  size: number;
  spacing: number;
  trees: number;
  buildings: boolean;
  /** distanza dal ciclista in mattonelle: le lontane hanno meno dettagli */
  ring: number;
}

export interface TileMeshes {
  terrain: THREE.BufferGeometry;
  asphalt: THREE.BufferGeometry | null;
  stone: THREE.BufferGeometry | null;
  cycle: THREE.BufferGeometry | null;
  paint: THREE.BufferGeometry | null;
  verge: THREE.BufferGeometry | null;
  concrete: THREE.BufferGeometry | null;
  rails: THREE.BufferGeometry | null;
  posts: { x: number; y: number; z: number; h: number }[];
  tunnel: THREE.BufferGeometry | null;
  buildings: BuildingMeshes;
  water: THREE.BufferGeometry | null;
  trees: { kind: TreeKind; x: number; y: number; z: number; s: number; r: number; tint: number }[];
}

export type TreeKind = 'spruce' | 'larch' | 'broadleaf' | 'rock' | 'cypress';

/** Un accumulatore di triangoli, con colori facoltativi. */
class Mesh {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get empty(): boolean {
    return this.idx.length === 0;
  }
  vertex(x: number, y: number, z: number, u = 0, v = 0, c?: THREE.Color): number {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    if (c) this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  build(normals = true): THREE.BufferGeometry | null {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    if (normals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

interface P {
  x: number;
  y: number;
  z: number;
  h: number;
  d: number;
}

/** Striscia fra due scostamenti laterali (sinistra positiva), con il proprio sollevamento. */
function strip(m: Mesh, pts: P[], a: number, liftA: number, b: number, liftB: number, uvLen = 8, keep?: (p: P) => boolean): void {
  let prev = -1;
  for (const p of pts) {
    if (keep && !keep(p)) {
      prev = -1;
      continue;
    }
    const lx = Math.cos(p.h);
    const lz = -Math.sin(p.h);
    const i = m.vertex(p.x + lx * a, p.y + liftA, p.z + lz * a, 0, p.d / uvLen);
    m.vertex(p.x + lx * b, p.y + liftB, p.z + lz * b, 1, p.d / uvLen);
    if (prev >= 0) {
      if (b < a) m.idx.push(prev, prev + 1, i, prev + 1, i + 1, i);
      else m.idx.push(prev, i, prev + 1, prev + 1, i, i + 1);
    }
    prev = i;
  }
}

/** Le corse dell'arco dentro il rettangolo, campionate ogni `step` metri nel verso dell'arco. */
function runsInside(graph: WorldGraph, e: Edge, x0: number, z0: number, x1: number, z1: number, step: number): P[][] {
  const out: P[][] = [];
  let cur: P[] | null = null;
  let lastOut: P | null = null;
  const n = Math.max(1, Math.ceil(e.length / step));
  for (let k = 0; k <= n; k++) {
    const s = (e.length * k) / n;
    const pose = graph.pose(e.id, s, 1);
    const p = { x: pose.x, y: pose.y, z: pose.z, h: pose.heading, d: s };
    const inside = p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
    if (inside) {
      if (!cur) {
        cur = lastOut ? [lastOut] : [];
        out.push(cur);
      }
      cur.push(p);
    } else if (cur) {
      // un punto oltre il bordo: le mattonelle vicine si toccano senza fessure
      cur.push(p);
      cur = null;
    }
    lastOut = inside ? null : p;
  }
  return out;
}

const tmpC = new THREE.Color();
const COVER_COLOR: Record<number, THREE.Color> = {
  [COVER.forest]: new THREE.Color('#355f2e'),
  [COVER.residential]: new THREE.Color('#8f8b7e'),
  [COVER.industrial]: new THREE.Color('#8a8984'),
  [COVER.park]: new THREE.Color('#6e9a45'),
  [COVER.rock]: new THREE.Color('#8b867d'),
  [COVER.water]: new THREE.Color('#6d7f7a'),
  [COVER.farmland]: new THREE.Color('#93a356'),
  [COVER.glacier]: new THREE.Color('#e9eef3'),
};

/** Il terreno della mattonella, con un bordo che scende di 25 m per chiudere le fessure col terreno lontano. */
export function* terrainJob(field: WorldField, spec: TileSpec): Generator<void, THREE.BufferGeometry, void> {
  const n = Math.round(spec.size / spec.spacing);
  const side = n + 1;
  const pos = new Float32Array((side * side + side * 4) * 3);
  const col = new Float32Array((side * side + side * 4) * 3);
  const uv = new Float32Array((side * side + side * 4) * 2);
  const dist = new Float32Array(side * side);
  const wet = new Uint8Array(side * side);
  for (let j = 0; j < side; j++) {
    const z = spec.z0 + j * spec.spacing;
    for (let i = 0; i < side; i++) {
      const x = spec.x0 + i * spec.spacing;
      const k = j * side + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = field.height(x, z, spec.spacing);
      pos[k * 3 + 2] = z;
      dist[k] = field.lastRoadDist();
      wet[k] = field.lastWater() ? 1 : 0;
    }
    if (j % 6 === 5) yield;
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // gonna sui quattro lati
  let v = side * side;
  const border: number[][] = [
    Array.from({ length: side }, (_, i) => i),
    Array.from({ length: side }, (_, i) => (side - 1) * side + i),
    Array.from({ length: side }, (_, j) => j * side),
    Array.from({ length: side }, (_, j) => j * side + side - 1),
  ];
  const skirtStart: number[] = [];
  for (const line of border) {
    skirtStart.push(v);
    for (const k of line) {
      pos[v * 3] = pos[k * 3];
      pos[v * 3 + 1] = pos[k * 3 + 1] - 25;
      pos[v * 3 + 2] = pos[k * 3 + 2];
      uv[v * 2] = pos[k * 3] / DETAIL_M;
      uv[v * 2 + 1] = pos[k * 3 + 2] / DETAIL_M;
      v++;
    }
  }
  border.forEach((line, s) => {
    const base = skirtStart[s];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const c = base + i;
      const d = base + i + 1;
      idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let k = 0; k < side * side; k++) {
    const x = pos[k * 3];
    const z = pos[k * 3 + 2];
    const y = pos[k * 3 + 1];
    const noise = hash2(Math.floor(x / 23), Math.floor(z / 23));
    groundColor(c, y, nrm.getY(k), nrm.getZ(k), noise, 99);
    uv[k * 2] = x / DETAIL_M;
    uv[k * 2 + 1] = z / DETAIL_M;
    const cov = field.terrain.cover(x, z);
    const cc = cov === COVER.farmland || cov === COVER.open ? parcelColor(x, z, cov) : COVER_COLOR[cov];
    if (cc && cov !== COVER.water) c.lerp(tmpC.copy(cc).offsetHSL(0, 0, (noise - 0.5) * 0.06), cov === COVER.rock ? 0.5 : cov === COVER.open ? 0.45 : 0.72);
    if (wet[k]) c.copy(COVER_COLOR[COVER.water]);
    // terra battuta e marciapiede ai bordi della carreggiata
    if (dist[k] < 5) c.lerp(tmpC.set(cov === COVER.residential || cov === COVER.industrial ? '#a7a39a' : '#9c8b6c'), 1 - dist[k] / 5);
    col[k * 3] = c.r;
    col[k * 3 + 1] = c.g;
    col[k * 3 + 2] = c.b;
  }
  for (let s = 0; s < 4; s++) {
    const line = border[s];
    for (let i = 0; i < line.length; i++) {
      const src = line[i] * 3;
      const dst = (skirtStart[s] + i) * 3;
      col[dst] = col[src] * 0.8;
      col[dst + 1] = col[src + 1] * 0.8;
      col[dst + 2] = col[src + 2] * 0.8;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

/** La grana del suolo si ripete ogni 12 m. */
const DETAIL_M = 12;

/**
 * Campi a mosaico: appezzamenti di 70 × 45 m (orientati come la centuriazione della pianura) con colture
 * diverse — mais, grano, arato, erba medica. I prati di montagna variano poco, tra sfalcio e pascolo.
 */
const FIELDS = ['#8ea24f', '#a9a85a', '#c2b26a', '#7f9a46', '#9a8a66', '#6f9440', '#b4b46c'].map((h) => new THREE.Color(h));
const MEADOWS = ['#7f9c4a', '#8aa652', '#76944a', '#93a95b'].map((h) => new THREE.Color(h));
const parcelOut = new THREE.Color();
export function parcelColor(x: number, z: number, cov: number): THREE.Color {
  const a = 0.38;
  const u = Math.floor((x * Math.cos(a) + z * Math.sin(a)) / 70);
  const w = Math.floor((-x * Math.sin(a) + z * Math.cos(a)) / 45);
  const h = hash2(u * 1.31 + 7, w * 0.77 - 3);
  const list = cov === COVER.farmland ? FIELDS : MEADOWS;
  return parcelOut.copy(list[Math.floor(h * list.length) % list.length]);
}

/** Strade, ponti, gallerie, guardrail della mattonella. */
export function* roadsJob(graph: WorldGraph, field: WorldField, spec: TileSpec): Generator<void, Omit<TileMeshes, 'terrain' | 'buildings' | 'trees' | 'water' | 'rails'>, void> {
  const asphalt = new Mesh();
  const stone = new Mesh();
  const cycle = new Mesh();
  const paint = new Mesh();
  const verge = new Mesh();
  const concrete = new Mesh();
  const tunnel = new Mesh();
  const rail = new Mesh();
  const posts: TileMeshes['posts'] = [];
  const x0 = spec.x0;
  const z0 = spec.z0;
  const x1 = spec.x0 + spec.size;
  const z1 = spec.z0 + spec.size;
  const ids = new Set<number>();
  for (let x = x0 - 50; x <= x1 + 50; x += 90) {
    for (let z = z0 - 50; z <= z1 + 50; z += 90) {
      // il grafo ha celle da 100 m: basta chiedere i segmenti vicini a una maglia di punti
      collectEdges(graph, x, z, ids);
    }
  }
  let count = 0;
  for (const id of ids) {
    const e = graph.edges[id];
    const runs = runsInside(graph, e, x0, z0, x1, z1, e.cls >= CLS.residential ? 2.5 : 3);
    const bridge = (e.flags & FLAG.bridge) !== 0;
    const tun = (e.flags & FLAG.tunnel) !== 0;
    const hw = e.hw;
    // le strade importanti sopra le minori agli incroci, di un centimetro e mezzo per classe
    const lift = 0.03 + (7 - e.cls) * 0.015;
    const surface = e.flags & FLAG.cobbles || e.cls === CLS.pedestrian ? stone : e.cls === CLS.cycleway ? cycle : asphalt;
    const nearEnd = (p: P) => p.d > 10 && p.d < e.length - 10;
    for (const pts of runs) {
      if (pts.length < 2) continue;
      strip(surface, pts, hw, lift, -hw, lift, surface === stone ? 4 : 10);
      if (e.cls <= CLS.unclassified && !tun) {
        strip(paint, pts, hw - 0.12, lift + 0.012, hw - 0.26, lift + 0.012, 8, nearEnd);
        strip(paint, pts, -hw + 0.26, lift + 0.012, -hw + 0.12, lift + 0.012, 8, nearEnd);
      }
      if (e.cls <= CLS.tertiary && hw >= 2.7 && !(e.flags & (FLAG.oneway | FLAG.onewayRev))) {
        strip(paint, pts, 0.07, lift + 0.014, -0.07, lift + 0.014, 8, (p) => nearEnd(p) && p.d % 12 < 4.5);
      }
      if (bridge) {
        // impalcato: bordo in cemento, parapetti, pile fino al terreno
        strip(concrete, pts, hw + 0.6, lift + 0.9, hw, lift, 8);
        strip(concrete, pts, -hw, lift, -hw - 0.6, lift + 0.9, 8);
        strip(concrete, pts, hw + 0.6, lift + 0.9, hw + 0.6, -1.6, 8);
        strip(concrete, pts, -hw - 0.6, -1.6, -hw - 0.6, lift + 0.9, 8);
        strip(concrete, pts, -hw - 0.6, -1.6, hw + 0.6, -1.6, 8);
        for (const p of pts) {
          if (Math.floor(p.d / 32) === Math.floor((p.d - 3) / 32)) continue;
          const ground = field.terrain.height(p.x, p.z);
          if (p.y - ground < 4) continue;
          pier(concrete, p, Math.max(1.2, hw * 0.45), p.y - 1.6, ground - 2);
        }
      } else if (tun) {
        // galleria: volta a botte sopra la carreggiata
        tunnelVault(tunnel, pts, hw + 1.2, lift);
      } else {
        strip(verge, pts, hw + 0.8, lift - 0.1, hw, lift - 0.02, 8);
        strip(verge, pts, -hw, lift - 0.02, -hw - 0.8, lift - 0.1, 8);
        strip(verge, pts, hw + 2, -3.4, hw + 0.8, lift - 0.1, 8);
        strip(verge, pts, -hw - 0.8, lift - 0.1, -hw - 2, -3.4, 8);
        if (e.cls <= CLS.unclassified) {
          for (const s of [1, -1]) {
            const run: TileMeshes['posts'] = [];
            for (const p of pts) {
              if (Math.floor(p.d / 4) === Math.floor((p.d - 3) / 4)) continue;
              const lx = Math.cos(p.h) * s;
              const lz = -Math.sin(p.h) * s;
              const probe = field.terrain.height(p.x + lx * (hw + 6), p.z + lz * (hw + 6));
              if (p.y - probe > 3.2) run.push({ x: p.x + lx * (hw + 0.7), y: p.y + lift, z: p.z + lz * (hw + 0.7), h: p.h });
              else if (run.length) {
                railRun(rail, run);
                posts.push(...run);
                run.length = 0;
              }
            }
            railRun(rail, run);
            posts.push(...run);
          }
        }
      }
    }
    if (++count % 40 === 0) yield;
  }
  return {
    asphalt: asphalt.build(),
    stone: stone.build(),
    cycle: cycle.build(),
    paint: paint.build(),
    verge: verge.build(),
    concrete: mergeOrNull(concrete.build(), rail.build()),
    posts,
    tunnel: tunnel.build(),
  };
}

function mergeOrNull(a: THREE.BufferGeometry | null, b: THREE.BufferGeometry | null): THREE.BufferGeometry | null {
  if (!a) return b;
  if (!b) return a;
  const pa = a.attributes.position.array as Float32Array;
  const pb = b.attributes.position.array as Float32Array;
  const ua = a.attributes.uv?.array as Float32Array | undefined;
  const ia = a.index!.array as ArrayLike<number>;
  const ib = b.index!.array as ArrayLike<number>;
  const pos = new Float32Array(pa.length + pb.length);
  pos.set(pa);
  pos.set(pb, pa.length);
  const uv = new Float32Array((pos.length / 3) * 2);
  if (ua) uv.set(ua);
  const idx: number[] = Array.from(ia);
  const off = pa.length / 3;
  for (let i = 0; i < ib.length; i++) idx.push(ib[i] + off);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  a.dispose();
  b.dispose();
  return g;
}

/** La lama del guardrail fra paletti consecutivi dello stesso lato. */
function railRun(m: Mesh, posts: TileMeshes['posts']): void {
  for (let i = 1; i < posts.length; i++) {
    const a = posts[i - 1];
    const b = posts[i];
    const gap = Math.hypot(b.x - a.x, b.z - a.z);
    if (gap > 6.5 || gap < 0.5) continue;
    const k = m.vertex(a.x, a.y + 0.5, a.z);
    m.vertex(a.x, a.y + 0.82, a.z);
    m.vertex(b.x, b.y + 0.5, b.z);
    m.vertex(b.x, b.y + 0.82, b.z);
    m.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
}

function pier(m: Mesh, p: P, w: number, top: number, bottom: number): void {
  const fx = Math.sin(p.h) * 0.8;
  const fz = Math.cos(p.h) * 0.8;
  const lx = Math.cos(p.h) * w;
  const lz = -Math.sin(p.h) * w;
  const corners = [
    [p.x + lx + fx, p.z + lz + fz],
    [p.x - lx + fx, p.z - lz + fz],
    [p.x - lx - fx, p.z - lz - fz],
    [p.x + lx - fx, p.z + lz - fz],
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    const k = m.vertex(ax, top, az);
    m.vertex(bx, top, bz);
    m.vertex(ax, bottom, az);
    m.vertex(bx, bottom, bz);
    m.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
}

function tunnelVault(m: Mesh, pts: P[], r: number, lift: number): void {
  const seg = 8;
  let prev = -1;
  for (const p of pts) {
    const lx = Math.cos(p.h);
    const lz = -Math.sin(p.h);
    const base = m.pos.length / 3;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI;
      const off = Math.cos(a) * r;
      const up = Math.sin(a) * (r * 0.95) + 0.4;
      m.vertex(p.x + lx * off, p.y + lift + up, p.z + lz * off, s / seg, p.d / 6);
    }
    if (prev >= 0) {
      for (let s = 0; s < seg; s++) {
        const a = prev + s;
        const b = base + s;
        m.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    prev = base;
  }
}

function collectEdges(graph: WorldGraph, x: number, z: number, out: Set<number>): void {
  for (const id of graph.edgesNear(x, z, 70)) out.add(id);
}

// ---------- edifici ----------

const WALLS = ['#d9c9a8', '#e3d4b5', '#cfb894', '#e8ddc8', '#d6b98f', '#c9b6a0', '#e0cfae', '#bfae97', '#e6c99a', '#d2c3ad'];
const WALL_STONE = '#b9ad98';
const WALL_INDUSTRIAL = ['#b8b8b2', '#a9aba8', '#c4c1b7'];
const ROOFS = [
  ['#a4553a', '#9a4c34', '#b0603f', '#8f4a33'],
  ['#7d7f80', '#8a8b88', '#6f7173'],
  ['#5f8f7d', '#6b9784'],
  ['#5a5d63'],
];

export interface BuildingMeshes {
  /** pareti, timpani e tetti piani: trama delle facciate */
  walls: THREE.BufferGeometry | null;
  /** falde in coppi */
  roofs: THREE.BufferGeometry | null;
}

export function* buildingsJob(field: WorldField, list: Building[], spec: TileSpec): Generator<void, BuildingMeshes, void> {
  const walls = new Tris();
  const roofs = new Tris();
  const wall = new THREE.Color();
  const roof = new THREE.Color();
  const base = new THREE.Color();
  const x1 = spec.x0 + spec.size;
  const z1 = spec.z0 + spec.size;
  let count = 0;
  for (const b of list) {
    const r = b.ring;
    let cx = 0;
    let cz = 0;
    const m = r.length / 2;
    for (let i = 0; i < r.length; i += 2) {
      cx += r[i];
      cz += r[i + 1];
    }
    cx /= m;
    cz /= m;
    if (cx < spec.x0 || cx >= x1 || cz < spec.z0 || cz >= z1) continue;
    // base: il punto più basso del terreno sotto l'impronta, così nessun angolo galleggia
    let low = Infinity;
    for (let i = 0; i < r.length; i += 2) low = Math.min(low, field.height(r[i], r[i + 1], spec.spacing));
    const ground = low - 0.6;
    const seed = hash2(Math.floor(cx), Math.floor(cz));
    const stone = b.kind === BUILDING_KIND.church || b.kind === BUILDING_KIND.tower || b.kind === BUILDING_KIND.castle;
    if (b.kind === BUILDING_KIND.industrial) wall.set(WALL_INDUSTRIAL[Math.floor(seed * 3) % 3]);
    else if (stone) wall.set(WALL_STONE).offsetHSL(0, 0, (seed - 0.5) * 0.08);
    else wall.set(WALLS[Math.floor(seed * WALLS.length) % WALLS.length]);
    const roofSet = ROOFS[b.roof] ?? ROOFS[0];
    roof.set(roofSet[Math.floor(seed * 7) % roofSet.length]).offsetHSL(0, 0, (hash2(cz, cx) - 0.5) * 0.06);
    base.copy(wall).multiplyScalar(0.84);
    // i tetti in coppi sono quasi tutti rossi: il grigio dei dati OSM resta ai tetti piani
    const pitchedRoof = b.roof === 0 || b.kind === BUILDING_KIND.house ? roof : tmpC.set(ROOFS[0][Math.floor(seed * 4) % 4]);
    const { top, shape } = addBuilding(walls, roofs, b, ground, { wall, base, roof, tiles: pitchedRoof, blind: stone || b.kind === BUILDING_KIND.industrial });
    if (b.kind === BUILDING_KIND.tower && m <= 8 && shape === 'flat') {
      // cuspide dei campanili
      const apex = top + Math.min(9, Math.sqrt(Math.abs(ringArea(r))) * 0.9);
      for (let i = 0; i < m; i++) {
        const ax = r[i * 2];
        const az = r[i * 2 + 1];
        const bx = r[((i + 1) % m) * 2];
        const bz = r[((i + 1) % m) * 2 + 1];
        walls.facing(
          { x: ax, y: top, z: az, u: BLANK_UV, v: BLANK_UV },
          { x: bx, y: top, z: bz, u: BLANK_UV, v: BLANK_UV },
          { x: cx, y: apex, z: cz, u: BLANK_UV, v: BLANK_UV },
          [(ax + bx) / 2 - cx, 0.3, (az + bz) / 2 - cz],
          roof,
        );
      }
    }
    if (++count % 150 === 0) yield;
  }
  return { walls: trisGeometry(walls), roofs: trisGeometry(roofs) };
}

function trisGeometry(t: Tris): THREE.BufferGeometry | null {
  if (t.count === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------- alberi ----------

/** Specie plausibile per la quota (fasce prealpine e alpine). */
function species(alt: number, r: number): TreeKind | null {
  if (alt < 650) return r < 0.82 ? 'broadleaf' : r < 0.9 ? 'cypress' : 'spruce';
  if (alt < 1100) return r < 0.62 ? 'broadleaf' : 'spruce';
  if (alt < 1600) return r < 0.2 ? 'broadleaf' : r < 0.85 ? 'spruce' : 'larch';
  if (alt < 2000) return r < 0.55 ? 'spruce' : 'larch';
  if (alt < 2250) return r < 0.4 ? 'larch' : r < 0.6 ? 'rock' : null;
  return r < 0.3 ? 'rock' : null;
}

export function* treesJob(field: WorldField, spec: TileSpec): Generator<void, TileMeshes['trees'], void> {
  const out: TileMeshes['trees'] = [];
  const cell = 25;
  const n = Math.round(spec.size / cell);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = spec.x0 + (i + 0.5) * cell;
      const cz = spec.z0 + (j + 0.5) * cell;
      const cov = field.terrain.cover(cx, cz);
      const per =
        cov === COVER.forest ? spec.trees : cov === COVER.open || cov === COVER.farmland ? spec.trees * 0.07 : cov === COVER.park ? spec.trees * 0.25 : cov === COVER.residential ? spec.trees * 0.05 : cov === COVER.rock ? 0.15 : 0;
      let k = Math.floor(per);
      if (hash2(cx * 0.37, cz * 0.91) < per - k) k++;
      for (let t = 0; t < k; t++) {
        const rx = hash2(cx + t * 13.1, cz - t * 7.7);
        const rz = hash2(cz + t * 3.3, cx + t * 5.9);
        const x = cx + (rx - 0.5) * cell;
        const z = cz + (rz - 0.5) * cell;
        const y = field.height(x, z, spec.spacing);
        if (field.lastRoadDist() < 4 || field.lastWater()) continue;
        const kind = cov === COVER.rock ? 'rock' : species(y, hash2(x * 1.7, z * 2.3));
        if (!kind) continue;
        // pendenza dal terreno: sulle pareti non cresce un bosco
        const sx = field.height(x + 4, z, spec.spacing) - y;
        const sz = field.height(x, z + 4, spec.spacing) - y;
        if (kind !== 'rock' && Math.hypot(sx, sz) / 4 > 1.15) continue;
        const r = hash2(x * 3.1, z * 0.7);
        out.push({ kind, x, y: y - 0.15, z, s: kind === 'rock' ? 0.6 + r * 1.6 : 0.7 + r * 0.75, r: r * Math.PI * 2, tint: hash2(z, x) });
      }
    }
    if (j % 4 === 3) yield;
  }
  return out;
}

// ---------- acqua e binari ----------

export function waterGeometry(features: WorldFeatures, spec: TileSpec): THREE.BufferGeometry | null {
  const m = new Mesh();
  const x0 = spec.x0 - 40;
  const z0 = spec.z0 - 40;
  const x1 = spec.x0 + spec.size + 40;
  const z1 = spec.z0 + spec.size + 40;
  for (const r of features.rivers) {
    const p = r.pts;
    const pts: P[] = [];
    const flush = () => {
      if (pts.length > 1) strip(m, pts, r.hw, 0, -r.hw, 0, 20);
      pts.length = 0;
    };
    let d = 0;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const z = p[i + 1];
      const y = p[i + 2];
      if (i > 0) d += Math.hypot(x - p[i - 3], z - p[i - 2]);
      if (x < x0 || x > x1 || z < z0 || z > z1) {
        flush();
        continue;
      }
      const nx = i + 3 < p.length ? p[i + 3] - x : x - p[i - 3];
      const nz = i + 3 < p.length ? p[i + 4] - z : z - p[i - 2];
      pts.push({ x, y, z, h: Math.atan2(nx, nz), d });
    }
    flush();
  }
  return m.build();
}

export function railsGeometry(field: WorldField, features: WorldFeatures, spec: TileSpec): THREE.BufferGeometry | null {
  const m = new Mesh();
  const x1 = spec.x0 + spec.size;
  const z1 = spec.z0 + spec.size;
  for (const r of features.rails) {
    const p = r.pts;
    const pts: P[] = [];
    let d = 0;
    const flush = () => {
      if (pts.length > 1) {
        strip(m, pts, 1.6, 0.25, -1.6, 0.25, 6);
        strip(m, pts, 0.8, 0.42, 0.66, 0.42, 6);
        strip(m, pts, -0.66, 0.42, -0.8, 0.42, 6);
      }
      pts.length = 0;
    };
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const z = p[i + 1];
      if (i > 0) d += Math.hypot(x - p[i - 3], z - p[i - 2]);
      if (x < spec.x0 - 5 || x > x1 + 5 || z < spec.z0 - 5 || z > z1 + 5) {
        flush();
        continue;
      }
      const nx = i + 3 < p.length ? p[i + 3] - x : x - p[i - 3];
      const nz = i + 3 < p.length ? p[i + 4] - z : z - p[i - 2];
      // i binari seguono il terreno raccordato, un filo sopra
      pts.push({ x, y: field.height(x, z, spec.spacing), z, h: Math.atan2(nx, nz), d });
    }
    flush();
  }
  return m.build();
}

// ---------- arredo: lampioni e cartelli d'inizio paese ----------

export interface Furniture {
  /** lampioni: posizione al piede, rotazione del braccio verso la strada */
  lamps: { x: number; y: number; z: number; h: number }[];
  /** cartelli bianchi col nome del paese; h è la direzione di chi entra */
  towns: { x: number; y: number; z: number; h: number; name: string }[];
}

const URBAN = new Set<number>([COVER.residential, COVER.industrial]);

/**
 * Lampioni ogni 30 m sulle strade dei paesi (un lato, alternato), e il cartello col nome dove una
 * strada entra nell'abitato. Il nome è quello del paese più vicino nei dati OSM, entro 1,5 km.
 */
export function* furnitureJob(graph: WorldGraph, field: WorldField, places: Place[], spec: TileSpec): Generator<void, Furniture, void> {
  const lamps: Furniture['lamps'] = [];
  const towns: Furniture['towns'] = [];
  const x0 = spec.x0;
  const z0 = spec.z0;
  const x1 = spec.x0 + spec.size;
  const z1 = spec.z0 + spec.size;
  const ids = new Set<number>();
  for (let x = x0 - 50; x <= x1 + 50; x += 90) for (let z = z0 - 50; z <= z1 + 50; z += 90) collectEdges(graph, x, z, ids);
  const named = places.filter((p) => p.kind === 'city' || p.kind === 'town' || p.kind === 'village' || p.kind === 'hamlet');
  const nearestTown = (x: number, z: number): string | null => {
    let best: Place | null = null;
    let bd = 1500;
    for (const p of named) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best?.name ?? null;
  };
  const inside = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1;
  let count = 0;
  for (const id of ids) {
    const e = graph.edges[id];
    if (e.cls > CLS.residential || e.flags & FLAG.tunnel) continue;
    const step = 10;
    const n = Math.max(1, Math.floor(e.length / step));
    const urban: boolean[] = [];
    for (let k = 0; k <= n; k++) {
      const p = graph.pose(e.id, (e.length * k) / n, 1);
      urban.push(URBAN.has(field.terrain.cover(p.x, p.z)));
    }
    // lampioni nei tratti urbani, lontano dalle estremità (gli incroci li hanno già)
    if (!(e.flags & FLAG.bridge)) {
      for (let s = 15; s < e.length - 10; s += 30) {
        const k = Math.round((s / e.length) * n);
        if (!urban[k]) continue;
        const p = graph.pose(e.id, s, 1);
        if (!inside(p.x, p.z)) continue;
        const side = Math.floor(s / 30) % 2 === 0 ? 1 : -1;
        const off = e.hw + 0.9;
        // h: rotazione che porta il braccio (+z del modello) verso il centro della strada
        lamps.push({ x: p.x + Math.cos(p.heading) * off * side, y: p.y, z: p.z - Math.sin(p.heading) * off * side, h: Math.atan2(-Math.cos(p.heading) * side, Math.sin(p.heading) * side) });
      }
    }
    // ingresso nell'abitato: almeno 60 m di campagna e poi almeno 40 m di case, in un verso o nell'altro
    if (e.cls <= CLS.unclassified) {
      for (let k = 6; k <= n - 4; k++) {
        const before = urban.slice(k - 6, k).every((u) => !u);
        const after = urban.slice(k, k + 4).every((u) => u);
        const beforeRev = urban.slice(k, k + 6).every((u) => !u);
        const afterRev = urban.slice(Math.max(0, k - 4), k).every((u) => u);
        const enter = before && after ? 1 : beforeRev && afterRev && k + 6 <= n + 1 ? -1 : 0;
        if (!enter) continue;
        if (enter > 0 && !graph.allowed(e.id, 1)) continue;
        if (enter < 0 && !graph.allowed(e.id, -1)) continue;
        const p = graph.pose(e.id, (e.length * k) / n, enter as 1 | -1);
        if (!inside(p.x, p.z)) continue;
        const name = nearestTown(p.x, p.z);
        if (!name) continue;
        // a destra di chi entra
        const off = e.hw + 1.4;
        towns.push({ x: p.x - Math.cos(p.heading) * off, y: p.y, z: p.z + Math.sin(p.heading) * off, h: p.heading, name });
        k += 6;
      }
    }
    if (++count % 40 === 0) yield;
  }
  return { lamps, towns };
}
