import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PoiKind } from '@/open/world';

/*
 * L'arredo stradale, uguale nel mondo aperto e sulle salite: la lama del guardrail a doppia onda
 * con i paletti a C, i distanziali, i catadiottri e i terminali interrati; i delineatori bianchi;
 * i cartelli (dare precedenza, stop, rotatoria, attraversamento); i semafori, sempre verdi; il
 * cippo; i modellini dei luoghi da passare (fontanella, belvedere, edicola, campanile...).
 *
 * Convenzione di ogni modellino: origine al piede, +z = avanti nel verso della strada, +x =
 * sinistra (come L nei nastri). Le facce «che guardano chi arriva» stanno verso −z.
 */

// ---------- guardrail ----------

/**
 * Sezione della lama a doppia onda (W): [altezza sulla strada, sporgenza verso la strada dal
 * piano dei distanziali]. Gli orli piegano indietro: da vicino la lamiera ha spessore.
 */
export const WBEAM: [number, number][] = [
  [0.858, -0.012],
  [0.862, 0.02],
  [0.84, 0.072],
  [0.8, 0.085],
  [0.756, 0.058],
  [0.705, 0.03],
  [0.654, 0.058],
  [0.61, 0.085],
  [0.57, 0.072],
  [0.548, 0.02],
  [0.552, -0.012],
];

/** Dal centro del paletto al piano posteriore della lama, verso la strada. */
export const RAIL_SPACER = 0.155;
/** Paletti ogni tanti metri (le barriere vere: 2–4 m). */
export const RAIL_POST_STEP = 4;

export interface RailFrame {
  x: number;
  y: number;
  z: number;
  /** direzione lungo la lama */
  h: number;
  /** +1 la lama sta a sinistra della strada (guarda a destra), −1 a destra */
  side: 1 | -1;
  /** quanto la lama scende nel terreno: 0 di solito, fino a ~0,9 nei terminali */
  drop: number;
}

/** Accumulatore di triangoli indicizzati: posizioni e indici, le normali si calcolano dopo. */
export interface Tri {
  pos: number[];
  idx: number[];
}

/**
 * La lama lungo una fila di sezioni: una lamiera sola, si vede dai due lati col materiale
 * DoubleSide. La sezione sta nel piano perpendicolare alla direzione `h`.
 */
