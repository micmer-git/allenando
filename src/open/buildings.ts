import { PLASTER_UV, finishUV } from './facadeLayout';
import { facadeSide } from './facadeGeometry';
import { BUILDING_KIND, type Building } from './world';

/*
 * Edifici del mondo aperto, senza Three.js: pareti con le coordinate delle finestre e tetti a falde.
 *
 * - Le campate, i materiali e gli ingressi mappati sono emessi da facadeSide.
 * - Case, palazzine e chiese con la pianta quasi rettangolare hanno il tetto a due falde (o a padiglione
 *   se la pianta Ã¨ tozza), in coppi, poggiato sul rettangolo minimo che contiene la pianta, con la gronda
 *   che sporge. Gli altri hanno il tetto piano con il parapetto.
 */

export const BAY = 3.2;
export const FLOOR = 3.0;
/** uv della parte vuota della trama: muro senza finestre */
export const BLANK_UV = PLASTER_UV;
const PITCH = Math.tan((21 * Math.PI) / 180);
const EAVE = 0.45;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Triangoli non indicizzati: 3 vertici per triangolo, normali per faccia. */
export class Tris {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  get count(): number {
    return this.pos.length / 9;
  }
  push(a: V, b: V, c: V, col: Rgb): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.uv.push(a.u, a.v, b.u, b.v, c.u, c.v);
    for (let i = 0; i < 3; i++) this.col.push(col.r, col.g, col.b);
  }
  /** Come push, ma gira il triangolo se la normale non guarda verso `out`. */
  facing(a: V, b: V, c: V, out: [number, number, number], col: Rgb): void {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) this.push(a, b, c, col);
    else this.push(a, c, b, col);
  }
}

