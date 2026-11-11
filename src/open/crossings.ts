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

/** Segmenti per pianta nel codice delle celle: un fiume lungo (il Serio, 4738 vertici) ci sta. */
const SEGS = 1 << 20;

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
      const code = i * SEGS + k;
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
      const i = Math.floor(bucket[p] / SEGS);
      const k = bucket[p] % SEGS;
      for (let q = p + 1; q < bucket.length; q++) {
        const j = Math.floor(bucket[q] / SEGS);
        const m = bucket[q] % SEGS;
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

// ---------- l'acqua sotto le strade (piano OROBIA 07/11, M.8) ----------

/** Sotto un ponte l'acqua sta sotto la trave, con 60 cm d'aria. */
export const WATER_UNDER_DECK = BRIDGE_DECK + 0.6;
/** Una strada a raso su un torrente è un tombino: l'acqua passa sotto il rilevato, che la copre. */
export const WATER_UNDER_ROAD = 1.5;
/** L'acqua scende verso il ponte e risale dopo al più così: un tratto corto, nascosto dall'impalcato. */
export const WATER_RAMP = 0.05;

export interface WaterCrossing {
  /** distanza lungo il fiume dal suo primo vertice */
  s: number;
  /** la quota più alta che l'acqua può avere lì */
  top: number;
  /** per quanti metri, prima e dopo, l'acqua resta a `top` (la fascia della strada vista dal fiume) */
  half: number;
}

/**
 * Il livello di un fiume abbassato dove passa sotto una strada. Il livello viene dal DEM a 25 m,
 * che sotto un ponte stretto e in una forra pesca le sponde: prima 48 ponti avevano l'acqua sopra
 * l'asfalto e 15 strade a raso la avevano in carreggiata. Si aggiungono i vertici al punto
 * d'incrocio e ai bordi della fascia, poi ogni vertice scende sotto `top` più la rampa.
 */
export function lowerWaterAt(xz: [number, number][], ys: number[], crossings: WaterCrossing[]): { xz: [number, number][]; ys: number[]; lowered: number } {
  if (!crossings.length || xz.length < 2) return { xz, ys, lowered: 0 };
  const cum = [0];
  for (let i = 1; i < xz.length; i++) cum.push(cum[i - 1] + Math.hypot(xz[i][0] - xz[i - 1][0], xz[i][1] - xz[i - 1][1]));
  const L = cum[cum.length - 1];
  const at = (s: number): [number, number, number] => {
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi - 1) {
      const m = (lo + hi) >> 1;
      if (cum[m] <= s) lo = m;
      else hi = m;
    }
    const u = Math.min(1, Math.max(0, (s - cum[lo]) / (cum[hi] - cum[lo] || 1)));
    return [xz[lo][0] + (xz[hi][0] - xz[lo][0]) * u, xz[lo][1] + (xz[hi][1] - xz[lo][1]) * u, ys[lo] + (ys[hi] - ys[lo]) * u];
  };
  let lowered = 0;
  const extra: number[] = [];
  for (const c of crossings) {
    if (at(c.s)[2] > c.top + 0.01) lowered++;
    for (const s of [c.s - c.half, c.s, c.s + c.half]) if (s > 0 && s < L) extra.push(s);
  }
  const ss = [...cum, ...extra].sort((a, b) => a - b).filter((s, i, a) => i === 0 || s - a[i - 1] > 0.05);
  const outXz: [number, number][] = [];
  const outYs: number[] = [];
  for (const s of ss) {
    const [x, z, y] = at(s);
    let cap = Infinity;
    for (const c of crossings) cap = Math.min(cap, c.top + Math.max(0, Math.abs(s - c.s) - c.half) * WATER_RAMP);
    outXz.push([x, z]);
    outYs.push(Math.min(y, cap));
  }
  return { xz: outXz, ys: outYs, lowered };
}
