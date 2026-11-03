import { unzlibSync } from 'fflate';
import { projector, type LatLon } from '@/domain/geo';
import { WorldGraph, type WorldGraphFile } from './graph';

/**
 * I dati del mondo aperto, come li scrive scripts/world/build-world.ts in public/world/<id>/:
 *
 * - graph.json     strade (incroci e tratti), con pianta e quota livellata
 * - rides.json     i percorsi scelti, con i luoghi da riconoscere lungo la strada
 * - features.json  fiumi, laghi, cime, paesi, mura, ferrovie, funivie
 * - dem/x_z.bin    terreno a 25 m in mattonelle da 2 km (quota in dm + uso del suolo)
 * - b/x_z.json     edifici della mattonella
 * - far.bin        terreno lontano a 250 m, oltre i bordi del mondo pedalabile
 *
 * Tutto si scarica una volta: il service worker lo tiene per l'uso senza rete.
 */

export const WORLD_ID = 'bergamo';

export function worldBase(id = WORLD_ID): string {
  const base = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/';
  return `${base}world/${id}/`;
}

/** Uso del suolo nella griglia del terreno. */
export const COVER = {
  open: 0,
  forest: 1,
  residential: 2,
  industrial: 3,
  park: 4,
  rock: 5,
  water: 6,
  farmland: 7,
  glacier: 8,
} as const;

export type LandmarkKind = 'citta' | 'paese' | 'chiesa' | 'torre' | 'porta' | 'mura' | 'ponte' | 'fiume' | 'cima' | 'passo' | 'lago' | 'castello' | 'luogo' | 'funivia' | 'stazione' | 'santuario';

export interface Landmark {
  id: string;
  name: string;
  kind: LandmarkKind;
  x: number;
  z: number;
  y: number;
  /** una riga: perché lo si riconosce */
  note: string;
}

export interface RideLandmark {
  id: string;
  /** distanza sul percorso del punto più vicino */
  at: number;
  /** distanza in pianta dal percorso, metri */
  off: number;
}

export type RideKind = 'salita' | 'giro' | 'valle' | 'citta';

export interface RideDef {
  id: string;
  name: string;
  /** da dove a dove, una riga */
  side: string;
  area: 'citta' | 'brembana' | 'seriana' | 'valli';
  kind: RideKind;
  blurb: string;
  legs: [number, -1 | 1][];
  lengthM: number;
  gainM: number;
  startAlt: number;
  endAlt: number;
  maxAlt: number;
  /** pendenza media del tratto in salita più lungo, frazione */
  climbGrade: number;
  /** pendenza massima su 200 m */
  maxGrade: number;
  landmarks: RideLandmark[];
  /** tratto cronometrato in classifica: da/a metri sul percorso */
  timed: [number, number];
}

export interface RiverLine {
  name: string;
  kind: 'river' | 'canal' | 'stream';
  /** semilarghezza, metri */
  hw: number;
  /** x, z, livello dell'acqua: metri, piatto */
  pts: Float32Array;
}

export interface Peak {
  name: string;
  x: number;
  z: number;
  ele: number;
  pass: boolean;
}

export interface Place {
  name: string;
  kind: 'city' | 'town' | 'village' | 'hamlet' | 'suburb' | 'quarter';
  x: number;
  z: number;
  y: number;
}

export interface Polyline {
  kind: string;
  name?: string;
  /** x, z, y piatto */
  pts: Float32Array;
}

export interface Lake {
  name: string;
  level: number;
  /** anello x, z piatto */
  ring: Float32Array;
}

export interface WorldFeatures {
  rivers: RiverLine[];
  lakes: Lake[];
  peaks: Peak[];
  places: Place[];
  walls: Polyline[];
  rails: Polyline[];
  cables: Polyline[];
  landmarks: Landmark[];
}

export interface WorldData {
  graph: WorldGraph;
  rides: RideDef[];
  features: WorldFeatures;
  proj: ReturnType<typeof projector>;
  toGeo(x: number, z: number): LatLon;
}

interface FeaturesFile {
  rivers: { n: string; k: RiverLine['kind']; hw: number; p: number[] }[];
  lakes: { n: string; y: number; r: number[] }[];
  peaks: [string, number, number, number, number][];
  places: [string, string, number, number, number][];
  walls: { k: string; n?: string; p: number[] }[];
  rails: { k: string; n?: string; p: number[] }[];
  cables: { k: string; n?: string; p: number[] }[];
  landmarks: Landmark[];
}

/** decimetri delta → metri */
function undelta(arr: number[], dims: number): Float32Array {
  const out = new Float32Array(arr.length);
  const acc = new Array<number>(dims).fill(0);
  for (let i = 0; i < arr.length; i++) {
    const k = i % dims;
    acc[k] += arr[i];
    out[i] = acc[k] / 10;
  }
  return out;
}

