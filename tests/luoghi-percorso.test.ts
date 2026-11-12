import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { projector } from '../src/domain/geo';
import { campioni } from '../src/open/campioni';
import { WorldGraph } from '../src/open/graph';
import { WorldPath } from '../src/open/path';
import { decodeFeatures, type WorldData } from '../src/open/world';
import { luoghiPercorso } from '../src/open/luoghiPercorso';

const json=(name:string)=>JSON.parse(readFileSync('public/world/bergamo/'+name+'.json','utf8'));
const graph=new WorldGraph(json('graph'));
const proj=projector(graph.origin);
const data:WorldData={graph,features:decodeFeatures(json('features')),rides:json('rides'),proj,toGeo:proj.toGeo};
function route(id:string){
  const ride=data.rides.find(r=>r.id===id)!;
  const [[edge,dir],...rest]=ride.legs;
  const path=new WorldPath(graph,{edge,dir,s:dir>0?0:graph.edges[edge].length});
  for(const [id,d] of rest) path.append(id,d);
  return {stops:luoghiPercorso(data,ride,path),path};
}
describe('Arte e targhe lungo il percorso',()=>{
  it('tutti i pali ricadono sulla salita e la sosta guarda il lato dipinto anche in discesa',()=>{
    const signs=campioni(data);
    expect(signs).toHaveLength(19);
    for(const id of ['selvino','ganda']){
      const {stops,path}=route(id);
      const plates=stops.filter(s=>s.kind==='Tornanti dei campioni');
      expect(plates).toHaveLength(19);
      const stop=plates.find(s=>s.id==='cartello-1')!;
      const p=path.poseAt(stop.viewAt!);
      const sign=signs.find(s=>s.n===1)!;
      expect((p.x-sign.x)*Math.sin(sign.heading)+(p.z-sign.z)*Math.cos(sign.heading)).toBeLessThan(-2);
      expect(stops.map(s=>s.id)).toEqual(expect.arrayContaining(['lonno-murales','selvino-benvenuto']));
    }
  });
  it('il giro di Città Alta raggiunge la facciata di piazza Mascheroni',()=>{
    const {stops,path}=route('citta-alta');
    const mural=stops.find(s=>s.id==='palazzo-roncalli')!;
    const view=path.poseAt(mural.viewAt!);
    expect(Math.hypot(view.x-mural.target!.x,view.z-mural.target!.z)).toBeLessThan(65);
    expect(stops.some(s=>s.id==='selvino-benvenuto')).toBe(false);
  });
});

