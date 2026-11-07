import { unzlibSync } from 'fflate';
import { projector, type LatLon } from '@/domain/geo';
import { WorldGraph, type WorldGraphFile } from './graph';

/**
 * I dati del mondo aperto, come li scrive scripts/world/build-world.ts in public/world/<id>/:
 *
 * - graph.json     strade (incroci e tratti), con pianta e quota livellata
 * - rides.json     i percorsi scelti, con i luoghi da riconoscere lungo la strada
 * - features.json  fiumi, laghi, cime, paesi, mura, ferrovie, funivie, e (facoltativi, dal
 *                  03/11/2026) semafori, segnaletica orizzontale e luoghi da passare in bici
 * - dem/x_z.bin    terreno a 25 m in mattonelle da 2 km (quota in dm + uso del suolo)
 * - b/x_z.json     edifici della mattonella
 * - far.bin        terreno lontano a 250 m, oltre i bordi del mondo pedalabile
 *
 * Tutto si scarica una volta: il service worker lo tiene per l'uso senza rete.
 */

/** Il mondo di partenza, quando nessuno ne ha scelto uno. */
export const WORLD_ID = 'bergamo';

export interface WorldInfo {
  id: string;
  /** il nome in testa alla pagina Mondo e nelle schede */
  name: string;
  /** una riga sotto il nome */
  tagline: string;
  /** le zone dei percorsi, nell'ordine della pagina */
  areas: { id: RideArea; label: string }[];
  /** i paesi da cui si parte nel giro libero (nomi dei dati) */
  starts: string[];
  /** il paese di riferimento: il primo nelle liste, la partenza di A → B */
  home: string;
  /** l'arrivo proposto in A → B */
  away: string;
  /** quanto pesa scaricarlo, MB (a mano, dal build) */
  mb: number;
}

/** I mondi dell'app, nell'ordine delle schede. I dati stanno in public/world/<id>/. */
export const WORLDS: readonly WorldInfo[] = [
  {
    id: 'bergamo',
    name: 'Bergamo e le valli',
    tagline: 'Città Alta, Val Seriana e Val Brembana fino ai passi',
    areas: [
      { id: 'citta', label: 'Bergamo città' },
      { id: 'seriana', label: 'Val Seriana' },
      { id: 'brembana', label: 'Val Brembana' },
      { id: 'valli', label: 'Fra le due valli' },
    ],
    starts: ['Bergamo', 'Città Alta', 'Ponteranica', 'Alzano Lombardo', 'Nembro', 'Albino', 'Gazzaniga', 'Ponte Nossa', 'Clusone', 'Castione della Presolana', 'Villa d’Almè', 'Zogno', 'San Pellegrino Terme', 'San Giovanni Bianco', 'Piazza Brembana', 'Branzi', 'Serina', 'Selvino'],
    home: 'Bergamo',
    away: 'Selvino',
    mb: 22,
  },
  {
    id: 'sellaronda',
    name: 'Sellaronda',
    tagline: 'I quattro passi del Sella, Canazei e la Marmolada',
    areas: [
      { id: 'sella', label: 'I quattro passi' },
      { id: 'marmolada', label: 'La Marmolada' },
    ],
    starts: ['Selva di Val Gardena', 'Corvara in Badia', 'Colfosco', 'Arabba', 'Canazei', 'Campitello di Fassa', 'Plan de Gralba'],
    home: 'Selva di Val Gardena',
    away: 'Corvara in Badia',
    mb: 12,
  },
];

export function worldInfo(id: string | null | undefined): WorldInfo {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}

export function isWorld(id: string | null | undefined): id is string {
  return WORLDS.some((w) => w.id === id);
}

export function worldBase(id = WORLD_ID): string {
  const base = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/';
  return `${base}world/${id}/`;
}

