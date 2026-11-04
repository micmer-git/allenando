/*
 * «Pronto» vuol dire pronto: le regole del caricamento del mondo intorno al ciclista, senza three.js
 * (le provano i test). Le usa WorldScene.
 */

/** Raggio del mondo che deve esserci prima di dire «pronto», metri. */
export const READY_RADIUS = 400;

/** Distanza dal punto (px, pz) al rettangolo della mattonella (ix, iz) di lato T, metri (0 se ci sta sopra). */
export function tileDist(t: { ix: number; iz: number }, x0: number, z0: number, T: number, px: number, pz: number): number {
  const dx = Math.max(x0 + t.ix * T - px, 0, px - (x0 + (t.ix + 1) * T));
  const dz = Math.max(z0 + t.iz * T - pz, 0, pz - (z0 + (t.iz + 1) * T));
  return Math.hypot(dx, dz);
}

/**
 * Avanzamento da 0 a 1: le mattonelle entro READY_RADIUS in scena, e il terreno lontano che conta
 * come una mattonella. Vale 1 solo quando c'è tutto.
 */
export function loadProgress(c: { near: number; nearReady: number }, farLoaded: boolean): number {
  if (c.near === 0) return farLoaded ? 0.05 : 0;
  const done = c.nearReady + (farLoaded ? 1 : 0);
  return done >= c.near + 1 ? 1 : Math.min(0.99, done / (c.near + 1));
}
