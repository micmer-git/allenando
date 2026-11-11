/*
 * Le impronte degli edifici e la carreggiata (piano OROBIA 07/11, M.2). Una casa che entra nella
 * fascia della strada (metà larghezza più ROAD_MARGIN) si sposta di quel che basta se il
 * morso è piccolo, si ritaglia lungo il bordo della fascia se è grande, diventa un passaggio
 * voltato se la strada le passa dentro, e sparisce se non resta niente. Senza three.js: la
 * costruzione del mondo e le prove usano la stessa regola.
 */

export type Ring = [number, number][];

/** Dal bordo della carreggiata al muro: la banchina, un marciapiede stretto. */
export const ROAD_MARGIN = 0.8;
/** Fin dove una casa si sposta intera invece di essere ritagliata. */
export const SHIFT_MAX = 2.5;
/** Un passaggio voltato: la strada passa sotto la casa da qui in su. */
export const PASSAGE_H = 4.3;
/**
 * Ogni quanto si prova un muro quando si sposta o si ritaglia una casa: lo spigolo di un incrocio
 * (un vertice del poligono dei raccordi) entra fra due punti a 2 m e non lo vede nessuno.
 */
const FIT_STEP = 0.5;

export interface RoadHit {
  /** semilarghezza della carreggiata */
  hw: number;
  /** distanza in pianta dalla mezzeria */
  d: number;
  /** il punto della mezzeria più vicino e la direzione della strada lì */
  px: number;
  pz: number;
  heading: number;
  edge: number;
  /**
   * Per l'asfalto di un incrocio (junctionProbe): la distanza con segno dal bordo del poligono
   * (negativa dentro) e la direzione verso fuori. Allora px, pz è il centro dell'incrocio.
   */
  gap?: number;
  out?: [number, number];
}

/** La strada più vicina a (x, z) entro pochi metri, o null. */
export type RoadProbe = (x: number, z: number) => RoadHit | null;

export interface Penetration {
  /** quanto il punto peggiore entra nella fascia, metri (≤ 0: fuori) */
  max: number;
  /** verso fuori, dal punto della mezzeria al punto peggiore */
  nx: number;
  nz: number;
  edge: number;
  /** la mezzeria di una strada passa dentro l'anello: la casa le sta sopra */
  through: boolean;
}

function pointInRing(ring: Ring, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** I punti di prova di un anello: i vertici e un punto ogni `step` metri lungo i lati. */
export function ringSamples(ring: Ring, step = 2): Ring {
  const out: Ring = [];
  const m = ring.length;
  for (let i = 0; i < m; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % m];
    out.push([ax, az]);
    const n = Math.floor(Math.hypot(bx - ax, bz - az) / step);
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / (n + 1), az + ((bz - az) * k) / (n + 1)]);
  }
  return out;
}

function outward(hit: RoadHit, x: number, z: number): [number, number] {
  if (hit.out) return hit.out;
  const dx = x - hit.px;
  const dz = z - hit.pz;
  const d = Math.hypot(dx, dz);
  if (d > 0.05) return [dx / d, dz / d];
  return [Math.cos(hit.heading), -Math.sin(hit.heading)];
}

/** Quanto un punto entra nella fascia: metà larghezza più il margine meno la distanza dalla mezzeria. */
function bite(hit: RoadHit, margin: number): number {
  return hit.gap != null ? margin - hit.gap : hit.hw + margin - hit.d;
}

/** Quanto un anello entra nella fascia delle strade vicine, provando un punto ogni `step` metri lungo i muri. */
export function ringPenetration(ring: Ring, probe: RoadProbe, margin = ROAD_MARGIN, step = 2): Penetration {
  const out: Penetration = { max: -Infinity, nx: 0, nz: 0, edge: -1, through: false };
  // la casa sta a cavallo della strada se la mezzeria le passa dentro, o se i suoi muri mordono la
  // stessa strada da entrambi i lati (un angolo che scavalca la mezzeria): spostarla o ritagliarla
  // la farebbe a forcella attorno all'asfalto
  const sides = new Map<number, number>();
  for (const [x, z] of ringSamples(ring, step)) {
    const hit = probe(x, z);
    if (!hit) continue;
    const pen = bite(hit, margin);
    if (pen > out.max) {
      const [nx, nz] = outward(hit, x, z);
      out.max = pen;
      out.nx = nx;
      out.nz = nz;
      out.edge = hit.edge;
    }
    if (pen <= 0.3) continue;
    if (!out.through && pointInRing(ring, hit.px, hit.pz)) out.through = true;
    if (hit.gap == null && hit.d > 0.05) {
      const side = Math.sign(Math.cos(hit.heading) * (x - hit.px) - Math.sin(hit.heading) * (z - hit.pz)) > 0 ? 1 : 2;
      const seen = (sides.get(hit.edge) ?? 0) | side;
      sides.set(hit.edge, seen);
      if (seen === 3) out.through = true;
    }
  }
  if (out.max === -Infinity) out.max = -1;
  return out;
}