/**
 * Uso del suolo nella griglia del terreno. `piste` (dal 07/11/2026, Sellaronda) è una pista da
 * sci: nel 3D una radura senza alberi, prato più chiaro; la scrive il build da `piste:type`.
 *
 * Le altre cose nuove del Sellaronda non hanno bisogno di campi nuovi in features.json: gli
 * impianti di risalita sono già `cables` (k = aerialway: gondola, chair_lift, cable_car,
 * platter, t-bar…; piloni, cavo, stazioni e cabine li disegna src/open/Lifts.tsx), i passi sono
 * i `peaks` con pass = 1 (cartello «Passo Sella 2240 m» in src/open/Passi.tsx), cappelle,
 * rifugi e ossario arrivano da monumenti.json con gli archetipi `chiesetta`, `rifugio`, `ossario`
 * (src/world/monumenti/archetipi.ts). L'aspetto del mondo (roccia, linea del bosco, neve, case)
 * sta in src/open/look.ts: `lookFor(graph.id)`.
 */
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
  /** pista da sci (dal 07/11/2026, Sellaronda): nel 3D una radura senza alberi; la scrive il build da `piste:type` */
  piste: 9,
} as const;

export type LandmarkKind = 'citta' | 'paese' | 'chiesa' | 'torre' | 'porta' | 'mura' | 'ponte' | 'fiume' | 'cima' | 'passo' | 'lago' | 'castello' | 'luogo' | 'funivia' | 'stazione' | 'santuario' | 'rifugio' | 'cappella' | 'ghiacciaio';

/** Le zone dei percorsi: quelle di Bergamo e quelle del Sellaronda (le etichette in WORLDS). */
export type RideArea = 'citta' | 'brembana' | 'seriana' | 'valli' | 'sella' | 'marmolada';

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
  area: RideArea;
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

/**
 * I luoghi da passare in bici, presi da OSM anche senza nome: fontanelle, belvederi, chiese,
 * campanili, edicole votive, castelli, negozi di bici, bar di paese. Sono vicino alla strada
 * (entro qualche decina di metri, un belvedere o un castello un po' di più).
 */
export type PoiKind =
  | 'fontanella'
  | 'fontana'
  | 'belvedere'
  | 'chiesa'
  | 'santuario'
  | 'campanile'
  | 'castello'
  | 'torre'
  | 'edicola'
  | 'croce'
  | 'ponte'
  | 'bici'
  | 'bar'
  | 'rifugio';

export const POI_KINDS: readonly PoiKind[] = ['fontanella', 'fontana', 'belvedere', 'chiesa', 'santuario', 'campanile', 'castello', 'torre', 'edicola', 'croce', 'ponte', 'bici', 'bar', 'rifugio'];

/** Come si chiama un luogo senza nome, e il tipo sotto un nome. */
export const POI_LABEL: Record<PoiKind, string> = {
  fontanella: 'Fontanella',
  fontana: 'Fontana',
  belvedere: 'Belvedere',
  chiesa: 'Chiesa',
  santuario: 'Santuario',
  campanile: 'Campanile',
  castello: 'Castello',
  torre: 'Torre',
  edicola: 'Edicola votiva',
  croce: 'Croce',
  ponte: 'Ponte storico',
  bici: 'Negozio di bici',
  bar: 'Bar',
  rifugio: 'Rifugio',
};

export interface Poi {
  /** stabile fra una costruzione e l'altra: «n», «w» o «a» (nodo, via, area OSM) + id OSM */
  id: string;
  kind: PoiKind;
  /** nome OSM, '' se non c'è (si mostra POI_LABEL[kind]) */
  name: string;
  x: number;
  z: number;
  /** quota del terreno, metri */
  y: number;
  /** il punto di strada più vicino: arco del grafo, distanza da `a` lungo l'arco, distanza in pianta */
  edge: number;
  s: number;
  off: number;
  /** in OSM è un edificio: il 3D c'è già con la sua impronta, niente modellino */
  building: boolean;
}

/**
 * Un semaforo. Sempre verde: è un punto di riferimento, non ferma nessuno. A un incrocio
 * (`node` ≥ 0) ce n'è uno per ogni strada che ci arriva; a metà strada (`node` = −1, semaforo
 * pedonale) due, uno per verso.
 */
export interface TrafficSignal {
  /** incrocio del grafo servito, o −1 */
  node: number;
  /** l'arco su cui sta il semaforo OSM, e la distanza da `a` lungo l'arco */
  edge: number;
  s: number;
  x: number;
  z: number;
  y: number;
}

