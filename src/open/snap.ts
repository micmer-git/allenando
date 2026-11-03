import { CLS, FLAG, type Edge, type WorldGraph } from './graph';
import type { PoiKind, TrafficSignal } from './world';

/**
 * I punti di OSM (semafori, strisce, stop, fontanelle...) agganciati al grafo delle strade.
 * Lo usa scripts/world/build-world.ts; qui solo logica pura, provata in tests/strada.test.ts.
 */

type Tags = Record<string, string>;

/** Le strade dove ha senso un semaforo o una striscia: non le piste ciclabili, non le gallerie. */
export const roadForMarks = (e: Edge): boolean => e.cls !== CLS.cycleway && !(e.flags & FLAG.tunnel);

/** Un incrocio vero: almeno tre archi. */
export function isJunction(graph: WorldGraph, node: number): boolean {
  return graph.adjStart[node + 1] - graph.adjStart[node] >= 3;
}

/**
 * I semafori OSM stanno quasi sempre sulla strada, qualche metro prima dell'incrocio (uno per
 * ramo) o sul nodo dell'incrocio. Entro `toJunction` metri da un incrocio si raccolgono in UN
 * semaforo per incrocio; più lontano è un semaforo pedonale a metà strada, e due a meno di
 * 20 m l'uno dall'altro sono lo stesso.
 */
export function snapSignals(graph: WorldGraph, pts: { x: number; z: number }[], opts: { reach?: number; toJunction?: number } = {}): TrafficSignal[] {
  const reach = opts.reach ?? 15;
  const toJunction = opts.toJunction ?? 30;
  const byNode = new Map<number, TrafficSignal>();
  const mid: TrafficSignal[] = [];
  for (const p of pts) {
    const hit = graph.nearest(p.x, p.z, reach, roadForMarks);
    if (!hit) continue;
    const e = graph.edges[hit.edge];
    const da = hit.s;
    const db = e.length - hit.s;
    const near = da <= db ? e.a : e.b;
    const dNear = Math.min(da, db);
    if (dNear <= toJunction && isJunction(graph, near)) {
      if (!byNode.has(near)) byNode.set(near, { node: near, edge: hit.edge, s: hit.s, x: graph.nodeX[near], z: graph.nodeZ[near], y: graph.nodeY[near] });
      continue;
    }
    const pose = graph.pose(hit.edge, hit.s);
    if (mid.some((m) => Math.hypot(m.x - pose.x, m.z - pose.z) < 20)) continue;
    mid.push({ node: -1, edge: hit.edge, s: hit.s, x: pose.x, z: pose.z, y: pose.y });
  }
  return [...byNode.values(), ...mid];
}

/** Il punto sull'arco più vicino entro `reach` metri, se la strada è adatta ai segni per terra. */
export function snapToRoad(graph: WorldGraph, x: number, z: number, reach: number): { edge: number; s: number; d: number } | null {
  const hit = graph.nearest(x, z, reach, roadForMarks);
  return hit ? { edge: hit.edge, s: hit.s, d: hit.d } : null;
}

/** Strisce pedonali da disegnare: solo quelle segnate per terra (non «unmarked»). */
export function isPaintedCrossing(t: Tags): boolean {
  if (t.highway !== 'crossing') return false;
  if (t['crossing:markings'] && t['crossing:markings'] !== 'no') return true;
  if (t.crossing_ref === 'zebra') return true;
  return t.crossing === 'zebra' || t.crossing === 'marked' || t.crossing === 'uncontrolled' || t.crossing === 'traffic_signals';
}

/** Che luogo è, per chi pedala; null se non interessa. */
export function poiKind(t: Tags): PoiKind | null {
  const name = t.name ?? '';
  if (t.amenity === 'drinking_water' || (t.man_made === 'water_tap' && t.drinking_water === 'yes')) return 'fontanella';
  if (t.amenity === 'fountain') return 'fontana';
  if (t.tourism === 'viewpoint') return 'belvedere';
  if (t.shop === 'bicycle' || t.amenity === 'bicycle_repair_station') return 'bici';
  if (t.amenity === 'cafe') return 'bar';
  if (t.historic === 'wayside_shrine' || t.building === 'wayside_shrine') return 'edicola';
  if (t.historic === 'wayside_cross') return 'croce';
  if (t.historic === 'castle' || t.building === 'castle') return 'castello';
  if (t.man_made === 'campanile' || t.building === 'bell_tower' || t.building === 'campanile' || t['tower:type'] === 'bell_tower' || t.historic === 'bell_tower') return 'campanile';
  if (t.historic === 'tower' || (t.man_made === 'tower' && (t['tower:type'] === 'defensive' || !!t.historic))) return 'torre';
  if ((t.historic === 'bridge' || (t.man_made === 'bridge' && t.historic)) && name) return 'ponte';
  if (t.tourism === 'alpine_hut') return 'rifugio';
  if (t.amenity === 'place_of_worship' || t.building === 'church' || t.building === 'chapel' || t.building === 'cathedral' || t.building === 'basilica' || t.historic === 'church' || t.historic === 'chapel') {
    if (t.religion && t.religion !== 'christian') return null;
    return /santuario|sanctuary/i.test(name) ? 'santuario' : 'chiesa';
  }
  return null;
}

/** Fin dove dalla strada un luogo conta come «sulla strada», metri in pianta dalla mezzeria. */
export const POI_REACH: Record<PoiKind, number> = {
  fontanella: 35,
  fontana: 45,
  belvedere: 160,
  chiesa: 70,
  santuario: 220,
  campanile: 80,
  castello: 300,
  torre: 160,
  edicola: 30,
  croce: 30,
  ponte: 40,
  bici: 60,
  bar: 30,
  rifugio: 120,
};

/** I tipi che in OSM sono quasi sempre un edificio disegnato: lì il modellino non serve. */
export const POI_BUILT = new Set<PoiKind>(['chiesa', 'santuario', 'campanile', 'castello', 'torre', 'rifugio']);
