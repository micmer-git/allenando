// Costruisce il mondo «Bergamo e le sue valli» da OpenStreetMap ed EU-DEM.
//
//   python scripts/world/extract-pbf.py      (una volta: i dati OSM grezzi)
//   npm run world:build                     (questo file)
//
// Scrive public/world/bergamo/: graph.json, rides.json, features.json, far.bin, dem/*.bin,
// b/*.json, e src/multiplayer/world-rides.ts (lunghezze e tempi minimi per la classifica).
// Ogni numero del mondo nasce qui da una fonte aperta: niente è disegnato a mano, tranne la
// scelta dei percorsi e dei luoghi in rides.ts, che però si appoggiano a nodi OSM veri.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { CITY, DEM_STEP, FAR_STEP, HORIZON, ORIGIN, REGION, TILE } from './config.mjs';
import { loadDem } from './dem.mjs';
import { CLS, FLAG, WorldGraph, type WorldGraphFile } from '../../src/open/graph';
import { buildRides, resolveWaypoints } from './rides';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OSM = join(HERE, 'cache', 'osm');
const OUT = join(ROOT, 'public', 'world', 'bergamo');

type Tags = Record<string, string>;
interface OsmWay {
  type: 'way';
  id: number;
  tags: Tags;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
}
interface OsmArea {
  type: 'area';
  id: number;
  way: boolean;
  tags: Tags;
  outer: [number, number][][];
  inner?: [number, number][][];
}
interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags: Tags;
}
interface OsmPoi {
  type: string;
  id: number;
  center: { lat: number; lon: number };
  tags: Tags;
}

const read = <T>(name: string): T[] => (JSON.parse(readFileSync(join(OSM, `${name}.json`), 'utf8')) as { elements: T[] }).elements;

// ---------- proiezione: la stessa di src/domain/geo.ts ----------

const RAD = Math.PI / 180;
const EARTH_R = 6371008.8;
const mLat = RAD * EARTH_R;
const mLon = mLat * Math.cos(ORIGIN.lat * RAD);
export const toLocal = (lat: number, lon: number): [number, number] => [(lon - ORIGIN.lon) * mLon, -(lat - ORIGIN.lat) * mLat];
export const toGeo = (x: number, z: number) => ({ lat: ORIGIN.lat - z / mLat, lon: ORIGIN.lon + x / mLon });

const [bx0, bz1] = toLocal(REGION.s, REGION.w);
const [bx1, bz0] = toLocal(REGION.n, REGION.e);
const BOUNDS = { x0: Math.floor(bx0), z0: Math.floor(bz0), x1: Math.ceil(bx1), z1: Math.ceil(bz1) };
const TX = Math.ceil((BOUNDS.x1 - BOUNDS.x0) / TILE);
const TZ = Math.ceil((BOUNDS.z1 - BOUNDS.z0) / TILE);

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);

// ---------- quota ----------

const dem13 = await loadDem(13, { s: REGION.s - 0.03, w: REGION.w - 0.03, n: REGION.n + 0.03, e: REGION.e + 0.03 });
const dem11 = await loadDem(11, HORIZON);
const demAt = (x: number, z: number): number => {
  const g = toGeo(x, z);
  const v = dem13.sample(g.lat, g.lon);
  return Number.isFinite(v) ? v : dem11.sample(g.lat, g.lon);
};
log(`DEM: ${dem13.tiles} mattonelle a z13, ${dem11.tiles} a z11`);

// ---------- strade ----------

function roadClass(t: Tags): number | null {
  const hw = t.highway;
  switch (hw) {
    case 'trunk':
    case 'trunk_link':
      return CLS.trunk;
    case 'primary':
    case 'primary_link':
      return CLS.primary;
    case 'secondary':
    case 'secondary_link':
      return CLS.secondary;
    case 'tertiary':
    case 'tertiary_link':
      return CLS.tertiary;
    case 'unclassified':
      return CLS.unclassified;
    case 'residential':
    case 'road':
      return CLS.residential;
    case 'living_street':
    case 'pedestrian':
      return CLS.pedestrian;
    case 'cycleway':
    case 'path':
    case 'footway':
    case 'bridleway':
    case 'track':
      return CLS.cycleway;
    default:
      return null;
  }
}

const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'chipseal']);

function rideable(t: Tags, lengthM: number): boolean {
  if (t.area === 'yes') return false;
  // un sentiero «bici sì» in montagna è quasi sempre una mulattiera (anche lastricata, come la
  // Via Priula): entra solo se asfaltato, se è una ciclovia, o se è un raccordo corto (un ponte
  // pedonale, un sottopasso) fra due pezzi di pista
  const path = t.highway === 'path' || t.highway === 'footway' || t.highway === 'bridleway' || t.highway === 'track';
  const bridgeLike = (t.bridge && t.bridge !== 'no') || (t.tunnel && t.tunnel !== 'no');
  const connector = (t.bicycle === 'yes' || t.bicycle === 'designated') && ((lengthM < 350 && (!t.name || /ponte|passerella|sottopasso|galleria/i.test(t.name) || bridgeLike)) || (bridgeLike && lengthM < 1500));
  if (path && !PAVED.has(t.surface ?? '') && !/cicl/i.test(t.name ?? '') && !connector) return false;
  if (path && UNPAVED_HARD.has(t.surface ?? '') && !connector) return false;
  if (t.highway === 'cycleway' && UNPAVED_HARD.has(t.surface ?? '')) return false;
  if (t.bicycle === 'no' || t.bicycle === 'dismount' && t.highway !== 'pedestrian') return false;
  if (t.motorroad === 'yes') return false;
  const open = t.bicycle === 'yes' || t.bicycle === 'designated' || t.bicycle === 'permissive';
  if (!open && (t.access === 'private' || t.access === 'no' || t.vehicle === 'no' || t.vehicle === 'private')) return false;
  if (t.highway === 'trunk' || t.highway === 'trunk_link') {
    // le superstrade senza nome sono quasi sempre vietate alle bici anche senza il tag
    if (!t.name && !t.ref) return false;
  }
  return true;
}

const COBBLES = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'paving_stones', 'stone', 'cobblestone:flattened']);
const UNPAVED_HARD = new Set(['dirt', 'ground', 'grass', 'earth', 'mud', 'rock', 'pebblestone']);
const UNPAVED = new Set(['gravel', 'fine_gravel', 'compacted', 'dirt', 'ground', 'unpaved', 'earth', 'grass', 'pebblestone']);

function wayFlags(t: Tags): number {
  let f = 0;
  if (t.bridge && t.bridge !== 'no') f |= FLAG.bridge;
  if (t.tunnel && t.tunnel !== 'no') f |= FLAG.tunnel;
  if (t.covered === 'yes' && !(f & FLAG.tunnel) && Number(t.layer ?? 0) < 0) f |= FLAG.tunnel;
  const bikeBoth = t['oneway:bicycle'] === 'no' || /opposite/.test(t.cycleway ?? '') || /opposite/.test(t['cycleway:left'] ?? '') || /opposite/.test(t['cycleway:right'] ?? '');
  const ow = t.oneway ?? (t.junction === 'roundabout' || t.junction === 'circular' ? 'yes' : 'no');
  if (!bikeBoth && (ow === 'yes' || ow === 'true' || ow === '1')) f |= FLAG.oneway;
  if (!bikeBoth && ow === '-1') f |= FLAG.onewayRev;
  if (COBBLES.has(t.surface ?? '')) f |= FLAG.cobbles;
  if (UNPAVED.has(t.surface ?? '')) f |= FLAG.unpaved;
  return f;
}

function halfWidth(t: Tags, cls: number): number {
  const w = parseFloat((t.width ?? '').replace(',', '.'));
  if (Number.isFinite(w) && w > 1.5 && w < 30) return Math.min(7, w / 2);
  const link = /_link$/.test(t.highway ?? '');
  const lanes = Number(t.lanes);
  if (Number.isFinite(lanes) && lanes >= 3 && cls <= CLS.secondary) return Math.min(7, lanes * 1.6);
  switch (cls) {
    case CLS.trunk:
      return link ? 3 : 4.2;
    case CLS.primary:
      return link ? 2.8 : 3.6;
    case CLS.secondary:
      return link ? 2.7 : 3.2;
    case CLS.tertiary:
      return 2.9;
    case CLS.unclassified:
      return 2.4;
    case CLS.residential:
      return 2.8;
    case CLS.pedestrian:
      return 3;
    default:
      return 1.3;
  }
}

