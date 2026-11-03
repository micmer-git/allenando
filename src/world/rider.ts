import * as THREE from 'three';
import { limbMatrix, twoBoneIK, type V3 } from './riderGeo';

/*
 * Bici da strada e ciclista, in metri. Assi locali: y in alto, z avanti, e quindi x verso la
 * SINISTRA del ciclista (three.js è destrorso): la destra, col lato della trasmissione, è −x.
 * Le proporzioni sono quelle di una bici taglia 54-56 (passo 1 m, ruote 700×25c,
 * pedivelle 172,5 mm) con un ciclista di circa 1,78 m sulle leve.
 *
 * Il ciclista è UNA maglia con lo scheletro (SkinnedMesh): 23 ossa, dalla bici che dondola
 * alle mani sulle leve. Qui stanno le misure, le ossa e il risolutore della posa — la stessa
 * funzione dà la posa di riposo (su cui si costruisce la geometria, riderBuild.ts) e quella di
 * ogni fotogramma (riderRig.ts): così la pelle combacia sempre con le ossa.
 */

export const BIKE = {
  wheelR: 0.335,
  rearAxle: [0, 0.335, -0.41] as V3,
  frontAxle: [0, 0.335, 0.6] as V3,
  bb: [0, 0.27, 0] as V3,
  seatTop: [0, 0.8, -0.15] as V3,
  headTop: [0, 0.86, 0.47] as V3,
  headBottom: [0, 0.71, 0.51] as V3,
  saddle: [0, 0.965, -0.2] as V3,
  /** centro del morsetto della piega */
  bar: [0, 0.895, 0.578] as V3,
  crank: 0.1725,
  pedalX: 0.13,
} as const;

export const BODY = {
  /** anca destra, seduto */
  hip: [0.095, 1.0, -0.17] as V3,
  thigh: 0.43,
  shin: 0.42,
  upperArm: 0.3,
  forearm: 0.27,
  /** perno del bacino (fra le anche), seduto */
  pelvis: [0, 1.0, -0.17] as V3,
  /** perno della schiena (lombare), dal bacino */
  lumbar: [0, 0.12, 0.1] as V3,
  /** spalla destra, dal perno lombare */
  shoulder: [0.185, 0.235, 0.315] as V3,
  /** base della testa (atlante), dal perno lombare */
  neck: [0, 0.31, 0.43] as V3,
  /** caviglia rispetto al perno del pedale, nel piano della scarpa */
  ankleUp: 0.092,
  ankleBack: 0.105,
  /** caviglia media sopra e dietro il pedale (piede inclinato di 0,2 rad): per i conti alla buona */
  ankle: [0, 0.111, -0.085] as V3,
  /** palmo sulla leva destra (dalla bici) e polso */
  hood: [0.205, 0.942, 0.685] as V3,
  wrist: [0.2, 0.968, 0.62] as V3,
} as const;

/** Le ossa, nell'ordine dello scheletro. R = destra del ciclista (lato −x, la trasmissione). */
export const B = {
  bike: 0,
  steer: 1,
  wheelF: 2,
  wheelR: 3,
  crank: 4,
  pedalL: 5,
  pedalR: 6,
  pelvis: 7,
  chest: 8,
  head: 9,
  glasses: 10,
  upperArmL: 11,
  forearmL: 12,
  handL: 13,
  upperArmR: 14,
  forearmR: 15,
  handR: 16,
  thighL: 17,
  shinL: 18,
  footL: 19,
  thighR: 20,
  shinR: 21,
  footR: 22,
} as const;
export const BONE_COUNT = 23;

/** Tutto quello che decide la posa in un istante. Angoli in radianti. */
export interface PoseState {
  /** pedivella destra: 0 in alto, cresce pedalando */
  crank: number;
  /** rotazione delle ruote */
  wheel: number;
  /** 0 seduto … 1 fuori sella */
  stand: number;
  /** 0 … 1 posizione raccolta (aero) */
  tuck: number;
  /** dondolio della bici sotto il corpo (fuori sella) */
  bikeRoll: number;
  /** piega in curva, tutto insieme intorno al contatto con l'asfalto */
  lean: number;
  steer: number;
  /** il bacino che ondeggia sulla sella */
  pelvisRoll: number;
  /** il busto che ondeggia con lo sforzo */
  sway: number;
  /** spostamento laterale del bacino (fuori sella, sopra il pedale che spinge) */
  shift: number;
  headYaw: number;
  headPitch: number;
  /** su e giù del bacino */
  bob: number;
  /** spalle che si alzano col respiro e la fatica */
  shrug: number;
  glasses: boolean;
}

export const NEUTRAL: PoseState = {
  crank: 0.9,
  wheel: 0,
  stand: 0,
  tuck: 0,
  bikeRoll: 0,
  lean: 0,
  steer: 0,
  pelvisRoll: 0,
  sway: 0,
  shift: 0,
  headYaw: 0,
  headPitch: 0,
  bob: 0,
  shrug: 0,
  glasses: true,
};

