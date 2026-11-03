import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Mattoni geometrici del ciclista: loft di sezioni (superellissi) lungo una linea, tubi su un
 * percorso con riferimenti che non si attorcigliano, e l'etichetta di ogni pezzo (l'osso che lo
 * muove e il punto della tavolozza che lo colora). Niente DOM: gira anche nelle prove.
 *
 * Ogni pezzo esce con gli stessi cinque attributi (position, normal, uv, skinIndex, skinWeight)
 * così si fondono in una geometria sola: tutto il ciclista è UNA chiamata di disegno.
 */

export type V3 = readonly [number, number, number];
export const vec = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

/** Una sezione: centro, due assi (larghezza e profondità), semiassi ed esponente (2 ellisse, 3-4 rettangolo smussato). */
export interface Ring {
  c: THREE.Vector3;
  ax: THREE.Vector3;
  ay: THREE.Vector3;
  rx: number;
  ry: number;
  n?: number;
}

function superCosSin(phi: number, n: number): [number, number] {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  if (n === 2) return [c, s];
  const e = 2 / n;
  return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e];
}

export interface LoftOptions {
  /** angolo da cui parte u = 0 (radianti, dall'asse ax verso ay) */
  phase?: number;
  /** v proporzionale alla lunghezza (default) o all'indice della sezione */
  vByIndex?: boolean;
}

/**
 * Pelle tesa su una serie di sezioni. Le facce guardano fuori qualunque sia il verso degli assi;
 * la cucitura di u = 0/1 ha le normali mediate, le sezioni di raggio nullo chiudono in un polo.
 */
