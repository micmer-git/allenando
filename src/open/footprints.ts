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
  const dx = x - hit.px;
  const dz = z - hit.pz;
  const d = Math.hypot(dx, dz);
  if (d > 0.05) return [dx / d, dz / d];
  return [Math.cos(hit.heading), -Math.sin(hit.heading)];
}

/** Quanto un anello entra nella fascia delle strade vicine. */
export function ringPenetration(ring: Ring, probe: RoadProbe, margin = ROAD_MARGIN): Penetration {
  const out: Penetration = { max: -Infinity, nx: 0, nz: 0, edge: -1, through: false };
  for (const [x, z] of ringSamples(ring)) {
    const hit = probe(x, z);
    if (!hit) continue;
    const pen = hit.hw + margin - hit.d;
    if (pen > out.max) {
      const [nx, nz] = outward(hit, x, z);
      out.max = pen;
      out.nx = nx;
      out.nz = nz;
      out.edge = hit.edge;
    }
    if (pen > 0 && !out.through && pointInRing(ring, hit.px, hit.pz)) out.through = true;
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

/** Douglas-Peucker su un anello chiuso (come in build-world), tolleranza in metri. */
function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length);
  let far = 1;
  let best = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, ring.length],
  ];
  const at = (i: number) => ring[i % ring.length];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, az] = at(a);
    const [bx, bz] = at(b);
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    let worst = -1;
    let wd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((at(i)[0] - ax) * dz - (at(i)[1] - az) * dx) / len;
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst % ring.length] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
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
  const pen = ringPenetration(ring, probe, margin);
  if (pen.max <= 0.02) return { ring, minH, action: 'ferma', before: pen.max };
  if (minH >= PASSAGE_H - 0.5) return { ring, minH, action: 'ferma', before: pen.max };
  if (pen.through) {
    if (h - PASSAGE_H >= 2.5) return { ring, minH: Math.max(minH, PASSAGE_H), action: 'passaggio', before: pen.max };
    return { ring: [], minH, action: 'tolta', before: pen.max };
  }
  if (pen.max <= SHIFT_MAX) {
    const s = pen.max + 0.05;
    const moved: Ring = ring.map(([x, z]) => [x + pen.nx * s, z + pen.nz * s]);
    const after = ringPenetration(moved, probe, margin);
    if (after.max <= 0.3) return { ring: moved, minH, action: 'spostata', before: pen.max };
  }
  // ritaglio: ogni punto dentro la fascia va sul suo bordo
  const dense = ringSamples(ring, 2);
  const cut: Ring = dense.map(([x, z]) => {
    const hit = probe(x, z);
    if (!hit) return [x, z];
    const p = hit.hw + margin - hit.d + 0.05;
    if (p <= 0) return [x, z];
    const [nx, nz] = outward(hit, x, z);
    return [x + nx * p, z + nz * p];
  });
  const slim = simplifyRing(cut, 0.2);
  if (slim.length < 3 || Math.abs(ringArea2(slim)) < 12) return { ring: [], minH, action: 'tolta', before: pen.max };
  return { ring: slim, minH, action: 'ritagliata', before: pen.max };
}
