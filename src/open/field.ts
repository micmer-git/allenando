import { smoothstep } from '@/world/heightfield';
import { FLAG, type WorldGraph } from './graph';
import { inTube } from './tunnels';
import type { Terrain, WorldFeatures } from './world';

/**
 * Il terreno del mondo aperto come lo vede chi pedala: il DEM, ma raccordato a TUTTE le
 * strade in superficie (ponti e gallerie esclusi) e scavato sotto i fiumi. È la stessa regola
 * delle salite (world/heightfield.ts): vicino alla carreggiata il terreno scende alla sua
 * quota e, dentro la fascia coperta da un triangolo che tocca la strada, resta SOTTO
 * l'asfalto. Qui le strade sono migliaia: un indice a celle di 32 m le tiene a portata.
 */

const CELL = 32;

/** numeri per segmento: ax, az, bx, bz, ay, by, hw, grado, imbocchi (1 = a, 2 = b), arco (-1 per i fiumi) */
const STRIDE = 10;

interface SegIndex {
  seg: Float32Array;
  cells: Map<number, number[]>;
}

function key(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

function buildIndex(segs: number[]): SegIndex {
  const seg = new Float32Array(segs);
  const cells = new Map<number, number[]>();
  const count = seg.length / STRIDE;
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    const pad = seg[o + 6] + 2;
    const cx0 = Math.floor((Math.min(seg[o], seg[o + 2]) - pad) / CELL);
    const cx1 = Math.floor((Math.max(seg[o], seg[o + 2]) + pad) / CELL);
    const cz0 = Math.floor((Math.min(seg[o + 1], seg[o + 3]) - pad) / CELL);
    const cz1 = Math.floor((Math.max(seg[o + 1], seg[o + 3]) + pad) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = key(cx, cz);
        const b = cells.get(k);
        if (b) b.push(i);
        else cells.set(k, [i]);
      }
    }
  }
  return { seg, cells };
}

export interface FieldHit {
  /** l'arco del grafo (-1 per i fiumi) */
  edge: number;
  /** distanza dal bordo della carreggiata (0 dentro) */
  edgeDist: number;
  /** distanza dalla mezzeria */
  dist: number;
  y: number;
  hw: number;
  grade: number;
}

/**
 * La strada col bordo più vicino entro `reach`; con `second`, anche la più vicina fra quelle di un
 * ALTRO arco (per raccordare il terreno fra due strade a quote diverse).
 */
function nearest(ix: SegIndex, x: number, z: number, reach: number, out: FieldHit, second?: FieldHit): boolean {
  const r = Math.ceil(reach / CELL);
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = Infinity;
  let best2 = Infinity;
  if (second) second.edge = -2;
  const s = ix.seg;
  for (let oz = -r; oz <= r; oz++) {
    for (let ox = -r; ox <= r; ox++) {
      const bucket = ix.cells.get(key(cx + ox, cz + oz));
      if (!bucket) continue;
      for (const i of bucket) {
        const o = i * STRIDE;
        const ax = s[o];
        const az = s[o + 1];
        const dx = s[o + 2] - ax;
        const dz = s[o + 3] - az;
        const len2 = dx * dx + dz * dz || 1;
        const raw = ((x - ax) * dx + (z - az) * dz) / len2;
        // oltre l'imbocco di una galleria la strada d'accesso non scava: lì comincia il monte
        const portal = s[o + 8];
        if ((raw < 0 && portal % 2 === 1) || (raw > 1 && portal >= 2)) continue;
        const u = Math.min(1, Math.max(0, raw));
        const px = ax + dx * u;
        const pz = az + dz * u;
        const d = Math.sqrt((x - px) ** 2 + (z - pz) ** 2);
        // si sceglie la strada col bordo più vicino, non la mezzeria: una statale larga vince sul vicolo
        const ed = Math.max(0, d - s[o + 6]);
        const edge = s[o + 9];
        if (ed < best) {
          // la migliore di prima diventa la seconda, se era di un altro arco
          if (second && best < Infinity && out.edge !== edge) {
            best2 = best;
            Object.assign(second, out);
          }
          best = ed;
          out.edge = edge;
          out.edgeDist = ed;
          out.dist = d;
          out.y = s[o + 4] + (s[o + 5] - s[o + 4]) * u;
          out.hw = s[o + 6];
          out.grade = s[o + 7];
        } else if (second && ed < best2 && edge !== out.edge) {
          best2 = ed;
          second.edge = edge;
          second.edgeDist = ed;
          second.dist = d;
          second.y = s[o + 4] + (s[o + 5] - s[o + 4]) * u;
          second.hw = s[o + 6];
          second.grade = s[o + 7];
        }
      }
    }
  }
  return best < Infinity;
}

