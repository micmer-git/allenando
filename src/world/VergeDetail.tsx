import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createVergeWindow, VERGE_BUDGET, type VergeSurface } from './vergePlacement';

export interface VergePalette { grass: string; rock: string }
const DEFAULT_PALETTE: VergePalette = { grass: '#7e9653', rock: '#a39b87' };

function geometry(rock: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const normals = g.getAttribute('normal');
    const colors = new Float32Array(normals.count * 3);
    for (let i = 0; i < normals.count; i++) {
      const light = normals.getY(i) > .5 ? 1 : normals.getY(i) < -.5 ? .66 : .83;
      colors.set([light, light, light], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  };
  if (rock) {
    box(1, .5, .72, 0, .25, 0);
    box(.64, .35, .56, -.08, .60, -.04);
  } else {
    box(.12, .76, .12, -.19, .38, -.08);
    box(.11, 1, .11, .02, .5, .04);
    box(.13, .57, .12, .22, .285, -.02);
    box(.1, .48, .14, -.05, .24, .23);
    box(.11, .65, .1, .07, .325, -.22);
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return merged;
}

/** Due draw call, nessun passaggio ombre. Le piccole zolle completano il bordo senza
 * cambiare fisica o dati del percorso, e vengono riciclate nella finestra del ciclista. */
export function VergeDetail({ surface, playerPose, revision, palette = DEFAULT_PALETTE, budget = VERGE_BUDGET }: {
  surface: VergeSurface;
  playerPose: () => { x: number; z: number };
  revision?: () => unknown;
  palette?: VergePalette;
  budget?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<{ grass: THREE.InstancedMesh; rock: THREE.InstancedMesh } | null>(null);
  const window = useMemo(() => createVergeWindow(surface, budget), [surface, budget]);
  const scratch = useMemo(() => ({ object: new THREE.Object3D(), color: new THREE.Color(),
    up: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(), yaw: new THREE.Quaternion() }), []);
  const written = useRef(false);
  useEffect(() => {
    const parent = group.current;
    if (!parent) return;
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const grass = new THREE.InstancedMesh(geometry(false), material, VERGE_BUDGET);
    const rock = new THREE.InstancedMesh(geometry(true), material, VERGE_BUDGET);
    for (const mesh of [grass, rock]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(mesh);
    }
    meshes.current = { grass, rock };
    written.current = false;
    return () => {
      meshes.current = null;
      for (const mesh of [grass, rock]) {
        parent.remove(mesh);
        mesh.geometry.dispose();
        mesh.dispose();
      }
      material.dispose();
    };
  }, [window]);
  useEffect(() => { written.current = false; }, [palette.grass, palette.rock]);
  useFrame(() => {
    const pair = meshes.current;
    if (!pair) return;
    const p = playerPose();
    if (!window.update(p.x, p.z, revision?.()) && written.current) return;
    const counts = { grass: 0, rock: 0 };
    for (const item of window.items) {
      const mesh = pair[item.kind], i = counts[item.kind]++;
      scratch.object.position.set(item.x, item.y, item.z);
      scratch.normal.set(-item.gradientX, 1, -item.gradientZ).normalize();
      scratch.object.quaternion.setFromUnitVectors(scratch.up, scratch.normal);
      scratch.object.quaternion.multiply(scratch.yaw.setFromAxisAngle(scratch.up, item.yaw));
      scratch.object.scale.set(item.width, item.height, item.width);
      scratch.object.updateMatrix();
      mesh.setMatrixAt(i, scratch.object.matrix);
      mesh.setColorAt(i, scratch.color.set(palette[item.kind]).multiplyScalar(item.tint));
    }
    for (const kind of ['grass', 'rock'] as const) {
      const mesh = pair[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    written.current = true;
  });
  return <group ref={group} />;
}
