import { smoothstep } from '@/world/heightfield';
import { FLAG, type WorldGraph } from './graph';
import type { Terrain, WorldFeatures } from './world';

/**
 * Il terreno del mondo aperto come lo vede chi pedala: il DEM, ma raccordato a TUTTE le
 * strade in superficie (ponti e gallerie esclusi) e scavato sotto i fiumi. È la stessa regola
 * delle salite (world/heightfield.ts): vicino alla carreggiata il terreno scende alla sua
 * quota e, dentro la fascia coperta da un triangolo che tocca la strada, resta SOTTO
 * l'asfalto. Qui le strade sono migliaia: un indice a celle di 32 m le tiene a portata.
 */

const CELL = 32;

interface SegIndex {
  /** ax, az, bx, bz, ay, by, hw, grado: 8 numeri per segmento */
  seg: Float32Array;
  cells: Map<number, number[]>;
}

function key(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

function buildIndex(segs: number[]): SegIndex {
  const seg = new Float32Array(segs);
  const cells = new Map<number, number[]>();
  const count = seg.length / 8;
  for (let i = 0; i < count; i++) {
    const o = i * 8;
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
  /** distanza dal bordo della carreggiata (0 dentro) */
  edgeDist: number;
  /** distanza dalla mezzeria */
  dist: number;
  y: number;
  hw: number;
  grade: number;
}

function nearest(ix: SegIndex, x: number, z: number, reach: number, out: FieldHit): boolean {
  const r = Math.ceil(reach / CELL);
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = Infinity;
  const s = ix.seg;
  for (let oz = -r; oz <= r; oz++) {
    for (let ox = -r; ox <= r; ox++) {
      const bucket = ix.cells.get(key(cx + ox, cz + oz));
      if (!bucket) continue;
      for (const i of bucket) {
        const o = i * 8;
        const ax = s[o];
        const az = s[o + 1];
        const dx = s[o + 2] - ax;
        const dz = s[o + 3] - az;
        const len2 = dx * dx + dz * dz || 1;
        const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
        const px = ax + dx * u;
        const pz = az + dz * u;
        const d = Math.sqrt((x - px) ** 2 + (z - pz) ** 2);
        // si sceglie la strada col bordo più vicino, non la mezzeria: una statale larga vince sul vicolo
        const ed = Math.max(0, d - s[o + 6]);
        if (ed < best) {
          best = ed;
          out.edgeDist = ed;
          out.dist = d;
          out.y = s[o + 4] + (s[o + 5] - s[o + 4]) * u;
          out.hw = s[o + 6];
          out.grade = s[o + 7];
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
  terrain: Terrain;
}

export function createWorldField(graph: WorldGraph, terrain: Terrain, features: WorldFeatures): WorldField {
  const segs: number[] = [];
  for (const e of graph.edges) {
    if (e.flags & (FLAG.bridge | FLAG.tunnel)) continue;
    for (let k = 0; k < e.xs.length - 1; k++) {
      const run = e.cum[k + 1] - e.cum[k] || 1;
      segs.push(e.xs[k], e.zs[k], e.xs[k + 1], e.zs[k + 1], e.ys[k], e.ys[k + 1], e.hw, Math.abs(e.ys[k + 1] - e.ys[k]) / run);
    }
  }
  const roads = buildIndex(segs);
  const wsegs: number[] = [];
  for (const r of features.rivers) {
    const p = r.pts;
    for (let i = 0; i + 5 < p.length; i += 3) wsegs.push(p[i], p[i + 1], p[i + 3], p[i + 4], p[i + 2], p[i + 5], r.hw, 0);
  }
  const water = buildIndex(wsegs);
  const hit: FieldHit = { edgeDist: 0, dist: 0, y: 0, hw: 3, grade: 0 };
  const wHit: FieldHit = { edgeDist: 0, dist: 0, y: 0, hw: 3, grade: 0 };
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
      if (!nearest(roads, x, z, 64, hit)) {
        lastDist = Infinity;
        return h;
      }
      lastDist = hit.edgeDist;
      const base = hit.y - 0.4;
      const w = smoothstep(1.5, 40, hit.edgeDist);
      let out = base + (h - base) * w;
      // dentro la fascia coperta da un triangolo che tocca la strada: sempre sotto l'asfalto
      if (hit.edgeDist < spacing * 1.6) out = Math.min(out, hit.y - 0.35 - spacing * 1.2 * hit.grade);
      return out;
    },
  };
}
