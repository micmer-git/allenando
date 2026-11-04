import * as THREE from 'three';
import type { Monumento, Params } from '@/open/monumenti';
import { Mesh, PAL, mix, ringArea, tone, type Col, type V2, type V3 } from './kit';

/*
 * I modelli dei monumenti, per archetipo: porta delle Mura, torre, chiesa, cappella
 * rinascimentale, battistero, mausoleo, palazzo, castello, statua, monumento ai caduti,
 * stazione (treno, funicolare, funivia), casa storica di montagna. Ogni archetipo prende le
 * misure vere (impronta e altezza da OSM) e i parametri scritti in scripts/world/monumenti.ts
 * («la foto mentale del luogo vero»: il leone di San Marco, la cella campanaria, il rosone…).
 *
 * Due livelli: «alta» per chi ci passa accanto (cornici, bugnato, finestre, statue) e «bassa»
 * per chi lo vede da lontano (i volumi e i colori). Il tetto di triangoli è TRI_CAP: lo
 * controlla tests/monumenti.test.ts su tutti i quaranta.
 */

export type Dettaglio = 'alta' | 'bassa';

/** Triangoli al massimo per un modello: il telefono ne disegna pochi alla volta, ma tutti insieme no. */
export const TRI_CAP: Record<Dettaglio, number> = { alta: 6000, bassa: 1200 };

/** Oltre questa distanza (m) basta il modello «basso». */
export const LOD_NEAR = 320;

// ---------- parametri ----------

const num = (p: Params, k: string, d: number): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
const str = (p: Params, k: string, d: string): string => (typeof p[k] === 'string' ? (p[k] as string) : d);
const yes = (p: Params, k: string): boolean => p[k] === true;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const MAT: Record<string, Col> = {
  pietra: PAL.pietra,
  ocra: PAL.ocra,
  marmo: PAL.marmo,
  travertino: PAL.travertino,
  mattoni: PAL.mattoni,
  giallo: PAL.intonacoGiallo,
  rosa: PAL.intonacoRosa,
  bianco: PAL.intonacoBianco,
  verde: PAL.intonacoVerde,
  bronzo: PAL.bronzo,
  bronzoVerde: PAL.bronzoVerde,
  botticino: [0.9, 0.86, 0.77],
};
const mat = (p: Params, k: string, d: string): Col => MAT[str(p, k, d)] ?? MAT[d];

// ---------- anelli ----------

/** Anello spostato verso fuori di `off` metri (spigoli a punta, limitati). */
function offsetRing(r: V2[], off: number): V2[] {
  const ccw = ringArea(r) > 0;
  const n = r.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i - 1 + n) % n];
    const c = r[i];
    const q = r[(i + 1) % n];
    const e1 = norm2([c[0] - p[0], c[1] - p[1]]);
    const e2 = norm2([q[0] - c[0], q[1] - c[1]]);
    // normali esterne (anello antiorario: a destra del verso di percorrenza)
    const s = ccw ? 1 : -1;
    const n1: V2 = [e1[1] * s, -e1[0] * s];
    const n2: V2 = [e2[1] * s, -e2[0] * s];
    let bx = n1[0] + n2[0];
    let bz = n1[1] + n2[1];
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    const cosA = bx * n1[0] + bz * n1[1];
    const k = off / Math.max(0.5, cosA);
    out.push([c[0] + bx * k, c[1] + bz * k]);
  }
  return out;
}
const norm2 = (v: V2): V2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** La facciata: fin dove arriva l'impronta lungo +z sulla retta x = x0. */
function reachZ(r: V2[], x0 = 0): number {
  let best = -Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    if ((a[0] - x0) * (b[0] - x0) > 0 || a[0] === b[0]) continue;
    const t = (x0 - a[0]) / (b[0] - a[0]);
    best = Math.max(best, a[1] + (b[1] - a[1]) * t);
  }
  return Number.isFinite(best) ? best : Math.max(...r.map((p) => p[1]));
}

/** Larghezza dell'impronta sulla retta z = z0: l'intervallo che contiene x = 0 (o il più largo). */
function spanX(r: V2[], z0: number): [number, number] {
  const xs: number[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    if ((a[1] - z0) * (b[1] - z0) > 0 || a[1] === b[1]) continue;
    const t = (z0 - a[1]) / (b[1] - a[1]);
    xs.push(a[0] + (b[0] - a[0]) * t);
  }
  xs.sort((p, q) => p - q);
  let best: [number, number] = [0, 0];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i] <= 0 && xs[i + 1] >= 0) return [xs[i], xs[i + 1]];
    if (xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  }
  return best;
}

/** L'anello girato (per guardare una facciata laterale come se fosse quella davanti). */
const rotRing = (r: V2[], rot: number): V2[] => {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // l'inverso della rotazione di Mesh.append
  return r.map(([x, z]) => [x * c - z * s, x * s + z * c]);
};

// ---------- contesto di un modello ----------

interface Ctx {
  m: Mesh;
  M: Monumento;
  p: Params;
  hi: boolean;
  /** quanto scende lo zoccolo sotto il pavimento per toccare il terreno più basso */
  drop: number;
  ring: V2[];
}

function zoccolo(c: Ctx, col: Col = PAL.pietraScura, top = 0.35, off = 0.3): void {
  for (const r of c.M.rings) if (r.length >= 3) c.m.prism(offsetRing(r, off), -c.drop, top, col, col);
}

function cornice(m: Mesh, ring: V2[], y: number, col: Col, off = 0.45, h = 0.55): void {
  m.prism(offsetRing(ring, off), y, y + h, col, col, true);
}

/** Disegna una facciata come se guardasse +z (larghezza fw, a distanza fz) e la gira sul lato voluto. */
function onSide(c: Ctx, side: 0 | 1 | 2 | 3, draw: (m: Mesh, fz: number, x0: number, x1: number) => void, inset = 0.4): void {
  const rot = (side * Math.PI) / 2;
  const r = rotRing(c.ring, rot);
  const fz = reachZ(r, 0);
  const [x0, x1] = spanX(r, fz - inset);
  if (x1 - x0 < 1) return;
  const sm = new Mesh();
  draw(sm, fz, x0, x1);
  c.m.append(sm, 0, 0, 0, rot);
}

/** File di finestre su una facciata che guarda +z. */
function windows(m: Mesh, x0: number, x1: number, z: number, rows: [number, number][], opts: { step?: number; w?: number; frame?: Col; glass?: Col; skip?: [number, number]; arched?: boolean } = {}): void {
  const step = opts.step ?? 3.6;
  const ww = opts.w ?? 1.15;
  const n = Math.max(1, Math.floor((x1 - x0 - 1) / step));
  const pad = (x1 - x0 - (n - 1) * step) / 2;
  for (const [y0, y1] of rows) {
    for (let i = 0; i < n; i++) {
      const x = x0 + pad + i * step;
      if (opts.skip && x > opts.skip[0] && x < opts.skip[1]) continue;
      if (opts.frame) m.panel(x - ww / 2 - 0.18, y0 - 0.18, x + ww / 2 + 0.18, y1 + 0.22, z + 0.04, opts.frame, 0.06);
      m.panel(x - ww / 2, y0, x + ww / 2, y1, z + 0.1, opts.glass ?? PAL.vetro, 0.05);
      if (opts.arched) m.disc(x, y1, z + 0.16, ww / 2, 6, opts.glass ?? PAL.vetro);
    }
  }
}

/** Il quadrante di un orologio su una facciata che guarda +z. */
function clock(m: Mesh, cx: number, cy: number, z: number, r: number, hi: boolean, face: Col = PAL.bianco, ring: Col = PAL.ferro): void {
  m.disc(cx, cy, z + 0.04, r * 1.12, hi ? 16 : 8, ring);
  m.disc(cx, cy, z + 0.1, r, hi ? 16 : 8, face);
  if (!hi) return;
  // le lancette: le dieci e dieci, si leggono da lontano
  m.beam([cx, cy, z + 0.16], [cx - r * 0.5, cy + r * 0.38, z + 0.16], r * 0.09, PAL.ferro, r * 0.05);
  m.beam([cx, cy, z + 0.18], [cx + r * 0.72, cy + r * 0.45, z + 0.18], r * 0.07, PAL.ferro, r * 0.04);
}

/** Il leone di San Marco in rilievo, su una facciata che guarda +z: la firma di Venezia sulle porte. */
function leone(m: Mesh, cx: number, cy: number, z: number, s: number, stone: Col): void {
  const gold = mix(stone, PAL.oro, 0.35);
  m.panel(cx - 1.7 * s, cy - 1.05 * s, cx + 1.7 * s, cy + 1.05 * s, z, tone(stone, 0.86), 0.12);
  const zz = z + 0.25 * s;
  // corpo, zampe, testa con la criniera, ali alzate, il libro aperto
  m.box(cx - 1.0 * s, cy - 0.35 * s, zz - 0.1, cx + 0.7 * s, cy + 0.15 * s, zz + 0.22 * s, gold, { open: 'z-' });
  for (const lx of [-0.85, -0.55, 0.35, 0.6]) m.box(cx + lx * s, cy - 0.85 * s, zz - 0.1, cx + (lx + 0.16) * s, cy - 0.35 * s, zz + 0.16 * s, gold, { open: 'z-' });
  m.box(cx + 0.6 * s, cy - 0.05 * s, zz - 0.1, cx + 1.15 * s, cy + 0.55 * s, zz + 0.3 * s, gold, { open: 'z-' });
  m.poly([[cx - 0.6 * s, cy + 0.15 * s, zz + 0.1], [cx + 0.3 * s, cy + 0.15 * s, zz + 0.1], [cx - 0.95 * s, cy + 0.95 * s, zz + 0.1]], gold, [cx, cy, zz - 1]);
  m.poly([[cx - 0.4 * s, cy + 0.15 * s, zz + 0.16], [cx + 0.45 * s, cy + 0.15 * s, zz + 0.16], [cx - 0.35 * s, cy + 0.85 * s, zz + 0.16]], tone(gold, 1.08), [cx, cy, zz - 1]);
  m.box(cx + 0.95 * s, cy - 0.5 * s, zz + 0.15, cx + 1.45 * s, cy - 0.1 * s, zz + 0.3, PAL.bianco, { open: 'z-' });
  m.beam([cx - 1.0 * s, cy - 0.1 * s, zz + 0.05], [cx - 1.45 * s, cy + 0.4 * s, zz + 0.05], 0.09 * s, gold);
}

/** Un rosone: anello chiaro, raggi, centro scuro, su una facciata che guarda +z. */
function rosone(m: Mesh, cx: number, cy: number, z: number, r: number, hi: boolean, stone: Col): void {
  m.disc(cx, cy, z + 0.05, r * 1.18, hi ? 14 : 8, tone(stone, 1.08));
  m.disc(cx, cy, z + 0.12, r, hi ? 14 : 8, PAL.vetro);
  if (!hi) return;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    m.beam([cx, cy, z + 0.18], [cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95, z + 0.18], r * 0.08, tone(stone, 1.08));
  }
  m.disc(cx, cy, z + 0.22, r * 0.22, 8, tone(stone, 1.08));
}