/** Segnaletica orizzontale da OSM, agganciata al grafo. */
export interface RoadMarks {
  /** strisce pedonali: arco e distanza da `a` */
  crossings: { edge: number; s: number }[];
  /** dare precedenza (denti di squalo) e stop: arco, distanza, verso dell'incrocio (1 = verso b) */
  yields: { edge: number; s: number; toward: 1 | -1; stop: boolean }[];
  /** mini rotatorie dipinte: nodi del grafo */
  mini: number[];
}

/** Un pilone o una stazione di un impianto di risalita (dai nodi `aerialway` di OSM). */
export interface LiftPoint {
  kind: 'pylon' | 'station';
  name: string;
  x: number;
  z: number;
  /** quota del terreno */
  y: number;
}

/** Una pista da sci: una fascia senza alberi, da disegnare chiara nel bosco. */
export interface Piste {
  name: string;
  /** semilarghezza, metri */
  hw: number;
  /** x, z, y piatto */
  pts: Float32Array;
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
  /** luoghi da passare (vuoto nei dati prima del 03/11/2026) */
  pois: Poi[];
  /** semafori, uno per incrocio o per attraversamento */
  signals: TrafficSignal[];
  marks: RoadMarks;
  /** piloni e stazioni degli impianti (solo nei mondi di montagna, dal 07/11/2026) */
  lifts: LiftPoint[];
  /** piste da sci come radure (idem) */
  pistes: Piste[];
}

export interface WorldData {
  graph: WorldGraph;
  rides: RideDef[];
  features: WorldFeatures;
  proj: ReturnType<typeof projector>;
  toGeo(x: number, z: number): LatLon;
}