export interface WorldField {
  /** quota del terreno raccordato, per una griglia di passo `spacing` */
  height(x: number, z: number, spacing: number): number;
  /** distanza dal bordo strada dell'ultimo punto chiesto a height() */
  lastRoadDist(): number;
  /** true se l'ultimo punto chiesto cade nell'alveo di un fiume */
  lastWater(): boolean;
  /** quota della strada più vicina (entro reach) o null */
  roadAt(x: number, z: number, reach?: number): FieldHit | null;
  /** (x, z) a quota y cade dentro la sagoma di una galleria (o poco sopra): niente alberi */
  inTube(x: number, z: number, y: number): boolean;
  /** (x, z) sta sotto o accanto a un ponte (entro `margin` dal bordo dell'impalcato): niente alberi che lo bucano */
  nearBridge(x: number, z: number, margin?: number): boolean;
  terrain: Terrain;
}

/** Larghezza del raccordo fra due strade vicine, metri. */
const BLEND = 16;

/** Fin dove la scarpata resta al più 0,9:1, metri dal bordo; oltre risale ripida verso il DEM. */
const BANK_END = 26;

/**
 * Di quanto il terreno può salire (o scendere) rispetto alla strada a `e` metri dal bordo, se da
 * `e0` in poi può staccarsene: una scarpata al più 0,9:1 fino a BANK_END, poi 2,5:1. Così una
 * strada scavata nel DEM a 25 m non corre in un canyon: la parete, se c'è, sta oltre i 26 m e fra
 * 6 e 20 m dal bordo la pendenza resta sotto 1:1 (piano del rilascio, M2).
 */
export function bankLimit(e: number, e0 = 1.5): number {
  if (e <= e0) return 0;
  if (e <= BANK_END) return 0.9 * (e - e0);
  return 0.9 * Math.max(0, BANK_END - e0) + 2.5 * (e - BANK_END);
}

/**
 * Il terreno vicino a una strada: il DEM raccordato alla quota della strada. Il raccordo è più
 * lungo quanto più il DEM se ne stacca (una sfumatura di 40 m su 30 m di dislivello farebbe una
 * parete), e resta dentro la scarpata di bankLimit sopra e sotto.
 */
function bank(h: number, road: number, hit: FieldHit, spacing: number): number {
  const base = road - 0.4;
  const dev = h - base;
  const e = hit.edgeDist;
  const span = Math.min(60, Math.max(38.5, (1.5 * Math.abs(dev)) / 0.9));
  let out = base + dev * smoothstep(1.5, 1.5 + span, e);
  // dentro la fascia coperta da un triangolo che tocca la strada: sempre sotto l'asfalto, e poi su
  // al più con la scarpata
  const near = spacing * 1.6;
  const top = road - 0.35 - spacing * 1.2 * hit.grade + bankLimit(e, near);
  out = Math.min(out, top);
  return Math.max(out, base - bankLimit(e));
}