/** Un portale: vano scuro con stipiti e architrave chiari, su una facciata che guarda +z. */
function portale(m: Mesh, cx: number, z: number, w: number, h: number, frame: Col, hi: boolean, arched = true): void {
  m.panel(cx - w / 2, 0, cx + w / 2, h, z + 0.06, PAL.legno, 0.08);
  if (arched) m.disc(cx, h, z + 0.1, w / 2, hi ? 10 : 6, PAL.buio);
  if (!hi) return;
  m.box(cx - w / 2 - 0.45, 0, z, cx - w / 2, h + 0.3, z + 0.35, frame, { open: 'z-y-' });
  m.box(cx + w / 2, 0, z, cx + w / 2 + 0.45, h + 0.3, z + 0.35, frame, { open: 'z-y-' });
  m.box(cx - w / 2 - 0.6, h + (arched ? w / 2 : 0) + 0.1, z, cx + w / 2 + 0.6, h + (arched ? w / 2 : 0) + 0.6, z + 0.4, frame, { open: 'z-' });
}

/** Una colonna con base e capitello. */
function colonna(m: Mesh, cx: number, cz: number, r: number, y0: number, y1: number, col: Col, hi: boolean): void {
  if (hi) {
    m.boxAt(cx, y0, cz, r * 2.6, 0.35, r * 2.6, col);
    m.cyl(cx, cz, r, r * 0.88, y0 + 0.35, y1 - 0.4, 8, col, false);
    m.boxAt(cx, y1 - 0.4, cz, r * 2.5, 0.4, r * 2.5, col);
  } else m.box(cx - r, y0, cz - r, cx + r, y1, cz + r, col, { open: 'y-' });
}

/** Merli (guelfi: a parallelepipedo) lungo un segmento in pianta, sopra la quota y. */
function merli(m: Mesh, a: V2, b: V2, y: number, t: number, col: Col): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.floor(len / 1.6);
  if (n < 1) return;
  const ux = (b[0] - a[0]) / len;
  const uz = (b[1] - a[1]) / len;
  const rot = Math.atan2(ux, uz) - Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * (len / n);
    m.boxAt(a[0] + ux * s, y, a[1] + uz * s, 0.85, 1.1, t, col, rot);
  }
}

// ---------- persone e cavalli (le statue) ----------

type Braccio = 'fianco' | 'alzato' | 'petto' | 'avanti' | 'lira' | 'piccone';

/** Una figura in piedi alta s, che guarda +z, coi piedi in (0, 0, 0). */
function persona(s: number, col: Col, opts: { braccio?: Braccio; mantello?: boolean; gonna?: boolean; hi?: boolean } = {}): Mesh {
  const m = new Mesh();
  const hi = opts.hi ?? true;
  const leg = 0.47 * s;
  const sh = 0.81 * s;
  if (opts.gonna) m.cyl(0, 0, 0.17 * s, 0.13 * s, 0, 0.55 * s, hi ? 8 : 5, col, true);
  else {
    m.beam([-0.065 * s, 0, 0], [-0.07 * s, leg, 0], 0.11 * s, col, 0.13 * s);
    m.beam([0.065 * s, 0, 0], [0.07 * s, leg, 0], 0.11 * s, col, 0.13 * s);
  }
  // busto: dal bacino alle spalle, un po' più largo in alto
  m.beam([0, leg - 0.04 * s, 0], [0, sh, 0], 0.25 * s, col, 0.33 * s);
  if (opts.mantello) m.beam([0, sh - 0.02 * s, -0.03 * s], [0, 0.18 * s, -0.06 * s], 0.36 * s, tone(col, 0.92), 0.4 * s);
  m.beam([0, sh, 0], [0, sh + 0.05 * s, 0], 0.09 * s, col);
  m.ball(0, sh + 0.12 * s, 0.01 * s, 0.075 * s, col, hi ? 7 : 5, hi ? 3 : 2);
  // braccia: il sinistro lungo il fianco, il destro come chiede la posa
  const shL: V3 = [-0.17 * s, sh - 0.03 * s, 0];
  const shR: V3 = [0.17 * s, sh - 0.03 * s, 0];
  m.beam(shL, [-0.22 * s, 0.47 * s, 0.02 * s], 0.075 * s, col, 0.06 * s);
  const b = opts.braccio ?? 'fianco';
  if (b === 'alzato') m.beam(shR, [0.3 * s, sh + 0.32 * s, 0.08 * s], 0.075 * s, col, 0.06 * s);
  else if (b === 'avanti') m.beam(shR, [0.24 * s, sh - 0.05 * s, 0.33 * s], 0.075 * s, col, 0.06 * s);
  else if (b === 'petto') {
    m.beam(shR, [0.2 * s, 0.6 * s, 0.12 * s], 0.075 * s, col, 0.065 * s);
    m.beam([0.2 * s, 0.6 * s, 0.12 * s], [0.02 * s, 0.7 * s, 0.14 * s], 0.065 * s, col, 0.055 * s);
  } else if (b === 'lira') {
    m.beam(shR, [0.18 * s, 0.62 * s, 0.16 * s], 0.075 * s, col, 0.06 * s);
    // la lira della musa: due bracci e la traversa
    m.beam([0.12 * s, 0.55 * s, 0.2 * s], [0.06 * s, 0.85 * s, 0.22 * s], 0.035 * s, PAL.oro);
    m.beam([0.28 * s, 0.55 * s, 0.2 * s], [0.34 * s, 0.85 * s, 0.22 * s], 0.035 * s, PAL.oro);
    m.beam([0.04 * s, 0.85 * s, 0.22 * s], [0.36 * s, 0.85 * s, 0.22 * s], 0.035 * s, PAL.oro);
  } else if (b === 'piccone') {
    m.beam(shR, [0.24 * s, 0.5 * s, 0.1 * s], 0.075 * s, col, 0.06 * s);
    m.beam([0.24 * s, 0.5 * s, 0.1 * s], [0.3 * s, 0.05 * s, 0.25 * s], 0.04 * s, col);
    m.beam([0.18 * s, 0.08 * s, 0.32 * s], [0.42 * s, 0.03 * s, 0.18 * s], 0.05 * s, col);
  } else m.beam(shR, [0.22 * s, 0.47 * s, 0.02 * s], 0.075 * s, col, 0.06 * s);
  return m;
}

/** Una figura seduta (il compositore), alta s in piedi, sul sedile alto 0.27 s. */
function seduto(s: number, col: Col, seat: Col, hi: boolean): Mesh {
  const m = new Mesh();
  const y = 0.27 * s;
  m.box(-0.24 * s, 0, -0.22 * s, 0.24 * s, y, 0.22 * s, seat);
  m.box(-0.24 * s, y, -0.26 * s, 0.24 * s, y + 0.38 * s, -0.18 * s, seat);
  for (const x of [-0.08, 0.08]) {
    m.beam([x * s, y + 0.04 * s, -0.05 * s], [x * s, y + 0.04 * s, 0.24 * s], 0.12 * s, col);
    m.beam([x * s, y + 0.04 * s, 0.24 * s], [x * s, 0, 0.27 * s], 0.11 * s, col);
  }
  m.beam([0, y, -0.06 * s], [0, y + 0.33 * s, -0.08 * s], 0.27 * s, col, 0.32 * s);
  m.ball(0, y + 0.42 * s, -0.06 * s, 0.075 * s, col, hi ? 7 : 5, hi ? 3 : 2);
  // un braccio sul bracciolo, l'altro alla fronte: il compositore che pensa
  m.beam([-0.17 * s, y + 0.3 * s, -0.06 * s], [-0.22 * s, y + 0.08 * s, 0.12 * s], 0.07 * s, col);
  m.beam([0.17 * s, y + 0.3 * s, -0.06 * s], [0.14 * s, y + 0.16 * s, 0.16 * s], 0.07 * s, col);
  m.beam([0.14 * s, y + 0.16 * s, 0.16 * s], [0.06 * s, y + 0.36 * s, 0.02 * s], 0.06 * s, col);
  return m;
}

/** Un cavallo al passo con il cavaliere, lungo z, alto s al garrese. */
function equestre(s: number, col: Col, hi: boolean): Mesh {
  const m = new Mesh();
  const y = 0.62 * s;
  m.beam([0, y, -0.55 * s], [0, y + 0.05 * s, 0.5 * s], 0.42 * s, col, 0.4 * s, hi ? 6 : 4);
  m.beam([0, y + 0.1 * s, 0.45 * s], [0, y + 0.55 * s, 0.75 * s], 0.24 * s, col, 0.18 * s);
  m.beam([0, y + 0.55 * s, 0.72 * s], [0, y + 0.42 * s, 1.0 * s], 0.2 * s, col, 0.14 * s);
  for (const [x, z, lift] of [[-0.12, 0.38, 0.12], [0.12, 0.38, 0], [-0.12, -0.45, 0], [0.12, -0.45, 0.06]] as const) {
    m.beam([x * s, y - 0.1 * s, z * s], [x * s, lift * s, (z + lift * 0.8) * s], 0.11 * s, col, 0.08 * s);
  }
  m.beam([0, y + 0.08 * s, -0.58 * s], [0, y - 0.45 * s, -0.72 * s], 0.08 * s, col, 0.05 * s);
  const rider = persona(0.95 * s, col, { braccio: 'avanti', hi });
  // il cavaliere: lo stesso uomo in piedi, alzato in sella (le gambe affondano nei fianchi)
  m.append(rider, 0, y - 0.3 * s, 0.02 * s);
  return m;
}

// ---------- archetipi ----------