export interface FeaturesFile {
  rivers: { n: string; k: RiverLine['kind']; hw: number; p: number[] }[];
  lakes: { n: string; y: number; r: number[] }[];
  peaks: [string, number, number, number, number][];
  places: [string, string, number, number, number][];
  walls: { k: string; n?: string; p: number[] }[];
  rails: { k: string; n?: string; p: number[] }[];
  cables: { k: string; n?: string; p: number[] }[];
  landmarks: Landmark[];
  /** [id, tipo, nome, x, z, y, arco, s, scostamento, edificio 0/1] */
  pois?: [string, string, string, number, number, number, number, number, number, number][];
  /** [nodo, arco, s, x, z, y] */
  signals?: [number, number, number, number, number, number][];
  /** strisce: [arco, s dm] in fila; precedenze: [arco, s dm, verso, stop] in fila; mini rotatorie: nodi */
  marks?: { c: number[]; y: number[]; m: number[] };
  /** [tipo, nome, x, z, y] */
  lifts?: [string, string, number, number, number][];
  pistes?: { n: string; hw: number; p: number[] }[];
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

const POI_SET = new Set<string>(POI_KINDS);

/** I campi del 03/11/2026 sono facoltativi: un features.json più vecchio dà liste vuote. */
export function decodeFeatures(f: FeaturesFile): WorldFeatures {
  const c = f.marks?.c ?? [];
  const y = f.marks?.y ?? [];
  const crossings: RoadMarks['crossings'] = [];
  for (let i = 0; i + 1 < c.length; i += 2) crossings.push({ edge: c[i], s: c[i + 1] / 10 });
  const yields: RoadMarks['yields'] = [];
  for (let i = 0; i + 3 < y.length; i += 4) yields.push({ edge: y[i], s: y[i + 1] / 10, toward: y[i + 2] < 0 ? -1 : 1, stop: y[i + 3] === 1 });
  return {
    pois: (f.pois ?? [])
      .filter((p) => POI_SET.has(p[1]))
      .map(([id, kind, name, x, z, py, edge, s, off, building]) => ({ id, kind: kind as PoiKind, name, x, z, y: py, edge, s, off, building: building === 1 })),
    signals: (f.signals ?? []).map(([node, edge, s, x, z, sy]) => ({ node, edge, s, x, z, y: sy })),
    marks: { crossings, yields, mini: f.marks?.m ?? [] },
    rivers: f.rivers.map((r) => ({ name: r.n, kind: r.k, hw: r.hw, pts: undelta(r.p, 3) })),
    lakes: f.lakes.map((l) => ({ name: l.n, level: l.y, ring: undelta(l.r, 2) })),
    peaks: f.peaks.map(([name, x, z, ele, pass]) => ({ name, x, z, ele, pass: pass === 1 })),
    places: f.places.map(([name, kind, x, z, y]) => ({ name, kind: kind as Place['kind'], x, z, y })),
    walls: f.walls.map((w) => ({ kind: w.k, name: w.n, pts: undelta(w.p, 3) })),
    rails: f.rails.map((w) => ({ kind: w.k, name: w.n, pts: undelta(w.p, 3) })),
    cables: f.cables.map((w) => ({ kind: w.k, name: w.n, pts: undelta(w.p, 3) })),
    landmarks: f.landmarks,
    lifts: (f.lifts ?? []).filter((l) => l[0] === 'pylon' || l[0] === 'station').map(([kind, name, x, z, y]) => ({ kind: kind as LiftPoint['kind'], name, x, z, y })),
    pistes: (f.pistes ?? []).map((p) => ({ name: p.n, hw: p.hw, pts: undelta(p.p, 3) })),
  };
}

/** Una cache per mondo: si scarica una volta, e il mondo cambia senza perdere l'altro. */
const cached = new Map<string, Promise<WorldData>>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export function loadWorld(id: string | null | undefined = WORLD_ID): Promise<WorldData> {
  const wid = isWorld(id) ? id : WORLD_ID;
  let p = cached.get(wid);
  if (!p) {
    const base = worldBase(wid);
    p = Promise.all([getJson<WorldGraphFile>(`${base}graph.json`), getJson<RideDef[]>(`${base}rides.json`), getJson<FeaturesFile>(`${base}features.json`)]).then(([g, rides, f]) => {
      const graph = new WorldGraph(g);
      const proj = projector(graph.origin);
      return { graph, rides, features: decodeFeatures(f), proj, toGeo: (x: number, z: number) => proj.toGeo(x, z) };
    });
    cached.set(wid, p);
    p.catch(() => {
      cached.delete(wid);
    });
  }
  return p;
}

/** L'ultimo mondo scelto nella pagina Mondo (chiave `mondo` del kv), o quello di partenza. */
export const WORLD_KV = 'mondo';

/** Il mondo di un giro salvato: il prefisso del suo routeId («sellaronda:pordoi-arabba»), se è un mondo. */
export function worldOfRouteId(routeId: string | undefined): string | null {
  const i = routeId?.indexOf(':') ?? -1;
  if (!routeId || i <= 0) return null;
  const w = routeId.slice(0, i);
  return isWorld(w) ? w : null;
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
  /** mattonelle del DEM che non sono arrivate (404, rete giù): un errore, non un caricamento lento */
  private failed = new Set<string>();
  /** il terreno lontano non è arrivato */
  farFailed = false;
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
          if (!res.ok) {
            this.failed.add(key);
            return null;
          }
          const tile = decodeDemTile(new Uint8Array(await res.arrayBuffer()), this.n, tx, tz);
          this.tiles.set(key, tile);
          return tile;
        })
        .catch(() => {
          this.failed.add(key);
          return null;
        })
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
      if (!res.ok) {
        this.farFailed = true;
        return null;
      }
      this.farH = decodeFar(new Uint8Array(await res.arrayBuffer()), f.nx, f.nz);
      return this.farH;
    } catch {
      this.farFailed = true;
      return null;
    }
  }

  /** Una mattonella del DEM entro `radius` da (x, z) non è arrivata. */
  failedAround(x: number, z: number, radius: number): boolean {
    if (this.failed.size === 0) return false;
    const [a0, b0] = this.tileOf(x - radius, z - radius);
    const [a1, b1] = this.tileOf(x + radius, z + radius);
    for (const key of this.failed) {
      const [tx, tz] = key.split('_').map(Number);
      if (tx >= a0 && tx <= a1 && tz >= b0 && tz <= b1) return true;
    }
    return false;
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
