/*
 * Il rilievo delle pareti. Il DEM a 25 m (EU-DEM) è liscio dove la montagna è più ripida: le torri
 * del Sassolungo, le pareti del Sella e del Sass Pordoi diventano cupole, coi picchi 50-130 m più
 * bassi del vero (Sassolungo 3130 invece di 3181, Gran Cir 2487 invece di 2592) e le forcelle
 * riempite. Viste dal passo (11/11/2026, S2.13) non si riconoscevano.
 *
 * Qui si ridà il contrasto che il DEM ha perso, solo sui pendii ripidi: a ogni campione si aggiunge
 * una parte della sua differenza dalla media dei vicini (una maschera di contrasto, raggio 75 m),
 * pesata dal dislivello intorno (niente dove sui 175 m del quadrato si sale meno di 24°, tutto oltre
 * i 45°: anche la cima di una torre, quasi piana, ha la parete intorno). Le creste e le torri salgono, le
 * forcelle e i canaloni scendono; prati, strade e paesi (pendii dolci) restano come sono. Al bordo
 * della mattonella del DEM il ritocco va a zero, così due mattonelle vicine combaciano.
 *
 * Niente three.js: Terrain (world.ts) lo chiama quando decodifica una mattonella.
 */

export interface Rilievo {
  /** quanto della differenza dalla media dei vicini si aggiunge (0 = niente) */
  k: number;
  /** raggio della media, in campioni del DEM */
  r: number;
}

/**
 * Per mondo. Spento dal 11/11/2026 anche per il Sellaronda (pista S3): il terreno ora viene dal
 * LiDAR delle province (12,5 m nelle mattonelle ripide) e le torri hanno le loro quote vere; il
 * ritocco sopra il dato vero gonfiava le creste e scavava i canaloni. Resta per un mondo di
 * montagna che avesse solo EU-DEM: S2_RILIEVO è il valore che usava il Sellaronda.
 */
export const S2_RILIEVO: Rilievo = { k: 1.2, r: 3 };
export const RILIEVO: Record<string, Rilievo> = {};

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Rende più netto il rilievo di una mattonella del DEM (side × side campioni a passo `step`), sul
 * posto. Ritorna di quanto si è alzato il punto più alzato (per le prove).
 */
export function sharpenRelief(h: Float32Array, side: number, step: number, opt: Rilievo): number {
  if (opt.k <= 0) return 0;
  const r = opt.r;
  const src = h.slice();
  // la media dei vicini: due passate di media mobile, prima per righe poi per colonne
  const tmp = new Float32Array(src.length);
  const blur = new Float32Array(src.length);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[j * side + Math.min(side - 1, Math.max(0, i + d))];
      tmp[j * side + i] = s / (2 * r + 1);
    }
  }
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += tmp[Math.min(side - 1, Math.max(0, j + d)) * side + i];
      blur[j * side + i] = s / (2 * r + 1);
    }
  }
  // il dislivello nel quadrato di lato 2r+1 (150 m): pesa il ritocco. Dove c'è una parete pesa
  // anche in cima alla torre, che è quasi piana ma ha la parete tutto intorno
  const lo = new Float32Array(src.length);
  const hi = new Float32Array(src.length);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      let a = Infinity;
      let b = -Infinity;
      for (let d = -r; d <= r; d++) {
        const v = src[j * side + Math.min(side - 1, Math.max(0, i + d))];
        if (v < a) a = v;
        if (v > b) b = v;
      }
      lo[j * side + i] = a;
      hi[j * side + i] = b;
    }
  }
  let most = 0;
  const span = (2 * r + 1) * step;
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      let a = Infinity;
      let b = -Infinity;
      for (let d = -r; d <= r; d++) {
        const kk = Math.min(side - 1, Math.max(0, j + d)) * side + i;
        if (lo[kk] < a) a = lo[kk];
        if (hi[kk] > b) b = hi[kk];
      }
      // dislivello su 175 m: 0,45 della larghezza (24°) niente, 1 (45°) tutto
      const w = smooth01(0.45, 1, (b - a) / span);
      if (w <= 0) continue;
      // al bordo della mattonella niente ritocco: le due mattonelle vicine hanno lo stesso campione
      const edge = Math.min(i, j, side - 1 - i, side - 1 - j);
      const e = Math.min(1, edge / r);
      const add = opt.k * w * e * (src[k] - blur[k]);
      h[k] = src[k] + add;
      if (add > most) most = add;
    }
  }
  return most;
}
