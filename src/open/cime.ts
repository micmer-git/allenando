import { decodeDemTile, type DemTile } from './world';
import type { WorldGraphFile } from './graph';

/*
 * Le quote delle cime nel terreno costruito, contro OSM. Niente DOM né three.js: la usano
 * scripts/world/cime.ts (la tabella del rapporto) e tests/rilievo.test.ts (la prova ±10 m).
 */

/** Le cime che dalle 13 viste si devono riconoscere, coi nomi di features.json (italiani). */
export const CIME_SELLARONDA = [
  'Sassolungo',
  'Punta Grohmann',
  'Punta delle Cinque Dita',
  'Spallone del Sassolungo',
  'Sasso Piatto',
  'I° Torre del Sella',
  'II° Torre del Sella',
  'III° Torre del Sella',
  'Piz Ciavazes',
  'Piz Boè',
  'Sasso Pordoi',
  'Grande Cir',
  'Sassongher',
  'Punta Penia',
];

export interface PeakHeight {
  name: string;
  /** quota di OSM */
  ele: number;
  /** il nodo più alto del DEM entro `radius` metri */
  dem: number;
  /** il passo della mattonella che lo contiene, m */
  step: number;
  x: number;
  z: number;
}

/**
 * Per ogni cima con nome (tutte, o quelle di `names`), il nodo più alto delle mattonelle del DEM
 * entro `radius` metri dal punto di OSM. `read(f)` legge un file della cartella del mondo.
 */
export function peakHeights(dir: string, read: (f: string) => Uint8Array, names: string[] | null, radius = 40): PeakHeight[] {
  void dir;
  const graph = JSON.parse(new TextDecoder().decode(read('graph.json'))) as WorldGraphFile;
  const features = JSON.parse(new TextDecoder().decode(read('features.json'))) as { peaks: [string, number, number, number, number][] };
  const b = graph.bounds;
  const T = graph.tile;
  const n0 = Math.round(T / graph.demStep);
  const tiles = new Map<string, DemTile | null>();
  const tile = (tx: number, tz: number): DemTile | null => {
    const key = `${tx}_${tz}`;
    if (!tiles.has(key)) {
      let t: DemTile | null = null;
      try {
        t = decodeDemTile(read(`dem/${key}.bin`), n0, tx, tz);
      } catch {
        t = null;
      }
      tiles.set(key, t);
    }
    return tiles.get(key) ?? null;
  };
  const out: PeakHeight[] = [];
  const wanted = names ? features.peaks.filter((p) => names.some((n) => p[0] === n || p[0].startsWith(`${n} `))) : features.peaks.filter((p) => !p[4]);
  for (const [name, x, z, ele] of wanted) {
    let best = -Infinity;
    let step = 0;
    for (let tx = Math.floor((x - radius - b.x0) / T); tx <= Math.floor((x + radius - b.x0) / T); tx++) {
      for (let tz = Math.floor((z - radius - b.z0) / T); tz <= Math.floor((z + radius - b.z0) / T); tz++) {
        const t = tile(tx, tz);
        if (!t) continue;
        const s = T / t.n;
        for (let j = 0; j <= t.n; j++) {
          const zz = b.z0 + tz * T + j * s;
          if (Math.abs(zz - z) > radius) continue;
          for (let i = 0; i <= t.n; i++) {
            const xx = b.x0 + tx * T + i * s;
            if (Math.hypot(xx - x, zz - z) > radius) continue;
            const h = t.h[j * (t.n + 1) + i];
            if (h > best) {
              best = h;
              step = s;
            }
          }
        }
      }
    }
    if (Number.isFinite(best)) out.push({ name, ele, dem: best, step, x, z });
  }
  // nell'ordine della lista, se c'è
  if (names) out.sort((p, q) => names.findIndex((n) => p.name.startsWith(n)) - names.findIndex((n) => q.name.startsWith(n)));
  return out;
}
