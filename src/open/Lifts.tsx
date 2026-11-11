import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackPose } from '@/domain/track';
import { buildLifts, STATION, type LiftBuild } from './impianti';
import { Mesh } from './tiles';
import type { Terrain, WorldData } from './world';

/*
 * Gli impianti di risalita in scena: piloni (traliccio a due colori, un'istanza), cavo (linee),
 * cabine ferme (un'istanza, colorate), stazioni (scatole col tetto, colori di vertice). Si
 * costruiscono per gli impianti entro LIFT_R dal ciclista e si rifanno quando si è spostato di
 * LIFT_MOVE: in Val Seriana ce ne sono un centinaio, nelle Dolomiti di più, e a 6 km un pilone
 * non è un pixel. Niente animazione.
 */

const LIFT_R = 6000;
const LIFT_MOVE = 1500;

const CABIN_TINTS = ['#c8362e', '#e9e5dc', '#2d5fa8', '#d9a52a', '#e9e5dc'];

/**
 * Il traliccio: quattro montanti sottili che si stringono verso l'alto (base 1,4 m, cima 0,8), tre
 * ordini di traverse e una diagonale per campo su ogni faccia; alto 1, si scala. Si vede il cielo
 * attraverso, come nelle foto (passo-sella-55150019); un'istanza sola per tutti i piloni.
 */
export function towerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const b = 0.7;
  const t = 0.4;
  const corner = (k: number, y: number): THREE.Vector3 => {
    const r = b + (t - b) * y;
    const sx = k === 0 || k === 3 ? -1 : 1;
    const sz = k < 2 ? -1 : 1;
    return new THREE.Vector3(sx * r, y, sz * r);
  };
  const up = new THREE.Vector3(0, 1, 0);
  const bar = (a: THREE.Vector3, c: THREE.Vector3, w: number) => {
    const d = c.clone().sub(a);
    // un prisma a tre facce senza tappi (6 triangoli, una scatola ne ha 12): a mille piloni per
    // mondo il traliccio costa così 168 triangoli l'uno
    const g = new THREE.CylinderGeometry(w * 0.62, w * 0.62, d.length(), 3, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize()));
    g.translate((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2);
    parts.push(g);
  };
  for (let k = 0; k < 4; k++) bar(corner(k, 0), corner(k, 1), 0.11);
  const levels = [0.34, 0.67, 1];
  for (const y of levels) for (let k = 0; k < 4; k++) bar(corner(k, y), corner((k + 1) % 4, y), 0.07);
  let y0 = 0;
  for (const y1 of levels) {
    for (let k = 0; k < 4; k++) bar(corner(k, y0), corner((k + 1) % 4, y1), 0.05);
    y0 = y1;
  }
  const out = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return out;
}

