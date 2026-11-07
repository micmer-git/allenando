import { CLS, FLAG } from './graph';

/*
 * Incroci in pianta fra strade che NON condividono un nodo: un ponte sopra una strada, una
 * strada sopra una galleria, un sottopasso. Qui si trovano (una griglia di celle sui segmenti
 * delle piante) e si dice quanta luce serve fra le due quote. Lo usano il costruttore del mondo
 * (scripts/world/build-world.ts), che alza il ponte o abbassa la galleria, e la prova che cerca
 * in tutto il grafo i punti dove il ciclista entrerebbe in un impalcato (piano OROBIA 07/11, M.1).
 */

/** Luce libera sotto un impalcato, metri: un camion ci passa. */
export const BRIDGE_LIGHT = 4.5;
/** Spessore dell'impalcato disegnato (tiles.ts: la trave scende a −1,6 m dal piano stradale). */
export const BRIDGE_DECK = 1.6;
/** Guscio di calcestruzzo di una galleria (tunnels.ts: SHELL), più un margine di terra sopra. */
const TUNNEL_SHELL = 0.6;
const TUNNEL_COVER = 0.4;

export interface RoadLike {
  flags: number;
  hw: number;
  cls: number;
}

/** La chiave di volta di una galleria sopra la sua strada: la stessa sezione di tunnels.ts (tubeSize). */
export function tunnelCrown(e: RoadLike): number {
  const foot = e.cls === CLS.cycleway || e.cls === CLS.pedestrian;
  const W = e.hw + (foot ? 0.45 : 0.9);
  const R = Math.min(4, W * (foot ? 0.85 : 0.75));
  return (foot ? 2 : 2.4) + R;
}

export interface Clearance {
  /** 0 se la prima strada sta sopra, 1 se sta sopra la seconda */
  upper: 0 | 1;
  /** metri fra le due quote, dalla strada sotto a quella sopra */
  need: number;
  /** quanta parte della correzione va alla strada sopra (il resto la strada sotto scende) */
  moveUpper: number;
}

/**
 * Chi passa sopra e con quanta luce. Un ponte sta sopra una strada o una galleria, una strada
 * sopra una galleria; fra due strade uguali (o due ponti, due gallerie) non si decide niente.
 */
export function crossingClearance(a: RoadLike, b: RoadLike): Clearance | null {
  const bridge = (e: RoadLike) => (e.flags & FLAG.bridge) !== 0 && !(e.flags & FLAG.tunnel);
  const tunnel = (e: RoadLike) => (e.flags & FLAG.tunnel) !== 0;
  let upper: 0 | 1;
  if (bridge(a) && !bridge(b)) upper = 0;
  else if (bridge(b) && !bridge(a)) upper = 1;
  else if (tunnel(a) && !tunnel(b)) upper = 1;
  else if (tunnel(b) && !tunnel(a)) upper = 0;
  else return null;
  const up = upper === 0 ? a : b;
  const low = upper === 0 ? b : a;
  const overBridge = bridge(up);
  const underTunnel = tunnel(low);
  let need = 0;
  if (overBridge) need += BRIDGE_LIGHT + BRIDGE_DECK;
  if (underTunnel) need += tunnelCrown(low) + TUNNEL_SHELL + TUNNEL_COVER;
  if (overBridge && underTunnel) need -= BRIDGE_LIGHT - TUNNEL_COVER; // la volta può stare sotto la trave, non serve anche la luce
  // un ponte si alza coi suoi terrapieni, una galleria si scava: è così nel vero
  const moveUpper = overBridge && underTunnel ? 0.5 : overBridge ? 1 : 0;
  return { upper, need, moveUpper };
}

export interface Polyline {
  xs: ArrayLike<number>;
  zs: ArrayLike<number>;
  /** nodi ai capi: due piante con un nodo in comune non si incrociano, si toccano */
  a: number;
  b: number;
}

export interface PlanCrossing {
  i: number;
  j: number;
  x: number;
  z: number;
  /** distanza lungo la pianta i (e j) dal suo primo vertice al punto d'incrocio */
  si: number;
  sj: number;
}

/**
 * Tutti i punti dove due piante diverse, senza nodi in comune, si attraversano. Le piante si
 * mettono in celle di `cell` metri; ogni coppia di segmenti si prova una volta sola.
 */
export function planCrossings(lines: Polyline[], cell = 50): PlanCrossing[] {
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 1_000_000) * 2_000_003 + (cz + 1_000_000);
  const cums: Float64Array[] = [];
  lines.forEach((l, i) => {
    const n = l.xs.length;
    const cum = new Float64Array(n);
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(l.xs[k] - l.xs[k - 1], l.zs[k] - l.zs[k - 1]);
    cums.push(cum);
    for (let k = 0; k < n - 1; k++) {
      const cx0 = Math.floor(Math.min(l.xs[k], l.xs[k + 1]) / cell);
      const cx1 = Math.floor(Math.max(l.xs[k], l.xs[k + 1]) / cell);
      const cz0 = Math.floor(Math.min(l.zs[k], l.zs[k + 1]) / cell);
      const cz1 = Math.floor(Math.max(l.zs[k], l.zs[k + 1]) / cell);
      const code = i * 4096 + k;
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const b = grid.get(key(cx, cz));
          if (b) b.push(code);
          else grid.set(key(cx, cz), [code]);
        }
      }
    }
  });
  const out: PlanCrossing[] = [];
  const seen = new Set<string>();
  for (const bucket of grid.values()) {
    for (let p = 0; p < bucket.length; p++) {
      const i = Math.floor(bucket[p] / 4096);
      const k = bucket[p] % 4096;
      for (let q = p + 1; q < bucket.length; q++) {
        const j = Math.floor(bucket[q] / 4096);
        const m = bucket[q] % 4096;
        if (i === j) continue;
        const A = lines[i];
        const B = lines[j];
        if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
        const tag = i < j ? `${i}:${k}:${j}:${m}` : `${j}:${m}:${i}:${k}`;
        if (seen.has(tag)) continue;
        seen.add(tag);
        const ax = A.xs[k];
        const az = A.zs[k];
        const bx = A.xs[k + 1];
        const bz = A.zs[k + 1];
        const cx = B.xs[m];
        const cz = B.zs[m];
        const dx = B.xs[m + 1];
        const dz = B.zs[m + 1];
        const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
        const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const si = cums[i][k] + Math.hypot(bx - ax, bz - az) * t;
        const sj = cums[j][m] + Math.hypot(dx - cx, dz - cz) * u;
        out.push(i < j ? { i, j, x, z, si, sj } : { i: j, j: i, x, z, si: sj, sj: si });
      }
    }
  }
  return out;
}