const NAME_KEYS = ['name', 'name:it', 'official_name', 'loc_name', 'alt_name'];
const nameOf = (t: Tags) => NAME_KEYS.map((k) => t[k]).find(Boolean) ?? '';

const rawWays = [...read<OsmWay>('roads-main'), ...read<OsmWay>('roads-city')];
const seenWay = new Set<number>();
const ways: { id: number; tags: Tags; cls: number; flags: number; hw: number; nodes: number[]; xz: [number, number][] }[] = [];
for (const w of rawWays) {
  if (seenWay.has(w.id)) continue;
  seenWay.add(w.id);
  const cls = roadClass(w.tags);
  if (cls == null) continue;
  let wayLen = 0;
  for (let i = 1; i < w.geometry.length; i++) {
    const [ax, az] = toLocal(w.geometry[i - 1].lat, w.geometry[i - 1].lon);
    const [bx, bz] = toLocal(w.geometry[i].lat, w.geometry[i].lon);
    wayLen += Math.hypot(bx - ax, bz - az);
  }
  if (!rideable(w.tags, wayLen)) continue;
  if (w.nodes.length !== w.geometry.length || w.nodes.length < 2) continue;
  ways.push({ id: w.id, tags: w.tags, cls, flags: wayFlags(w.tags), hw: halfWidth(w.tags, cls), nodes: w.nodes, xz: w.geometry.map((g) => toLocal(g.lat, g.lon)) });
}
log(`strade: ${ways.length} vie OSM pedalabili`);

// incroci: nodi usati da più vie, o due volte dalla stessa, e i capi delle vie
const uses = new Map<number, number>();
for (const w of ways) {
  for (let i = 0; i < w.nodes.length; i++) {
    const end = i === 0 || i === w.nodes.length - 1;
    uses.set(w.nodes[i], (uses.get(w.nodes[i]) ?? 0) + (end ? 2 : 1));
  }
}
const isJunction = (id: number) => (uses.get(id) ?? 0) >= 2;

interface RawEdge {
  a: number;
  b: number;
  name: string;
  ref: string;
  cls: number;
  flags: number;
  hw: number;
  pts: [number, number][];
  alive: boolean;
}
const rawEdges: RawEdge[] = [];
const nodePos = new Map<number, [number, number]>();
for (const w of ways) {
  let start = 0;
  for (let i = 1; i < w.nodes.length; i++) {
    if (!isJunction(w.nodes[i]) && i < w.nodes.length - 1) continue;
    const ids = w.nodes.slice(start, i + 1);
    const pts = w.xz.slice(start, i + 1);
    nodePos.set(ids[0], pts[0]);
    nodePos.set(ids[ids.length - 1], pts[pts.length - 1]);
    rawEdges.push({ a: ids[0], b: ids[ids.length - 1], name: nameOf(w.tags), ref: w.tags.ref ?? '', cls: w.cls, flags: w.flags, hw: w.hw, pts, alive: true });
    start = i;
  }
}

// le catene di due archi uguali si uniscono: meno archi, curve intere
function sameKind(p: RawEdge, q: RawEdge): boolean {
  return p.name === q.name && p.ref === q.ref && p.cls === q.cls && p.flags === q.flags && Math.abs(p.hw - q.hw) < 0.05;
}
const incident = new Map<number, number[]>();
const addInc = (n: number, i: number) => {
  const l = incident.get(n);
  if (l) l.push(i);
  else incident.set(n, [i]);
};
rawEdges.forEach((e, i) => {
  addInc(e.a, i);
  if (e.b !== e.a) addInc(e.b, i);
});
let merged = 0;
for (const [node, list] of incident) {
  const live = list.filter((i) => rawEdges[i].alive);
  if (live.length !== 2) continue;
  const [i, j] = live;
  const p = rawEdges[i];
  const q = rawEdges[j];
  if (i === j || p.a === p.b || q.a === q.b || !sameKind(p, q)) continue;
  const oneway = p.flags & (FLAG.oneway | FLAG.onewayRev);
  // orienta p in modo che finisca nel nodo, q in modo che ne parta
  const pEnds = p.b === node;
  const qStarts = q.a === node;
  if (oneway && pEnds !== qStarts) continue; // due sensi unici opposti: non sono una catena
  const pPts = pEnds ? p.pts : [...p.pts].reverse();
  const qPts = qStarts ? q.pts : [...q.pts].reverse();
  const pa = pEnds ? p.a : p.b;
  const qb = qStarts ? q.b : q.a;
  if (pa === qb) continue; // diventerebbe un anello chiuso: lo lasciamo in due
  if (pPts.length + qPts.length > 3000) continue;
  if (oneway && !pEnds) {
    // p era al contrario: allora il senso unico va ribaltato insieme alla pianta
    p.flags = (p.flags & ~(FLAG.oneway | FLAG.onewayRev)) | (p.flags & FLAG.oneway ? FLAG.onewayRev : FLAG.oneway);
  }
  p.pts = [...pPts, ...qPts.slice(1)];
  p.a = pa;
  p.b = qb;
  q.alive = false;
  // q non c'è più: chi lo cita nell'altro capo deve puntare a p
  const other = incident.get(qb);
  if (other) incident.set(qb, other.map((k) => (k === j ? i : k)));
  merged++;
}
let edgesLive = rawEdges.filter((e) => e.alive);
log(`archi: ${rawEdges.length} → ${edgesLive.length} (${merged} catene unite)`);

// Ricucitura: in OSM due pezzi della stessa pista finiscono spesso a pochi metri l'uno
// dall'altro senza un nodo in comune. Ogni capo morto si collega al nodo più vicino entro
// 20 m (piste) o 8 m (strade) con un raccordo dritto.
{
  const degree = new Map<number, number>();
  for (const e of edgesLive) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const cell = new Map<string, number[]>();
  const ck = (x: number, z: number) => `${Math.floor(x / 20)}:${Math.floor(z / 20)}`;
  for (const id of degree.keys()) {
    const [x, z] = nodePos.get(id)!;
    const k = ck(x, z);
    const l = cell.get(k);
    if (l) l.push(id);
    else cell.set(k, [id]);
  }
  const byEnd = new Map<number, RawEdge>();
  for (const e of edgesLive) {
    if (degree.get(e.a) === 1) byEnd.set(e.a, e);
    if (degree.get(e.b) === 1) byEnd.set(e.b, e);
  }
  const done = new Set<string>();
  let stitched = 0;
  for (const [id, e] of byEnd) {
    const reach = e.cls === CLS.cycleway ? 20 : 8;
    const [x, z] = nodePos.get(id)!;
    const other = e.a === id ? e.b : e.a;
    let best = -1;
    let bestD = reach;
    const cx = Math.floor(x / 20);
    const cz = Math.floor(z / 20);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const n of cell.get(`${cx + dx}:${cz + dz}`) ?? []) {
          if (n === id || n === other) continue;
          const [nx, nz] = nodePos.get(n)!;
          const d = Math.hypot(nx - x, nz - z);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
    }
    if (best < 0) continue;
    const key = id < best ? `${id}-${best}` : `${best}-${id}`;
    if (done.has(key)) continue;
    done.add(key);
    const p = nodePos.get(id)!;
    const q = nodePos.get(best)!;
    if (bestD < 0.3) {
      // praticamente lo stesso punto: un raccordo di mezzo metro, per non avere archi nulli
      q[0] += 0.3;
    }
    edgesLive.push({ a: id, b: best, name: e.name, ref: '', cls: e.cls, flags: e.flags & (FLAG.cobbles | FLAG.unpaved), hw: e.hw, pts: [p, q], alive: true });
    stitched++;
  }
  // stessa pista con lo stesso nome interrotta per un tratto (fino a 250 m): in OSM manca il
  // pezzo, sulla strada vera si passa
  const deadNamed = [...byEnd].filter(([, e]) => e.cls === CLS.cycleway && e.name);
  let bridged = 0;
  for (const [id, e] of deadNamed) {
    const [x, z] = nodePos.get(id)!;
    const other = e.a === id ? e.b : e.a;
    let best = -1;
    let bestD = 250;
    for (const [id2, e2] of deadNamed) {
      if (id2 === id || id2 === other || e2.name !== e.name || e2 === e) continue;
      const [x2, z2] = nodePos.get(id2)!;
      const d = Math.hypot(x2 - x, z2 - z);
      if (d < bestD) {
        bestD = d;
        best = id2;
      }
    }
    if (best < 0) continue;
    const key = id < best ? `${id}-${best}` : `${best}-${id}`;
    if (done.has(key)) continue;
    done.add(key);
    edgesLive.push({ a: id, b: best, name: e.name, ref: '', cls: e.cls, flags: 0, hw: e.hw, pts: [nodePos.get(id)!, nodePos.get(best)!], alive: true });
    bridged++;
  }
  log(`ricucitura: ${stitched} capi morti collegati, ${bridged} buchi di pista colmati`);
}

