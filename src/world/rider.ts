import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Bici da strada e ciclista, in metri. Assi locali: x a destra, y in alto, z avanti.
 * Le proporzioni sono quelle di una bici taglia 54-56 (passo 1 m, ruote 700×25c,
 * pedivelle 172,5 mm) con un ciclista di circa 1,78 m sulle leve.
 *
 * Tutto ciò che non si muove è fuso in una geometria sola con i colori nei vertici
 * (telaio, catena, manubrio; busto, braccia e testa): un ciclista intero costa una
 * dozzina di chiamate di disegno, non una cinquantina.
 */

type V3 = readonly [number, number, number];

export const BIKE = {
  wheelR: 0.335,
  rearAxle: [0, 0.335, -0.41] as V3,
  frontAxle: [0, 0.335, 0.6] as V3,
  bb: [0, 0.27, 0] as V3,
  seatTop: [0, 0.8, -0.15] as V3,
  headTop: [0, 0.86, 0.47] as V3,
  headBottom: [0, 0.71, 0.51] as V3,
  saddle: [0, 0.965, -0.2] as V3,
  crank: 0.1725,
  pedalX: 0.13,
} as const;

export const BODY = {
  hip: [0.095, 1.0, -0.17] as V3,
  thigh: 0.43,
  shin: 0.42,
  /** caviglia sopra e dietro il pedale */
  ankle: [0, 0.075, -0.035] as V3,
} as const;

const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

function paint(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Un tubo tra due punti. */
function tube(a: V3, b: V3, r: number, color: string, r2 = r, seg = 8): THREE.BufferGeometry {
  const A = v(a);
  const B = v(b);
  const len = Math.max(0.005, A.distanceTo(B));
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return paint(g, color);
}

function sphere(c: V3, r: number, color: string, scale: V3 = [1, 1, 1], seg = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
  g.scale(scale[0], scale[1], scale[2]);
  g.translate(c[0], c[1], c[2]);
  return paint(g, color);
}

function box(c: V3, size: V3, color: string, rotX = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (rotX) g.rotateX(rotX);
  g.translate(c[0], c[1], c[2]);
  return paint(g, color);
}

/** Un ovale lungo il segmento a→b (busto, bacino): capsula schiacciata. */
function capsule(a: V3, b: V3, r: number, color: string, sx = 1, sz = 1): THREE.BufferGeometry {
  const A = v(a);
  const B = v(b);
  const len = A.distanceTo(B);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len), 4, 10);
  g.scale(sx, 1, sz);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return paint(g, color);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // tutte le primitive di three sono indicizzate e hanno position/normal/uv/color
  const out = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!out) throw new Error('rider: geometrie non compatibili');
  out.computeBoundingSphere();
  return out;
}

export interface BikeColors {
  frame: string;
  accent: string;
}