export function sweepBeam(m: Tri, frames: RailFrame[]): void {
  if (frames.length < 2) return;
  const n = WBEAM.length;
  let prev = -1;
  for (const f of frames) {
    // verso la strada: −side · L, con L = (cos h, 0, −sin h)
    const tx = -Math.cos(f.h) * f.side;
    const tz = Math.sin(f.h) * f.side;
    const base = m.pos.length / 3;
    for (const [hy, d] of WBEAM) m.pos.push(f.x + tx * d, f.y + hy - f.drop, f.z + tz * d);
    if (prev >= 0) {
      for (let k = 0; k < n - 1; k++) {
        const a = prev + k;
        const b = base + k;
        m.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    prev = base;
  }
}

/**
 * Le sezioni di una fila di paletti, con i due terminali: la lama prosegue 4,5 m oltre il primo e
 * l'ultimo paletto allargandosi verso l'esterno e scendendo nel terreno, come i terminali
 * interrati delle strade di montagna. I paletti sono al loro posto; la lama sta RAIL_SPACER più in
 * dentro, verso la strada.
 */
export function railFrames(posts: { x: number; y: number; z: number; h: number }[], side: 1 | -1): RailFrame[] {
  if (posts.length < 2) return [];
  const inward = (p: { x: number; z: number; h: number }, extra: number) => {
    // verso la strada (−side·L) di RAIL_SPACER, verso fuori di `extra`
    const k = RAIL_SPACER - extra;
    return { x: p.x - Math.cos(p.h) * side * k, z: p.z + Math.sin(p.h) * side * k };
  };
  const out: RailFrame[] = [];
  const end = (p: { x: number; y: number; z: number; h: number }, sign: number) => {
    const list: RailFrame[] = [];
    for (const [along, flare, drop] of [
      [4.5, 0.55, 0.92],
      [3, 0.32, 0.62],
      [1.5, 0.12, 0.28],
    ]) {
      const fx = Math.sin(p.h) * along * sign;
      const fz = Math.cos(p.h) * along * sign;
      const q = inward({ x: p.x + fx, z: p.z + fz, h: p.h }, flare);
      list.push({ x: q.x, y: p.y, z: q.z, h: p.h, side, drop });
    }
    return list;
  };
  out.push(...end(posts[0], -1));
  for (const p of posts) {
    const q = inward(p, 0);
    out.push({ x: q.x, y: p.y, z: q.z, h: p.h, side, drop: 0 });
  }
  out.push(...end(posts[posts.length - 1], 1).reverse());
  return out;
}

// ---------- geometrie a colori di vertice ----------

const tmpColor = new THREE.Color();

/** Una primitiva con un colore per tutti i vertici (o uno per faccia, per i box). */
function paint(geo: THREE.BufferGeometry, color: string | string[]): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  if (Array.isArray(color)) {
    // BoxGeometry non indicizzata: 6 facce da 6 vertici, nell'ordine +x −x +y −y +z −z
    for (let i = 0; i < n; i++) {
      tmpColor.set(color[Math.min(color.length - 1, Math.floor(i / 6))]);
      tmpColor.toArray(col, i * 3);
    }
  } else {
    tmpColor.set(color);
    for (let i = 0; i < n; i++) tmpColor.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string | string[], ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, color);
}

function cyl(rTop: number, rBottom: number, h: number, seg: number, x: number, y: number, z: number, color: string, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
  g.translate(x, y, z);
  return paint(g, color);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  g.userData.shared = true;
  return g;
}

/** Un tetto a due falde (prisma) di colore unico, colmo lungo z. */
function gable(w: number, d: number, h: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(x, y, z - d / 2);
  return paint(g, color);
}

const GALV = '#aab1b8';
const GALV_DARK = '#8d949b';

/** Paletto a C infisso nel terreno, col distanziale verso la strada (−x). */
export function railPostGeometry(): THREE.BufferGeometry {
  return merge([
    box(0.014, 1.38, 0.1, 0, 0.06, 0, GALV),
    box(0.06, 1.38, 0.014, 0.03, 0.06, 0.05, GALV_DARK),
    box(0.06, 1.38, 0.014, 0.03, 0.06, -0.05, GALV_DARK),
    // distanziale: un pezzo di profilato fra paletto e lama
    box(RAIL_SPACER - 0.01, 0.3, 0.07, -(RAIL_SPACER - 0.01) / 2, 0.705, 0, GALV_DARK),
  ]);
}

/** Catadiottro nella gola della lama: rosso verso +z, bianco verso −z (si gira col lato). */
export function reflectorGeometry(): THREE.BufferGeometry {
  return merge([box(0.03, 0.075, 0.05, -(RAIL_SPACER + 0.045), 0.705, 0, ['#2a2c2f', '#2a2c2f', '#2a2c2f', '#2a2c2f', '#ff2a1f', '#f4f4ee'])]);
}

/** Delineatore di margine: bianco, fascia nera in alto, 1,05 m fuori terra. */
export function delineatorGeometry(): THREE.BufferGeometry {
  return merge([box(0.1, 1.35, 0.12, 0, 0.375, 0, '#f2f2ec'), box(0.104, 0.24, 0.124, 0, 0.86, 0, '#141414')]);
}

/** Gli «occhi» del delineatore: rettangolo rosso verso +z, due tondi bianchi (qui un rettangolo) verso −z. */
export function delineatorEyesGeometry(): THREE.BufferGeometry {
  return merge([box(0.05, 0.17, 0.008, 0, 0.86, 0.066, '#ff3b1f'), box(0.05, 0.15, 0.008, 0, 0.86, -0.066, '#fbfbf2')]);
}

/** Cartello: palo. Il cartello vero (piano con la trama) è a parte. */
export function signPoleGeometry(): THREE.BufferGeometry {
  return merge([cyl(0.03, 0.03, 2.75, 6, 0, 1.25, 0.03, '#9aa0a6')]);
}

/** Il piano del cartello: 0,8 m, centro a 2,15 m, guarda −z. `cell` è la casella dell'atlante. */
export function signPlateGeometry(cell: number, back = false): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.8, 0.8);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const cx = cell % SIGN_COLS;
  const cy = Math.floor(cell / SIGN_COLS);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (cx + uv.getX(i)) / SIGN_COLS, 1 - (cy + 1 - uv.getY(i)) / SIGN_ROWS);
  }
  // il piano guarda +z: lo si gira verso chi arriva; il retro resta verso +z, un filo dietro
  if (!back) g.rotateY(Math.PI);
  g.translate(0, 2.15, back ? 0.012 : 0);
  if (back) {
    // il retro mostra la sagoma rovesciata: uv specchiate in orizzontale
    for (let i = 0; i < uv.count; i++) uv.setX(i, (2 * cx + 1) / SIGN_COLS - uv.getX(i));
  }
  g.userData.shared = true;
  return g;
}

