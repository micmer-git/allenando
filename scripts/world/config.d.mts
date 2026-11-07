// I tipi di config.mjs, per le prove in TypeScript (tests/mondi.test.ts) e per build-world.ts.

export interface Box {
  s: number;
  w: number;
  n: number;
  e: number;
}

export interface World {
  id: string;
  name: string;
  region: Box;
  city: Box;
  horizon: Box;
  demStep: number;
  tile: number;
  farStep: number;
  osmDir: string;
  lang?: string;
  alpino?: { treeLine: number; rockSlope: number };
}

export interface WorldWithOrigin extends World {
  origin: { lat: number; lon: number };
}

export const WORLDS: Record<string, World>;
export const WORLD_ID: string;
export function worldConfig(id?: string): WorldWithOrigin;
export const WORLD: WorldWithOrigin;
export const REGION: Box;
export const CITY: Box;
export const HORIZON: Box;
export const ORIGIN: { lat: number; lon: number };
export const DEM_STEP: number;
export const TILE: number;
export const FAR_STEP: number;
export function bbox(b: Box): string;
