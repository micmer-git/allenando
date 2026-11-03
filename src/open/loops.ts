import type { Leg, RoutePrefs, WorldGraph } from './graph';
import type { Place } from './world';

/**
 * Giri ad anello suggeriti: partenza e arrivo nello stesso punto, la lunghezza chiesta, poca
 * strada fatta due volte. Il metodo è un triangolo sul grafo: dal via a un punto A a circa un
 * terzo della distanza, da A a un punto B in un'altra direzione, da B a casa; le strade già
 * usate costano cinque volte tanto, così il ritorno ne cerca un'altra. Si provano dodici
 * direzioni e si tengono i tre anelli migliori e diversi fra loro.
 */

export type LoopTaste = 'piatto' | 'misto' | 'salita';

export interface LoopSuggestion {
  legs: Leg[];
  lengthM: number;
  gainM: number;
  /** quota di strada percorsa due volte, 0-1 */
  overlap: number;
  /** i paesi per cui passa, nell'ordine */
  via: string[];
  bearing: number;
}

export interface LoopOptions {
  targetM: number;
  taste?: LoopTaste;
  prefs?: RoutePrefs;
  places?: Place[];
  /** quante direzioni provare (12 di solito, meno nei test) */
  directions?: number;
}

export function suggestLoops(graph: WorldGraph, start: number, opts: LoopOptions): LoopSuggestion[] {
  const L = opts.targetM;
  const dirs = opts.directions ?? 12;
  const reach = graph.reach(start, L * 0.75, opts.prefs);
  const sx = graph.nodeX[start];
  const sz = graph.nodeZ[start];
  // i candidati: nodi a una distanza di rete fra 0,22 e 0,42 di L, per settore di direzione
  const bySector: number[][] = Array.from({ length: dirs }, () => []);
  for (let v = 0; v < graph.nodeCount; v++) {
    const d = reach.dist[v];
    if (!(d > L * 0.22 && d < L * 0.42)) continue;
    const a = Math.atan2(graph.nodeX[v] - sx, -(graph.nodeZ[v] - sz));
    const sector = Math.floor((((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * dirs) % dirs;
    bySector[sector].push(v);
  }
  const pickIn = (sector: number, seed: number): number | null => {
    const list = bySector[((sector % dirs) + dirs) % dirs];
    if (list.length === 0) return null;
    // il più lontano in linea d'aria fra i più vicini al terzo: anelli larghi, non spaghetti
    let best = list[0];
    let score = -Infinity;
    for (let i = 0; i < list.length; i += Math.max(1, Math.floor(list.length / 60))) {
      const v = list[(i + seed) % list.length];
      const air = Math.hypot(graph.nodeX[v] - sx, graph.nodeZ[v] - sz);
      const s = air / (reach.dist[v] || 1) - Math.abs(reach.dist[v] - L / 3) / L;
      if (s > score) {
        score = s;
        best = v;
      }
    }
    return best;
  };
  const out: LoopSuggestion[] = [];
  for (let s = 0; s < dirs; s++) {
    const A = pickIn(s, s * 7);
    const B = pickIn(s + Math.round(dirs / 4), s * 13 + 3) ?? pickIn(s + Math.round(dirs / 3), s);
    if (A == null || B == null || A === B) continue;
    const penalty = new Map<number, number>();
    const leg1 = graph.route(start, A, opts.prefs);
    if (!leg1) continue;
    for (const l of leg1) penalty.set(l.edge, 5);
    const leg2 = graph.route(A, B, opts.prefs, penalty);
    if (!leg2) continue;
    for (const l of leg2) penalty.set(l.edge, 5);
    const leg3 = graph.route(B, start, opts.prefs, penalty);
    if (!leg3) continue;
    const legs = [...leg1, ...leg2, ...leg3];
    const lengthM = graph.legsLength(legs);
    const seen = new Map<number, number>();
    for (const l of legs) seen.set(l.edge, (seen.get(l.edge) ?? 0) + 1);
    let twice = 0;
    for (const [id, n] of seen) if (n > 1) twice += graph.edges[id].length * (n - 1);
    out.push({ legs, lengthM, gainM: graph.legsGain(legs), overlap: twice / lengthM, via: viaPlaces(graph, legs, opts.places ?? []), bearing: (s / dirs) * 360 });
  }
  const taste = opts.taste ?? 'misto';
  const score = (c: LoopSuggestion) => {
    const lenErr = Math.abs(c.lengthM - L) / L;
    const climb = c.gainM / (c.lengthM / 1000);
    const tasteErr = taste === 'piatto' ? climb / 25 : taste === 'salita' ? Math.max(0, 1 - climb / 35) : 0;
    return lenErr * 2 + c.overlap * 1.5 + tasteErr;
  };
  out.sort((a, b) => score(a) - score(b));
  // tre anelli che non si somigliano: direzioni ad almeno 60° l'una dall'altra
  const chosen: LoopSuggestion[] = [];
  for (const c of out) {
    if (chosen.every((k) => Math.abs(((k.bearing - c.bearing + 540) % 360) - 180) >= 60)) chosen.push(c);
    if (chosen.length === 3) break;
  }
  return chosen;
}

/** I paesi toccati, nell'ordine: il nome di un anello è la fila dei suoi paesi. */
export function viaPlaces(graph: WorldGraph, legs: Leg[], places: Place[]): string[] {
  const towns = places.filter((p) => p.kind === 'town' || p.kind === 'village' || p.kind === 'city' || p.kind === 'suburb');
  const out: string[] = [];
  let acc = 0;
  for (const l of legs) {
    const e = graph.edges[l.edge];
    acc += e.length;
    if (acc < 400) continue;
    acc = 0;
    const p = graph.pose(l.edge, e.length / 2);
    let best: Place | null = null;
    let bestD = 650;
    for (const t of towns) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best && out[out.length - 1] !== best.name && !out.includes(best.name)) out.push(best.name);
  }
  return out;
}