function porta(c: Ctx): void {
  const { m, M, p, hi, drop } = c;
  const stile = str(p, 'stile', 'pietra');
  const col = stile === 'marmo' ? PAL.marmo : stile === 'intonaco' ? PAL.intonacoGiallo : PAL.pietra;
  const trim = stile === 'marmo' ? tone(PAL.marmo, 0.9) : PAL.ocra;
  const w = M.w * 0.96;
  const d = M.d * 0.92;
  const h = M.h;
  const aw = num(p, 'fornice', clamp(w * 0.26, 3, 6.4));
  // il fornice sta dove passa la strada (scripts/world/monumenti.ts lo misura), non per forza in mezzo
  const px = clamp(num(p, 'passaggio', 0), -w / 2 + aw / 2 + 1, w / 2 - aw / 2 - 1);
  const ah = Math.max(5.2, Math.min(h * 0.62, aw * 1.5));
  const corn = Math.max(h * 0.78, ah + 1.6);
  const r = aw / 2;
  const spring = ah - r;
  // il blocco della porta col fornice che lo passa da parte a parte (la strada ci passa sotto)
  m.arches(-w / 2, w / 2, -drop, corn, -d / 2, d / 2, [{ cx: px, w: aw, h: ah + drop, y: -drop }], col, hi ? 10 : 5, tone(col, 0.78));
  // cornicione e attico, un po' rientrato
  m.box(-w / 2 - 0.35, corn, -d / 2 - 0.35, w / 2 + 0.35, corn + 0.7, d / 2 + 0.35, trim);
  const top = Math.max(h, corn + 3);
  m.box(-w / 2 + 0.4, corn + 0.7, -d / 2 + 0.4, w / 2 - 0.4, top, d / 2 - 0.4, col, { top: tone(col, 0.9) });
  if (!hi) return;
  m.box(-w / 2 + 0.2, top - 0.5, -d / 2 + 0.2, w / 2 - 0.2, top, d / 2 - 0.2, trim, { top: tone(col, 0.82) });
  for (const zf of [1, -1]) {
    const sm = new Mesh();
    const z = d / 2;
    // dietro, girato di mezzo giro, il fornice sta dall'altra parte
    const qx = zf === 1 ? px : -px;
    // bugnato: fasce di pietra sporgenti sui due lati del fornice
    if (stile !== 'intonaco') {
      // bugnato: conci sporgenti a file sfalsate, coi giunti, sui due lati del fornice
      const rows = Math.floor((corn * 0.92) / 0.85);
      const runs: [number, number][] = [
        [-w / 2 + 0.6, qx - r - 0.9],
        [qx + r + 0.9, w / 2 - 0.6],
      ];
      for (let i = 0; i < rows; i++) {
        const y0 = i * 0.85 + 0.08;
        for (const [a, b] of runs) {
          if (b - a < 0.6) continue;
          const n = Math.max(1, Math.round((b - a) / 1.7));
          const L = (b - a) / n;
          for (let j = -1; j < n; j++) {
            // file alterne spostate di mezzo concio
            const x0 = Math.max(a, a + j * L + (i % 2 ? L / 2 : 0) + 0.06);
            const x1 = Math.min(b, a + (j + 1) * L + (i % 2 ? L / 2 : 0) - 0.06);
            if (x1 - x0 < 0.25) continue;
            const k = 0.92 + ((i * 7 + j * 3) % 5) * 0.035;
            sm.box(x0, y0, z, x1, y0 + 0.72, z + (i % 2 ? 0.16 : 0.2), tone(col, k), { open: 'z-' });
          }
        }
      }
    }
    // la ghiera dei conci attorno all'arco, con la chiave in cima
    const seg = 9;
    for (let i = 0; i < seg; i++) {
      const a0 = Math.PI - (i / seg) * Math.PI;
      const a1 = Math.PI - ((i + 1) / seg) * Math.PI;
      const r0 = r;
      const r1 = r + 0.85;
      const pt = (a: number, rr: number, zz: number): V3 => [qx + Math.cos(a) * rr, spring + Math.sin(a) * rr, zz];
      sm.quad(pt(a0, r0, z + 0.22), pt(a1, r0, z + 0.22), pt(a1, r1, z + 0.22), pt(a0, r1, z + 0.22), i % 2 ? trim : tone(trim, 0.92), [0, spring, z - 1]);
      sm.quad(pt(a0, r1, z), pt(a1, r1, z), pt(a1, r1, z + 0.22), pt(a0, r1, z + 0.22), trim, [0, spring, z]);
    }
    sm.box(qx - 0.45, spring + r - 0.1, z, qx + 0.45, Math.min(corn, spring + r + 1.2), z + 0.32, tone(trim, 1.05), { open: 'z-' });
    // lesene ai lati del fornice e agli spigoli
    for (const x of [qx - r - 0.9, qx + r + 0.3, -w / 2, w / 2 - 0.6]) if (x >= -w / 2 - 0.01 && x + 0.6 <= w / 2 + 0.01) sm.box(x, 0, z, x + 0.6, corn, z + 0.3, trim, { open: 'z-y-' });
    if (zf === 1 && yes(p, 'leone')) leone(sm, qx, corn + 0.7 + Math.max(1.2, (h - corn - 0.7) / 2), d / 2 - 0.4, clamp((h - corn) / 2.6, 0.7, 1.5), col);
    if (zf === 1 && yes(p, 'lapide')) sm.panel(qx - 2.2, Math.min(corn - 0.3, spring + r + 1.3), qx + 2.2, corn - 0.3, z + 0.15, tone(col, 0.9), 0.1);
    m.append(sm, 0, 0, 0, zf === 1 ? 0 : Math.PI);
  }
}

interface TowerOpts {
  mat: Col;
  cella: number;
  orologio: number;
  tetto: string;
  lesene?: boolean;
  fasce?: boolean;
  feritoie?: boolean;
  lean?: number;
  /** quadrante speciale (Clusone: il planetario) */
  planetario?: boolean;
  roofCol?: Col;
}

/** Quadranti: 1 sul davanti, 2 davanti e dietro, 4 su tutti i lati. */
const hasClock = (n: number, k: number) => n >= 4 || (k === 0 && n >= 1) || (k === 2 && n >= 2);

/** Una torre quadrata di lato tw × td alta H (tetto compreso) con la base in (cx, y0, cz). */
function tower(m: Mesh, cx: number, cz: number, tw: number, td: number, y0: number, H: number, o: TowerOpts, hi: boolean, drop = 0): void {
  const t = new Mesh();
  const roofH = o.tetto === 'cuspide' ? tw * 1.7 : o.tetto === 'piramide' ? tw * 0.42 : o.tetto === 'cupolino' ? tw * 0.95 : o.tetto === 'merli' ? 1.1 : 0.9;
  const cellaH = o.cella > 0 ? clamp(H * 0.13, 3.2, 7.5) : 0;
  const top = Math.max(3, H - roofH - cellaH);
  const trim = tone(o.mat, 1.08);
  t.box(-tw / 2, -drop, -td / 2, tw / 2, top, td / 2, o.mat, { open: 'y-' });
  // zoccolo più largo
  t.box(-tw / 2 - 0.3, -drop, -td / 2 - 0.3, tw / 2 + 0.3, Math.min(1.4, top * 0.1), td / 2 + 0.3, tone(o.mat, 0.86));
  const faces = (fn: (f: Mesh, fw: number, fz: number, k: number) => void) => {
    for (let k = 0; k < 4; k++) {
      const f = new Mesh();
      const fw = k % 2 ? td : tw;
      const fz = k % 2 ? tw / 2 : td / 2;
      fn(f, fw, fz, k);
      t.append(f, 0, 0, 0, (k * Math.PI) / 2);
    }
  };
  if (hi) {
    faces((f, fw, fz, k) => {
      if (o.lesene) for (const x of [-fw / 2, fw / 2 - 0.55]) f.box(x, 1.4, fz, x + 0.55, top, fz + 0.18, trim, { open: 'z-y-' });
      if (o.fasce) for (const y of [top * 0.33, top * 0.66]) f.box(-fw / 2 - 0.1, y, fz, fw / 2 + 0.1, y + 0.45, fz + 0.2, trim, { open: 'z-' });
      if (o.feritoie) for (let y = 6; y < top - 4; y += 5.5) f.panel(-0.18, y, 0.18, y + 1.4, fz, PAL.buio, 0.04);
      if (hasClock(o.orologio, k)) {
        const r = Math.min(fw * 0.36, 2.6);
        if (o.planetario && k === 0) {
          // il quadrante astronomico: fondo blu, anello dorato, stelle e il sole
          f.disc(0, top - r - 1, fz + 0.06, r * 1.25, 16, PAL.oro);
          f.disc(0, top - r - 1, fz + 0.12, r * 1.08, 16, [0.16, 0.24, 0.45]);
          f.disc(0, top - r - 1, fz + 0.18, r * 0.55, 12, [0.85, 0.75, 0.42]);
          f.beam([0, top - r - 1, fz + 0.24], [r * 0.8, top - r - 1 + r * 0.5, fz + 0.24], 0.12, PAL.oro, 0.06);
        } else clock(f, 0, top - r - 1, fz, r, hi);
      }
    });
  } else if (o.orologio) faces((f, fw, fz, k) => hasClock(o.orologio, k) && clock(f, 0, top - Math.min(fw * 0.36, 2.6) - 1, fz, Math.min(fw * 0.36, 2.6), false, o.planetario ? [0.16, 0.24, 0.45] : PAL.bianco));
  // cornice sotto la cella
  t.box(-tw / 2 - 0.3, top - 0.1, -td / 2 - 0.3, tw / 2 + 0.3, top + 0.4, td / 2 + 0.3, trim);
  let y = top + 0.4;
  if (o.cella > 0) {
    if (hi) {
      faces((f, fw, fz) => {
        const n = o.cella;
        const hw = (fw - 1.2) / n;
        const holes = Array.from({ length: n }, (_, i) => ({ cx: -fw / 2 + 0.6 + hw * (i + 0.5), w: hw * 0.62, h: cellaH * 0.72, y: y + cellaH * 0.12 }));
        f.arches(-fw / 2, fw / 2, y, y + cellaH, fz - 0.6, fz, holes, o.mat, 6);
      });
      // la campana, scura, dentro la cella
      t.cyl(0, 0, Math.min(tw, td) * 0.22, Math.min(tw, td) * 0.1, y + cellaH * 0.25, y + cellaH * 0.7, 8, PAL.bronzo, true, true);
      t.box(-tw / 2 + 0.5, y + cellaH - 0.2, -td / 2 + 0.5, tw / 2 - 0.5, y + cellaH, td / 2 - 0.5, tone(o.mat, 0.7), { open: '' });
    } else {
      t.box(-tw / 2, y, -td / 2, tw / 2, y + cellaH, td / 2, tone(o.mat, 0.82));
      t.box(-tw / 2 + 0.6, y + cellaH * 0.15, -td / 2 - 0.02, tw / 2 - 0.6, y + cellaH * 0.8, td / 2 + 0.02, PAL.buio, { open: 'y-y+' });
    }
    y += cellaH;
    t.box(-tw / 2 - 0.35, y, -td / 2 - 0.35, tw / 2 + 0.35, y + 0.5, td / 2 + 0.35, trim);
    y += 0.5;
  }
  const roof = o.roofCol ?? PAL.coppi;
  switch (o.tetto) {
    case 'cuspide':
      t.pyramid(0, 0, tw + 0.2, td + 0.2, y, roofH, o.roofCol ?? tone(o.mat, 0.95));
      if (hi) t.beam([0, y + roofH, 0], [0, y + roofH + 1.6, 0], 0.12, PAL.ferro);
      break;
    case 'piramide':
      t.pyramid(0, 0, tw + 0.9, td + 0.9, y - 0.15, roofH, roof);
      break;
    case 'cupolino': {
      // tamburo ottagonale, cupoletta e lanterna (il Campanone)
      const r = Math.min(tw, td) * 0.34;
      t.cyl(0, 0, r, r, y, y + roofH * 0.35, 8, o.mat, false, false, Math.PI / 8);
      t.dome(0, y + roofH * 0.35, 0, r * 1.05, roofH * 0.38, 8, hi ? 3 : 2, o.roofCol ?? PAL.piombo, 1, Math.PI / 8);
      t.cyl(0, 0, r * 0.25, r * 0.25, y + roofH * 0.7, y + roofH * 0.9, 6, o.mat);
      t.cyl(0, 0, r * 0.3, 0, y + roofH * 0.9, y + roofH, 6, o.roofCol ?? PAL.piombo);
      break;
    }
    case 'merli':
      if (hi) {
        merli(t, [-tw / 2 + 0.3, td / 2 - 0.3], [tw / 2 - 0.3, td / 2 - 0.3], y, 0.6, o.mat);
        merli(t, [tw / 2 - 0.3, -td / 2 + 0.3], [-tw / 2 + 0.3, -td / 2 + 0.3], y, 0.6, o.mat);
        merli(t, [tw / 2 - 0.3, td / 2 - 0.3], [tw / 2 - 0.3, -td / 2 + 0.3], y, 0.6, o.mat);
        merli(t, [-tw / 2 + 0.3, -td / 2 + 0.3], [-tw / 2 + 0.3, td / 2 - 0.3], y, 0.6, o.mat);
      }
      t.box(-tw / 2 + 0.4, y - 0.4, -td / 2 + 0.4, tw / 2 - 0.4, y - 0.1, td / 2 - 0.4, tone(o.mat, 0.7));
      break;
    default:
      // terrazza: parapetto basso e una lanterna
      t.box(-tw / 2, y, -td / 2, tw / 2, y + roofH, td / 2, trim, { top: tone(o.mat, 0.8) });
  }
  // la pendenza (il campanile del Cornello): una inclinazione minima, tutta in avanti
  if (o.lean) {
    const k = Math.tan((o.lean * Math.PI) / 180);
    for (let i = 0; i < t.pos.length; i += 3) t.pos[i + 2] += Math.max(0, t.pos[i + 1]) * k;
  }
  m.append(t, cx, y0, cz);
}