/** Semaforo: palo, lanterna con visiere e pannello di contrasto, rosso e giallo spenti. Guarda −z. */
export function signalGeometry(): THREE.BufferGeometry {
  const lamp = (y: number, c: string) => {
    const g = new THREE.CircleGeometry(0.1, 10);
    g.rotateY(Math.PI);
    g.translate(0, y, -0.166);
    return paint(g, c);
  };
  return merge([
    cyl(0.055, 0.065, 3.45, 8, 0, 1.6, 0, '#3e4a43'),
    box(0.32, 0.98, 0.22, 0, 2.86, -0.05, '#26302a'),
    box(0.62, 1.22, 0.02, 0, 2.86, 0.075, '#111311'),
    box(0.26, 0.03, 0.15, 0, 3.27, -0.235, '#26302a'),
    box(0.26, 0.03, 0.15, 0, 2.97, -0.235, '#26302a'),
    box(0.26, 0.03, 0.15, 0, 2.67, -0.235, '#26302a'),
    lamp(3.15, '#3a0e0b'),
    lamp(2.85, '#3a2a0a'),
  ]);
}

/** La luce verde, accesa: materiale senza ombre. */
export function signalGreenGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(0.1, 12);
  g.rotateY(Math.PI);
  g.translate(0, 2.55, -0.168);
  return merge([paint(g, '#5dff8a')]);
}

/** L'alone del verde: un quadrato additivo davanti alla lente. */
export function signalGlowGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1.1, 1.1);
  g.rotateY(Math.PI);
  g.translate(0, 2.55, -0.2);
  g.userData.shared = true;
  return g;
}

/** Ringhiera dei ponti: un montante ogni 2 m (la lama orizzontale è nella mattonella). */
export function bridgePostGeometry(): THREE.BufferGeometry {
  return merge([box(0.06, 0.86, 0.06, 0, 0.73, 0, '#7f878d')]);
}

/** Cespuglio delle aiuole: verde, qualcuno fiorito (colore per istanza). */
export function shrubGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.55, 0);
  g.scale(1, 0.7, 1);
  g.translate(0, 0.3, 0);
  g.deleteAttribute('uv');
  g.computeBoundingSphere();
  g.userData.shared = true;
  return g;
}

/** In mezzo alle rotatorie grandi: un basamento e una ruota di bicicletta in acciaio corten. */
export function sculptureGeometry(): THREE.BufferGeometry {
  const ring = new THREE.TorusGeometry(1.7, 0.09, 6, 28);
  ring.translate(0, 3.3, 0);
  const hub = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 3.3, 0);
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.BoxGeometry(0.035, 3.3, 0.035);
    s.rotateZ((i * Math.PI) / 6);
    s.translate(0, 3.3, 0);
    spokes.push(paint(s, '#7a4428'));
  }
  return merge([box(1.5, 1.4, 1.5, 0, 0.55, 0, '#c9c2b4'), paint(ring, '#8b4a2a'), paint(hub, '#6d3a20'), ...spokes]);
}

/** Cippo chilometrico: corpo bianco, testa colorata (rossa le statali, gialla le provinciali). */
export function stoneGeometry(cap: string): THREE.BufferGeometry {
  const top = new THREE.CylinderGeometry(0.16, 0.16, 0.16, 10, 1, false, 0, Math.PI);
  top.rotateZ(Math.PI / 2);
  top.rotateY(Math.PI / 2);
  top.translate(0, 0.62, 0);
  return merge([box(0.32, 0.72, 0.16, 0, 0.26, 0, '#efeee8'), paint(top, cap), box(0.322, 0.1, 0.162, 0, 0.55, 0, cap)]);
}

// ---------- modellini dei luoghi ----------

const STONE = '#c8bfae';
const PLASTER = '#e6dcc6';
const TERRACOTTA = '#a4553a';
const WOOD = '#6b4a30';
const IRON = '#2f4a3a';

