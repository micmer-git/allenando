/**
 * L'aspetto di un ciclista: maglia, pantaloncini, casco, bici, ruote. È il contratto fra il
 * gioco (catalogo, negozio, sblocchi: src/game/kit.ts) e il 3D (src/world/rider.ts), che lo
 * disegna. Solo dati: niente three.js qui, così il negozio lo usa anche per le anteprime 2D.
 */

/** Disegno della maglia. `accent` è il colore del disegno sopra la base. */
export type Pattern =
  | 'tinta' // tinta unita
  | 'fascia' // una fascia orizzontale sul petto
  | 'righe' // righe orizzontali sottili
  | 'cerchi' // bande larghe orizzontali (maglia «a cerchi»)
  | 'pois' // a pois (gran premio della montagna)
  | 'chevron' // V sul petto
  | 'sfumato' // sfumatura dal basso verso l'alto
  | 'spalle' // spalle e maniche di un altro colore
  | 'diagonale' // banda diagonale
  | 'quadri'; // scacchi

/** Profilo dei cerchi: basso (allenamento), alto (aero), lenticolare dietro (crono). */
export type Rim = 'basso' | 'alto' | 'lenticolare';

export interface Look {
  jersey: string;
  accent: string;
  pattern: Pattern;
  shorts: string;
  helmet: string;
  socks: string;
  shoes: string;
  frame: string;
  frameAccent: string;
  rim: Rim;
  /** colore delle lenti degli occhiali; '' = senza occhiali */
  glasses: string;
  skin?: string;
}

/** Il giallo del marchio: la maglia di chi comincia. */
export const BRAND_YELLOW = '#ffc814';

export const DEFAULT_LOOK: Look = {
  jersey: BRAND_YELLOW,
  accent: '#16130a',
  pattern: 'fascia',
  shorts: '#16130a',
  helmet: '#f4f1e8',
  socks: '#f4f1e8',
  shoes: '#f4f1e8',
  frame: '#1d1b17',
  frameAccent: BRAND_YELLOW,
  rim: 'basso',
  glasses: '#2b2b2b',
  skin: '#d9ad8c',
};

/** Un aspetto semplice da un solo colore: per i ciclisti virtuali e gli altri in rete. */
export function lookFromColor(color: string, variant = 0): Look {
  const patterns: Pattern[] = ['tinta', 'fascia', 'spalle', 'righe', 'chevron', 'diagonale'];
  const dark = ['#16130a', '#1b2230', '#f4f1e8', '#20262e'];
  return {
    ...DEFAULT_LOOK,
    jersey: color,
    accent: dark[variant % dark.length],
    pattern: patterns[variant % patterns.length],
    shorts: '#15181e',
    frame: variant % 3 === 0 ? '#e9e6dc' : variant % 3 === 1 ? '#1d1b17' : '#2a3442',
    frameAccent: color,
    rim: variant % 4 === 3 ? 'alto' : 'basso',
  };
}
