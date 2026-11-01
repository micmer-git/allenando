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
  poseAt(distance: number): TrackPose;
}

const LOOP_LENGTH = 4800;

/** Anello chiuso di circa 4,8 km, con saliscendi che tornano alla quota di partenza. */
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

let cached: Track | null = null;
export function getTrack(): Track {
  if (!cached) cached = createTrack();
  return cached;
}