// la componente connessa più grande: un pezzo di ciclabile isolato non serve a nessuno
{
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== undefined && parent.get(c) !== r) {
      const nx = parent.get(c)!;
      parent.set(c, r);
      c = nx;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const e of edgesLive) union(e.a, e.b);
  const size = new Map<number, number>();
  for (const e of edgesLive) {
    const r = find(e.a);
    size.set(r, (size.get(r) ?? 0) + polyLen(e.pts));
  }
  let bestRoot = -1;
  let bestLen = 0;
  for (const [r, l] of size) if (l > bestLen) [bestRoot, bestLen] = [r, l];
  const before = edgesLive.length;
  edgesLive = edgesLive.filter((e) => find(e.a) === bestRoot);
  log(`componente principale: ${(bestLen / 1000).toFixed(0)} km di strade, tolti ${before - edgesLive.length} archi isolati`);
}

function polyLen(p: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return s;
}

/** Douglas-Peucker in pianta, capi tenuti. */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas-Peucker per un anello chiuso: lo si spezza nel vertice più lontano dal primo. */
function simplifyRing(ring: [number, number][], tol: number): [number, number][] {
  const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  if (r.length < 4) return r;
  let far = 1;
  let best = 0;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplify(r.slice(0, far + 1), tol);
  const b = simplify([...r.slice(far), r[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

function densify(pts: [number, number][], maxSeg: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(len / maxSeg);
    for (let k = 1; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    out.push(pts[i]);
  }
  return out;
}

// nodi: indici compatti
const nodeIndex = new Map<number, number>();
const nodeXZ: [number, number][] = [];
for (const e of edgesLive) {
  for (const id of [e.a, e.b]) {
    if (!nodeIndex.has(id)) {
      nodeIndex.set(id, nodeXZ.length);
      nodeXZ.push(nodePos.get(id)!);
    }
  }
}
// quota degli incroci: il DEM, mediato su un dischetto di 12 m (una strada a mezza costa non pesca il pendio)
interface BuiltEdge {
  a: number;
  b: number;
  name: string;
  ref: string;
  cls: number;
  flags: number;
  hw: number;
  xz: [number, number][];
  y: number[];
}

/**
 * La quota di tutta la rete, livellata in un colpo solo.
 *
 * Ogni strada si campiona ogni ~10 m; gli incroci sono incognite condivise fra le strade che
 * ci arrivano. Si cerca la quota più vicina al DEM (EU-DEM a 25 m) con la pendenza che
 * cambia il meno possibile: minimi quadrati con una penalità sulla variazione di pendenza,
 * anche attraverso gli incroci dove la strada prosegue dritta. Sui ponti e nelle gallerie il
 * DEM non conta (lì sotto c'è la valle o la montagna): la quota la decide la continuità coi
 * due capi. Tre giri robusti tolgono peso ai campioni lontani dalla curva, cioè al DEM che
 * pesca il pendio a monte o il fondo della forra a valle. Si risolve col gradiente coniugato.
 */
const MU = Number(process.env.WORLD_MU ?? 150000);

/** Quanto è rigida una strada: le statali e le provinciali sono progettate con pendenze dolci, i vicoli no. */
function stiffness(e: RawEdge): number {
  if (/Ciclovia Valle Brembana/i.test(e.name)) return 60;
  switch (e.cls) {
    case CLS.trunk:
    case CLS.primary:
      return 14;
    case CLS.secondary:
      return 12;
    case CLS.tertiary:
      return 9;
    case CLS.cycleway:
      return 6;
    case CLS.unclassified:
      return 3;
    default:
      return 1;
  }
}

/** La pendenza che una strada di questa classe può avere davvero: oltre è rumore del DEM. */
function gradeCap(e: RawEdge): number {
  if (/Ciclovia Valle Brembana/i.test(e.name)) return 0.035;
  switch (e.cls) {
    case CLS.trunk:
    case CLS.primary:
      return 0.1;
    case CLS.secondary:
      return 0.12;
    case CLS.tertiary:
      return 0.15;
    case CLS.cycleway:
      return 0.1;
    case CLS.unclassified:
      return 0.2;
    default:
      return 0.24;
  }
}

const prepared = edgesLive
  .map((e) => ({ e, a: nodeIndex.get(e.a)!, b: nodeIndex.get(e.b)!, xz: densify(simplify(e.pts, 0.8), 20) }))
  .filter((p) => polyLen(p.xz) >= 0.3);

const nodeEle: number[] = nodeXZ.map(([x, z]) => demAt(x, z));
{
  const N = nodeXZ.length;
  // incognite: prima gli incroci, poi i campioni interni di ogni strada
  const dem: number[] = nodeXZ.map(([x, z]) => demAt(x, z));
  const w0: number[] = new Array<number>(N).fill(1);
  const group: number[] = new Array<number>(N).fill(-1);
  const edgeVars: { ids: number[]; d: number[] }[] = [];
  const nodeCovered = new Uint8Array(N);
  const nodeOpen = new Uint8Array(N);
  prepared.forEach((p, ei) => {
    const xz = p.xz;
    const cum = [0];
    for (let i = 1; i < xz.length; i++) cum.push(cum[i - 1] + Math.hypot(xz[i][0] - xz[i - 1][0], xz[i][1] - xz[i - 1][1]));
    const L = cum[cum.length - 1];
    const n = Math.max(2, Math.round(L / 10) + 1);
    const covered = (p.e.flags & (FLAG.bridge | FLAG.tunnel)) !== 0;
    const ids = [p.a];
    const d = [0];
    let j = 0;
    for (let i = 1; i < n - 1; i++) {
      const s = (i * L) / (n - 1);
      while (j < xz.length - 2 && cum[j + 1] < s) j++;
      const u = Math.min(1, Math.max(0, (s - cum[j]) / (cum[j + 1] - cum[j] || 1)));
      const x = xz[j][0] + (xz[j + 1][0] - xz[j][0]) * u;
      const z = xz[j][1] + (xz[j + 1][1] - xz[j][1]) * u;
      ids.push(dem.length);
      dem.push(demAt(x, z));
      w0.push(covered ? 0 : 1);
      group.push(ei);
      d.push(s);
    }
    ids.push(p.b);
    d.push(L);
    edgeVars.push({ ids, d });
    if (covered) {
      nodeCovered[p.a] = 1;
      nodeCovered[p.b] = 1;
    } else {
      nodeOpen[p.a] = 1;
      nodeOpen[p.b] = 1;
    }
  });
  // un incrocio toccato solo da ponti o gallerie non guarda il DEM
  for (let i = 0; i < N; i++) if (nodeCovered[i] && !nodeOpen[i]) w0[i] = 0;
  const V = dem.length;

  // termini di curvatura: (i, j, k) con distanze h1 = j−i, h2 = k−j
  const ti: number[] = [];
  const tc: number[] = [];
  const addTerm = (i: number, j: number, k: number, h1: number, h2: number, stiff = 1) => {
    if (h1 < 0.5 || h2 < 0.5) return;
    // c = (y_k − y_j)/h2 − (y_j − y_i)/h1; peso per lunghezza: μ · ((h1+h2)/2)/10
    const s = Math.sqrt(MU * stiff * ((h1 + h2) / 2 / 10));
    ti.push(i, j, k);
    tc.push((1 / h1) * s, (-1 / h1 - 1 / h2) * s, (1 / h2) * s);
  };
  edgeVars.forEach((ev, ei) => {
    const k = stiffness(prepared[ei].e);
    for (let q = 1; q + 1 < ev.ids.length; q++) addTerm(ev.ids[q - 1], ev.ids[q], ev.ids[q + 1], ev.d[q] - ev.d[q - 1], ev.d[q + 1] - ev.d[q], k);
  });
  // attraverso gli incroci: le coppie di strade che proseguono dritte (o l'unica coppia)
  const ends: { node: number; prev: number; h: number; dx: number; dz: number; k: number }[][] = Array.from({ length: N }, () => []);
  edgeVars.forEach((ev, ei) => {
    const p = prepared[ei];
    const m = ev.ids.length;
    if (m < 2) return;
    const xz = p.xz;
    const ax = xz[Math.min(xz.length - 1, 1)][0] - xz[0][0];
    const az = xz[Math.min(xz.length - 1, 1)][1] - xz[0][1];
    const bx = xz[Math.max(0, xz.length - 2)][0] - xz[xz.length - 1][0];
    const bz = xz[Math.max(0, xz.length - 2)][1] - xz[xz.length - 1][1];
    const k = stiffness(p.e);
    ends[p.a].push({ node: p.a, prev: ev.ids[1], h: ev.d[1], dx: ax, dz: az, k });
    ends[p.b].push({ node: p.b, prev: ev.ids[m - 2], h: ev.d[m - 1] - ev.d[m - 2], dx: bx, dz: bz, k });
  });
  let through = 0;
  for (let nd = 0; nd < N; nd++) {
    const list = ends[nd];
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const p = list[x];
        const q = list[y];
        const cos = (p.dx * q.dx + p.dz * q.dz) / (Math.hypot(p.dx, p.dz) * Math.hypot(q.dx, q.dz) || 1);
        if (list.length === 2 || cos < -0.85) {
          addTerm(p.prev, nd, q.prev, p.h, q.h, Math.min(p.k, q.k));
          through++;
        }
      }
    }
  }
  const T = ti.length / 3;

  // A y = W y + Σ g gᵀ y ; b = W dem
  let w = w0.slice();
  const y = new Float64Array(V);
  for (let i = 0; i < V; i++) y[i] = dem[i];
  const solve = (iters: number) => {
    const diag = new Float64Array(V);
    for (let i = 0; i < V; i++) diag[i] = w[i];
    for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) diag[ti[t * 3 + k]] += tc[t * 3 + k] * tc[t * 3 + k];
    for (let i = 0; i < V; i++) if (diag[i] <= 0) diag[i] = 1;
    const mul = (x: Float64Array, out: Float64Array) => {
      for (let i = 0; i < V; i++) out[i] = w[i] * x[i];
      for (let t = 0; t < T; t++) {
        const o = t * 3;
        const g = tc[o] * x[ti[o]] + tc[o + 1] * x[ti[o + 1]] + tc[o + 2] * x[ti[o + 2]];
        out[ti[o]] += tc[o] * g;
        out[ti[o + 1]] += tc[o + 1] * g;
        out[ti[o + 2]] += tc[o + 2] * g;
      }
    };
    const r = new Float64Array(V);
    const z = new Float64Array(V);
    const p = new Float64Array(V);
    const Ap = new Float64Array(V);
    mul(y, Ap);
    for (let i = 0; i < V; i++) r[i] = w[i] * dem[i] - Ap[i];
    for (let i = 0; i < V; i++) z[i] = r[i] / diag[i];
    p.set(z);
    let rz = 0;
    for (let i = 0; i < V; i++) rz += r[i] * z[i];
    const r0 = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
    let it = 0;
    for (; it < iters; it++) {
      mul(p, Ap);
      let pAp = 0;
      for (let i = 0; i < V; i++) pAp += p[i] * Ap[i];
      if (pAp <= 0) break;
      const alpha = rz / pAp;
      let rr = 0;
      for (let i = 0; i < V; i++) {
        y[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        rr += r[i] * r[i];
      }
      if (Math.sqrt(rr) < r0 * 1e-6) break;
      for (let i = 0; i < V; i++) z[i] = r[i] / diag[i];
      let rzNew = 0;
      for (let i = 0; i < V; i++) rzNew += r[i] * z[i];
      const beta = rzNew / rz;
      rz = rzNew;
      for (let i = 0; i < V; i++) p[i] = z[i] + beta * p[i];
    }
    return it;
  };
  for (let round = 0; round < 4; round++) {
    const its = solve(round === 0 ? 2500 : 1200);
    if (round === 3) {
      log(`quote: ${V} incognite, ${T} termini (${through} attraverso gli incroci), ${its} iterazioni`);
      break;
    }
    // pesi robusti, strada per strada (Tukey sulla mediana degli scarti)
    const res = new Float64Array(V);
    for (let i = 0; i < V; i++) res[i] = Math.abs(dem[i] - y[i]);
    const byGroup = new Map<number, number[]>();
    for (let i = N; i < V; i++) {
      if (w0[i] === 0) continue;
      const l = byGroup.get(group[i]);
      if (l) l.push(res[i]);
      else byGroup.set(group[i], [res[i]]);
    }
    const mad = new Map<number, number>();
    for (const [g, l] of byGroup) {
      l.sort((p, q) => p - q);
      mad.set(g, Math.max(1.2, l[Math.floor(l.length / 2)]));
    }
    w = w0.map((wi, i) => {
      if (wi === 0) return 0;
      const m = i < N ? 2 : (mad.get(group[i]) ?? 2);
      const u = res[i] / (4.685 * 1.4826 * m);
      return u < 1 ? wi * (1 - u * u) ** 2 : wi * 0.002;
    });
  }
  for (let i = 0; i < N; i++) nodeEle[i] = y[i];
  // la quota sui vertici della pianta, dai campioni
  edgeVars.forEach((ev, ei) => {
    const p = prepared[ei] as (typeof prepared)[number] & { y?: number[] };
    const xz = p.xz;
    const cum = [0];
    for (let i = 1; i < xz.length; i++) cum.push(cum[i - 1] + Math.hypot(xz[i][0] - xz[i - 1][0], xz[i][1] - xz[i - 1][1]));
    let q = 0;
    p.y = cum.map((s) => {
      while (q < ev.d.length - 2 && ev.d[q + 1] < s) q++;
      const u = Math.min(1, Math.max(0, (s - ev.d[q]) / (ev.d[q + 1] - ev.d[q] || 1)));
      return y[ev.ids[q]] + (y[ev.ids[q + 1]] - y[ev.ids[q]]) * u;
    });
  });
}

const built: BuiltEdge[] = [];
let capped = 0;
for (const p of prepared as ((typeof prepared)[number] & { y: number[] })[]) {
  // tetto di pendenza, avanti e indietro coi capi fermi; se il dislivello fra i capi lo
  // chiede, il tetto si alza quanto basta
  const ys = p.y;
  const cum = [0];
  for (let i = 1; i < p.xz.length; i++) cum.push(cum[i - 1] + Math.hypot(p.xz[i][0] - p.xz[i - 1][0], p.xz[i][1] - p.xz[i - 1][1]));
  const L = cum[cum.length - 1];
  const cap = Math.max(gradeCap(p.e), (Math.abs(ys[ys.length - 1] - ys[0]) / (L || 1)) * 1.15);
  let hit = false;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < ys.length; i++) {
      const h = cum[i] - cum[i - 1];
      const lim = cap * h;
      if (ys[i] - ys[i - 1] > lim) {
        ys[i] = ys[i - 1] + lim;
        hit = true;
      } else if (ys[i - 1] - ys[i] > lim) {
        ys[i] = ys[i - 1] - lim;
        hit = true;
      }
    }
    const end = ys.length - 1;
    for (let i = end - 1; i >= 0; i--) {
      const h = cum[i + 1] - cum[i];
      const lim = cap * h;
      if (i === 0) break;
      if (ys[i] - ys[i + 1] > lim) ys[i] = ys[i + 1] + lim;
      else if (ys[i + 1] - ys[i] > lim) ys[i] = ys[i + 1] - lim;
    }
    ys[end] = nodeEle[p.b];
    ys[0] = nodeEle[p.a];
  }
  if (hit) capped++;
  built.push({ a: p.a, b: p.b, name: p.e.name, ref: p.e.ref, cls: p.e.cls, flags: p.e.flags, hw: p.e.hw, xz: p.xz, y: p.y });
}
log(`archi costruiti: ${built.length}, nodi ${nodeXZ.length}, ${capped} col tetto di pendenza`);

