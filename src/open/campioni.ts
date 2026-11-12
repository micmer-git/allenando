import raw from './campioni-data.json';
import type { WorldData } from './world';

export function campioni(data: WorldData) {
  if (data.graph.id !== 'bergamo') return [];
  let routeLength=0;
  const legs=data.rides.find(r=>r.id==='selvino')?.legs.map(([edge,dir])=>{
    const from=routeLength;
    routeLength+=data.graph.edges[edge].length;
    return {edge,dir,from,to:routeLength};
  }) ?? [];
  const allowed = new Set(legs.map(l=>l.edge));
  return raw.flatMap(sign => {
    const at = data.proj.toLocal(sign);
    const hit = data.graph.nearest(at.x, at.z, 32, e => allowed.has(e.id));
    if (!hit) return [];
    const edge = data.graph.edges[hit.edge];
    const leg=legs.find(l=>l.edge===hit.edge)!;
    const road = data.graph.pose(hit.edge, hit.s, leg.dir);
    // OSM maps some posts inside the centreline. Preserve its recorded side, with clearance for riders.
    const nx = -Math.cos(road.heading), nz = Math.sin(road.heading);
    const lateral = (at.x-road.x)*nx + (at.z-road.z)*nz;
    const offset = Math.max(0, edge.hw + 0.4 - Math.abs(lateral)) * (Math.sign(lateral) || 1);
    const x=at.x + nx*offset, z=at.z + nz*offset;
    const viewAt=Math.max(0,leg.from+(leg.dir===1?hit.s:edge.length-hit.s)-8);
    const previous=legs.find(l=>l.to>=viewAt)!;
    const local=viewAt-previous.from;
    const before=data.graph.pose(previous.edge,previous.dir===1?local:data.graph.edges[previous.edge].length-local,previous.dir);
    const facing=Math.atan2(x-before.x,z-before.z);
    return [{ ...sign, x, z, y:road.y, heading:road.heading, facing, edge:hit.edge, s:hit.s }];
  });
}
export const commonsFile = (name: string) => 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(name);

