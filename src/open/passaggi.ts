import type { Dir, Leg, WorldGraph } from './graph';
import { WorldPath } from './path';

/**
 * I passaggi di un percorso (A12–A13 del piano U): su un anello si ripete il giro, su un
 * percorso aperto si va e si torna sulla stessa strada (1 = andata, 2 = andata e ritorno, …).
 * Il tetto è di 20: oltre si prosegue libero.
 */

export const PASSAGGI_MAX = 20;

/** Il percorso si chiude su sé stesso: finisce nel nodo da cui parte. */
export function chiuso(graph: WorldGraph, legs: Leg[]): boolean {
  if (legs.length < 2) return false;
  const first = legs[0];
  const last = legs[legs.length - 1];
  return graph.startNode(first.edge, first.dir) === graph.endNode(last.edge, last.dir);
}

/** Lo stesso percorso al contrario: i tratti in ordine inverso, ognuno nell'altro verso. */
export function rovescia(legs: Leg[]): Leg[] {
  return legs
    .slice()
    .reverse()
    .map((l) => ({ edge: l.edge, dir: (l.dir > 0 ? -1 : 1) as Dir }));
}

/** `n` passaggi: il giro ripetuto sull'anello, andata e ritorno alternati sul percorso aperto. */
export function passaggi(legs: Leg[], n: number, isChiuso: boolean): Leg[] {
  const k = Math.min(PASSAGGI_MAX, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
  const back = isChiuso ? legs : rovescia(legs);
  const out: Leg[] = [];
  for (let i = 0; i < k; i++) out.push(...(i % 2 === 0 ? legs : back).map((l) => ({ ...l })));
  return out;
}

/**
 * Il ritorno su una strada a senso unico non si fa contromano: il pezzo vietato si sostituisce
 * con la strada più breve fra i suoi due capi. Se non c'è, resta quello che c'era.
 */
export function percorribili(graph: WorldGraph, legs: Leg[]): Leg[] {
  const out: Leg[] = [];
  let i = 0;
  while (i < legs.length) {
    if (graph.allowed(legs[i].edge, legs[i].dir)) {
      out.push(legs[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < legs.length && !graph.allowed(legs[j].edge, legs[j].dir)) j++;
    const from = graph.startNode(legs[i].edge, legs[i].dir);
    const to = graph.endNode(legs[j - 1].edge, legs[j - 1].dir);
    const way = from === to ? [] : graph.route(from, to);
    out.push(...(way ?? legs.slice(i, j)));
    i = j;
  }
  return out;
}

/** Il profilo (metri, quota) di un percorso del mondo, ogni `passo` metri: per la stima del giro. */
export function profiloDiLegs(graph: WorldGraph, legs: Leg[], passo = 25): { distance: number; altitude: number }[] {
  if (legs.length === 0) return [];
  const first = legs[0];
  const path = new WorldPath(graph, { edge: first.edge, dir: first.dir, s: first.dir > 0 ? 0 : graph.edges[first.edge].length });
  for (let i = 1; i < legs.length; i++) path.append(legs[i].edge, legs[i].dir);
  const out: { distance: number; altitude: number }[] = [];
  for (let d = 0; d < path.length; d += passo) out.push({ distance: d, altitude: path.poseAt(d).altitude });
  out.push({ distance: path.length, altitude: path.poseAt(path.length).altitude });
  return out;
}