export function loft(rings: Ring[], seg: number, opts: LoftOptions = {}): THREE.BufferGeometry {
  const phase = opts.phase ?? 0;
  const nr = rings.length;
  const cols = seg + 1;
  const pos = new Float32Array(nr * cols * 3);
  const uv = new Float32Array(nr * cols * 2);
  // v lungo la linea dei centri
  const acc = [0];
  for (let i = 1; i < nr; i++) acc.push(acc[i - 1] + rings[i].c.distanceTo(rings[i - 1].c));
  const total = acc[nr - 1] || 1;
  const p = new THREE.Vector3();
  for (let i = 0; i < nr; i++) {
    const r = rings[i];
    const n = r.n ?? 2;
    for (let k = 0; k < cols; k++) {
      const phi = phase + (k / seg) * Math.PI * 2;
      const [cx, sy] = superCosSin(phi, n);
      p.copy(r.c).addScaledVector(r.ax, cx * r.rx).addScaledVector(r.ay, sy * r.ry);
      p.toArray(pos, (i * cols + k) * 3);
      uv[(i * cols + k) * 2] = k / seg;
      uv[(i * cols + k) * 2 + 1] = opts.vByIndex ? i / Math.max(1, nr - 1) : acc[i] / total;
    }
  }
  // verso delle facce: con (ax × ay) concorde all'avanzare delle sezioni, (a, b, c) guarda fuori
  const first = rings[0];
  const along = rings[nr - 1].c.clone().sub(first.c);
  const flip = new THREE.Vector3().crossVectors(first.ax, first.ay).dot(along) < 0;
  const idx: number[] = [];
  for (let i = 0; i < nr - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * cols + k;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const t = new THREE.Vector3();
  for (let i = 0; i < nr; i++) {
    // cucitura: la prima e l'ultima colonna sono lo stesso punto
    const a = i * cols;
    const b = a + seg;
    t.set(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
    nrm.setXYZ(a, t.x, t.y, t.z);
    nrm.setXYZ(b, t.x, t.y, t.z);
    // polo: una sezione ridotta a un punto guarda lungo la linea
    if (rings[i].rx < 1e-5 && rings[i].ry < 1e-5) {
      const nb = i === 0 ? rings[1].c : rings[i - 1].c;
      t.copy(rings[i].c).sub(nb).normalize();
      for (let k = 0; k < cols; k++) nrm.setXYZ(i * cols + k, t.x, t.y, t.z);
    }
  }
  return g;
}

/** Sezioni a cupola che chiudono un'estremità: dalla sezione `r` verso fuori per `depth`. */
export function domeRings(r: Ring, dir: THREE.Vector3, depth: number, steps: number): Ring[] {
  const out: Ring[] = [];
  for (let j = 1; j <= steps; j++) {
    const a = (j / steps) * (Math.PI / 2);
    const k = Math.cos(a);
    out.push({ c: r.c.clone().addScaledVector(dir, Math.sin(a) * depth), ax: r.ax, ay: r.ay, rx: r.rx * k, ry: r.ry * k, n: r.n });
  }
  // l'ultima è un punto
  out[out.length - 1].rx = 0;
  out[out.length - 1].ry = 0;
  return out;
}

/** Profilo di un pezzo lungo una retta: [t 0..1, semiasse x, semiasse y, scostamento y] */
export type Profile = readonly (readonly [number, number, number, number?])[];

/**
 * Loft lungo il segmento a→b con le sezioni descritte da `profile`. `side` dà l'asse x della
 * sezione (viene reso perpendicolare alla linea). Cupole facoltative alle due estremità.
 */
export function segmentLoft(
  a: THREE.Vector3,
  b: THREE.Vector3,
  side: THREE.Vector3,
  profile: Profile,
  seg: number,
  opts: { n?: number; domeA?: number; domeB?: number; domeSteps?: number; phase?: number } = {},
): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const ax = side.clone().addScaledVector(dir, -side.dot(dir)).normalize();
  const ay = new THREE.Vector3().crossVectors(dir, ax).normalize();
  let rings: Ring[] = profile.map(([t, rx, ry, oy = 0]) => ({ c: a.clone().addScaledVector(dir, t * len).addScaledVector(ay, oy), ax, ay, rx, ry, n: opts.n }));
  const steps = opts.domeSteps ?? 3;
  if (opts.domeA) rings = [...domeRings(rings[0], dir.clone().negate(), opts.domeA, steps).reverse(), ...rings];
  if (opts.domeB) rings = [...rings, ...domeRings(rings[rings.length - 1], dir, opts.domeB, steps)];
  return loft(rings, seg, { phase: opts.phase });
}

/**
 * Tubo lungo un percorso curvo, con riferimenti trasportati in parallelo (non si attorciglia
 * nelle curve del manubrio). `radius(t)` può restituire [rx, ry] per una sezione ovale.
 */
export function pathTube(
  points: THREE.Vector3[],
  radius: (t: number) => number | readonly [number, number],
  seg: number,
  steps: number,
  opts: { closed?: boolean; n?: number; up?: THREE.Vector3; tension?: number } = {},
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, !!opts.closed, 'catmullrom', opts.tension ?? 0.5);
  const count = opts.closed ? steps : steps + 1;
  const rings: Ring[] = [];
  let normal: THREE.Vector3 | null = null;
  let prevT: THREE.Vector3 | null = null;
  const q = new THREE.Quaternion();
  for (let i = 0; i <= (opts.closed ? steps : steps); i++) {
    const u = opts.closed ? (i % count) / count : i / steps;
    const c = curve.getPointAt(Math.min(1, u));
    const T = curve.getTangentAt(Math.min(1, u)).normalize();
    if (!normal) {
      const ref = opts.up ?? (Math.abs(T.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
      normal = ref.clone().addScaledVector(T, -ref.dot(T)).normalize();
    } else if (prevT) {
      q.setFromUnitVectors(prevT, T);
      normal.applyQuaternion(q);
      normal.addScaledVector(T, -normal.dot(T)).normalize();
    }
    prevT = T;
    const bin = new THREE.Vector3().crossVectors(T, normal).normalize();
    const r = radius(u);
    const [rx, ry] = typeof r === 'number' ? [r, r] : r;
    rings.push({ c, ax: bin, ay: normal.clone(), rx, ry, n: opts.n });
  }
  return loft(rings, seg);
}

/** Un ingranaggio o un anello piatto intorno all'asse x: denti facoltativi sul bordo esterno. */
export function gearRing(rOut: number, rIn: number, thick: number, seg: number, teeth = 0, toothH = 0.004): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = teeth > 0 ? teeth * 2 : seg;
  const outer = (k: number) => (teeth > 0 && k % 2 === 0 ? rOut + toothH : rOut);
  const h = thick / 2;
  // quattro anelli di vertici: esterno davanti/dietro, interno davanti/dietro
  for (const [r, x] of [
    [-1, h],
    [-1, -h],
    [rIn, h],
    [rIn, -h],
  ] as const) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r < 0 ? outer(k) : r;
      pos.push(x, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  const O = 0;
  const Ob = n;
  const I = 2 * n;
  const Ib = 3 * n;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    // faccia +x (normale +x): esterno → interno
    idx.push(O + k, O + k1, I + k, I + k, O + k1, I + k1);
    // faccia −x
    idx.push(Ob + k, Ib + k, Ob + k1, Ib + k, Ib + k1, Ob + k1);
    // bordo esterno
    idx.push(O + k, Ob + k, O + k1, O + k1, Ob + k, Ob + k1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  // facce piatte: senza vertici condivisi fra fronte e bordo le normali mediate sono morbide, va bene
  g.computeVertexNormals();
  return g;
}

/**
 * Profilo rivoluto intorno all'asse x (cerchi, mozzi, borracce): punti [raggio, x]. Le facce
 * guardano fuori se il profilo gira in senso antiorario nel piano (raggio a destra, x in alto):
 * per un pezzo pieno, dal lato x negativo verso fuori, su lungo il bordo esterno, e dentro.
 */
export function latheX(points: readonly (readonly [number, number])[], seg: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    points.map(([r, x]) => new THREE.Vector2(Math.max(0, r), x)),
    seg,
  );
  // il tornio gira intorno a y: lo si corica sull'asse x
  g.rotateZ(-Math.PI / 2);
  return g;
}

// ---------- etichette: osso e colore ----------

/** Un rettangolo dell'atlante (coordinate 0..1 della tela, y in basso come la texture). */
export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * Assegna osso e colore a un pezzo. `uv` è un punto (tinta unita della tavolozza) o un rettangolo
 * dove riportare le uv del pezzo (maglia, casco, scritte).
 */
export function tag(
  g: THREE.BufferGeometry,
  bone: number | ((p: THREE.Vector3) => [number, number, number]),
  uv: readonly [number, number] | UvRect,
): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (typeof bone === 'number') {
      si[i * 4] = bone;
      sw[i * 4] = 1;
    } else {
      p.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i);
      const [b0, b1, w1] = bone(p);
      si[i * 4] = b0;
      si[i * 4 + 1] = b1;
      sw[i * 4] = 1 - w1;
      sw[i * 4 + 1] = w1;
    }
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  const old = g.attributes.uv as THREE.BufferAttribute | undefined;
  const out = new Float32Array(n * 2);
  if (Array.isArray(uv)) {
    for (let i = 0; i < n; i++) {
      out[i * 2] = uv[0];
      out[i * 2 + 1] = uv[1];
    }
  } else {
    const r = uv as UvRect;
    for (let i = 0; i < n; i++) {
      const u = old ? old.getX(i) : 0;
      const v = old ? old.getY(i) : 0;
      out[i * 2] = r.u0 + (r.u1 - r.u0) * u;
      out[i * 2 + 1] = r.v0 + (r.v1 - r.v0) * v;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(out, 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  return g;
}

export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ready = parts.map((p) => (p.index ? p : indexed(p)));
  const out = mergeGeometries(ready, false);
  ready.forEach((p) => p.dispose());
  if (!out) throw new Error('ciclista: geometrie non compatibili');
  return out;
}

function indexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const idx = new Array<number>(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(idx);
  return g;
}

// ---------- ossa: segmenti e cinematica inversa ----------

const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _x = new THREE.Vector3();

/**
 * Matrice di un segmento d'arto: origine in `a`, −y verso `b`, +z verso il polo (ginocchio in
 * avanti, gomito in fuori). La stessa convenzione vale per la posa di riposo e per l'animazione,
 * così la torsione resta continua.
 */
export function limbMatrix(out: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3, pole: THREE.Vector3): THREE.Matrix4 {
  _y.copy(a).sub(b).normalize();
  _z.copy(pole).addScaledVector(_y, -pole.dot(_y));
  if (_z.lengthSq() < 1e-10) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z);
  out.makeBasis(_x, _y, _z);
  out.setPosition(a);
  return out;
}

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Cinematica inversa a due segmenti in 3D: il giunto di mezzo sta dalla parte del polo.
 * Se il bersaglio è troppo lontano l'arto si stende verso di lui (restituisce false).
 */
export function twoBoneIK(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3): boolean {
  _d.copy(c).sub(a);
  const dist = _d.length();
  const reach = dist <= l1 + l2 - 1e-5;
  const d = Math.min(l1 + l2 - 1e-5, Math.max(Math.abs(l1 - l2) + 1e-5, dist));
  _d.normalize();
  // distanza lungo a→c del piede del giunto, e altezza verso il polo
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-10) _p.set(0, 1, 0).addScaledVector(_d, -_d.y);
  _p.normalize();
  out.copy(a).addScaledVector(_d, x).addScaledVector(_p, h);
  return reach;
}
