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

  it('attende un tratto libero stabile e poi torna gradualmente alla diagonale', () => {
    const frame = buildingCamera();
    const camera = new THREE.OrthographicCamera(), target = new THREE.Vector3();
    const standard = new THREE.OrthographicCamera(), standardTarget = new THREE.Vector3();
    const empty: typeof street = [];
    frame(camera, pose, 0, 600, target, ground, street);
    const sheltered = camera.position.clone();
    frameRider(standard, pose, 0, 600, standardTarget, ground);
    for (let n = 0; n < 60; n++) frame(camera, pose, 0, 600, target, ground, empty, 0, 0, false, 1 / 60);
    expect(camera.position.distanceTo(sheltered)).toBeLessThan(1e-8);
    for (let n = 0; n < 24; n++) frame(camera, pose, 0, 600, target, ground, empty, 0, 0, false, 1 / 60);
    expect(camera.position.distanceTo(sheltered)).toBeGreaterThan(.5);
    expect(camera.position.distanceTo(standard.position)).toBeGreaterThan(.5);
    for (let n = 0; n < 180; n++) frame(camera, pose, 0, 600, target, ground, empty, 0, 0, false, 1 / 60);
    expect(camera.position.distanceTo(standard.position)).toBeLessThan(.001);
  });

  it('non oscilla fra le case quando la diagonale si libera per meno di un secondo', () => {
    const frame = buildingCamera();
    const camera = new THREE.OrthographicCamera(), target = new THREE.Vector3();
    const empty: typeof street = [];
    frame(camera, pose, 0, 600, target, ground, street);
    const sheltered = camera.position.clone();
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let n = 0; n < 45; n++) frame(camera, pose, 0, 600, target, ground, empty, 0, 0, false, 1 / 60);
      frame(camera, pose, 0, 600, target, ground, street, 0, 0, false, 1 / 60);
      expect(camera.position.distanceTo(sheltered)).toBeLessThan(1e-8);
    }
  });

  it('verifica ogni fotogramma mentre si esce da un vicolo, mantenendo la bici nel quadro', () => {
    const frame = buildingCamera();
    const camera = new THREE.OrthographicCamera(-195, 195, 180, -180, .1, 240), target = new THREE.Vector3();
    for (let n = 0; n < 360; n++) {
      const rider = { ...pose, z: n * .25 };
      frame(camera, rider, 0, 360, target, ground, street, 0, 0, false, 1 / 60);
      expect(riderBlocked(camera, target, rider, street)).toBe(false);
      camera.updateMatrixWorld(true);
      for (const y of [0, 1.8]) {
        const point = new THREE.Vector3(rider.x, rider.y + y, rider.z).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(.98);
        expect(Math.abs(point.y)).toBeLessThan(.98);
      }
    }
  });

  it('smorza nello stesso modo a 30 e 120 fps e conserva la linea sopra il terreno', () => {
    const cameras = [30, 120].map(fps => {
      const frame = buildingCamera();
      const camera = new THREE.OrthographicCamera(), target = new THREE.Vector3();
      const slope = (x: number) => Math.max(0, -x * .9);
      const empty: typeof street = [];
      frame(camera, pose, 0, 600, target, slope, empty);
      for (let n = 0; n < fps; n++) {
        frame(camera, pose, .7, 600, target, slope, empty, 0, 0, false, 1 / fps);
        for (let sample = 1; sample <= 5; sample++) {
          const point = target.clone().lerp(camera.position, sample / 5);
          expect(point.y).toBeGreaterThanOrEqual(slope(point.x) + 1.2 - 1e-8);
        }
      }
      return camera;
    });
    expect(cameras[0].position.distanceTo(cameras[1].position)).toBeLessThan(.02);
  });

  it('salta subito alla nuova posizione dopo un teleport e conserva la camera in galleria', () => {
    const frame = buildingCamera();
    const camera = new THREE.OrthographicCamera(), target = new THREE.Vector3();
    const expected = new THREE.OrthographicCamera(), expectedTarget = new THREE.Vector3();
    const empty: typeof street = [];
    frame(camera, pose, 0, 600, target, ground, street);
    const jumped = { ...pose, x: 100, y: 30, z: 200, heading: 1 };
    frame(camera, jumped, 1, 600, target, ground, empty, 0, 0, false, 1 / 60);
    frameRider(expected, jumped, 1, 600, expectedTarget, ground);
    expect(camera.position.toArray()).toEqual(expected.position.toArray());
    frame(camera, jumped, 1, 600, target, ground, empty, 0, 0, true, 1 / 60);
    frameRider(expected, jumped, 1, 600, expectedTarget, ground, 0, 0, true);
    expect(camera.position.toArray()).toEqual(expected.position.toArray());
    expect(camera.quaternion.toArray()).toEqual(expected.quaternion.toArray());
    expect(camera.zoom).toBe(expected.zoom);
  });
});
