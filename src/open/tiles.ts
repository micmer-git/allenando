import type { indexRoadPoints } from './puntiStrada';
import * as THREE from 'three';
import { ASPHALT_REPEAT_M, hash2, smoothNoise } from '@/world/builders';
import { CLS, FLAG, type Edge, type EdgePose, type WorldGraph } from './graph';
import type { WorldField } from './field';
import { BUILDING_KIND, COVER, type Building, type Place, type WorldFeatures } from './world';
import { addBuilding, BLANK_UV, earcut, ringArea, Tris } from './buildings';
import { bandsWeight, groundLook, lookContext, treeDensity, treeSpecies, type LookCtx } from './look';
import { ringAt, ringBranch, ringsIn, smoothRingOf, type Pt, type RingGeo } from './rings';
import { portalClear, tunnelGeometry } from './tunnels';
import { pavedWeight } from './urban';
import { junctionCut, junctionsIn, mitreAt, type JunctionGeo } from './junctions';

/*
 * Le mattonelle del mondo vicino al ciclista: terreno raccordato alle strade, nastri d'asfalto
 * (ponti e gallerie compresi), edifici estrusi dalle impronte OSM, alberi dove il suolo Ã¨ bosco,
 * fiumi e binari. Tutto si calcola a fette (generatori) per non bloccare i fotogrammi.
 *
 * Convenzione dei nastri come in world/builders.ts: per una direzione h il vettore laterale
 * L = (cos h, 0, âˆ’sin h) punta a SINISTRA di chi va nel verso dell'arco.
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
  /** cordoli e marciapiedi dei paesi, a colori di vertice */
  kerb: THREE.BufferGeometry | null;
  rails: THREE.BufferGeometry | null;
  /** gallerie: dentro (colori di vertice, luce cotta) e la carreggiata in galleria */
  tunnel: THREE.BufferGeometry | null;
  tunnelRoad: THREE.BufferGeometry | null;
  buildings: BuildingMeshes;
  water: THREE.BufferGeometry | null;
  trees: { kind: TreeKind; x: number; y: number; z: number; s: number; r: number; tint: number }[];
}

export type TreeKind = 'spruce' | 'larch' | 'broadleaf' | 'rock' | 'cypress';

