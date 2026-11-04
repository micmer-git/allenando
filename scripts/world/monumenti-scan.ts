// Scansione dei monumenti: cerca nei dati OSM (scripts/world/cache/osm) gli edifici e i
// monumenti più riconoscibili del mondo e li ordina per quanto contano e per quanto stanno
// vicino ai percorsi. Non decide niente: serve a scegliere a ragion veduta la lista di
// scripts/world/monumenti.ts e a controllarla dopo una nuova estrazione.
//
//   npx vite-node scripts/world/monumenti-scan.ts            i primi 90 candidati
//   npx vite-node scripts/world/monumenti-scan.ts -- 200     i primi 200
//
// Legge public/world/bergamo/{graph,rides}.json per le distanze dai percorsi: va lanciato
// dopo npm run world:build.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorldGraph, type WorldGraphFile } from '../../src/open/graph';
import type { RideDef } from '../../src/open/world';
import { ORIGIN } from './config.mjs';
import { SPECS } from './monumenti';

type Tags = Record<string, string>;
const ROOT = join(__dirname, '..', '..');
const OSM = join(__dirname, 'cache', 'osm');
const read = <T>(n: string): T[] => (existsSync(join(OSM, `${n}.json`)) ? (JSON.parse(readFileSync(join(OSM, `${n}.json`), 'utf8')) as { elements: T[] }).elements : []);

const RAD = Math.PI / 180;
const mLat = RAD * 6371008.8;
const mLon = mLat * Math.cos(ORIGIN.lat * RAD);
const toLocal = (lat: number, lon: number): [number, number] => [(lon - ORIGIN.lon) * mLon, -(lat - ORIGIN.lat) * mLat];

const graph = new WorldGraph(JSON.parse(readFileSync(join(ROOT, 'public/world/bergamo/graph.json'), 'utf8')) as WorldGraphFile);
const rides = JSON.parse(readFileSync(join(ROOT, 'public/world/bergamo/rides.json'), 'utf8')) as RideDef[];
// i percorsi come polilinee (un punto ogni 20 m basta per una distanza in pianta)
const lines = rides.map((r) => {
  const pts: [number, number][] = [];
  for (const [edge] of r.legs) {
    const e = graph.edges[edge];
    for (let k = 0; k < e.xs.length; k += 2) pts.push([e.xs[k], e.zs[k]]);
  }
  return { id: r.id, pts };
});
// il giro della Ganda non è ancora fra i percorsi: i suoi paesi bastano per la precedenza
const placesRaw = read<{ lat: number; lon: number; tags: Tags }>('places');
const GANDA = ['Nembro', 'Albino', 'Gazzaniga', 'Orezzo', 'Aviatico', 'Selvino'].map((n) => {
  const p = placesRaw.find((q) => q.tags.name === n && ['town', 'village', 'hamlet'].includes(q.tags.place));
  return p ? toLocal(p.lat, p.lon) : null;
});

function nearestRide(x: number, z: number): { id: string; d: number } {
  let best = { id: '-', d: Infinity };
  for (const l of lines) for (const [px, pz] of l.pts) {
    const d = Math.hypot(px - x, pz - z);
    if (d < best.d) best = { id: l.id, d };
  }
  for (const g of GANDA) if (g && Math.hypot(g[0] - x, g[1] - z) + 300 < best.d) best = { id: 'ganda', d: Math.hypot(g[0] - x, g[1] - z) + 300 };
  return best;
}

