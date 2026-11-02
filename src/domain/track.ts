import { fillElevation, findHairpins, gaussianSmooth, roundCorners, tubeSmooth, type Hairpin, type LocalPoint } from './geo';

export interface TrackPoint {
  distance: number;
  x: number;
  y: number;
  z: number;
  grade: number;
  heading: number;
}

export interface TrackPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  grade: number;
  altitude: number;
  distance: number;
}

export interface Track {
  length: number;
  points: TrackPoint[];
  /** true solo per l'anello DEMO dei test: le strade vere hanno un inizio e una fine. */
  closed: boolean;
  /** Quota vera = y + altitudeBase. */
  altitudeBase: number;
  /** Semilarghezza della carreggiata, metri. */
  halfWidth: number;
  hairpins: Hairpin[];
  poseAt(distance: number): TrackPose;
}

const LOOP_LENGTH = 4800;

/**
 * Anello DEMO di circa 4,8 km, inventato: serve solo ai test della fisica e del motore.
 * Nell'app non compare: lì si pedala soltanto su strade vere.
 */
export function createTrack(length = LOOP_LENGTH): Track {
  const rough = 1600;
  const raw: { x: number; y: number; z: number; dist: number }[] = [];
  let dist = 0;
  let prev = pathPoint(0);
  raw.push({ ...prev, dist: 0 });
  for (let i = 1; i <= rough; i++) {
    const u = i / rough;
    const p = pathPoint(u);
    const dx = p.x - prev.x;
    const dz = p.z - prev.z;
    dist += Math.hypot(dx, dz);
    raw.push({ ...p, dist });
    prev = p;
  }
  const scale = length / dist;
  const spacing = 2;
  const count = Math.round(length / spacing);
  const points: TrackPoint[] = [];
  for (let i = 0; i < count; i++) {
    const target = (i / count) * dist;
    const p = sampleRaw(raw, target);
    points.push({
      distance: i * spacing,
      x: p.x * scale,
      y: 0,
      z: p.z * scale,
      grade: 0,
      heading: 0,
    });
  }
  // La scala orizzontale allunga anche il percorso: ricalibriamo la lunghezza reale.
  let real = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    real += Math.hypot(b.x - a.x, b.z - a.z);
  }
  const fix = length / real;
  for (const p of points) {
    p.x *= fix;
    p.z *= fix;
  }

  const alts = points.map((_, i) => elevation((i / points.length) % 1));
  const minAlt = Math.min(...alts);
  for (let i = 0; i < points.length; i++) {
    points[i].y = alts[i] - minAlt + 4;
  }
  const grades = new Array<number>(points.length);
  const step = length / points.length;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ds = Math.hypot(b.x - a.x, b.z - a.z) || step;
    grades[i] = (b.y - a.y) / ds;
  }
  for (let i = 0; i < points.length; i++) {
    let s = 0;
    const w = 5;
    for (let k = -w; k <= w; k++) {
      s += grades[(i + k + points.length) % points.length];
    }
    points[i].grade = s / (w * 2 + 1);
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    points[i].heading = Math.atan2(b.x - a.x, b.z - a.z);
    points[i].distance = (i / points.length) * length;
  }

  const track: Track = {
    length,
    points,
    closed: true,
    altitudeBase: 0,
    halfWidth: 3.15,
    hairpins: [],
    poseAt(distance: number) {
      const d = mod(distance, length);
      const f = (d / length) * points.length;
      const i0 = Math.floor(f) % points.length;
      const i1 = (i0 + 1) % points.length;
      const u = f - Math.floor(f);
      const a = points[i0];
      const b = points[i1];
      const heading = lerpAngle(a.heading, b.heading, u);
      return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        z: a.z + (b.z - a.z) * u,
        heading,
        grade: a.grade + (b.grade - a.grade) * u,
        altitude: a.y + (b.y - a.y) * u,
        distance: d,
      };
    },
  };
  return track;
}

function pathPoint(u: number): { x: number; y: number; z: number } {
  const a = 2 * Math.PI * u;
  const r = 560 + 80 * Math.sin(2 * a) + 36 * Math.cos(3 * a) + 18 * Math.sin(5 * a);
  return {
    x: Math.cos(a) * r,
    y: elevation(u),
    z: Math.sin(a) * r * 0.78,
  };
}

function elevation(u: number): number {
  const a = 2 * Math.PI * u;
  return 7 * Math.sin(a) + 11 * Math.sin(2 * a + 0.7) + 3.4 * Math.sin(3 * a + 0.2) + 1.5 * Math.sin(5 * a);
}

function sampleRaw(
  raw: { x: number; y: number; z: number; dist: number }[],
  target: number,
): { x: number; y: number; z: number } {
  let lo = 0;
  let hi = raw.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (raw[mid].dist < target) lo = mid;
    else hi = mid;
  }
  const a = raw[lo];
  const b = raw[hi];
  const span = b.dist - a.dist || 1;
  const u = Math.min(1, Math.max(0, (target - a.dist) / span));
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u,
  };
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function lerpAngle(a: number, b: number, u: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}

