import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TrackPose } from '@/domain/track';
import { canvasTex } from '@/world/Scene';
import type { WorldField } from './field';
import type { WorldData } from './world';

/*
 * Il cartello del passo: bianco col bordo nero, «Passo Sella» e sotto «2240 m», su due pali,
 * a sinistra della strada nel punto del valico (i `peaks` con pass = 1), leggibile da tutte e due
 * le parti. Si fa per i passi entro PASS_R dal ciclista, uno per volta, e si butta quando è lontano.
 */

const PASS_R = 3000;

export function passSignTexture(name: string, ele: number): THREE.CanvasTexture {
  return canvasTex(512, 256, (g) => {
    g.fillStyle = '#f7f7f2';
    g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#121212';
    g.lineWidth = 12;
    g.strokeRect(14, 14, 484, 228);
    g.fillStyle = '#121212';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 64;
    g.font = `700 ${size}px sans-serif`;
    while (g.measureText(name).width > 440 && size > 24) {
      size -= 4;
      g.font = `700 ${size}px sans-serif`;
    }
    g.fillText(name, 256, 96);
    g.font = `600 56px sans-serif`;
    g.fillText(`${ele} m`, 256, 182);
  });
}

/** Il punto della strada più vicino al valico: arco, ascissa e posa (campionando ogni 5 m). */
function roadPoseNear(data: WorldData, x: number, z: number): { x: number; y: number; z: number; heading: number; hw: number } | null {
  let best: { d: number; x: number; y: number; z: number; heading: number; hw: number } | null = null;
  for (const id of data.graph.edgesNear(x, z, 60)) {
    const e = data.graph.edges[id];
    const n = Math.max(1, Math.ceil(e.length / 5));
    for (let k = 0; k <= n; k++) {
      const p = data.graph.pose(id, (e.length * k) / n, 1);
      const d = Math.hypot(p.x - x, p.z - z);
      if (!best || d < best.d) best = { d, x: p.x, y: p.y, z: p.z, heading: p.heading, hw: e.hw };
    }
  }
  return best && best.d < 60 ? best : null;
}

export function Passi({ data, field, playerPose }: { data: WorldData; field: WorldField; playerPose: () => TrackPose }) {
  const group = useRef<THREE.Group>(null);
  const live = useRef(new Map<number, THREE.Group>());
  const clock = useRef(0);
  const passes = useMemo(() => data.features.peaks.filter((p) => p.pass && p.name), [data]);
  const shared = useMemo(() => {
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.9, 5);
    pole.translate(0, 1.45, 0);
    const plate = new THREE.PlaneGeometry(2.0, 1.0);
    plate.translate(0, 2.45, 0.05);
    return { pole, plate, poleMat: new THREE.MeshLambertMaterial({ color: '#3b3f45' }) };
  }, []);
  useEffect(
    () => () => {
      shared.pole.dispose();
      shared.plate.dispose();
      shared.poleMat.dispose();
    },
    [shared],
  );
  const dispose = (g: THREE.Group) => {
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial && o.material !== shared.poleMat) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  };
  useEffect(() => {
    const map = live.current;
    return () => {
      for (const g of map.values()) dispose(g);
      map.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_, dt) => {
    clock.current -= dt;
    const root = group.current;
    if (!root || clock.current > 0) return;
    clock.current = 1;
    const p = playerPose();
    for (const [i, g] of live.current) {
      const pk = passes[i];
      if (Math.hypot(pk.x - p.x, pk.z - p.z) > PASS_R + 500) {
        root.remove(g);
        dispose(g);
        live.current.delete(i);
      }
    }
    for (let i = 0; i < passes.length; i++) {
      const pk = passes[i];
      if (live.current.has(i) || Math.hypot(pk.x - p.x, pk.z - p.z) > PASS_R) continue;
      const road = roadPoseNear(data, pk.x, pk.z);
      // a sinistra di chi sale nel verso dell'arco, fuori dalla banchina; senza strada, sul valico
      const off = road ? road.hw + 1.6 : 0;
      const x = road ? road.x + Math.cos(road.heading) * off : pk.x;
      const z = road ? road.z - Math.sin(road.heading) * off : pk.z;
      const y = road ? road.y - 0.1 : field.height(x, z, 4);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = road ? road.heading + Math.PI / 2 : 0;
      const mat = new THREE.MeshLambertMaterial({ map: passSignTexture(pk.name, pk.ele) });
      const front = new THREE.Mesh(shared.plate, mat);
      const back = new THREE.Mesh(shared.plate, mat);
      back.rotation.y = Math.PI;
      g.add(front, back);
      for (const dx of [-0.8, 0.8]) {
        const pole = new THREE.Mesh(shared.pole, shared.poleMat);
        pole.position.x = dx;
        g.add(pole);
      }
      live.current.set(i, g);
      root.add(g);
    }
  });
  return <group ref={group} />;
}