export function decodeFeatures(f: FeaturesFile): WorldFeatures {
  return {
    rivers: f.rivers.map((r) => ({ name: r.n, kind: r.k, hw: r.hw, pts: undelta(r.p, 3) })),
    lakes: f.lakes.map((l) => ({ name: l.n, level: l.y, ring: undelta(l.r, 2) })),
    peaks: f.peaks.map(([name, x, z, ele, pass]) => ({ name, x, z, ele, pass: pass === 1 })),
    places: f.places.map(([name, kind, x, z, y]) => ({ name, kind: kind as Place['kind'], x, z, y })),
    walls: f.walls.map((w) => ({ kind: w.k, name: w.n, pts: undelta(w.p, 3) })),
    rails: f.rails.map((w) => ({ kind: w.k, name: w.n, pts: undelta(w.p, 3) })),
    cables: f.cables.map((w) => ({ kind: w.k, name: w.n, pts: undelta(w.p, 3) })),
    landmarks: f.landmarks,
  };
}

let cached: Promise<WorldData> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export function loadWorld(id = WORLD_ID): Promise<WorldData> {
  if (!cached) {
    const base = worldBase(id);
    cached = Promise.all([getJson<WorldGraphFile>(`${base}graph.json`), getJson<RideDef[]>(`${base}rides.json`), getJson<FeaturesFile>(`${base}features.json`)]).then(
      ([g, rides, f]) => {
        const graph = new WorldGraph(g);
        const proj = projector(graph.origin);
        return { graph, rides, features: decodeFeatures(f), proj, toGeo: (x: number, z: number) => proj.toGeo(x, z) };
      },
    );
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

// ---------- terreno a mattonelle ----------

export interface DemTile {
  tx: number;
  tz: number;
  /** quote in metri, (n+1)² campioni, righe verso sud */
  h: Float32Array;
  cover: Uint8Array;
  n: number;
}

/** Decodifica una mattonella: zlib di [Int16 dm in delta per riga][Uint8 uso del suolo]. */
export function decodeDemTile(buf: Uint8Array, n: number, tx: number, tz: number): DemTile {
  const raw = unzlibSync(buf);
  const side = n + 1;
  const count = side * side;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const h = new Float32Array(count);
  let rowStart = 0;
  for (let j = 0; j < side; j++) {
    let v = 0;
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      const d = view.getInt16(k * 2, true);
      if (i === 0) {
        rowStart += d;
        v = rowStart;
      } else v += d;
      h[k] = v / 10;
    }
  }
  const cover = raw.slice(count * 2, count * 3);
  return { tx, tz, h, cover, n };
}

export function decodeFar(buf: Uint8Array, nx: number, nz: number): Float32Array {
  const raw = unzlibSync(buf);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const h = new Float32Array(nx * nz);
  let rowStart = 0;
  for (let j = 0; j < nz; j++) {
    let v = 0;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const d = view.getInt16(k * 2, true);
      if (i === 0) {
        rowStart += d;
        v = rowStart;
      } else v += d;
      h[k] = v;
    }
  }
  return h;
}

/**
 * Le mattonelle del terreno, caricate a richiesta. `height` risponde subito con quello che
 * c'è: dove la mattonella fine non è ancora arrivata usa il terreno lontano a 250 m.
 */
export class Terrain {
  private tiles = new Map<string, DemTile>();
  private pending = new Map<string, Promise<DemTile | null>>();
  private farH: Float32Array | null = null;
  readonly n: number;

  constructor(
    readonly graph: WorldGraph,
    private readonly base = worldBase(graph.id),
  ) {
    this.n = Math.round(graph.tile / graph.demStep);
  }

  tileOf(x: number, z: number): [number, number] {
    const b = this.graph.bounds;
    return [Math.floor((x - b.x0) / this.graph.tile), Math.floor((z - b.z0) / this.graph.tile)];
  }

  inBounds(tx: number, tz: number): boolean {
    const b = this.graph.bounds;
    const T = this.graph.tile;
    return tx >= 0 && tz >= 0 && b.x0 + tx * T < b.x1 && b.z0 + tz * T < b.z1;
  }

  has(tx: number, tz: number): boolean {
    return this.tiles.has(`${tx}_${tz}`);
  }

  get(tx: number, tz: number): DemTile | undefined {
    return this.tiles.get(`${tx}_${tz}`);
  }

