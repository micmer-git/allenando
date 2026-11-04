/**
 * Il grafo delle strade del mondo aperto: incroci (nodi) e tratti di strada fra due incroci
 * (archi), con la pianta nodo per nodo e la quota livellata. Lo scrive
 * scripts/world/build-world.ts da OpenStreetMap ed EU-DEM; qui si legge e si interroga:
 * dove sono, che strade escono dall'incrocio, qual è la più dritta, come arrivo là.
 *
 * Coordinate come nel resto dell'app (geo.ts): metri locali, x verso est, z verso SUD,
 * y = quota vera in metri (il mondo aperto non ha altitudeBase). Per una direzione h,
 * avanti è (sin h, cos h) su (x, z) e un angolo che cresce gira a SINISTRA.
 */

import { wrap } from '@/domain/geo';

/** Classi di strada, dalla più importante. */
export const CLS = {
  trunk: 0,
  primary: 1,
  secondary: 2,
  tertiary: 3,
  unclassified: 4,
  residential: 5,
  pedestrian: 6,
  cycleway: 7,
} as const;
export type RoadClass = (typeof CLS)[keyof typeof CLS];

export const CLASS_LABEL: Record<RoadClass, string> = {
  0: 'strada statale a scorrimento',
  1: 'strada statale',
  2: 'strada provinciale',
  3: 'strada comunale',
  4: 'strada di montagna',
  5: 'via di quartiere',
  6: 'zona pedonale',
  7: 'ciclabile',
};

export const FLAG = {
  bridge: 1,
  tunnel: 2,
  /** si percorre solo da a verso b */
  oneway: 4,
  /** si percorre solo da b verso a */
  onewayRev: 8,
  /** porfido, ciottoli, pavé: la resistenza al rotolamento sale */
  cobbles: 16,
  /** sterrato */
  unpaved: 32,
  /** anello di una rotatoria (junction=roundabout o circular in OSM): ci si gira in senso antiorario */
  roundabout: 64,
} as const;

export type Dir = 1 | -1;

/** Il file `public/world/<id>/graph.json`. Numeri interi in decimetri, delta da un punto all'altro. */
export interface WorldGraphFile {
  v: 1;
  id: string;
  name: string;
  origin: { lat: number; lon: number };
  /** rettangolo pedalabile in metri locali */
  bounds: { x0: number; z0: number; x1: number; z1: number };
  tile: number;
  demStep: number;
  far: { step: number; nx: number; nz: number; x0: number; z0: number };
  builtAt: string;
  attribution: string;
  names: string[];
  /** [x, z, y] in decimetri, piatto */
  nodes: number[];
  /** [a, b, nome, sigla, classe, bandiere, semilarghezza dm, coordinate] — coordinate = [x0,z0,y0, dx,dz,dy, …] in dm */
  edges: [number, number, number, number, number, number, number, number[]][];
}

export interface Edge {
  id: number;
  a: number;
  b: number;
  name: string;
  ref: string;
  cls: RoadClass;
  flags: number;
  /** semilarghezza della carreggiata, metri */
  hw: number;
  xs: Float32Array;
  zs: Float32Array;
  ys: Float32Array;
  /** distanza cumulata dal nodo a, metri */
  cum: Float32Array;
  length: number;
}

export interface EdgePose {
  x: number;
  y: number;
  z: number;
  /** direzione di marcia nel verso dir */
  heading: number;
  /** pendenza nel verso di marcia, frazione */
  grade: number;
}

export interface Hit {
  edge: number;
  /** distanza lungo l'arco dal nodo a */
  s: number;
  /** distanza in pianta dalla mezzeria */
  d: number;
}

export interface TurnOption {
  edge: number;
  dir: Dir;
  /** gradi, positivo = sinistra */
  turn: number;
  uTurn: boolean;
  label: string;
  /** in una rotatoria: il numero dell'uscita, 1 = la prima dopo l'ingresso */
  exit?: number;
  roundabout?: true;
  /** in una rotatoria: gli archi dell'anello da percorrere prima di uscire su `edge` */
  via?: Leg[];
}

/** Un'uscita di rotatoria: dove si esce (edge, dir) e il pezzo d'anello per arrivarci. */
export interface RoundaboutExit extends TurnOption {
  exit: number;
  roundabout: true;
  via: Leg[];
}

export interface Leg {
  edge: number;
  dir: Dir;
}

