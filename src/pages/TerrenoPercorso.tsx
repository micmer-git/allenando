import { useEffect, useMemo, useState } from 'react';
import type { TrackPose } from '@/domain/track';
import { FLAG, type Edge } from '@/open/graph';
import { COVER, Terrain, worldBase } from '@/open/world';

interface Surfaces {graphBuiltAt:string; edgeCount:number; edges:Record<string,[string,number[]]>}
const land: Record<number,string> = {
  [COVER.open]:'terreno aperto',[COVER.forest]:'bosco',[COVER.residential]:'abitato',
  [COVER.industrial]:'zona produttiva',[COVER.park]:'verde urbano',[COVER.rock]:'roccia',
  [COVER.water]:'acqua',[COVER.farmland]:'coltivi',[COVER.glacier]:'ghiaccio',[COVER.piste]:'pista da sci',
};
export function TerrenoPercorso({terrain,pose,edge}:{terrain:Terrain; pose:TrackPose; edge:Edge}) {
  const graph=terrain.graph;
  const [survey,setSurvey]=useState<Surfaces|null>(null);
  useEffect(()=>{
    if(graph.id!=='bergamo') return;
    const controller=new AbortController();
    fetch(worldBase(graph.id)+'fondi-verificati-v1.json',{signal:controller.signal}).then(async response=>{
      if(!response.ok) return;
      const file=await response.json() as Surfaces;
      if(!controller.signal.aborted && file.graphBuiltAt===graph.builtAt && file.edgeCount===graph.edges.length) setSurvey(file);
    }).catch(()=>{});
    return ()=>controller.abort();
  },[graph]);
  const known=graph.id==='bergamo' && survey?.edges[edge.id];
  const surface=(edge.flags&FLAG.cobbles)?'lastricato':(edge.flags&FLAG.unpaved)?'sterrato':known?'asfalto':'';
  const {x,z,heading}=pose;
  const samples=useMemo(()=>{
    const sides=[-1,1];
    return sides.map(side=>[20,40,60].map(off=>({
      x:x-side*Math.cos(heading)*off,z:z+side*Math.sin(heading)*off
    })));
  },[x,z,heading]);
  const [cover,setCover]=useState<{samples:typeof samples;names:string[]}|null>(null);
  useEffect(()=>{
    let active=true;
    const tiles=new Map<string,[number,number]>();
    for(const p of samples.flat()) {
      const index=terrain.tileOf(p.x,p.z);
      tiles.set(index.join('_'),index);
    }
    Promise.all([...tiles.values()].map(([tx,tz])=>terrain.load(tx,tz))).then(()=>{
      if(!active) return;
      const names=samples.map(side=>{
        const votes=new Map<number,number>();
        for(const p of side) if(terrain.has(...terrain.tileOf(p.x,p.z))){
          const c=terrain.cover(p.x,p.z); votes.set(c,(votes.get(c)??0)+1);
        }
        const first=[...votes].sort((a,b)=>b[1]-a[1])[0];
        return first ? land[first[0]] : '';
      });
      setCover({samples,names});
    });
    return ()=>{active=false;};
  },[terrain,samples]);
  const [left,right]=cover?.samples===samples?cover.names:[];
  const environment=left && right ? left===right ? left+' su entrambi i lati' : left+' a sinistra, '+right+' a destra' : '';
  if(!surface && !environment) return null;
  return <p className="text-sm text-muted" aria-label="Fondo e dintorni">
    {surface && <>Fondo mappato · <span className="text-ink">{surface}</span></>}
    {surface && environment && '　·　'}{environment}
  </p>;
}