const v3 = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

/** Posizione del pedale per un angolo di pedivella (0 = destro in alto, cresce pedalando). */
export function pedalAt(angle: number, right: boolean, out = new THREE.Vector3()): THREE.Vector3 {
  const a = right ? angle : angle + Math.PI;
  return out.set(right ? -BIKE.pedalX + 0.02 : BIKE.pedalX - 0.02, BIKE.bb[1] + Math.cos(a) * BIKE.crank, BIKE.bb[2] + Math.sin(a) * BIKE.crank);
}

/** Inclinazione del piede (punta in giù > 0): tallone basso in spinta, punta giù in risalita. */
export function footAngle(crank: number, right: boolean): number {
  const a = right ? crank : crank + Math.PI;
  return 0.2 - 0.14 * Math.sin(a - 0.3);
}

/** Caviglia nel riferimento della bici, dal pedale e dall'inclinazione del piede. */
export function ankleAt(crank: number, right: boolean, out = new THREE.Vector3()): THREE.Vector3 {
  pedalAt(crank, right, out);
  const t = footAngle(crank, right);
  const up = BODY.ankleUp;
  const back = BODY.ankleBack;
  return out.set(out.x, out.y + up * Math.cos(t) + back * Math.sin(t), out.z + up * Math.sin(t) - back * Math.cos(t));
}

/**
 * Cinematica inversa a due segmenti nel piano della gamba (y-z): dati anca e caviglia, il
 * ginocchio sta sul lato in avanti. Se la caviglia è troppo lontana la gamba si stende.
 * Il risolutore vero (solvePose) lavora in 3D; questa resta per i conti piani.
 */
export function solveKnee(hip: THREE.Vector3, ankle: THREE.Vector3, thigh: number, shin: number, out = new THREE.Vector3()): THREE.Vector3 {
  const dz = ankle.z - hip.z;
  const dy = ankle.y - hip.y;
  const d = Math.min(thigh + shin - 1e-4, Math.max(Math.abs(thigh - shin) + 1e-4, Math.hypot(dz, dy)));
  const base = Math.atan2(dy, dz);
  const alpha = Math.acos(Math.min(1, Math.max(-1, (thigh * thigh + d * d - shin * shin) / (2 * thigh * d))));
  const a = base + alpha;
  return out.set(hip.x + (ankle.x - hip.x) * (thigh / (thigh + shin)), hip.y + Math.sin(a) * thigh, hip.z + Math.cos(a) * thigh);
}

// temporanei del risolutore (un fotogramma alla volta: nessuna rientranza)
const M = {
  root: new THREE.Matrix4(),
  bike: new THREE.Matrix4(),
  body: new THREE.Matrix4(),
  t: new THREE.Matrix4(),
  r: new THREE.Matrix4(),
};
const P = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  pole: new THREE.Vector3(),
  ank: [new THREE.Vector3(), new THREE.Vector3()],
};
const HB = v3(BIKE.headBottom);
const AXIS = v3(BIKE.headTop).sub(HB).normalize();
const FRONT = v3(BIKE.frontAxle);
const REAR = v3(BIKE.rearAxle);
const BBV = v3(BIKE.bb);
const Q = new THREE.Quaternion();

function rx(m: THREE.Matrix4, a: number) {
  return m.makeRotationX(a);
}

/** out = a · T(p) · R */
function place(out: THREE.Matrix4, a: THREE.Matrix4, p: THREE.Vector3 | V3, r?: THREE.Matrix4) {
  const x = 'x' in p ? p.x : p[0];
  const y = 'x' in p ? p.y : p[1];
  const z = 'x' in p ? p.z : p[2];
  M.t.makeTranslation(x, y, z);
  out.multiplyMatrices(a, M.t);
  if (r) out.multiply(r);
  return out;
}

export interface SolveInfo {
  /** le gambe arrivano ai pedali e le braccia alle leve (nessun arto tirato oltre la sua lunghezza) */
  reach: boolean;
}

/**
 * Le matrici delle 23 ossa, nel riferimento del ciclista (origine a terra sotto il movimento
 * centrale). Gambe e braccia per cinematica inversa: i piedi stanno sui pedali, le mani sulle leve.
 */
