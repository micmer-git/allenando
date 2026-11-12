/** Attributi OSM di una singola impronta. Gli ingressi sono [lato, frazione in millesimi, box auto 0/1]. */
export interface Architecture {
  kind?: 'garage' | 'fienile' | 'rimessa' | 'baita';
  roof?: 'flat' | 'gable' | 'hip';
  wallColour?: string;
  roofColour?: string;
  entrances?: [number, number, number][];
}

type Hints = Record<string, Architecture>;
const worlds = new Map<string, Promise<Hints>>();

/** Lo stesso hash dei vertici assoluti (dm) di scripts/world/facciate.py. Le revisioni delle quote
 * non cambiano l'associazione. Un'impronta ridisegnata usa l'archetipo ordinario. */
export function footprintKey(ring: Float32Array): string {
  let state = 2166136261;
  for (let i = 0; i < ring.length; i++) state = Math.imul(state ^ Math.round(ring[i] * 10), 16777619);
  return String(state >>> 0);
}

export function loadArchitecture(id: string): Promise<Hints> {
  const have = worlds.get(id);
  if (have) return have;
  const source = id === 'bergamo' ? import('./facciate-data/bergamo.json') :
    id === 'sellaronda' ? import('./facciate-data/sellaronda.json') : null;
  const pending = source ? source.then(m => m.default as unknown as Hints).catch(() => {
    worlds.delete(id);
    return {};
  }) : Promise.resolve({});
  worlds.set(id, pending);
  return pending;
}

