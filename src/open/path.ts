import type { Hairpin } from '@/domain/geo';
import { wrap } from '@/domain/geo';
import type { Track, TrackPoint, TrackPose } from '@/domain/track';
import type { Dir, Leg, WorldGraph } from './graph';

/**
 * La strada che si sta pedalando nel mondo aperto: una fila di archi del grafo, campionata
 * ogni 2 m come una traccia qualunque. Per il motore (sim/engine.ts) è un `Track` come le
 * salite: distanza, quota, pendenza, direzione. La differenza è che si allunga mentre si
 * pedala e che, prima di un incrocio, la coda si può rifare girando da un'altra parte.
 *
 * Agli incroci la pianta si raccorda con una curva (Bézier su ±R metri): chi gira a destra
 * non ruota di colpo su un vertice di OSM.
 */

export interface PathLeg extends Leg {
  /** distanza sul percorso all'inizio del tratto */
  from: number;
  /** lunghezza percorsa su questo arco */
  len: number;
  /** distanza lungo l'arco (da a) all'inizio del tratto */
  s0: number;
}

const STEP = 2;
const CORNER = 7;
/**
 * La pendenza mostrata è la media sui 25 m prima e sui 25 m dopo (piano OROBIA 07/11, M.6): con
 * ±10 m il «%» dell'HUD saltava di tre-quattro punti a ogni vertice della pianta, a Gazzaniga
 * anche in piano. La quota è già livellata nel grafo: qui si toglie solo lo scatto.
 */
export const GRADE_WINDOW_M = 25;
const GRADE_STEPS = Math.ceil(GRADE_WINDOW_M / STEP);

export class WorldPath implements Track {
  readonly closed = false;
  readonly altitudeBase = 0;
  halfWidth = 3;
  hairpins: Hairpin[] = [];
  points: TrackPoint[] = [];
  legs: PathLeg[] = [];
  /** cresce a ogni modifica: chi disegna la strada sa quando rifarla */
  version = 0;
  /** come RouteTrack: la quota viene dal profilo livellato degli archi */
  readonly maxElevationDelta = 0;
  readonly hasElevation = true;
  private end = 0;

  constructor(
    readonly graph: WorldGraph,
    start: { edge: number; dir: Dir; s: number },
  ) {
    const e = graph.edges[start.edge];
    const s0 = Math.min(e.length, Math.max(0, start.s));
    const len = start.dir > 0 ? e.length - s0 : s0;
    this.pushLeg({ edge: start.edge, dir: start.dir, from: 0, len: Math.max(0.5, len), s0 });
  }

  get length(): number {
    return this.end;
  }

  /** Aggiunge un arco intero dopo l'ultimo. Deve partire dal nodo in cui finisce l'ultimo. */
  append(edge: number, dir: Dir): void {
    const e = this.graph.edges[edge];
    this.pushLeg({ edge, dir, from: this.end, len: e.length, s0: dir > 0 ? 0 : e.length });
  }

  appendLegs(legs: Leg[]): void {
    for (const l of legs) this.append(l.edge, l.dir);
  }

  /** Toglie i tratti dopo l'indice k (k resta). */
  truncateAfter(k: number): void {
    if (k >= this.legs.length - 1) return;
    this.legs.length = k + 1;
    const last = this.legs[k];
    this.end = last.from + last.len;
    const keep = Math.floor(this.end / STEP) + 1;
    this.points.length = Math.min(this.points.length, keep);
    // l'ultimo pezzo prima del vecchio incrocio torna dritto: la curva la rifà il prossimo append
    this.resample(Math.max(0, this.end - CORNER - STEP * 2), this.end);
    this.version++;
  }