export function ringArea2(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    s += ax * bz - bx * az;
  }
  return s / 2;
}

export type FitAction = 'ferma' | 'spostata' | 'ritagliata' | 'passaggio' | 'tolta';

export interface FitResult {
  ring: Ring;
  minH: number;
  action: FitAction;
  /** il morso prima della correzione, metri */
  before: number;
}

/**
 * L'impronta fuori dalla carreggiata. `h` e `minH` sono l'altezza e la quota minima dell'edificio.
 * Chi deforma meno vince: un morso fino a SHIFT_MAX sposta la casa intera (se dall'altra parte
 * non c'è un'altra strada), uno più grande ritaglia solo i punti dentro la fascia; se una
 * mezzeria passa dentro l'anello la casa è un passaggio voltato (minH ≥ PASSAGE_H) o, se è
 * troppo bassa, si toglie.
 */
export function fitRingToRoads(ring: Ring, h: number, minH: number, probe: RoadProbe, margin = ROAD_MARGIN): FitResult {
  const pen = ringPenetration(ring, probe, margin, FIT_STEP);
  if (pen.max <= 0.02) return { ring, minH, action: 'ferma', before: pen.max };
  if (minH >= PASSAGE_H - 0.5) return { ring, minH, action: 'ferma', before: pen.max };
  if (pen.through) {
    if (h - PASSAGE_H >= 2.5) return { ring, minH: Math.max(minH, PASSAGE_H), action: 'passaggio', before: pen.max };
    return { ring: [], minH, action: 'tolta', before: pen.max };
  }
  if (pen.max <= SHIFT_MAX) {
    // si sposta lungo il morso peggiore; se un altro lato morde ancora (un angolo fra due
    // strade) si ritocca fino a tre volte, poi si rinuncia e si ritaglia
    let moved: Ring = ring;
    let cur = pen;
    let total = 0;
    for (let k = 0; k < 3 && cur.max > 0.02; k++) {
      const s = cur.max + 0.05;
      total += s;
      if (total > SHIFT_MAX + 0.5) break;
      moved = moved.map(([x, z]) => [x + cur.nx * s, z + cur.nz * s]);
      cur = ringPenetration(moved, probe, margin, FIT_STEP);
    }
    if (cur.max <= 0.05) return { ring: moved, minH, action: 'spostata', before: pen.max };
  }
  // ritaglio: ogni punto dentro la fascia va sul suo bordo (un punto al metro, così la corda fra
  // due punti non rientra nella fascia dove la strada curva). Più giri, perché all'angolo fra due
  // strade un punto tolto dalla fascia dell'una finisce in quella dell'altra: con due giri 27
  // case restavano 16–33 cm dentro la carreggiata (prova M.2)
  let cut: Ring = ring;
  let left = ringPenetration(cut, probe, margin, FIT_STEP);
  for (let pass = 0; pass < 6 && left.max > 0.05; pass++) {
    cut = ringSamples(cut, 1).map(([x, z]) => {
      const hit = probe(x, z);
      if (!hit) return [x, z];
      const p = bite(hit, margin) + 0.05;
      if (p <= 0) return [x, z];
      const [nx, nz] = outward(hit, x, z);
      return [x + nx * p, z + nz * p];
    });
    cut = tidyRing(cut);
    left = ringPenetration(cut, probe, margin, FIT_STEP);
  }
  if (cut.length < 3 || Math.abs(ringArea2(cut)) < 12) return { ring: [], minH, action: 'tolta', before: pen.max };
  // l'ultimo morso dell'angolo si toglie spostando il ritaglio, di poco
  for (let k = 0; k < 3 && left.max > 0.05 && left.max <= 1 && !left.through; k++) {
    const s = left.max + 0.05;
    const nx = left.nx;
    const nz = left.nz;
    const moved: Ring = cut.map(([x, z]) => [x + nx * s, z + nz * s]);
    const after = ringPenetration(moved, probe, margin, FIT_STEP);
    if (after.max >= left.max) break;
    cut = moved;
    left = after;
  }
  // il ritaglio non ce l'ha fatta (un angolo che scavalca una pista stretta diventa una forcella
  // attorno all'asfalto): allora la casa sta sopra la strada, o non sta
  if (left.max > 0.05) {
    if (h - PASSAGE_H >= 2.5) return { ring, minH: Math.max(minH, PASSAGE_H), action: 'passaggio', before: pen.max };
    return { ring: [], minH, action: 'tolta', before: pen.max };
  }
  return { ring: cut, minH, action: 'ritagliata', before: pen.max };
}