function torre(c: Ctx): void {
  const { m, M, p, hi, drop } = c;
  const o: TowerOpts = {
    mat: mat(p, 'mat', 'pietra'),
    cella: num(p, 'cella', 0),
    orologio: num(p, 'orologio', 0),
    tetto: str(p, 'tetto', 'piramide'),
    lesene: yes(p, 'lesene'),
    fasce: yes(p, 'fasce'),
    feritoie: yes(p, 'feritoie'),
    lean: num(p, 'pendenza', 0),
    roofCol: p.tettoMat ? mat(p, 'tettoMat', 'pietra') : undefined,
  };
  tower(m, 0, 0, M.w * 0.97, M.d * 0.97, 0, M.h, o, hi, drop);
}

function chiesa(c: Ctx): void {
  const { m, M, p, hi, ring } = c;
  const col = mat(p, 'mat', 'pietra');
  const trim = p.trim ? mat(p, 'trim', 'ocra') : tone(col, 1.1);
  const stile = str(p, 'facciata', 'romanica');
  const H = M.h;
  const eave = num(p, 'gronda', H * 0.72);
  zoccolo(c, tone(col, 0.82));
  m.prism(ring, 0, eave, col, PAL.coppiScuri);
  const fz = reachZ(ring, 0);
  const bz = -reachZ(rotRing(ring, Math.PI), 0);
  const [sx0, sx1] = spanX(ring, (fz + bz) / 2);
  const cw = Math.min(sx1 - sx0, M.w);
  const cx = (sx0 + sx1) / 2;
  // facciata
  const [fx0, fx1] = spanX(ring, fz - 0.6);
  const fw = Math.min(fx1 - fx0, cw + 2);
  const fc = (fx0 + fx1) / 2;
  const free = num(p, 'davanti', 10);
  // il tetto a capanna sulla navata (larga quanto la facciata), lungo z; transetti e cappelle restano piani
  const nw = Math.min(cw, fw + 1);
  const rise = Math.min(nw * 0.3, H - eave + 1);
  m.gable(fc, (fz + bz) / 2 - 0.4, nw, fz - bz - 1.6, eave, rise, PAL.coppi, col, true, 0.5);
  const z0 = fz - 1.1;
  const z1 = fz + 0.25;
  if (stile === 'barocca') {
    const up = fw * 0.62;
    m.box(fc - fw / 2, 0, z0, fc + fw / 2, eave + 0.6, z1, col);
    m.box(fc - fw / 2 - 0.3, eave + 0.6, z0 - 0.2, fc + fw / 2 + 0.3, eave + 1.3, z1 + 0.35, trim);
    m.box(fc - up / 2, eave + 1.3, z0, fc + up / 2, H - up * 0.18, z1, col);
    m.gable(fc, (z0 + z1) / 2, up + 0.8, z1 - z0 + 0.6, H - up * 0.18, up * 0.18, trim, trim, false, 0);
    // le volute che raccordano i due ordini
    for (const sgn of [-1, 1]) {
      const x0 = fc + (sgn * up) / 2;
      const pts: V3[] = [];
      for (let i = 0; i <= 5; i++) {
        const a = (i / 5) * (Math.PI / 2);
        pts.push([x0 + sgn * (1 - Math.cos(a)) * (fw - up) * 0.42, eave + 1.3 + (1 - Math.sin(a)) * (H - up * 0.18 - eave - 1.3) * 0.75, z1]);
      }
      for (let i = 0; i < 5; i++) m.poly([[x0, pts[i][1], z1], pts[i], pts[i + 1], [x0, pts[i + 1][1], z1]], col, [x0, eave, z0]);
      for (let i = 0; i < 5; i++) m.quad(pts[i], pts[i + 1], [pts[i + 1][0], pts[i + 1][1], z0], [pts[i][0], pts[i][1], z0], trim, [x0, eave, (z0 + z1) / 2]);
    }
    if (hi) {
      for (const k of [-1, -0.4, 0.4, 1]) m.box(fc + (k * (fw - 1.6)) / 2 - 0.35, 0.4, z1, fc + (k * (fw - 1.6)) / 2 + 0.35, eave + 0.6, z1 + 0.4, trim, { open: 'z-y-' });
      for (const k of [-1, 1]) m.box(fc + (k * (up - 1)) / 2 - 0.3, eave + 1.3, z1, fc + (k * (up - 1)) / 2 + 0.3, H - up * 0.18, z1 + 0.35, trim, { open: 'z-y-' });
      m.panel(fc - 1.1, eave + 2.4, fc + 1.1, eave + 5, z1, PAL.vetro);
      m.disc(fc, eave + 5, z1 + 0.08, 1.1, 8, PAL.vetro);
    }
    portale(m, fc, z1, clamp(fw * 0.16, 2, 3.4), clamp(eave * 0.32, 3.2, 6), trim, hi);
  } else if (stile === 'neoclassica') {
    // il pronao: colonne, trabeazione, timpano (il Duomo di Bergamo, bianco)
    const n = num(p, 'colonne', 6);
    const pd = clamp(free - 1.3, 0.8, 3.2);
    const ch = Math.min(eave * 0.85, 16);
    m.box(fc - fw / 2, 0, z0, fc + fw / 2, H - fw * 0.14, z1, col);
    m.gable(fc, (z0 + z1) / 2, fw + 0.6, z1 - z0 + 0.4, H - fw * 0.14, fw * 0.14, trim, col, false, 0);
    m.box(fc - fw / 2 + 0.3, 0, z1, fc + fw / 2 - 0.3, 0.5, z1 + pd + 0.6, trim);
    for (let i = 0; i < n; i++) colonna(m, fc - fw / 2 + 1 + ((fw - 2) * i) / (n - 1), z1 + pd, 0.45, 0.5, ch, trim, hi);
    m.box(fc - fw / 2 + 0.3, ch, z1, fc + fw / 2 - 0.3, ch + 1.2, z1 + pd + 0.7, trim);
    if (hi) m.gable(fc, z1 + pd / 2 + 0.3, fw * 0.8, pd + 0.6, ch + 1.2, fw * 0.11, trim, trim, false, 0);
    portale(m, fc, z1, clamp(fw * 0.12, 2.4, 3.6), clamp(ch * 0.45, 3.5, 7), trim, hi);
    if (hi) windows(m, fc - fw / 2 + 1, fc + fw / 2 - 1, z1, [[ch + 2.5, ch + 5]], { step: fw / 3, w: 1.4, arched: true, skip: [fc - 1, fc + 1] });
  } else {
    // romanica e alpina: facciata a capanna, rosone, portale (a Santa Maria Maggiore il protiro)
    m.box(fc - fw / 2, 0, z0, fc + fw / 2, eave + 0.3, z1, col);
    m.gable(fc, (z0 + z1) / 2, fw, z1 - z0, eave + 0.3, Math.min(fw * 0.32, H - eave), PAL.coppi, col, false, 0.35);
    if (p.rosone !== false) rosone(m, fc, eave * 0.62 + (H - eave) * 0.2, z1, clamp(fw * 0.1, 0.8, 2.4), hi, trim);
    if (yes(p, 'affresco')) {
      // la facciata dipinta (a Clusone il Trionfo e la Danza della Morte): un fondo chiaro e una
      // fila di figure scure, e in alto la figura grande del Trionfo
      const ax0 = fc - fw / 2 + 0.8;
      const ax1 = fc + fw / 2 - 0.8;
      m.panel(ax0, eave * 0.18, ax1, eave * 0.95, z1, PAL.affresco, 0.05);
      if (hi) {
        const n = Math.max(4, Math.floor((ax1 - ax0) / 1.3));
        for (let i = 0; i < n; i++) {
          const x = ax0 + ((i + 0.5) * (ax1 - ax0)) / n;
          const dark = i % 2 ? PAL.marmoNero : tone(PAL.affresco, 0.55);
          m.panel(x - 0.16, eave * 0.24, x + 0.16, eave * 0.24 + 1.35, z1 + 0.06, dark, 0.03);
          m.disc(x, eave * 0.24 + 1.55, z1 + 0.1, 0.2, 6, dark);
        }
        m.panel(fc - 0.5, eave * 0.55, fc + 0.5, eave * 0.55 + 2.4, z1 + 0.06, PAL.marmoNero, 0.03);
        m.disc(fc, eave * 0.55 + 2.75, z1 + 0.1, 0.38, 8, PAL.marmoNero);
        m.panel(ax0, eave * 0.5, ax1, eave * 0.5 + 0.12, z1 + 0.05, tone(PAL.affresco, 0.7), 0.02);
      }
    }
    const dw = clamp(fw * 0.14, 1.6, 3);
    const dh = clamp(eave * 0.32, 2.6, 5);
    portale(m, fc, z1, dw, dh, trim, hi);
    if (yes(p, 'protiro') && free > 1.8) {
      // il protiro: due colonne su leoni stilofori, l'arco, un tetto a capanna (e la loggia sopra)
      const pw = dw + 2.4;
      const pz = z1 + Math.min(3, free - 0.6);
      for (const sgn of [-1, 1]) {
        if (hi) m.boxAt(fc + (sgn * pw) / 2, 0, pz, 0.9, 0.9, 1.5, PAL.marmoRosa);
        colonna(m, fc + (sgn * pw) / 2, pz, 0.28, hi ? 0.9 : 0, dh + 1.2, PAL.marmoRosa, hi);
      }
      m.arches(fc - pw / 2 - 0.4, fc + pw / 2 + 0.4, dh + 1.2, dh + 2.6, z1, pz + 0.4, [], PAL.marmo, 4);
      m.gable(fc, (z1 + pz + 0.4) / 2, pw + 1.2, pz + 0.4 - z1, dh + 2.6, 1.4, PAL.marmo, PAL.marmo, false, 0.2);
      if (yes(p, 'loggia')) {
        for (const sgn of [-1, 1]) colonna(m, fc + (sgn * pw) / 2, pz, 0.2, dh + 2.6, dh + 5, PAL.marmo, hi);
        m.gable(fc, (z1 + pz + 0.4) / 2, pw + 1, pz + 0.4 - z1, dh + 5, 1.3, PAL.coppi, PAL.marmo, false, 0.2);
        if (hi) m.boxAt(fc, dh + 2.6, pz - 0.6, 1.2, 1.8, 0.6, PAL.marmo);
      }
    }
    if (yes(p, 'portico') && free > 2.2) {
      // il portico del santuario: archi sul davanti e il tetto a falda
      const pd = Math.min(4, free - 0.4);
      const n = Math.max(2, Math.round(fw / 4));
      const hw = fw / n;
      m.arches(fc - fw / 2, fc + fw / 2, 0, 4.4, z1 + pd - 0.6, z1 + pd, Array.from({ length: n }, (_, i) => ({ cx: fc - fw / 2 + hw * (i + 0.5), w: hw * 0.62, h: 3.4 })), col, hi ? 6 : 3);
      m.quad([fc - fw / 2 - 0.3, 4.4, z1 + pd + 0.4], [fc + fw / 2 + 0.3, 4.4, z1 + pd + 0.4], [fc + fw / 2 + 0.3, 5.6, z1], [fc - fw / 2 - 0.3, 5.6, z1], PAL.coppi, [fc, 0, z1 + 1]);
      m.box(fc - fw / 2, 0, z1, fc - fw / 2 + 0.6, 4.4, z1 + pd, col);
      m.box(fc + fw / 2 - 0.6, 0, z1, fc + fw / 2, 4.4, z1 + pd, col);
    }
    if (hi && stile === 'romanica') {
      // archetti pensili sotto gli spioventi
      const n = Math.floor(fw / 1.2);
      for (let i = 0; i < n; i++) m.panel(fc - fw / 2 + 0.3 + (i * (fw - 0.6)) / n, eave - 0.6, fc - fw / 2 + 0.3 + ((i + 0.8) * (fw - 0.6)) / n, eave - 0.1, z1, trim, 0.1);
    }
  }
  // finestre alte lungo i fianchi, dove c'è davvero il muro
  if (hi) {
    for (let z = bz + 4; z < fz - 4; z += 6.5) {
      const [a, b] = spanX(ring, z);
      for (const [x, sgn] of [[a, -1], [b, 1]] as const) {
        m.box(x - (sgn > 0 ? 0 : 0.12), eave * 0.45, z - 0.6, x + (sgn > 0 ? 0.12 : 0), eave * 0.82, z + 0.6, PAL.vetro, { open: sgn > 0 ? 'x-' : 'x+' });
      }
    }
  }
  // cupola o tiburio sull'incrocio
  const cup = str(p, 'cupola', '');
  if (cup) {
    const cz = num(p, 'cupolaZ', -0.15) * (fz - bz) * 0.5 + (fz + bz) / 2;
    const top = num(p, 'cupolaH', H * 1.5);
    if (cup === 'tiburio') {
      const r = Math.min(nw * 0.42, cw * 0.3);
      const y1 = eave + (top - eave) * 0.7;
      m.cyl(fc, cz, r, r, eave - 1, y1, 8, col, true, false, Math.PI / 8);
      if (hi) {
        // la loggetta del tiburio: archetti scuri tutto intorno
        for (let i = 0; i < 8; i++) {
          const a = Math.PI / 8 + (i / 8) * Math.PI * 2 + Math.PI / 8;
          const sm = new Mesh();
          const fwi = 2 * r * Math.sin(Math.PI / 8);
          for (let k = 0; k < 3; k++) sm.panel(-fwi / 2 + (fwi * (k + 0.25)) / 3, y1 - 2.6, -fwi / 2 + (fwi * (k + 0.75)) / 3, y1 - 0.8, r * Math.cos(Math.PI / 8), PAL.buio, 0.06);
          m.append(sm, fc, 0, cz, Math.PI / 2 - a);
        }
      }
      m.cyl(fc, cz, r * 1.08, 0, y1, top, 8, PAL.piombo, false, false, Math.PI / 8);
      m.cyl(fc, cz, 0.5, 0.5, top - 0.6, top + 1.2, 6, col);
    } else {
      // tamburo, cupola, lanterna e la statua dorata in cima
      const r = num(p, 'cupolaR', Math.min(nw * 0.48, cw * 0.38));
      const dh = r * 0.95;
      const lan = r * 0.45;
      const drumTop = Math.max(eave + 3, top - dh - lan);
      m.cyl(fc, cz, r, r, eave - 1, drumTop, hi ? 16 : 10, col, false);
      if (hi) {
        m.cyl(fc, cz, r + 0.35, r + 0.35, drumTop - 0.7, drumTop, 16, trim, true);
        for (let i = 0; i < 8; i++) {
          const sm = new Mesh();
          sm.panel(-0.6, eave + (drumTop - eave) * 0.3, 0.6, drumTop - 1.6, r, PAL.vetro, 0.08);
          sm.disc(0, drumTop - 1.6, r + 0.1, 0.6, 6, PAL.vetro);
          m.append(sm, fc, 0, cz, (i / 8) * Math.PI * 2);
        }
      }
      m.dome(fc, drumTop, cz, r + 0.2, dh, hi ? 16 : 10, hi ? 5 : 3, mat(p, 'cupolaMat', 'pietra') === MAT.pietra ? PAL.rame : mat(p, 'cupolaMat', 'pietra'), 0.92);
      m.cyl(fc, cz, r * 0.2, r * 0.2, drumTop + dh * 0.85, drumTop + dh * 0.85 + lan * 0.6, 8, trim);
      m.cyl(fc, cz, r * 0.24, 0, drumTop + dh * 0.85 + lan * 0.6, drumTop + dh * 0.85 + lan, 8, PAL.rame);
      if (hi && yes(p, 'statua')) m.append(persona(3, PAL.oro, { braccio: 'alzato', hi }), fc, drumTop + dh * 0.85 + lan, cz);
    }
  }
  // il campanile
  const ch = num(p, 'campanile', 0);
  if (ch > 0) {
    const ts = num(p, 'campanileLato', clamp(cw * 0.24, 3.6, 8));
    const side = num(p, 'campanileX', 1);
    const back = str(p, 'campanilePos', 'retro') === 'retro';
    const tx = cx + side * (cw / 2 + (yes(p, 'campanileStacco') ? ts * 0.7 : -ts * 0.15));
    const tz = back ? bz + ts * 0.8 : fz - ts * 0.8;
    tower(m, tx, tz, ts, ts, 0, ch, { mat: p.campanileMat ? mat(p, 'campanileMat', 'pietra') : col, cella: 2, orologio: num(p, 'campanileOrologio', 0), tetto: str(p, 'campanileTetto', 'cuspide'), lesene: hi }, hi, c.drop);
  }
}