// Sensi unici senza uscita. Il mondo ha solo le strade principali (e tutte quelle di
// Bergamo): un senso unico di paese che sfociava in una via minore qui finisce nel nulla.
// Si cerca la componente fortemente connessa più grande e, per ogni senso unico che la
// lascia, si toglie il divieto: nella realtà da lì si esce per una via che il mondo non ha.
{
  const n = nodeXZ.length;
  for (let pass = 0; pass < 8; pass++) {
    const out: number[][] = Array.from({ length: n }, () => []);
    const inn: number[][] = Array.from({ length: n }, () => []);
    for (const e of built) {
      const fwd = !(e.flags & FLAG.onewayRev);
      const back = !(e.flags & FLAG.oneway);
      if (fwd) {
        out[e.a].push(e.b);
        inn[e.b].push(e.a);
      }
      if (back) {
        out[e.b].push(e.a);
        inn[e.a].push(e.b);
      }
    }
    // Kosaraju, iterativo
    const seen = new Uint8Array(n);
    const order: number[] = [];
    for (let s0 = 0; s0 < n; s0++) {
      if (seen[s0]) continue;
      const stack: [number, number][] = [[s0, 0]];
      seen[s0] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const [v, i] = top;
        if (i < out[v].length) {
          top[1]++;
          const w = out[v][i];
          if (!seen[w]) {
            seen[w] = 1;
            stack.push([w, 0]);
          }
        } else {
          order.push(v);
          stack.pop();
        }
      }
    }
    const comp = new Int32Array(n).fill(-1);
    let c = 0;
    const sizes: number[] = [];
    for (let k = n - 1; k >= 0; k--) {
      const s0 = order[k];
      if (comp[s0] >= 0) continue;
      let size = 0;
      const stack = [s0];
      comp[s0] = c;
      while (stack.length) {
        const v = stack.pop()!;
        size++;
        for (const w of inn[v]) {
          if (comp[w] < 0) {
            comp[w] = c;
            stack.push(w);
          }
        }
      }
      sizes.push(size);
      c++;
    }
    let big = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[big]) big = i;
    let cleared = 0;
    for (const e of built) {
      if (!(e.flags & (FLAG.oneway | FLAG.onewayRev))) continue;
      if (comp[e.a] !== big || comp[e.b] !== big) {
        e.flags &= ~(FLAG.oneway | FLAG.onewayRev);
        cleared++;
      }
    }
    log(`sensi unici: componente forte di ${sizes[big]} nodi su ${n}, ${cleared} divieti tolti`);
    if (cleared === 0) break;
  }
}

