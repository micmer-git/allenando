import type { WorldGraph } from './graph';
import type { RoadPoint } from './puntiStrada';

export type BoundaryKind = 'grille' | 'fence' | 'timber' | 'hedge' | 'wall' | 'retaining' | 'footprint' | 'handrail' | 'rail';

export interface GandaFile {
  bounds: number[];
  dateOSM: string;
  borders: [string, BoundaryKind, number, number[]][];
  trees: [number, number][];
  /** La chiave è la riga originale (tipo, altezze, tetto e ogni vertice) della tile OSM. */
  heights: Record<string, Record<string, [number, string]>>;
}

export interface Boundary {
  kind: BoundaryKind;
  height: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  points: { x: number; z: number }[];
}

const CELL = 100;
const surveys = new WeakMap<WorldGraph, GandaSurvey>();

export class GandaSurvey {
  private readonly grid = new Map<string, Boundary[]>();

  constructor(readonly file: GandaFile) {
    for (const [, kind, h, deltas] of file.borders) {
      const line: Boundary = { kind, height: h / 10, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, points: [] };
      let x = 0;
      let z = 0;
      for (let i = 0; i < deltas.length; i += 2) {
        x += deltas[i];
        z += deltas[i + 1];
        line.points.push({ x: x / 10, z: z / 10 });
        line.x0 = Math.min(line.x0, x / 10);
        line.z0 = Math.min(line.z0, z / 10);
        line.x1 = Math.max(line.x1, x / 10);
        line.z1 = Math.max(line.z1, z / 10);
      }
      for (let i = Math.floor(line.x0 / CELL); i <= Math.floor(line.x1 / CELL); i++) {
        for (let j = Math.floor(line.z0 / CELL); j <= Math.floor(line.z1 / CELL); j++) {
          const key = i + ':' + j;
          const cell = this.grid.get(key);
          if (cell) cell.push(line);
          else this.grid.set(key, [line]);
        }
      }
    }
  }

  within(x0: number, z0: number, x1: number, z1: number): Set<Boundary> {
    const result = new Set<Boundary>();
    const [west, north, east, south] = this.file.bounds;
    if (x1 < west || x0 > east || z1 < north || z0 > south) return result;
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        for (const line of this.grid.get(i + ':' + j) ?? []) {
          if (line.x1 >= x0 && line.x0 <= x1 && line.z1 >= z0 && line.z0 <= z1) result.add(line);
        }
      }
    }
    return result;
  }
}

export function registerGandaSurvey(graph: WorldGraph, file: GandaFile): RoadPoint[] {
  surveys.set(graph, new GandaSurvey(file));
  // Il DBGT indica la posizione, la specie e l'altezza del singolo albero sono stimate.
  return file.trees.map(([x, z]) => [x / 10, z / 10, 'broadleaf', 0]);
}

export function gandaSurvey(graph: WorldGraph): GandaSurvey | undefined {
  return surveys.get(graph);
}