const CELL = 100;

export class WorldGraph {
  readonly id: string;
  readonly name: string;
  readonly origin: { lat: number; lon: number };
  readonly bounds: WorldGraphFile['bounds'];
  readonly tile: number;
  readonly demStep: number;
  readonly far: WorldGraphFile['far'];
  readonly attribution: string;
  readonly builtAt: string;
  readonly nodeX: Float64Array;
  readonly nodeZ: Float64Array;
  readonly nodeY: Float64Array;
  readonly edges: Edge[];
  /** archi che toccano il nodo n: adjEdges[adjStart[n] .. adjStart[n+1]) */
  readonly adjStart: Int32Array;
  readonly adjEdges: Int32Array;
  private readonly grid = new Map<number, number[]>();

  constructor(file: WorldGraphFile) {
    this.id = file.id;
    this.name = file.name;
    this.origin = file.origin;
    this.bounds = file.bounds;
    this.tile = file.tile;
    this.demStep = file.demStep;
    this.far = file.far;
    this.attribution = file.attribution;
    this.builtAt = file.builtAt;
    const n = file.nodes.length / 3;
    this.nodeX = new Float64Array(n);
    this.nodeZ = new Float64Array(n);
    this.nodeY = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.nodeX[i] = file.nodes[i * 3] / 10;
      this.nodeZ[i] = file.nodes[i * 3 + 1] / 10;
      this.nodeY[i] = file.nodes[i * 3 + 2] / 10;
    }
    const degree = new Int32Array(n + 1);
    this.edges = file.edges.map(([a, b, name, ref, cls, flags, hw, coords], id) => {
      const m = coords.length / 3;
      const xs = new Float32Array(m);
      const zs = new Float32Array(m);
      const ys = new Float32Array(m);
      const cum = new Float32Array(m);
      let x = 0;
      let z = 0;
      let y = 0;
      for (let k = 0; k < m; k++) {
        x += coords[k * 3];
        z += coords[k * 3 + 1];
        y += coords[k * 3 + 2];
        xs[k] = x / 10;
        zs[k] = z / 10;
        ys[k] = y / 10;
        if (k > 0) cum[k] = cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]);
      }
      degree[a]++;
      if (b !== a) degree[b]++;
      return { id, a, b, name: file.names[name] ?? '', ref: file.names[ref] ?? '', cls: cls as RoadClass, flags, hw: hw / 10, xs, zs, ys, cum, length: cum[m - 1] };
    });
    this.adjStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.adjStart[i + 1] = this.adjStart[i] + degree[i];
    this.adjEdges = new Int32Array(this.adjStart[n]);
    const fill = this.adjStart.slice(0, n);
    for (const e of this.edges) {
      this.adjEdges[fill[e.a]++] = e.id;
      if (e.b !== e.a) this.adjEdges[fill[e.b]++] = e.id;
    }
    for (const e of this.edges) {
      for (let k = 0; k < e.xs.length - 1; k++) {
        const cx0 = Math.floor(Math.min(e.xs[k], e.xs[k + 1]) / CELL);
        const cx1 = Math.floor(Math.max(e.xs[k], e.xs[k + 1]) / CELL);
        const cz0 = Math.floor(Math.min(e.zs[k], e.zs[k + 1]) / CELL);
        const cz1 = Math.floor(Math.max(e.zs[k], e.zs[k + 1]) / CELL);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cz = cz0; cz <= cz1; cz++) {
            const key = cellKey(cx, cz);
            const bucket = this.grid.get(key);
            // arco e segmento in un numero solo: gli archi sono meno di 2^20, i segmenti meno di 2^11 per arco
            const code = e.id * 4096 + k;
            if (bucket) bucket.push(code);
            else this.grid.set(key, [code]);
          }
        }
      }
    }
  }

  get nodeCount(): number {
    return this.nodeX.length;
  }

  edgesAt(node: number): number[] {
    const out: number[] = [];
    for (let i = this.adjStart[node]; i < this.adjStart[node + 1]; i++) out.push(this.adjEdges[i]);
    return out;
  }

  startNode(edge: number, dir: Dir): number {
    const e = this.edges[edge];
    return dir > 0 ? e.a : e.b;
  }

  endNode(edge: number, dir: Dir): number {
    const e = this.edges[edge];
    return dir > 0 ? e.b : e.a;
  }

  allowed(edge: number, dir: Dir): boolean {
    const f = this.edges[edge].flags;
    if (dir > 0 && f & FLAG.onewayRev) return false;
    if (dir < 0 && f & FLAG.oneway) return false;
    return true;
  }

  /** Punto sull'arco a distanza s da a, con la direzione e la pendenza nel verso dir. */
  pose(edge: number, s: number, dir: Dir = 1): EdgePose {
    const e = this.edges[edge];
    const L = e.length;
    const t = Math.min(L, Math.max(0, s));
    const k = segmentAt(e.cum, t);
    const span = e.cum[k + 1] - e.cum[k] || 1;
    const u = (t - e.cum[k]) / span;
    const x = e.xs[k] + (e.xs[k + 1] - e.xs[k]) * u;
    const z = e.zs[k] + (e.zs[k + 1] - e.zs[k]) * u;
    const y = e.ys[k] + (e.ys[k + 1] - e.ys[k]) * u;
    // direzione e pendenza su ±6 m, così non scattano a ogni nodo della pianta
    const a = this.xyzAt(e, Math.max(0, t - 6));
    const b = this.xyzAt(e, Math.min(L, t + 6));
    let heading = Math.atan2(b.x - a.x, b.z - a.z);
    const run = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    let grade = (b.y - a.y) / run;
    if (dir < 0) {
      heading = wrap(heading + Math.PI);
      grade = -grade;
    }
    return { x, y, z, heading, grade };
  }

  private xyzAt(e: Edge, s: number): { x: number; y: number; z: number } {
    const k = segmentAt(e.cum, s);
    const span = e.cum[k + 1] - e.cum[k] || 1;
    const u = (s - e.cum[k]) / span;
    return { x: e.xs[k] + (e.xs[k + 1] - e.xs[k]) * u, y: e.ys[k] + (e.ys[k + 1] - e.ys[k]) * u, z: e.zs[k] + (e.zs[k + 1] - e.zs[k]) * u };
  }

  /** Direzione con cui si entra nell'arco (primi 15 m nel verso dir). */
  entryHeading(edge: number, dir: Dir): number {
    const e = this.edges[edge];
    const L = e.length;
    const s0 = dir > 0 ? 0 : L;
    const s1 = dir > 0 ? Math.min(L, 15) : Math.max(0, L - 15);
    const a = this.xyzAt(e, s0);
    const b = this.xyzAt(e, s1);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** Direzione con cui si esce dall'arco (ultimi 15 m nel verso dir). */
  exitHeading(edge: number, dir: Dir): number {
    const e = this.edges[edge];
    const L = e.length;
    const s0 = dir > 0 ? Math.max(0, L - 15) : Math.min(L, 15);
    const s1 = dir > 0 ? L : 0;
    const a = this.xyzAt(e, s0);
    const b = this.xyzAt(e, s1);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** Il punto di strada più vicino entro `maxD` metri, oppure null. */
  nearest(x: number, z: number, maxD = 150, accept?: (e: Edge) => boolean): Hit | null {
    const r = Math.ceil(maxD / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best: Hit | null = null;
    let bestD = maxD * maxD;
    const seen = new Set<number>();
    for (let oz = -r; oz <= r; oz++) {
      for (let ox = -r; ox <= r; ox++) {
        const bucket = this.grid.get(cellKey(cx + ox, cz + oz));
        if (!bucket) continue;
        for (const code of bucket) {
          if (seen.has(code)) continue;
          seen.add(code);
          const id = Math.floor(code / 4096);
          const k = code % 4096;
          const e = this.edges[id];
          if (accept && !accept(e)) continue;
          const ax = e.xs[k];
          const az = e.zs[k];
          const dx = e.xs[k + 1] - ax;
          const dz = e.zs[k + 1] - az;
          const len2 = dx * dx + dz * dz || 1;
          const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
          const px = ax + dx * u;
          const pz = az + dz * u;
          const d2 = (x - px) ** 2 + (z - pz) ** 2;
          if (d2 < bestD) {
            bestD = d2;
            best = { edge: id, s: e.cum[k] + Math.sqrt(len2) * u, d: 0 };
          }
        }
      }
    }
    if (best) best.d = Math.sqrt(bestD);
    return best;
  }

  /**
   * Quanto (x, z) sta dentro l'asfalto disegnato: metri dal bordo della carreggiata più vicina,
   * positivi dentro, negativi fuori. Contano solo le strade a ±2,5 m dalla quota y, così un ponte
   * sopra la testa non vale come asfalto sotto le ruote. −Infinity se non c'è strada entro `reach`.
   * `except`: un arco da non contare (per sapere se il marciapiede di una strada cade su un'altra).
   */
  asphaltMargin(x: number, z: number, y: number, reach = 12, except = -1): number {
    // solo le celle che il quadrato ±reach tocca davvero: di solito una
    const cx0 = Math.floor((x - reach) / CELL);
    const cx1 = Math.floor((x + reach) / CELL);
    const cz0 = Math.floor((z - reach) / CELL);
    const cz1 = Math.floor((z + reach) / CELL);
    let best = -Infinity;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.grid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const code of bucket) {
          if (Math.floor(code / 4096) === except) continue;
          const e = this.edges[Math.floor(code / 4096)];
          const k = code % 4096;
          const ax = e.xs[k];
          const az = e.zs[k];
          const dx = e.xs[k + 1] - ax;
          const dz = e.zs[k + 1] - az;
          const len2 = dx * dx + dz * dz || 1;
          const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
          if (Math.abs(e.ys[k] + (e.ys[k + 1] - e.ys[k]) * u - y) > 2.5) continue;
          const m = e.hw - Math.hypot(x - ax - dx * u, z - az - dz * u);
          if (m > best) best = m;
        }
      }
    }
    return best;
  }

  /** Gli archi con almeno un segmento nelle celle entro r metri da (x, z). */
  edgesNear(x: number, z: number, r: number): Set<number> {
    const out = new Set<number>();
    const c = Math.ceil(r / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let oz = -c; oz <= c; oz++) {
      for (let ox = -c; ox <= c; ox++) {
        const bucket = this.grid.get(cellKey(cx + ox, cz + oz));
        if (bucket) for (const code of bucket) out.add(Math.floor(code / 4096));
      }
    }
    return out;
  }

  /** Il nodo più vicino (fra quelli toccati da archi ammessi) entro maxD metri. */
  nearestNode(x: number, z: number, maxD = 400, accept?: (e: Edge) => boolean): number | null {
    const hit = this.nearest(x, z, maxD, accept);
    if (!hit) return null;
    const e = this.edges[hit.edge];
    const da = Math.hypot(this.nodeX[e.a] - x, this.nodeZ[e.a] - z);
    const db = Math.hypot(this.nodeX[e.b] - x, this.nodeZ[e.b] - z);
    return da <= db ? e.a : e.b;
  }

  /**
   * Le strade che si possono prendere arrivando in fondo all'arco `edge` nel verso `dir`,
   * da sinistra a destra. L'inversione c'è solo nei vicoli ciechi o se `withUTurn`.
   */
  options(edge: number, dir: Dir, withUTurn = false): TurnOption[] {
    const node = this.endNode(edge, dir);
    const inH = this.exitHeading(edge, dir);
    const out: TurnOption[] = [];
    for (const id of this.edgesAt(node)) {
      const e = this.edges[id];
      for (const d of [1, -1] as Dir[]) {
        if (this.startNode(id, d) !== node) continue;
        if (!this.allowed(id, d)) continue;
        const uTurn = id === edge && d === -dir;
        const turn = (wrap(this.entryHeading(id, d) - inH) * 180) / Math.PI;
        out.push({ edge: id, dir: d, turn, uTurn, label: e.name || e.ref || CLASS_LABEL[e.cls] });
      }
    }
    const real = out.filter((o) => !o.uTurn);
    if (real.length > 0 && !withUTurn) return real.sort((p, q) => q.turn - p.turn);
    if (!out.some((o) => o.uTurn) && !this.allowed(edge, (-dir) as Dir)) {
      // vicolo cieco su un senso unico: si torna indietro lo stesso, a piedi accanto alla bici
      out.push({ edge, dir: (-dir) as Dir, turn: 180, uTurn: true, label: 'inversione' });
    }
    return out.sort((p, q) => q.turn - p.turn);
  }

  /** È un arco dell'anello di una rotatoria. */
  isRing(edge: number): boolean {
    return (this.edges[edge].flags & FLAG.roundabout) !== 0;
  }

  /**
   * Arrivando in fondo a (edge, dir): se lì comincia (o continua) l'anello di una rotatoria, le
   * uscite in ordine, ognuna col pezzo d'anello da fare. Null se non c'è una rotatoria.
   *
   * Da fuori si entra nel nodo d'ingresso e le uscite si contano dal nodo dopo; l'ultima, se la
   * strada d'ingresso è a doppio senso, è tornare indietro (il giro completo). Se si è già
   * sull'anello, le uscite del nodo in cui si arriva valgono subito.
   */
  roundaboutExits(edge: number, dir: Dir): RoundaboutExit[] | null {
    const start = this.endNode(edge, dir);
    const onRing = this.isRing(edge);
    const inH = this.exitHeading(edge, dir);
    const ringOut = (v: number): Leg | null => {
      for (const id of this.edgesAt(v)) {
        if (!this.isRing(id)) continue;
        for (const d of [1, -1] as Dir[]) if (this.startNode(id, d) === v && this.allowed(id, d) && !(id === edge && d === -dir)) return { edge: id, dir: d };
      }
      return null;
    };
    if (!ringOut(start)) return null;
    const out: RoundaboutExit[] = [];
    const via: Leg[] = [];
    let v = start;
    const seen = new Set<number>();
    for (let step = 0; step < 64; step++) {
      if (step > 0 || onRing) {
        for (const id of this.edgesAt(v)) {
          if (this.isRing(id)) continue;
          for (const d of [1, -1] as Dir[]) {
            if (this.startNode(id, d) !== v || !this.allowed(id, d)) continue;
            const e = this.edges[id];
            const turn = (wrap(this.entryHeading(id, d) - inH) * 180) / Math.PI;
            const uTurn = id === edge && d === -dir;
            out.push({ edge: id, dir: d, turn, uTurn, label: e.name || e.ref || CLASS_LABEL[e.cls], exit: out.length + 1, roundabout: true, via: via.slice() });
          }
        }
      }
      if (step > 0 && v === start) break;
      if (seen.has(v)) break;
      seen.add(v);
      const next = ringOut(v);
      if (!next) break;
      via.push(next);
      v = this.endNode(next.edge, next.dir);
    }
    return out.length ? out : null;
  }

  /** Fra le uscite di una rotatoria, quella che va più dritta (come straightest). */
  straightestExit(edge: number, exits: RoundaboutExit[]): RoundaboutExit {
    return pickStraight(this, edge, exits);
  }

  /** La strada più dritta all'incrocio: a parità, quella con lo stesso nome o la stessa classe. */
  straightest(edge: number, dir: Dir): TurnOption {
    return pickStraight(this, edge, this.options(edge, dir));
  }

  /** Costo di un arco per il navigatore: metri, pesati per quanto la strada è adatta a una bici. */
  edgeCost(edge: number, prefs: RoutePrefs = {}): number {
    const e = this.edges[edge];
    let k = CLASS_COST[e.cls];
    // sulle piste si va se si vuole: in salita il ciclista sta sulla strada
    if (e.cls === CLS.cycleway) k = prefs.preferCycleways ? 0.55 : 1.3;
    if (prefs.avoidPedestrian === false && e.cls === CLS.pedestrian) k = 1.2;
    if (e.flags & FLAG.unpaved) k *= 1.6;
    return e.length * k;
  }

  /**
   * Il percorso più conveniente fra due nodi (A*). `penalty` moltiplica il costo degli archi
   * già usati: serve agli anelli per non tornare sulla stessa strada.
   */
  route(from: number, to: number, prefs: RoutePrefs = {}, penalty?: Map<number, number>): Leg[] | null {
    if (from === to) return [];
    const n = this.nodeCount;
    const g = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const prevDir = new Int8Array(n);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const tx = this.nodeX[to];
    const tz = this.nodeZ[to];
    const h = (v: number) => Math.hypot(this.nodeX[v] - tx, this.nodeZ[v] - tz) * MIN_COST;
    g[from] = 0;
    heap.push(from, h(from));
    while (heap.size > 0) {
      const v = heap.pop();
      if (closed[v]) continue;
      if (v === to) break;
      closed[v] = 1;
      for (let i = this.adjStart[v]; i < this.adjStart[v + 1]; i++) {
        const id = this.adjEdges[i];
        const e = this.edges[id];
        for (const d of [1, -1] as Dir[]) {
          if ((d > 0 ? e.a : e.b) !== v) continue;
          if (!this.allowed(id, d)) continue;
          const w = d > 0 ? e.b : e.a;
          if (closed[w]) continue;
          const c = g[v] + this.edgeCost(id, prefs) * (penalty?.get(id) ?? 1);
          if (c < g[w]) {
            g[w] = c;
            prevEdge[w] = id;
            prevDir[w] = d;
            heap.push(w, c + h(w));
          }
        }
      }
    }
    if (!Number.isFinite(g[to])) return null;
    const legs: Leg[] = [];
    let v = to;
    while (v !== from) {
      const id = prevEdge[v];
      const d = prevDir[v] as Dir;
      legs.push({ edge: id, dir: d });
      v = d > 0 ? this.edges[id].a : this.edges[id].b;
    }
    return legs.reverse();
  }

  /** Costo di rete da un nodo a tutti gli altri entro `limit` (Dijkstra), con i predecessori. */
  reach(from: number, limit: number, prefs: RoutePrefs = {}): { cost: Float64Array; dist: Float64Array } {
    const n = this.nodeCount;
    const cost = new Float64Array(n).fill(Infinity);
    const dist = new Float64Array(n).fill(Infinity);
    const heap = new MinHeap();
    cost[from] = 0;
    dist[from] = 0;
    heap.push(from, 0);
    const closed = new Uint8Array(n);
    while (heap.size > 0) {
      const v = heap.pop();
      if (closed[v]) continue;
      closed[v] = 1;
      if (cost[v] > limit) break;
      for (let i = this.adjStart[v]; i < this.adjStart[v + 1]; i++) {
        const id = this.adjEdges[i];
        const e = this.edges[id];
        for (const d of [1, -1] as Dir[]) {
          if ((d > 0 ? e.a : e.b) !== v || !this.allowed(id, d)) continue;
          const w = d > 0 ? e.b : e.a;
          const c = cost[v] + this.edgeCost(id, prefs);
          if (c < cost[w]) {
            cost[w] = c;
            dist[w] = dist[v] + e.length;
            heap.push(w, c);
          }
        }
      }
    }
    return { cost, dist };
  }

  legsLength(legs: Leg[]): number {
    let s = 0;
    for (const l of legs) s += this.edges[l.edge].length;
    return s;
  }

  /** Dislivello positivo di una sequenza di archi, metri. */
  legsGain(legs: Leg[]): number {
    let gain = 0;
    for (const l of legs) {
      const e = this.edges[l.edge];
      const m = e.ys.length;
      for (let k = 1; k < m; k++) {
        const dy = l.dir > 0 ? e.ys[k] - e.ys[k - 1] : e.ys[m - k - 1] - e.ys[m - k];
        if (dy > 0) gain += dy;
      }
    }
    return gain;
  }
}

