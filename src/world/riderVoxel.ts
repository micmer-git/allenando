import * as THREE from 'three';
import type { Rim } from '@/game/look';
import { B, BIKE, BODY, bindMatrices } from './rider';
import type { RiderDetail } from './riderBuild';
import { mergeParts, tag, type UvRect, type V3 } from './riderGeo';
import { ATLAS, swatchUv, type Swatch } from './riderKit';

type Paint = Swatch | UvRect | readonly [number, number];
const jersey = [0.60, 0.44] as const;
const helmet = [0.765, 0.4375] as const;
const backPrint = { ...ATLAS.jersey, u0: 0.75 * 0.32, u1: 0.75 * 0.68 };
const yAxis = new THREE.Vector3(0, 1, 0);
const cache = new Map<string, THREE.BufferGeometry>();

/** Silhouette da corsa su una griglia di cubi. Le ossa e i punti di contatto sono
 * quelli della bicicletta del Garage, così il kit e l'animazione seguono il giocatore. */
export function voxelRiderGeometry(detail: RiderDetail, rim: Rim): THREE.BufferGeometry {
  const key = detail + '/' + rim;
  const cached = cache.get(key);
  if (cached) return cached;
  const bind = bindMatrices();
  const parts: THREE.BufferGeometry[] = [];
  const fine = detail === 'alta';
  const medium = detail !== 'bassa';

  function add(geometry: THREE.BufferGeometry, bone: number, paint: Paint) {
    geometry.applyMatrix4(bind[bone]);
    parts.push(tag(geometry, bone, typeof paint === 'string' ? swatchUv(paint) : paint));
  }
  function box(bone: number, paint: Paint, center: V3, size: V3, pitch = 0) {
    const g = new THREE.BoxGeometry(...size);
    g.rotateX(pitch);
    g.translate(...center);
    add(g, bone, paint);
  }
  function beam(bone: number, paint: Paint, from: V3, to: V3, width: number, depth = width) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const g = new THREE.BoxGeometry(width, direction.length(), depth);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(yAxis, direction.normalize()));
    const middle = a.lerp(b, 0.5);
    g.translate(middle.x, middle.y, middle.z);
    add(g, bone, paint);
  }

  for (const bone of [B.wheelF, B.wheelR]) {
    // I mozzi girano con la ruota. Solo la corona esterna è una vera scala di pixel.
    const grid = medium ? 15 : 11;
    const step = BIKE.wheelR * 2 / grid;
    const half = (grid - 1) / 2;
    for (let y = -half; y <= half; y++) {
      let start = -half;
      for (let z = -half; z <= half + 1; z++) {
        const radius = Math.hypot(y, z);
        if (z <= half && radius < grid / 2 && radius >= grid / 2 - 1.1) continue;
        if (z > start) box(bone, 'tyre', [0, y * step, (start + z - 1) * step / 2], [0.057, step, (z - start) * step]);
        start = z + 1;
      }
    }
    const disc = rim === 'lenticolare' && bone === B.wheelR;
    const wall = rim === 'basso' ? 0.018 : 0.045;
    const radius = BIKE.wheelR - step * 0.85;
    const segments = medium ? 12 : 8;
    for (let i = 0; i < segments; i++) {
      const a = i * Math.PI * 2 / segments, b = (i + 1) * Math.PI * 2 / segments;
      const p: V3 = [0, radius * Math.cos(a), radius * Math.sin(a)];
      beam(bone, i % 4 === 1 ? 'rimStripe' : 'rim', p, [0, radius * Math.cos(b), radius * Math.sin(b)], 0.046, wall);
      if (!disc && i % 2 === 0) beam(bone, 'spoke', [0, 0, 0], p, 0.012);
    }
    if (disc) add(new THREE.CylinderGeometry(radius, radius, 0.035, segments).rotateZ(Math.PI / 2), bone, 'carbon');
    box(bone, 'metal', [0, 0, 0], [0.122, 0.060, 0.060]);
  }

  const { bb, headBottom, headTop, seatTop, saddle, bar } = BIKE;
  beam(B.bike, 'frame', seatTop, headTop, 0.065);
  beam(B.bike, 'frameAccent', bb, headBottom, 0.079);
  beam(B.bike, 'frame', bb, seatTop, 0.062);
  beam(B.bike, 'carbon', seatTop, saddle, 0.045);
  beam(B.steer, 'frame', headBottom, headTop, 0.078);
  beam(B.steer, 'carbon', headTop, bar, 0.047);
  box(B.bike, 'saddle', saddle, [0.16, 0.044, 0.24]);
  beam(B.steer, 'tape', [-0.21, bar[1], bar[2]], [0.21, bar[1], bar[2]], 0.040);
  if (medium) {
    box(B.bike, 'bottle', [0, 0.53, 0.19], [0.064, 0.15, 0.064], -0.68);
    box(B.bike, 'carbon', [0, 0.595, 0.14], [0.052, 0.033, 0.052], -0.68);
  }
  if (fine) {
    box(B.steer, 'glassesFrame', [0, 0.925, 0.594], [0.059, 0.030, 0.083]);
    box(B.steer, 'metal', [0, 0.943, 0.593], [0.043, 0.006, 0.050]);
  }
  for (const s of [-1, 1]) {
    const rear: V3 = [s * 0.075, BIKE.rearAxle[1], BIKE.rearAxle[2]];
    beam(B.bike, 'frame', bb, rear, 0.034);
    beam(B.bike, 'frame', seatTop, rear, 0.034);
    beam(B.steer, 'frameAccent', headBottom, [s * 0.055, BIKE.frontAxle[1], BIKE.frontAxle[2]], 0.044);
    beam(B.steer, 'tape', [s * 0.21, bar[1], bar[2]], [s * 0.21, 0.905, 0.69], 0.045);
    box(B.steer, 'hood', [s * 0.21, 0.887, 0.685], [0.05, 0.09, 0.065]);
    box(B.steer, 'tape', [s * 0.21, 0.84, 0.63], [0.044, 0.046, 0.11]);
    const right = s < 0;
    beam(B.crank, 'metal', [s * 0.068, 0, 0], [s * 0.11, -s * BIKE.crank, 0], 0.031);
    box(right ? B.pedalR : B.pedalL, 'pedal', [0, 0, 0], [0.091, 0.018, 0.076]);
    const thigh = right ? B.thighR : B.thighL, shin = right ? B.shinR : B.shinL;
    box(thigh, 'shorts', [0, -0.115, 0], [0.153, 0.25, 0.165]);
    if (medium) box(thigh, 'shortsHem', [0, -0.236, 0], [0.15, 0.035, 0.162]);
    box(thigh, 'skin', [0, -0.334, 0], [0.128, 0.204, 0.136]);
    box(shin, 'skin', [0, -0.119, 0], [0.11, 0.25, 0.122]);
    box(shin, 'sock', [0, -0.332, 0], [0.101, BODY.shin - 0.235, 0.105]);
    if (medium) box(shin, 'sockCuff', [0, -0.25, 0], [0.104, 0.028, 0.108]);
    const foot = right ? B.footR : B.footL;
    box(foot, 'shoe', [0, -0.04, 0.07], [0.106, 0.09, 0.215]);
    box(foot, 'sole', [0, -0.086, 0.07], [0.11, 0.016, 0.219]);
    if (fine) box(foot, 'shoeAccent', [0, 0.007, 0.09], [0.101, 0.008, 0.027]);

    const upper = right ? B.upperArmR : B.upperArmL;
    box(upper, ATLAS.sleeve, [0, -0.088, 0], [0.137, 0.203, 0.148]);
    box(upper, 'skin', [0, -0.242, 0], [0.109, 0.122, 0.113]);
    box(right ? B.forearmR : B.forearmL, 'skin', [0, -0.13, 0], [0.095, BODY.forearm, 0.102]);
    box(right ? B.handR : B.handL, 'gloveBack', [0, 0.012, -0.014], [0.088, 0.065, 0.105]);
  }

  box(B.pelvis, 'shorts', [0, 0.055, 0.008], [0.32, 0.18, 0.21], 0.60);
  box(B.chest, jersey, [0, 0.113, 0.156], [0.368, 0.44, 0.226], 0.90);
  box(B.chest, backPrint, [0, 0.199, 0.086], [0.351, 0.42, 0.012], 0.90);
  box(B.chest, 'skin', [0, 0.277, 0.37], [0.136, 0.135, 0.148], 0.65);
  box(B.head, 'skin', [0, 0.069, 0.06], [0.209, 0.181, 0.201]);
  box(B.head, 'hair', [0, 0.096, -0.045], [0.21, 0.082, 0.033]);
  box(B.head, 'strap', [0, 0.151, 0.058], [0.245, 0.060, 0.25]);
  box(B.head, helmet, [0, 0.193, 0.053], [0.272, 0.083, 0.293]);
  box(B.head, helmet, [0, 0.249, 0.053], [0.224, 0.034, 0.243]);
  box(B.head, jersey, [0, 0.27, 0.053], [0.054, 0.011, 0.241]);
  box(B.glasses, 'lens', [0, 0.103, 0.165], [0.218, 0.062, 0.021]);
  for (const side of [-1, 1]) {
    box(B.head, 'eye', [side * 0.054, 0.105, 0.163], [0.028, 0.025, 0.011]);
    if (medium) {
      box(B.head, 'strap', [side * 0.107, 0.098, 0.036], [0.012, 0.101, 0.024]);
      box(B.head, 'carbon', [side * 0.080, 0.268, 0.055], [0.026, 0.008, 0.116]);
      box(B.glasses, 'glassesFrame', [side * 0.107, 0.115, 0.097], [0.013, 0.021, 0.142]);
    }
  }
  const g = mergeParts(parts);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  cache.set(key, g);
  return g;
}