/** Toglie i punti doppi e quelli allineati coi vicini entro 3 cm: i punti che restano stanno dove stavano. */
function tidyRing(ring: Ring): Ring {
  const d: Ring = [];
  for (const p of ring) {
    const q = d[d.length - 1];
    if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.1) continue;
    d.push(p);
  }
  while (d.length > 1 && Math.hypot(d[0][0] - d[d.length - 1][0], d[0][1] - d[d.length - 1][1]) < 0.1) d.pop();
  const m = d.length;
  if (m < 3) return d;
  const out: Ring = [];
  for (let i = 0; i < m; i++) {
    const p = d[i];
    const prev = out.length ? out[out.length - 1] : d[m - 1];
    const next = d[(i + 1) % m];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    const dev = Math.abs((p[0] - prev[0]) * dz - (p[1] - prev[1]) * dx) / len;
    if (dev < 0.03) continue;
    out.push(p);
  }
  return out.length >= 3 ? out : d;
}

// ---------- l'asfalto degli incroci (M.2 con M.3) ----------

/** Il poligono di un incrocio (junctions.ts: JunctionGeo), quanto basta per tenerne fuori le case. */
export interface JunctionShape {
  cx: number;
  cz: number;
  ring: { x: number; z: number }[];
}

/**
 * Una sonda che vede l'asfalto degli incroci: i raccordi d'angolo allargano la carreggiata oltre
 * la fascia dei nastri, e prima 275 case ci entravano (fino a 5 m, agli angoli acuti). La distanza
 * è quella dal bordo del poligono, la direzione verso fuori quella del punto di bordo più vicino.
 */
export function junctionProbe(shapes: JunctionShape[], reach = 3, cell = 50): RoadProbe {
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 100_000) * 200_003 + (cz + 100_000);
  const radius: number[] = [];
  shapes.forEach((j, id) => {
    let r = 0;
    for (const v of j.ring) r = Math.max(r, Math.hypot(v.x - j.cx, v.z - j.cz));
    radius.push(r);
    const R = r + reach;
    for (let cx = Math.floor((j.cx - R) / cell); cx <= Math.floor((j.cx + R) / cell); cx++) {
      for (let cz = Math.floor((j.cz - R) / cell); cz <= Math.floor((j.cz + R) / cell); cz++) {
        const b = grid.get(key(cx, cz));
        if (b) b.push(id);
        else grid.set(key(cx, cz), [id]);
      }
    }
  });
  return (x, z) => {
    let best: RoadHit | null = null;
    for (const id of grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? []) {
      const j = shapes[id];
      if (Math.hypot(x - j.cx, z - j.cz) > radius[id] + reach) continue;
      const R = j.ring;
      let inside = false;
      let dBest = Infinity;
      let bx = 0;
      let bz = 0;
      for (let i = 0, k = R.length - 1; i < R.length; k = i++) {
        const a = R[i];
        const b = R[k];
        if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
        const px = a.x + ex * u;
        const pz = a.z + ez * u;
        const d = Math.hypot(x - px, z - pz);
        if (d < dBest) {
          dBest = d;
          bx = px;
          bz = pz;
        }
      }
      const gap = inside ? -dBest : dBest;
      if (gap > reach || (best && gap >= best.gap!)) continue;
      // verso fuori: dal bordo al punto se il punto è fuori, dal punto al bordo se è dentro
      let ox = inside ? bx - x : x - bx;
      let oz = inside ? bz - z : z - bz;
      const ol = Math.hypot(ox, oz);
      if (ol > 1e-6) {
        ox /= ol;
        oz /= ol;
      } else {
        const cl = Math.hypot(x - j.cx, z - j.cz) || 1;
        ox = (x - j.cx) / cl;
        oz = (z - j.cz) / cl;
      }
      best = { hw: 0, d: Math.hypot(x - j.cx, z - j.cz), px: j.cx, pz: j.cz, heading: 0, edge: -1 - id, gap, out: [ox, oz] };
    }
    return best;
  };
}

/** Delle due sonde, quella che dice il morso più profondo. */
export function deeperProbe(a: RoadProbe, b: RoadProbe, margin = ROAD_MARGIN): RoadProbe {
  return (x, z) => {
    const p = a(x, z);
    const q = b(x, z);
    if (!p) return q;
    if (!q) return p;
    return bite(q, margin) > bite(p, margin) ? q : p;
  };
}
