import type { Leg, WorldGraph } from '@/open/graph';
import type { Landmark, Peak, Place, RideDef } from '@/open/world';
import { findClimbs, nearestPlace, rideProfile, type ProfilePoint } from './segments';

/**
 * I passi e le cime di un giro: dove cadono sul percorso, quanto manca al prossimo passo, le
 * salite che portano a un passo. Servono all'HUD in montagna («Passo Pordoi fra 3,2 km · +210 m»),
 * al profilo coi segni, alla scheda del percorso e ai traguardi del Sellaronda.
 *
 * I passi sono i luoghi da riconoscere di tipo `passo` (features.json, id stabile come
 * `passo-di-ganda`), e in più le selle di OSM (`peaks` con `pass = 1`) quando la strada ci passa.
 */

export interface PassPoint {
  id: string;
  name: string;
  kind: 'passo' | 'cima';
  /** metri dall'inizio del percorso */
  at: number;
  /** quota del luogo */
  alt: number;
}

/** Gli id dei quattro passi del Sellaronda, come li scrive la pista S1 in features.json. */
export const SELLARONDA_PASSES = ['passo-sella', 'passo-pordoi', 'passo-gardena', 'passo-campolongo'] as const;

/** I percorsi che fanno il giro intero, nei due versi, e quelli della Marmolada e della granfondo. */
export const SELLARONDA_RIDES = ['sellaronda', 'sellaronda-orario'] as const;
export const MARMOLADA_RIDES = ['fedaia-canazei'] as const;
/** La granfondo di Gazzaniga: gli id li scrive la pista M in scripts/world/rides.ts (il corto e il medio). */
export const BERGHEM_RIDES = ['berghem-corto', 'berghem-medio'] as const;