/** Un accumulatore di triangoli, con colori facoltativi. */
export class Mesh {
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
    if (this.uv.length === (this.pos.length / 3) * 2) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    if (normals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export interface P {
  x: number;
  y: number;
  z: number;
  h: number;
  d: number;
  /** quanto allargare la sezione qui (il taglio a bisettrice in testa a un nastro, junctions.ts) */
  w?: number;
}

/** Striscia fra due scostamenti laterali (sinistra positiva), con il proprio sollevamento. */
export function strip(m: Mesh, pts: P[], a: number, liftA: number, b: number, liftB: number, uvLen = 8, keep?: (p: P) => boolean, color?: THREE.Color): void {
  let prev = -1;
  for (const p of pts) {
    if (keep && !keep(p)) {
      prev = -1;
      continue;
    }
    const sc = p.w ?? 1;
    const lx = Math.cos(p.h) * sc;
    const lz = -Math.sin(p.h) * sc;
    const i = m.vertex(p.x + lx * a, p.y + liftA, p.z + lz * a, 0, p.d / uvLen, color);
    m.vertex(p.x + lx * b, p.y + liftB, p.z + lz * b, 1, p.d / uvLen, color);
    if (prev >= 0) {
      if (b < a) m.idx.push(prev, prev + 1, i, prev + 1, i + 1, i);
      else m.idx.push(prev, i, prev + 1, prev + 1, i, i + 1);
    }
    prev = i;
  }
}

/**
 * Le corse dell'arco dentro il rettangolo, campionate ogni `step` metri nel verso dell'arco.
 * In testa e in coda, ai nodi con due sole strade, la sezione Ã¨ tagliata sulla bisettrice con
 * l'altra strada (junctions.ts): i due nastri combaciano, senza cuneo scoperto nÃ© sovrapposizione.
 */
export function runsInside(graph: WorldGraph, e: Edge, x0: number, z0: number, x1: number, z1: number, step: number): P[][] {
  const out: P[][] = [];
  let cur: P[] | null = null;
  let lastOut: P | null = null;
  const n = Math.max(1, Math.ceil(e.length / step));
  const mA = mitreAt(graph, e.id, true);
  const mB = mitreAt(graph, e.id, false);
  for (let k = 0; k <= n; k++) {
    const s = (e.length * k) / n;
    const pose = graph.pose(e.id, s, 1);
    const m = k === 0 ? mA : k === n ? mB : null;
    const p: P = m ? { x: pose.x, y: pose.y, z: pose.z, h: m.h, d: s, w: m.w } : { x: pose.x, y: pose.y, z: pose.z, h: pose.heading, d: s };
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
/** I colori dell'uso del suolo che si stendono sopra quello della quota (roccia, ghiacciaio, piste e neve li fa groundLook). */
const COVER_COLOR: Record<number, THREE.Color> = {
  [COVER.forest]: new THREE.Color('#355f2e'),
  [COVER.residential]: new THREE.Color('#8f8b7e'),
  [COVER.industrial]: new THREE.Color('#8a8984'),
  [COVER.park]: new THREE.Color('#6e9a45'),
  [COVER.water]: new THREE.Color('#6d7f7a'),
  [COVER.farmland]: new THREE.Color('#93a356'),
};

/** Il suolo pavimentato delle cittÃ : piazze, piazzali, cortili (urban.ts). */
const PAVED = ['#a6a197', '#9d988e', '#aca69b'].map((h) => new THREE.Color(h));

/**
 * Il terreno della mattonella, con un bordo che scende di SKIRT_M per chiudere le fessure col terreno
 * lontano. `urban` (densitÃ  delle case intorno, urban.ts) pavimenta il suolo aperto delle cittÃ .
 * Il colore viene da look.ts (quota, pendenza, esposizione, stagione, uso del suolo); l'attributo
 * `rock` dice allo shader dove disegnare le bande della roccia (rockShader.ts).
 */
export function* terrainJob(field: WorldField, spec: TileSpec, urban?: (x: number, z: number) => number, ctx: LookCtx = lookContext(field.terrain?.graph?.id ?? 'bergamo')): Generator<void, THREE.BufferGeometry, void> {
  const n = Math.round(spec.size / spec.spacing);
  const side = n + 1;
  const pos = new Float32Array((side * side + side * 4) * 3);
  const col = new Float32Array((side * side + side * 4) * 3);
  const rock = new Float32Array(side * side + side * 4);
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
      // la gonna scende SKIRT_M: deve coprire il terreno lontano, che sta sotto anche di 100 m (farSinks)
      pos[v * 3 + 1] = pos[k * 3 + 1] - SKIRT_M;
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
  const c = new THREE.Color();
  for (let k = 0; k < side * side; k++) {
    const x = pos[k * 3];
    const z = pos[k * 3 + 2];
    const y = pos[k * 3 + 1];
    // rumore liscio: con hash2 per celle di 23 m il pendio veniva a quadretti (M6)
    const noise = smoothNoise(x / 23, z / 23);
    uv[k * 2] = x / DETAIL_M;
    uv[k * 2 + 1] = z / DETAIL_M;
    let cov = field.terrain.cover(x, z);
    // sopra la linea del bosco il bosco dei dati non c'Ã¨: prato alpino, ghiaia, roccia
    if (cov === COVER.forest && y > ctx.look.treeLine - 40) cov = COVER.open;
    // la pendenza che decide roccia, ghiaione e prato Ã¨ quella del DEM, non quella del terreno
    // raccordato: il taglio di una strada (2-5 m a 1:1) non Ã¨ una parete, e non deve avere nÃ© il
    // colore nÃ© le bande della roccia (R2 del PM: a San Marco e alla Ganda i tagli erano a righe)
    const dd = spec.spacing;
    const gx = (field.terrain.height(x + dd, z) - field.terrain.height(x - dd, z)) / (2 * dd);
    const gz = (field.terrain.height(x, z + dd) - field.terrain.height(x, z - dd)) / (2 * dd);
    const gl = Math.sqrt(1 + gx * gx + gz * gz);
    const g = groundLook(c, ctx.look, ctx.season, y, 1 / gl, -gz / gl, noise, cov);
    // le bande solo dove c'Ã¨ una parete: non sui versanti che i dati dicono bosco
    const rk = g.rock * bandsWeight(ctx.look, cov, y);
    rock[k] = rk;
    // i paesi, i campi a mosaico, i parchi, il bosco: sopra il colore della quota, ma non sopra
    // la neve nÃ© la roccia; il mosaico dei prati finisce dove finisce il bosco pieno
    const mosaic = cov === COVER.farmland || (cov === COVER.open && y < ctx.look.forestFull);
    const cc = mosaic ? parcelColor(x, z, cov) : COVER_COLOR[cov];
    if (cc && cov !== COVER.water) c.lerp(tmpC.copy(cc).offsetHSL(0, 0, (noise - 0.5) * 0.06), (cov === COVER.open ? 0.45 : 0.72) * (1 - g.snow) * (1 - rk));
    // in cittÃ  il suolo aperto Ã¨ una piazza o un cortile, non un prato (i parchi restano verdi)
    if (urban && (cov === COVER.open || URBAN.has(cov))) {
      const pv = pavedWeight(urban(x, z), dist[k]);
      if (pv > 0.01) c.lerp(tmpC.copy(PAVED[Math.floor(noise * 7) % 3]), pv * 0.92);
    }
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
      // la gonna Ã¨ il colore del bordo, piÃ¹ scuro, e senza le bande della roccia
      col[dst] = col[src] * 0.8;
      col[dst + 1] = col[src + 1] * 0.8;
      col[dst + 2] = col[src + 2] * 0.8;
      rock[skirtStart[s] + i] = 0;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('rock', new THREE.BufferAttribute(rock, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

/** La grana del suolo si ripete ogni 12 m. */
const DETAIL_M = 12;
/**
 * Quanto scende la gonna di una mattonella: chiude la fessura col terreno lontano, che ora sta
 * sotto il DEM anche di 100 m nelle valli strette (farSinks in farMask.ts, R1 del PM).
 */
export const SKIRT_M = 120;

/**
 * Campi a mosaico: appezzamenti di 70 Ã— 45 m (orientati come la centuriazione della pianura) con colture
 * diverse â€” mais, grano, arato, erba medica. I prati di montagna variano poco, tra sfalcio e pascolo.
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

/** Le strade importanti stanno sopra le minori agli incroci, di un centimetro e mezzo per classe. */
export const roadLift = (cls: number): number => 0.03 + (7 - cls) * 0.015;

/** Il suolo dei paesi: lÃ¬ ci sono marciapiedi e lampioni, e la mezzeria ha il passo urbano. */
export const URBAN = new Set<number>([COVER.residential, COVER.industrial]);

/**
 * Quanto stare lontani da un incrocio prima di disegnare marciapiedi, guardrail, segni: la
 * semilarghezza piÃ¹ grande fra le altre strade del nodo, piÃ¹ un metro e mezzo. 0 se il nodo Ã¨
 * solo la continuazione della stessa strada.
 */
export function junctionClear(graph: WorldGraph, node: number, self: number): number {
  if (graph.adjStart[node + 1] - graph.adjStart[node] < 3) return 0;
  // dove c'Ã¨ l'innesto (junctions.ts) vale il suo taglio: il nastro riprende i bordi oltre i raccordi
  const cut = junctionCut(graph, node, self);
  if (cut > 0) return cut;
  let w = 0;
  for (let i = graph.adjStart[node]; i < graph.adjStart[node + 1]; i++) {
    const id = graph.adjEdges[i];
    if (id !== self) w = Math.max(w, graph.edges[id].hw);
  }
  return w + 1.5;
}

/** Quanto gira la strada intorno a s: differenza di direzione fra 12 m prima e 12 m dopo, radianti. */
export function bendAt(graph: WorldGraph, e: Edge, s: number): number {
  const a = graph.pose(e.id, Math.max(0, s - 12), 1).heading;
  const b = graph.pose(e.id, Math.min(e.length, s + 12), 1).heading;
  return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
}

const KERB = new THREE.Color('#d2cdc3');
const WALK = [new THREE.Color('#b4ada1'), new THREE.Color('#aaa398'), new THREE.Color('#bdb6aa')];
const WALK_EDGE = new THREE.Color('#8d877d');

/**
 * Mezzeria all'italiana: tratteggio 4,5 + 7,5 m fuori dai paesi, 3 + 4,5 m nei paesi, continua
 * nelle curve strette e negli ultimi 15 m prima di un incrocio. Si campiona ogni 1,5 m, che
 * divide esattamente tutti i passi.
 */
function centerLine(paint: Mesh, graph: WorldGraph, field: WorldField, e: Edge, s0: number, s1: number, lift: number, endA: number, endB: number, keep: (p: EdgePose, s: number) => boolean = () => true): void {
  const lo = Math.max(6, endA);
  const hi = e.length - Math.max(6, endB);
  const solidAt = (s: number) => (endA > 0 && s < endA + 15) || (endB > 0 && s > e.length - endB - 15) || bendAt(graph, e, s) > 0.62;
  // un rettangolo largo 12 cm fra due pose: faccia in su (sinistra prima, come i nastri)
  const seg = (a: EdgePose, b: EdgePose) => {
    const ax = Math.cos(a.heading) * 0.06;
    const az = -Math.sin(a.heading) * 0.06;
    const bx = Math.cos(b.heading) * 0.06;
    const bz = -Math.sin(b.heading) * 0.06;
    const k = paint.vertex(a.x + ax, a.y + lift, a.z + az);
    paint.vertex(a.x - ax, a.y + lift, a.z - az);
    paint.vertex(b.x + bx, b.y + lift, b.z + bz);
    paint.vertex(b.x - bx, b.y + lift, b.z - bz);
    paint.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  };
  let prev: EdgePose | null = null;
  const start = Math.ceil(s0 / 1.5) * 1.5;
  for (let s = start; s <= s1 + 1e-6; s += 1.5) {
    if (s < lo || s > hi) {
      prev = null;
      continue;
    }
    if (solidAt(s)) {
      // continua: nelle curve strette e prima degli incroci
      const p = graph.pose(e.id, s, 1);
      if (!keep(p, s)) {
        prev = null;
        continue;
      }
      if (prev) seg(prev, p);
      prev = p;
      continue;
    }
    prev = null;
    const p = graph.pose(e.id, s, 1);
    if (!keep(p, s)) continue;
    const urban = URBAN.has(field.terrain.cover(p.x, p.z));
    const period = urban ? 7.5 : 12;
    const on = urban ? 3 : 4.5;
    const phase = s % period;
    if (phase > 1e-6 && period - phase > 1e-6) continue;
    const end = s + on;
    if (end > hi || solidAt(end)) continue;
    // un trattino intero, un rettangolo solo
    seg(p, graph.pose(e.id, end, 1));
  }
}

/** Lo scivolo alla fine di un marciapiede: in tanti metri il piano scende alla quota della strada. */
export const WALK_RAMP = 4;

/**
 * Quanto Ã¨ alto il marciapiede in ogni punto, da 0 (alla quota della strada) a 1 (cordolo pieno):
 * dove il marciapiede comincia o finisce davvero (il punto prima o dopo Ã¨ senza), scende in
 * WALK_RAMP metri invece di finire con un gradino. Dove la corsa finisce al bordo della mattonella
 * il marciapiede continua nella vicina: lÃ¬ niente scivolo.
 */
export function walkHeights(pts: { d: number }[], on: boolean[]): Float32Array {
  const n = pts.length;
  const gap = new Float32Array(n).fill(Infinity);
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!on[i]) last = pts[i].d;
    else gap[i] = pts[i].d - last;
  }
  last = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    if (!on[i]) last = pts[i].d;
    else gap[i] = Math.min(gap[i], last - pts[i].d);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!on[i]) continue;
    // il primo punto col marciapiede sta a un passo (2,5-3 m) da quello senza: lÃ¬ comincia a salire
    const t = Math.min(1, Math.max(0, (gap[i] - 3) / WALK_RAMP));
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/** Un marciapiede piÃ¹ corto di cosÃ¬ (fra due punti senza) non si fa: sarebbe un gradino isolato. */
export const WALK_MIN = 15;

/**
 * Toglie i pezzi di marciapiede piÃ¹ corti di `min` metri che cominciano e finiscono dentro la corsa.
 * Quelli che toccano il bordo della corsa restano: continuano nella mattonella vicina.
 */
export function trimWalk(pts: { d: number }[], on: boolean[], min = WALK_MIN): boolean[] {
  const out = on.slice();
  let i = 0;
  while (i < on.length) {
    if (!on[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < on.length && on[j + 1]) j++;
    if (i > 0 && j < on.length - 1 && pts[j].d - pts[i].d < min) for (let k = i; k <= j; k++) out[k] = false;
    i = j + 1;
  }
  return out;
}

/** Il marciapiede di un lato: il fianco del cordolo chiaro, il piano in masselli, il fianco esterno che scende. */
function walkStrips(kerb: Mesh, pts: P[], hw: number, lift: number, top: number, s: number, on: boolean[], tone: THREE.Color): void {
  const k = walkHeights(pts, on);
  let prev = -1;
  for (let i = 0; i < pts.length; i++) {
    if (!on[i]) {
      prev = -1;
      continue;
    }
    const p = pts[i];
    const lx = Math.cos(p.h);
    const lz = -Math.sin(p.h);
    const y = lift - 0.02 + (top - lift + 0.02) * k[i];
    const v = p.d / 8;
    const at = (off: number, h: number, u: number, c: THREE.Color) => kerb.vertex(p.x + lx * off, p.y + h, p.z + lz * off, u, v, c);
    // sei vertici per sezione: fianco del cordolo (2), piano (2), fianco esterno (2)
    const i0 = at(s * hw, lift - 0.02, 0, KERB);
    at(s * hw, y, 1, KERB);
    at(s * (hw + 1.75), y, 0, tone);
    at(s * hw, y, 1, tone);
    at(s * (hw + 1.75), y, 0, WALK_EDGE);
    at(s * (hw + 2.1), -2.8, 1, WALK_EDGE);
    if (prev >= 0) {
      for (const [a, b] of [
        [0, 1],
        [2, 3],
        [4, 5],
      ]) {
        // la stessa regola di strip() (b < a): la faccia in su, o verso fuori, secondo il lato
        const flip = a === 2 ? s > 0 : a === 4 ? s < 0 : false;
        if (flip) kerb.idx.push(prev + a, prev + b, i0 + a, prev + b, i0 + b, i0 + a);
        else kerb.idx.push(prev + a, i0 + a, prev + b, prev + b, i0 + a, i0 + b);
      }
    }
    prev = i0;
  }
}

/** Strade, ponti, gallerie, cordoli e marciapiedi della mattonella. Il guardrail sta nell'arredo vicino. */
export function* roadsJob(graph: WorldGraph, field: WorldField, spec: TileSpec): Generator<void, Omit<TileMeshes, 'terrain' | 'buildings' | 'trees' | 'water' | 'rails'>, void> {
  const asphalt = new Mesh();
  const stone = new Mesh();
  const cycle = new Mesh();
  const paint = new Mesh();
  const verge = new Mesh();
  const concrete = new Mesh();
  const kerb = new Mesh();
  const tunnel = new Mesh();
  const tunnelRoad = new Mesh();
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
    // gli archi di una rotatoria liscia li disegna l'anello intero (drawRing), qui sotto
    if (e.flags & FLAG.roundabout && smoothRingOf(graph, id)) continue;
    const runs = runsInside(graph, e, x0, z0, x1, z1, e.cls >= CLS.residential ? 2.5 : 3);
    const bridge = (e.flags & FLAG.bridge) !== 0;
    const tun = (e.flags & FLAG.tunnel) !== 0;
    const ring = (e.flags & FLAG.roundabout) !== 0;
    const hw = e.hw;
    const lift = roadLift(e.cls);
    const surface = e.flags & FLAG.cobbles || e.cls === CLS.pedestrian ? stone : e.cls === CLS.cycleway ? cycle : asphalt;
    // l'innesto dell'incrocio (junctions.ts): da lÃ¬ in poi il nastro ha i suoi bordi
    const jA = junctionCut(graph, e.a, id);
    const jB = junctionCut(graph, e.b, id);
    const nearEnd = (p: P) => p.d > Math.max(10, jA) && p.d < e.length - Math.max(10, jB);
    /** il punto a `off` di lato (sinistra positiva) non cade sulla carreggiata di un'altra strada */
    // (le strade si sovrappongono vicino ai nodi: a metÃ  arco non si chiede, costa)
    const offOthers = (p: P, off: number) => (p.d > 60 && p.d < e.length - 60) || graph.asphaltMargin(p.x + Math.cos(p.h) * off, p.z - Math.sin(p.h) * off, p.y, 1.5, id) < -0.05;
    // ai rami delle rotatorie i cordoli ripartono dopo il raccordo (o dopo l'isola spartitraffico)
    // e dentro la galleria artificiale davanti a un imbocco (tunnels.ts) niente marciapiedi
    const ringA = ringBranch(graph, id, true)?.clear ?? 0;
    const ringB = ringBranch(graph, id, false)?.clear ?? 0;
    const endA = Math.max(junctionClear(graph, e.a, id), ringA, portalClear(graph, id, true));
    const endB = Math.max(junctionClear(graph, e.b, id), ringB, portalClear(graph, id, false));
    if (tun) {
      // la galleria: tubo, luce, portali (tunnels.ts), campionata fitta per le pozze di luce
      tunnelGeometry(graph, (x, z) => field.terrain.height(x, z), e, runsInside(graph, e, x0, z0, x1, z1, 1.5), { x0, z0, x1, z1 }, lift, { road: tunnelRoad, inner: tunnel, shell: concrete });
      if (++count % 40 === 0) yield;
      continue;
    }
    // marciapiede: nei paesi, sulle strade da provinciale in giÃ¹, lontano dagli incroci
    const walkable = !bridge && !tun && !ring && e.cls >= CLS.secondary && e.cls <= CLS.residential && !(e.flags & FLAG.cobbles);
    // dopo un raccordo di rotatoria il marciapiede riparte subito, dove finisce il cordolo del raccordo
    const walkA = ringA ? Math.max(ringA, junctionClear(graph, e.a, id) + 1) : endA + 1;
    const walkB = ringB ? Math.max(ringB, junctionClear(graph, e.b, id) + 1) : endB + 1;
    const walkAt = (p: P) => walkable && p.d > walkA && p.d < e.length - walkB && URBAN.has(field.terrain.cover(p.x, p.z));
    // e mai sopra un'altra strada: due sensi unici che si uniscono, o una via che corre accanto,
    // si prendevano il marciapiede dell'altra in mezzo alla carreggiata
    const walkSide = (side: number) => (p: P) =>
      walkAt(p) && ((p.d > 60 && p.d < e.length - 60) || graph.asphaltMargin(p.x + Math.cos(p.h) * side * (hw + 1), p.z - Math.sin(p.h) * side * (hw + 1), p.y, 2.5, id) < -0.4);
    const lineW = e.cls <= CLS.primary ? 0.15 : 0.12;
    for (const raw of runs) {
      if (raw.length < 2) continue;
      // un punto esatto sul taglio dell'innesto: banchine e cordoli finiscono dove comincia il raccordo
      const pts = withCuts(graph, e, raw, [jA, e.length - jB]);
      const past = (p: P) => p.d >= jA - 1e-6 && p.d <= e.length - jB + 1e-6;
      strip(surface, pts, hw, lift, -hw, lift, surface === stone ? 4 : surface === asphalt ? ASPHALT_REPEAT_M : 10);
      if (e.cls <= CLS.unclassified && !tun) {
        // le linee di margine si fermano dove passano sull'asfalto di un'altra strada (due sensi
        // unici che confluiscono, una via che si affianca): prima si incrociavano a X
        const lineAt = (side: number) => (p: P) => nearEnd(p) && offOthers(p, side * (hw - 0.2));
        strip(paint, pts, hw - 0.12, lift + 0.012, hw - 0.12 - lineW, lift + 0.012, 8, lineAt(1));
        strip(paint, pts, -hw + 0.12 + lineW, lift + 0.012, -hw + 0.12, lift + 0.012, 8, lineAt(-1));
      }
      if (e.cls <= CLS.tertiary && hw >= 2.7 && !ring && !(e.flags & (FLAG.oneway | FLAG.onewayRev))) {
        centerLine(paint, graph, field, e, pts[0].d, pts[pts.length - 1].d, lift + 0.014, endA, endB, (p, s) => offOthers({ x: p.x, y: p.y, z: p.z, h: p.heading, d: s }, 0));
      }
      if (bridge) {
        // impalcato: cordolo in cemento coi due fianchi, bordo esterno fino alla trave, pile fino al terreno
        for (const s of [1, -1]) {
          strip(concrete, pts, s * hw, lift, s * hw, lift + 0.3, 8);
          strip(concrete, pts, s * (hw + 0.55), lift + 0.3, s * hw, lift + 0.3, 8);
          strip(concrete, pts, s * (hw + 0.55), lift + 0.3, s * (hw + 0.55), -1.6, 8);
        }
        strip(concrete, pts, -hw - 0.55, -1.6, hw + 0.55, -1.6, 8);
        for (const p of pts) {
          if (Math.floor(p.d / 32) === Math.floor((p.d - 3) / 32)) continue;
          const ground = field.terrain.height(p.x, p.z);
          if (p.y - ground < 4) continue;
          pier(concrete, p, Math.max(1.2, hw * 0.45), p.y - 1.6, ground - 2);
        }
      } else {
        // dove c'Ã¨ il marciapiede, lato per lato; i pezzi piÃ¹ corti di WALK_MIN non si fanno (erano
        // i gradini isolati del punto M5), e lÃ¬ resta la banchina
        const sides = walkable ? [1, -1].map((side) => trimWalk(pts, pts.map(walkSide(side)))) : null;
        const onWalk = sides ? sides.map((on) => new Set(pts.filter((_, i) => on[i]))) : null;
        const bank = (i: number) => (p: P) => past(p) && (!onWalk || !onWalk[i].has(p));
        strip(verge, pts, hw + 0.8, lift - 0.1, hw, lift - 0.02, 8, bank(0));
        strip(verge, pts, -hw, lift - 0.02, -hw - 0.8, lift - 0.1, 8, bank(1));
        strip(verge, pts, hw + 2, -3.4, hw + 0.8, lift - 0.1, 8, bank(0));
        strip(verge, pts, -hw - 0.8, lift - 0.1, -hw - 2, -3.4, 8, bank(1));
        if (sides) {
          // cordolo alto 14 cm, marciapiede di 1,6 m in masselli, e il fianco che scende nel terreno
          const top = lift + 0.14;
          const tone = WALK[Math.floor(hash2(e.id, 3) * WALK.length) % WALK.length];
          walkStrips(kerb, pts, hw, lift, top, 1, sides[0], tone);
          walkStrips(kerb, pts, hw, lift, top, -1, sides[1], tone);
        }
      }
    }
    if (++count % 40 === 0) yield;
  }
  // le rotatorie lisce: ognuna nella mattonella che ne ha il centro
  for (const g of ringsIn(graph, x0, z0, x1, z1)) if (g.smooth) drawRing(g, graph, field, { surface: g.cobbles ? stone : asphalt, paint, kerb });
  // gli innesti degli incroci: ognuno nella mattonella che ne ha il nodo
  for (const g of junctionsIn(graph, ids, x0, z0, x1, z1)) drawJunction(g, field, { surface: g.stone ? stone : asphalt, kerb });
  return {
    asphalt: asphalt.build(),
    stone: stone.build(),
    cycle: cycle.build(),
    paint: paint.build(),
    verge: verge.build(),
    concrete: concrete.build(),
    kerb: kerb.build(),
    tunnel: tunnel.build(false),
    tunnelRoad: tunnelRoad.build(false),
  };
}

/** La corsa con un punto esatto a ogni distanza di `cuts` che cade al suo interno. */
function withCuts(graph: WorldGraph, e: Edge, pts: P[], cuts: number[]): P[] {
  let out = pts;
  for (const d of cuts) {
    if (!(d > 0.05 && d < e.length - 0.05)) continue;
    const k = out.findIndex((p) => p.d >= d);
    if (k <= 0 || Math.abs(out[k].d - d) < 0.05 || Math.abs(out[k - 1].d - d) < 0.05) continue;
    const pose = graph.pose(e.id, d, 1);
    out = [...out.slice(0, k), { x: pose.x, y: pose.y, z: pose.z, h: pose.heading, d }, ...out.slice(k)];
  }
  return out;
}

// ---------- incroci ----------

/**
 * L'innesto di un incrocio (junctions.ts): un ventaglio dal nodo al bordo del poligono, con un
 * anello intermedio a metÃ  raggio cosÃ¬ la superficie segue il dosso della strada; sta due
 * centimetri sopra i nastri, le cui teste squadrate finiscono sotto. Il cordolo (o la banchina)
 * segue il bordo fra un taglio e l'altro.
 */
function drawJunction(g: JunctionGeo, field: WorldField, m: { surface: Mesh; kerb: Mesh }): void {
  let lift = roadLift(g.cls);
  for (const a of g.arms) lift = Math.max(lift, roadLift(a.cls));
  lift += 0.02;
  const n = g.ring.length;
  if (n < 3) return;
  const uv = (x: number, z: number): [number, number] => [x / 6, z / ASPHALT_REPEAT_M];
  const c = m.surface.vertex(g.cx, g.cy + lift, g.cz, ...uv(g.cx, g.cz));
  const half: number[] = [];
  const full: number[] = [];
  for (const v of g.ring) {
    const hx = (g.cx + v.x) / 2;
    const hz = (g.cz + v.z) / 2;
    half.push(m.surface.vertex(hx, v.yh + lift, hz, ...uv(hx, hz)));
    full.push(m.surface.vertex(v.x, v.y + lift, v.z, ...uv(v.x, v.z)));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    triUpIdx(m.surface, c, half[i], half[j]);
    quadUp(m.surface, half[i], full[i], half[j], full[j]);
  }
  const urban = URBAN.has(field.terrain.cover(g.cx, g.cz));
  const walk = WALK[Math.floor(hash2(g.cx, g.cz) * WALK.length) % WALK.length];
  for (const curb of g.curbs) {
    if (curb.pts.length < 2) continue;
    curbAlong(m.kerb, curb.pts.map((p) => ({ ...p, y: p.y + lift })), urban, walk);
  }
}

// ---------- rotatorie ----------

/** Due triangoli fra a0-a1 (una sezione) e b0-b1 (la successiva), con la faccia in su. */
function quadUp(m: Mesh, a0: number, a1: number, b0: number, b1: number): void {
  const P = m.pos;
  const ny = (P[a1 * 3 + 2] - P[a0 * 3 + 2]) * (P[b0 * 3] - P[a0 * 3]) - (P[a1 * 3] - P[a0 * 3]) * (P[b0 * 3 + 2] - P[a0 * 3 + 2]);
  if (ny >= 0) m.idx.push(a0, a1, b0, a1, b1, b0);
  else m.idx.push(a0, b0, a1, a1, b0, b1);
}

/** Un triangolo con la faccia in su. */
function triUpIdx(m: Mesh, a: number, b: number, c: number): void {
  const P = m.pos;
  const ny = (P[b * 3 + 2] - P[a * 3 + 2]) * (P[c * 3] - P[a * 3]) - (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]);
  if (ny >= 0) m.idx.push(a, b, c);
  else m.idx.push(a, c, b);
}

const RING_VERGE = new THREE.Color('#8f8574');
const ISLE_GRASS = new THREE.Color('#5f8f3e');
const ISLE_STONE = new THREE.Color('#aaa59a');
const ISLE_FACE = new THREE.Color('#bdb8ae');

/** Un punto del cordolo: dove sta, la quota dell'asfalto lÃ¬, e da che parte sta il fuori. */
interface CurbPt {
  x: number;
  y: number;
  z: number;
  ox: number;
  oz: number;
}

/**
 * Il cordolo lungo una linea: fianco di 14 cm, testa di 22 cm, poi nei paesi il marciapiede e il
 * fianco che scende nel terreno, fuori la banchina che scende. Ãˆ la sezione dei marciapiedi delle
 * strade (roadsJob): il cordolo dell'anello continua in quello del ramo.
 */
function curbAlong(kerb: Mesh, line: CurbPt[], urban: boolean, walk: THREE.Color): void {
  if (line.length < 2) return;
  const prof: [number, number, THREE.Color][] = urban
    ? [
        [0, -0.04, KERB],
        [0, 0.14, KERB],
        [0.22, 0.14, walk],
        [1.75, 0.14, WALK_EDGE],
        [2.1, -2.8, WALK_EDGE],
      ]
    : [
        [0, -0.04, KERB],
        [0, 0.12, KERB],
        [0.22, 0.12, RING_VERGE],
        [1.3, -0.12, RING_VERGE],
        [2.4, -3, RING_VERGE],
      ];
  let prev = -1;
  for (const p of line) {
    const base = kerb.pos.length / 3;
    for (const [o, dy, c] of prof) kerb.vertex(p.x + p.ox * o, p.y + dy, p.z + p.oz * o, 0, 0, c);
    if (prev >= 0) for (let j = 0; j < prof.length - 1; j++) kerb.idx.push(prev + j, base + j, prev + j + 1, prev + j + 1, base + j, base + j + 1);
    prev = base;
  }
}

function wrapA(a: number): number {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Una rotatoria liscia (rings.ts): l'anello d'asfalto, i raccordi alle bocche, il cordolo fra una
 * bocca e l'altra, le isole spartitraffico, la linea bianca continua dentro e quella fuori.
 * L'anello sta un centimetro sopra tutti i rami: le loro teste squadrate finiscono sotto.
 */
/** Il sollevamento dell'asfalto di una rotatoria: liscia, un centimetro sopra tutti i rami. */
export function ringLift(g: RingGeo): number {
  let lift = roadLift(g.cls);
  if (!g.smooth) return lift;
  for (const b of g.branches) lift = Math.max(lift, roadLift(b.cls));
  return lift + 0.012;
}

function drawRing(g: RingGeo, graph: WorldGraph, field: WorldField, m: { surface: Mesh; paint: Mesh; kerb: Mesh }): void {
  const lift = ringLift(g);
  const fl = lift - 0.006;
  const urban = URBAN.has(field.terrain.cover(g.cx, g.cz));
  const walk = WALK[Math.floor(hash2(g.cx, g.cz) * WALK.length) % WALK.length];
  const at = (th: number, off: number) => {
    const a = ringAt(g, th);
    const r = a.r + off;
    return { x: g.cx + Math.cos(th) * r, y: a.y, z: g.cz + Math.sin(th) * r };
  };
  const TAU = Math.PI * 2;
  // la carreggiata, con la trama che scorre lungo l'anello
  let prev = -1;
  let run = 0;
  let last: { x: number; z: number } | null = null;
  for (let k = 0; k <= g.n; k++) {
    const th = -Math.PI + (k / g.n) * TAU;
    const i = at(th, -g.hw);
    const o = at(th, g.hw);
    const mx = (i.x + o.x) / 2;
    const mz = (i.z + o.z) / 2;
    if (last) run += Math.hypot(mx - last.x, mz - last.z);
    last = { x: mx, z: mz };
    const a = m.surface.vertex(i.x, i.y + lift, i.z, 0, run / ASPHALT_REPEAT_M);
    m.surface.vertex(o.x, o.y + lift, o.z, 1, run / ASPHALT_REPEAT_M);
    if (prev >= 0) quadUp(m.surface, prev, prev + 1, a, a + 1);
    prev = a;
  }
  // linee bianche da 12 cm: continua dentro, fra le bocche fuori
  const line = (th0: number, th1: number, o0: number, o1: number) => {
    const steps = Math.max(1, Math.ceil(((th1 - th0) * (g.meanR + o0)) / 1.2));
    let p = -1;
    for (let k = 0; k <= steps; k++) {
      const th = th0 + ((th1 - th0) * k) / steps;
      const a = at(th, o0);
      const b = at(th, o1);
      const q = m.paint.vertex(a.x, a.y + lift + 0.012, a.z);
      m.paint.vertex(b.x, b.y + lift + 0.012, b.z);
      if (p >= 0) quadUp(m.paint, p, p + 1, q, q + 1);
      p = q;
    }
  };
  line(-Math.PI, Math.PI, -g.hw + 0.25, -g.hw + 0.37);
  for (const [a, b] of g.curbs) if ((b - a) * g.meanR > 1.4) line(a + 0.4 / g.meanR, b - 0.4 / g.meanR, g.hw - 0.37, g.hw - 0.25);
  // il cordolo esterno fra le bocche: il fuori Ã¨ lontano dal centro
  for (const [a, b] of g.curbs) {
    const pts: CurbPt[] = [];
    const steps = Math.max(1, Math.ceil(((b - a) * (g.meanR + g.hw)) / 1.5));
    for (let k = 0; k <= steps; k++) {
      const th = a + ((b - a) * k) / steps;
      const p = at(th, g.hw);
      pts.push({ x: p.x, y: p.y + lift, z: p.z, ox: Math.cos(th), oz: Math.sin(th) });
    }
    curbAlong(m.kerb, pts, urban, walk);
  }
  // i raccordi: un ventaglio dallo spigolo vivo all'arco, e il cordolo che segue l'arco
  for (const b of g.branches) {
    const e = graph.edges[b.edge];
    for (const f of b.fillets) {
      if (!f) continue;
      const a0 = Math.atan2(f.az - f.fz, f.ax - f.fx);
      const da = wrapA(Math.atan2(f.bz - f.fz, f.bx - f.fx) - a0);
      const yA = ringAt(g, Math.atan2(f.az - g.cz, f.ax - g.cx)).y;
      const tb = Math.min(e.length, f.t1);
      const yB = graph.pose(b.edge, b.atA ? tb : e.length - tb, 1).y;
      const yP = ringAt(g, Math.atan2(f.pz - g.cz, f.px - g.cx)).y;
      const steps = Math.max(2, Math.ceil(Math.abs(da) * f.r));
      const c = m.surface.vertex(f.px, yP + fl, f.pz, f.px / 6, f.pz / ASPHALT_REPEAT_M);
      const curb: CurbPt[] = [];
      let p = -1;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const ang = a0 + da * u;
        const x = f.fx + Math.cos(ang) * f.r;
        const z = f.fz + Math.sin(ang) * f.r;
        const y = yA + (yB - yA) * u;
        const q = m.surface.vertex(x, y + fl, z, x / 6, z / ASPHALT_REPEAT_M);
        if (p >= 0) triUpIdx(m.surface, c, p, q);
        p = q;
        curb.push({ x, y: y + fl, z, ox: -Math.cos(ang), oz: -Math.sin(ang) });
      }
      curbAlong(m.kerb, curb, urban, walk);
    }
  }
  for (const isle of g.splitters) islandTop(m.kerb, isle, lift);
}

/** Un'isola rialzata di 15 cm sull'anello di punti (x, z, quota dell'asfalto): prato se c'Ã¨ posto. */
function islandTop(kerb: Mesh, ring: Pt[], lift: number): void {
  const flat = new Float32Array(ring.length * 2);
  ring.forEach((p, i) => {
    flat[i * 2] = p.x;
    flat[i * 2 + 1] = p.z;
  });
  const top = Math.abs(ringArea(flat)) > 25 ? ISLE_GRASS : ISLE_STONE;
  const base = kerb.pos.length / 3;
  for (const p of ring) kerb.vertex(p.x, p.y + lift + 0.15, p.z, 0, 0, top);
  const tri = earcut(flat);
  for (let i = 0; i < tri.length; i += 3) triUpIdx(kerb, base + tri[i], base + tri[i + 1], base + tri[i + 2]);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const k = kerb.vertex(p.x, p.y + lift - 0.06, p.z, 0, 0, ISLE_FACE);
    kerb.vertex(q.x, q.y + lift - 0.06, q.z, 0, 0, ISLE_FACE);
    kerb.vertex(p.x, p.y + lift + 0.15, p.z, 0, 0, ISLE_FACE);
    kerb.vertex(q.x, q.y + lift + 0.15, q.z, 0, 0, ISLE_FACE);
    kerb.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
}

export function pier(m: Mesh, p: P, w: number, top: number, bottom: number): void {
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

function collectEdges(graph: WorldGraph, x: number, z: number, out: Set<number>): void {
  for (const id of graph.edgesNear(x, z, 70)) out.add(id);
}

// ---------- edifici ----------

const WALLS = ['#d9c9a8', '#e3d4b5', '#cfb894', '#e8ddc8', '#d6b98f', '#c9b6a0', '#e0cfae', '#bfae97', '#e6c99a', '#d2c3ad'];
const WALL_STONE = '#b9ad98';
// i capannoni della valle: pannelli chiari, beige, sabbia, grigio azzurro; non tutti grigi
const WALL_INDUSTRIAL = ['#c9c3b4', '#b9c0c4', '#d2c8ad', '#b8bdb1', '#c4bcae', '#aeb4b6'];
/** il vetro delle finestre a nastro dei capannoni */
const RIBBON = new THREE.Color('#4d5a66');
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

/**
 * Le case ladine (Selva, Corvara, Arabba, Canazei): intonaco bianco o chiaro, tetto a due falde a
 * 24Â° con la gronda larga 1,3 m, in scandole, lamiera scura o coppi bruno-rossi, il timpano di
 * legno; gli hotel di 4-5 piani hanno il tetto a falde anche loro, e i balconi di legno in rilievo
 * a ogni piano (km0-49680937, corvara-79922438, km30-59775148; prima erano scatole col tetto piano
 * e i balconi solo dipinti). Ãˆ l'archetipo del mondo (look.case), non globale.
 */
const LADIN_WALLS = ['#f4f1ea', '#f1ece0', '#ece4d4', '#e8dcc6', '#f6f4ef', '#efe6d6', '#e2d3b8', '#f2efe8'];
const LADIN_ROOFS = ['#4f4842', '#5f5248', '#45413e', '#6e5a4a', '#7a4a38', '#86533f', '#565049'];
const LADIN_WOOD = ['#a06a3a', '#8f5d33', '#b07848', '#966236'];
const LADIN_PITCH = Math.tan((24 * Math.PI) / 180);
const tmpW = new THREE.Color();

export function* buildingsJob(field: WorldField, list: Building[], spec: TileSpec, ctx: LookCtx = lookContext(field.terrain?.graph?.id ?? 'bergamo')): Generator<void, BuildingMeshes, void> {
  const walls = new Tris();
  const roofs = new Tris();
  const wall = new THREE.Color();
  const roof = new THREE.Color();
  const base = new THREE.Color();
  const x1 = spec.x0 + spec.size;
  const z1 = spec.z0 + spec.size;
  const ladino = ctx.look.case === 'ladino';
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
    // il terreno sotto l'impronta, ai vertici e lungo i lati: il punto piÃ¹ basso fa da zoccolo
    // (nessun angolo galleggia), quello piÃ¹ alto da piano terra (sul pendio la casa non resta mezza
    // sepolta a monte: scende con lo zoccolo a valle, come le case vere)
    const { low, high } = footprintGround(field, r, spec.spacing, cx, cz);
    const plinth = low - 0.6;
    const ground = Math.max(plinth, Math.min(high - 1, low + 12));
    const seed = hash2(Math.floor(cx), Math.floor(cz));
    const stone = b.kind === BUILDING_KIND.church || b.kind === BUILDING_KIND.tower || b.kind === BUILDING_KIND.castle;
    const civil = !stone && b.kind !== BUILDING_KIND.industrial;
    if (b.kind === BUILDING_KIND.industrial) wall.set(WALL_INDUSTRIAL[Math.floor(seed * WALL_INDUSTRIAL.length) % WALL_INDUSTRIAL.length]);
    else if (stone) wall.set(WALL_STONE).offsetHSL(0, 0, (seed - 0.5) * 0.08);
    else if (ladino) wall.set(LADIN_WALLS[Math.floor(seed * LADIN_WALLS.length) % LADIN_WALLS.length]);
    else wall.set(WALLS[Math.floor(seed * WALLS.length) % WALLS.length]);
    const roofSet = ladino && civil ? LADIN_ROOFS : (ROOFS[b.roof] ?? ROOFS[0]);
    roof.set(roofSet[Math.floor(seed * 7) % roofSet.length]).offsetHSL(0, 0, (hash2(cz, cx) - 0.5) * 0.06);
    // il piano terra: piÃ¹ scuro (nelle case ladine appena: il basamento Ã¨ intonaco come il resto)
    base.copy(wall).multiplyScalar(ladino && civil ? 0.9 : 0.84);
    const wood = ladino && civil ? tmpW.set(LADIN_WOOD[Math.floor(hash2(cz * 1.3, cx) * LADIN_WOOD.length) % LADIN_WOOD.length]) : null;
    // i tetti in coppi sono quasi tutti rossi: il grigio dei dati OSM resta ai tetti piani
    const pitchedRoof = b.architecture?.roofColour || (ladino && civil) ? roof : b.roof === 0 || b.kind === BUILDING_KIND.house ? roof : tmpC.set(ROOFS[0][Math.floor(seed * 4) % 4]);
    const { top, shape } = addBuilding(
      walls,
      roofs,
      b,
      ground,
      {
        wall,
        base,
        roof,
        entranceGround: b.architecture?.entrances ? (x, z) => field.height(x, z, spec.spacing) : undefined,
        tiles: pitchedRoof,
        blind: stone || b.kind === BUILDING_KIND.industrial,
        ribbon: b.kind === BUILDING_KIND.industrial ? RIBBON : undefined,
        pitch: ladino && civil ? LADIN_PITCH : undefined,
        eaves: ladino && civil ? 1.3 : undefined,
        wide: ladino && civil ? true : undefined,
        // i balconi in rilievo solo nelle mattonelle vicine: piÃ¹ in lÃ  sono meno di un pixel
        alpine: wood ? { wood, balconies: spec.ring <= 2 } : undefined,
      },
      plinth,
    );
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

/**
 * La quota piÃ¹ bassa e piÃ¹ alta del terreno sotto un'impronta: vertici, punti lungo i lati ogni
 * 6 m e il centro. Lo stesso `field.height` della mattonella, cosÃ¬ vale quello che si vede.
 */
export function footprintGround(field: Pick<WorldField, 'height'>, r: ArrayLike<number>, spacing: number, cx: number, cz: number): { low: number; high: number } {
  let low = Infinity;
  let high = -Infinity;
  const at = (x: number, z: number) => {
    const h = field.height(x, z, spacing);
    if (h < low) low = h;
    if (h > high) high = h;
  };
  const m = r.length / 2;
  for (let i = 0; i < m; i++) {
    const ax = r[i * 2];
    const az = r[i * 2 + 1];
    const bx = r[((i + 1) % m) * 2];
    const bz = r[((i + 1) % m) * 2 + 1];
    at(ax, az);
    const k = Math.floor(Math.hypot(bx - ax, bz - az) / 6);
    for (let j = 1; j <= k; j++) at(ax + ((bx - ax) * j) / (k + 1), az + ((bz - az) * j) / (k + 1));
  }
  at(cx, cz);
  return { low, high };
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

/**
 * Gli alberi della mattonella, per cella di 25 m secondo l'uso del suolo. `forestOnly` (con un
 * `seed` diverso da 0) fa il bosco fitto delle mattonelle vicine: solo dove il suolo Ã¨ bosco, in
 * altri punti della cella, e senza ripetere i sassi. Le specie e la linea del bosco le dÃ 
 * look.ts: il bosco si dirada verso la linea e sopra non c'Ã¨ un albero; le piste da sci sono
 * radure.
 */
export function* treesJob(field: WorldField, spec: TileSpec, seed = 0, forestOnly = false, ctx: LookCtx = lookContext(field.terrain?.graph?.id ?? 'bergamo'), roadPoints?: ReturnType<typeof indexRoadPoints>): Generator<void, TileMeshes['trees'], void> {
  const out: TileMeshes['trees'] = [];
  const cell = 25;
  const n = Math.round(spec.size / cell);
  const look = ctx.look;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = spec.x0 + (i + 0.5) * cell;
      const cz = spec.z0 + (j + 0.5) * cell;
      const cov = field.terrain.cover(cx, cz);
      if (forestOnly && cov !== COVER.forest) continue;
      let per =
        cov === COVER.forest ? spec.trees : cov === COVER.open || cov === COVER.farmland ? spec.trees * 0.07 : cov === COVER.park ? spec.trees * 0.25 : cov === COVER.residential ? spec.trees * 0.05 : cov === COVER.rock ? 0.15 : 0;
      if (per <= 0) continue;
      // verso la linea del bosco le celle si svuotano (i sassi della roccia no)
      if (cov !== COVER.rock) per *= treeDensity(look, field.terrain.height(cx, cz));
      let k = Math.floor(per);
      if (hash2(cx * 0.37 + seed, cz * 0.91 - seed) < per - k) k++;
      for (let t = 0; t < k; t++) {
        const rx = hash2(cx + t * 13.1 + seed * 1.7, cz - t * 7.7);
        const rz = hash2(cz + t * 3.3, cx + t * 5.9 - seed * 2.3);
        const x = cx + (rx - 0.5) * cell;
        const z = cz + (rz - 0.5) * cell;
        const y = field.height(x, z, spec.spacing);
        // nÃ© sull'asfalto, nÃ© nell'acqua, nÃ© dentro una galleria, nÃ© sotto un ponte (la chioma bucava l'impalcato)
        if (field.lastRoadDist() < 4 || field.lastWater() || field.inTube(x, z, y) || field.nearBridge(x, z)) continue;
        const kind = cov === COVER.rock ? 'rock' : treeSpecies(look, y, hash2(x * 1.7, z * 2.3));
        if (!kind) continue;
        // pendenza dal terreno: sulle pareti non cresce un bosco (sui versanti ripidi sÃ¬)
        const sx = field.height(x + 4, z, spec.spacing) - y;
        const sz = field.height(x, z + 4, spec.spacing) - y;
        if (kind !== 'rock' && Math.hypot(sx, sz) / 4 > (cov === COVER.forest ? 1.7 : 1.15)) continue;
        if (kind !== 'rock' && roadPoints?.(x - 4, z - 4, 8).some(p => p[2] !== 'lamp' && (x-p[0])**2 + (z-p[1])**2 < 16)) continue;
        const r = hash2(x * 3.1, z * 0.7);
        out.push({ kind, x, y: y - 0.15, z, s: kind === 'rock' ? 0.6 + r * 1.6 : 0.62 + r * 0.9, r: r * Math.PI * 2, tint: hash2(z, x) });
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
  lamps: { x: number; y: number; z: number; h: number; scaleY?: number }[];
  /** cartelli bianchi col nome del paese; h Ã¨ la direzione di chi entra */
  towns: { x: number; y: number; z: number; h: number; name: string }[];
}

/**
 * Lampioni ogni 30 m sulle strade dei paesi (un lato, alternato), e il cartello col nome dove una
 * strada entra nell'abitato. Il nome Ã¨ quello del paese piÃ¹ vicino nei dati OSM, entro 1,5 km.
 */
export function* furnitureJob(graph: WorldGraph, field: WorldField, places: Place[], spec: TileSpec, roadPoints?: ReturnType<typeof indexRoadPoints>): Generator<void, Furniture, void> {
  const lamps: Furniture['lamps'] = [];
  const towns: Furniture['towns'] = [];
  const x0 = spec.x0;
  const z0 = spec.z0;
  const x1 = spec.x0 + spec.size;
  const z1 = spec.z0 + spec.size;
  const ids = new Set<number>();
  for (let x = x0 - 50; x <= x1 + 50; x += 90) for (let z = z0 - 50; z <= z1 + 50; z += 90) collectEdges(graph, x, z, ids);
  const surveyed = (roadPoints?.(x0, z0, spec.size, 45) ?? []).filter(p => p[2] === 'lamp');
  for (const [x, z, , height] of surveyed) {
    if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
    const hit = graph.nearest(x, z, 23, edge => !(edge.flags & FLAG.tunnel));
    if (!hit) continue;
    const p = graph.pose(hit.edge, hit.s, 1);
    lamps.push({ x, z, y: field.height(x, z, spec.spacing), h: Math.atan2(p.x-x, p.z-z), scaleY: height ? height / 6.6 : 1 });
  }
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
    // lampioni nei tratti urbani, lontano dalle estremitÃ  (gli incroci li hanno giÃ )
    if (!(e.flags & FLAG.bridge)) {
      const pa = portalClear(graph, e.id, true);
      const pb = portalClear(graph, e.id, false);
      for (let s = 15; s < e.length - 10; s += 30) {
        if (s < pa || s > e.length - pb) continue;
        const k = Math.round((s / e.length) * n);
        if (!urban[k]) continue;
        const p = graph.pose(e.id, s, 1);
        if (!inside(p.x, p.z)) continue;
        const side = Math.floor(s / 30) % 2 === 0 ? 1 : -1;
        const off = e.hw + 0.9;
        const lx = p.x + Math.cos(p.heading) * off * side;
        const lz = p.z - Math.sin(p.heading) * off * side;
        if (surveyed.some(([x, z]) => Math.hypot(x-lx, z-lz) < 40)) continue;
        // mai in mezzo a un'altra strada (due sensi unici che confluiscono, una via accanto)
        if (graph.asphaltMargin(lx, lz, p.y, 1.5, e.id) > -0.3) continue;
        // h: rotazione che porta il braccio (+z del modello) verso il centro della strada
        lamps.push({ x: lx, y: p.y, z: lz, h: Math.atan2(-Math.cos(p.heading) * side, Math.sin(p.heading) * side) });
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
        const tx = p.x - Math.cos(p.heading) * off;
        const tz = p.z + Math.sin(p.heading) * off;
        if (graph.asphaltMargin(tx, tz, p.y, 1.5, e.id) > -0.3) continue;
        towns.push({ x: tx, y: p.y, z: tz, h: p.heading, name });
        k += 6;
      }
    }
    if (++count % 40 === 0) yield;
  }
  return { lamps, towns };
}
