// Rifà solo public/world/bergamo/monumenti.json, senza ricostruire tutto il mondo: serve a
// provare una scheda di scripts/world/monumenti.ts in pochi secondi. Gli edifici generici da
// togliere li toglie solo npm run world:build (b/*.json).
//
//   npx vite-node scripts/world/monumenti-solo.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorldGraph, type WorldGraphFile } from '../../src/open/graph';
import { HORIZON, ORIGIN, REGION } from './config.mjs';
import { loadDem } from './dem.mjs';
import { buildMonumenti } from './monumenti';

const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, 'public', 'world', 'bergamo');
const RAD = Math.PI / 180;
const mLat = RAD * 6371008.8;
const mLon = mLat * Math.cos(ORIGIN.lat * RAD);
const toLocal = (lat: number, lon: number): [number, number] => [(lon - ORIGIN.lon) * mLon, -(lat - ORIGIN.lat) * mLat];
const toGeo = (x: number, z: number) => ({ lat: ORIGIN.lat - z / mLat, lon: ORIGIN.lon + x / mLon });

const dem13 = await loadDem(13, { s: REGION.s - 0.03, w: REGION.w - 0.03, n: REGION.n + 0.03, e: REGION.e + 0.03 });
const dem11 = await loadDem(11, HORIZON);
const demAt = (x: number, z: number): number => {
  const g = toGeo(x, z);
  const v = dem13.sample(g.lat, g.lon);
  return Number.isFinite(v) ? v : dem11.sample(g.lat, g.lon);
};
const graph = new WorldGraph(JSON.parse(readFileSync(join(OUT, 'graph.json'), 'utf8')) as WorldGraphFile);
const t0 = Date.now();
const { file } = buildMonumenti({ world: 'bergamo', toLocal, demAt, graph, osmDir: join(__dirname, 'cache', 'osm'), outDir: OUT, log: console.log });
for (const m of file.monumenti) console.log(`${m.id.padEnd(13)} ${m.kind.padEnd(9)} ${m.name.slice(0, 40).padEnd(40)} ${m.w}×${m.d}×${m.h} y ${m.y} (min ${m.yMin}) yaw ${Math.round((m.yaw * 180) / Math.PI)}° ${m.rings.length} anelli ${JSON.stringify(m.p).slice(0, 60)}`);
console.log(`fatto in ${Date.now() - t0} ms`);