/** Telaio, forcella, reggisella e sella, manubrio a corna di bue, catena e pignoni. */
export function buildFrame({ frame, accent }: BikeColors): THREE.BufferGeometry {
  const { rearAxle: R, frontAxle: F, bb: BB, seatTop: ST, headTop: HT, headBottom: HB, saddle: S } = BIKE;
  const dark = '#1a1d22';
  const metal = '#9aa1aa';
  const p: THREE.BufferGeometry[] = [
    tube(ST, HT, 0.017, frame),
    tube(BB, HB, 0.024, frame, 0.02),
    tube(BB, ST, 0.018, frame),
    tube(HB, HT, 0.022, accent, 0.022),
    // foderi orizzontali e verticali, a coppie
    tube([0.045, BB[1], BB[2] - 0.02], [0.055, R[1], R[2]], 0.011, frame, 0.008),
    tube([-0.045, BB[1], BB[2] - 0.02], [-0.055, R[1], R[2]], 0.011, frame, 0.008),
    tube([0.02, ST[1] - 0.02, ST[2] - 0.01], [0.055, R[1], R[2]], 0.01, frame, 0.008),
    tube([-0.02, ST[1] - 0.02, ST[2] - 0.01], [-0.055, R[1], R[2]], 0.01, frame, 0.008),
    // forcella: due steli dalla testa del tubo sterzo al perno, con l'avanzamento
    tube([0.03, HB[1] - 0.02, HB[2] + 0.005], [0.05, F[1], F[2]], 0.012, frame, 0.009),
    tube([-0.03, HB[1] - 0.02, HB[2] + 0.005], [-0.05, F[1], F[2]], 0.012, frame, 0.009),
    box([0, HB[1] - 0.02, HB[2] + 0.005], [0.08, 0.03, 0.05], frame),
    // reggisella e sella
    tube(ST, [S[0], S[1] - 0.025, S[2] + 0.01], 0.0135, metal),
    capsule([0, S[1], S[2] - 0.11], [0, S[1], S[2] + 0.13], 0.022, dark, 2.6, 1),
    // attacco e piega
    tube(HT, [0, HT[1] + 0.03, HT[2] + 0.1], 0.016, dark),
    tube([-0.21, 0.895, 0.575], [0.21, 0.895, 0.575], 0.0125, dark),
    // borraccia sul tubo obliquo
    tube([0, 0.42, 0.2], [0, 0.56, 0.33], 0.034, accent),
  ];
  for (const x of [-0.21, 0.21]) {
    p.push(
      tube([x, 0.895, 0.575], [x, 0.905, 0.655], 0.0125, dark),
      // leva e corpo del comando (la «leva» su cui stanno le mani)
      tube([x, 0.905, 0.655], [x, 0.94, 0.672], 0.016, dark, 0.014),
      tube([x, 0.905, 0.66], [x, 0.81, 0.675], 0.0125, dark),
      tube([x, 0.81, 0.675], [x, 0.765, 0.6], 0.0125, dark),
    );
  }
  // trasmissione a destra: catena su e giù, pignoni, deragliatore posteriore
  const cx = 0.072;
  p.push(
    tube([cx, BB[1] + 0.1, BB[2]], [cx - 0.01, R[1] + 0.045, R[2]], 0.004, '#4b4f56'),
    tube([cx, BB[1] - 0.1, BB[2]], [cx - 0.01, R[1] - 0.075, R[2] + 0.03], 0.004, '#4b4f56'),
    box([cx - 0.008, R[1] - 0.07, R[2] + 0.02], [0.012, 0.09, 0.03], dark),
  );
  const cog = new THREE.TorusGeometry(0.045, 0.012, 6, 16);
  cog.rotateY(Math.PI / 2);
  cog.translate(cx - 0.012, R[1], R[2]);
  p.push(paint(cog, '#7d838b'));
  return merge(p);
}

/** Copertone, cerchio, mozzo e 20 raggi (incrociati sulle due flange). */
export function buildWheel(rimColor = '#22252b'): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  const tyre = new THREE.TorusGeometry(BIKE.wheelR - 0.012, 0.0135, 8, 40);
  tyre.rotateY(Math.PI / 2);
  p.push(paint(tyre, '#141518'));
  const rim = new THREE.TorusGeometry(BIKE.wheelR - 0.036, 0.013, 6, 40);
  rim.scale(1, 1, 1.4);
  rim.rotateY(Math.PI / 2);
  p.push(paint(rim, rimColor));
  const hub = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10);
  hub.rotateZ(Math.PI / 2);
  p.push(paint(hub, '#a8aeb6'));
  const rr = BIKE.wheelR - 0.045;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const side = i % 2 ? 0.03 : -0.03;
    // il raggio parte un po' fuori asse (tangente), come in una ruota vera
    const a0 = a + (i % 4 < 2 ? 0.25 : -0.25);
    p.push(tube([side, Math.cos(a0) * 0.022, Math.sin(a0) * 0.022], [0, Math.cos(a) * rr, Math.sin(a) * rr], 0.0018, '#c9ced5', 0.0018, 3));
  }
  return merge(p);
}

/** Guarnitura: corona, pedivelle a 180° e pedali. Ruota intorno a x, pedale destro in alto a 0. */
export function buildCrankset(): THREE.BufferGeometry {
  const L = BIKE.crank;
  const p: THREE.BufferGeometry[] = [];
  for (const [r, tub] of [
    [0.105, 0.006],
    [0.085, 0.006],
  ] as const) {
    const ring = new THREE.TorusGeometry(r, tub, 4, 36);
    ring.rotateY(Math.PI / 2);
    ring.translate(0.072, 0, 0);
    p.push(paint(ring, '#2c3036'));
  }
  p.push(
    box([0.085, L / 2, 0], [0.016, L + 0.03, 0.03], '#23262c'),
    box([-0.085, -L / 2, 0], [0.016, L + 0.03, 0.03], '#23262c'),
    box([BIKE.pedalX, L, 0], [0.08, 0.015, 0.065], '#15171a'),
    box([-BIKE.pedalX, -L, 0], [0.08, 0.015, 0.065], '#15171a'),
  );
  const axle = new THREE.CylinderGeometry(0.02, 0.02, 0.17, 8);
  axle.rotateZ(Math.PI / 2);
  p.push(paint(axle, '#6c7179'));
  return merge(p);
}

export interface KitColors {
  jersey: string;
  shorts: string;
  skin: string;
  helmet: string;
}