function pickStraight<T extends TurnOption>(g: WorldGraph, edge: number, opts: T[]): T {
  const here = g.edges[edge];
  let best = opts[0];
  let bestScore = Infinity;
  for (const o of opts) {
    const e = g.edges[o.edge];
    let score = Math.abs(o.turn);
    if (o.uTurn) score += 1000;
    if (here.name && e.name === here.name) score -= 25;
    else if (here.ref && e.ref === here.ref) score -= 25;
    score += Math.abs(e.cls - here.cls) * 6;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

export interface RoutePrefs {
  preferCycleways?: boolean;
  /** false: le zone pedonali (Città Alta) costano come una strada qualunque */
  avoidPedestrian?: boolean;
}

/** Quanto «costa» un metro di ogni classe: le statali trafficate e le zone pedonali si evitano se si può. */
const CLASS_COST: Record<RoadClass, number> = {
  0: 1.6,
  1: 1.05,
  2: 1,
  3: 1,
  4: 1.15,
  5: 1.2,
  6: 2.2,
  7: 1,
};
const MIN_COST = 0.55;

function cellKey(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}

function segmentAt(cum: Float32Array, s: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Coda con priorità minima, per A* e Dijkstra. */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.vals.length;
  }
  push(v: number, key: number): void {
    const k = this.keys;
    const a = this.vals;
    k.push(key);
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys;
    const a = this.vals;
    const top = a[0];
    const lastK = k.pop() as number;
    const lastV = a.pop() as number;
    if (a.length > 0) {
      k[0] = lastK;
      a[0] = lastV;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
