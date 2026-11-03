import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Track } from '@/domain/track';
import { buildGuardrails } from './builders';
import type { HeightField } from './heightfield';
import {
  delineatorEyesGeometry,
  delineatorGeometry,
  disposeRoadsideMaterials,
  hairpinAtlas,
  instanced,
  railPostGeometry,
  reflectorGeometry,
  roadsideMaterials,
  sideYaw,
  signPoleGeometry,
} from './roadside';

/**
 * L'arredo delle salite: guardrail a doppia onda con paletti, distanziali, catadiottri e terminali
 * interrati; delineatori dove il guardrail non c'è; i cartelli dei tornanti numerati, contati
 * dall'alto come sullo Stelvio (il primo che si incontra salendo ha il numero più alto).
 */
export function ClimbRoadside({ track, field }: { track: Track; field: HeightField }) {
  const mats = useMemo(() => roadsideMaterials(), []);
  const built = useMemo(() => {
    const rails = buildGuardrails(track, field);
    const group = new THREE.Group();
    const geos = { post: railPostGeometry(), refl: reflectorGeometry(), del: delineatorGeometry(), eyes: delineatorEyesGeometry(), pole: signPoleGeometry() };
    group.add(new THREE.Mesh(rails.geometry, mats.beam));
    const posts = rails.posts.map((p) => ({ x: p.x, y: p.y - 0.08, z: p.z, ry: sideYaw(p.h, p.side) }));
    const refl = posts.filter((_, i) => i % 3 === 1);
    const del = rails.delineators.map((p) => ({ x: p.x, y: p.y - 0.12, z: p.z, ry: sideYaw(p.h, p.side) }));
    for (const m of [instanced(geos.post, mats.lit, posts, false), instanced(geos.refl, mats.bright, refl, false), instanced(geos.del, mats.lit, del, false), instanced(geos.eyes, mats.bright, del, false)]) if (m) group.add(m);
    // tornanti numerati: il cartello 15 m prima del vertice, a destra di chi sale, rivolto verso di lui
    const hp = track.hairpins;
    let atlas: ReturnType<typeof hairpinAtlas> | null = null;
    const plates: THREE.BufferGeometry[] = [];
    if (hp.length) {
      const items = hp.slice(0, 64).map((h, i) => ({ n: hp.length - i, alt: Math.round(track.poseAt(h.distance).altitude) }));
      atlas = hairpinAtlas(items);
      const signMat = new THREE.MeshLambertMaterial({ map: atlas.texture, side: THREE.DoubleSide });
      const poleItems: { x: number; y: number; z: number; ry: number }[] = [];
      items.forEach((_, i) => {
        const p = track.poseAt(Math.max(0, hp[i].distance - 15));
        const off = track.halfWidth + 1.2;
        const x = p.x - Math.cos(p.heading) * off;
        const z = p.z + Math.sin(p.heading) * off;
        const g = new THREE.PlaneGeometry(0.9, 0.675);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        const cx = i % atlas!.cols;
        const cy = Math.floor(i / atlas!.cols);
        for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / atlas!.cols, 1 - (cy + 1 - uv.getY(k)) / atlas!.rows);
        g.rotateY(Math.PI);
        g.translate(0, 2.15, 0);
        plates.push(g);
        const mesh = new THREE.Mesh(g, signMat);
        mesh.position.set(x, p.y - 0.1, z);
        mesh.rotation.y = p.heading;
        group.add(mesh);
        poleItems.push({ x, y: p.y - 0.1, z, ry: p.heading });
      });
      const poles = instanced(geos.pole, mats.lit, poleItems, false);
      if (poles) group.add(poles);
      group.userData.signMat = signMat;
    }
    return { group, rails, geos, atlas, plates };
  }, [track, field, mats]);
  useEffect(
    () => () => {
      built.rails.geometry.dispose();
      Object.values(built.geos).forEach((g) => g.dispose());
      built.plates.forEach((g) => g.dispose());
      built.atlas?.texture.dispose();
      (built.group.userData.signMat as THREE.Material | undefined)?.dispose();
      built.group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    },
    [built],
  );
  useEffect(() => () => disposeRoadsideMaterials(mats), [mats]);
  return <primitive object={built.group} />;
}