/** Bacino, busto, braccia sulle leve, collo, testa, casco e occhiali: le parti che non pedalano. */
export function buildBody({ jersey, shorts, skin, helmet }: KitColors): THREE.BufferGeometry {
  const pelvis: V3 = [0, 1.03, -0.16];
  const chest: V3 = [0, 1.33, 0.25];
  const p: THREE.BufferGeometry[] = [
    capsule([0, 1.0, -0.2], [0, 1.06, -0.08], 0.105, shorts, 1.25, 1),
    capsule(pelvis, chest, 0.12, jersey, 1.35, 0.78),
    // spalle, una fascia larga
    capsule([-0.17, 1.35, 0.25], [0.17, 1.35, 0.25], 0.065, jersey),
    tube([0, 1.38, 0.29], [0, 1.45, 0.37], 0.045, skin),
    sphere([0, 1.475, 0.405], 0.098, skin, [0.92, 1, 1.08], 12),
    // casco: calotta allungata, con la tesa all'indietro
    sphere([0, 1.505, 0.39], 0.125, helmet, [0.95, 0.72, 1.32], 12),
    box([0, 1.47, 0.5], [0.15, 0.03, 0.03], '#0e1013'),
  ];
  for (const s of [-1, 1]) {
    const shoulder: V3 = [s * 0.19, 1.35, 0.25];
    const elbow: V3 = [s * 0.215, 1.15, 0.43];
    const hand: V3 = [s * 0.21, 0.955, 0.66];
    const mid: V3 = [(shoulder[0] + elbow[0]) / 2, (shoulder[1] + elbow[1]) / 2, (shoulder[2] + elbow[2]) / 2];
    p.push(
      tube(shoulder, mid, 0.048, jersey, 0.043),
      tube(mid, elbow, 0.042, skin, 0.038),
      tube(elbow, hand, 0.036, skin, 0.03),
      sphere(hand, 0.036, '#15171b', [1, 0.8, 1.3], 8),
    );
  }
  return merge(p);
}

/** Un segmento di arto lungo 1 verso −y, ristretto in fondo: si scala sulla lunghezza vera. */
export function limbGeometry(rTop: number, rBottom: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, 1, 8, 1);
  g.translate(0, -0.5, 0);
  return g;
}

export function shoeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.075, 0.06, 0.25);
  // punta in avanti rispetto alla caviglia
  g.translate(0, -0.035, 0.07);
  return g;
}

/** Posizione del pedale per un angolo di pedivella (0 = destro in alto, cresce pedalando). */
export function pedalAt(angle: number, right: boolean, out = new THREE.Vector3()): THREE.Vector3 {
  const a = right ? angle : angle + Math.PI;
  return out.set(right ? BIKE.pedalX - 0.02 : -BIKE.pedalX + 0.02, BIKE.bb[1] + Math.cos(a) * BIKE.crank, BIKE.bb[2] + Math.sin(a) * BIKE.crank);
}

/**
 * Cinematica inversa a due segmenti nel piano della gamba: dati anca e caviglia, il
 * ginocchio sta sul lato in avanti. Se la caviglia è troppo lontana la gamba si stende.
 */
export function solveKnee(hip: THREE.Vector3, ankle: THREE.Vector3, thigh: number, shin: number, out = new THREE.Vector3()): THREE.Vector3 {
  const dz = ankle.z - hip.z;
  const dy = ankle.y - hip.y;
  const d = Math.min(thigh + shin - 1e-4, Math.max(Math.abs(thigh - shin) + 1e-4, Math.hypot(dz, dy)));
  const base = Math.atan2(dy, dz);
  const alpha = Math.acos(Math.min(1, Math.max(-1, (thigh * thigh + d * d - shin * shin) / (2 * thigh * d))));
  // ruotare verso l'alto-avanti: con la caviglia sotto l'anca, base ≈ −90° e il ginocchio va avanti
  const a = base + alpha;
  return out.set(hip.x + (ankle.x - hip.x) * (thigh / (thigh + shin)), hip.y + Math.sin(a) * thigh, hip.z + Math.cos(a) * thigh);
}

let shadowTex: THREE.Texture | null = null;

/** Ombra morbida sotto la bici: una texture radiale condivisa da tutti i ciclisti. */
export function shadowTexture(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

/** Etichetta col nome sopra un ciclista lontano. */
export function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(10,12,15,0.78)';
    g.beginPath();
    g.roundRect(2, 6, 252, 52, 26);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(32, 32, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f1f2ee';
    g.font = '700 30px sans-serif';
    g.textBaseline = 'middle';
    g.fillText(text.length > 13 ? `${text.slice(0, 12)}…` : text, 52, 34);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
