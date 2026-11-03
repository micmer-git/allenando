import { CLS, type Leg, type RoutePrefs, type WorldGraph } from './graph';
import { viaPlaces } from './loops';
import type { Place } from './world';

/*
 * Da A a B: il navigatore del mondo aperto. Si sceglie dove partire e dove arrivare (un paese o un
 * punto sulla carta) e la strada più adatta a una bici; con «e ritorno» si torna al via per un'altra
 * strada, pesando di più quella già fatta.
 */

export interface AbOptions {
  /** andata e ritorno, il ritorno per un'altra strada se c'è */
  back?: boolean;
  prefs?: RoutePrefs;
}

export interface AbRoute {
  legs: Leg[];
  lengthM: number;
  gainM: number;
  /** paesi attraversati, nell'ordine */
  via: string[];
  /** quota di strada fatta due volte, 0–1 (solo con il ritorno) */
  overlap: number;
}

const notTrunk = (e: { cls: number }) => e.cls !== CLS.trunk;

export function planAB(graph: WorldGraph, places: Place[], a: { x: number; z: number }, b: { x: number; z: number }, opts: AbOptions = {}): AbRoute | null {
  const from = graph.nearestNode(a.x, a.z, 600, notTrunk);
  const to = graph.nearestNode(b.x, b.z, 600, notTrunk);
  if (from == null || to == null || from === to) return null;
  const out = graph.route(from, to, opts.prefs);
  if (!out || out.length === 0) return null;
  let legs = out;
  let overlap = 0;
  if (opts.back) {
    // al ritorno la strada dell'andata costa 2,5 volte: si torna per un'altra, se non allunga troppo
    const penalty = new Map<number, number>();
    for (const l of out) penalty.set(l.edge, 2.5);
    const ret = graph.route(to, from, opts.prefs, penalty);
    if (!ret) return null;
    const used = new Set(out.map((l) => l.edge));
    let shared = 0;
    for (const l of ret) if (used.has(l.edge)) shared += graph.edges[l.edge].length;
    legs = [...out, ...ret];
    overlap = shared / Math.max(1, graph.legsLength(ret));
  }
  return { legs, lengthM: graph.legsLength(legs), gainM: graph.legsGain(legs), via: viaPlaces(graph, legs, places), overlap };
}
