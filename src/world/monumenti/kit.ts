import * as THREE from 'three';

/*
 * Il cassetto degli attrezzi dei monumenti: un accumulatore di triangoli con il colore nel
 * vertice (una geometria sola per monumento e per livello di dettaglio, un materiale solo per
 * tutti) e le forme che servono a disegnare porte, torri, chiese e statue.
 *
 * Coordinate del modello: metri, x lungo la facciata, y in alto, z verso il davanti (la
 * facciata principale guarda +z). L'origine è il centro dell'impronta alla quota del pavimento.
 * Ogni faccia si orienta da sola: chi la aggiunge dice da che parte è il «dentro», e il verso
 * dei vertici si gira se serve. Così niente pareti invisibili per un verso sbagliato.
 */

export type V2 = [number, number];
export type V3 = [number, number, number];
export type Col = [number, number, number];

const hexCol = (h: string): Col => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};

/** I materiali di Bergamo e delle valli, come colori. */
export const PAL = {
  /** arenaria grigia, la pietra delle Mura e di Città Alta */
  pietra: hexCol('#a9a396'),
  pietraScura: hexCol('#8a857a'),
  /** arenaria ocra (Sarnico), i portali e le cornici */
  ocra: hexCol('#c9a87a'),
  ocraScura: hexCol('#a98c62'),
  /** marmi della Cappella Colleoni e della Porta San Giacomo */
  marmo: hexCol('#eeeae2'),
  marmoRosa: hexCol('#d8a597'),
  marmoNero: hexCol('#4a4744'),
  /** travertino e pietra chiara del Novecento (Torre dei Caduti) */
  travertino: hexCol('#ddd3bd'),
  intonacoGiallo: hexCol('#e2c890'),
  intonacoRosa: hexCol('#e5bca4'),
  intonacoBianco: hexCol('#ece5d6'),
  intonacoVerde: hexCol('#c9cfae'),
  mattoni: hexCol('#a8624a'),
  coppi: hexCol('#b25b3d'),
  coppiScuri: hexCol('#8f4a33'),
  rame: hexCol('#6fa08b'),
  piombo: hexCol('#80868d'),
  ardesia: hexCol('#5d6066'),
  piode: hexCol('#7b7a74'),
  bronzo: hexCol('#5b4a33'),
  bronzoVerde: hexCol('#56806f'),
  ferro: hexCol('#2e3034'),
  vetro: hexCol('#283039'),
  buio: hexCol('#1c1b1a'),
  oro: hexCol('#c9a23c'),
  bianco: hexCol('#f6f3ea'),
  rosso: hexCol('#b8322b'),
  legno: hexCol('#6b4c33'),
  affresco: hexCol('#d9c49a'),
};