  load(tx: number, tz: number): Promise<DemTile | null> {
    const key = `${tx}_${tz}`;
    const have = this.tiles.get(key);
    if (have) return Promise.resolve(have);
    if (!this.inBounds(tx, tz)) return Promise.resolve(null);
    let p = this.pending.get(key);
    if (!p) {
      p = fetch(`${this.base}dem/${key}.bin`)
        .then(async (res) => {
          if (!res.ok) return null;
          const tile = decodeDemTile(new Uint8Array(await res.arrayBuffer()), this.n, tx, tz);
          this.tiles.set(key, tile);
          return tile;
        })
        .catch(() => null)
        .finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  /** Carica le mattonelle entro `radius` metri da (x, z). */
  async around(x: number, z: number, radius: number): Promise<void> {
    const [a0, b0] = this.tileOf(x - radius, z - radius);
    const [a1, b1] = this.tileOf(x + radius, z + radius);
    const jobs: Promise<unknown>[] = [];
    for (let tx = a0; tx <= a1; tx++) for (let tz = b0; tz <= b1; tz++) jobs.push(this.load(tx, tz));
    await Promise.all(jobs);
  }

  /** Lascia andare le mattonelle lontane: il telefono non deve tenere in memoria tutta la provincia. */
  prune(x: number, z: number, keepRadius: number): void {
    for (const [key, t] of this.tiles) {
      const cx = this.graph.bounds.x0 + (t.tx + 0.5) * this.graph.tile;
      const cz = this.graph.bounds.z0 + (t.tz + 0.5) * this.graph.tile;
      if (Math.abs(cx - x) > keepRadius + this.graph.tile || Math.abs(cz - z) > keepRadius + this.graph.tile) this.tiles.delete(key);
    }
  }

  async loadFar(): Promise<Float32Array | null> {
    if (this.farH) return this.farH;
    const f = this.graph.far;
    try {
      const res = await fetch(`${this.base}far.bin`);
      if (!res.ok) return null;
      this.farH = decodeFar(new Uint8Array(await res.arrayBuffer()), f.nx, f.nz);
      return this.farH;
    } catch {
      return null;
    }
  }

  get farHeights(): Float32Array | null {
    return this.farH;
  }

  /** Quota del terreno lontano (250 m), bilineare. */
  farHeight(x: number, z: number): number {
    const f = this.graph.far;
    const h = this.farH;
    if (!h) return 0;
    const fx = Math.min(f.nx - 1.001, Math.max(0, (x - f.x0) / f.step));
    const fz = Math.min(f.nz - 1.001, Math.max(0, (z - f.z0) / f.step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * f.nx + i;
    return h[k] * (1 - u) * (1 - v) + h[k + 1] * u * (1 - v) + h[k + f.nx] * (1 - u) * v + h[k + f.nx + 1] * u * v;
  }

  /** Quota DEM a 25 m, bilineare; se la mattonella non c'è ancora, quella lontana. */
  height(x: number, z: number): number {
    const b = this.graph.bounds;
    const T = this.graph.tile;
    const step = this.graph.demStep;
    const tx = Math.floor((x - b.x0) / T);
    const tz = Math.floor((z - b.z0) / T);
    const tile = this.tiles.get(`${tx}_${tz}`);
    if (!tile) return this.farHeight(x, z);
    const n = tile.n;
    const fx = Math.min(n - 0.0001, Math.max(0, (x - b.x0 - tx * T) / step));
    const fz = Math.min(n - 0.0001, Math.max(0, (z - b.z0 - tz * T) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const side = n + 1;
    const k = j * side + i;
    const h = tile.h;
    return h[k] * (1 - u) * (1 - v) + h[k + 1] * u * (1 - v) + h[k + side] * (1 - u) * v + h[k + side + 1] * u * v;
  }

  /** Uso del suolo della cella più vicina (COVER.open se la mattonella non c'è). */
  cover(x: number, z: number): number {
    const b = this.graph.bounds;
    const T = this.graph.tile;
    const step = this.graph.demStep;
    const tx = Math.floor((x - b.x0) / T);
    const tz = Math.floor((z - b.z0) / T);
    const tile = this.tiles.get(`${tx}_${tz}`);
    if (!tile) return COVER.open;
    const i = Math.min(tile.n, Math.max(0, Math.round((x - b.x0 - tx * T) / step)));
    const j = Math.min(tile.n, Math.max(0, Math.round((z - b.z0 - tz * T) / step)));
    return tile.cover[j * (tile.n + 1) + i];
  }
}

// ---------- edifici ----------

export interface Building {
  kind: number;
  /** altezza del tetto sopra il suolo, metri */
  h: number;
  /** quota minima dal suolo (portici, piani sospesi), metri */
  minH: number;
  roof: number;
  /** anello x, z in metri assoluti */
  ring: Float32Array;
}

export const BUILDING_KIND = {
  house: 0,
  apartments: 1,
  industrial: 2,
  church: 3,
  tower: 4,
  civic: 5,
  castle: 6,
} as const;

export async function loadBuildings(graph: WorldGraph, tx: number, tz: number, base = worldBase(graph.id)): Promise<Building[]> {
  try {
    const res = await fetch(`${base}b/${tx}_${tz}.json`);
    if (!res.ok) return [];
    const json = (await res.json()) as { o: [number, number]; b: number[][] };
    const [ox, oz] = json.o;
    return json.b.map((r) => {
      const [kind, h, minH, roof, ...coords] = r;
      const ring = new Float32Array(coords.length);
      let x = 0;
      let z = 0;
      for (let i = 0; i < coords.length; i += 2) {
        x += coords[i];
        z += coords[i + 1];
        ring[i] = ox + x / 10;
        ring[i + 1] = oz + z / 10;
      }
      return { kind, h: h / 10, minH: minH / 10, roof, ring };
    });
  } catch {
    return [];
  }
}
