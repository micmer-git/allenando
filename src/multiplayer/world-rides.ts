/**
 * I mondi che il server della classifica conosce, messi insieme. Ogni mondo ha il suo file
 * generato da scripts/world/build-world.ts (world-rides-<id>.ts): numero di archi del grafo e,
 * per ogni percorso, lunghezza del tratto cronometrato e tempo minimo credibile. Gli id dei
 * percorsi sono unici fra i mondi: una classifica per percorso è già una classifica per mondo.
 */

import * as bergamo from './world-rides-bergamo';
import * as sellaronda from './world-rides-sellaronda';

export interface WorldLimits {
  id: string;
  edges: number;
  rides: Record<string, { timedM: number; minSec: number }>;
}

export const WORLD_LIMITS: readonly WorldLimits[] = [
  { id: bergamo.WORLD_ID, edges: bergamo.WORLD_EDGES, rides: bergamo.WORLD_RIDES },
  { id: sellaronda.WORLD_ID, edges: sellaronda.WORLD_EDGES, rides: sellaronda.WORLD_RIDES },
];

/** Gli id dei mondi, nell'ordine in cui si mostrano. */
export const WORLD_IDS: readonly string[] = WORLD_LIMITS.map((w) => w.id);

export function isWorldId(v: unknown): v is string {
  return typeof v === 'string' && WORLD_IDS.includes(v);
}

/** Archi del grafo di un mondo (0 se il mondo non c'è). */
export function worldEdges(id: string): number {
  return WORLD_LIMITS.find((w) => w.id === id)?.edges ?? 0;
}

/** Tutti i percorsi di tutti i mondi, per id. */
export const WORLD_RIDES: Record<string, { timedM: number; minSec: number }> = Object.assign({}, ...WORLD_LIMITS.map((w) => w.rides));

/** Il mondo di un percorso, dal suo id; undefined se nessun mondo lo ha. */
const RIDE_WORLD: Record<string, string> = {};
for (const w of WORLD_LIMITS) for (const id of Object.keys(w.rides)) RIDE_WORLD[id] = w.id;
export function worldOfRide(rideId: string): string | undefined {
  return RIDE_WORLD[rideId];
}

/** Per chi vuole ancora un solo mondo: il primo, Bergamo. */
export const WORLD_ID = bergamo.WORLD_ID;
export const WORLD_EDGES = bergamo.WORLD_EDGES;
