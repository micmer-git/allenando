import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { volumeBlocks, type Volume } from '@/open/labels';
import type { Track, TrackPose } from '@/domain/track';

/** L'azimut segue la strada con inerzia; a velocità diverse la bici resta ferma nel quadro. */
export function followBearing(heading: number, goal: number, dt: number) {
  const delta = Math.atan2(Math.sin(goal - heading), Math.cos(goal - heading));
  return heading + delta * (1 - Math.exp(-dt * 2.65));
}

/** La corda del tratto che si sta per percorrere anticipa la curva anche in discesa. */
export function bendHeading(track: Track, pose: TrackPose, speed: number) {
  const cursor = pose.distance;
  const ahead = THREE.MathUtils.clamp(7 + speed * 0.85, 7, 22);
  const a = track.poseAt(cursor);
  const b = track.poseAt(track.closed ? (cursor + ahead) % track.length : Math.min(cursor + ahead, track.length));
  if (Math.hypot(b.x - a.x, b.z - a.z) < 0.5) return pose.heading;
  const delta = Math.atan2(b.x - a.x, b.z - a.z) - pose.heading;
  return pose.heading + THREE.MathUtils.clamp(Math.atan2(Math.sin(delta), Math.cos(delta)), -Math.PI / 8, Math.PI / 8);
}

