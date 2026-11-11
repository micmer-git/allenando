// Le viste del Sellaronda da mettere accanto alle foto (pista S2, voce S2.13): per ogni vista il
// punto sulla strada (edge, s, dir) e la camera di collaudo CAM="indietro,su,lato,gradi,inclinazione"
// che guarda la cima giusta. Stampa la stringa SPOTS per scripts/world-shot.mjs.
//
//   npx vite-node scripts/world/viste.ts                      (tutte)
//   VISTE=sella-sassolungo,pordoi-marmolada npx vite-node scripts/world/viste.ts
//   SPOTS="$(npx vite-node scripts/world/viste.ts)" VIEW=960x600 NOON=1 SERENO=1 CLEAN=1 node scripts/world-shot.mjs http://localhost:4182/allenando out
//
// Le cime e i passi si cercano per nome nei dati del mondo (features.json, monumenti.json): niente
// coordinate a mano per quello che OSM sa; a mano solo il punto da cui si guarda.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projector } from '../../src/domain/geo';
import { WorldGraph, type WorldGraphFile } from '../../src/open/graph';
import { WorldPath } from '../../src/open/path';
import { Terrain, type RideDef } from '../../src/open/world';

const dir = join('public', 'world', 'sellaronda');
const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
const features = JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as { peaks: [string, number, number, number, number][]; lifts: [string, string, number, number, number][] };
const monumenti = (JSON.parse(readFileSync(join(dir, 'monumenti.json'), 'utf8')) as { monumenti: { name: string; x: number; z: number; y: number; h: number }[] }).monumenti;
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[] | { rides: RideDef[] };
const rideList = Array.isArray(rides) ? rides : rides.rides;
globalThis.fetch = (async (url: string) => {
  try {
    const b = readFileSync(join(dir, String(url).replace(/^.*\/world\/sellaronda\//, '')));
    return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  } catch {
    return { ok: false };
  }
}) as unknown as typeof fetch;
const terrain = new Terrain(graph, '/world/sellaronda/');
await terrain.loadFar();
const proj = projector(graph.origin);

type P = { x: number; z: number; y?: number };
const peak = (name: string): P => {
  const p = features.peaks.find((q) => q[0] === name);
  if (!p) throw new Error(`cima sconosciuta: ${name}`);
  return { x: p[1], z: p[2], y: p[3] };
};
const mon = (name: string): P => {
  const m = monumenti.find((q) => q.name === name);
  if (!m) throw new Error(`monumento sconosciuto: ${name}`);
  return { x: m.x, z: m.z, y: m.y + m.h * 0.5 };
};
const geo = (lat: number, lon: number): P => proj.toLocal({ lat, lon });
const lift = (name: string): P => {
  const l = features.lifts.find((q) => q[1] === name);
  if (!l) throw new Error(`impianto sconosciuto: ${name}`);
  return { x: l[2], z: l[3], y: l[4] };
};
/** un punto di un percorso, a una frazione della sua lunghezza */
const onRide = (ride: string, frac: number): P => {
  const r = rideList.find((q) => q.id === ride)!;
  const [first, ...rest] = r.legs;
  const e0 = graph.edges[first[0]];
  const path = new WorldPath(graph, { edge: first[0], dir: first[1], s: first[1] > 0 ? 0 : e0.length });
  for (const [e, d] of rest) path.append(e, d);
  const p = path.poseAt(path.length * frac);
  return { x: p.x, z: p.z };
};
/** il tornante più stretto di un percorso fra due distanze */
const hairpin = (ride: string, d0: number, d1: number): { at: P; ahead: P } => {
  const r = rideList.find((q) => q.id === ride)!;
  const [first, ...rest] = r.legs;
  const e0 = graph.edges[first[0]];
  const path = new WorldPath(graph, { edge: first[0], dir: first[1], s: first[1] > 0 ? 0 : e0.length });
  for (const [e, d] of rest) path.append(e, d);
  let best = { d: d0, turn: 0 };
  for (let d = d0; d < Math.min(d1, path.length - 40); d += 5) {
    let dh = path.poseAt(d + 25).heading - path.poseAt(d - 25).heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    if (Math.abs(dh) > best.turn) best = { d, turn: Math.abs(dh) };
  }
  const a = path.poseAt(best.d - 70);
  const b = path.poseAt(best.d);
  return { at: { x: a.x, z: a.z }, ahead: { x: b.x, z: b.z, y: b.y } };
};

interface Vista {
  name: string;
  /** da dove si guarda (un punto vicino alla strada) */
  from: P;
  /** cosa si guarda; `y` la quota (se manca, il DEM) */
  to: P;
  /** quanto della salita alla cima prende lo sguardo (0 orizzonte, 1 la cima al centro) */
  aim?: number;
  /** la camera: indietro e su (metri) */
  back?: number;
  up?: number;
  /** inclinazione fissa, gradi (se c'è vince su aim) */
  pitch?: number;
}

const tornante = hairpin('pordoi-arabba', 4000, 8500);
const VISTE: Vista[] = [
  // Passo Sella: il Sassolungo dal piazzale dell'albergo (passo-sella-53922638)
  { name: 'sella-sassolungo', from: mon('Albergo del Passo Sella'), to: peak('Sassolungo'), aim: 0.5 },
  // Pian Schiavaneis: le torri del Sella sopra il bosco (sella-torri-181736516)
  { name: 'schiavaneis-torri', from: geo(46.5015, 11.7945), to: peak('III° Torre del Sella'), aim: 0.5 },
  // Passo Pordoi: la Marmolada a sud e il Sass Pordoi a nord (passo-pordoi-81859236, sass-pordoi-81860328)
  { name: 'pordoi-marmolada', from: onRide('pordoi-arabba', 0.96), to: peak('Punta Penia'), aim: 0.6, up: 4 },
  { name: 'pordoi-sasspordoi', from: peak('Passo Pordoi'), to: peak('Sasso Pordoi'), aim: 0.5 },
  // Passo Gardena: il Cir sopra il passo a nord, e la parete nord del Sella a sud (passo-gardena-60757277)
  { name: 'gardena-cir', from: peak('Passo Gardena'), to: peak('Grande Cir'), aim: 0.5 },
  { name: 'gardena-sella', from: peak('Passo Gardena'), to: peak('Torre Berger'), aim: 0.45, up: 3 },
  // Corvara: il Sassongher sopra il paese (corvara-26972766)
  { name: 'corvara-sassongher', from: geo(46.5496, 11.874), to: peak('Sassongher'), aim: 0.55 },
  // Arabba: il Padon a sud del paese (arabba-57788341)
  { name: 'arabba-padon', from: geo(46.4972, 11.8741), to: geo(46.474, 11.877), aim: 0.5 },
  // un tornante del Pordoi da Arabba, visto dall'alto
  { name: 'pordoi-tornante', from: tornante.at, to: tornante.ahead, back: 18, up: 16, pitch: -14 },
  // il centro di Selva: le case ladine, il Sassolungo in fondo (km0-49680937)
  { name: 'selva-centro', from: geo(46.5553, 11.7592), to: peak('Sassolungo'), aim: 0.25, back: 4, up: 2.2 },
  // il cartello del passo e la cappella al Sella (sella-torri-46376572, km10-175099581)
  { name: 'sella-cartello', from: peak('Passo Sella'), to: peak('Passo Sella'), back: 14, up: 3, pitch: -3 },
  { name: 'sella-cappella', from: mon('Albergo del Passo Sella'), to: mon('Cappella del Passo Sella'), pitch: 2, up: 2 },
  // un impianto: la cabinovia della Forcella del Sassolungo dal Passo Sella (passo-sella-55150019)
  { name: 'sella-impianto', from: mon('Albergo del Passo Sella'), to: lift('Furcela de Saslonch'), pitch: 6, up: 2 },
];

const only = process.env.VISTE?.split(',').filter(Boolean);
const out: string[] = [];
for (const v of VISTE) {
  if (only && !only.includes(v.name)) continue;
  await terrain.around(v.from.x, v.from.z, 300);
  await terrain.around(v.to.x, v.to.z, 300);
  const hit = graph.nearest(v.from.x, v.from.z, 400, (e) => e.cls <= 5);
  if (!hit) {
    console.error(`${v.name}: nessuna strada entro 400 m`);
    continue;
  }
  const e = graph.edges[hit.edge];
  // il verso: quello che guarda il bersaglio (per il cartello: quello che arriva al passo)
  const fwd = graph.pose(hit.edge, Math.min(e.length, hit.s + 30), 1);
  const bwd = graph.pose(hit.edge, Math.max(0, hit.s - 30), 1);
  let d: 1 | -1 = Math.hypot(fwd.x - v.to.x, fwd.z - v.to.z) <= Math.hypot(bwd.x - v.to.x, bwd.z - v.to.z) ? 1 : -1;
  if (!graph.allowed(hit.edge, d)) d = d === 1 ? -1 : 1;
  const s = Math.round(hit.s);
  const pose = graph.pose(hit.edge, s, d);
  const back = v.back ?? -2;
  const up = v.up ?? 1.8;
  const ex = pose.x - Math.sin(pose.heading) * back;
  const ez = pose.z - Math.cos(pose.heading) * back;
  const ey = pose.y + up;
  const ty = v.to.y ?? terrain.height(v.to.x, v.to.z);
  const dist = Math.max(1, Math.hypot(v.to.x - ex, v.to.z - ez));
  const bearing = Math.atan2(v.to.x - ex, v.to.z - ez);
  let yaw = ((pose.heading - bearing) * 180) / Math.PI;
  while (yaw > 180) yaw -= 360;
  while (yaw < -180) yaw += 360;
  if (v.name === 'sella-cartello') yaw = 0;
  const angle = (Math.atan2(ty - ey, dist) * 180) / Math.PI;
  const pitch = v.pitch ?? Math.max(-15, Math.min(24, angle * (v.aim ?? 0.5)));
  console.error(`${v.name}: strada ${hit.edge} a ${hit.d.toFixed(0)} m, quota ${pose.y.toFixed(0)}, bersaglio a ${(dist / 1000).toFixed(2)} km e ${angle.toFixed(1)}° (sguardo ${yaw.toFixed(0)}°, ${pitch.toFixed(1)}°)`);
  out.push(`${v.name}|/ride?world=sellaronda&edge=${hit.edge}&s=${s}&dir=${d}|${back},${up},0,${yaw.toFixed(1)},${pitch.toFixed(1)}`);
}
console.log(out.join(';'));
