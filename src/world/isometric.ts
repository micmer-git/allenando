import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackPose } from '@/domain/track';

/** L'azimut segue la strada con inerzia; a velocità diverse la bici resta ferma nel quadro. */
export function followBearing(heading: number, goal: number, dt: number) {
  const delta = Math.atan2(Math.sin(goal - heading), Math.cos(goal - heading));
  return heading + delta * (1 - Math.exp(-dt * 2.65));
}

export function frameRider(camera: THREE.OrthographicCamera, pose: TrackPose, heading: number, height: number,
  target: THREE.Vector3, ground: (x: number, z: number, stride: number) => number, yaw = 0, pitch = 0, tunnel = false) {
  // La strada attraversa il quadro in diagonale. Il margine davanti serve per leggere le curve.
  const azimuth = heading + (tunnel ? 0 : Math.PI / 4) - yaw * Math.PI / 180;
  const elevation = THREE.MathUtils.degToRad(tunnel ? 12 : THREE.MathUtils.clamp(40 - pitch, 19, 72));
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
  const span = tunnel ? 5 : THREE.MathUtils.clamp(height / 30, 14, 24);
  const zoom = height / span;
  if (zoom !== camera.zoom) {
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(target);
}

type Block = [number, number, number, number, number, number];
function cluster(blocks: Block[]) {
  const boxes = blocks.map(([x,y,z,w,h,d]) => new THREE.BoxGeometry(w,h,d).translate(x,y,z));
  const geometry = mergeGeometries(boxes)!;
  boxes.forEach(g => g.dispose());
  return geometry;
}

/** Bordi a gradoni e sagome distinguibili anche senza ombre. Una geometria istanziata per specie. */
export function voxelTrees() {
  return {
    spruce: cluster([[0,3.6,0,4.8,2.5,4.8],[0,6.1,0,3.4,2.5,3.4],[0,8.2,0,2.2,1.8,2.2],[0,9.8,0,1,1.4,1]]),
    larch: cluster([[0,4.1,0,4.3,2,4.1],[-0.3,6,0,3,2,3.1],[0.1,8,0.2,1.6,2,1.8]]),
    broadleaf: cluster([[0,5,0,4.8,3.6,4.2],[-1.3,6.5,-0.4,2.7,2.1,3.7],[1.6,5.7,0.8,2.4,2.7,3.2],[0.4,7.5,0.1,2.7,1.4,2.6]]),
    cypress: cluster([[0,4.8,0,1.9,6.8,2],[0,9.1,0,1.2,2.2,1.3]]),
    trunk: new THREE.BoxGeometry(0.55,4,0.55).translate(0,1.9,0),
    rock: cluster([[0,0.3,0,2.2,1.1,1.8],[0.2,0.97,-0.1,1.5,0.35,1.1]]),
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
