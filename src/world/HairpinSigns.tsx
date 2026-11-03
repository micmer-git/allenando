import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { hairpinAtlas } from './roadside';

/**
 * I cartelli dei tornanti numerati, come sullo Stelvio: «TORNANTE», il numero e la quota, su un
 * palo a destra di chi sale, 15 m prima del vertice. Si contano dall'alto: il primo che si
 * incontra salendo ha il numero più alto, l'ultimo è il numero 1. Un atlante solo per la salita.
 */
export interface HairpinSign {
  /** piede del palo */
  x: number;
  y: number;
  z: number;
  /** direzione di chi sale: il cartello lo guarda */
  heading: number;
  n: number;
  alt: number;
}

/** Dove mettere i cartelli: per ogni tornante (in ordine di salita) la posa 15 m prima del vertice. */
export function hairpinSigns(hairpins: { distance: number }[], poseAt: (d: number) => { x: number; y: number; z: number; heading: number; altitude: number }, halfWidth: (d: number) => number): HairpinSign[] {
  return hairpins.slice(0, 64).map((h, i) => {
    const d = Math.max(0, h.distance - 15);
    const p = poseAt(d);
    const off = halfWidth(d) + 1.2;
    return { x: p.x - Math.cos(p.heading) * off, y: p.y - 0.1, z: p.z + Math.sin(p.heading) * off, heading: p.heading, n: hairpins.length - i, alt: Math.round(poseAt(h.distance).altitude) };
  });
}

export function HairpinSigns({ items }: { items: HairpinSign[] }) {
  const built = useMemo(() => {
    const group = new THREE.Group();
    if (!items.length) return { group, dispose: () => {} };
    const atlas = hairpinAtlas(items);
    const signMat = new THREE.MeshLambertMaterial({ map: atlas.texture, side: THREE.DoubleSide });
    const poleMat = new THREE.MeshLambertMaterial({ color: '#8f959b' });
    const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.2, 6, 1, true);
    pole.translate(0, 1.1, 0.03);
    const plates: THREE.BufferGeometry[] = [];
    items.forEach((it, i) => {
      const g = new THREE.PlaneGeometry(0.9, 0.675);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const cx = i % atlas.cols;
      const cy = Math.floor(i / atlas.cols);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / atlas.cols, 1 - (cy + 1 - uv.getY(k)) / atlas.rows);
      // il piano guarda +z: lo si gira verso chi arriva
      g.rotateY(Math.PI);
      g.translate(0, 2.05, 0);
      plates.push(g);
      const sign = new THREE.Group();
      sign.position.set(it.x, it.y, it.z);
      sign.rotation.y = it.heading;
      sign.add(new THREE.Mesh(g, signMat), new THREE.Mesh(pole, poleMat));
      group.add(sign);
    });
    return {
      group,
      dispose: () => {
        plates.forEach((g) => g.dispose());
        pole.dispose();
        signMat.dispose();
        poleMat.dispose();
        atlas.texture.dispose();
      },
    };
  }, [items]);
  useEffect(() => () => built.dispose(), [built]);
  return <primitive object={built.group} />;
}
