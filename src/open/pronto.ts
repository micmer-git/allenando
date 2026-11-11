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
 * come una mattonella. Conta anche i passi a metà (`nearPartial`: DEM arrivato, terreno e strade
 * in costruzione, arredo), così un caricamento lento va avanti invece di sembrare fermo. Vale 1
 * solo quando c'è tutto.
 */
export function loadProgress(c: { near: number; nearReady: number; nearPartial?: number }, farLoaded: boolean): number {
  if (c.near === 0) return farLoaded ? 0.05 : 0;
  const far = farLoaded ? 1 : 0;
  if (c.nearReady >= c.near && far) return 1;
  const done = Math.max(c.nearReady, c.nearPartial ?? 0) + far;
  return Math.min(0.99, done / (c.near + 1));
}

/** A che punto è una mattonella, da 0 a 1 (1 = in scena col suo arredo). */
export function tileStage(t: {
  state: 'wait' | 'build' | 'ready';
  shown: boolean;
  detail: 'none' | 'build' | 'ready';
  dshown: boolean;
  steps: number;
  dsteps: number;
}, demReady: boolean): number {
  if (t.state === 'wait') return demReady ? 0.1 : 0;
  // i passi del lavoro (terreno, strade, case, alberi): una curva che sale e non arriva mai da sola
  if (t.state === 'build') return 0.1 + 0.45 * (1 - Math.exp(-t.steps / 40));
  if (!t.shown) return 0.58;
  if (t.detail === 'none') return 0.6;
  if (t.detail === 'build') return 0.6 + 0.3 * (1 - Math.exp(-t.dsteps / 20));
  return t.dshown ? 1 : 0.93;
}

/**
 * Perché si è detto «pronto»: tutto intorno, il mondo leggero (strade e terreno lontano, senza
 * rete), un errore (DEM o terreno lontano mancanti), il tetto di tempo.
 */
export type ReadyReason = 'tutto' | 'leggero' | 'errore' | 'tetto';

/** Nel mondo leggero non c'è niente da aspettare dalla rete: il velo non resta più di così, ms. */
export const LIGHT_CAP = 6000;

/**
 * Si dice «pronto» quando c'è tutto; prima solo per un errore o dopo `cap` ms. Un telefono lento
 * aspetta di più dietro il velo, ma non vede un mondo a metà. Nel mondo leggero il motivo è sempre
 * `leggero`, e il tetto è LIGHT_CAP: le mattonelle si costruiscono dal terreno lontano, subito.
 */
export function readyReason(progress: number, error: boolean, elapsed: number, cap: number, leggero = false): ReadyReason | null {
  if (leggero) return progress >= 1 || elapsed > Math.min(cap, LIGHT_CAP) ? 'leggero' : error ? 'errore' : null;
  if (progress >= 1) return 'tutto';
  if (error) return 'errore';
  if (elapsed > cap) return 'tetto';
  return null;
}
