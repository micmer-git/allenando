import raw from './campioni-data.json';
import type { WorldData } from './world';

export function campioni(data: WorldData) {
  if (data.graph.id !== 'bergamo') return [];
  const allowed = new Set(data.rides.find(r => r.id === 'selvino')?.legs.map(l => l[0]));
  return raw.flatMap(sign => {
    const at = data.proj.toLocal(sign);
    const hit = data.graph.nearest(at.x, at.z, 32, e => allowed.has(e.id));
    if (!hit) return [];
    const edge = data.graph.edges[hit.edge];
    const leg = data.rides.find(r => r.id === 'selvino')!.legs.find(l => l[0] === hit.edge)!;
    const road = data.graph.pose(hit.edge, hit.s, leg[1]);
    // OSM maps some posts inside the centreline. Preserve its recorded side, with clearance for riders.
    const nx = -Math.cos(road.heading), nz = Math.sin(road.heading);
    const lateral = (at.x-road.x)*nx + (at.z-road.z)*nz;
    const offset = Math.max(0, edge.hw + 0.4 - Math.abs(lateral)) * (Math.sign(lateral) || 1);
    return [{ ...sign, x:at.x + nx*offset, z:at.z + nz*offset, y:road.y, heading:road.heading, edge:hit.edge, s:hit.s }];
  });
}
export const commonsFile = (name: string) => 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(name);

