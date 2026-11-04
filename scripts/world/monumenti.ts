// I quaranta monumenti del mondo di Bergamo: quali sono, dove stanno, che forma hanno.
//
// Ogni voce è un elemento OSM vero (id e nome atteso: se il nome non torna la costruzione si
// ferma e lo dice) e un archetipo coi suoi parametri, la «foto mentale» del luogo vero: il
// leone di San Marco sulle porte, la cella campanaria del Campanone, il rosone, la guglia
// del Mausoleo Briolini. L'impronta, il centro, il verso della facciata, la quota del terreno
// e la strada vicina li misura buildMonumenti dai dati OSM e dal DEM. La scelta dei quaranta
// viene da scripts/world/monumenti-scan.ts: prima quelli lungo i percorsi.
//
// Le altezze: il tag OSM `height` quando c'è (se non va d'accordo con `building:levels`, più
// di 6 m a piano, vincono i piani); altrimenti quella scritta qui, a misura d'occhio.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLAG, type WorldGraph } from '../../src/open/graph';
import type { Archetipo, MonumentiFile, MonumentoFile, Params } from '../../src/open/monumenti';

type Tags = Record<string, string>;
type Front = 'n' | 's' | 'e' | 'w' | 'strada';

export interface MonumentoSpec {
  /** «w», «r» o «n» + id OSM */
  ref: string;
  /** il nome in OSM (name, o artwork_subject per le statue senza nome) */
  osm: string;
  /** il nome da mostrare, se quello OSM da solo non basta */
  name?: string;
  kind: Archetipo;
  /** altezza in metri, se OSM non la dà */
  h: number;
  /** dove guarda la facciata (default: verso la strada più vicina) */
  front?: Front;
  /** un nodo dentro un edificio senza nome: l'impronta è quella dell'edificio */
  edificio?: boolean;
  p?: Params;
}

