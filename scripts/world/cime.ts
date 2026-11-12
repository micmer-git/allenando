// Le quote delle cime nel terreno costruito, contro quelle di OSM (`natural=peak` `ele`): per ogni
// cima il nodo più alto delle mattonelle del DEM entro 40 m dal punto di OSM.
//
//   npx vite-node scripts/world/cime.ts                         (public/world/sellaronda)
//   DIR=altra/cartella/world/sellaronda npx vite-node scripts/world/cime.ts
//
// La stessa misura la fa tests/rilievo.test.ts, con le cime principali del Sellaronda entro ±10 m.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { peakHeights, CIME_SELLARONDA } from '../../src/open/cime';

const dir = process.env.DIR ?? join('public', 'world', 'sellaronda');
const rows = peakHeights(dir, (f) => readFileSync(join(dir, f)), process.env.TUTTE ? null : CIME_SELLARONDA);
console.log('| cima | OSM | terreno | scarto | passo |');
console.log('|---|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.name} | ${r.ele} | ${r.dem.toFixed(0)} | ${r.dem - r.ele >= 0 ? '+' : ''}${(r.dem - r.ele).toFixed(0)} | ${r.step} m |`);
