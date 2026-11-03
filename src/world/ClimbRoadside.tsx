import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Track } from '@/domain/track';
import { buildGuardrails } from './builders';
import type { HeightField } from './heightfield';
import { HairpinSigns, hairpinSigns } from './HairpinSigns';
import { delineatorEyesGeometry, delineatorGeometry, disposeRoadsideMaterials, instanced, railPostGeometry, reflectorGeometry, roadsideMaterials, sideYaw } from './roadside';

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
    const geos = { post: railPostGeometry(), refl: reflectorGeometry(), del: delineatorGeometry(), eyes: delineatorEyesGeometry() };
    group.add(new THREE.Mesh(rails.geometry, mats.beam));
    const posts = rails.posts.map((p) => ({ x: p.x, y: p.y - 0.08, z: p.z, ry: sideYaw(p.h, p.side) }));
    const refl = posts.filter((_, i) => i % 3 === 1);
    const del = rails.delineators.map((p) => ({ x: p.x, y: p.y - 0.12, z: p.z, ry: sideYaw(p.h, p.side) }));
    for (const m of [instanced(geos.post, mats.lit, posts, false), instanced(geos.refl, mats.bright, refl, false), instanced(geos.del, mats.lit, del, false), instanced(geos.eyes, mats.bright, del, false)]) if (m) group.add(m);
    return { group, rails, geos };
  }, [track, field, mats]);
  const signs = useMemo(() => hairpinSigns(track.hairpins, (d) => track.poseAt(d), () => track.halfWidth), [track]);
  useEffect(
    () => () => {
      built.rails.geometry.dispose();
      Object.values(built.geos).forEach((g) => g.dispose());
      built.group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    },
    [built],
  );
  useEffect(() => () => disposeRoadsideMaterials(mats), [mats]);
  return (
    <group>
      <primitive object={built.group} />
      <HairpinSigns items={signs} />
    </group>
  );
}