function cappella(c: Ctx): void {
  const { m, M, hi } = c;
  const w = M.w * 0.94;
  const d = M.d * 0.94;
  const H = M.h;
  zoccolo(c, PAL.marmo);
  m.box(-w / 2, 0, -d / 2, w / 2, H * 0.92, d / 2, PAL.marmo, { top: PAL.piombo });
  const z = d / 2;
  // la facciata a losanghe bianche, rosa e scure: si riconosce da cento metri
  const fy0 = 1.2;
  const fy1 = H * 0.66;
  const cols = hi ? Math.max(6, Math.round(w / 1.25)) : 4;
  const rows = hi ? Math.max(4, Math.round((fy1 - fy0) / 1.25)) : 3;
  const cw = w / cols;
  const rh = (fy1 - fy0) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -w / 2 + cw * (i + 0.5);
      const y = fy0 + rh * (j + 0.5);
      const k = (i + j) % 3;
      const col = k === 0 ? PAL.marmoRosa : k === 1 ? PAL.marmo : PAL.marmoNero;
      m.poly([[x - cw / 2, y, z + 0.06], [x, y - rh / 2, z + 0.06], [x + cw / 2, y, z + 0.06], [x, y + rh / 2, z + 0.06]], col, [x, y, z - 1]);
    }
  }
  // portale col timpano, rosone, loggetta di archetti in alto
  portale(m, 0, z + 0.06, clamp(w * 0.16, 1.6, 2.6), clamp(H * 0.26, 2.6, 4.2), PAL.marmo, hi, false);
  if (hi) m.gable(0, z + 0.4, w * 0.24, 0.7, H * 0.26 + 0.6, 1.1, PAL.marmo, PAL.marmo, false, 0);
  rosone(m, 0, H * 0.5, z + 0.1, clamp(w * 0.09, 0.8, 1.6), hi, PAL.marmo);
  const ly0 = H * 0.7;
  const ly1 = H * 0.86;
  if (hi) {
    const n = Math.max(5, Math.round(w / 1.6));
    const hw = (w - 1) / n;
    m.arches(-w / 2, w / 2, ly0, ly1, z - 0.4, z + 0.3, Array.from({ length: n }, (_, i) => ({ cx: -w / 2 + 0.5 + hw * (i + 0.5), w: hw * 0.6, h: (ly1 - ly0) * 0.75, y: ly0 + (ly1 - ly0) * 0.1 })), PAL.marmo, 6);
    m.box(-w / 2 - 0.25, ly1, z - 0.5, w / 2 + 0.25, ly1 + 0.45, z + 0.45, PAL.marmoRosa);
    m.box(-w / 2 - 0.25, ly0 - 0.4, z - 0.5, w / 2 + 0.25, ly0, z + 0.45, PAL.marmoRosa);
    for (const x of [-w / 2, w / 2 - 0.7]) m.box(x, 0, z, x + 0.7, ly0 - 0.4, z + 0.35, PAL.marmo, { open: 'z-y-' });
    for (const x of [-w / 2 + 0.35, w / 2 - 0.35]) m.append(persona(1.6, PAL.marmo, { hi }), x, H * 0.92, z - 0.2);
  } else m.box(-w / 2, ly0, z, w / 2, ly1, z + 0.1, tone(PAL.marmo, 0.85), { open: 'z-' });
  // tamburo ottagonale con le sue finestrelle, cupola, lanterna
  const r = Math.min(w, d) * 0.3;
  const cz = -d * 0.08;
  const y0 = H * 0.92;
  const dr = 3.2;
  m.cyl(0, cz, r, r, y0 - 0.5, y0 + dr, 8, PAL.marmo, false, false, Math.PI / 8);
  if (hi) {
    for (let i = 0; i < 8; i++) {
      const sm = new Mesh();
      sm.panel(-0.35, y0 + 0.6, 0.35, y0 + dr - 0.7, r * Math.cos(Math.PI / 8), PAL.buio, 0.05);
      m.append(sm, 0, 0, cz, (i / 8) * Math.PI * 2);
    }
    m.cyl(0, cz, r + 0.3, r + 0.3, y0 + dr - 0.3, y0 + dr + 0.15, 8, PAL.marmoRosa, true, false, Math.PI / 8);
  }
  m.dome(0, y0 + dr, cz, r * 1.02, r * 0.95, 8, hi ? 4 : 2, PAL.piombo, 0.9, Math.PI / 8);
  m.cyl(0, cz, 0.45, 0.45, y0 + dr + r * 0.85, y0 + dr + r * 0.85 + 1.4, 6, PAL.marmo);
  m.cyl(0, cz, 0.55, 0, y0 + dr + r * 0.85 + 1.4, y0 + dr + r * 0.85 + 2.3, 6, PAL.piombo);
  if (hi) m.ball(0, y0 + dr + r * 0.85 + 2.5, cz, 0.22, PAL.oro);
}

