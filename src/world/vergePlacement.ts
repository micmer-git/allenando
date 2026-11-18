import type { HeightField } from './heightfield';
import type { WorldField } from '@/open/field';
import type { LookCtx } from '@/open/look';
import { COVER } from '@/open/world';
import { BUILT_SURFACE } from '@/open/suoloGanda';
import type { Volume } from '@/open/labels';

export interface VergeGround {
  y: number;
  slope: number;
  gradientX?: number;
  gradientZ?: number;
  rockOnly?: boolean;
}
export type VergeSurface = (x: number, z: number) => VergeGround | null;
export interface VergeItem {
  kind: 'grass' | 'rock';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  yaw: number;
  tint: number;
  gradientX: number;
  gradientZ: number;
}

const CELL = 16;
const GRID = 3.2;
const RADIUS = 48;
export const VERGE_BUDGET = 320;

function random(x: number, z: number, salt: number) {
  let v = Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ salt;
  v = Math.imul(v ^ (v >>> 16), 2246822507);
  v = Math.imul(v ^ (v >>> 13), 3266489909);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}

/** La stessa zolla resta nello stesso posto anche tornando indietro. Si ricampiona solo
 * dopo 16 m o quando arrivano terreno/edifici, mai a ogni fotogramma. */
export function createVergeWindow(surface: VergeSurface, requestedBudget = VERGE_BUDGET) {
  const budget = Math.max(0, Math.min(VERGE_BUDGET, Math.floor(requestedBudget)));
  let cellX = NaN, cellZ = NaN;
  let previousRevision: unknown;
  const window = {
    items: [] as VergeItem[],
    update(x: number, z: number, revision: unknown = 0) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      if (cx === cellX && cz === cellZ && revision === previousRevision) return false;
      cellX = cx; cellZ = cz; previousRevision = revision;
      const centerX = (cx + .5) * CELL, centerZ = (cz + .5) * CELL;
      const items: VergeItem[] = [];
      for (let ix = Math.floor((centerX - RADIUS) / GRID); ix <= Math.ceil((centerX + RADIUS) / GRID); ix++) {
        for (let iz = Math.floor((centerZ - RADIUS) / GRID); iz <= Math.ceil((centerZ + RADIUS) / GRID); iz++) {
          if (random(ix, iz, 72) > .73) continue;
          const px = (ix + .18 + random(ix, iz, 93) * .64) * GRID;
          const pz = (iz + .18 + random(ix, iz, 37) * .64) * GRID;
          if ((px - centerX) ** 2 + (pz - centerZ) ** 2 > RADIUS ** 2) continue;
          const ground = surface(px, pz);
          if (!ground || !Number.isFinite(ground.y) || !Number.isFinite(ground.slope) || ground.slope > .78) continue;
          const choice = random(ix, iz, 12);
          if (ground.rockOnly && choice > .24) continue;
          const rock = ground.rockOnly || choice < .16;
          const size = random(ix, iz, 56);
          items.push({ kind: rock ? 'rock' : 'grass', x: px, y: ground.y - .025, z: pz,
            width: rock ? .34 + size * .4 : .48 + size * .32,
            height: rock ? .18 + size * .24 : .28 + size * .32,
            yaw: random(ix, iz, 81) * Math.PI * 2, tint: .86 + random(ix, iz, 44) * .26,
            gradientX: ground.gradientX ?? 0, gradientZ: ground.gradientZ ?? 0 });
        }
      }
      items.sort((a, b) => ((a.x - centerX) ** 2 + (a.z - centerZ) ** 2) - ((b.x - centerX) ** 2 + (b.z - centerZ) ** 2));
      window.items = items.slice(0, budget);
      return true;
    },
  };
  return window;
}

/** Quota del triangolo effettivamente disegnato, non del DEM continuo. Su una maglia
 * di 8–16 m la differenza basta a far sparire o galleggiare un ciuffo di 30 cm. */
export function triangleGround(height: (x: number, z: number) => number, x: number, z: number,
  spacing: number, originX = 0, originZ = 0): VergeGround {
  const gx = Math.floor((x - originX) / spacing), gz = Math.floor((z - originZ) / spacing);
  const x0 = originX + gx * spacing, z0 = originZ + gz * spacing;
  const u = (x - x0) / spacing, v = (z - z0) / spacing;
  const b = height(x0 + spacing, z0), c = height(x0, z0 + spacing);
  if (u + v <= 1) {
    const a = height(x0, z0);
    return { y: a + (b - a) * u + (c - a) * v, slope: Math.hypot(b - a, c - a) / spacing,
      gradientX: (b - a) / spacing, gradientZ: (c - a) / spacing };
  }
  const d = height(x0 + spacing, z0 + spacing);
  return { y: d + (c - d) * (1 - u) + (b - d) * (1 - v), slope: Math.hypot(d - c, d - b) / spacing,
    gradientX: (d - c) / spacing, gradientZ: (d - b) / spacing };
}

export function classicVergeSurface(field: HeightField, spacing: number): VergeSurface {
  const height = (x: number, z: number) => field.height(x, z, spacing);
  return (x, z) => {
    const road = field.road.nearest(x, z);
    const edge = road ? road.dist - field.halfWidth : Infinity;
    if (edge < 1.2 || edge > 15) return null;
    const ground = triangleGround(height, x, z, spacing);
    // Le salite classiche usano il manto nevoso fisso del loro terreno.
    if (ground.y + field.altitudeBase > 2700) return null;
    return ground;
  };
}

export function worldVergeSurface(field: WorldField, ctx: LookCtx, spacing: number, tileSize: number,
  buildings: () => readonly Volume[]): VergeSurface {
  const terrain = field.terrain;
  const bounds = terrain.graph.bounds;
  const height = (x: number, z: number) => field.height(x, z, spacing);
  return (x, z) => {
    const tile = terrain.tileOf(x, z);
    if (!terrain.has(...tile)) return null;
    const cover = terrain.cover(x, z);
    if (cover === COVER.water || cover === COVER.glacier || cover === COVER.residential || cover === COVER.industrial
      || terrain.surveyedCover(x, z) === BUILT_SURFACE) return null;
    const road = field.roadAt(x, z, 24);
    if (!road || road.edgeDist < 1.2 || road.edgeDist > 15 || field.nearBridge(x, z, 3)) return null;
    // Le AABB con mezzo metro di margine sono conservative anche sugli angoli dei palazzi.
    if (buildings().some(b => x > b.minX - .5 && x < b.maxX + .5 && z > b.minZ - .5 && z < b.maxZ + .5)) return null;
    const directY = field.height(x, z, spacing);
    if (field.lastWater() || field.inTube(x, z, directY)) return null;
    const originX = bounds.x0 + Math.floor((x - bounds.x0) / tileSize) * tileSize;
    const originZ = bounds.z0 + Math.floor((z - bounds.z0) / tileSize) * tileSize;
    const ground = triangleGround(height, x, z, spacing, originX, originZ);
    // È una soglia conservativa: niente verde che spunta nel manto sui versanti a nord.
    if (ground.y > ctx.season.snowLine - 340) return null;
    ground.rockOnly = cover === COVER.rock || ground.y > ctx.look.meadowTop;
    return ground;
  };
}