export function Lifts({ data, terrain, playerPose }: { data: WorldData; terrain: Terrain; playerPose: () => TrackPose }) {
  const group = useRef<THREE.Group>(null);
  const at = useRef<[number, number] | null>(null);
  const clock = useRef(0);
  const mats = useMemo(
    () => ({
      tower: new THREE.MeshLambertMaterial({ color: '#8f959c' }),
      arm: new THREE.MeshLambertMaterial({ color: '#3f444b' }),
      cable: new THREE.LineBasicMaterial({ color: '#2a2d31' }),
      cabin: new THREE.MeshLambertMaterial(),
      station: new THREE.MeshLambertMaterial({ vertexColors: true }),
    }),
    [],
  );
  const geos = useMemo(() => {
    const arm = new THREE.BoxGeometry(4.2, 0.35, 0.5);
    arm.translate(0, 0.17, 0);
    const cabin = new THREE.BoxGeometry(1.8, 2.2, 1.9);
    cabin.translate(0, 1.1, 0);
    return { tower: towerGeometry(), arm, cabin };
  }, []);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      Object.values(geos).forEach((g) => g.dispose());
    },
    [mats, geos],
  );
  const rebuild = (px: number, pz: number) => {
    const g = group.current;
    if (!g) return;
    for (const o of [...g.children]) {
      g.remove(o);
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    }
    const built: LiftBuild = buildLifts(
      data.features.cables,
      (x, z) => Math.abs(x - px) < LIFT_R && Math.abs(z - pz) < LIFT_R,
      (x, z) => terrain.height(x, z),
    );
    if (built.lines === 0) return;
    const d = new THREE.Object3D();
    if (built.pylons.length) {
      const towers = new THREE.InstancedMesh(geos.tower, mats.tower, built.pylons.length);
      const arms = new THREE.InstancedMesh(geos.arm, mats.arm, built.pylons.length);
      built.pylons.forEach((p, i) => {
        d.position.set(p.x, p.y - 0.8, p.z);
        d.rotation.set(0, p.h, 0);
        d.scale.set(p.kind === 'skilift' ? 0.5 : 1, p.height + 0.8, p.kind === 'skilift' ? 0.5 : 1);
        d.updateMatrix();
        towers.setMatrixAt(i, d.matrix);
        d.position.y = p.y + p.height;
        d.scale.set(p.kind === 'skilift' ? 0.4 : 1, 1, 1);
        d.updateMatrix();
        arms.setMatrixAt(i, d.matrix);
      });
      towers.computeBoundingSphere();
      arms.computeBoundingSphere();
      g.add(towers, arms);
    }
    if (built.cable.length) {
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(built.cable, 3));
      g.add(new THREE.LineSegments(cg, mats.cable));
    }
    if (built.cabins.length) {
      const cabins = new THREE.InstancedMesh(geos.cabin, mats.cabin, built.cabins.length);
      const c = new THREE.Color();
      built.cabins.forEach((cb, i) => {
        d.position.set(cb.x, cb.y, cb.z);
        d.rotation.set(0, cb.h, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        cabins.setMatrixAt(i, d.matrix);
        cabins.setColorAt(i, c.set(CABIN_TINTS[Math.floor(cb.tint * CABIN_TINTS.length) % CABIN_TINTS.length]));
      });
      cabins.computeBoundingSphere();
      g.add(cabins);
    }
    // le stazioni: cemento chiaro, il tetto scuro, lo zoccolo nel terreno
    const m = new Mesh();
    const wall = new THREE.Color('#cfc9bd');
    const roof = new THREE.Color('#4a4d52');
    for (const s of built.stations) {
      const [w, l, h] = STATION[s.kind];
      const fx = Math.sin(s.h);
      const fz = Math.cos(s.h);
      const lx = Math.cos(s.h);
      const lz = -Math.sin(s.h);
      const corner = (a: number, b: number, y: number) => [s.x + fx * a + lx * b, y, s.z + fz * a + lz * b] as const;
      const y0 = s.y - 2.5;
      const y1 = s.y + h;
      const cs = [corner(l / 2, w / 2, 0), corner(-l / 2, w / 2, 0), corner(-l / 2, -w / 2, 0), corner(l / 2, -w / 2, 0)];
      for (let i = 0; i < 4; i++) {
        const a = cs[i];
        const b = cs[(i + 1) % 4];
        const k = m.vertex(a[0], y0, a[2], 0, 0, wall);
        m.vertex(b[0], y0, b[2], 1, 0, wall);
        m.vertex(b[0], y1, b[2], 1, 1, wall);
        m.vertex(a[0], y1, a[2], 0, 1, wall);
        m.idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
      }
      const k = m.pos.length / 3;
      for (const c of cs) m.vertex(c[0], y1 + 0.4, c[2], 0, 0, roof);
      m.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      // la gronda del tetto, un filo più larga
      for (let i = 0; i < 4; i++) {
        const a = cs[i];
        const b = cs[(i + 1) % 4];
        const q = m.vertex(a[0], y1, a[2], 0, 0, roof);
        m.vertex(b[0], y1, b[2], 0, 0, roof);
        m.vertex(b[0], y1 + 0.4, b[2], 0, 0, roof);
        m.vertex(a[0], y1 + 0.4, a[2], 0, 0, roof);
        m.idx.push(q, q + 2, q + 1, q, q + 3, q + 2);
      }
    }
    const sg = m.build();
    if (sg) g.add(new THREE.Mesh(sg, mats.station));
  };
  useFrame((_, dt) => {
    clock.current -= dt;
    if (clock.current > 0) return;
    clock.current = 2;
    const p = playerPose();
    if (at.current && Math.hypot(p.x - at.current[0], p.z - at.current[1]) < LIFT_MOVE) return;
    at.current = [p.x, p.z];
    rebuild(p.x, p.z);
  });
  useEffect(() => {
    const g = group.current;
    return () => {
      if (!g) return;
      for (const o of [...g.children]) if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
      g.clear();
    };
  }, []);
  return <group ref={group} />;
}
