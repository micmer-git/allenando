// I punti di collaudo di un mondo per scripts/world-shot.mjs: stampa la stringa SPOTS pronta
// (nome|/ride?world=…&edge=…&s=…&dir=…;…), con il verso di marcia che guarda il bersaglio.
//
//   WORLD=sellaronda npx vite-node scripts/world/spots.ts
//   SPOTS="$(WORLD=sellaronda npx vite-node scripts/world/spots.ts)" ONLY_RIDE=1 node scripts/world-shot.mjs http://localhost:4181/allenando out

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projector } from '../../src/domain/geo';
import { WorldGraph, type WorldGraphFile } from '../../src/open/graph';
import { WORLD } from './config.mjs';

/** nome, lat/lon del punto sulla strada, lat/lon di quello che si guarda */
const SPOTS: Record<string, [string, number, number, number, number][]> = {
  sellaronda: [
    ['sella-sassolungo', 46.5083, 11.7625, 46.5249, 11.7353],
    ['schiavaneis-sella', 46.5015, 11.7945, 46.5116, 11.7849],
    ['pordoi-marmolada', 46.4876, 11.8122, 46.4345, 11.8513],
    ['pordoi-sasspordoi', 46.4878, 11.8118, 46.5007, 11.808],
    ['gardena-cir', 46.5498, 11.8084, 46.5585, 11.8062],
    ['corvara-sassongher', 46.5496, 11.874, 46.5679, 11.8643],
    ['arabba-padon', 46.4972, 11.8741, 46.47, 11.88],
    ['selva-sassolungo', 46.5552, 11.7601, 46.5249, 11.7353],
  ],
  bergamo: [
    ['gazzaniga-ponte', 45.7965, 9.8388, 45.79, 9.84],
    ['presolana', 45.9346, 10.0744, 45.94, 10.06],
  ],
};

const file = JSON.parse(readFileSync(join('public', 'world', WORLD.id, 'graph.json'), 'utf8')) as WorldGraphFile;
const graph = new WorldGraph(file);
const proj = projector(graph.origin);
const out: string[] = [];
for (const [name, lat, lon, tlat, tlon] of SPOTS[WORLD.id] ?? []) {
  const p = proj.toLocal({ lat, lon });
  const t = proj.toLocal({ lat: tlat, lon: tlon });
  const hit = graph.nearest(p.x, p.z, 400, (e) => e.cls <= 4);
  if (!hit) {
    console.error(`${name}: nessuna strada entro 400 m`);
    continue;
  }
  const e = graph.edges[hit.edge];
  const ahead = graph.pose(hit.edge, Math.min(e.length, hit.s + 30), 1);
  const back = graph.pose(hit.edge, Math.max(0, hit.s - 30), 1);
  let dir: 1 | -1 = Math.hypot(ahead.x - t.x, ahead.z - t.z) <= Math.hypot(back.x - t.x, back.z - t.z) ? 1 : -1;
  if (!graph.allowed(hit.edge, dir)) dir = dir === 1 ? -1 : 1;
  out.push(`${name}|/ride?world=${WORLD.id}&edge=${hit.edge}&s=${Math.round(hit.s)}&dir=${dir}`);
}
console.log(out.join(';'));
