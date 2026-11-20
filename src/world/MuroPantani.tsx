import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { projector } from '@/domain/geo';
import type { LoadedRoute } from '@/domain/routes';
import type { HeightField } from './heightfield';

// Nodo OSM 828486815. La strada arrotondata può scostarsi di qualche metro dal muro reale.
const monumento = {lat:46.2559731, lon:10.2856994};
const width = 4.8;
const height = 3.15;

export function MuroPantani({route,field}: {route: LoadedRoute; field: HeightField}) {
  const site = useMemo(() => {
    const p = projector(route.origin).toLocal(monumento);
    const hit = field.road.nearest(p.x,p.z);
    if (!hit) return null;
    const road = route.track.poseAt(hit.along);
    const side = (p.x-road.x)*Math.cos(road.heading) - (p.z-road.z)*Math.sin(road.heading) >= 0 ? 1 : -1;
    const normal = {x:side*Math.cos(road.heading), z:-side*Math.sin(road.heading)};
    const offset = Math.max(route.track.halfWidth+1.5, hit.dist);
    const x = road.x+normal.x*offset, z = road.z+normal.z*offset;
    return {x,z,y:Math.max(road.y-0.35,field.height(x,z,4)),yaw:Math.atan2(-normal.x,-normal.z)};
  }, [route,field]);
  const geometry = useMemo(() => {
    // Quattro punti sulla muratura, nello scatto di Sjaak Kempe. Il ritaglio esclude cielo e strada.
    const g = new THREE.PlaneGeometry(width,height);
    g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0.84, 0.79,0.99, 0,0.025, 0.94,0.09],2));
    return g;
  }, []);
  const [map,setMap] = useState<THREE.Texture|null>(null);
  useEffect(() => {
    let active = true;
    const texture = new THREE.TextureLoader().load(import.meta.env.BASE_URL+'routes/foto/commons-75235132.webp',
      t => { if (active) { t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; setMap(t); } });
    return () => { active = false; texture.dispose(); };
  }, []);
  useEffect(() => () => geometry.dispose(),[geometry]);
  if (!site) return null;
  return <group position={[site.x,site.y,site.z]} rotation={[0,site.yaw,0]} name="Monumento a Marco Pantani">
    <mesh position={[0,height/2-0.7,0]} castShadow receiveShadow>
      <boxGeometry args={[width,height+1.4,0.65]} />
      <meshLambertMaterial color="#706c60" />
    </mesh>
    {map && <mesh position={[0,height/2,0.332]} geometry={geometry}>
      <meshLambertMaterial map={map} />
    </mesh>}
  </group>;
}