/** Quanto conta un elemento OSM, a occhio di chi pedala: 0 = niente. */
function weight(t: Tags): number {
  let w = 0;
  if (t.historic === 'castle' || t.building === 'castle') w = Math.max(w, 6);
  if (t.historic === 'city_gate' || /^Porta /.test(t.name ?? '')) w = Math.max(w, 7);
  if (t.building === 'basilica' || t.basilica || /^Basilica|^Duomo|Cattedrale/.test(t.name ?? '')) w = Math.max(w, 7);
  if (t.building === 'clock_tower' || t['tower:type'] === 'bell_tower' || t.historic === 'tower' || (t.man_made === 'tower' && t.historic)) w = Math.max(w, 6);
  if (t.historic === 'tomb' || t.tomb) w = Math.max(w, 7);
  if (t.memorial === 'statue' || t.artwork_type === 'statue' || t.memorial === 'bust') w = Math.max(w, 4);
  if (t.memorial === 'war_memorial' || /caduti/i.test(t.name ?? '')) w = Math.max(w, 4);
  if (t.historic === 'monument') w = Math.max(w, 5);
  if (t.amenity === 'theatre' || t.amenity === 'casino' || t['disused:amenity'] === 'casino') w = Math.max(w, 5);
  if (t.building === 'hotel' && t.height) w = Math.max(w, 5);
  if (t.station === 'funicular' || t.aerialway === 'station') w = Math.max(w, 5);
  if (t.amenity === 'place_of_worship' && /santuario/i.test(t.name ?? '')) w = Math.max(w, 4);
  if (t.amenity === 'place_of_worship' && w === 0) w = 2;
  if (t.tourism === 'attraction') w += 2;
  if (t.wikidata || t.wikipedia) w += 1;
  if (t.historic === 'palace' || t.historic === 'building') w = Math.max(w, 4);
  return w;
}

interface Cand {
  ref: string;
  name: string;
  w: number;
  x: number;
  z: number;
  tags: Tags;
}
const cands = new Map<string, Cand>();
const add = (ref: string, tags: Tags, lat: number, lon: number) => {
  const name = tags.name ?? (tags.artwork_subject ? `(${tags.artwork_subject})` : '');
  if (!name) return;
  const w = weight(tags);
  if (w < 4) return;
  const [x, z] = toLocal(lat, lon);
  const same = [...cands.values()].find((c) => c.name === name && Math.hypot(c.x - x, c.z - z) < 80);
  if (same) return;
  cands.set(ref, { ref, name, w, x, z, tags });
};
for (const p of read<{ type: string; id: number; center: { lat: number; lon: number }; tags: Tags }>('pois')) add(`${p.type === 'node' ? 'n' : p.type === 'way' ? 'w' : 'a'}${p.id}`, p.tags, p.center.lat, p.center.lon);
for (const p of read<{ type: string; id: number; lat?: number; lon?: number; geometry?: { lat: number; lon: number }[]; outer?: [number, number][][]; tags: Tags }>('monumenti-nodi')) {
  if (p.type === 'node') add(`n${p.id}`, p.tags, p.lat!, p.lon!);
  else if (p.geometry) add(`w${p.id}`, p.tags, p.geometry.reduce((s, g) => s + g.lat, 0) / p.geometry.length, p.geometry.reduce((s, g) => s + g.lon, 0) / p.geometry.length);
  else if (p.outer) add(`r${p.id}`, p.tags, p.outer[0].reduce((s, g) => s + g[1], 0) / p.outer[0].length, p.outer[0].reduce((s, g) => s + g[0], 0) / p.outer[0].length);
}

const chosen = new Set(SPECS.map((s) => s.ref.replace(/^[wr]/, 'a')).concat(SPECS.map((s) => s.ref)));
const top = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 90);
const rows = [...cands.values()]
  .map((c) => {
    const r = nearestRide(c.x, c.z);
    // la vicinanza a un percorso pesa quanto il monumento: a 2 km non lo vede nessuno
    const score = c.w + (r.d < 150 ? 4 : r.d < 400 ? 3 : r.d < 900 ? 2 : r.d < 2000 ? 1 : 0);
    return { ...c, ride: r.id, d: r.d, score };
  })
  .sort((a, b) => b.score - a.score || a.d - b.d)
  .slice(0, top);
console.log(`${cands.size} candidati, i primi ${rows.length} (★ = già nella lista di monumenti.ts):`);
for (const r of rows) {
  const k = Object.entries(r.tags)
    .filter(([key]) => /^(historic|building|memorial|artwork_type|tourism|amenity|man_made|height|tower:type|station|aerialway)$/.test(key))
    .map(([key, v]) => `${key}=${v}`)
    .join(' ');
  console.log(`${chosen.has(r.ref) ? '★' : ' '} ${String(r.score).padStart(2)} ${r.ref.padEnd(13)} ${r.name.slice(0, 44).padEnd(44)} ${r.ride.padEnd(17)} ${String(Math.round(r.d)).padStart(5)} m  ${k}`);
}