/** I passi e le cime di un percorso, dai suoi luoghi (hanno già la distanza sul percorso). */
export function rideMarks(landmarks: readonly Landmark[], ride: Pick<RideDef, 'landmarks'>): PassPoint[] {
  const out: PassPoint[] = [];
  for (const l of ride.landmarks) {
    const lm = landmarks.find((x) => x.id === l.id);
    if (!lm || (lm.kind !== 'passo' && lm.kind !== 'cima')) continue;
    // un passo vale se la strada ci passa; una cima si segna anche da lontano (si vede)
    if (lm.kind === 'passo' && l.off > 300) continue;
    out.push({ id: lm.id, name: lm.name, kind: lm.kind, at: l.at, alt: lm.y });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * I passi lungo una strada qualunque (il giro libero, un anello): si campiona il tratto fra
 * `from` e `to` e si tiene ogni passo entro `range` metri, una volta sola, al punto più vicino.
 */
export function passesAlongPath(path: { length: number; poseAt(d: number): { x: number; z: number; altitude: number } }, landmarks: readonly Landmark[], from: number, to: number, range = 220, step = 50): PassPoint[] {
  const passes = landmarks.filter((l) => l.kind === 'passo');
  if (passes.length === 0) return [];
  const best = new Map<string, { d: number; at: number; alt: number; lm: Landmark }>();
  const end = Math.min(path.length, to);
  for (let d = Math.max(0, from); d <= end; d += step) {
    const p = path.poseAt(d);
    for (const lm of passes) {
      const dist = Math.hypot(lm.x - p.x, lm.z - p.z);
      if (dist > range) continue;
      const b = best.get(lm.id);
      if (!b || dist < b.d) best.set(lm.id, { d: dist, at: d, alt: p.altitude, lm });
    }
  }
  return [...best.values()].map(({ at, lm }) => ({ id: lm.id, name: lm.name, kind: 'passo' as const, at, alt: lm.y })).sort((a, b) => a.at - b.at);
}

export interface NextPass {
  name: string;
  /** metri che mancano */
  inM: number;
  /** metri di salita che mancano (quota del passo meno la tua, mai sotto zero) */
  upM: number;
}

/** Il prossimo passo davanti, entro `within` metri. */
export function nextPass(marks: readonly PassPoint[], distance: number, altitude: number, within = 5000): NextPass | null {
  let best: PassPoint | null = null;
  for (const m of marks) {
    if (m.kind !== 'passo' || m.at <= distance + 20 || m.at - distance > within) continue;
    if (!best || m.at < best.at) best = m;
  }
  return best ? { name: best.name, inM: best.at - distance, upM: Math.max(0, Math.round(best.alt - altitude)) } : null;
}

/** La seconda riga della pillola: «fra 3,2 km · +210 m»; sotto il chilometro «fra 400 m»; in cima «+0 m» non si scrive. */
export function passSub(n: NextPass): string {
  const km = n.inM >= 950 ? `${(n.inM / 1000).toFixed(1).replace('.', ',')} km` : `${Math.max(0, Math.round(n.inM / 10) * 10)} m`;
  return n.upM >= 5 ? `fra ${km} · +${n.upM} m` : `fra ${km}`;
}

/** «Passo Pordoi fra 3,2 km · +210 m»: il nome e la seconda riga insieme, per chi legge in una riga sola. */
export function passText(n: NextPass): string {
  return `${n.name} ${passSub(n)}`;
}

export interface RideClimb {
  name: string;
  from: number;
  to: number;
  lengthM: number;
  gainM: number;
  /** pendenza media, frazione */
  grade: number;
  topAlt: number;
  /** id del passo in cima, se c'è */
  passId?: string;
}

/**
 * Le salite di un percorso: dal profilo, quelle di almeno un chilometro e cento metri di
 * dislivello, col nome del passo in cima se la strada ci arriva (entro 900 m), altrimenti della
 * cima o del paese più vicino.
 */
export function rideClimbs(data: { graph: WorldGraph; features: { landmarks: Landmark[]; peaks: Peak[]; places: Place[] } }, ride: RideDef, profile?: ProfilePoint[]): RideClimb[] {
  const legs: Leg[] = ride.legs.map(([edge, dir]) => ({ edge, dir }));
  const prof = profile ?? rideProfile(data.graph, legs);
  const marks = rideMarks(data.features.landmarks, ride);
  const out: RideClimb[] = [];
  for (const c of findClimbs(prof, 100, 0.025)) {
    if (c.to - c.from < 1000) continue;
    const top = prof[Math.min(prof.length - 1, Math.round(c.to / 25))];
    const pass = marks.filter((m) => m.kind === 'passo' && Math.abs(m.at - c.to) < 900).sort((a, b) => Math.abs(a.at - c.to) - Math.abs(b.at - c.to))[0];
    const sella = pass ? null : data.features.peaks.filter((p) => p.pass && Math.hypot(p.x - top.x, p.z - top.z) < 600).sort((a, b) => Math.hypot(a.x - top.x, a.z - top.z) - Math.hypot(b.x - top.x, b.z - top.z))[0];
    const place = pass || sella ? null : nearestPlace(data.features.places, top.x, top.z);
    const name = pass?.name ?? sella?.name ?? (place ? `Salita di ${place.name}` : ride.name);
    out.push({ name, from: c.from, to: c.to, lengthM: c.to - c.from, gainM: c.gain, grade: c.gain / (c.to - c.from), topAlt: top.alt, passId: pass?.id });
  }
  return out;
}

/**
 * Il verso di un anello: con x verso est e z verso sud, l'area col segno (formula del laccio)
 * è positiva quando si gira in senso orario visto dall'alto. Null se non è un anello.
 */
export function loopSense(xs: ArrayLike<number>, zs: ArrayLike<number>): 'orario' | 'antiorario' | null {
  const n = Math.min(xs.length, zs.length);
  if (n < 3) return null;
  const closed = Math.hypot(xs[n - 1] - xs[0], zs[n - 1] - zs[0]) < 1500;
  if (!closed) return null;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += xs[i] * zs[j] - xs[j] * zs[i];
  }
  if (Math.abs(a) < 1e5) return null;
  return a > 0 ? 'orario' : 'antiorario';
}

/** I vertici di un percorso in pianta, uno ogni ~200 m, per il verso dell'anello. */
export function rideSense(graph: WorldGraph, ride: Pick<RideDef, 'legs'>): 'orario' | 'antiorario' | null {
  const prof = rideProfile(
    graph,
    ride.legs.map(([edge, dir]) => ({ edge, dir })),
  );
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < prof.length; i += 8) {
    xs.push(prof[i].x);
    zs.push(prof[i].z);
  }
  return loopSense(xs, zs);
}

/**
 * Lo stesso giro nell'altro verso, se esiste: un altro anello che percorre almeno metà delle
 * stesse strade (gli stessi archi) e gira dall'altra parte.
 */
export function siblingRide(graph: WorldGraph, rides: readonly RideDef[], ride: RideDef): RideDef | null {
  if (ride.kind !== 'giro') return null;
  const mine = new Set(ride.legs.map(([e]) => e));
  const sense = rideSense(graph, ride);
  if (!sense) return null;
  for (const r of rides) {
    if (r.id === ride.id || r.kind !== 'giro') continue;
    // metà delle strade di ENTRAMBI: il corto della Berghem MolaMia sale a Selvino da Nembro e
    // condivide metà della Ganda, ma non è la Ganda nell'altro verso
    const shared = r.legs.filter(([e]) => mine.has(e)).length;
    if (shared < Math.max(mine.size, r.legs.length) * 0.5) continue;
    if (rideSense(graph, r) !== sense) return r;
  }
  return null;
}

export const SENSE_LABEL = { orario: 'In senso orario', antiorario: 'In senso antiorario' } as const;