/** Un colore un po' più chiaro o più scuro (k > 1 schiarisce). */
export const tone = (c: Col, k: number): Col => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
export const mix = (a: Col, b: Col, t: number): Col => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Area con segno di un anello in pianta (positiva se antiorario in x-z visto dall'alto con z verso il basso). */
export function ringArea(r: V2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export class Mesh {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private shade = 0;

  get tris(): number {
    return this.pos.length / 9;
  }

  /** Un triangolo così com'è (verso antiorario visto da fuori). */
  tri(a: V3, b: V3, c: V3, col: Col): void {
    // una sfumatura minima per faccia: un muro piatto sembra meno di plastica
    this.shade = (this.shade * 7 + 3) % 11;
    const k = 0.975 + this.shade * 0.005;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.col.push(col[0] * k, col[1] * k, col[2] * k);
  }

  /** Poligono convesso piano. `inside`: un punto dalla parte interna, per il verso. */
  poly(pts: V3[], col: Col, inside?: V3): void {
    if (pts.length < 3) return;
    let p = pts;
    if (inside) {
      const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      if (dot(n, sub(inside, p[0])) > 0) p = [...p].reverse();
    }
    for (let i = 1; i + 1 < p.length; i++) this.tri(p[0], p[i], p[i + 1], col);
  }

  quad(a: V3, b: V3, c: V3, d: V3, col: Col, inside?: V3): void {
    this.poly([a, b, c, d], col, inside);
  }

  /** Parallelepipedo allineato agli assi. `open`: facce da non fare (x-, x+, y-, y+, z-, z+). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: Col, opts: { top?: Col; open?: string } = {}): void {
    const o = opts.open ?? 'y-';
    const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    if (!o.includes('x-')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, c);
    if (!o.includes('x+')) this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], col, c);
    if (!o.includes('z-')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], col, c);
    if (!o.includes('z+')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, c);
    if (!o.includes('y+')) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], opts.top ?? col, c);
    if (!o.includes('y-')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, c);
  }

  /** Parallelepipedo per centro e misure, girato di `rot` attorno all'asse verticale. */
  boxAt(cx: number, cy: number, cz: number, w: number, h: number, d: number, col: Col, rot = 0, opts: { top?: Col; open?: string } = {}): void {
    if (!rot) {
      this.box(cx - w / 2, cy, cz - d / 2, cx + w / 2, cy + h, cz + d / 2, col, opts);
      return;
    }
    const m = new Mesh();
    m.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, col, opts);
    this.append(m, cx, cy, cz, rot);
  }

  /** Estrusione verticale di un anello qualunque (anche concavo), con il tetto piano. */
  prism(ring: V2[], y0: number, y1: number, wall: Col, top: Col | null = wall, bottom = false): void {
    if (ring.length < 3) return;
    // verso fisso: area positiva nel piano x-z, poi le pareti guardano fuori
    const r = ringArea(ring) < 0 ? [...ring].reverse() : ring;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      // con area positiva (x verso destra, z verso il basso) la normale esterna di a→b è (dz, -dx)
      const nx = b[1] - a[1];
      const nz = -(b[0] - a[0]);
      const mid: V3 = [(a[0] + b[0]) / 2 - nx, (y0 + y1) / 2, (a[1] + b[1]) / 2 - nz];
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], wall, mid);
    }
    if (top || bottom) {
      const tris = THREE.ShapeUtils.triangulateShape(
        r.map(([x, z]) => new THREE.Vector2(x, z)),
        [],
      );
      for (const [i, j, k] of tris) {
        if (top) this.poly([[r[i][0], y1, r[i][1]], [r[j][0], y1, r[j][1]], [r[k][0], y1, r[k][1]]], top, [r[i][0], y1 - 1, r[i][1]]);
        if (bottom) this.poly([[r[i][0], y0, r[i][1]], [r[j][0], y0, r[j][1]], [r[k][0], y0, r[k][1]]], wall, [r[i][0], y0 + 1, r[i][1]]);
      }
    }
  }

  /** Tronco di cono (o cilindro, o cono con r1 = 0) attorno all'asse verticale. */
  cyl(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, seg: number, col: Col, capTop = true, capBottom = false, phase = 0): void {
    const c: V3 = [cx, (y0 + y1) / 2, cz];
    const at = (i: number, r: number, y: number): V3 => {
      const a = phase + (i / seg) * Math.PI * 2;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    };
    for (let i = 0; i < seg; i++) {
      if (r1 > 1e-4) this.quad(at(i, r0, y0), at(i + 1, r0, y0), at(i + 1, r1, y1), at(i, r1, y1), col, c);
      else this.poly([at(i, r0, y0), at(i + 1, r0, y0), [cx, y1, cz]], col, [cx, y0 + (y1 - y0) * 0.3, cz]);
    }
    if (capTop && r1 > 1e-4) {
      const ring: V3[] = [];
      for (let i = 0; i < seg; i++) ring.push(at(i, r1, y1));
      this.poly(ring, col, [cx, y1 - 1, cz]);
    }
    if (capBottom && r0 > 1e-4) {
      const ring: V3[] = [];
      for (let i = 0; i < seg; i++) ring.push(at(i, r0, y0));
      this.poly(ring, col, [cx, y0 + 1, cz]);
    }
  }

  /** Cupola: mezza ellissoide (o meno, con `upTo` < 1) sopra (cx, y0, cz). */
  dome(cx: number, y0: number, cz: number, r: number, h: number, seg: number, rings: number, col: Col, upTo = 1, phase = 0): void {
    const c: V3 = [cx, y0, cz];
    const pt = (i: number, j: number): V3 => {
      const t = (j / rings) * upTo * (Math.PI / 2);
      const a = phase + (i / seg) * Math.PI * 2;
      const rr = Math.cos(t) * r;
      return [cx + Math.cos(a) * rr, y0 + Math.sin(t) * h, cz + Math.sin(a) * rr];
    };
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const top = j === rings - 1 && upTo >= 1;
        if (top) this.poly([pt(i, j), pt(i + 1, j), [cx, y0 + h, cz]], col, c);
        else this.quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1), col, c);
      }
    }
  }

  /** Piramide (cuspide, tetto a padiglione con colmo nullo) su un rettangolo centrato. */
  pyramid(cx: number, cz: number, w: number, d: number, y0: number, h: number, col: Col): void {
    const apex: V3 = [cx, y0 + h, cz];
    const a: V3 = [cx - w / 2, y0, cz - d / 2];
    const b: V3 = [cx + w / 2, y0, cz - d / 2];
    const c: V3 = [cx + w / 2, y0, cz + d / 2];
    const e: V3 = [cx - w / 2, y0, cz + d / 2];
    const inside: V3 = [cx, y0 + h * 0.25, cz];
    this.poly([a, b, apex], col, inside);
    this.poly([b, c, apex], col, inside);
    this.poly([c, e, apex], col, inside);
    this.poly([e, a, apex], col, inside);
  }

  /** Tetto a padiglione con il colmo lungo l'asse più lungo del rettangolo. */
  hip(cx: number, cz: number, w: number, d: number, y0: number, h: number, col: Col): void {
    const inside: V3 = [cx, y0 + h * 0.3, cz];
    if (w >= d) {
      const r = (w - d) / 2;
      const p1: V3 = [cx - r, y0 + h, cz];
      const p2: V3 = [cx + r, y0 + h, cz];
      const a: V3 = [cx - w / 2, y0, cz - d / 2];
      const b: V3 = [cx + w / 2, y0, cz - d / 2];
      const c: V3 = [cx + w / 2, y0, cz + d / 2];
      const e: V3 = [cx - w / 2, y0, cz + d / 2];
      this.poly([a, b, p2, p1], col, inside);
      this.poly([c, e, p1, p2], col, inside);
      this.poly([b, c, p2], col, inside);
      this.poly([e, a, p1], col, inside);
    } else {
      const r = (d - w) / 2;
      const p1: V3 = [cx, y0 + h, cz - r];
      const p2: V3 = [cx, y0 + h, cz + r];
      const a: V3 = [cx - w / 2, y0, cz - d / 2];
      const b: V3 = [cx + w / 2, y0, cz - d / 2];
      const c: V3 = [cx + w / 2, y0, cz + d / 2];
      const e: V3 = [cx - w / 2, y0, cz + d / 2];
      this.poly([b, c, p2, p1], col, inside);
      this.poly([e, a, p1, p2], col, inside);
      this.poly([a, b, p1], col, inside);
      this.poly([c, e, p2], col, inside);
    }
  }

  /** Tetto a capanna: colmo lungo z (`alongZ`) o lungo x; i timpani col colore del muro. */
  gable(cx: number, cz: number, w: number, d: number, y0: number, h: number, roof: Col, wall: Col, alongZ = true, over = 0.4): void {
    const inside: V3 = [cx, y0 + h * 0.3, cz];
    if (alongZ) {
      const x0 = cx - w / 2 - over;
      const x1 = cx + w / 2 + over;
      const z0 = cz - d / 2 - over;
      const z1 = cz + d / 2 + over;
      const yl = y0 - over * (h / (w / 2));
      this.quad([x0, yl, z0], [x0, yl, z1], [cx, y0 + h, z1], [cx, y0 + h, z0], roof, inside);
      this.quad([x1, yl, z0], [x1, yl, z1], [cx, y0 + h, z1], [cx, y0 + h, z0], roof, inside);
      this.poly([[cx - w / 2, y0, cz - d / 2], [cx + w / 2, y0, cz - d / 2], [cx, y0 + h, cz - d / 2]], wall, inside);
      this.poly([[cx - w / 2, y0, cz + d / 2], [cx + w / 2, y0, cz + d / 2], [cx, y0 + h, cz + d / 2]], wall, inside);
    } else {
      const x0 = cx - w / 2 - over;
      const x1 = cx + w / 2 + over;
      const z0 = cz - d / 2 - over;
      const z1 = cz + d / 2 + over;
      const yl = y0 - over * (h / (d / 2));
      this.quad([x0, yl, z0], [x1, yl, z0], [x1, y0 + h, cz], [x0, y0 + h, cz], roof, inside);
      this.quad([x0, yl, z1], [x1, yl, z1], [x1, y0 + h, cz], [x0, y0 + h, cz], roof, inside);
      this.poly([[cx - w / 2, y0, cz - d / 2], [cx - w / 2, y0, cz + d / 2], [cx - w / 2, y0 + h, cz]], wall, inside);
      this.poly([[cx + w / 2, y0, cz - d / 2], [cx + w / 2, y0, cz + d / 2], [cx + w / 2, y0 + h, cz]], wall, inside);
    }
  }

  /**
   * Un muro spesso (x0…x1, y0…y1, z0…z1) con aperture ad arco a tutto sesto che lo passano da
   * parte a parte lungo z: fornici delle porte, portici, logge, celle campanarie.
   */
  arches(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, holes: { cx: number; w: number; h: number; y?: number }[], col: Col, seg = 6, intrados?: Col): void {
    const contour = [new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)];
    const rings: THREE.Vector2[][] = [];
    for (const hole of holes) {
      const r = hole.w / 2;
      const base = hole.y ?? y0;
      const spring = base + Math.max(0.1, hole.h - r);
      const pts: THREE.Vector2[] = [];
      // un'apertura che tocca terra si chiude sul bordo inferiore del muro: niente lista di fondo
      const bottom = Math.max(base, y0 + 1e-3);
      pts.push(new THREE.Vector2(hole.cx - r, bottom));
      for (let i = 0; i <= seg; i++) {
        const a = Math.PI - (i / seg) * Math.PI;
        pts.push(new THREE.Vector2(hole.cx + Math.cos(a) * r, spring + Math.sin(a) * r));
      }
      pts.push(new THREE.Vector2(hole.cx + r, bottom));
      rings.push(pts);
    }
    // le aperture a terra tagliano il contorno: si fa a strisce verticali fra un'apertura e l'altra
    const touch = holes.some((h) => (h.y ?? y0) <= y0 + 1e-3);
    if (touch) {
      const sorted = [...holes].sort((a, b) => a.cx - b.cx);
      let x = x0;
      for (const h of sorted) {
        const r = h.w / 2;
        // i pilastri fra un'apertura e l'altra: le loro facce di lato sono le spalle degli archi
        if (h.cx - r > x + 1e-3) this.box(x, y0, z0, h.cx - r, y1, z1, col);
        // sopra l'arco: un pannello col profilo dell'arco sotto
        const base = h.y ?? y0;
        const spring = base + Math.max(0.1, h.h - r);
        const top = y1;
        const front: V3[] = [];
        const back: V3[] = [];
        for (let i = 0; i <= seg; i++) {
          const a = Math.PI - (i / seg) * Math.PI;
          front.push([h.cx + Math.cos(a) * r, spring + Math.sin(a) * r, z1]);
          back.push([h.cx + Math.cos(a) * r, spring + Math.sin(a) * r, z0]);
        }
        for (let i = 0; i < seg; i++) {
          const fx = (front[i][0] + front[i + 1][0]) / 2;
          // facce davanti e dietro: dalla curva al bordo alto
          this.quad(front[i], front[i + 1], [front[i + 1][0], top, z1], [front[i][0], top, z1], col, [fx, (top + front[i][1]) / 2, (z0 + z1) / 2]);
          this.quad(back[i], back[i + 1], [back[i + 1][0], top, z0], [back[i][0], top, z0], col, [fx, (top + back[i][1]) / 2, (z0 + z1) / 2]);
          // l'intradosso
          this.quad(front[i], front[i + 1], back[i + 1], back[i], intrados ?? tone(col, 0.82), [fx, top + 5, (z0 + z1) / 2]);
        }
        this.quad([h.cx - r, top, z0], [h.cx + r, top, z0], [h.cx + r, top, z1], [h.cx - r, top, z1], col, [h.cx, top - 1, (z0 + z1) / 2]);
        x = h.cx + r;
      }
      if (x < x1 - 1e-3) this.box(x, y0, z0, x1, y1, z1, col);
      return;
    }
    const tris = THREE.ShapeUtils.triangulateShape(contour, rings);
    const all = [...contour, ...rings.flat()];
    const mid: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    for (const [i, j, k] of tris) {
      const a = all[i];
      const b = all[j];
      const c = all[k];
      this.poly([[a.x, a.y, z1], [b.x, b.y, z1], [c.x, c.y, z1]], col, [mid[0], mid[1], z0]);
      this.poly([[a.x, a.y, z0], [b.x, b.y, z0], [c.x, c.y, z0]], col, [mid[0], mid[1], z1]);
    }
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
        const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
        // l'intradosso guarda dentro l'apertura: il «dentro» è fuori dal buco
        const ox = (a.x + b.x) / 2 + ((a.x + b.x) / 2 - cx) * 2;
        const oy = (a.y + b.y) / 2 + ((a.y + b.y) / 2 - cy) * 2;
        this.quad([a.x, a.y, z0], [b.x, b.y, z0], [b.x, b.y, z1], [a.x, a.y, z1], intrados ?? tone(col, 0.82), [ox, oy, (z0 + z1) / 2]);
      }
    }
    this.box(x0, y0, z0, x1, y1, z1, col, { open: 'z-z+' });
  }

  /** Un prisma a sezione quadrata (lato t0 in a, t1 in b) lungo un segmento qualunque: arti, colli, aste. */
  beam(a: V3, b: V3, t0: number, col: Col, t1 = t0, sides = 4): void {
    const ax = sub(b, a);
    const len = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const u: V3 = [ax[0] / len, ax[1] / len, ax[2] / len];
    // un vettore qualunque non parallelo all'asse
    const ref: V3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let p = cross(u, ref);
    const pl = Math.hypot(p[0], p[1], p[2]);
    p = [p[0] / pl, p[1] / pl, p[2] / pl];
    const q = cross(u, p);
    const ring = (c: V3, t: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < sides; i++) {
        const ang = (i / sides) * Math.PI * 2 + Math.PI / sides;
        const cs = (Math.cos(ang) * t) / 2;
        const sn = (Math.sin(ang) * t) / 2;
        out.push([c[0] + p[0] * cs + q[0] * sn, c[1] + p[1] * cs + q[1] * sn, c[2] + p[2] * cs + q[2] * sn]);
      }
      return out;
    };
    const ra = ring(a, t0);
    const rb = ring(b, t1);
    const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    for (let i = 0; i < sides; i++) this.quad(ra[i], ra[(i + 1) % sides], rb[(i + 1) % sides], rb[i], col, mid);
    this.poly(ra, col, mid);
    this.poly(rb, col, mid);
  }

  /** Una sfera bassa (testa, palla, pomo): due cupole. */
  ball(cx: number, cy: number, cz: number, r: number, col: Col, seg = 6, rings = 2): void {
    this.dome(cx, cy, cz, r, r, seg, rings, col);
    const m = new Mesh();
    m.dome(0, 0, 0, r, r, seg, rings, col);
    // la metà di sotto: la stessa cupola capovolta (y → −y, e x → −x perché il verso resti giusto)
    for (let i = 0; i < m.pos.length; i += 3) this.pos.push(cx - m.pos[i], cy - m.pos[i + 1], cz + m.pos[i + 2]);
    this.col.push(...m.col);
  }

  /** Un pannello sottile appoggiato a una facciata che guarda +z (finestre, lapidi, quadranti). */
  panel(x0: number, y0: number, x1: number, y1: number, z: number, col: Col, depth = 0.08): void {
    this.box(x0, y0, z - depth, x1, y1, z + depth, col, { open: 'z-' });
  }

  /** Disco verticale nel piano x-y che guarda +z (quadranti, rosoni). */
  disc(cx: number, cy: number, z: number, r: number, seg: number, col: Col): void {
    const ring: V3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
    }
    this.poly(ring, col, [cx, cy, z - 1]);
  }

  /** Copia un'altra mesh, girata di `rot` attorno a y e spostata. */
  append(m: Mesh, dx = 0, dy = 0, dz = 0, rot = 0, scale = 1): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i < m.pos.length; i += 3) {
      const x = m.pos[i] * scale;
      const y = m.pos[i + 1] * scale;
      const z = m.pos[i + 2] * scale;
      this.pos.push(dx + x * c + z * s, dy + y, dz - x * s + z * c);
    }
    this.col.push(...m.col);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