function tempietto(c: Ctx): void {
  const { m, M, p, hi } = c;
  const R = (Math.min(M.w, M.d) / 2) * 0.9;
  const H = M.h;
  const col = mat(p, 'mat', 'marmo');
  const ph = Math.PI / 8;
  m.cyl(0, 0, R + 0.9, R + 0.9, -c.drop, 0.3, 8, PAL.pietraScura, true, false, ph);
  m.cyl(0, 0, R + 0.5, R + 0.5, 0.3, 0.6, 8, PAL.pietra, true, false, ph);
  const h1 = H * 0.45;
  const h2 = H * 0.72;
  m.cyl(0, 0, R, R, 0.6, h1, 8, col, false, false, ph);
  m.cyl(0, 0, R + 0.35, R + 0.35, h1, h1 + 0.5, 8, PAL.marmoRosa, true, false, ph);
  const fw = 2 * R * Math.sin(Math.PI / 8);
  const fz = R * Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const sm = new Mesh();
    if (hi) {
      // colonnine rosse agli spigoli, una loggia di archi sopra, una statua a ogni spigolo
      sm.cyl(fw / 2, fz, 0.18, 0.16, 0.6, h1, 6, PAL.marmoRosa, false);
      sm.arches(-fw / 2, fw / 2, h1 + 0.5, h2, fz - 0.5, fz, [{ cx: 0, w: fw * 0.55, h: (h2 - h1) * 0.65, y: h1 + 0.8 }], col, 5);
      sm.append(persona(1.5, PAL.marmo, { hi }), fw / 2, h2, fz + 0.1);
      if (i === 0) portale(sm, 0, fz, fw * 0.45, h1 * 0.6, PAL.marmoRosa, hi, true);
    } else sm.box(-fw / 2, h1 + 0.5, fz - 0.5, fw / 2, h2, fz, col, { open: 'y-' });
    m.append(sm, 0, 0, 0, (i / 8) * Math.PI * 2 + Math.PI / 8 - Math.PI / 8);
  }
  if (hi) m.cyl(0, 0, R - 0.5, R - 0.5, h1 + 0.5, h2, 8, PAL.buio, false, false, ph);
  m.cyl(0, 0, R + 0.4, R + 0.4, h2, h2 + 0.45, 8, PAL.marmoRosa, true, false, ph);
  m.cyl(0, 0, R + 0.3, 0.6, h2 + 0.45, H - 1.5, 8, PAL.piombo, false, false, ph);
  m.cyl(0, 0, 0.5, 0.5, H - 1.5, H - 0.4, 6, col);
  if (hi) m.append(persona(1.4, PAL.bronzo, { braccio: 'alzato', hi }), 0, H - 0.4, 0);
}

function mausoleo(c: Ctx): void {
  const { m, M, p, hi, ring } = c;
  const col = mat(p, 'mat', 'botticino');
  const H = M.h;
  const s = num(p, 'lato', Math.min(M.w, M.d) * 0.55);
  zoccolo(c, tone(col, 0.85), 0.35, 0.1);
  m.prism(offsetRing(ring, -0.6), 0.35, 0.7, tone(col, 0.92), tone(col, 0.92));
  const base = 0.7;
  const h1 = Math.min(H * 0.38, s * 1.7);
  m.box(-s / 2 - 0.3, base, -s / 2 - 0.3, s / 2 + 0.3, base + 0.6, s / 2 + 0.3, col);
  for (let k = 0; k < 4; k++) {
    const sm = new Mesh();
    // su ogni lato un arco acuto (qui a tutto sesto, stretto e alto) chiuso da una lastra scura
    sm.box(-s / 2, base + 0.6, s / 2 - 0.5, s / 2, base + h1, s / 2, col, { open: 'y-' });
    sm.panel(-s * 0.22, base + 1, s * 0.22, base + h1 * 0.68, s / 2, PAL.marmoNero, 0.06);
    sm.disc(0, base + h1 * 0.68, s / 2 + 0.06, s * 0.22, hi ? 8 : 4, PAL.marmoNero);
    if (hi) {
      // la ghimberga: un timpano acuto sopra ogni lato
      sm.poly([[-s / 2, base + h1, s / 2], [s / 2, base + h1, s / 2], [0, base + h1 + s * 0.75, s / 2]], col, [0, base + h1, 0]);
      sm.poly([[-s / 2, base + h1, s / 2 - 0.5], [s / 2, base + h1, s / 2 - 0.5], [0, base + h1 + s * 0.75, s / 2 - 0.5]], col, [0, base + h1, s]);
      sm.quad([-s / 2, base + h1, s / 2], [0, base + h1 + s * 0.75, s / 2], [0, base + h1 + s * 0.75, s / 2 - 0.5], [-s / 2, base + h1, s / 2 - 0.5], tone(col, 0.95), [0, base, 0]);
      sm.quad([s / 2, base + h1, s / 2], [0, base + h1 + s * 0.75, s / 2], [0, base + h1 + s * 0.75, s / 2 - 0.5], [s / 2, base + h1, s / 2 - 0.5], tone(col, 0.95), [0, base, 0]);
      // pinnacoli agli spigoli
      sm.box(s / 2 - 0.25, base + 0.6, s / 2 - 0.25, s / 2 + 0.35, base + h1 + 0.8, s / 2 + 0.35, col);
      sm.pyramid(s / 2 + 0.05, s / 2 + 0.05, 0.7, 0.7, base + h1 + 0.8, s * 0.55, col);
    }
    m.append(sm, 0, 0, 0, (k * Math.PI) / 2);
  }
  // la guglia ottagonale fino in cima, con la croce
  const y1 = base + h1;
  m.box(-s / 2, y1 - 0.01, -s / 2, s / 2, y1 + 0.3, s / 2, col);
  m.cyl(0, 0, s * 0.42, s * 0.36, y1 + 0.3, y1 + s * 0.9, 8, col, true, false, Math.PI / 8);
  m.cyl(0, 0, s * 0.38, 0.08, y1 + s * 0.9, H - 1.2, 8, col, false, false, Math.PI / 8);
  m.beam([0, H - 1.3, 0], [0, H, 0], 0.16, col);
  m.beam([-0.45, H - 0.45, 0], [0.45, H - 0.45, 0], 0.14, col);
}

function palazzo(c: Ctx): void {
  const { m, M, p, hi, ring } = c;
  const col = mat(p, 'mat', 'giallo');
  const trim = p.trim ? mat(p, 'trim', 'bianco') : tone(col, 1.12);
  const H = M.h;
  const portico = str(p, 'portico', '');
  const piani = num(p, 'piani', Math.max(1, Math.round(H / 4.2)));
  zoccolo(c, tone(col, 0.8));
  let y0 = 0;
  if (portico === 'tutto') {
    // il loggiato al piano terra, aperto sui quattro lati (il Palazzo della Ragione)
    const ph = num(p, 'porticoH', H * 0.38);
    const w = M.w * 0.97;
    const d = M.d * 0.97;
    for (let k = 0; k < 4; k++) {
      const fw = k % 2 ? d : w;
      const fz = k % 2 ? w / 2 : d / 2;
      const n = Math.max(2, Math.round(fw / num(p, 'arco', 5.5)));
      const hw = fw / n;
      const sm = new Mesh();
      sm.arches(-fw / 2, fw / 2, 0, ph, fz - 1, fz, Array.from({ length: n }, (_, i) => ({ cx: -fw / 2 + hw * (i + 0.5), w: hw * 0.7, h: ph * 0.82 })), PAL.pietra, hi ? 7 : 3);
      m.append(sm, 0, 0, 0, (k * Math.PI) / 2);
    }
    m.box(-w / 2, ph - 0.5, -d / 2, w / 2, ph, d / 2, tone(PAL.pietra, 0.7), { open: '' });
    y0 = ph;
    m.box(-w / 2 - 0.3, y0, -d / 2 - 0.3, w / 2 + 0.3, H, d / 2 + 0.3, col, { open: 'y-' });
  } else m.prism(ring, 0, H, col, tone(col, 0.75));
  // finestre sui quattro lati, dove l'impronta tocca il rettangolo
  const winRows = (h0: number): [number, number][] => {
    const rows: [number, number][] = [];
    const fh = (H - h0) / piani;
    for (let i = 0; i < piani; i++) rows.push([h0 + fh * i + fh * 0.32, h0 + fh * i + fh * 0.32 + Math.min(2.2, fh * 0.5)]);
    return rows;
  };
  const trifore = yes(p, 'trifore');
  for (const side of [0, 1, 2, 3] as const) {
    // da lontano bastano le finestre della facciata
    if (!hi && side !== 0) continue;
    onSide(c, side, (sm, fz, x0, x1) => {
      if (trifore) {
        // trifore gotiche: tre luci strette sotto un arco
        const n = Math.max(1, Math.floor((x1 - x0) / 7));
        for (let i = 0; i < n; i++) {
          const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
          for (const dx of [-0.9, 0, 0.9]) sm.panel(x + dx - 0.32, y0 + 2.2, x + dx + 0.32, H - 3, fz + 0.3, PAL.vetro, 0.06);
          if (hi) sm.disc(x, H - 3, fz + 0.34, 1.3, 6, tone(PAL.pietra, 1.05));
        }
      } else windows(sm, x0 + 0.8, x1 - 0.8, fz, winRows(y0), { step: num(p, 'passo', 3.8) * (hi ? 1 : 2), w: num(p, 'finestra', 1.2), frame: hi ? trim : undefined, arched: yes(p, 'archi'), skip: side === 0 && (yes(p, 'pronao') || p.colonne) ? [-num(p, 'colonne', 6) * 1.6, num(p, 'colonne', 6) * 1.6] : undefined });
      if (hi) {
        // marcapiano e cornicione
        sm.box(x0 - 0.2, H - 0.7, fz - 0.2, x1 + 0.2, H, fz + 0.45, trim, { open: 'z-' });
        if (piani > 1) sm.box(x0, y0 + (H - y0) / piani - 0.2, fz, x1, y0 + (H - y0) / piani + 0.15, fz + 0.25, trim, { open: 'z-' });
      }
    });
  }
  const fz = reachZ(ring, 0);
  // pronao a colonne (teatro, accademia) o colonnato sul davanti
  const nc = num(p, 'colonne', 0);
  if (nc > 0) {
    const ch = num(p, 'colonneH', Math.min(H * 0.62, 12));
    const span = Math.min(M.w - 2, nc * 3.2);
    const pd = clamp(Math.min(num(p, 'pronaoD', 3.4), num(p, 'davanti', 10) - 1.2), 0.8, 3.4);
    m.box(-span / 2 - 0.5, 0, fz, span / 2 + 0.5, 0.6, fz + pd + 0.7, tone(trim, 0.95));
    for (let i = 0; i < nc; i++) colonna(m, -span / 2 + (span * i) / (nc - 1), fz + pd, 0.42, 0.6, ch, trim, hi);
    m.box(-span / 2 - 0.5, ch, fz, span / 2 + 0.5, ch + 1.3, fz + pd + 0.8, trim);
    if (yes(p, 'timpano')) m.gable(0, fz + pd / 2 + 0.4, span + 1, pd + 0.8, ch + 1.3, span * 0.13, trim, trim, false, 0.2);
    else if (hi) for (let x = -span / 2; x <= span / 2; x += 1.1) m.boxAt(x, ch + 1.3, fz + pd + 0.5, 0.25, 0.9, 0.25, trim);
  }
  // padiglioni liberty con le loro cupole
  const pad = str(p, 'padiglioni', '');
  if (pad) {
    const pw = clamp(M.w * 0.16, 5, 14);
    const xs = pad === 'centro' ? [0] : pad === 'estremi' ? [-(M.w / 2 - pw / 2 - 0.5), M.w / 2 - pw / 2 - 0.5] : [0, -(M.w / 2 - pw / 2 - 0.5), M.w / 2 - pw / 2 - 0.5];
    for (const x of xs) {
      const fzx = reachZ(ring, x);
      const ph = H + (x === 0 ? 4 : 2.5);
      const out = clamp(num(p, 'davanti', 10) - 0.4, 0, 1.2);
      m.box(x - pw / 2, 0, fzx - 3, x + pw / 2, ph, fzx + out, col, { open: 'y-' });
      if (hi) {
        windows(m, x - pw / 2 + 0.6, x + pw / 2 - 0.6, fzx + out, winRows(0), { step: 2.6, w: 1.3, frame: trim, arched: true });
        m.box(x - pw / 2 - 0.3, ph - 0.6, fzx - 3.3, x + pw / 2 + 0.3, ph, fzx + out + 0.4, trim);
      }
      if (yes(p, 'cupole')) {
        const r = pw * (x === 0 ? 0.5 : 0.4);
        m.cyl(x, fzx - 0.9, r, r, ph, ph + 1.4, hi ? 12 : 8, trim, false);
        m.dome(x, ph + 1.4, fzx - 0.9, r, r * (x === 0 ? 1.15 : 0.95), hi ? 12 : 8, hi ? 4 : 2, mat(p, 'cupoleMat', 'verde') === MAT.verde ? PAL.rame : mat(p, 'cupoleMat', 'verde'), 0.95);
        m.cyl(x, fzx - 0.9, 0.35, 0, ph + 1.4 + r * 1.05, ph + 1.4 + r * 1.05 + 1.8, 6, PAL.ferro);
      } else m.pyramid(x, fzx - 0.9, pw + 0.4, 4.6, ph, 2.6, PAL.ardesia);
    }
  }
  // tetto: su un'impronta a corte o a L un padiglione sul rettangolo coprirebbe il cortile
  const tetto = str(p, 'tetto', 'padiglione');
  const fill = Math.abs(ringArea(ring)) / Math.max(1, M.w * M.d);
  if (fill < 0.8 && portico !== 'tutto' && (tetto === 'padiglione' || tetto === 'mansarda')) {
    cornice(m, ring, H - 0.1, trim, 0.4, 0.5);
    // la mansarda segue l'impronta, rientrata, col tetto piano sopra
    if (tetto === 'mansarda') m.prism(offsetRing(ring, -1.4), H + 0.4, H + 3, PAL.ardesia, PAL.piombo);
  } else if (tetto === 'padiglione' || tetto === 'mansarda') {
    const w = M.w * 0.94;
    const d = M.d * 0.94;
    const rh = Math.min(w, d) * (tetto === 'mansarda' ? 0.14 : 0.2);
    if (portico !== 'tutto') cornice(m, ring, H - 0.1, trim, 0.4, 0.5);
    if (tetto === 'mansarda') {
      m.box(-w / 2, H, -d / 2, w / 2, H + 2.8, d / 2, PAL.ardesia, { open: 'y-' });
      if (hi) windows(m, -w / 2 + 1, w / 2 - 1, d / 2, [[H + 0.7, H + 2.1]], { step: 4.2, w: 1, glass: PAL.vetro });
      m.hip(0, 0, w, d, H + 2.8, rh, PAL.ardesia);
    } else m.hip(0, 0, w + 0.8, d + 0.8, H, rh, PAL.coppi);
  } else if (tetto === 'capanna' || tetto === 'piode') {
    const along = M.d >= M.w;
    m.gable(0, 0, M.w * 0.96, M.d * 0.96, H, (along ? M.w : M.d) * 0.28, tetto === 'piode' ? PAL.piode : PAL.coppi, col, along, 0.7);
  } else cornice(m, ring, H - 0.2, trim, 0.3, 0.9);
  // torre (il palazzo comunale di Clusone e il suo orologio planetario)
  const th = num(p, 'torre', 0);
  if (th > 0) {
    const ts = num(p, 'torreLato', 6);
    const tx = num(p, 'torreX', 0) * (M.w / 2 - ts / 2);
    tower(m, tx, reachZ(ring, tx) - ts / 2 + 0.4, ts, ts, 0, th, { mat: col, cella: 2, orologio: 1, tetto: str(p, 'torreTetto', 'piramide'), planetario: yes(p, 'planetario'), lesene: hi }, hi, c.drop);
  }
  if (yes(p, 'leone')) {
    if (hi) leone(m, 0, y0 + (H - y0) * 0.55, fz + 0.3, 1.1, PAL.pietra);
    else m.panel(-1.7, y0 + (H - y0) * 0.55 - 1, 1.7, y0 + (H - y0) * 0.55 + 1, fz + 0.3, PAL.oro);
  }
  if (yes(p, 'orologio')) clock(m, 0, H - 2.2, fz + 0.4, 1.4, hi);
  if (yes(p, 'portaleArco')) portale(m, 0, fz, 3, 4, trim, hi);
  if (yes(p, 'pensilina') && hi) {
    // la pensilina sui binari, dietro
    const bz = -reachZ(rotRing(ring, Math.PI), 0);
    const len = M.w * 0.8;
    m.box(-len / 2, 5, bz - 7, len / 2, 5.35, bz, PAL.ferro, { top: PAL.piombo, open: '' });
    for (let x = -len / 2 + 2; x < len / 2; x += 8) m.box(x - 0.15, 0, bz - 5.2, x + 0.15, 5, bz - 4.9, PAL.ferro);
  }
}