  /** Il tratto in cui cade la distanza d. */
  legAt(d: number): number {
    const legs = this.legs;
    let lo = 0;
    let hi = legs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (legs[mid].from <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Dove si è sul grafo alla distanza d: arco, verso e distanza lungo l'arco da a. */
  edgeAt(d: number): { edge: number; dir: Dir; s: number; leg: number } {
    const k = this.legAt(d);
    const l = this.legs[k];
    const local = Math.min(l.len, Math.max(0, d - l.from));
    return { edge: l.edge, dir: l.dir, s: l.s0 + l.dir * local, leg: k };
  }

  /** Distanza sul percorso del nodo in fondo al tratto k. */
  legEnd(k: number): number {
    const l = this.legs[k];
    return l.from + l.len;
  }

  poseAt(distance: number): TrackPose {
    const pts = this.points;
    const n = pts.length;
    if (n === 0) return { x: 0, y: 0, z: 0, heading: 0, grade: 0, altitude: 0, distance: 0 };
    const d = Math.min(this.end, Math.max(0, distance));
    const f = d / STEP;
    const i0 = Math.min(n - 2, Math.max(0, Math.floor(f)));
    if (n < 2) {
      const p = pts[0];
      return { x: p.x, y: p.y, z: p.z, heading: p.heading, grade: p.grade, altitude: p.y, distance: d };
    }
    const a = pts[i0];
    const b = pts[i0 + 1];
    const u = Math.min(1, Math.max(0, (d - a.distance) / (b.distance - a.distance || STEP)));
    const y = a.y + (b.y - a.y) * u;
    return {
      x: a.x + (b.x - a.x) * u,
      y,
      z: a.z + (b.z - a.z) * u,
      heading: a.heading + wrap(b.heading - a.heading) * u,
      grade: a.grade + (b.grade - a.grade) * u,
      altitude: y,
      distance: d,
    };
  }

  private pushLeg(leg: PathLeg): void {
    const first = this.legs.length === 0;
    this.legs.push(leg);
    const start = leg.from;
    this.end = leg.from + leg.len;
    this.resample(first ? 0 : Math.max(0, start - CORNER), this.end);
    this.version++;
  }

  /** Posizione e quota «grezze» (senza raccordi) alla distanza d, dai tratti. */
  private raw(d: number): { x: number; y: number; z: number } {
    const k = this.legAt(d);
    const l = this.legs[k];
    const local = Math.min(l.len, Math.max(0, d - l.from));
    const p = this.graph.pose(l.edge, l.s0 + l.dir * local, l.dir);
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Ricampiona i punti fra d0 e d1, con i raccordi agli incroci che cadono lì dentro. */
  private resample(d0: number, d1: number): void {
    const i0 = Math.max(0, Math.floor(d0 / STEP));
    const i1 = Math.floor(d1 / STEP);
    for (let i = i0; i <= i1 + 1; i++) {
      const d = Math.min(this.end, i * STEP);
      if (i > i1 && d < this.end) break;
      const p = this.corner(d) ?? this.raw(d);
      this.points[i] = { distance: d, x: p.x, y: p.y, z: p.z, grade: 0, heading: 0 };
      if (d >= this.end) {
        this.points.length = i + 1;
        break;
      }
    }
    // direzione e pendenza dai vicini, su una finestra un po' più larga del tratto rifatto
    const pts = this.points;
    const a = Math.max(0, i0 - GRADE_STEPS - 2);
    const b = pts.length - 1;
    for (let i = a; i <= b; i++) {
      const h0 = Math.max(0, i - 3);
      const h1 = Math.min(b, i + 3);
      pts[i].heading = Math.atan2(pts[h1].x - pts[h0].x, pts[h1].z - pts[h0].z);
      const g0 = Math.max(0, i - GRADE_STEPS);
      const g1 = Math.min(b, i + GRADE_STEPS);
      const run = pts[g1].distance - pts[g0].distance;
      pts[i].grade = run > 0 ? (pts[g1].y - pts[g0].y) / run : 0;
    }
  }

  /** Se d cade a meno di CORNER metri da un incrocio fra due tratti, il punto sulla curva di raccordo. */
  private corner(d: number): { x: number; y: number; z: number } | null {
    if (this.legs.length < 2) return null;
    const k = this.legAt(d);
    const l = this.legs[k];
    let j = -1;
    if (k > 0 && d - l.from < CORNER) j = k;
    else if (k < this.legs.length - 1 && l.from + l.len - d < CORNER) j = k + 1;
    if (j < 0) return null;
    const prev = this.legs[j - 1];
    const next = this.legs[j];
    const r = Math.min(CORNER, prev.len / 2, next.len / 2);
    if (r < 0.5) return null;
    const node = next.from;
    const t = (d - (node - r)) / (2 * r);
    if (t < 0 || t > 1) return null;
    const A = this.graph.pose(prev.edge, prev.s0 + prev.dir * (prev.len - r), prev.dir);
    const B = this.graph.pose(next.edge, next.s0 + next.dir * r, next.dir);
    const N = this.graph.pose(next.edge, next.s0, next.dir);
    const w0 = (1 - t) * (1 - t);
    const w1 = 2 * t * (1 - t);
    const w2 = t * t;
    return {
      x: A.x * w0 + N.x * w1 + B.x * w2,
      // la quota non fa la curva: si passa dritti da A a B
      y: A.y + (B.y - A.y) * t,
      z: A.z * w0 + N.z * w1 + B.z * w2,
    };
  }
}
