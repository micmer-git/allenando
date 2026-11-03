import type { Leg, WorldGraph } from '@/open/graph';
import type { WorldPath } from '@/open/path';
import type { Place, RideDef } from '@/open/world';
import type { Segment, SegmentKind } from './arches';

/**
 * I tratti cronometrati: volate, gran premi della montagna, cronometro.
 *
 * Nel mondo si ricavano dai 13 percorsi: dal profilo (un punto ogni 25 m) si cercano la
 * salita più dura, un rettilineo piatto prima dell'arrivo, un tratto regolare da crono. Poi
 * ogni tratto si «ancora» agli archi del grafo che percorre: così vale anche nel giro libero,
 * per chiunque passi di lì nel verso giusto, non solo per chi ha scelto quel percorso.
 *
 * Sulle salite verificate il tratto è la salita intera (GPM) e, se è lunga, gli ultimi 3 km.
 */

export interface ProfilePoint {
  d: number;
  alt: number;
  x: number;
  z: number;
}

const STEP = 25;

/** Le salite di un profilo: dal punto più basso al più alto, finché non si scende di 15 m. */
export function findClimbs(p: ProfilePoint[], minGain = 60, minGrade = 0.03): { from: number; to: number; gain: number }[] {
  const out: { from: number; to: number; gain: number }[] = [];
  if (p.length < 3) return out;
  let lo = 0;
  let hi = 0;
  for (let i = 1; i < p.length; i++) {
    if (p[i].alt > p[hi].alt) hi = i;
    // un nuovo punto basso (o uno uguale, in piano) sposta la base finché non si è saliti davvero
    if (p[i].alt <= p[lo].alt && p[hi].alt - p[lo].alt < minGain) {
      lo = i;
      hi = i;
    }
    const drop = p[hi].alt - p[i].alt;
    const end = i === p.length - 1;
    if (drop > 15 || end) {
      const gain = p[hi].alt - p[lo].alt;
      const len = p[hi].d - p[lo].d;
      if (hi > lo && gain >= minGain && len > 0 && gain / len >= minGrade) out.push({ from: p[lo].d, to: p[hi].d, gain });
      lo = i;
      hi = i;
    }
  }
  return out;
}

/** Finestre di `len` metri quasi piatte (meno di `maxRise` di salita o discesa, nessun pezzo oltre il 4%). */
export function flatWindows(p: ProfilePoint[], len: number, maxRise: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const n = Math.round(len / STEP);
  for (let i = 0; i + n < p.length; i++) {
    const a = p[i];
    const b = p[i + n];
    if (Math.abs(b.alt - a.alt) > maxRise) continue;
    let steep = false;
    for (let k = i + 1; k <= i + n && !steep; k++) if (Math.abs(p[k].alt - p[k - 1].alt) / STEP > 0.04) steep = true;
    if (!steep) out.push({ from: a.d, to: b.d });
  }
  return out;
}

const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }, pad = 150) => a.from < b.to + pad && b.from < a.to + pad;

/**
 * I tratti di un percorso dal suo profilo. Al più due GPM (le salite con più dislivello),
 * una volata da 300 m prima dell'arrivo (e una a metà se il percorso è lungo), una crono
 * regolare da 3-8 km se il percorso supera i 6 km.
 */