function castello(c: Ctx): void {
  const { m, M, p, hi } = c;
  const col = mat(p, 'mat', 'pietra');
  const mh = num(p, 'mura', 9);
  const th = num(p, 'torri', mh + 4);
  const drop = c.drop;
  const wall = (a: V2, b: V2, h: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) return;
    const rot = Math.atan2(b[0] - a[0], b[1] - a[1]) - Math.PI / 2;
    m.boxAt((a[0] + b[0]) / 2, -drop, (a[1] + b[1]) / 2, len + 1.6, h + drop, 2.2, col, rot, { top: tone(col, 0.85) });
    if (hi) merli(m, a, b, h, 0.7, col);
  };
  if (M.rings.length > 1) {
    // più anelli (San Vigilio): ogni anello è un bastione, e le mura li uniscono in giro
    const small = M.rings.filter((r) => Math.abs(ringArea(r)) <= 400);
    const cs = small.map((r) => [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length] as V2);
    const order = cs.map((q, i) => ({ i, a: Math.atan2(q[1], q[0]) })).sort((x, y) => x.a - y.a);
    // se c'è già il recinto, i bastioni non si collegano fra loro
    if (small.length === M.rings.length) for (let k = 0; k < order.length; k++) wall(cs[order[k].i], cs[order[(k + 1) % order.length].i], mh);
    for (const r of M.rings) {
      if (Math.abs(ringArea(r)) > 400) {
        // il recinto grande: mura lungo l'anello, non un blocco pieno
        for (let i = 0; i < r.length; i++) wall(r[i], r[(i + 1) % r.length], mh);
        continue;
      }
      m.prism(r, -drop, th, col, tone(col, 0.85));
      if (hi) for (let i = 0; i < r.length; i++) merli(m, r[i], r[(i + 1) % r.length], th, 0.7, col);
    }
  } else {
    const r = M.rings[0];
    for (let i = 0; i < r.length; i++) wall(r[i], r[(i + 1) % r.length], mh);
    // torri quadre negli angoli veri (dove il muro gira di più di 35°)
    for (let i = 0; i < r.length; i++) {
      const a = r[(i - 1 + r.length) % r.length];
      const b = r[i];
      const q = r[(i + 1) % r.length];
      const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const t2 = Math.atan2(q[1] - b[1], q[0] - b[0]);
      let turn = Math.abs(t2 - t1);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn < 0.6) continue;
      const ts = 5.5;
      const rot = t1;
      m.boxAt(b[0], -drop, b[1], ts, th + drop, ts, col, -rot, { top: tone(col, 0.8) });
      if (hi) {
        const cr = Math.cos(-rot);
        const sr = Math.sin(-rot);
        const P = (x: number, z: number): V2 => [b[0] + x * cr + z * sr, b[1] - x * sr + z * cr];
        merli(m, P(-ts / 2, ts / 2), P(ts / 2, ts / 2), th, 0.6, col);
        merli(m, P(ts / 2, -ts / 2), P(-ts / 2, -ts / 2), th, 0.6, col);
      }
    }
  }
  // il mastio: la torre tonda (la Rocca) o quadra, nel vertice più lontano dal centro
  const mast = num(p, 'mastio', 0);
  if (mast > 0) {
    const all = M.rings.flat();
    let far = all[0];
    for (const q of all) if (Math.hypot(q[0], q[1]) > Math.hypot(far[0], far[1])) far = q;
    const rr = num(p, 'mastioR', 5.5);
    const k = Math.max(0, 1 - (rr + 1.5) / Math.max(1, Math.hypot(far[0], far[1])));
    const mx = far[0] * k;
    const mz = far[1] * k;
    if (str(p, 'mastioForma', 'tonda') === 'tonda') {
      m.cyl(mx, mz, rr, rr, -drop, mast, hi ? 16 : 10, col, true);
      m.cyl(mx, mz, rr + 0.5, rr + 0.5, mast - 1.4, mast, hi ? 16 : 10, tone(col, 1.06), true);
      if (hi) for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        m.boxAt(mx + Math.cos(a) * (rr + 0.2), mast, mz + Math.sin(a) * (rr + 0.2), 0.9, 1.1, 0.7, col, -a + Math.PI / 2);
      }
    } else {
      tower(m, mx, mz, rr * 2, rr * 2, 0, mast, { mat: col, cella: 0, orologio: 0, tetto: 'merli', feritoie: true }, hi, drop);
    }
  }
}