export function frameRider(camera: THREE.OrthographicCamera, pose: TrackPose, heading: number, height: number,
  target: THREE.Vector3, ground: (x: number, z: number, stride: number) => number, yaw = 0, pitch = 0, tunnel = false, magnification = 1) {
  // La strada attraversa il quadro in diagonale. Il margine davanti serve per leggere le curve.
  const azimuth = heading + (tunnel ? 0 : Math.PI / 4) - yaw * Math.PI / 180;
  const elevation = THREE.MathUtils.degToRad(tunnel ? 12 : THREE.MathUtils.clamp(32 - pitch, 16, 72));
  const boom = tunnel ? 5 : 22;
  target.set(pose.x + Math.sin(heading) * 1.7, pose.y + 0.85, pose.z + Math.cos(heading) * 1.7);
  camera.position.set(target.x - Math.sin(azimuth) * boom * Math.cos(elevation),
    target.y + boom * Math.sin(elevation), target.z - Math.cos(azimuth) * boom * Math.cos(elevation));
  if (!tunnel) {
    // Nei tornanti il versante può stare fra camera e bici anche quando la camera è fuori terra.
    const dx = camera.position.x - target.x;
    const dz = camera.position.z - target.z;
    for (let step = 1; step <= 5; step++) {
      const u = step / 5;
      const terrain = ground(target.x + dx * u, target.z + dz * u, 4);
      camera.position.y = Math.max(camera.position.y, target.y + (terrain + 1.2 - target.y) / u);
    }
  }
  const span = (tunnel ? 5 : THREE.MathUtils.clamp(height / 24, 17, 30)) / magnification;
  const zoom = height / span;
  if (zoom !== camera.zoom) {
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(target);
}

export type RideView = 'iso' | 'chase';
export const ISO_ZOOM = [0.65, 0.8, 1, 1.3, 1.7, 2.2] as const;

/** Camera dietro la bici. Accorcia il braccio in un vicolo e segue il pendio nei tornanti. */
export function chaseRider(camera: THREE.PerspectiveCamera, pose: TrackPose, heading: number,
  target: THREE.Vector3, ground: (x: number, z: number, stride: number) => number,
  volumes: readonly Volume[] = [], tunnel = false, bridge = false, yaw = 0, pitch = 0) {
  const bearing = heading - THREE.MathUtils.degToRad(yaw);
  const dx = Math.sin(bearing), dz = Math.cos(bearing);
  const eye = pose.y + 1.3;
  let back = tunnel ? 4.4 : 8.2;
  for (;;) {
    let cameraY = eye + (tunnel ? 0.7 : 2.5);
    if (!tunnel && !bridge) {
      for (let i = 1; i <= 5; i++) {
        const u = i / 5;
        const y = ground(pose.x - dx * back * u, pose.z - dz * back * u, 4);
        cameraY = Math.max(cameraY, eye + (y + 0.65 - eye) / u);
      }
    }
    camera.position.set(pose.x - dx * back, cameraY, pose.z - dz * back);
    if (back < 1.2 || !volumes.some(v => volumeBlocks(camera.position.x, cameraY, camera.position.z, pose.x, eye, pose.z, v))) break;
    back *= 0.65;
  }
  const ahead = tunnel ? 3 : 5;
  target.set(pose.x + dx * ahead, eye + ahead * (pose.grade + Math.tan(THREE.MathUtils.degToRad(pitch))),
    pose.z + dz * ahead);
  camera.lookAt(target);
}

type Block = [number, number, number, number, number, number];
function cluster(blocks: Block[]) {
  const boxes = blocks.map(([x,y,z,w,h,d], index) => {
    const box = new THREE.BoxGeometry(w,h,d).translate(x,y,z);
    const normal = box.getAttribute('normal');
    const color = new Float32Array(normal.count * 3);
    // Il rilievo resta leggibile anche nella qualità senza ombre. I colori neutri
    // moltiplicano la tinta dell'istanza: nessuna texture o materiale per singola foglia.
    const variation = 0.96 + ((index * 7) % 5) * 0.015;
    for (let i = 0; i < normal.count; i++) {
      const shade = normal.getY(i) > 0 ? 1.06 : normal.getY(i) < 0 ? 0.72
        : normal.getX(i) > 0 ? 0.92 : normal.getZ(i) > 0 ? 0.98 : 0.86;
      color.fill(shade * variation, i * 3, i * 3 + 3);
    }
    box.setAttribute('color', new THREE.BufferAttribute(color, 3));
    return box;
  });
  const geometry = mergeGeometries(boxes, false)!;
  boxes.forEach(g => g.dispose());
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Un palco di aghi: il centro e quattro branche sfalsate lasciano leggere il vuoto
 * sotto ogni gradino. La sagoma esterna conserva le misure usate dallo scatter. */
function needleTier(y: number, width: number, height: number, offset = 0): Block[] {
  const core = width * 0.64;
  const wing = width * 0.24;
  const side = (width - wing) / 2;
  return [
    [offset,y,0,core,height,core],
    [-side,y - height * 0.16,0,wing,height * 0.62,width * 0.58],
    [side,y - height * 0.04,0.13,wing,height * 0.78,width * 0.48],
    [0.10,y - height * 0.10,-side,width * 0.53,height * 0.70,wing],
    [-0.10,y - height * 0.20,side,width * 0.63,height * 0.58,wing],
  ];
}

/** Piccole sculture a blocchi, una geometria istanziata per specie. Tutte le
 * varianti restano sotto 320 triangoli: il dettaglio non aggiunge draw call. */
export function voxelTrees() {
  return {
    spruce: cluster([
      ...needleTier(3.30,4.8,1.6), ...needleTier(4.95,3.9,1.5,-0.12),
      ...needleTier(6.55,3.0,1.5,0.08), ...needleTier(8.05,2.0,1.4),
      [0,9.30,0,1.02,1.2,1.02], [0.06,10.05,-0.04,0.48,0.65,0.48],
    ]),
    larch: cluster([
      ...needleTier(3.8,4.3,1.15), ...needleTier(5.45,3.25,1.15,-0.12),
      ...needleTier(6.95,2.35,1.15,0.1),
      [0.1,8.15,0.08,1.3,1.1,1.25], [0.1,8.95,0.08,0.65,0.65,0.65],
    ]),
    broadleaf: cluster([
      [0,4.25,0,3.4,2.0,3.15], [-1.6,4.75,-0.45,1.65,1.65,2.4],
      [1.7,5.05,0.45,1.9,1.8,2.65], [-0.25,4.65,1.7,2.6,1.45,1.0],
      [0.55,5.1,-1.65,2.3,1.6,1.25], [-0.8,6.0,-0.35,2.25,1.65,2.85],
      [1.1,6.25,0.75,2.0,1.35,2.1], [-1.7,6.05,-0.7,1.25,1.0,1.4],
      [0.0,6.55,-1.3,1.6,1.1,1.5], [0.15,7.15,0.0,2.1,1.1,2.15],
      [-0.6,7.65,-0.35,1.25,0.55,1.1], [1.75,6.5,0.35,0.65,0.65,1.2],
      [-0.9,5.65,1.7,1.25,0.8,0.8], [0.75,7.65,0.4,0.8,0.5,0.95],
    ]),
    cypress: cluster([
      [0,3.1,0,1.6,3.35,1.7], [0,5.55,0,1.8,1.8,1.85],
      [-0.12,7.2,0.08,1.45,1.6,1.55], [0.04,8.55,0,1.15,1.35,1.2],
      [0.08,9.65,0,0.65,1.1,0.75], [0.08,10.35,0,0.3,0.45,0.35],
      [-0.82,4.1,0.1,0.35,1.4,0.8], [0.8,5.8,-0.1,0.3,1.05,0.7],
      [0.15,6.25,0.85,0.7,0.8,0.3], [-0.2,7.9,-0.65,0.55,0.65,0.3],
    ]),
    trunk: cluster([
      [0,1.9,0,0.48,4,0.48], [0,0.12,0,0.8,0.38,0.75],
      [-0.35,0.02,0.08,0.55,0.22,0.25], [0.30,0.04,-0.15,0.48,0.25,0.27],
      [-0.35,3.05,0,0.55,0.28,0.28], [-0.58,3.32,0,0.24,0.60,0.24],
      [0.34,3.6,0.12,0.55,0.25,0.28], [0.57,3.82,0.12,0.22,0.5,0.24],
    ]),
    rock: cluster([
      [-0.1,0.11,0.05,2.15,0.62,1.75], [0.04,0.58,-0.1,1.8,0.4,1.55],
      [0.2,0.91,-0.16,1.25,0.28,1.05], [-0.75,0.40,0.2,0.65,0.38,0.85],
      [0.75,0.36,-0.45,0.65,0.28,0.65], [0.15,1.07,-0.2,0.65,0.08,0.6],
      [-0.7,-0.08,0.68,0.55,0.22,0.48],
    ]),
  };
}

export function pixelTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