// ---------- il file del grafo ----------

const names: string[] = [''];
const nameId = new Map<string, number>([['', 0]]);
const intern = (s: string) => {
  let id = nameId.get(s);
  if (id == null) {
    id = names.length;
    names.push(s);
    nameId.set(s, id);
  }
  return id;
};
const dm = (v: number) => Math.round(v * 10);

const FAR = (() => {
  const [hx0, hz1] = toLocal(HORIZON.s, HORIZON.w);
  const [hx1, hz0] = toLocal(HORIZON.n, HORIZON.e);
  const x0 = Math.floor(hx0 / FAR_STEP) * FAR_STEP;
  const z0 = Math.floor(hz0 / FAR_STEP) * FAR_STEP;
  return { step: FAR_STEP, x0, z0, nx: Math.floor((hx1 - x0) / FAR_STEP) + 1, nz: Math.floor((hz1 - z0) / FAR_STEP) + 1 };
})();


// ---------- cime, paesi, mura, ferrovie, funivie ----------

const peaksRaw = read<OsmNode>('peaks');
const placesRaw = read<OsmNode>('places');
const poisRaw = read<OsmPoi>('pois');
const wallsRaw = read<OsmWay>('walls');

const peaks = peaksRaw
  .filter((p) => p.tags.name)
  .map((p) => {
    const [x, z] = toLocal(p.lat, p.lon);
    const tagEle = parseFloat((p.tags.ele ?? '').replace(',', '.'));
    const ele = Number.isFinite(tagEle) && tagEle > 100 && tagEle < 4900 ? tagEle : Math.round(demAt(x, z));
    const pass = p.tags.mountain_pass === 'yes' || p.tags.natural === 'saddle';
    return { name: p.tags.name, x, z, ele, pass, id: p.id };
  });

const PLACE_KINDS = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'quarter']);
const places = placesRaw
  .filter((p) => PLACE_KINDS.has(p.tags.place))
  .map((p) => {
    const [x, z] = toLocal(p.lat, p.lon);
    return { name: p.tags.name, kind: p.tags.place, x, z, y: demAt(x, z), id: p.id, pop: Number(p.tags.population ?? 0) };
  })
  .filter((p) => p.x > BOUNDS.x0 - 20000 && p.x < BOUNDS.x1 + 20000 && p.z > BOUNDS.z0 - 20000 && p.z < BOUNDS.z1 + 20000);


const named: { name: string; x: number; z: number }[] = [];
for (const a of read<OsmArea>('buildings')) {
  if (!a.tags.name) continue;
  const ring = a.outer[0];
  let la = 0;
  let lo = 0;
  for (const [x, y] of ring) {
    lo += x;
    la += y;
  }
  const [x, z] = toLocal(la / ring.length, lo / ring.length);
  named.push({ name: a.tags.name, x, z });
}
for (const w of rawWays) {
  if (!w.tags.name) continue;
  const g = w.geometry[Math.floor(w.geometry.length / 2)];
  const [x, z] = toLocal(g.lat, g.lon);
  named.push({ name: w.tags.name, x, z });
}

// ---------- tappe dei percorsi: un incrocio esatto dove serve ----------
// Un passo o una piazza possono stare a metà di un tratto lungo chilometri: lì si spezza la
// strada, così il percorso comincia e finisce proprio in quel punto.
{
  const lite = { toLocal, toGeo, demAt, peaks, places, pois: poisRaw, named, rivers: [], log };
  const wps = resolveWaypoints(lite as never);
  let splits = 0;
  for (const wp of wps) {
    const tmp = new WorldGraph(graphFileOf(built));
    const hit = tmp.nearest(wp.x, wp.z, 600, (e) => e.cls !== CLS.trunk && e.cls !== CLS.pedestrian);
    if (!hit) continue;
    const e = built[hit.edge];
    const te = tmp.edges[hit.edge];
    if (hit.s < 25 || te.length - hit.s < 25) continue;
    // punto di taglio sulla geometria costruita
    let acc = 0;
    let k = 0;
    for (; k < e.xz.length - 1; k++) {
      const seg = Math.hypot(e.xz[k + 1][0] - e.xz[k][0], e.xz[k + 1][1] - e.xz[k][1]);
      if (acc + seg >= hit.s) break;
      acc += seg;
    }
    if (k >= e.xz.length - 1) continue;
    const seg = Math.hypot(e.xz[k + 1][0] - e.xz[k][0], e.xz[k + 1][1] - e.xz[k][1]) || 1;
    const u = Math.min(1, Math.max(0, (hit.s - acc) / seg));
    const P: [number, number] = [e.xz[k][0] + (e.xz[k + 1][0] - e.xz[k][0]) * u, e.xz[k][1] + (e.xz[k + 1][1] - e.xz[k][1]) * u];
    const Y = e.y[k] + (e.y[k + 1] - e.y[k]) * u;
    const id = nodeXZ.length;
    nodeXZ.push(P);
    nodeEle.push(Y);
    const first: BuiltEdge = { ...e, b: id, xz: [...e.xz.slice(0, k + 1), P], y: [...e.y.slice(0, k + 1), Y] };
    const second: BuiltEdge = { ...e, a: id, xz: [P, ...e.xz.slice(k + 1)], y: [Y, ...e.y.slice(k + 1)] };
    built[hit.edge] = first;
    built.push(second);
    splits++;
  }
  log(`tappe: ${wps.length} punti, ${splits} strade spezzate`);
}

