import type { Leg } from './graph';

/**
 * Un anello suggerito passa dalla pagina Mondo alla pedalata senza finire nell'indirizzo
 * (centinaia di archi non stanno in un link): resta nella sessione della scheda.
 */

export interface Plan {
  legs: Leg[];
  name: string;
}

const mem = new Map<string, Plan>();

export function savePlan(plan: Plan): string {
  const key = Math.random().toString(36).slice(2, 10);
  mem.set(key, plan);
  try {
    sessionStorage.setItem(`allenando.plan.${key}`, JSON.stringify({ name: plan.name, legs: plan.legs.map((l) => [l.edge, l.dir]) }));
  } catch {
    /* modalità privata: resta in memoria */
  }
  return key;
}

export function loadPlan(key: string): Plan | null {
  const have = mem.get(key);
  if (have) return have;
  try {
    const raw = sessionStorage.getItem(`allenando.plan.${key}`);
    if (!raw) return null;
    const j = JSON.parse(raw) as { name: string; legs: [number, 1 | -1][] };
    return { name: j.name, legs: j.legs.map(([edge, dir]) => ({ edge, dir })) };
  } catch {
    return null;
  }
}