export interface RouteTrackOptions {
  halfWidth?: number;
  /** Passo del campionamento finale, metri. */
  spacing?: number;
  /** Finestra di livellamento della pendenza, metri. */
  smoothM?: number;
  /** Scarto massimo ammesso tra quota livellata e sorgente, metri. */
  tolerance?: number;
  /** Pendenza massima ammessa dopo il livellamento, frazione. */
  maxGrade?: number;
}

export interface RouteTrack extends Track {
  /** Scarto massimo tra la quota livellata e quella della sorgente, metri. */
  maxElevationDelta: number;
  /** false se la sorgente non aveva quote: strada piatta, e lo si dice. */
  hasElevation: boolean;
}

/**
 * Strada vera da una polilinea in metri locali (vedi geo.ts). La forma in pianta è quella
 * della sorgente, con gli spigoli appena arrotondati; la quota è livellata su ~40 m e la
 * pendenza nasce dalla quota livellata, non da un disegno.
 */
export function createRouteTrack(input: LocalPoint[], opts: RouteTrackOptions = {}): RouteTrack {
  const halfWidth = opts.halfWidth ?? 3;
  const spacing = opts.spacing ?? 2;
  const smoothM = opts.smoothM ?? 40;
  const maxGrade = opts.maxGrade ?? 0.3;
  const clean: LocalPoint[] = [];
  for (const p of input) {
    const last = clean[clean.length - 1];
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.5) continue;
    clean.push(p);
  }
  if (clean.length < 2) throw new Error('traccia troppo corta');
  const rounded = roundCorners(clean);
  const cum = [0];
  for (let i = 1; i < rounded.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(rounded[i].x - rounded[i - 1].x, rounded[i].z - rounded[i - 1].z));
  }
  const length = cum[cum.length - 1];
  const count = Math.max(2, Math.round(length / spacing) + 1);
  const step = length / (count - 1);
  const xs: number[] = [];
  const zs: number[] = [];
  const raw: (number | null)[] = [];
  const dist: number[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const d = i * step;
    while (j < rounded.length - 2 && cum[j + 1] < d) j++;
    const a = rounded[j];
    const b = rounded[j + 1];
    const u = Math.min(1, Math.max(0, (d - cum[j]) / (cum[j + 1] - cum[j] || 1)));
    xs.push(a.x + (b.x - a.x) * u);
    zs.push(a.z + (b.z - a.z) * u);
    raw.push(a.ele != null && b.ele != null ? a.ele + (b.ele - a.ele) * u : (a.ele ?? b.ele ?? null));
    dist.push(d);
  }
  const filled = fillElevation(dist, raw);
  const hasElevation = filled != null;
  const sourceEle = filled ?? dist.map(() => 0);
  const tolerance = opts.tolerance ?? 8;
  let ele = tubeSmooth(sourceEle, tolerance, Math.max(1, Math.round(40 / step)));
  ele = gaussianSmooth(ele, smoothM / 4 / step);
  // pendenza limitata: oltre maxGrade è rumore del modello del terreno, non strada
  for (let i = 1; i < ele.length; i++) {
    const g = (ele[i] - ele[i - 1]) / step;
    if (g > maxGrade) ele[i] = ele[i - 1] + maxGrade * step;
    else if (g < -maxGrade) ele[i] = ele[i - 1] - maxGrade * step;
  }
  let maxElevationDelta = 0;
  for (let i = 0; i < ele.length; i++) maxElevationDelta = Math.max(maxElevationDelta, Math.abs(ele[i] - sourceEle[i]));
  const altitudeBase = Math.round(ele[0]);

  // direzione: differenza centrata su ±6 m, così il nastro non si piega su ogni nodo
  const span = Math.max(1, Math.round(6 / step));
  const heading: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - span);
    const b = Math.min(count - 1, i + span);
    heading.push(Math.atan2(xs[b] - xs[a], zs[b] - zs[a]));
  }
  const gradeRaw: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    gradeRaw.push((ele[b] - ele[a]) / ((b - a) * step || 1));
  }
  const grade = gaussianSmooth(gradeRaw, smoothM / 4 / step);
  const points: TrackPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({ distance: dist[i], x: xs[i], y: ele[i] - altitudeBase, z: zs[i], grade: grade[i], heading: heading[i] });
  }
  const hairpins = findHairpins(dist, heading);

  return {
    length,
    points,
    closed: false,
    altitudeBase,
    halfWidth,
    hairpins,
    maxElevationDelta,
    hasElevation,
    poseAt(distance: number) {
      const d = Math.min(length, Math.max(0, distance));
      const f = d / step;
      const i0 = Math.min(count - 2, Math.floor(f));
      const u = Math.min(1, f - i0);
      const a = points[i0];
      const b = points[i0 + 1];
      const y = a.y + (b.y - a.y) * u;
      return {
        x: a.x + (b.x - a.x) * u,
        y,
        z: a.z + (b.z - a.z) * u,
        heading: lerpAngle(a.heading, b.heading, u),
        grade: a.grade + (b.grade - a.grade) * u,
        altitude: y + altitudeBase,
        distance: d,
      };
    },
  };
}

let cached: Track | null = null;
/** Anello DEMO, solo per i test. */
export function getTrack(): Track {
  if (!cached) cached = createTrack();
  return cached;
}
