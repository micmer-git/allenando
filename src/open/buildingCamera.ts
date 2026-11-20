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
      if (x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ
        && y < v.y1 && y + dy > v.y0 && insideRing(v.ring, x, z)) return true;
    }
  }
  return false;
}

/** La vista sicura si conserva; si torna alla diagonale solo dopo un tratto libero.
 * Lo scostamento dal ciclista converge nel tempo, senza trascinarlo fuori dal quadro. */
export function buildingCamera() {
  let lastX = Infinity, lastY = Infinity, lastZ = Infinity, lastHeading = Infinity;
  let previous: readonly Volume[] | null = null;
  let selected = 0, pending = -1, clearFor = 0, checkIn = 0;
  let initialized = false;
  const lastPose = new THREE.Vector3(Infinity, Infinity, Infinity);
  const offset = new THREE.Vector3(), desired = new THREE.Vector3(), start = new THREE.Vector3();
  return (camera: THREE.OrthographicCamera, pose: TrackPose, heading: number, height: number,
    target: THREE.Vector3, ground: (x: number, z: number, stride: number) => number,
    volumes: readonly Volume[], yaw = 0, pitch = 0, tunnel = false, dt = 1 / 60, magnification = 1) => {
    if (tunnel || Math.abs(yaw) > .001 || Math.abs(pitch) > .001) {
      previous = null;
      initialized = false;
      pending = -1; clearFor = 0;
      frameRider(camera, pose, heading, height, target, ground, yaw, pitch, tunnel, magnification);
      return;
    }
    const step = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .1) : 0;
    const snap = !initialized || (pose.x - lastPose.x) ** 2 + (pose.z - lastPose.z) ** 2 > 144 || Math.abs(pose.y - lastPose.y) > 8;
    lastPose.set(pose.x, pose.y, pose.z);
    if (snap) { selected = 0; pending = -1; clearFor = 0; }
    let placed = -1;
    const place = (index: number) => {
      if (placed === index) return;
      placed = index;
      const [viewYaw, viewPitch] = VIEWS[Math.min(index, VIEWS.length - 1)];
      frameRider(camera, pose, heading, height, target, ground, viewYaw, viewPitch, false, magnification);
      if (index === VIEWS.length) {
        // Vicoli curvi e cortili stretti: vista quasi verticale, senza tagliare le case.
        let lift = Math.max(24, camera.position.y - target.y);
        for (const v of volumes) if (v.minX < pose.x + 25 && v.maxX > pose.x - 25 && v.minZ < pose.z + 25 && v.maxZ > pose.z - 25) lift = Math.max(lift, v.y1 - target.y + 3);
        camera.position.set(target.x - Math.sin(heading) * .02, target.y + Math.min(180, lift), target.z - Math.cos(heading) * .02);
        camera.lookAt(target);
      }
    };
    place(selected);
    if (riderBlocked(camera, target, pose, volumes)) {
      // Una parete nuova ha priorità sull'inerzia, anche fra due controlli distanti 2 m.
      for (selected = 0; selected < VIEWS.length; selected++) {
        place(selected);
        if (!riderBlocked(camera, target, pose, volumes)) break;
      }
      pending = -1; clearFor = 0;
    }
    checkIn -= step;
    const turn = Math.abs(Math.atan2(Math.sin(heading - lastHeading), Math.cos(heading - lastHeading)));
    if (selected > 0 && (checkIn <= 0 || previous !== volumes || (pose.x - lastX) ** 2 + (pose.z - lastZ) ** 2 > 4 || Math.abs(pose.y - lastY) > 1.5 || turn > Math.PI / 30)) {
      previous = volumes;
      lastX = pose.x; lastY = pose.y; lastZ = pose.z; lastHeading = heading;
      checkIn = .2;
      let preferred = -1;
      for (let index = 0; index < selected; index++) {
        place(index);
        if (!riderBlocked(camera, target, pose, volumes)) { preferred = index; break; }
      }
      if (preferred !== pending) clearFor = 0;
      pending = preferred;
    }
    if (pending >= 0) {
      clearFor += step;
      if (clearFor >= 1.2) {
        place(pending);
        if (!riderBlocked(camera, target, pose, volumes)) selected = pending;
        pending = -1; clearFor = 0;
      }
    }
    place(selected);
    desired.subVectors(camera.position, target);
    if (snap || offset.distanceToSquared(desired) < 1e-8) offset.copy(desired);
    else {
      start.copy(target).add(offset);
      offset.lerp(desired, 1 - Math.exp(-step * 4.5));
      camera.position.copy(target).add(offset);
      // Anche una posizione intermedia deve lasciare libera la linea sopra il versante.
      for (let sample = 1; sample <= 5; sample++) {
        const u = sample / 5;
        const terrain = ground(target.x + offset.x * u, target.z + offset.z * u, 4);
        camera.position.y = Math.max(camera.position.y, target.y + (terrain + 1.2 - target.y) / u);
      }
      const end = camera.position;
      const crossesWall = volumes.some(v =>
        volumeBlocks(start.x, start.y, start.z, end.x, end.y, end.z, v)
        || volumeBlocks(end.x, end.y, end.z, start.x, start.y, start.z, v)
        || (start.x >= v.minX && start.x <= v.maxX && start.z >= v.minZ && start.z <= v.maxZ
          && end.x >= v.minX && end.x <= v.maxX && end.z >= v.minZ && end.z <= v.maxZ
          && Math.min(start.y, end.y) < v.y1 && Math.max(start.y, end.y) > v.y0
          && insideRing(v.ring, start.x, start.z) && insideRing(v.ring, end.x, end.z)));
      if (crossesWall || riderBlocked(camera, target, pose, volumes)) camera.position.copy(target).add(desired);
      offset.subVectors(camera.position, target);
      camera.lookAt(target);
    }
    initialized = true;
  };
}
