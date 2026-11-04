import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TrackPose } from '@/domain/track';
import { LOD_NEAR, monumentoGeometry } from '@/world/monumenti/archetipi';
import { loadMonumenti, type Monumento } from './monumenti';

/**
 * I monumenti nella scena del mondo aperto. Si costruiscono a richiesta, uno per giro: il
 * modello «basso» entro VISTA metri dal ciclista, quello «alto» entro LOD_NEAR (con un po' di
 * margine per non rifarlo avanti e indietro). Lontano si buttano: il telefono non tiene tutti
 * e quaranta in memoria. Un materiale solo per tutti, colori nei vertici.
 */

/** Oltre questa distanza un monumento non si costruisce (la nebbia lo copre comunque). */
const VISTA = 4500;
/** Il modello alto si tiene fino a qui, poi si butta (si rifà se si torna indietro). */
const KEEP_HI = LOD_NEAR + 250;

interface Entry {
  obj: THREE.Group;
  lo: THREE.Mesh | null;
  hi: THREE.Mesh | null;
}

export function Monumenti({ playerPose }: { playerPose: () => TrackPose }) {
  const [list, setList] = useState<Monumento[]>([]);
  const root = useRef<THREE.Group>(null);
  const entries = useRef(new Map<string, Entry>());
  const clock = useRef(0);
  const material = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);

  useEffect(() => {
    let on = true;
    // ?monumenti=0 nell'indirizzo: il mondo senza monumenti, per il collaudo a confronto
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('monumenti') === '0') return;
    void loadMonumenti().then((l) => on && setList(l));
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    const map = entries.current;
    const g = root.current;
    return () => {
      for (const e of map.values()) {
        e.lo?.geometry.dispose();
        e.hi?.geometry.dispose();
      }
      map.clear();
      g?.clear();
      material.dispose();
    };
  }, [material]);

  useFrame((_, dt) => {
    clock.current -= dt;
    if (clock.current > 0 || !root.current) return;
    clock.current = 0.25;
    const p = playerPose();
    const map = entries.current;
    // un modello nuovo per giro al massimo: niente scatti quando se ne avvicinano tanti insieme
    let budget = 1;
    for (const m of list) {
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      let e = map.get(m.id);
      if (!e) {
        if (d > VISTA || budget <= 0) continue;
        const obj = new THREE.Group();
        obj.position.set(m.x, m.y, m.z);
        obj.rotation.y = m.yaw;
        obj.name = m.name;
        obj.userData.monumento = m.id;
        e = { obj, lo: null, hi: null };
        map.set(m.id, e);
        root.current.add(obj);
      }
      if (d > VISTA + 800) {
        e.lo?.geometry.dispose();
        e.hi?.geometry.dispose();
        root.current.remove(e.obj);
        map.delete(m.id);
        continue;
      }
      if (!e.lo && budget > 0) {
        e.lo = new THREE.Mesh(monumentoGeometry(m, 'bassa'), material);
        e.obj.add(e.lo);
        budget--;
      }
      if (d < LOD_NEAR + 120 && !e.hi && budget > 0) {
        e.hi = new THREE.Mesh(monumentoGeometry(m, 'alta'), material);
        e.obj.add(e.hi);
        budget--;
      } else if (d > KEEP_HI && e.hi) {
        e.hi.geometry.dispose();
        e.obj.remove(e.hi);
        e.hi = null;
      }
      const near = d < LOD_NEAR && !!e.hi;
      if (e.hi) e.hi.visible = near;
      if (e.lo) e.lo.visible = !near;
    }
  });

  return <group ref={root} />;
}
