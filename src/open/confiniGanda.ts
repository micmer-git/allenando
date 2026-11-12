import { Color, ShapeUtils, Vector2 } from 'three';
import type { WorldField } from './field';
import type { Boundary, GandaSurvey } from './rilievoGanda';
import type { Mesh, TileSpec } from './tiles';

const iron = new Color('#585c56');
const wire = new Color('#85877e');
const wood = new Color('#79664c');
const stone = new Color('#89867d');
const damp = new Color('#655f56');
const coping = new Color('#a59f91');
const leaves = new Color('#586342');
const leafTop = new Color('#778254');
type PlanPoint = { x: number; z: number };
type Point = PlanPoint & { y: number };

function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function face(m: Mesh, a: Point, b: Point, lo: number, hi: number, bottom: Color, top = bottom): void {
  const i = m.vertex(a.x, a.y + lo, a.z, 0, 0, bottom);
  m.vertex(b.x, b.y + lo, b.z, 1, 0, bottom);
  m.vertex(a.x, a.y + hi, a.z, 0, 1, top);
  m.vertex(b.x, b.y + hi, b.z, 1, 1, top);
  m.idx.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
}

/** Interpola gli stessi due triangoli di terrainJob: una recinzione segue il terreno visibile. */
function ground(field: WorldField, spec: TileSpec) {
  const cache = new Map<string, number>();
  const at = (x: number, z: number) => {
    const key = x + ':' + z;
    let h = cache.get(key);
    if (h === undefined) {
      h = field.height(x, z, spec.spacing);
      cache.set(key, h);
    }
    return h;
  };
  return (p: PlanPoint): Point => {
    const step = spec.spacing;
    const x0 = spec.x0 + Math.floor((p.x - spec.x0) / step) * step;
    const z0 = spec.z0 + Math.floor((p.z - spec.z0) / step) * step;
    const u = (p.x - x0) / step;
    const v = (p.z - z0) / step;
    const b = at(x0 + step, z0), c = at(x0, z0 + step);
    const y = u + v <= 1
      ? at(x0, z0) * (1 - u - v) + b * u + c * v
      : at(x0 + step, z0 + step) * (u + v - 1) + b * (1 - v) + c * (1 - u);
    return { ...p, y };
  };
}

function post(m: Mesh, center: Point, half: number, height: number, color: Color): void {
  // L'intersezione dei due piani mantiene il montante visibile anche di taglio.
  face(m, { ...center, x: center.x - half }, { ...center, x: center.x + half }, -.12, height, color);
  face(m, { ...center, z: center.z - half }, { ...center, z: center.z + half }, -.12, height, color);
}

function fence(m: Mesh, line: Boundary, a: Point, b: Point, last: boolean): void {
  const h = line.height || (line.kind === 'grille' ? 1.22 : 1.05);
  const timber = line.kind === 'timber';
  const material = timber ? wood : iron;
  const bar = timber ? .095 : .042;
  face(m, a, b, h * .86, h * .86 + bar, material);
  face(m, a, b, h * .32, h * .32 + bar, material);
  post(m, a, .041, h + .02, material);
  if (last) post(m, b, .041, h + .02, material);
  if (line.kind === 'grille') {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .33);
    for (let k = 1; k < n; k++) {
      const p = mix(a, b, k / n);
      const q = mix(a, b, (k + .10) / n);
      face(m, p, q, .10, h, iron);
    }
  } else if (line.kind === 'fence') {
    face(m, a, b, h * .60, h * .60 + .02, wire);
  }
}

function wall(m: Mesh, outline: Point[], h: number, hedge = false): void {
  const corners = outline.map(p => new Vector2(p.x, p.z));
  const top = hedge ? leafTop : coping;
  for (let i = 0; i < outline.length; i++) {
    face(m, outline[i], outline[(i + 1) % outline.length], -.25, h, hedge ? leaves : damp, hedge ? leafTop : stone);
  }
  const first = m.pos.length / 3;
  for (const p of outline) m.vertex(p.x, p.y + h, p.z, 0, 0, top);
  for (const [a,b,c] of ShapeUtils.triangulateShape(corners, [])) m.idx.push(first+c, first+b, first+a);
}

export function* drawGandaBoundaries(survey: GandaSurvey, field: WorldField, spec: TileSpec, m: Mesh): Generator<void> {
  const x1 = spec.x0 + spec.size, z1 = spec.z0 + spec.size;
  const own = (x: number, z: number) => x >= spec.x0 && x < x1 && z >= spec.z0 && z < z1;
  const at = ground(field, spec);
  let batches = 0;
  for (const line of survey.within(spec.x0, spec.z0, x1, z1)) {
    if (++batches % 6 === 0) yield;
    if (line.kind === 'footprint') {
      // Ogni impronta appartiene a una sola tile, compresi i muri che attraversano il confine.
      if (!own((line.x0 + line.x1) / 2, (line.z0 + line.z1) / 2)) continue;
      const ring: Point[] = [];
      for (let i = 0; i + 1 < line.points.length; i++) {
        const a = line.points[i], b = line.points[i + 1];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4);
        for (let k = 0; k < n; k++) ring.push(at({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }));
      }
      if (ring.length >= 3) wall(m, ring, line.height || 1.05);
      continue;
    }
    for (let i = 1; i < line.points.length; i++) {
      const p = line.points[i - 1], q = line.points[i];
      const dx = q.x - p.x, dz = q.z - p.z, length = Math.hypot(dx, dz);
      const count = Math.max(1, Math.ceil(length / 3));
      for (let k = 0; k < count; k++) {
        if (!own(p.x + dx * (k + .5) / count, p.z + dz * (k + .5) / count)) continue;
        const a = at({ x: p.x + dx * k / count, z: p.z + dz * k / count });
        const b = at({ x: p.x + dx * (k + 1) / count, z: p.z + dz * (k + 1) / count });
        if (line.kind === 'retaining' || line.kind === 'wall' || line.kind === 'hedge') {
          const w = line.kind === 'hedge' ? .34 : .20;
          const nx = w * dz / length, nz = -w * dx / length;
          const ring = [{...a, x:a.x+nx, z:a.z+nz}, {...b, x:b.x+nx, z:b.z+nz},
            {...b, x:b.x-nx, z:b.z-nz}, {...a, x:a.x-nx, z:a.z-nz}];
          wall(m, ring, line.height || (line.kind === 'wall' ? 1.22 : 1.05), line.kind === 'hedge');
        } else {
          fence(m, line, a, b, k === count - 1 && i === line.points.length - 1);
        }
      }
    }
  }
}

/** Evita il doppio arredo soltanto dove la stessa banchina ha già un manufatto censito. */
export function nearGandaBoundary(survey: GandaSurvey, x: number, z: number): boolean {
  const r = 2.2;
  for (const line of survey.within(x - r, z - r, x + r, z + r)) {
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1], b = line.points[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      if ((a.x + t * dx - x) ** 2 + (a.z + t * dz - z) ** 2 <= r * r) return true;
    }
  }
  return false;
}
