import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildingCamera, riderBlocked } from '@/open/buildingCamera';
import { boxVolume } from '@/open/labels';
import { frameRider } from '@/world/isometric';
import type { TrackPose } from '@/domain/track';

const pose: TrackPose = { x: 0, y: 0, z: 0, heading: 0, grade: 0, altitude: 0, distance: 0 };
const ground = () => 0;
const street = [boxVolume(-6, 0, 6, 80, 0, -1, 18), boxVolume(6, 0, 6, 80, 0, -1, 18)];

describe('camera isometrica fra gli edifici', () => {
  it('si allinea al vicolo quando la diagonale nasconde il ciclista dietro le case', () => {
    const camera = new THREE.OrthographicCamera(), target = new THREE.Vector3();
    frameRider(camera, pose, 0, 600, target, ground);
    expect(riderBlocked(camera, target, pose, street)).toBe(true);
    buildingCamera()(camera, pose, 0, 600, target, ground, street);
    expect(riderBlocked(camera, target, pose, street)).toBe(false);
    expect(Math.abs(camera.position.x)).toBeLessThan(3);
  });

  it('sale sopra un cortile se tutte le viste oblique sono coperte', () => {
    const walls = [...street.map(v => ({ ...v, y1: 40 })), boxVolume(0, -6, 6, 6, 0, -1, 40), boxVolume(0, 6, 6, 6, 0, -1, 40)];
    const camera = new THREE.OrthographicCamera(), target = new THREE.Vector3();
    buildingCamera()(camera, pose, 0, 600, target, ground, walls);
    expect(riderBlocked(camera, target, pose, walls)).toBe(false);
    expect(camera.position.y).toBeGreaterThan(40);
  });

  it('preserva la vista manuale e aggiorna la scelta quando arrivano nuovi edifici', () => {
    const frame = buildingCamera();
    const camera = new THREE.OrthographicCamera(), target = new THREE.Vector3();
    const manual = new THREE.OrthographicCamera(), manualTarget = new THREE.Vector3();
    frame(camera, pose, 0, 600, target, ground, []);
    frame(camera, pose, 0, 600, target, ground, street);
    expect(riderBlocked(camera, target, pose, street)).toBe(false);
    frame(camera, pose, 0, 600, target, ground, street, -10, 4);
    frameRider(manual, pose, 0, 600, manualTarget, ground, -10, 4);
    expect(camera.position.toArray()).toEqual(manual.position.toArray());
    expect(camera.quaternion.toArray()).toEqual(manual.quaternion.toArray());
  });
});