/** Il modellino di un luogo, o null se il luogo non ne ha uno (un ponte, un edificio già disegnato). */
export function poiGeometry(kind: PoiKind): THREE.BufferGeometry | null {
  switch (kind) {
    case 'fontanella':
      // la colonnina di ghisa verde, il beccuccio, la vaschetta di pietra
      return merge([
        box(0.7, 0.12, 0.5, 0, 0.06, 0, STONE),
        box(0.5, 0.18, 0.32, 0, 0.21, -0.05, '#9da3a6'),
        cyl(0.075, 0.1, 1.05, 8, 0, 0.62, 0.12, IRON),
        cyl(0.11, 0.09, 0.12, 8, 0, 1.18, 0.12, IRON),
        box(0.04, 0.04, 0.22, 0, 0.92, 0.0, IRON),
      ]);
    case 'fontana':
      return merge([
        cyl(1.7, 1.75, 0.5, 18, 0, 0.25, 0, STONE, false),
        cyl(1.5, 1.5, 0.05, 18, 0, 0.42, 0, '#5d8fa6'),
        cyl(0.18, 0.24, 1.3, 8, 0, 0.9, 0, STONE),
        cyl(0.55, 0.3, 0.2, 10, 0, 1.55, 0, STONE),
      ]);
    case 'belvedere':
      // panchina e cannocchiale a gettone, guardano −z (il panorama è dalla parte opposta alla strada)
      return merge([
        box(1.6, 0.06, 0.42, -0.6, 0.45, 0, WOOD),
        box(1.6, 0.36, 0.05, -0.6, 0.72, 0.21, WOOD),
        box(0.06, 0.45, 0.4, -1.3, 0.22, 0, '#3b3f45'),
        box(0.06, 0.45, 0.4, 0.1, 0.22, 0, '#3b3f45'),
        cyl(0.05, 0.07, 1.15, 6, 1.0, 0.58, 0, '#3b3f45'),
        box(0.26, 0.2, 0.5, 1.0, 1.25, -0.05, '#2f6f8f'),
        cyl(0.07, 0.07, 0.2, 8, 1.0, 1.25, -0.36, '#1d2226'),
        box(0.7, 0.04, 0.04, 0.4, 0.9, -0.6, '#3b3f45'),
      ]);
    case 'edicola':
      // edicola votiva: pilastro intonacato, nicchia azzurra, tettuccio di coppi
      return merge([
        box(0.8, 0.25, 0.6, 0, 0.12, 0, STONE),
        box(0.7, 2.1, 0.5, 0, 1.25, 0, PLASTER),
        box(0.42, 0.62, 0.06, 0, 1.55, -0.24, '#3b6fa8'),
        box(0.18, 0.36, 0.04, 0, 1.5, -0.27, '#f1e3c0'),
        gable(0.95, 0.75, 0.32, 0, 2.3, 0, TERRACOTTA),
      ]);
    case 'croce':
      return merge([box(0.6, 0.35, 0.6, 0, 0.17, 0, STONE), box(0.12, 2.5, 0.12, 0, 1.55, 0, WOOD), box(1.0, 0.12, 0.12, 0, 2.25, 0, WOOD)]);
    case 'chiesa':
    case 'santuario': {
      const big = kind === 'santuario' ? 1.4 : 1;
      return merge([
        box(4.2 * big, 5.5 * big, 7 * big, 0, 2.75 * big, 0, PLASTER),
        gable(4.8 * big, 7.4 * big, 2.2 * big, 0, 5.5 * big, 0, TERRACOTTA),
        box(1.2, 2.2, 0.1, 0, 1.1, -3.52 * big, '#5a3d2a'),
        // campaniletto a vela sulla facciata
        box(1.4, 1.6, 0.4, 0, 6.6 * big + 0.8, -3.2 * big, PLASTER),
        box(0.5, 0.7, 0.42, 0, 6.6 * big + 0.9, -3.2 * big, '#3a3530'),
      ]);
    }
    case 'campanile':
      return merge([
        box(3, 17, 3, 0, 8.5, 0, STONE),
        box(3.04, 3, 3.04, 0, 15, 0, '#d9d0bd'),
        box(0.9, 1.8, 3.1, 0, 15, 0, '#2c2925'),
        box(3.1, 1.8, 0.9, 0, 15, 0, '#2c2925'),
        cyl(0, 2.3, 3.2, 4, 0, 18.6, 0, TERRACOTTA),
        box(0.1, 1.2, 0.1, 0, 20.6, 0, '#3b3f45'),
        box(0.6, 0.1, 0.1, 0, 20.8, 0, '#3b3f45'),
      ]);
    case 'castello':
    case 'torre': {
      const parts = [box(5, 12, 5, 0, 6, 0, STONE), box(5.4, 0.5, 5.4, 0, 12, 0, '#b3aa98')];
      for (let i = 0; i < 4; i++) {
        for (const s of [-1, 1]) {
          const a = -2.2 + i * 1.47;
          parts.push(box(0.8, 0.9, 0.5, a, 12.7, s * 2.45, STONE), box(0.5, 0.9, 0.8, s * 2.45, 12.7, a, STONE));
        }
      }
      parts.push(box(0.7, 1.2, 0.1, 0, 7, -2.55, '#3a3530'));
      return merge(parts);
    }
    case 'bici':
      // rastrelliera a U rovesciata, tre posti
      return merge([0, 1, 2].flatMap((i) => [box(0.04, 0.8, 0.04, -0.6 + i * 0.6, 0.4, -0.3, GALV), box(0.04, 0.8, 0.04, -0.6 + i * 0.6, 0.4, 0.3, GALV), box(0.04, 0.04, 0.64, -0.6 + i * 0.6, 0.8, 0, GALV)]));
    case 'bar': {
      // due ombrelloni a spicchi bianchi e rossi, coi tavolini
      const parts: THREE.BufferGeometry[] = [];
      for (const dx of [-1.4, 1.4]) {
        const cone = new THREE.ConeGeometry(1.25, 0.5, 8, 1, true);
        const g = cone.toNonIndexed();
        cone.dispose();
        g.deleteAttribute('uv');
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) tmpColor.set(Math.floor(i / 3) % 2 ? '#f3efe6' : '#b8322a').toArray(col, i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.translate(dx, 2.35, 0);
        parts.push(g, cyl(0.03, 0.03, 2.3, 5, dx, 1.15, 0, '#d8d8d2'), cyl(0.4, 0.4, 0.04, 10, dx, 0.74, 0, '#e8e6e0'), cyl(0.04, 0.12, 0.72, 5, dx, 0.36, 0, '#3b3f45'));
      }
      return merge(parts);
    }
    case 'rifugio':
      return merge([box(5, 1.2, 4, 0, 0.6, 0, STONE), box(5, 2.2, 4, 0, 2.3, 0, '#7b5638'), gable(5.6, 4.6, 2, 0, 3.4, 0, '#4f5257')]);
    case 'ponte':
      return null;
  }
}

