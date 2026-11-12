import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackPose } from '@/domain/track';
import { worldBase, type WorldData } from './world';
import { campioni } from './campioni';
import type { WorldField } from './field';

export function CartelliSelvino({data,field,playerPose}:{data:WorldData;field:WorldField;playerPose:()=>TrackPose}) {
  const catalogue = useMemo(() => campioni(data), [data]);
  const [near,setNear] = useState(false);
  const [texture,setTexture] = useState<THREE.Texture | null>(null);
  const last = useRef(-Infinity);
  const [terrainVersion,refresh] = useState('');
  useFrame(({clock})=>{
    if (clock.elapsedTime < last.current + 1) return;
    last.current = clock.elapsedTime;
    const p=playerPose();
    const visible=catalogue.some(s=>Math.hypot(s.x-p.x,s.z-p.z)<1100);
    setNear(visible);
    if (visible) refresh(catalogue.map(s=>field.terrain.has(...field.terrain.tileOf(s.x,s.z))?'1':'0').join(''));
  });
  useEffect(()=>{
    if (!near) return;
    let active=true;
    const tex = new THREE.TextureLoader().load(worldBase(data.graph.id)+'campioni-v1/targhe.webp',()=>{
      if(active){ tex.colorSpace=THREE.SRGBColorSpace; setTexture(tex); }
    },undefined,()=>{});
    return ()=>{active=false;setTexture(null);tex.dispose();};
  },[near,data.graph.id]);
  const geometry=useMemo(()=>{
    if(!near || !texture || !terrainVersion) return null;
    const panels: THREE.BufferGeometry[] = [], posts: THREE.BufferGeometry[] = [];
    catalogue.forEach(s=>{
      const y=field.terrain.has(...field.terrain.tileOf(s.x,s.z)) ? field.height(s.x,s.z,4) : s.y;
      const plate=new THREE.PlaneGeometry(0.8,1.12);
      const uv=plate.getAttribute('uv');
      const i=s.n-1;
      for(let v=0;v<uv.count;v++) uv.setXY(v,(i%5 + 0.008 + 0.984*uv.getX(v))/5,(3-Math.floor(i/5)+0.008+0.984*uv.getY(v))/4);
      plate.rotateY(s.heading+Math.PI);
      plate.translate(s.x,y+1.92,s.z);
      panels.push(plate);
      const back=new THREE.BoxGeometry(0.8,1.12,0.045);
      back.rotateY(s.heading);
      back.translate(s.x+Math.sin(s.heading)*0.03,y+1.92,s.z+Math.cos(s.heading)*0.03);
      posts.push(back);
      const post=new THREE.CylinderGeometry(0.035,0.035,2.05,7);
      post.translate(s.x,y+1.0,s.z);
      posts.push(post);
    });
    const plates=mergeGeometries(panels), metal=mergeGeometries(posts);
    [...panels,...posts].forEach(g=>g.dispose());
    return {plates,metal};
  },[catalogue,field,near,texture,terrainVersion]);
  useEffect(()=>()=>{geometry?.plates.dispose();geometry?.metal.dispose();},[geometry]);
  if(!geometry || !texture) return null;
  return <group name="I 19 tornanti di Selvino">
    <mesh geometry={geometry.plates}><meshLambertMaterial map={texture}/></mesh>
    <mesh geometry={geometry.metal} castShadow><meshLambertMaterial color="#92918b"/></mesh>
  </group>;
}

