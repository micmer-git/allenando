import { FLAG, type Dir, type Leg, type WorldGraph } from './graph';
import type { WorldData } from './world';
import type { Dove } from '../ride/contract';
import { intentoInSearch } from '../ride/intento';

export type FreeStart = Extract<Dove, { kind: 'libero' }>;

/** Un punto del grafo resta sullo stesso arco anche quando due strade si affiancano o si incrociano. */
export function roadStart(graph: WorldGraph, edge: number, s: number, dir: Dir = 1): FreeStart | null {
  const e = graph.edges[edge];
  if (!e || !Number.isFinite(s)) return null;
  return { kind: 'libero', world: graph.id, edge, dir: graph.allowed(edge, dir) ? dir : dir === 1 ? -1 : 1,
    s: Math.min(e.length, Math.max(0, s)) };
}

export function pickRoad(graph: WorldGraph, x: number, z: number, mpp: number): FreeStart | null {
  const hit = graph.nearest(x, z, Math.max(12, Math.min(350, 9 * mpp)));
  return hit ? roadStart(graph, hit.edge, hit.s) : null;
}

export function pedalaFromPoint(dove: FreeStart): string {
  return '/?dove=libero&' + intentoInSearch({ dove, tipo: 'libera' });
}

export const GANDA_PLAN = 'ganda-da-gazzaniga';
export const GANDA_NAME = 'Salita di Ganda da Gazzaniga';
export const GANDA_LINK = '/?dove=ganda';

/** Il tratto reale del giro della Ganda: dalla rotatoria all'imbocco di via Marconi fino al valico. */
export function gandaClimb(data: WorldData): Leg[] {
  const ride = data.rides.find(r => r.id === 'ganda');
  const pass = data.features.landmarks.find(l => l.id === 'passo-di-ganda');
  if (data.graph.id !== 'bergamo' || !ride || !pass) return [];
  const { graph } = data;
  const last = ride.legs.findIndex(([edge, dir]) => {
    const node = graph.endNode(edge, dir);
    return Math.hypot(pass.x - graph.nodeX[node], pass.z - graph.nodeZ[node]) < 15;
  });
  // Il giro attraversa altre vie Marconi prima di Gazzaniga. Risaliamo dal passo fino al suo piede.
  for (let first = last; first > 0; first--) {
    const [edge] = ride.legs[first];
    const [previous] = ride.legs[first - 1];
    if (graph.edges[edge].name === 'Via Guglielmo Marconi' && (graph.edges[previous].flags & FLAG.roundabout)) {
      return ride.legs.slice(first, last + 1).map(([edge, dir]) => ({ edge, dir }));
    }
  }
  return [];
}
