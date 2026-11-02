import type { DemGrid } from '@/domain/routes';
import type { Track } from '@/domain/track';

/**
 * Il terreno intorno alla strada. Lontano dalla strada è il modello digitale del terreno
 * (EU-DEM); vicino, scende sulla quota della carreggiata. Dentro la fascia della strada il
 * terreno sta sempre SOTTO l'asfalto, abbastanza da non bucarlo nemmeno tra due vertici
 * della griglia su una rampa ripida: la strada non galleggia e non viene coperta.
 * Il dislivello che resta lo chiude la scarpata del nastro stradale (vedi roadMesh).
 */

export interface RoadHit {
  dist: number;
  /** Quota della strada nel punto più vicino, coordinate della scena. */
  y: number;
  grade: number;
  /** Distanza lungo la strada del punto più vicino. */
  along: number;
}

const CELL = 32;

export function createRoadIndex(track: Pick<Track, 'points'>, stride = 2) {
  const pts = track.points;
  const segs: number[] = [];
  for (let i = 0; i < pts.length - 1; i += stride) segs.push(i);
  const map = new Map<number, number[]>();
  const key = (cx: number, cz: number) => cx * 73856093 + cz * 19349663;
  for (const i of segs) {
    const a = pts[i];
    const b = pts[Math.min(pts.length - 1, i + stride)];
    const minX = Math.floor(Math.min(a.x, b.x) / CELL);
    const maxX = Math.floor(Math.max(a.x, b.x) / CELL);
    const minZ = Math.floor(Math.min(a.z, b.z) / CELL);
    const maxZ = Math.floor(Math.max(a.z, b.z) / CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const k = key(cx, cz);
        const bucket = map.get(k);
        if (bucket) bucket.push(i);
        else map.set(k, [i]);
      }
    }
  }
  return {
    /** Punto di strada più vicino entro ~2 celle (≥ 64 m), oppure null. */
    nearest(x: number, z: number): RoadHit | null {
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      let bestD = Infinity;
      let hit: RoadHit | null = null;
      for (let oz = -2; oz <= 2; oz++) {
        for (let ox = -2; ox <= 2; ox++) {
          const bucket = map.get(key(cx + ox, cz + oz));
          if (!bucket) continue;
          for (const i of bucket) {
            const a = pts[i];
            const b = pts[Math.min(pts.length - 1, i + stride)];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const len2 = dx * dx + dz * dz || 1;
            const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
            const px = a.x + dx * u;
            const pz = a.z + dz * u;
            const d = (x - px) ** 2 + (z - pz) ** 2;
            if (d < bestD) {
              bestD = d;
              hit = {
                dist: 0,
                y: a.y + (b.y - a.y) * u,
                grade: a.grade,
                along: a.distance + (b.distance - a.distance) * u,
              };
            }
          }
        }
      }
      if (hit) hit.dist = Math.sqrt(bestD);
      return hit;
    },
  };
}

export type RoadIndex = ReturnType<typeof createRoadIndex>;

/** Quota DEM bilineare in coordinate della scena (y = quota − altitudeBase). */
export function createDemSampler(dem: DemGrid | null, altitudeBase: number) {
  if (!dem) return null;
  const { step, nx, nz, x0, z0, heights } = dem;
  // i buchi del DEM (mare, bordi) prendono il valore valido più vicino nella riga
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    let last = NaN;
    for (let i = 0; i < nx; i++) {
      const v = heights[j * nx + i];
      if (v != null) last = v;
      h[j * nx + i] = v ?? last;
    }
    for (let i = nx - 1; i >= 0; i--) {
      if (Number.isNaN(h[j * nx + i])) h[j * nx + i] = i < nx - 1 ? h[j * nx + i + 1] : altitudeBase;
    }
  }
  return (x: number, z: number): number => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / step));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = h[j * nx + i];
    const b = h[j * nx + i + 1];
    const c = h[(j + 1) * nx + i];
    const d = h[(j + 1) * nx + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v - altitudeBase;
  };
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface HeightField {
  /** Quota del terreno per una griglia di passo `spacing` metri. */
  height(x: number, z: number, spacing: number): number;
  road: RoadIndex;
  dem: ((x: number, z: number) => number) | null;
  halfWidth: number;
  altitudeBase: number;
  /** Distanza dalla strada dell'ultimo punto chiesto a height() (Infinity se lontano). */
  lastRoadDist(): number;
}

export function createHeightField(track: Track, dem: DemGrid | null): HeightField {
  const road = createRoadIndex(track);
  const sampler = createDemSampler(dem, track.altitudeBase);
  const hw = track.halfWidth;
  let lastDist = Infinity;
  return {
    road,
    lastRoadDist: () => lastDist,
    dem: sampler,
    halfWidth: hw,
    altitudeBase: track.altitudeBase,
    height(x, z, spacing) {
      const hit = road.nearest(x, z);
      lastDist = hit ? hit.dist : Infinity;
      if (!hit) {
        if (sampler) return sampler(x, z);
        return fallbackHills(x, z) - 6;
      }
      // senza DEM (traccia importata): un fondovalle indicativo che sale piano dai lati
      const far = sampler ? sampler(x, z) : hit.y - 0.6 + hit.dist * 0.06 + fallbackHills(x, z) * smoothstep(20, 64, hit.dist);
      const base = hit.y - 0.4;
      const w = smoothstep(hw + 1.5, hw + 45, hit.dist);
      let h = base + (far - base) * w;
      // dentro la fascia coperta da un triangolo che tocca la strada: sempre sotto l'asfalto
      if (hit.dist < hw + spacing * 1.6) {
        h = Math.min(h, hit.y - 0.35 - spacing * 1.2 * Math.abs(hit.grade));
      }
      return h;
    },
  };
}

function fallbackHills(x: number, z: number): number {
  return 6 * Math.sin(x * 0.011) * Math.cos(z * 0.009) + 3 * Math.sin(x * 0.027 + z * 0.019);
}