function statua(c: Ctx): void {
  const { m, p, hi, ring } = c;
  const fig = mat(p, 'mat', 'bronzo');
  const stone = mat(p, 'pietra', 'pietra');
  const area = Math.abs(ringArea(ring));
  if (area > 12) {
    // la piazzola del monumento: gradini sull'impronta vera
    m.prism(ring, -c.drop, 0.3, tone(stone, 0.9), tone(stone, 0.95));
    m.prism(offsetRing(ring, -0.8), 0.3, 0.6, stone, stone);
  } else m.box(-1.8, -c.drop, -1.8, 1.8, 0.3, 1.8, tone(stone, 0.9));
  const ph = num(p, 'piedistallo', 3.2);
  const pw = num(p, 'piedistalloL', 1.8);
  const pd = num(p, 'piedistalloP', pw);
  const y0 = area > 12 ? 0.6 : 0.3;
  m.box(-pw / 2 - 0.35, y0, -pd / 2 - 0.35, pw / 2 + 0.35, y0 + 0.5, pd / 2 + 0.35, tone(stone, 1.04));
  m.box(-pw / 2, y0 + 0.5, -pd / 2, pw / 2, y0 + ph - 0.4, pd / 2, stone);
  m.box(-pw / 2 - 0.25, y0 + ph - 0.4, -pd / 2 - 0.25, pw / 2 + 0.25, y0 + ph, pd / 2 + 0.25, tone(stone, 1.06));
  if (hi) m.panel(-pw * 0.32, y0 + ph * 0.35, pw * 0.32, y0 + ph * 0.65, pd / 2, PAL.bronzo, 0.05);
  const top = y0 + ph;
  const s = num(p, 'figura', 2.8);
  const posa = str(p, 'posa', 'in-piedi');
  if (!hi) {
    // da lontano: una sagoma scura alta quanto la statua
    if (posa === 'equestre') m.box(-0.35 * s, top, -0.6 * s, 0.35 * s, top + 1.3 * s, 0.6 * s, fig);
    else m.box(-0.18 * s, top, -0.12 * s, 0.18 * s, top + s * (posa === 'busto' ? 0.35 : posa === 'seduto' ? 0.75 : 1), 0.12 * s, fig);
    return;
  }
  if (posa === 'equestre') m.append(equestre(s, fig, hi), 0, top, 0);
  else if (posa === 'seduto') {
    m.append(seduto(s, fig, tone(fig, 1.15), hi), 0, top, -0.1 * s);
    if (yes(p, 'musa')) m.append(persona(s * 1.02, fig, { braccio: 'lira', gonna: true, hi }), 0.55 * s, top, 0.15 * s, -0.4);
  } else if (posa === 'coppia') {
    m.append(persona(s, fig, { braccio: 'piccone', hi }), -0.25 * s, top, 0);
    m.append(persona(s * 0.94, fig, { braccio: 'petto', gonna: true, hi }), 0.25 * s, top, 0);
  } else if (posa === 'busto') {
    m.beam([0, top, 0], [0, top + 0.25 * s, 0], 0.42 * s, fig, 0.36 * s);
    m.ball(0, top + 0.36 * s, 0.01 * s, 0.11 * s, fig, 8, 3);
  } else m.append(persona(s, fig, { braccio: str(p, 'braccio', 'fianco') as Braccio, mantello: yes(p, 'mantello'), hi }), 0, top, 0);
}

function caduti(c: Ctx): void {
  const { m, M, p, hi, ring } = c;
  const stone = mat(p, 'mat', 'pietra');
  const forma = str(p, 'forma', 'stele');
  const area = Math.abs(ringArea(ring));
  if (area > 12) m.prism(ring, -c.drop, 0.35, tone(stone, 0.88), tone(stone, 0.95));
  else m.box(-2.4, -c.drop, -2.4, 2.4, 0.35, 2.4, tone(stone, 0.88));
  const H = M.h;
  if (forma === 'muro') {
    // l'esedra: un muro lungo con la stele più alta in mezzo e le lapidi coi nomi
    const w = M.w * 0.85;
    m.box(-w / 2, 0.35, -0.6, w / 2, H * 0.5, 0.6, stone);
    m.box(-w / 2 - 0.2, H * 0.5, -0.75, w / 2 + 0.2, H * 0.5 + 0.35, 0.75, tone(stone, 1.06));
    m.box(-1.4, 0.35, -0.8, 1.4, H, 0.8, stone);
    m.box(-1.6, H, -0.95, 1.6, H + 0.35, 0.95, tone(stone, 1.06));
    if (hi) for (const x of [-w / 3, w / 3]) m.panel(x - 1.6, 1.1, x + 1.6, H * 0.42, 0.6, PAL.bronzo, 0.05);
    m.append(persona(2.2, PAL.bronzo, { braccio: 'petto', hi }), 0, 0.35 + 1.2, 1.4);
    m.box(-0.8, 0.35, 0.9, 0.8, 1.55, 1.9, stone);
  } else {
    m.box(-1.6, 0.35, -1.6, 1.6, 0.85, 1.6, tone(stone, 1.04));
    m.box(-1.0, 0.85, -0.8, 1.0, H - 2.4, 0.8, stone);
    m.box(-1.2, H - 2.4, -1.0, 1.2, H - 2.1, 1.0, tone(stone, 1.06));
    if (hi) m.panel(-0.7, 1.6, 0.7, H - 3.6, 0.8, PAL.bronzo, 0.05);
    m.append(persona(2.1, PAL.bronzo, { braccio: str(p, 'braccio', 'alzato') as Braccio, hi }), 0, H - 2.1, 0);
  }
}

function stazione(c: Ctx): void {
  const { m, M, p, hi, ring } = c;
  const tipo = str(p, 'tipo', 'treno');
  if (tipo === 'treno') {
    palazzo(c);
    return;
  }
  const col = mat(p, 'mat', 'giallo');
  const H = M.h;
  // il corpo è un palazzetto: finestre, cornicione, tetto; poi quello che lo fa riconoscere
  palazzo({ ...c, p: { piani: 2, tetto: tipo === 'funivia' ? 'piano' : 'padiglione', ...p, padiglioni: '', colonne: 0 } });
  const fz = reachZ(ring, 0);
  const [x0, x1] = spanX(ring, fz - 0.4);
  if (tipo === 'funicolare') {
    // il vano verso valle e la vettura rossa sul piano inclinato
    const aw = Math.min(5, (x1 - x0) * 0.6);
    m.panel(-aw / 2, 0, aw / 2, H * 0.55, fz + 0.05, PAL.buio, 0.08);
    m.disc(0, H * 0.55, fz + 0.1, aw / 2, hi ? 8 : 5, PAL.buio);
    const pend = num(p, 'pend', 0.3);
    const car = new Mesh();
    const L = 7.5;
    // due scompartimenti a gradini, come le vetture vere sulla pendenza
    car.box(-1.2, 0.4, 0, 1.2, 2.9, L / 2, PAL.rosso, { top: PAL.bianco });
    car.box(-1.2, 0.4 + L * 0.5 * Math.tan(pend) * 0.25, L / 2, 1.2, 2.9 + L * 0.5 * Math.tan(pend) * 0.25, L, PAL.rosso, { top: PAL.bianco });
    if (hi) {
      for (const sgn of [-1, 1]) {
        car.box(sgn * 1.2 - (sgn > 0 ? 0 : 0.05), 1.6, 0.4, sgn * 1.2 + (sgn > 0 ? 0.05 : 0), 2.5, L - 0.4, PAL.vetro, { open: sgn > 0 ? 'x-' : 'x+' });
      }
      car.box(-0.9, 1.5, L, 0.9, 2.6, L + 0.05, PAL.vetro, { open: 'z-' });
    }
    const t = new Mesh();
    t.append(car);
    // la vettura scende verso +z con la pendenza della linea
    const cs = Math.cos(pend);
    const sn = Math.sin(pend);
    for (let i = 0; i < t.pos.length; i += 3) {
      const y = t.pos[i + 1];
      const z = t.pos[i + 2];
      t.pos[i + 1] = y * cs - z * sn;
      t.pos[i + 2] = y * sn + z * cs;
    }
    m.append(t, 0, -0.2, fz - L * 0.45);
  } else {
    // funivia: il castello della fune sul tetto, la ruota, una cabina in banchina
    const hw = (x1 - x0) * 0.8;
    const hd = Math.min(M.d * 0.9, 12);
    const hy = H;
    m.box(-hw / 2, hy, fz - hd, hw / 2, hy + 4.2, fz - hd + 0.4, tone(col, 0.9));
    m.box(-hw / 2, hy + 4.2, fz - hd, hw / 2, hy + 4.6, fz + 1.5, PAL.piombo, { open: '' });
    for (const sgn of [-1, 1]) m.box(sgn * hw / 2 - 0.3, hy, fz - hd, sgn * hw / 2 + 0.3, hy + 4.2, fz + 1.5, tone(col, 0.9));
    m.cyl(0, fz - hd / 2, hw * 0.32, hw * 0.32, hy + 3.2, hy + 3.6, hi ? 16 : 8, PAL.ferro, true, true);
    const cab = new Mesh();
    cab.box(-1.3, 0, -1.5, 1.3, 2.6, 1.5, mat(p, 'cabina', 'rosa') === MAT.rosa ? PAL.rosso : mat(p, 'cabina', 'rosa'), { top: PAL.bianco, open: '' });
    if (hi) {
      cab.box(-1.32, 1.3, -1.2, 1.32, 2.3, 1.2, PAL.vetro, { open: 'y-y+' });
      cab.beam([0, 2.6, 0], [0, 4.6, 0], 0.18, PAL.ferro);
    }
    m.append(cab, 0, hy - 0.2, fz - 1);
  }
}

function casa(c: Ctx): void {
  const { m, M, p, hi, ring } = c;
  const col = mat(p, 'mat', 'pietra');
  const H = M.h;
  zoccolo(c, tone(col, 0.8));
  m.prism(ring, 0, H, col, tone(col, 0.8));
  const along = M.w >= M.d;
  const roofCol = str(p, 'tetto', 'piode') === 'piode' ? PAL.piode : PAL.coppi;
  m.gable(0, 0, M.w * 0.98, M.d * 0.98, H, (along ? M.d : M.w) * 0.36, roofCol, col, !along, 0.9);
  const piani = num(p, 'piani', Math.max(1, Math.round(H / 3.2)));
  for (const side of [0, 1, 2, 3] as const) {
    if (!hi && side % 2) continue;
    onSide(c, side, (sm, fz, x0, x1) => {
      const rows: [number, number][] = [];
      for (let i = 0; i < piani; i++) rows.push([i * 3.1 + 1.2, i * 3.1 + 2.3]);
      windows(sm, x0 + 1, x1 - 1, fz, rows, { step: 3.4, w: 0.8, frame: hi ? PAL.intonacoBianco : undefined });
      if (side === 0) portale(sm, (x0 + x1) / 2, fz + 0.05, 1.8, 2.4, PAL.pietraScura, hi);
      if (hi) {
        // cantonali: blocchi alterni agli spigoli
        for (let y = 0.4; y < H - 0.6; y += 1.1) {
          const k = Math.round(y / 1.1) % 2;
          sm.box(x0 - 0.05, y, fz - 0.1, x0 + (k ? 1.1 : 0.7), y + 0.5, fz + 0.12, tone(col, 1.1), { open: 'z-' });
          sm.box(x1 - (k ? 1.1 : 0.7), y, fz - 0.1, x1 + 0.05, y + 0.5, fz + 0.12, tone(col, 1.1), { open: 'z-' });
        }
      }
    });
  }
  if (hi) m.box(M.w * 0.18, H, -0.6, M.w * 0.18 + 0.9, H + (along ? M.d : M.w) * 0.36 + 1.2, 0.3, tone(col, 0.9), { top: PAL.piode });
  if (yes(p, 'leone')) {
    const fz = reachZ(ring, 0);
    if (hi) leone(m, 0, H * 0.62, fz + 0.06, 0.8, PAL.affresco);
  }
}

const BUILD: Record<Monumento['kind'], (c: Ctx) => void> = { porta, torre, chiesa, cappella, tempietto, mausoleo, palazzo, castello, statua, caduti, stazione, casa };

/**
 * Il modello di un monumento nel suo riferimento: origine al centro dell'impronta, alla quota
 * del pavimento; lo zoccolo scende fino al terreno più basso (yMin). Va messo in scena in
 * (x, y, z) girato di `yaw` attorno all'asse verticale.
 */
export function monumentoMesh(M: Monumento, det: Dettaglio): Mesh {
  const m = new Mesh();
  const ring = M.rings[0] ?? [];
  const drop = Math.max(1.5, M.y - M.yMin + 1.5);
  BUILD[M.kind]({ m, M, p: M.p, hi: det === 'alta', drop, ring });
  return m;
}

export function monumentoGeometry(M: Monumento, det: Dettaglio): THREE.BufferGeometry {
  return monumentoMesh(M, det).geometry();
}