export interface V {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

const v = (x: number, y: number, z: number, u = BLANK_UV, w = BLANK_UV): V => ({ x, y, z, u, v: w });

export interface Obb {
  cx: number;
  cz: number;
  /** asse lungo, versore */
  ax: number;
  az: number;
  /** semilunghezze: lungo e corto */
  hl: number;
  hs: number;
  area: number;
}

/** Rettangolo di area minima che contiene l'anello (calibri rotanti sui lati). */
export function minRect(ring: ArrayLike<number>): Obb {
  const m = ring.length / 2;
  let best: Obb | null = null;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    let dx = ring[j * 2] - ring[i * 2];
    let dz = ring[j * 2 + 1] - ring[i * 2 + 1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    dx /= len;
    dz /= len;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (let k = 0; k < m; k++) {
      const x = ring[k * 2];
      const z = ring[k * 2 + 1];
      const a = x * dx + z * dz;
      const b = -x * dz + z * dx;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (best && area >= best.area) continue;
    const am = (a0 + a1) / 2;
    const bm = (b0 + b1) / 2;
    const cx = am * dx - bm * dz;
    const cz = am * dz + bm * dx;
    const la = (a1 - a0) / 2;
    const lb = (b1 - b0) / 2;
    best = la >= lb ? { cx, cz, ax: dx, az: dz, hl: la, hs: lb, area } : { cx, cz, ax: -dz, az: dx, hl: lb, hs: la, area };
  }
  return best ?? { cx: ring[0] ?? 0, cz: ring[1] ?? 0, ax: 1, az: 0, hl: 0, hs: 0, area: 0 };
}

export function ringArea(ring: ArrayLike<number>): number {
  let s = 0;
  const m = ring.length / 2;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    s += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return s / 2;
}

export type RoofShape = 'gable' | 'hip' | 'flat';

/** Che tetto ha: a falde solo dove la pianta Ã¨ quasi un rettangolo e non troppo grande. */
export function roofShape(b: Building, obb: Obb, area: number, wide = false, alpine = false): RoofShape {
  const m = b.ring.length / 2;
  const known = b.architecture?.roof;
  if (known === 'flat') return 'flat';
  if (known && obb.hs >= 1 && area / obb.area > 0.78) return known;
  if (b.kind === BUILDING_KIND.industrial || b.kind === BUILDING_KIND.tower || b.kind === BUILDING_KIND.castle) return 'flat';
  if (obb.area <= 0 || obb.hs < 2.2) return 'flat';
  const fill = area / obb.area;
  // le case e gli hotel ladini: due falde quasi sempre, anche sulle impronte a L o a gradini degli
  // alberghi (fino a 3200 mÂ², 40 vertici); il padiglione lÃ¬ quasi non c'Ã¨ (km0-49680937, corvara-79922438)
  if (alpine) return fill > 0.62 && area < 3200 && m <= 40 && obb.hs < 22 ? 'gable' : 'flat';
  const pitched = b.kind === BUILDING_KIND.church ? fill > 0.7 && area < 2500 : wide ? fill > 0.75 && area < 2200 && m <= 18 && obb.hs < 16 : fill > 0.8 && area < 950 && m <= 14 && obb.hs < 11;
  if (!pitched) return 'flat';
  // tozze (quasi quadrate): padiglione; lunghe: due falde, come le cascine e le chiese
  return b.kind !== BUILDING_KIND.church && obb.hl / obb.hs < 1.55 ? 'hip' : 'gable';
}

export interface BuildingColors {
  wall: Rgb;
  base: Rgb;
  /** tetto piano */
  roof: Rgb;
  /** falde in coppi */
  tiles: Rgb;
  /** muro senza finestre */
  blind: boolean;
  /**
   * i capannoni: la fascia delle finestre a nastro sotto la gronda (questo colore, il vetro) e uno
   * zoccolo piÃ¹ scuro, sui muri ciechi abbastanza alti e lunghi
   */
  ribbon?: Rgb;
  entranceGround?: (x: number, z: number) => number;
  /** pendenza delle falde (tangente); senza, i 21Â° dei tetti lombardi */
  pitch?: number;
  /** sporto della gronda, metri (0,45 di norma; le case ladine 1,1) */
  eaves?: number;
  /** tetto a falde anche sugli edifici grandi (gli hotel tirolesi fino a 2200 mÂ²) */
  wide?: boolean;
  /**
   * le case ladine: due falde anche sugli hotel, il timpano di legno e (se `balconies`) i balconi
   * di legno in rilievo a ogni piano sopra il terreno, sui lati lunghi almeno 5 m
   */
  alpine?: { wood: Rgb; balconies: boolean };
}

/** Il balcone ladino: sporge 1,1 m, ringhiera alta 1 m, dal 10% al 90% del lato. */
export const BALCONY = { depth: 1.1, rail: 1.0, inset: 0.1, minLen: 5 };

/**
 * Pareti e tetto di un edificio. `walls` va con la trama delle facciate, `roofs` con quella dei coppi.
 * Ritorna la quota del colmo (per la cuspide delle torri, e per le prove).
 *
 * `ground` Ã¨ il piano terra (le finestre e l'altezza partono da lÃ¬); `plinth`, se Ã¨ piÃ¹ in basso,
 * Ã¨ il piede dello zoccolo: su un pendio la facciata scende a valle di un piano al massimo (il
 * seminterrato), e sotto c'Ã¨ il muro di sostegno in pietra fino al terreno.
 */
export function addBuilding(walls: Tris, roofs: Tris, b: Building, ground: number, c: BuildingColors, plinth = ground): { top: number; shape: RoofShape } {
  const r = b.ring;
  const m = r.length / 2;
  const area = Math.abs(ringArea(r));
  const obb = minRect(r);
  const shape = roofShape(b, obb, area, c.wide, !!c.alpine);
  const bottom = ground + b.minH;
  // dove comincia la facciata: sui portici (minH) resta sospesa, altrimenti scende verso lo zoccolo
  const face = b.minH > 0 || plinth >= bottom - 0.05 ? bottom : Math.max(plinth + 1, bottom - FLOOR);
  const foot = b.minH > 0 ? bottom : Math.min(plinth, bottom);
  const stone = { r: c.base.r * 0.86, g: c.base.g * 0.84, b: c.base.b * 0.8 };
  const height = Math.max(2.6, b.h);
  const rise = shape === 'flat' ? 0 : Math.min(7, obb.hs * (c.pitch ?? PITCH));
  // l'altezza OSM comprende il tetto: il muro si ferma sotto, ma mai sotto un piano
  const wallTop = Math.max(bottom + 2.6, ground + height - rise * 0.6);
  const ccw = ringArea(r) > 0;
  const seed = Math.imul(Math.round(obb.cx * 10), 73856093) ^ Math.imul(Math.round(obb.cz * 10), 19349663);
  const family = (seed >>> 0) % 3;
  for (let i = 0; i < m; i++) {
    const ax = r[i * 2];
    const az = r[i * 2 + 1];
    const bx = r[((i + 1) % m) * 2];
    const bz = r[((i + 1) % m) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    // fuori: la normale orizzontale del lato, dal verso dell'anello
    // anello antiorario (area positiva nel piano x, z): fuori Ã¨ a destra del lato, (dz, âˆ’dx)
    const ox = ccw ? bz - az : -(bz - az);
    const oz = ccw ? -(bx - ax) : bx - ax;
    const out: [number, number, number] = [ox, 0, oz];
    const blind = c.blind || len < 2.4 || wallTop - bottom < 2.4;
    facadeSide(walls, {
      ax, az, bx, bz, out, foot, face, bottom, top: wallTop, wall: c.wall, base: c.base, stone, blind,
      ribbon: c.ribbon, alpine: !!c.alpine, family, shift: ((seed >>> 3) + i) % 4,
      edge: i, architecture: b.architecture, groundAt: c.entranceGround,
    });
    // i balconi di legno: una soletta e la ringhiera davanti, chiusa ai due capi, a ogni piano
    // sopra il piano terra (anche l'ultimo, sotto la gronda)
    if (c.alpine?.balconies && !b.architecture?.kind && !blind && len >= BALCONY.minLen) {
      const ol = Math.hypot(ox, oz);
      const nx = (ox / ol) * BALCONY.depth;
      const nz = (oz / ol) * BALCONY.depth;
      const ta = BALCONY.inset;
      const tb = 1 - BALCONY.inset;
      const p0x = ax + (bx - ax) * ta;
      const p0z = az + (bz - az) * ta;
      const p1x = ax + (bx - ax) * tb;
      const p1z = az + (bz - az) * tb;
      const wood = c.alpine.wood;
      const slab = { r: wood.r * 0.7, g: wood.g * 0.7, b: wood.b * 0.7 };
      const side: [number, number, number] = [bx - ax, 0, bz - az];
      const back: [number, number, number] = [-(bx - ax), 0, -(bz - az)];
      for (let y = bottom + FLOOR; y + FLOOR * 0.8 <= wallTop + 0.01; y += FLOOR) {
        const yt = y + BALCONY.rail;
        // la soletta, vista da sotto e da sopra
        walls.facing(v(p0x, y, p0z), v(p1x, y, p1z), v(p0x + nx, y, p0z + nz), [0, -1, 0], slab);
        walls.facing(v(p1x, y, p1z), v(p1x + nx, y, p1z + nz), v(p0x + nx, y, p0z + nz), [0, -1, 0], slab);
        walls.facing(v(p0x, y + 0.12, p0z), v(p1x, y + 0.12, p1z), v(p0x + nx, y + 0.12, p0z + nz), [0, 1, 0], wood);
        walls.facing(v(p1x, y + 0.12, p1z), v(p1x + nx, y + 0.12, p1z + nz), v(p0x + nx, y + 0.12, p0z + nz), [0, 1, 0], wood);
        // la ringhiera davanti
        walls.facing(v(p0x + nx, y, p0z + nz), v(p1x + nx, y, p1z + nz), v(p0x + nx, yt, p0z + nz), out, wood);
        walls.facing(v(p1x + nx, y, p1z + nz), v(p1x + nx, yt, p1z + nz), v(p0x + nx, yt, p0z + nz), out, wood);
        // i due capi
        walls.facing(v(p1x, y, p1z), v(p1x + nx, y, p1z + nz), v(p1x, yt, p1z), side, wood);
        walls.facing(v(p1x + nx, y, p1z + nz), v(p1x + nx, yt, p1z + nz), v(p1x, yt, p1z), side, wood);
        walls.facing(v(p0x, y, p0z), v(p0x + nx, y, p0z + nz), v(p0x, yt, p0z), back, wood);
        walls.facing(v(p0x + nx, y, p0z + nz), v(p0x + nx, yt, p0z + nz), v(p0x, yt, p0z), back, wood);
      }
    }
  }
  if (shape === 'flat') {
    // tetto piano 40 cm sotto il filo dei muri: il parapetto
    const y = wallTop - (area > 120 ? 0.4 : 0);
    flatRoof(walls, r, y, c.roof);
    return { top: wallTop, shape };
  }
  const ridge = wallTop + rise;
  pitchedRoof(walls, roofs, obb, wallTop, ridge, shape, c);
  return { top: ridge, shape };
}

function flatRoof(t: Tris, r: Float32Array, y: number, col: Rgb): void {
  const m = r.length / 2;
  const idx = earcut(r);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i];
    const b = idx[i + 1];
    const c = idx[i + 2];
    if (a >= m || b >= m || c >= m) continue;
    t.facing(v(r[a * 2], y, r[a * 2 + 1]), v(r[b * 2], y, r[b * 2 + 1]), v(r[c * 2], y, r[c * 2 + 1]), [0, 1, 0], col);
  }
}

function pitchedRoof(walls: Tris, roofs: Tris, o: Obb, eaveY: number, ridgeY: number, shape: RoofShape, c: BuildingColors): void {
  const px = -o.az;
  const pz = o.ax;
  const eave = c.eaves ?? EAVE;
  const hl = o.hl + eave;
  const hs = o.hs + eave;
  const drop = eave * ((ridgeY - eaveY) / Math.max(0.01, o.hs));
  const ey = eaveY - drop;
  const P = (a: number, b: number, y: number): V => {
    const x = o.cx + o.ax * a + px * b;
    const z = o.cz + o.az * a + pz * b;
    // coppi: u lungo la gronda, v giÃ¹ per la falda (in metri)
    return { x, y, z, u: a, v: Math.abs(b) * 1.07 };
  };
  const ridgeHalf = shape === 'hip' ? Math.max(0, hl - hs) : hl;
  const E1 = P(hl, hs, ey);
  const E2 = P(-hl, hs, ey);
  const E3 = P(-hl, -hs, ey);
  const E4 = P(hl, -hs, ey);
  const R1 = P(ridgeHalf, 0, ridgeY);
  const R2 = P(-ridgeHalf, 0, ridgeY);
  const up = (b: number): [number, number, number] => [px * b, 1, pz * b];
  const t = c.tiles;
  // le due falde lunghe
  roofs.facing(E1, E2, R2, up(1), t);
  roofs.facing(E1, R2, R1, up(1), t);
  roofs.facing(E4, R1, R2, up(-1), t);
  roofs.facing(E4, R2, E3, up(-1), t);
  // sotto la gronda: si vede da vicino, stesso colore un po' piÃ¹ scuro
  const under = { r: t.r * 0.55, g: t.g * 0.55, b: t.b * 0.55 };
  roofs.facing(E1, E2, R2, [0, -1, 0], under);
  roofs.facing(E1, R2, R1, [0, -1, 0], under);
  roofs.facing(E4, R1, R2, [0, -1, 0], under);
  roofs.facing(E4, R2, E3, [0, -1, 0], under);
  if (shape === 'hip') {
    const sw = (V0: V): V => ({ ...V0, u: V0.v, v: Math.abs(V0.u - (V0.u > 0 ? ridgeHalf : -ridgeHalf)) * 1.07 });
    roofs.facing(sw(E1), sw(E4), sw(R1), [o.ax, 1, o.az], t);
    roofs.facing(sw(E2), sw(E3), sw(R2), [-o.ax, 1, -o.az], t);
    return;
  }
  // timpani: triangoli di muro sotto le falde, sul filo del rettangolo (senza gronda)
  const W = (a: number, b: number, y: number): V => {
    const uv = c.alpine ? finishUV('assi', (b / o.hs + 1) / 2, y === ridgeY ? 1 : 0) : [BLANK_UV, BLANK_UV];
    return v(o.cx + o.ax * a + px * b, y, o.cz + o.az * a + pz * b, uv[0], uv[1]);
  };
  // nelle case ladine il timpano Ã¨ di legno
  const gable = c.alpine ? c.alpine.wood : c.wall;
  walls.facing(W(o.hl, o.hs, eaveY), W(o.hl, -o.hs, eaveY), W(o.hl, 0, ridgeY), [o.ax, 0, o.az], gable);
  walls.facing(W(-o.hl, o.hs, eaveY), W(-o.hl, -o.hs, eaveY), W(-o.hl, 0, ridgeY), [-o.ax, 0, -o.az], gable);
}

/** Triangolazione a orecchie di un anello semplice (x, z): indici dei vertici. */
export function earcut(r: ArrayLike<number>): number[] {
  const m = r.length / 2;
  if (m < 3) return [];
  const ccw = ringArea(r) > 0;
  const list: number[] = [];
  for (let i = 0; i < m; i++) list.push(ccw ? i : m - 1 - i);
  const out: number[] = [];
  const X = (i: number) => r[i * 2];
  const Z = (i: number) => r[i * 2 + 1];
  const cross = (a: number, b: number, c: number) => (X(b) - X(a)) * (Z(c) - Z(a)) - (Z(b) - Z(a)) * (X(c) - X(a));
  const inside = (p: number, a: number, b: number, c: number) => {
    const d1 = (X(b) - X(a)) * (Z(p) - Z(a)) - (Z(b) - Z(a)) * (X(p) - X(a));
    const d2 = (X(c) - X(b)) * (Z(p) - Z(b)) - (Z(c) - Z(b)) * (X(p) - X(b));
    const d3 = (X(a) - X(c)) * (Z(p) - Z(c)) - (Z(a) - Z(c)) * (X(p) - X(c));
    return d1 > 0 && d2 > 0 && d3 > 0;
  };
  let guard = 0;
  while (list.length > 3 && guard++ < m * m) {
    let cut = false;
    for (let i = 0; i < list.length; i++) {
      const a = list[(i + list.length - 1) % list.length];
      const b = list[i];
      const c = list[(i + 1) % list.length];
      if (cross(a, b, c) <= 1e-9) continue;
      let ear = true;
      for (const p of list) {
        if (p === a || p === b || p === c) continue;
        if (inside(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push(a, b, c);
      list.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (list.length === 3) out.push(list[0], list[1], list[2]);
  return out;
}