export function createWorldField(graph: WorldGraph, terrain: Terrain, features: WorldFeatures): WorldField {
  // i nodi da cui parte una galleria: gli imbocchi
  const portal = new Set<number>();
  for (const e of graph.edges) {
    if (!(e.flags & FLAG.tunnel)) continue;
    portal.add(e.a);
    portal.add(e.b);
  }
  const segs: number[] = [];
  // i ponti a parte: il terreno non li raccorda, ma gli alberi non devono bucare l'impalcato
  const bsegs: number[] = [];
  for (const e of graph.edges) {
    if (e.flags & FLAG.tunnel) continue;
    const bridge = (e.flags & FLAG.bridge) !== 0;
    const last = e.xs.length - 2;
    for (let k = 0; k <= last; k++) {
      const run = e.cum[k + 1] - e.cum[k] || 1;
      const ends = (k === 0 && portal.has(e.a) ? 1 : 0) + (k === last && portal.has(e.b) ? 2 : 0);
      (bridge ? bsegs : segs).push(e.xs[k], e.zs[k], e.xs[k + 1], e.zs[k + 1], e.ys[k], e.ys[k + 1], e.hw, Math.abs(e.ys[k + 1] - e.ys[k]) / run, bridge ? 0 : ends, e.id);
    }
  }
  const roads = buildIndex(segs);
  const bridges = buildIndex(bsegs);
  const bHit: FieldHit = { edge: -1, edgeDist: 0, dist: 0, y: 0, hw: 3, grade: 0 };
  const wsegs: number[] = [];
  for (const r of features.rivers) {
    const p = r.pts;
    for (let i = 0; i + 5 < p.length; i += 3) wsegs.push(p[i], p[i + 1], p[i + 3], p[i + 4], p[i + 2], p[i + 5], r.hw, 0, 0, -1);
  }
  const water = buildIndex(wsegs);
  const hit: FieldHit = { edge: -1, edgeDist: 0, dist: 0, y: 0, hw: 3, grade: 0 };
  const hit2: FieldHit = { edge: -2, edgeDist: 0, dist: 0, y: 0, hw: 3, grade: 0 };
  const wHit: FieldHit = { edge: -1, edgeDist: 0, dist: 0, y: 0, hw: 3, grade: 0 };
  let lastDist = Infinity;
  let inWater = false;
  return {
    terrain,
    lastRoadDist: () => lastDist,
    lastWater: () => inWater,
    roadAt(x, z, reach = 40) {
      if (!nearest(roads, x, z, reach, hit)) return null;
      return { ...hit };
    },
    inTube: (x, z, y) => inTube(graph, x, z, y),
    nearBridge: (x, z, margin = 2.5) => nearest(bridges, x, z, margin + 8, bHit) && bHit.edgeDist < margin,
    height(x, z, spacing) {
      let h = terrain.height(x, z);
      inWater = false;
      // l'alveo: il fiume scorre sotto il fondovalle del DEM, che a 25 m lo «riempie»
      if (nearest(water, x, z, 40, wHit) && wHit.edgeDist < 30) {
        const bed = wHit.y - 1.2;
        if (wHit.edgeDist <= 0.01) {
          h = Math.min(h, bed);
          inWater = true;
        } else h = Math.min(h, bed + (h - bed) * smoothstep(0, 30, wHit.edgeDist) + wHit.edgeDist * 0.15);
      }
      if (!nearest(roads, x, z, 64, hit, hit2)) {
        lastDist = Infinity;
        return h;
      }
      lastDist = hit.edgeDist;
      let out = bank(h, hit.y, hit, spacing);
      // fra due strade a quote diverse il terreno passa dall'una all'altra senza gradino: vicino alla
      // linea di mezzo vale la media, e il raccordo si stende su BLEND metri
      if (hit2.edge >= 0) {
        const lam = 0.5 * smoothstep(0, BLEND, BLEND - (hit2.edgeDist - hit.edgeDist));
        if (lam > 0) out += (bank(h, hit2.y, hit2, spacing) - out) * lam;
      }
      // a meno di una maglia dalla strada più vicina vince lei: la sua carreggiata resta scoperta
      // (due strade a quote diverse più vicine di due maglie hanno un muro di sostegno, nel vero)
      if (hit.edgeDist < spacing) out = Math.min(out, hit.y - 0.35 - spacing * 1.2 * hit.grade);
      return out;
    },
  };
}