function graphFileOf(list: BuiltEdge[]): WorldGraphFile {
  return {
  v: 1,
  id: 'bergamo',
  name: 'Bergamo e le sue valli',
  origin: ORIGIN,
  bounds: BOUNDS,
  tile: TILE,
  demStep: DEM_STEP,
  far: FAR,
  builtAt: new Date().toISOString().slice(0, 10),
  attribution: '© OpenStreetMap contributors, ODbL 1.0 · EU-DEM © Copernicus Land Monitoring Service (Terrain Tiles, AWS Open Data)',
  names,
  nodes: nodeXZ.flatMap(([x, z], i) => [dm(x), dm(z), dm(nodeEle[i])]),
  edges: list.map((e) => {
    const coords: number[] = [];
    let px = 0;
    let pz = 0;
    let py = 0;
    for (let i = 0; i < e.xz.length; i++) {
      const x = dm(e.xz[i][0]);
      const z = dm(e.xz[i][1]);
      const y = dm(e.y[i]);
      coords.push(x - px, z - pz, y - py);
      px = x;
      pz = z;
      py = y;
    }
    return [e.a, e.b, intern(e.name), intern(e.ref), e.cls, e.flags, dm(e.hw), coords];
  }),
};
}

const graphFile = graphFileOf(built);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'dem'), { recursive: true });
mkdirSync(join(OUT, 'b'), { recursive: true });
writeFileSync(join(OUT, 'graph.json'), JSON.stringify(graphFile));
const graph = new WorldGraph(graphFile);
log(`graph.json: ${(JSON.stringify(graphFile).length / 1e6).toFixed(1)} MB, ${(built.reduce((s, e) => s + polyLen(e.xz), 0) / 1000).toFixed(0)} km`);

// ---------- uso del suolo, rasterizzato a 25 m ----------

const GW = TX * Math.round(TILE / DEM_STEP) + 1;
const GH = TZ * Math.round(TILE / DEM_STEP) + 1;
const cover = new Uint8Array(GW * GH);
const coverPri = new Uint8Array(GW * GH);

function coverClass(t: Tags): [number, number] | null {
  const l = t.landuse;
  const n = t.natural;
  const le = t.leisure;
  if (n === 'water' || t.water) return [6, 9];
  if (n === 'glacier') return [8, 8];
  if (l === 'industrial' || l === 'commercial' || l === 'retail' || l === 'construction' || l === 'quarry') return [3, 7];
  if (l === 'residential' || l === 'farmyard') return [2, 6];
  if (le === 'park' || le === 'pitch' || le === 'golf_course' || le === 'garden' || l === 'cemetery' || l === 'allotments' || l === 'grass') return [4, 5];
  if (n === 'bare_rock' || n === 'scree' || n === 'shingle') return [5, 4];
  if (l === 'forest' || n === 'wood' || n === 'scrub') return [1, 3];
  if (l === 'farmland' || l === 'orchard' || l === 'vineyard') return [7, 2];
  if (l === 'meadow' || n === 'grassland' || n === 'heath' || n === 'fell') return [0, 1];
  return null;
}

/** Riempimento pari-dispari di anelli (esterni e interni insieme) sulla griglia a 25 m. */
function rasterize(rings: [number, number][][], value: number, pri: number, grid: Uint8Array, prio: Uint8Array) {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const r of rings) for (const p of r) [minZ, maxZ] = [Math.min(minZ, p[1]), Math.max(maxZ, p[1])];
  const j0 = Math.max(0, Math.ceil((minZ - BOUNDS.z0) / DEM_STEP));
  const j1 = Math.min(GH - 1, Math.floor((maxZ - BOUNDS.z0) / DEM_STEP));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const z = BOUNDS.z0 + j * DEM_STEP;
    xs.length = 0;
    for (const r of rings) {
      for (let k = 0; k < r.length - 1; k++) {
        const [ax, az] = r[k];
        const [bx, bz] = r[k + 1];
        if ((az <= z && bz > z) || (bz <= z && az > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - BOUNDS.x0) / DEM_STEP));
      const i1 = Math.min(GW - 1, Math.floor((xs[k + 1] - BOUNDS.x0) / DEM_STEP));
      for (let i = i0; i <= i1; i++) {
        const c = j * GW + i;
        if (pri >= prio[c]) {
          grid[c] = value;
          prio[c] = pri;
        }
      }
    }
  }
}

const ringLocal = (r: [number, number][]) => r.map(([lon, lat]) => toLocal(lat, lon));
{
  const areas = [...read<OsmArea>('landuse'), ...read<OsmArea | OsmWay>('water').filter((e): e is OsmArea => e.type === 'area')];
  for (const a of areas) {
    const c = coverClass(a.tags);
    if (!c) continue;
    rasterize([...a.outer, ...(a.inner ?? [])].map(ringLocal), c[0], c[1], cover, coverPri);
  }
  log(`suolo: ${areas.length} aree rasterizzate`);
}

// ---------- fiumi (servono anche al suolo: l'alveo è acqua) ----------

interface River {
  name: string;
  kind: 'river' | 'canal' | 'stream';
  hw: number;
  xz: [number, number][];
}
const waterWays = read<OsmWay | OsmArea>('water').filter((e): e is OsmWay => e.type === 'way');
const rivers: River[] = [];
{
  // si uniscono i pezzi con lo stesso nome che si toccano capo-coda, nel verso della corrente
  const byName = new Map<string, OsmWay[]>();
  for (const w of waterWays) {
    if (w.tags.tunnel && w.tags.tunnel !== 'no') continue;
    const k = `${w.tags.waterway}|${w.tags.name ?? w.id}`;
    const l = byName.get(k);
    if (l) l.push(w);
    else byName.set(k, [w]);
  }
  for (const [k, list] of byName) {
    const kind = k.split('|')[0] as River['kind'];
    const pieces = list.map((w) => ({ nodes: w.nodes, xz: w.geometry.map((g) => toLocal(g.lat, g.lon)), used: false, width: parseFloat(w.tags.width ?? '') }));
    const startOf = new Map<number, number>();
    pieces.forEach((p, i) => startOf.set(p.nodes[0], i));
    const ends = new Set(pieces.map((p) => p.nodes[p.nodes.length - 1]));
    // prima le catene che cominciano da una sorgente (nessuno sbocca nel loro primo nodo), poi gli anelli
    const order = [...pieces.keys()].sort((p, q) => Number(ends.has(pieces[p].nodes[0])) - Number(ends.has(pieces[q].nodes[0])));
    for (const i of order) {
      if (pieces[i].used) continue;
      let cur: number | undefined = i;
      const xz: [number, number][] = [];
      let width = NaN;
      while (cur != null && !pieces[cur].used) {
        const p = pieces[cur];
        p.used = true;
        xz.push(...(xz.length ? p.xz.slice(1) : p.xz));
        if (Number.isFinite(p.width)) width = p.width;
        cur = startOf.get(p.nodes[p.nodes.length - 1]);
      }
      if (polyLen(xz) < (kind === 'stream' ? 1500 : 300)) continue;
      const name = list[0].tags.name ?? '';
      const hw = Number.isFinite(width) ? Math.min(40, width / 2) : kind === 'river' ? riverWidth(name) : kind === 'canal' ? 4 : 2.5;
      rivers.push({ name, kind, hw, xz: densify(simplify(xz, 3), 30) });
    }
  }
  log(`fiumi: ${rivers.length} linee (${rivers.filter((r) => r.kind === 'river').length} fiumi)`);
}

