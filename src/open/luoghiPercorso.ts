import type { WorldPath } from './path';
import type { RideDef, WorldData } from './world';
import { campioni, commonsFile } from './campioni';
import { arteStrada, GIMONDI, OBELISCO } from './arteStrada';
import { surveyStops } from './sopralluogo';

export interface SurveyStop {
  id:string; name:string; station:number; kind:'Luoghi'|'Arte lungo la strada'|'Tornanti dei campioni';
  note?:string; source?:string; target?:{x:number;z:number}; viewAt?:number; detailRoad?:{edge:number;s:number;dir:1}; heightOffset?:number; plate?:number;
}
function along(path:WorldPath, target:{x:number;z:number}, reach:number) {
  let distance: number | undefined;
  let squared=reach*reach;
  // The path is already sampled every two metres. A stride of three stays within one bike length.
  for(let i=0;i<path.points.length;i+=3) {
    const p=path.points[i], d=(target.x-p.x)**2+(target.z-p.z)**2;
    if(d<squared){squared=d;distance=p.distance;}
  }
  return distance;
}
export function luoghiPercorso(data:WorldData, ride:RideDef | null, path:WorldPath): SurveyStop[] {
  const stops:SurveyStop[]=ride ? surveyStops(ride,data).map(s=>({...s,kind:'Luoghi'})) : [];
  const roadEdges=new Map(path.legs.map(l=>[l.edge,l]));
  const towns=new Set(stops.map(s=>s.name));
  for(const p of data.features.pois) {
    const leg=roadEdges.get(p.edge);
    if(!leg || !p.name || p.off>55 || towns.has(p.name) ||
      !['chiesa','santuario','campanile','castello','torre','ponte','cappella','belvedere','rifugio'].includes(p.kind)) continue;
    const at=leg.from + (p.s-leg.s0)*leg.dir;
    if (at < leg.from || at > leg.from + leg.len) continue;
    stops.push({id:p.id,name:p.name,station:Math.round(at/100),kind:'Luoghi',target:p});
    towns.add(p.name);
  }
  for(const s of campioni(data)) {
    const leg=roadEdges.get(s.edge);
    if(!leg) continue;
    const at=leg.from+(s.s-leg.s0)*leg.dir;
    if (at < leg.from || at > leg.from + leg.len) continue;
    const approaching=Math.cos(path.poseAt(at).heading-s.heading)>=0;
    const viewAt=Math.max(0,Math.min(path.length,at+(approaching?-8:8)));
    stops.push({viewAt,heightOffset:0.30,plate:s.n,id:'cartello-'+s.n,name:'Tornante '+s.n+' · '+s.name,station:Math.round(at/100),kind:'Tornanti dei campioni',
      note:'Targa della Nembro–Selvino a '+s.alt+' m s.l.m. Fotografia di Amadvance, CC BY-SA 4.0, ritagliata e raddrizzata.',source:commonsFile(s.image),target:s});
  }
  for(const a of arteStrada(data)) {
    const at=along(path,a,a.id==='palazzo-roncalli'?65:35);
    if(at===undefined) continue;
    const viewAt = a.id === GIMONDI.id ? Math.max(0, at-7) : at;
    const heightOffset = a.id === 'palazzo-roncalli' ? 6 : a.id === OBELISCO.id ? 2.5 : a.id === GIMONDI.id ? -0.45 : undefined;
    const near = a.id === GIMONDI.id ? data.graph.nearest(a.x,a.z,12) : null;
    const detailRoad = near ? { edge:near.edge, s:Math.min(data.graph.edges[near.edge].length, near.s+3), dir:1 as const } : undefined;
    stops.push({viewAt,heightOffset,detailRoad,id:a.id,name:a.name,station:Math.round(at/100),kind:'Arte lungo la strada',note:a.note,source:a.source,target:a});
  }
  return stops.sort((a,b)=>a.station-b.station);
}