export const SPECS: MonumentoSpec[] = [
  // ---------- Città Alta ----------
  { ref: 'w30964918', osm: "Porta Sant'Agostino", kind: 'porta', h: 15, p: { stile: 'pietra', leone: true } },
  { ref: 'w32708443', osm: "Porta Sant'Alessandro", kind: 'porta', h: 14, p: { stile: 'pietra', leone: true } },
  { ref: 'w30964149', osm: 'Porta San Giacomo', kind: 'porta', h: 13, p: { stile: 'marmo', leone: true } },
  { ref: 'w33232721', osm: 'Porta San Lorenzo', kind: 'porta', h: 9, p: { stile: 'pietra', lapide: true, fornice: 3.4 } },
  { ref: 'w79808376', osm: 'Campanone', kind: 'torre', h: 52, front: 'e', p: { cella: 2, orologio: 1, tetto: 'cupolino' } },
  { ref: 'w79808367', osm: 'Torre del Gombito', kind: 'torre', h: 52, p: { tetto: 'piramide', feritoie: true } },
  { ref: 'w375230289', osm: 'Torre di Adalberto', kind: 'torre', h: 26, p: { tetto: 'piramide', feritoie: true, mat: 'ocra' } },
  {
    ref: 'w79808361',
    osm: 'Basilica di Santa Maria Maggiore',
    kind: 'chiesa',
    h: 22,
    front: 'n',
    p: { mat: 'pietra', facciata: 'romanica', protiro: true, loggia: true, cupola: 'tiburio', cupolaZ: 0, cupolaH: 40, campanile: 52, campanileX: -1, campanileTetto: 'cupolino' },
  },
  { ref: 'w79808375', osm: 'Cappella Colleoni', kind: 'cappella', h: 15, front: 'e' },
  {
    ref: 'w79808365',
    osm: 'Duomo di Bergamo',
    kind: 'chiesa',
    h: 27,
    front: 'w',
    p: { mat: 'marmo', trim: 'marmo', facciata: 'neoclassica', colonne: 6, cupola: 'cupola', cupolaZ: -0.35, cupolaH: 56, statua: true },
  },
  { ref: 'w79808370', osm: 'Battistero', kind: 'tempietto', h: 15 },
  { ref: 'w53001239', osm: 'Palazzo della Ragione', kind: 'palazzo', h: 20, front: 'n', p: { mat: 'pietra', portico: 'tutto', porticoH: 7.5, trifore: true, leone: true, piani: 1 } },
  { ref: 'r5930793', osm: 'Rocca', kind: 'castello', h: 14, p: { mura: 10, torri: 13, mastio: 22, mastioR: 6.5 } },
  { ref: 'r2447761', osm: 'Castello di San Vigilio', kind: 'castello', h: 11, p: { mura: 7, torri: 10 } },
  { ref: 'n12368739504', osm: 'Bergamo Alta', name: 'Funicolare, Bergamo Alta', kind: 'stazione', h: 10, edificio: true, p: { tipo: 'funicolare', mat: 'giallo' } },
  { ref: 'n12390509812', osm: 'San Vigilio', name: 'Funicolare di San Vigilio', kind: 'stazione', h: 7, edificio: true, p: { tipo: 'funicolare', mat: 'rosa' } },
  // ---------- Città Bassa ----------
  { ref: 'w417230878', osm: 'Torre dei Caduti', kind: 'torre', h: 45, p: { mat: 'travertino', cella: 3, orologio: 4, tetto: 'terrazza', lesene: true } },
  { ref: 'n12453227640', osm: 'Teatro Donizetti', kind: 'palazzo', h: 20, front: 'n', edificio: true, p: { mat: 'bianco', trim: 'pietra', colonne: 8, piani: 3, tetto: 'padiglione' } },
  { ref: 'w134017753', osm: 'Gaetano Donizetti', name: 'Monumento a Gaetano Donizetti', kind: 'statua', h: 7, p: { posa: 'seduto', musa: true, mat: 'marmo', piedistallo: 3.6, piedistalloL: 3.2, piedistalloP: 2.6, figura: 3 } },
  { ref: 'n12779339939', osm: 'Giuseppe Garibaldi', name: 'Statua di Giuseppe Garibaldi', kind: 'statua', h: 9, p: { posa: 'in-piedi', mantello: true, piedistallo: 5, piedistalloL: 2.4, figura: 3.2 } },
  { ref: 'w150588691', osm: 'Monumento Vittorio Emanuele II', kind: 'statua', h: 9, p: { posa: 'in-piedi', braccio: 'avanti', mantello: true, piedistallo: 5.5, piedistalloL: 2.8, figura: 3.4 } },
  {
    ref: 'n8607336257',
    osm: 'Bergamo',
    name: 'Stazione di Bergamo',
    kind: 'stazione',
    h: 12,
    front: 'n',
    edificio: true,
    p: { tipo: 'treno', mat: 'giallo', trim: 'bianco', piani: 2, padiglioni: 'centro', orologio: true, pensilina: true, tetto: 'piano', archi: true, passo: 4.2 },
  },
  { ref: 'n8285875955', osm: 'Accademia Carrara', kind: 'palazzo', h: 17, edificio: true, p: { mat: 'bianco', trim: 'pietra', colonne: 4, timpano: true, piani: 2 } },
  // ---------- Val Seriana ----------
  { ref: 'w168754442', osm: 'Basilica di San Martino', kind: 'chiesa', h: 24, p: { mat: 'bianco', trim: 'pietra', facciata: 'barocca', campanile: 52, campanileX: 1, campanileStacco: true, campanileTetto: 'cupolino' } },
  { ref: 'w167032862', osm: 'Mausoleo Briolini', kind: 'mausoleo', h: 18, p: { lato: 4.2, mat: 'botticino' } },
  { ref: 'n515750131', osm: 'Gazzaniga ai Caduti', kind: 'caduti', h: 7, p: { forma: 'stele' } },
  { ref: 'w1553828437', osm: 'Monumento ai caduti di Albino', kind: 'caduti', h: 5.5, p: { forma: 'muro', mat: 'ocra' } },
  { ref: 'w99334420', osm: 'Albino Stazione Funivia', name: 'Funivia Albino–Selvino, Albino', kind: 'stazione', h: 9, p: { tipo: 'funivia', mat: 'bianco' } },
  { ref: 'w94689200', osm: 'Selvino Stazione Funivia', name: 'Funivia Albino–Selvino, Selvino', kind: 'stazione', h: 8, p: { tipo: 'funivia', mat: 'bianco' } },
  { ref: 'r18610856', osm: 'Madonna del Colle Gallo', kind: 'chiesa', h: 13, p: { mat: 'bianco', trim: 'pietra', facciata: 'alpina', portico: true, campanile: 26, campanileX: 1 } },
  { ref: 'w362738343', osm: 'Palazzo Comunale', name: 'Palazzo dell’Orologio, Clusone', kind: 'palazzo', h: 14, p: { mat: 'giallo', piani: 2, torre: 32, torreX: -0.55, torreLato: 6.5, planetario: true, torreTetto: 'piramide' } },
  {
    ref: 'w133264948',
    osm: 'Basilica di Santa Maria Assunta e San Giovanni Battista',
    name: 'Basilica di Santa Maria Assunta, Clusone',
    kind: 'chiesa',
    h: 26,
    p: { mat: 'giallo', trim: 'pietra', facciata: 'barocca', campanile: 56, campanileX: 1, campanileStacco: true },
  },
  { ref: 'w242970525', osm: 'Oratorio dei Disciplini', kind: 'chiesa', h: 12, p: { mat: 'bianco', trim: 'pietra', facciata: 'alpina', affresco: true, rosone: false, campanile: 18, campanileX: -1 } },
  { ref: 'n7711477624', osm: 'Monumento al minatore e taissina', kind: 'statua', h: 6, p: { posa: 'coppia', piedistallo: 2.2, piedistalloL: 2.6, figura: 2.4 } },
  // ---------- Val Brembana ----------
  {
    ref: 'w207542898',
    osm: 'Ex-Casinò Municipale',
    name: 'Casinò di San Pellegrino',
    kind: 'palazzo',
    h: 21,
    p: { mat: 'bianco', trim: 'ocra', piani: 3, padiglioni: 'tutti', cupole: true, archi: true, tetto: 'mansarda' },
  },
  { ref: 'r15336094', osm: 'Grand Hotel San Pellegrino', kind: 'palazzo', h: 30, p: { mat: 'giallo', trim: 'bianco', piani: 6, padiglioni: 'tutti', cupole: true, tetto: 'mansarda', passo: 3.4 } },
  { ref: 'n7370271512', osm: 'Statua di Papa Giovanni XXIII', kind: 'statua', h: 6, p: { posa: 'in-piedi', braccio: 'alzato', mantello: true, piedistallo: 2.4, figura: 2.8 } },
  { ref: 'w1155366655', osm: 'Campanile pendente', name: 'Campanile pendente del Cornello', kind: 'torre', h: 16, p: { mat: 'pietra', cella: 1, tetto: 'cuspide', pendenza: 2 } },
  { ref: 'w58831621', osm: 'Cantoniera di San Marco', name: 'Ca’ San Marco', kind: 'casa', h: 10, p: { mat: 'pietra', tetto: 'piode', piani: 3 } },
  { ref: 'n10934027508', osm: 'Monumento a Palma il Vecchio', kind: 'statua', h: 6, p: { posa: 'in-piedi', braccio: 'petto', mantello: true, piedistallo: 2.6, figura: 2.6 } },
];