function riverWidth(name: string): number {
  if (/^(Fiume )?(Brembo|Serio)$/.test(name)) return 14;
  if (/Brembo|Serio/.test(name)) return 6;
  if (/Adda|Oglio/.test(name)) return 30;
  return 7;
}

const riverOut = rivers.map((r) => {
  // il livello scende sempre a valle: il minimo progressivo del DEM lungo la corrente
  let level = Infinity;
  const ys = r.xz.map(([x, z]) => {
    const h = demAt(x, z) - 0.8;
    level = Math.min(level, h);
    return level;
  });
  // ma non si appiattisce di colpo dopo una buca del DEM: si lascia scendere al più del 10%
  for (let i = ys.length - 2; i >= 0; i--) {
    const run = Math.hypot(r.xz[i + 1][0] - r.xz[i][0], r.xz[i + 1][1] - r.xz[i][1]);
    ys[i] = Math.min(ys[i], ys[i + 1] + run * 0.1);
  }
  for (let i = 0; i < r.xz.length; i++) {
    const [x, z] = r.xz[i];
    const ci = Math.round((x - BOUNDS.x0) / DEM_STEP);
    const cj = Math.round((z - BOUNDS.z0) / DEM_STEP);
    const rad = Math.ceil(r.hw / DEM_STEP);
    for (let dj = -rad; dj <= rad; dj++) {
      for (let di = -rad; di <= rad; di++) {
        const ii = ci + di;
        const jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
        cover[jj * GW + ii] = 6;
      }
    }
  }
  return { r, ys };
});

// ---------- mattonelle del terreno ----------

{
  const n = Math.round(TILE / DEM_STEP);
  const side = n + 1;
  let bytes = 0;
  for (let tx = 0; tx < TX; tx++) {
    for (let tz = 0; tz < TZ; tz++) {
      const buf = Buffer.alloc(side * side * 3);
      let prevRow = 0;
      for (let j = 0; j < side; j++) {
        let prev = 0;
        for (let i = 0; i < side; i++) {
          const x = BOUNDS.x0 + tx * TILE + i * DEM_STEP;
          const z = BOUNDS.z0 + tz * TILE + j * DEM_STEP;
          const v = Math.max(-3000, Math.min(32000, Math.round(demAt(x, z) * 10)));
          const d = i === 0 ? v - prevRow : v - prev;
          if (i === 0) prevRow = v;
          prev = v;
          buf.writeInt16LE(Math.max(-32768, Math.min(32767, d)), (j * side + i) * 2);
          const gi = tx * n + i;
          const gj = tz * n + j;
          buf[side * side * 2 + j * side + i] = gi < GW && gj < GH ? cover[gj * GW + gi] : 0;
        }
      }
      const z = deflateSync(buf, { level: 9 });
      bytes += z.length;
      writeFileSync(join(OUT, 'dem', `${tx}_${tz}.bin`), z);
    }
  }
  log(`terreno: ${TX}×${TZ} mattonelle da ${TILE} m, ${(bytes / 1e6).toFixed(1)} MB`);
}

// ---------- terreno lontano ----------

{
  const buf = Buffer.alloc(FAR.nx * FAR.nz * 2);
  let prevRow = 0;
  for (let j = 0; j < FAR.nz; j++) {
    let prev = 0;
    for (let i = 0; i < FAR.nx; i++) {
      const x = FAR.x0 + i * FAR.step;
      const z = FAR.z0 + j * FAR.step;
      const g = toGeo(x, z);
      let v = dem11.sample(g.lat, g.lon);
      if (!Number.isFinite(v)) v = prev;
      const iv = Math.round(v);
      const d = i === 0 ? iv - prevRow : iv - prev;
      if (i === 0) prevRow = iv;
      prev = iv;
      buf.writeInt16LE(d, (j * FAR.nx + i) * 2);
    }
  }
  const z = deflateSync(buf, { level: 9 });
  writeFileSync(join(OUT, 'far.bin'), z);
  log(`orizzonte: ${FAR.nx}×${FAR.nz} a ${FAR.step} m, ${(z.length / 1e6).toFixed(2)} MB`);
}

// ---------- edifici ----------

const KIND = { house: 0, apartments: 1, industrial: 2, church: 3, tower: 4, civic: 5, castle: 6 };
function buildingInfo(t: Tags, inCity: boolean, area: number): { kind: number; h: number; minH: number; roof: number } {
  const b = t.building;
  let kind = KIND.house;
  if (b === 'apartments' || b === 'residential' || b === 'hotel' || b === 'dormitory') kind = KIND.apartments;
  else if (b === 'industrial' || b === 'warehouse' || b === 'commercial' || b === 'retail' || b === 'supermarket' || b === 'hangar' || b === 'service' || b === 'factory' || b === 'garages' || b === 'roof') kind = KIND.industrial;
  else if (b === 'church' || b === 'cathedral' || b === 'chapel' || b === 'basilica' || b === 'religious' || b === 'monastery' || t.amenity === 'place_of_worship') kind = KIND.church;
  else if (b === 'tower' || b === 'bell_tower' || b === 'campanile' || t.man_made === 'tower' || t.man_made === 'campanile') kind = KIND.tower;
  else if (b === 'castle' || t.historic === 'castle' || b === 'fortress') kind = KIND.castle;
  else if (b === 'public' || b === 'civic' || b === 'school' || b === 'university' || b === 'hospital' || b === 'government' || b === 'train_station' || b === 'stadium' || b === 'office' || b === 'theatre') kind = KIND.civic;
  const num = (v?: string) => {
    const f = parseFloat((v ?? '').replace(',', '.'));
    return Number.isFinite(f) ? f : NaN;
  };
  let h = num(t.height);
  const levels = num(t['building:levels']);
  const roofLv = num(t['roof:levels']);
  if (!Number.isFinite(h)) {
    if (Number.isFinite(levels)) h = levels * 3.1 + (Number.isFinite(roofLv) ? roofLv * 2 : 1.2);
    else if (kind === KIND.tower) h = area < 40 ? 28 : 36;
    else if (kind === KIND.church) h = b === 'cathedral' || b === 'basilica' ? 26 : area > 300 ? 17 : 10;
    else if (kind === KIND.castle) h = 14;
    else if (kind === KIND.industrial) h = area > 1500 ? 10 : 6;
    else if (kind === KIND.civic) h = 14;
    else if (b === 'garage' || b === 'shed' || b === 'hut' || b === 'cabin' || b === 'barn' || b === 'farm_auxiliary' || b === 'stable') h = 4;
    else if (kind === KIND.apartments) h = inCity ? 17 : 12;
    else h = inCity ? 12 : area > 250 ? 9 : 7;
  }
  const minH = Math.max(0, num(t.min_height) || (Number.isFinite(num(t['building:min_level'])) ? num(t['building:min_level']) * 3.1 : 0));
  // tetto: 0 coppi, 1 grigio piatto, 2 rame/piombo (cupole e chiese grandi), 3 ardesia
  const roof = kind === KIND.industrial || kind === KIND.civic ? 1 : kind === KIND.church && area > 600 ? 2 : 0;
  return { kind, h: Math.min(120, Math.max(2.5, h)), minH: Math.min(minH, h - 1), roof };
}