export function deriveSegments(prefix: string, p: ProfilePoint[], name: (kind: SegmentKind, from: ProfilePoint, to: ProfilePoint) => string): Segment[] {
  const at = (d: number) => p[Math.max(0, Math.min(p.length - 1, Math.round(d / STEP)))];
  const length = p.length ? p[p.length - 1].d : 0;
  const segs: Segment[] = [];
  const climbs = findClimbs(p)
    .filter((c) => c.to - c.from >= 600)
    .sort((a, b) => b.gain - a.gain);
  let k = 0;
  for (const c of climbs) {
    if (k >= 2 || segs.some((s) => overlaps(s, c, 0))) continue;
    k++;
    segs.push({ id: `${prefix}:gpm${k}`, kind: 'gpm', name: name('gpm', at(c.from), at(c.to)), from: c.from, to: c.to });
  }
  const flats = flatWindows(p, 300, 6).filter((w) => w.from > 400 && w.to < length - 60 && !segs.some((s) => overlaps(s, w)));
  if (flats.length) {
    const last = flats[flats.length - 1];
    segs.push({ id: `${prefix}:volata1`, kind: 'volata', name: name('volata', at(last.from), at(last.to)), from: last.from, to: last.to });
    if (length > 12000) {
      const mid = flats.filter((w) => w.to < last.from - 2000).sort((a, b) => Math.abs((a.from + a.to) / 2 - length / 2) - Math.abs((b.from + b.to) / 2 - length / 2))[0];
      if (mid) segs.push({ id: `${prefix}:volata2`, kind: 'volata', name: name('volata', at(mid.from), at(mid.to)), from: mid.from, to: mid.to });
    }
  }
  if (length > 6000) {
    const L = Math.max(3000, Math.min(8000, Math.round((length * 0.4) / 250) * 250));
    const n = Math.round(L / STEP);
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i + n < p.length; i += 10) {
      // la crono non si accavalla con un GPM o una volata: gli archi finirebbero uno sull'altro
      if (segs.some((s) => overlaps(s, { from: p[i].d, to: p[i + n].d }))) continue;
      let cost = 0;
      for (let j = i + 1; j <= i + n; j++) cost += Math.abs(p[j].alt - p[j - 1].alt);
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    if (best >= 0) {
      const from = p[best].d;
      const to = p[best + n].d;
      segs.push({ id: `${prefix}:crono1`, kind: 'crono', name: name('crono', at(from), at(to)), from, to });
    }
  }
  return segs.sort((a, b) => a.from - b.from);
}

/** Il paese più vicino a un punto, per dare un nome al tratto. */
export function nearestPlace(places: Place[], x: number, z: number, max = 2500): Place | null {
  let best: Place | null = null;
  let bd = max;
  for (const pl of places) {
    if (pl.kind === 'hamlet') continue;
    const d = Math.hypot(pl.x - x, pl.z - z) * (pl.kind === 'quarter' || pl.kind === 'suburb' ? 1.4 : 1);
    if (d < bd) {
      bd = d;
      best = pl;
    }
  }
  return best;
}

/** Il profilo di un percorso del mondo, un punto ogni 25 m, letto direttamente dal grafo. */
export function rideProfile(graph: WorldGraph, legs: Leg[]): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  let base = 0;
  let next = 0;
  for (const l of legs) {
    const e = graph.edges[l.edge];
    while (next <= base + e.length) {
      const along = next - base;
      const s = l.dir > 0 ? along : e.length - along;
      const q = graph.pose(l.edge, Math.max(0, Math.min(e.length, s)), l.dir);
      out.push({ d: next, alt: q.y, x: q.x, z: q.z });
      next += STEP;
    }
    base += e.length;
  }
  return out;
}

/** Un tratto ancorato agli archi del grafo: vale in qualunque giro che li percorra nel verso giusto. */
export interface SegmentAnchor {
  seg: Segment;
  legs: Leg[];
  /** metri dall'inizio (intero) del primo arco al via del tratto */
  off0: number;
  /** metri dall'inizio dell'ultimo arco all'arrivo del tratto */
  off1: number;
  rideId: string;
}

export function anchorSegments(graph: WorldGraph, rideId: string, legs: Leg[], segs: Segment[]): SegmentAnchor[] {
  const cum: number[] = [0];
  for (const l of legs) cum.push(cum[cum.length - 1] + graph.edges[l.edge].length);
  const legAt = (d: number) => {
    let i = 0;
    while (i < legs.length - 1 && cum[i + 1] <= d) i++;
    return i;
  };
  return segs.map((seg) => {
    const k0 = legAt(seg.from);
    const k1 = legAt(Math.max(seg.from, seg.to - 0.01));
    return { seg, legs: legs.slice(k0, k1 + 1), off0: seg.from - cum[k0], off1: seg.to - cum[k1], rideId };
  });
}