// ---------- costruzione ----------

interface Ctx {
  toLocal: (lat: number, lon: number) => [number, number];
  demAt: (x: number, z: number) => number;
  graph: WorldGraph;
  osmDir: string;
  outDir: string;
  log: (...a: unknown[]) => void;
}

interface OsmArea {
  type: 'area';
  id: number;
  way: boolean;
  tags: Tags;
  outer: [number, number][][];
}
interface Extra {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags: Tags;
  geometry?: { lat: number; lon: number }[];
  outer?: [number, number][][];
}

type P2 = [number, number];

function inside(r: P2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const area = (r: P2[]) => Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2);

function hull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [];
  const up: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Il rettangolo di area minima attorno ai punti: direzione dell'asse u (radianti nel piano x-z). */
function minRect(pts: P2[]): number {
  const h = hull(pts);
  let best = { a: Infinity, ang: 0 };
  for (let i = 0; i < h.length; i++) {
    const [ax, az] = h[i];
    const [bx, bz] = h[(i + 1) % h.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const [x, z] of h) {
      const a = x * ux + z * uz;
      const b = -x * uz + z * ux;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const A = (a1 - a0) * (b1 - b0);
    if (A < best.a) best = { a: A, ang: Math.atan2(uz, ux) };
  }
  return best.ang;
}

/** Toglie i vertici quasi allineati e quelli a meno di `tol` metri: anelli leggeri per il browser. */
function simplify(r: P2[], tol: number, max = 40): P2[] {
  let out = r.filter((p, i) => i === 0 || Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) > 0.05);
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  let t = tol;
  for (let pass = 0; pass < 8; pass++) {
    const keep: P2[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = keep.length ? keep[keep.length - 1] : out[out.length - 1];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const dist = Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / L;
      if (dist > t || out.length - (i - keep.length) <= 4) keep.push(b);
    }
    out = keep.length >= 3 ? keep : out;
    if (out.length <= max) break;
    t *= 1.6;
  }
  return out;
}

