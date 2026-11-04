import { ringArea } from './buildings';
import type { Building } from './world';

/*
 * Quanto è città un punto: la frazione di suolo coperta dalle case nel quadrato di lato 2R intorno.
 * Il suolo «aperto» dei dati (nessun uso del suolo in OSM) in un quartiere fitto non è un prato: è
 * il piazzale della stazione, una piazza, un cortile. Lo si pavimenta (piano del rilascio, M3).
 * Senza three.js: lo provano i test.
 */

/** Lato della cella della tabella, metri. */
const CELL = 10;

/**
 * La densità delle case intorno a (x, z) entro `R` metri, da 0 a 1, per i punti di un rettangolo:
 * una tabella delle somme (ogni casa conta col suo centro) letta in tempo costante.
 */
export function urbanDensity(lists: Building[][], x0: number, z0: number, x1: number, z1: number, R: number): (x: number, z: number) => number {
  const ox = x0 - R - CELL;
  const oz = z0 - R - CELL;
  const nx = Math.ceil((x1 - x0 + 2 * R + 2 * CELL) / CELL) + 1;
  const nz = Math.ceil((z1 - z0 + 2 * R + 2 * CELL) / CELL) + 1;
  // somme cumulate con una riga e una colonna di zeri davanti
  const sat = new Float64Array((nx + 1) * (nz + 1));
  for (const list of lists) {
    for (const b of list) {
      const r = b.ring;
      const m = r.length / 2;
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < r.length; i += 2) {
        cx += r[i];
        cz += r[i + 1];
      }
      const i = Math.floor((cx / m - ox) / CELL);
      const j = Math.floor((cz / m - oz) / CELL);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      sat[(j + 1) * (nx + 1) + i + 1] += Math.abs(ringArea(r));
    }
  }
  for (let j = 1; j <= nz; j++) {
    for (let i = 1; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      sat[k] += sat[k - 1] + sat[k - nx - 1] - sat[k - nx - 2];
    }
  }
  const at = (i: number, j: number) => sat[Math.min(nz, Math.max(0, j)) * (nx + 1) + Math.min(nx, Math.max(0, i))];
  const area = 4 * R * R;
  return (x, z) => {
    const i0 = Math.round((x - R - ox) / CELL);
    const i1 = Math.round((x + R - ox) / CELL);
    const j0 = Math.round((z - R - oz) / CELL);
    const j1 = Math.round((z + R - oz) / CELL);
    const s = at(i1, j1) - at(i0, j1) - at(i1, j0) + at(i0, j0);
    return Math.min(1, s / area);
  };
}

/** Raggio della densità che decide il suolo pavimentato, metri. */
export const URBAN_R = 90;

/**
 * Quanto pavimentare un punto di suolo aperto (o di case): pieno dove le case coprono almeno il 18%
 * intorno, e solo vicino alle strade (un prato in fondo a un paese resta prato).
 */
export function pavedWeight(density: number, roadDist: number): number {
  const s = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return s(0.09, 0.18, density) * (1 - s(25, 60, roadDist));
}
