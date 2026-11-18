import * as THREE from 'three';
import type { TrackPose } from '@/domain/track';
import { frameRider } from '@/world/isometric';
import { insideRing, volumeBlocks, type Volume } from './labels';

// Prima si conserva la diagonale, poi ci si allinea alla strada, infine si sale.
const VIEWS = [[0, 0], [22.5, -10], [45, -15], [45, -28], [90, -28], [0, -32]] as const;

/** In ortografica i raggi sono paralleli: partono sopra ciascun punto della bici,
 * con lo stesso scostamento camera-target, non tutti dal centro della camera. */
export function riderBlocked(camera: THREE.OrthographicCamera, target: THREE.Vector3, pose: TrackPose, volumes: readonly Volume[]): boolean {
  const dx = camera.position.x - target.x, dy = camera.position.y - target.y, dz = camera.position.z - target.z;
  for (const side of [-.4, 0, .4]) {
    const x = pose.x + Math.cos(pose.heading) * side;
    const z = pose.z - Math.sin(pose.heading) * side;
    const y = pose.y + (side === 0 ? 1 : .45);
    for (const v of volumes) {
      if (volumeBlocks(x + dx, y + dy, z + dz, x, y, z, v)) return true;
      // volumeBlocks è nato per le etichette e ignora il loro edificio ospite:
      // per il ciclista conta anche una copertura attraversata dall'alto.
      if (y < v.y1 && y + dy > v.y0 && insideRing(v.ring, x, z)) return true;
    }
  }
  return false;
}

/** Scelta dell'inquadratura solo dopo 2 m, 6° o l'arrivo di nuovi edifici. */
export function buildingCamera() {
  let lastX = Infinity, lastY = Infinity, lastZ = Infinity, lastHeading = Infinity;
  let previous: readonly Volume[] | null = null;
  let selected = 0;
  return (camera: THREE.OrthographicCamera, pose: TrackPose, heading: number, height: number,
    target: THREE.Vector3, ground: (x: number, z: number, stride: number) => number,
    volumes: readonly Volume[], yaw = 0, pitch = 0, tunnel = false) => {
    if (tunnel || Math.abs(yaw) > .001 || Math.abs(pitch) > .001) {
      previous = null;
      frameRider(camera, pose, heading, height, target, ground, yaw, pitch, tunnel);
      return;
    }
    const place = (index: number) => {
      const [viewYaw, viewPitch] = VIEWS[Math.min(index, VIEWS.length - 1)];
      frameRider(camera, pose, heading, height, target, ground, viewYaw, viewPitch);
      if (index === VIEWS.length) {
        // Vicoli curvi e cortili stretti: vista quasi verticale, senza tagliare le case.
        let lift = Math.max(24, camera.position.y - target.y);
        for (const v of volumes) if (v.minX < pose.x + 25 && v.maxX > pose.x - 25 && v.minZ < pose.z + 25 && v.maxZ > pose.z - 25) lift = Math.max(lift, v.y1 - target.y + 3);
        camera.position.set(target.x - Math.sin(heading) * .02, target.y + Math.min(180, lift), target.z - Math.cos(heading) * .02);
        camera.lookAt(target);
      }
    };
    const turn = Math.abs(Math.atan2(Math.sin(heading - lastHeading), Math.cos(heading - lastHeading)));
    if (previous !== volumes || (pose.x - lastX) ** 2 + (pose.z - lastZ) ** 2 > 4 || Math.abs(pose.y - lastY) > 1.5 || turn > Math.PI / 30) {
      previous = volumes;
      lastX = pose.x; lastY = pose.y; lastZ = pose.z; lastHeading = heading;
      for (selected = 0; selected < VIEWS.length; selected++) {
        place(selected);
        if (!riderBlocked(camera, target, pose, volumes)) return;
      }
    }
    place(selected);
  };
}