{
  const perTile = new Map<string, number[][]>();
  let count = 0;
  let dropped = 0;
  for (const a of read<OsmArea>('buildings')) {
    if (a.tags.building === 'no' || a.tags.building === 'construction' || a.tags.building === 'ruins' && !a.tags.name) continue;
    if (a.tags.location === 'underground' || Number(a.tags.layer ?? 0) < 0) continue;
    for (const outer of a.outer) {
      const ring = simplifyRing(ringLocal(outer), 0.6);
      if (ring.length < 3) continue;
      let area2 = 0;
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % ring.length];
        area2 += ax * bz - bx * az;
      }
      const area = Math.abs(area2) / 2;
      if (area < 12) {
        dropped++;
        continue;
      }
      // verso fisso (area con segno negativa in x-z): così le pareti guardano fuori senza calcoli nel browser
      if (area2 > 0) ring.reverse();
      let cx = 0;
      let cz = 0;
      for (const p of ring) {
        cx += p[0];
        cz += p[1];
      }
      cx /= ring.length;
      cz /= ring.length;
      const tx = Math.floor((cx - BOUNDS.x0) / TILE);
      const tz = Math.floor((cz - BOUNDS.z0) / TILE);
      if (tx < 0 || tz < 0 || tx >= TX || tz >= TZ) continue;
      const g = toGeo(cx, cz);
      const inCity = g.lat >= CITY.s && g.lat <= CITY.n && g.lon >= CITY.w && g.lon <= CITY.e;
      const info = buildingInfo(a.tags, inCity, area);
      const ox = BOUNDS.x0 + tx * TILE;
      const oz = BOUNDS.z0 + tz * TILE;
      const rec = [info.kind, dm(info.h), dm(info.minH), info.roof];
      let px = 0;
      let pz = 0;
      for (const [x, z] of ring) {
        const qx = dm(x - ox);
        const qz = dm(z - oz);
        rec.push(qx - px, qz - pz);
        px = qx;
        pz = qz;
      }
      const key = `${tx}_${tz}`;
      const l = perTile.get(key);
      if (l) l.push(rec);
      else perTile.set(key, [rec]);
      count++;
      // l'impronta di un edificio è suolo costruito, anche dove OSM non ha disegnato il quartiere
      const ci = Math.round((cx - BOUNDS.x0) / DEM_STEP);
      const cj = Math.round((cz - BOUNDS.z0) / DEM_STEP);
      if (ci >= 0 && cj >= 0 && ci < GW && cj < GH && coverPri[cj * GW + ci] < 6) cover[cj * GW + ci] = info.kind === KIND.industrial ? 3 : 2;
    }
  }
  let bytes = 0;
  for (const [key, list] of perTile) {
    const [tx, tz] = key.split('_').map(Number);
    const s = JSON.stringify({ o: [BOUNDS.x0 + tx * TILE, BOUNDS.z0 + tz * TILE], b: list });
    bytes += s.length;
    writeFileSync(join(OUT, 'b', `${key}.json`), s);
  }
  log(`edifici: ${count} in ${perTile.size} mattonelle, ${(bytes / 1e6).toFixed(1)} MB (scartati ${dropped} sotto i 12 m²)`);
}

// ---------- mura, ferrovie, funivie ----------

function lineOut(w: OsmWay, lift: (x: number, z: number) => number) {
  const xz = densify(simplify(w.geometry.map((g) => toLocal(g.lat, g.lon)), 1), 15);
  const p: number[] = [];
  let px = 0;
  let pz = 0;
  let py = 0;
  for (const [x, z] of xz) {
    const X = dm(x);
    const Z = dm(z);
    const Y = dm(lift(x, z));
    p.push(X - px, Z - pz, Y - py);
    px = X;
    pz = Z;
    py = Y;
  }
  return p;
}

const field = (x: number, z: number) => {
  // sulle mura di Città Alta corre la strada: la cima del muro è la quota della strada vicina
  const hit = graph.nearest(x, z, 25);
  if (hit) return graph.pose(hit.edge, hit.s).y;
  return demAt(x, z);
};
const walls = wallsRaw.filter((w) => w.tags.barrier === 'city_wall' || w.tags.historic === 'citywalls').map((w) => ({ k: 'mura', n: w.tags.name, p: lineOut(w, field) }));
const rails = wallsRaw.filter((w) => w.tags.railway && !(w.tags.railway === 'rail' && (w.tags.service === 'yard' || w.tags.service === 'siding'))).map((w) => ({ k: w.tags.railway, n: w.tags.name, p: lineOut(w, demAt) }));
const cables = wallsRaw.filter((w) => w.tags.aerialway && w.tags.aerialway !== 'station' && w.tags.aerialway !== 'pylon').map((w) => ({ k: w.tags.aerialway, n: w.tags.name, p: lineOut(w, demAt) }));

const lakes = read<OsmArea | OsmWay>('water')
  .filter((e): e is OsmArea => e.type === 'area' && (e.tags.water === 'lake' || e.tags.water === 'reservoir' || e.tags.water === 'pond' || (e.tags.natural === 'water' && !e.tags.water)))
  .map((a) => {
    const ring = simplifyRing(ringLocal(a.outer[0]), 2);
    let area2 = 0;
    for (let i = 0; i < ring.length; i++) area2 += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1];
    const hs = ring.map(([x, z]) => demAt(x, z)).sort((p, q) => p - q);
    return { name: a.tags.name ?? '', area: Math.abs(area2) / 2, level: hs[Math.floor(hs.length * 0.15)] ?? 0, ring };
  })
  .filter((l) => l.area > 4000);

// ---------- percorsi e luoghi ----------

const ctx = { graph, toLocal, toGeo, demAt, peaks, places, pois: poisRaw, rivers: riverOut.map(({ r, ys }) => ({ ...r, ys })), named, log };
const { rides, landmarks, limits } = buildRides(ctx);

const delta3 = (xz: [number, number][], ys: number[]) => {
  const p: number[] = [];
  let px = 0;
  let pz = 0;
  let py = 0;
  xz.forEach(([x, z], i) => {
    const X = dm(x);
    const Z = dm(z);
    const Y = dm(ys[i]);
    p.push(X - px, Z - pz, Y - py);
    px = X;
    pz = Z;
    py = Y;
  });
  return p;
};
const delta2 = (xz: [number, number][]) => {
  const p: number[] = [];
  let px = 0;
  let pz = 0;
  for (const [x, z] of xz) {
    const X = dm(x);
    const Z = dm(z);
    p.push(X - px, Z - pz);
    px = X;
    pz = Z;
  }
  return p;
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const majorPeaks = peaks.filter((p) => p.ele > 900 || p.pass);
const features = {
  rivers: riverOut.map(({ r, ys }) => ({ n: r.name, k: r.kind, hw: r.hw, p: delta3(r.xz, ys) })),
  lakes: lakes.map((l) => ({ n: l.name, y: r1(l.level), r: delta2(l.ring) })),
  peaks: majorPeaks.map((p) => [p.name, r1(p.x), r1(p.z), Math.round(p.ele), p.pass ? 1 : 0]),
  places: places.map((p) => [p.name, p.kind, r1(p.x), r1(p.z), r1(p.y)]),
  walls,
  rails,
  cables,
  landmarks,
};
writeFileSync(join(OUT, 'features.json'), JSON.stringify(features));
writeFileSync(join(OUT, 'rides.json'), JSON.stringify(rides));
log(`features.json ${(JSON.stringify(features).length / 1e6).toFixed(2)} MB: ${rivers.length} fiumi, ${lakes.length} laghi, ${majorPeaks.length} cime, ${places.length} località, ${walls.length} mura, ${rails.length} binari, ${cables.length} funi`);
log(`rides.json: ${rides.length} percorsi, ${landmarks.length} luoghi`);

const limitsTs = `// GENERATO da scripts/world/build-world.ts: non modificare a mano.
// Per ogni percorso del mondo: lunghezza del tratto cronometrato e tempo minimo credibile
// (un professionista a 6,8 W/kg, con il 15% di margine). Li usa il server della classifica.

export const WORLD_ID = 'bergamo';
export const WORLD_EDGES = ${graph.edges.length};
export const WORLD_RIDES: Record<string, { timedM: number; minSec: number }> = ${JSON.stringify(limits, null, 2)};
`;
writeFileSync(join(ROOT, 'src', 'multiplayer', 'world-rides.ts'), limitsTs);
log('fatto');
if (!existsSync(join(OUT, 'graph.json'))) process.exit(1);