// ---------- trame ----------

export const SIGN_COLS = 4;
export const SIGN_ROWS = 2;

/** Le caselle dell'atlante dei cartelli. */
export const SIGN = {
  precedenza: 0,
  stop: 1,
  rotatoria: 2,
  pedoni: 3,
  bici: 4,
  belvedere: 5,
  fontanella: 6,
  semaforo: 7,
} as const;
export type SignKind = keyof typeof SIGN;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, color = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Disegna le sagome dei cartelli; `ink` false: solo la sagoma bianca (per il retro). */
function drawSigns(g: CanvasRenderingContext2D, C: number, ink: boolean): void {
  const cell = (i: number, draw: (x: number, y: number) => void) => {
    g.save();
    g.translate((i % SIGN_COLS) * C, Math.floor(i / SIGN_COLS) * C);
    draw(0, 0);
    g.restore();
  };
  const fill = (c: string) => (g.fillStyle = ink ? c : '#ffffff');
  const tri = (up: boolean) => {
    g.beginPath();
    if (up) {
      g.moveTo(C / 2, C * 0.08);
      g.lineTo(C * 0.95, C * 0.86);
      g.lineTo(C * 0.05, C * 0.86);
    } else {
      g.moveTo(C * 0.05, C * 0.14);
      g.lineTo(C * 0.95, C * 0.14);
      g.lineTo(C / 2, C * 0.92);
    }
    g.closePath();
  };
  const disc = (r: number) => {
    g.beginPath();
    g.arc(C / 2, C / 2, r, 0, Math.PI * 2);
  };
  const square = (pad: number, round = 10) => {
    g.beginPath();
    g.roundRect(pad, pad, C - pad * 2, C - pad * 2, round);
  };
  // dare precedenza: triangolo rovesciato bianco col bordo rosso
  cell(SIGN.precedenza, () => {
    tri(false);
    fill('#c4161c');
    g.fill();
    if (!ink) return;
    g.save();
    g.translate(C / 2, C * 0.45);
    g.scale(0.62, 0.62);
    g.translate(-C / 2, -C * 0.45);
    tri(false);
    g.fillStyle = '#ffffff';
    g.fill();
    g.restore();
  });
  // stop: ottagono rosso, scritta bianca
  cell(SIGN.stop, () => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      g.lineTo(C / 2 + Math.cos(a) * C * 0.46, C / 2 + Math.sin(a) * C * 0.46);
    }
    g.closePath();
    fill('#c4161c');
    g.fill();
    if (!ink) return;
    g.strokeStyle = '#ffffff';
    g.lineWidth = C * 0.03;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = `800 ${Math.round(C * 0.28)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('STOP', C / 2, C / 2 + C * 0.02);
  });
  // rotatoria: disco blu con tre frecce bianche in giro (antiorario)
  cell(SIGN.rotatoria, () => {
    disc(C * 0.46);
    fill('#1d5fb4');
    g.fill();
    if (!ink) return;
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineWidth = C * 0.07;
    for (let i = 0; i < 3; i++) {
      const a0 = (i * Math.PI * 2) / 3 + 0.35;
      const a1 = a0 + 1.35;
      g.beginPath();
      g.arc(C / 2, C / 2, C * 0.25, a0, a1);
      g.stroke();
      const hx = C / 2 + Math.cos(a1) * C * 0.25;
      const hy = C / 2 + Math.sin(a1) * C * 0.25;
      const tx = -Math.sin(a1);
      const ty = Math.cos(a1);
      g.beginPath();
      g.moveTo(hx + tx * C * 0.09, hy + ty * C * 0.09);
      g.lineTo(hx + Math.cos(a1) * C * 0.08, hy + Math.sin(a1) * C * 0.08);
      g.lineTo(hx - Math.cos(a1) * C * 0.08, hy - Math.sin(a1) * C * 0.08);
      g.closePath();
      g.fill();
    }
  });
  // attraversamento pedonale: quadrato blu, triangolo bianco, pedone sulle strisce
  cell(SIGN.pedoni, () => {
    square(C * 0.06);
    fill('#1d5fb4');
    g.fill();
    if (!ink) return;
    tri(true);
    g.save();
    g.translate(C / 2, C / 2);
    g.scale(0.78, 0.78);
    g.translate(-C / 2, -C / 2);
    tri(true);
    g.fillStyle = '#ffffff';
    g.fill();
    g.restore();
    g.fillStyle = '#111111';
    for (let i = 0; i < 4; i++) g.fillRect(C * 0.28 + i * C * 0.12, C * 0.7, C * 0.07, C * 0.06);
    g.beginPath();
    g.arc(C * 0.5, C * 0.34, C * 0.045, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = C * 0.04;
    g.strokeStyle = '#111111';
    g.beginPath();
    g.moveTo(C * 0.5, C * 0.4);
    g.lineTo(C * 0.48, C * 0.55);
    g.lineTo(C * 0.42, C * 0.66);
    g.moveTo(C * 0.48, C * 0.55);
    g.lineTo(C * 0.56, C * 0.66);
    g.moveTo(C * 0.42, C * 0.46);
    g.lineTo(C * 0.58, C * 0.5);
    g.stroke();
  });
  // negozio di bici: quadrato blu con la bicicletta
  cell(SIGN.bici, () => {
    square(C * 0.08);
    fill('#1d5fb4');
    g.fill();
    if (!ink) return;
    g.strokeStyle = '#ffffff';
    g.lineWidth = C * 0.035;
    for (const x of [0.32, 0.68]) {
      g.beginPath();
      g.arc(C * x, C * 0.6, C * 0.13, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(C * 0.32, C * 0.6);
    g.lineTo(C * 0.45, C * 0.4);
    g.lineTo(C * 0.62, C * 0.4);
    g.lineTo(C * 0.68, C * 0.6);
    g.moveTo(C * 0.45, C * 0.4);
    g.lineTo(C * 0.52, C * 0.6);
    g.lineTo(C * 0.62, C * 0.4);
    g.moveTo(C * 0.41, C * 0.34);
    g.lineTo(C * 0.5, C * 0.34);
    g.moveTo(C * 0.62, C * 0.4);
    g.lineTo(C * 0.6, C * 0.31);
    g.stroke();
  });
  // indicazione turistica marrone: belvedere col binocolo
  cell(SIGN.belvedere, () => {
    square(C * 0.06, 6);
    fill('#7b4a24');
    g.fill();
    if (!ink) return;
    g.strokeStyle = '#ffffff';
    g.lineWidth = C * 0.02;
    g.strokeRect(C * 0.1, C * 0.1, C * 0.8, C * 0.8);
    g.fillStyle = '#ffffff';
    for (const x of [0.38, 0.62]) {
      g.beginPath();
      g.arc(C * x, C * 0.4, C * 0.1, 0, Math.PI * 2);
      g.fill();
    }
    g.fillRect(C * 0.38, C * 0.3, C * 0.24, C * 0.12);
    g.font = `700 ${Math.round(C * 0.12)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('BELVEDERE', C / 2, C * 0.72);
  });
  // acqua potabile: quadrato blu col rubinetto e la goccia
  cell(SIGN.fontanella, () => {
    square(C * 0.08);
    fill('#1d5fb4');
    g.fill();
    if (!ink) return;
    g.fillStyle = '#ffffff';
    g.fillRect(C * 0.3, C * 0.3, C * 0.32, C * 0.1);
    g.fillRect(C * 0.52, C * 0.3, C * 0.1, C * 0.2);
    g.beginPath();
    g.moveTo(C * 0.57, C * 0.56);
    g.quadraticCurveTo(C * 0.66, C * 0.7, C * 0.57, C * 0.74);
    g.quadraticCurveTo(C * 0.48, C * 0.7, C * 0.57, C * 0.56);
    g.fill();
    g.font = `700 ${Math.round(C * 0.1)}px sans-serif`;
    g.textAlign = 'center';
    g.fillText('ACQUA', C / 2, C * 0.86);
  });
  // pericolo, semaforo: triangolo col bordo rosso e la lanterna
  cell(SIGN.semaforo, () => {
    tri(true);
    fill('#c4161c');
    g.fill();
    if (!ink) return;
    g.save();
    g.translate(C / 2, C * 0.6);
    g.scale(0.66, 0.66);
    g.translate(-C / 2, -C * 0.6);
    tri(true);
    g.fillStyle = '#ffffff';
    g.fill();
    g.restore();
    g.fillStyle = '#111111';
    g.fillRect(C * 0.44, C * 0.38, C * 0.12, C * 0.36);
    for (const [y, c] of [
      [0.44, '#e3261f'],
      [0.56, '#f2b01e'],
      [0.68, '#2fbf54'],
    ] as const) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(C / 2, C * y, C * 0.038, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** L'atlante dei cartelli (colori) e la sua sagoma (bianco su trasparente, per il retro grigio). */
export function signTextures(): { front: THREE.CanvasTexture; back: THREE.CanvasTexture } {
  const C = 256;
  const [a, ga] = canvas(C * SIGN_COLS, C * SIGN_ROWS);
  drawSigns(ga, C, true);
  const [b, gb] = canvas(C * SIGN_COLS, C * SIGN_ROWS);
  drawSigns(gb, C, false);
  return { front: tex(a), back: tex(b) };
}

/** Alone tondo per le luci accese. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return tex(c);
}

/**
 * Scritte e simboli per terra, in un atlante 4×1: STOP, bicicletta (piste ciclabili), freccia
 * dritta, freccia a destra. Bianco su trasparente.
 */
export const DECAL = { stop: 0, bici: 1, dritto: 2, destra: 3 } as const;
export function decalTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const [c, g] = canvas(W * 4, H);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  // STOP: lettere allungate, si leggono da chi arriva (dal basso della casella)
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(1, 2.6);
  g.font = '800 120px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('STOP', 0, 0, W * 0.92);
  g.restore();
  // bicicletta
  g.save();
  g.translate(W, 0);
  g.lineWidth = 16;
  for (const y of [0.3, 0.7]) {
    g.beginPath();
    g.arc(W / 2, H * y, 58, 0, Math.PI * 2);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(W / 2, H * 0.3);
  g.lineTo(W / 2 - 40, H * 0.47);
  g.lineTo(W / 2 - 40, H * 0.62);
  g.lineTo(W / 2, H * 0.7);
  g.moveTo(W / 2 - 40, H * 0.47);
  g.lineTo(W / 2, H * 0.55);
  g.lineTo(W / 2 - 40, H * 0.62);
  g.stroke();
  g.restore();
  // freccia dritta
  const arrow = (x: number, right: boolean) => {
    g.save();
    g.translate(x, 0);
    g.beginPath();
    if (!right) {
      g.moveTo(W / 2, H * 0.05);
      g.lineTo(W * 0.85, H * 0.38);
      g.lineTo(W * 0.6, H * 0.38);
      g.lineTo(W * 0.6, H * 0.95);
      g.lineTo(W * 0.4, H * 0.95);
      g.lineTo(W * 0.4, H * 0.38);
      g.lineTo(W * 0.15, H * 0.38);
    } else {
      g.moveTo(W * 0.4, H * 0.95);
      g.lineTo(W * 0.4, H * 0.45);
      g.quadraticCurveTo(W * 0.4, H * 0.3, W * 0.62, H * 0.3);
      g.lineTo(W * 0.62, H * 0.16);
      g.lineTo(W * 0.95, H * 0.36);
      g.lineTo(W * 0.62, H * 0.56);
      g.lineTo(W * 0.62, H * 0.42);
      g.quadraticCurveTo(W * 0.6, H * 0.42, W * 0.6, H * 0.5);
      g.lineTo(W * 0.6, H * 0.95);
    }
    g.closePath();
    g.fill();
    g.restore();
  };
  arrow(W * 2, false);
  arrow(W * 3, true);
  const t = tex(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Faccia del cippo: la sigla della strada (SP 35, SS 470), nera su bianco. */
export function stoneTexture(ref: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 192);
  g.fillStyle = '#efeee8';
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = '#16181d';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const m = /^([A-Za-z]+)\s*(.*)$/.exec(ref.trim());
  const head = m ? m[1].toUpperCase() : ref;
  const num = m ? m[2] : '';
  g.font = '800 46px sans-serif';
  g.fillText(head, 64, 70, 116);
  g.font = '800 40px sans-serif';
  g.fillText(num, 64, 124, 116);
  return tex(c);
}

/**
 * I cartelli dei tornanti numerati, come sullo Stelvio: «TORNANTE», il numero grande e la quota.
 * Un atlante solo per tutta la salita (al più 64 caselle).
 */
export function hairpinAtlas(items: { n: number; alt: number }[]): { texture: THREE.CanvasTexture; cols: number; rows: number } {
  const cols = 8;
  const rows = Math.max(1, Math.ceil(Math.min(64, items.length) / cols));
  const W = 128;
  const H = 96;
  const [c, g] = canvas(cols * W, rows * H);
  items.slice(0, 64).forEach((it, i) => {
    const x = (i % cols) * W;
    const y = Math.floor(i / cols) * H;
    g.fillStyle = '#f6f5ef';
    g.fillRect(x + 2, y + 2, W - 4, H - 4);
    g.strokeStyle = '#16181d';
    g.lineWidth = 4;
    g.strokeRect(x + 6, y + 6, W - 12, H - 12);
    g.fillStyle = '#16181d';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 15px sans-serif';
    g.fillText('TORNANTE', x + W / 2, y + 22);
    g.font = '800 38px sans-serif';
    g.fillText(`${it.n}`, x + W / 2, y + 52);
    g.font = '600 13px sans-serif';
    g.fillText(`${it.alt.toLocaleString('it-IT')} m`, x + W / 2, y + 79);
  });
  return { texture: tex(c), cols, rows };
}

// ---------- materiali e istanze ----------

/**
 * I materiali dell'arredo, condivisi: lamiera zincata (lucida, a doppia faccia), oggetti a colori
 * di vertice, catadiottri e luci accese (senza ombre), alone additivo, cartelli fronte e retro.
 */
export function roadsideMaterials() {
  const signs = signTextures();
  const glow = glowTexture();
  const decals = decalTexture();
  return {
    beam: new THREE.MeshPhongMaterial({ color: '#b4bbc2', specular: '#6d7276', shininess: 38, side: THREE.DoubleSide }),
    lit: new THREE.MeshLambertMaterial({ vertexColors: true }),
    bright: new THREE.MeshBasicMaterial({ vertexColors: true }),
    glow: new THREE.MeshBasicMaterial({ map: glow, color: '#46ff7c', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    sign: new THREE.MeshLambertMaterial({ map: signs.front, alphaTest: 0.5 }),
    signBack: new THREE.MeshLambertMaterial({ color: '#8b9096', alphaMap: signs.back, alphaTest: 0.5 }),
    decal: new THREE.MeshLambertMaterial({ map: decals, transparent: true, alphaTest: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
    shrub: new THREE.MeshLambertMaterial({ flatShading: true }),
    textures: [signs.front, signs.back, glow, decals],
  };
}
export type RoadsideMaterials = ReturnType<typeof roadsideMaterials>;

export function disposeRoadsideMaterials(m: RoadsideMaterials): void {
  for (const [k, v] of Object.entries(m)) {
    if (k === 'textures') (v as THREE.Texture[]).forEach((t) => t.dispose());
    else (v as THREE.Material).dispose();
  }
}

/** Un oggetto messo in fila: posizione al piede, rotazione intorno a y, scala facoltativa. */
export interface Placed {
  x: number;
  y: number;
  z: number;
  ry: number;
  s?: number;
  /** colore per istanza (cespugli) */
  c?: string;
}

/** La rotazione che porta il modellino al suo lato: a sinistra guarda la strada da +x. */
export const sideYaw = (h: number, side: 1 | -1): number => (side > 0 ? h : h + Math.PI);

const dummy = new THREE.Object3D();
const instColor = new THREE.Color();

/** Un InstancedMesh pronto da aggiungere alla scena (o null se non c'è niente da mettere). */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Placed[], cull = true): THREE.InstancedMesh | null {
  if (!items.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    dummy.position.set(it.x, it.y, it.z);
    dummy.rotation.set(0, it.ry, 0);
    dummy.scale.setScalar(it.s ?? 1);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    if (it.c) m.setColorAt(i, instColor.set(it.c));
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  if (cull) m.computeBoundingSphere();
  else m.frustumCulled = false;
  return m;
}