export function solvePose(s: PoseState, out: THREE.Matrix4[]): SolveInfo {
  let reach = true;
  const { root, bike, body, r } = M;
  root.makeRotationZ(s.lean);
  bike.multiplyMatrices(root, r.makeRotationZ(s.bikeRoll));
  out[B.bike].copy(bike);

  // sterzo: intorno all'asse del tubo sterzo
  Q.setFromAxisAngle(AXIS, s.steer);
  place(out[B.steer], bike, HB, r.makeRotationFromQuaternion(Q));
  place(out[B.steer], out[B.steer], P.a.copy(HB).negate());
  place(out[B.wheelF], out[B.steer], FRONT, rx(r, s.wheel));
  place(out[B.wheelR], bike, REAR, rx(r, s.wheel));
  place(out[B.crank], bike, BBV, rx(r, s.crank));

  // piedi e pedali: il piede segue il pedale, inclinato come una caviglia vera
  for (let i = 0; i < 2; i++) {
    const right = i === 1;
    const t = footAngle(s.crank, right);
    pedalAt(s.crank, right, P.a);
    place(out[right ? B.pedalR : B.pedalL], bike, P.a, rx(r, t));
    ankleAt(s.crank, right, P.ank[i]);
    place(out[right ? B.footR : B.footL], bike, P.ank[i], rx(r, t));
  }

  // bacino: sulla sella, o in avanti e in alto fuori sella; mai più in alto di dove le gambe arrivano
  const st = s.stand;
  const px = s.shift;
  const pz = BODY.pelvis[2] + st * 0.16 + s.tuck * 0.03;
  let py = BODY.pelvis[1] + st * 0.11 - s.tuck * 0.012 + s.bob;
  const reachMax = (BODY.thigh + BODY.shin) * 0.975;
  for (let i = 0; i < 2; i++) {
    const a = P.ank[i];
    const dx = px + (i === 1 ? -1 : 1) * BODY.hip[0] - a.x;
    const dz = pz - a.z;
    const h2 = reachMax * reachMax - dx * dx - dz * dz;
    if (h2 > 0) py = Math.min(py, a.y + Math.sqrt(h2));
  }
  const pitch = s.tuck * 0.05 + st * 0.06;
  body.multiplyMatrices(root, r.makeRotationZ(s.bikeRoll * (1 - 0.7 * st)));
  place(out[B.pelvis], body, P.a.set(px, py, pz), r.makeRotationZ(s.pelvisRoll));
  out[B.pelvis].multiply(rx(r, pitch));

  // schiena: si piega sul perno lombare (più giù in aero, un po' in fuori sella)
  const bend = s.tuck * 0.2 + st * 0.1;
  place(out[B.chest], out[B.pelvis], BODY.lumbar, rx(r, bend));
  out[B.chest].multiply(r.makeRotationZ(s.sway));

  // testa: compensa la schiena per guardare la strada, più un'occhiata ogni tanto
  place(out[B.head], out[B.chest], BODY.neck, r.makeRotationY(s.headYaw));
  out[B.head].multiply(rx(r, s.headPitch - (bend + pitch) * 0.9));
  out[B.head].multiply(r.makeRotationZ(-s.sway * 0.7));
  out[B.glasses].copy(out[B.head]);
  if (!s.glasses) out[B.glasses].multiply(r.makeScale(1e-3, 1e-3, 1e-3));

  // braccia: dalla spalla al polso sulla leva, gomiti in fuori e un po' indietro
  for (let i = 0; i < 2; i++) {
    const right = i === 1;
    const sx = right ? -1 : 1;
    P.a.set(sx * BODY.shoulder[0], BODY.shoulder[1] + s.shrug, BODY.shoulder[2]).applyMatrix4(out[B.chest]);
    P.c.set(sx * BODY.wrist[0], BODY.wrist[1], BODY.wrist[2]).applyMatrix4(out[B.steer]);
    P.pole.set(sx * 0.55, -0.35, -0.6).transformDirection(bike);
    if (!twoBoneIK(P.a, P.c, BODY.upperArm, BODY.forearm, P.pole, P.b)) reach = false;
    limbMatrix(out[right ? B.upperArmR : B.upperArmL], P.a, P.b, P.pole);
    limbMatrix(out[right ? B.forearmR : B.forearmL], P.b, P.c, P.pole);
    place(out[right ? B.handR : B.handL], out[B.steer], [sx * BODY.hood[0], BODY.hood[1], BODY.hood[2]]);
  }

  // gambe: dall'anca alla caviglia, ginocchio in avanti
  for (let i = 0; i < 2; i++) {
    const right = i === 1;
    const sx = right ? -1 : 1;
    P.a.set(sx * BODY.hip[0], 0, 0).applyMatrix4(out[B.pelvis]);
    P.c.copy(P.ank[i]).applyMatrix4(bike);
    P.pole.set(sx * 0.05, 0.3, 1).transformDirection(bike);
    if (!twoBoneIK(P.a, P.c, BODY.thigh, BODY.shin, P.pole, P.b)) reach = false;
    limbMatrix(out[right ? B.thighR : B.thighL], P.a, P.b, P.pole);
    limbMatrix(out[right ? B.shinR : B.shinL], P.b, P.c, P.pole);
  }
  return { reach };
}

/** Le matrici della posa di riposo: la geometria si costruisce qui sopra. */
export function bindMatrices(): THREE.Matrix4[] {
  const out = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
  solvePose(NEUTRAL, out);
  return out;
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