const DIRS: Record<Exclude<Front, 'strada'>, P2> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface MonumentiBuild {
  file: MonumentiFile;
  /** l'edificio generico (chiave «w»/«r» + id) che il monumento sostituisce */
  skip: (a: { id: number; way: boolean }) => boolean;
  /** un luogo da passare che il monumento ha già (stesso posto o stesso nome): non si duplica */
  hides: (x: number, z: number, name?: string) => boolean;
}

export function buildMonumenti(ctx: Ctx): MonumentiBuild {
  const { toLocal, demAt, graph, osmDir, log } = ctx;
  const read = <T>(n: string): T[] => (existsSync(join(osmDir, `${n}.json`)) ? (JSON.parse(readFileSync(join(osmDir, `${n}.json`), 'utf8')) as { elements: T[] }).elements : []);
  const buildings = read<OsmArea>('buildings');
  const extra = read<Extra>('monumenti-nodi');
  const pois = read<{ type: string; id: number; center: { lat: number; lon: number }; tags: Tags }>('pois');
  const points = read<{ id: number; lat: number; lon: number; tags: Tags }>('points');
  if (!extra.length) log('monumenti: manca cache/osm/monumenti-nodi.json (python scripts/world/monumenti-extract.py): le voci che vengono da lì non si trovano');
  const bKey = (a: { id: number; way: boolean }) => `${a.way ? 'w' : 'r'}${a.id}`;
  const byKey = new Map(buildings.map((a) => [bKey(a), a]));
  const ringLocal = (r: [number, number][]): P2[] => r.map(([lon, lat]) => toLocal(lat, lon));
  // le porte guardano fuori dalle Mura: il centro delle quattro porte sta dentro Città Alta
  const lines = (k: string) =>
    read<{ type: string; tags: Tags; geometry: { lat: number; lon: number }[] }>('walls')
      .filter((w) => w.tags[k] && w.tags.aerialway !== 'pylon' && w.tags.aerialway !== 'station')
      .filter((w) => k !== 'railway' || w.tags.railway === 'funicular')
      .map((w) => w.geometry.map((g) => toLocal(g.lat, g.lon)));
  const cablesL = lines('aerialway');
  const funicL = lines('railway');

  const solid = (e: { flags: number }) => !(e.flags & (FLAG.bridge | FLAG.tunnel));
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  /** La quota del terreno raccordato alle strade, come la calcola WorldField.height nel browser. */
  const ground = (x: number, z: number): number => {
    const h = demAt(x, z);
    const hit = graph.nearest(x, z, 64, solid);
    if (!hit) return h;
    const base = graph.pose(hit.edge, hit.s).y - 0.4;
    return base + (h - base) * smooth(1.5, 40, Math.max(0, hit.d - graph.edges[hit.edge].hw));
  };

  const out: MonumentoFile[] = [];
  const skipKeys = new Set<string>();
  const shapes: { rings: P2[][]; name: string; osm: string; x: number; z: number; small: boolean }[] = [];
  const raw: { spec: MonumentoSpec; rings: P2[][]; tags: Tags; node: P2 | null }[] = [];

  for (const spec of SPECS) {
    const kind = spec.ref[0];
    const id = Number(spec.ref.slice(1));
    let rings: P2[][] = [];
    let tags: Tags | null = null;
    let node: P2 | null = null;
    if (kind === 'w' || kind === 'r') {
      const b = byKey.get(spec.ref);
      if (b) {
        rings = b.outer.map(ringLocal);
        tags = b.tags;
        skipKeys.add(spec.ref);
      } else {
        const e = extra.find((q) => q.id === id && q.type === (kind === 'w' ? 'way' : 'relation'));
        if (e?.geometry) rings = [e.geometry.map((g) => toLocal(g.lat, g.lon))];
        else if (e?.outer) rings = e.outer.map(ringLocal);
        if (e) tags = e.tags;
      }
      const full = pois.find((q) => q.id === id && q.type !== 'node');
      if (full) tags = { ...full.tags, ...(tags ?? {}) };
    } else {
      const e = extra.find((q) => q.type === 'node' && q.id === id);
      const pq = pois.find((q) => q.type === 'node' && q.id === id);
      const pt = points.find((q) => q.id === id);
      if (e) {
        node = toLocal(e.lat!, e.lon!);
        tags = e.tags;
      } else if (pq) {
        node = toLocal(pq.center.lat, pq.center.lon);
        tags = pq.tags;
      } else if (pt) {
        node = toLocal(pt.lat, pt.lon);
        tags = pt.tags;
      }
      if (node && spec.edificio) {
        let best: OsmArea | null = null;
        let bestA = Infinity;
        for (const b of buildings) {
          const o = b.outer[0];
          const [lon0, lat0] = o[0];
          // un filtro grossolano prima del conto vero: 300 m in gradi
          if (Math.abs(lon0 - (pq?.center.lon ?? e?.lon ?? 0)) > 0.004 || Math.abs(lat0 - (pq?.center.lat ?? e?.lat ?? 0)) > 0.003) continue;
          const r = ringLocal(o);
          if (!inside(r, node[0], node[1])) continue;
          const a = area(r);
          if (a < bestA) {
            bestA = a;
            best = b;
          }
        }
        if (!best) throw new Error(`monumenti: ${spec.ref} «${spec.osm}» non sta dentro nessun edificio`);
        rings = best.outer.map(ringLocal);
        skipKeys.add(bKey(best));
      }
    }
    if (!tags) throw new Error(`monumenti: ${spec.ref} «${spec.osm}» non c'è nei dati OSM (manca monumenti-nodi.json?)`);
    const osmName = tags.name ?? tags.artwork_subject ?? '';
    if (osmName !== spec.osm) throw new Error(`monumenti: ${spec.ref} in OSM si chiama «${osmName}», non «${spec.osm}»`);
    rings = rings.map((r) => simplify(r, 0.35)).filter((r) => r.length >= 3 && area(r) > 1);
    if (!rings.length && !node) throw new Error(`monumenti: ${spec.ref} «${spec.osm}» senza impronta`);
    raw.push({ spec, rings, tags, node });
  }

  // il centro delle porte, per farle guardare fuori dalle Mura
  const porte = raw.filter((r) => r.spec.kind === 'porta');
  const pc: P2 = porte.length
    ? [porte.reduce((s, r) => s + r.rings[0].reduce((a, q) => a + q[0], 0) / r.rings[0].length, 0) / porte.length, porte.reduce((s, r) => s + r.rings[0].reduce((a, q) => a + q[1], 0) / r.rings[0].length, 0) / porte.length]
    : [0, 0];

  for (const { spec, rings, tags, node } of raw) {
    const all = rings.flat();
    const pts: P2[] = all.length ? all : [node!];
    // assi del rettangolo minimo (per un nodo senza impronta qualunque: lo decide la facciata)
    const ang = all.length >= 3 ? minRect(all) : 0;
    const u: P2 = [Math.cos(ang), Math.sin(ang)];
    const v: P2 = [-u[1], u[0]];
    const c0: P2 = all.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] : node!;
    const normals: P2[] = [u, [-u[0], -u[1]], v, [-v[0], -v[1]]];
    // la facciata: un punto cardinale, la strada più vicina, la fune della funivia, la discesa della funicolare
    let want: P2 | null = null;
    const road = graph.nearest(c0[0], c0[1], 400);
    const roadPose = road ? graph.pose(road.edge, road.s) : null;
    if (spec.front && spec.front !== 'strada') want = DIRS[spec.front];
    else if (spec.kind === 'stazione' && (spec.p?.tipo === 'funivia' || spec.p?.tipo === 'funicolare')) {
      const L = spec.p?.tipo === 'funivia' ? cablesL : funicL;
      let best: { d: number; far: P2 } | null = null;
      for (const line of L) {
        const a = line[0];
        const b = line[line.length - 1];
        const da = Math.hypot(a[0] - c0[0], a[1] - c0[1]);
        const db = Math.hypot(b[0] - c0[0], b[1] - c0[1]);
        const d = Math.min(da, db);
        if (!best || d < best.d) best = { d, far: da < db ? b : a };
      }
      if (best && best.d < 150) want = [best.far[0] - c0[0], best.far[1] - c0[1]];
    }
    if (!want && roadPose) want = spec.kind === 'porta' ? [Math.sin(roadPose.heading), Math.cos(roadPose.heading)] : [roadPose.x - c0[0], roadPose.z - c0[1]];
    if (!want) want = [0, 1];
    const wl = Math.hypot(want[0], want[1]) || 1;
    want = [want[0] / wl, want[1] / wl];
    let front: P2;
    if (!all.length) front = want;
    else {
      // le chiese guardano da un lato corto: la navata corre lungo il lato lungo
      let cands = normals;
      if (spec.kind === 'chiesa' && !spec.front) {
        const ext = (n: P2) => {
          const vals = all.map((p) => p[0] * n[0] + p[1] * n[1]);
          return Math.max(...vals) - Math.min(...vals);
        };
        const longAxis = ext(u) >= ext(v) ? u : v;
        cands = [longAxis, [-longAxis[0], -longAxis[1]]];
      }
      const score = (n: P2) => (spec.kind === 'porta' ? Math.abs(n[0] * want![0] + n[1] * want![1]) : n[0] * want![0] + n[1] * want![1]);
      front = cands.reduce((a, b) => (score(b) > score(a) ? b : a));
      if (spec.kind === 'porta') {
        // fra i due versi del fornice, quello che esce dalle Mura
        const out2: P2 = [c0[0] - pc[0], c0[1] - pc[1]];
        if (front[0] * out2[0] + front[1] * out2[1] < 0) front = [-front[0], -front[1]];
      }
    }
    const yaw = Math.atan2(front[0], front[1]);
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const toModel = (p: P2, c: P2): P2 => {
      const dx = p[0] - c[0];
      const dz = p[1] - c[1];
      return [dx * cs - dz * sn, dx * sn + dz * cs];
    };
    // centro del rettangolo, misure lungo gli assi del modello
    let c: P2 = c0;
    let w = 3.6;
    let d = 3.6;
    if (all.length) {
      const loc = all.map((p) => toModel(p, c0));
      const xs = loc.map((p) => p[0]);
      const zs = loc.map((p) => p[1]);
      const mx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const mz = (Math.max(...zs) + Math.min(...zs)) / 2;
      // dal riferimento del modello di nuovo al mondo (Mesh.append)
      c = [c0[0] + mx * cs + mz * sn, c0[1] - mx * sn + mz * cs];
      w = Math.max(...xs) - Math.min(...xs);
      d = Math.max(...zs) - Math.min(...zs);
    }
    const ringsModel = rings.map((r) => r.map((p) => toModel(p, c)));
    // altezza: OSM se c'è (e se va d'accordo coi piani), altrimenti quella della scheda
    const hTag = parseFloat((tags.height ?? '').replace(',', '.'));
    const lv = parseFloat(tags['building:levels'] ?? '');
    let h = spec.h;
    if (Number.isFinite(hTag)) h = Number.isFinite(lv) && hTag / lv > 6 ? lv * 4 + 3 : hTag;
    // il terreno sotto l'impronta (vertici e una griglia di 4 m dentro), e la strada accanto
    const samples: P2[] = [];
    if (all.length) {
      for (const r of rings) samples.push(...r);
      const xs = all.map((p) => p[0]);
      const zs = all.map((p) => p[1]);
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 4) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 4) if (rings.some((r) => inside(r, x, z))) samples.push([x, z]);
    } else for (const [dx, dz] of [[0, 0], [-2, -2], [2, -2], [2, 2], [-2, 2]]) samples.push([c[0] + dx, c[1] + dz]);
    // il terreno come lo vede chi pedala (src/open/field.ts): il DEM raccordato alle strade
    const hs = samples.map(([x, z]) => ground(x, z));
    // lo zoccolo scende sotto il più basso fra il terreno raccordato e il DEM nudo
    let yMin = Math.min(...hs, ...samples.map(([x, z]) => demAt(x, z))) - 0.3;
    const yMax = Math.max(...hs);
    // il pavimento: dalla parte alta (a valle si vede lo zoccolo), non più di 8 m sopra il punto più basso
    let y = Math.min(yMax, yMin + 8);
    if (process.env.MONUMENTI_DEBUG) log(`  ${spec.ref} terreno ${yMin.toFixed(1)}…${yMax.toFixed(1)} → ${y.toFixed(1)}`);
    if (spec.kind === 'porta' && roadPose && road!.d < 30) {
      // sotto il fornice passa la strada: il pavimento è la strada
      y = roadPose.y - 0.05;
      yMin = Math.min(yMin, y - 1);
    }
    if (spec.kind === 'statua' || spec.kind === 'caduti') y = Math.min(yMax, yMin + 1.5);
    const p: Params = { ...(spec.p ?? {}) };
    if (spec.p?.tipo === 'funicolare') {
      // la pendenza della linea davanti alla stazione, per la vettura
      const f = funicL.map((line) => ({ line, d: Math.min(...line.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))) })).sort((a, b) => a.d - b.d)[0];
      if (f && f.d < 150) {
        const a = f.line.reduce((best, q) => (Math.hypot(q[0] - c[0], q[1] - c[1]) < Math.hypot(best[0] - c[0], best[1] - c[1]) ? q : best));
        const b = f.line.find((q) => Math.hypot(q[0] - a[0], q[1] - a[1]) > 40) ?? f.line[f.line.length - 1];
        const run = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        p.pend = r1(Math.max(0.05, Math.min(0.6, Math.atan(Math.abs(demAt(a[0], a[1]) - demAt(b[0], b[1])) / run))) * 100) / 100;
      }
    }
    const name = spec.name ?? spec.osm;
    const reach = Math.round(Math.max(35, Math.min(140, Math.hypot(w, d) / 2 + 30)));
    out.push({
      id: spec.ref,
      name,
      kind: spec.kind,
      x: r1(c[0]),
      z: r1(c[1]),
      y: r1(y),
      yMin: r1(yMin),
      yaw: Math.round(yaw * 1000) / 1000,
      w: r1(w),
      d: r1(d),
      h: r1(h),
      rings: ringsModel.map((r) => r.flatMap(([x, z]) => [r1(x), r1(z)])),
      p,
      reach,
    });
    shapes.push({ rings, name, osm: spec.osm, x: c[0], z: c[1], small: spec.kind === 'statua' || spec.kind === 'caduti' || !rings.length });
  }

  // gli edifici generici dentro l'impronta di un monumento (non le statue: stanno in piazza)
  for (const b of buildings) {
    const key = bKey(b);
    if (skipKeys.has(key)) continue;
    const o = b.outer[0];
    let lon = 0;
    let lat = 0;
    for (const q of o) {
      lon += q[0];
      lat += q[1];
    }
    const [x, z] = toLocal(lat / o.length, lon / o.length);
    for (const s of shapes) {
      if (s.small || Math.abs(x - s.x) > 160 || Math.abs(z - s.z) > 160) continue;
      if (s.rings.some((r) => inside(r, x, z))) {
        skipKeys.add(key);
        break;
      }
    }
  }

  const norm = (n: string) => n.toLowerCase().replace(/[’`]/g, "'").trim();
  const names = new Map(shapes.flatMap((s) => [[norm(s.osm), s] as const, [norm(s.name), s] as const]));
  const file: MonumentiFile = { v: 1, source: 'OpenStreetMap (Geofabrik nord-ovest) · EU-DEM', monumenti: out };
  writeFileSync(join(ctx.outDir, 'monumenti.json'), JSON.stringify(file));
  log(`monumenti: ${out.length} (${[...new Set(out.map((m) => m.kind))].map((k) => `${k} ${out.filter((m) => m.kind === k).length}`).join(', ')}), ${skipKeys.size} edifici generici tolti`);
  return {
    file,
    skip: (a) => skipKeys.has(bKey(a)),
    hides: (x, z, name) => {
      if (name) {
        const s = names.get(norm(name));
        if (s && Math.hypot(s.x - x, s.z - z) < 150) return true;
      }
      for (const s of shapes) {
        if (Math.abs(x - s.x) > 200 || Math.abs(z - s.z) > 200) continue;
        if (s.small) {
          if (Math.hypot(s.x - x, s.z - z) < 5) return true;
          continue;
        }
        if (s.rings.some((r) => inside(r, x, z))) return true;
      }
      return false;
    },
  };
}
