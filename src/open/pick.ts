import type { WorldGraph } from './graph';

/**
 * Il percorso toccato sulla carta: il più vicino al dito, misurato in pixel dello schermo
 * (non in metri), così la tolleranza è la stessa a ogni ingrandimento. Il dito è largo: si
 * accetta fino a `maxPx` pixel dalla linea.
 */
export function pickRoute<T extends { id: string; legs: [number, number][] }>(graph: WorldGraph, routes: T[], x: number, z: number, mpp: number, maxPx = 26): T | null {
  const max = maxPx * mpp;
  let best: T | null = null;
  let bestD = max;
  for (const r of routes) {
    for (const [edge] of r.legs) {
      const e = graph.edges[edge];
      if (!e) continue;
      const n = e.xs.length;
      for (let i = 1; i < n; i++) {
        const ax = e.xs[i - 1];
        const az = e.zs[i - 1];
        const bx = e.xs[i];
        const bz = e.zs[i];
        // scarto veloce: il segmento è lontano più di quanto si accetta
        if (Math.min(ax, bx) - x > bestD || x - Math.max(ax, bx) > bestD || Math.min(az, bz) - z > bestD || z - Math.max(az, bz) > bestD) continue;
        const d = segDist(x, z, ax, az, bx, bz);
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
    }
  }
  return best;
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