const cache = new WeakMap<object, { anchors: SegmentAnchor[]; byRide: Map<string, Segment[]> }>();

const LABEL: Record<SegmentKind, string> = { volata: 'Volata', gpm: 'GPM', crono: 'Crono' };

/** Tutti i tratti del mondo, ancorati: si calcolano una volta per mondo caricato. */
export function worldSegments(data: { graph: WorldGraph; rides: RideDef[]; features: { places: Place[]; peaks?: { name: string; x: number; z: number; pass: boolean }[] } }): { anchors: SegmentAnchor[]; byRide: Map<string, Segment[]> } {
  const have = cache.get(data);
  if (have) return have;
  const anchors: SegmentAnchor[] = [];
  const byRide = new Map<string, Segment[]>();
  const seen = new Set<string>();
  for (const ride of data.rides) {
    const legs: Leg[] = ride.legs.map(([edge, dir]) => ({ edge, dir }));
    const prof = rideProfile(data.graph, legs);
    const name = (kind: SegmentKind, a: ProfilePoint, b: ProfilePoint) => {
      if (kind === 'gpm') {
        // il GPM prende il nome del passo o della cima, se c'è, altrimenti del paese in cima
        const peak = data.features.peaks?.filter((pk) => Math.hypot(pk.x - b.x, pk.z - b.z) < 900).sort((u, v) => Number(v.pass) - Number(u.pass))[0];
        return peak?.name ?? nearestPlace(data.features.places, b.x, b.z)?.name ?? ride.name;
      }
      const pa = nearestPlace(data.features.places, a.x, a.z)?.name;
      const pb = nearestPlace(data.features.places, b.x, b.z)?.name;
      if (kind === 'volata') return pb ?? pa ?? ride.name;
      return pa && pb && pa !== pb ? `${pa} – ${pb}` : pa ?? pb ?? ride.name;
    };
    const segs = deriveSegments(`w:${ride.id}`, prof, name);
    byRide.set(ride.id, segs);
    for (const a of anchorSegments(data.graph, ride.id, legs, segs)) {
      // due percorsi che passano dallo stesso tratto nello stesso verso: uno solo
      const key = `${a.seg.kind}:${a.legs.map((l) => `${l.edge}${l.dir > 0 ? '+' : '-'}`).join(',')}:${Math.round(a.off0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push(a);
    }
  }
  const out = { anchors, byRide };
  cache.set(data, out);
  return out;
}

export { LABEL as SEGMENT_LABEL };

/** Un tratto messo sul percorso che si sta pedalando: da/a in metri di quel percorso. */
export interface Window {
  seg: Segment;
  from: number;
  to: number;
}

/** Dove cadono i tratti ancorati sul percorso vivo del mondo (giro libero, anello o percorso scelto). */
export function windowsOnPath(path: WorldPath, anchors: SegmentAnchor[]): Window[] {
  const out: Window[] = [];
  const pl = path.legs;
  // indice: arco+verso → posizioni nel percorso
  const idx = new Map<string, number[]>();
  pl.forEach((l, i) => {
    const k = `${l.edge}:${l.dir}`;
    const list = idx.get(k);
    if (list) list.push(i);
    else idx.set(k, [i]);
  });
  for (const a of anchors) {
    const first = a.legs[0];
    for (const i of idx.get(`${first.edge}:${first.dir}`) ?? []) {
      if (i + a.legs.length > pl.length) continue;
      let ok = true;
      for (let j = 1; j < a.legs.length && ok; j++) ok = pl[i + j].edge === a.legs[j].edge && pl[i + j].dir === a.legs[j].dir;
      if (!ok) continue;
      const full = path.graph.edges[first.edge].length;
      const legStart = pl[i].from - (full - pl[i].len);
      const from = legStart + a.off0;
      if (from < pl[i].from - 0.5) continue; // il via è già dietro: il tratto non si cronometra
      const to = pl[i + a.legs.length - 1].from + a.off1;
      if (to - from < 50) continue;
      out.push({ seg: { ...a.seg, from, to }, from, to });
    }
  }
  return out.sort((x, y) => x.from - y.from);
}

/** I tratti di una salita verificata. */
export function climbSegments(routeId: string, name: string, length: number): Segment[] {
  const segs: Segment[] = [{ id: `salita:${routeId}`, kind: 'gpm', name, from: 0, to: length }];
  if (length > 6500) segs.push({ id: `salita:${routeId}:fine`, kind: 'crono', name: `${name}, ultimi 3 km`, from: length - 3000, to: length });
  return segs;
}

// ---------- il cronometro dei tratti ----------

export interface LiveSegment {
  seg: Segment;
  from: number;
  to: number;
  t0: number;
  /** energia spesa nel tratto, joule, per i W/kg medi */
  joules: number;
  startAlt: number;
  gain: number;
  lastAlt: number;
}

export type SegmentEvent =
  | { type: 'start'; seg: Segment }
  | { type: 'finish'; seg: Segment; sec: number; avgPower: number; gainM: number; lengthM: number }
  | { type: 'abort'; seg: Segment };

/**
 * Tiene il tempo dei tratti: parte quando si passa sotto l'arco di partenza, si ferma sotto
 * quello d'arrivo. Il tempo all'arco si interpola fra due fotogrammi. Se si lascia il tratto
 * (una svolta) il tempo si annulla. Chi parte già dentro un tratto non viene cronometrato.
 */
export class SegmentTracker {
  live: LiveSegment[] = [];
  private lastD: number | null = null;
  private lastT = 0;

  constructor(public windows: Window[]) {}

  /**
   * Dove si parte. Un centimetro indietro: così un tratto che comincia proprio sotto le ruote
   * (la salita intera, il GPM di Città Alta dal metro zero) parte al primo fotogramma.
   */
  prime(distance: number, elapsed: number): void {
    this.lastD = distance - 0.01;
    this.lastT = elapsed;
  }

  update(distance: number, elapsed: number, power: number, altitude: number): SegmentEvent[] {
    const ev: SegmentEvent[] = [];
    const prevD = this.lastD;
    const prevT = this.lastT;
    this.lastD = distance;
    this.lastT = elapsed;
    if (prevD == null || distance <= prevD) return ev;
    const frac = (x: number) => (x - prevD) / (distance - prevD);
    const timeAt = (x: number) => prevT + (elapsed - prevT) * frac(x);
    // energia del fotogramma, a chi è dentro
    const dt = Math.max(0, elapsed - prevT);
    for (const l of this.live) {
      l.joules += power * dt;
      if (altitude > l.lastAlt) l.gain += altitude - l.lastAlt;
      l.lastAlt = altitude;
    }
    // arrivi
    for (const l of [...this.live]) {
      const still = this.windows.find((w) => w.seg.id === l.seg.id && Math.abs(w.from - l.from) < 1);
      if (!still) {
        this.live = this.live.filter((x) => x !== l);
        ev.push({ type: 'abort', seg: l.seg });
        continue;
      }
      if (prevD < l.to && distance >= l.to) {
        const sec = timeAt(l.to) - l.t0;
        this.live = this.live.filter((x) => x !== l);
        if (sec > 1) ev.push({ type: 'finish', seg: l.seg, sec, avgPower: l.joules / sec, gainM: l.gain, lengthM: l.to - l.from });
      }
    }
    // partenze
    for (const w of this.windows) {
      if (prevD < w.from && distance >= w.from && !this.live.some((l) => l.seg.id === w.seg.id)) {
        this.live.push({ seg: w.seg, from: w.from, to: w.to, t0: timeAt(w.from), joules: 0, startAlt: altitude, gain: 0, lastAlt: altitude });
        ev.push({ type: 'start', seg: w.seg });
      }
    }
    return ev;
  }

  /** Il prossimo tratto davanti, entro `range` metri. */
  ahead(distance: number, range = 1500): Window | null {
    let best: Window | null = null;
    for (const w of this.windows) if (w.from > distance && w.from - distance < range && (!best || w.from < best.from)) best = w;
    return best;
  }
}
