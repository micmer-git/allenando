import { CLS } from './graph';
import { suggestLoops } from './loops';
import { savePlan } from './plan';
import type { WorldData } from './world';

/**
 * Da dove si parte nel mondo: i paesi del giro libero e il punto preciso. Li usano la scheda
 * Libero del Mondo e la pagina Allenamenti (un allenamento nel giro libero o su un anello).
 */

/** I paesi da cui si parte, presi dai dati del mondo. */
export const START_TOWNS = ['Bergamo', 'Città Alta', 'Ponteranica', 'Alzano Lombardo', 'Nembro', 'Albino', 'Gazzaniga', 'Ponte Nossa', 'Clusone', 'Castione della Presolana', 'Villa d’Almè', 'Zogno', 'San Pellegrino Terme', 'San Giovanni Bianco', 'Piazza Brembana', 'Branzi', 'Serina', 'Selvino'];

const norm = (s: string) => s.replace(/[’']/g, "'");

export function townPoint(data: WorldData, name: string): { x: number; z: number } | null {
  if (name === 'Città Alta') {
    const lm = data.features.landmarks.find((l) => /Piazza Vecchia/.test(l.name));
    if (lm) return lm;
  }
  return data.features.places.find((pl) => norm(pl.name) === norm(name) && pl.kind !== 'hamlet') ?? null;
}

/**
 * I parametri del giro libero da un punto: arco, metri e verso. Una strada vera (graph.freeStart),
 * e da un paese quella che lo attraversa: a Nembro il punto più vicino era un anellino di pista.
 */
export function freeQueryAt(data: WorldData, x: number, z: number, town = false): string | null {
  const hit = data.graph.freeStart(x, z, 400, town);
  if (!hit) return null;
  const e = data.graph.edges[hit.edge];
  const dir = data.graph.allowed(hit.edge, 1) ? 1 : -1;
  return `world=bergamo&edge=${hit.edge}&s=${Math.round(Math.min(e.length - 1, hit.s))}&dir=${dir}`;
}

/** I parametri del giro libero da un paese. */
export function freeStartQuery(data: WorldData, name: string): string | null {
  const p = townPoint(data, name);
  return p ? freeQueryAt(data, p.x, p.z, true) : null;
}

/**
 * Un anello suggerito da un paese, lungo più o meno `km`: si calcola, si mette da parte per la
 * pedalata (savePlan) e se ne danno i parametri. Null se da lì non esce niente.
 */
export function loopStartQuery(data: WorldData, name: string, km: number): string | null {
  const p = townPoint(data, name);
  if (!p) return null;
  const node = data.graph.nearestNode(p.x, p.z, 600, (e) => e.cls !== CLS.trunk && e.cls !== CLS.pedestrian);
  if (node == null) return null;
  const best = suggestLoops(data.graph, node, { targetM: km * 1000, taste: 'misto', places: data.features.places })[0];
  if (!best) return null;
  const key = savePlan({ legs: best.legs, name: `Anello da ${name}` });
  return `world=bergamo&plan=${key}`;
}
