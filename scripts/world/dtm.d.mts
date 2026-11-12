// I tipi di dtm.mjs, per build-world.ts e per le prove (tests/rilievo.test.ts).

export interface Fonte {
  id: string;
  nome: string;
  dato: string;
  licenza: string;
  attribuzione: string;
}

export const FONTI: Record<'bz' | 'tn', Fonte>;
export const CHUNK: number;
export const CELL: number;

export interface FineDem {
  box: { e0: number; e1: number; n0: number; n1: number };
  sources: string[];
  summits: { E: number; N: number; h: number; src: string }[];
  sampleUtm(E: number, N: number): number;
  sample(lat: number, lon: number): number;
  sourceAt(lat: number, lon: number): number;
}

export function loadFine(world: { id: string; fine?: unknown; region: unknown }): FineDem | null;
export function download(world: unknown): Promise<void>;
export function fineBlender(
  fineAt: (x: number, z: number) => number,
  coarseAt: (x: number, z: number) => number,
  box: { x0: number; z0: number; x1: number; z1: number },
  S: number,
  inner?: number,
  outer?: number,
): { height(x: number, z: number): number; inner(x: number, z: number): number };
export function readAsc(buf: Uint8Array): { width: number; height: number; data: Float32Array; x0: number; y0: number; dx: number; dy: number; nodata: number };
