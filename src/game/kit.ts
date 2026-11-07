import { DEFAULT_LOOK, type Look } from './look';

/**
 * Il guardaroba: maglie, caschi, bici e ruote. Ogni pezzo si compra con l'oro guadagnato
 * pedalando, oppure si sblocca con un livello o un traguardo. Sono solo estetica: la fisica
 * resta quella del tuo peso, della tua FTP e del tuo CdA, nessuna ruota fa andare più forte.
 */

export type Slot = 'maglia' | 'casco' | 'bici' | 'ruote';

export const SLOTS: { id: Slot; name: string }[] = [
  { id: 'maglia', name: 'Maglie' },
  { id: 'casco', name: 'Caschi' },
  { id: 'bici', name: 'Bici' },
  { id: 'ruote', name: 'Ruote' },
];

export interface Item {
  id: string;
  slot: Slot;
  name: string;
  /** una riga: da dove viene il disegno */
  note: string;
  /** i campi dell'aspetto che il pezzo cambia */
  look: Partial<Look>;
  /** prezzo in oro; 0 = gratis */
  price: number;
  /** livello minimo per comprarlo */
  level?: number;
  /** si sblocca solo con questo traguardo (e allora è gratis) */
  achievement?: string;
  /** si sblocca finendo questa serie di missioni (missions.ts) */
  series?: string;
  /** pezzo raro: bordo d'oro nel negozio */
  rare?: boolean;
}

const M = (id: string, name: string, note: string, look: Partial<Look>, price: number, extra: Partial<Item> = {}): Item => ({ id, slot: 'maglia', name, note, look, price, ...extra });
const C = (id: string, name: string, note: string, look: Partial<Look>, price: number, extra: Partial<Item> = {}): Item => ({ id, slot: 'casco', name, note, look, price, ...extra });
const B = (id: string, name: string, note: string, look: Partial<Look>, price: number, extra: Partial<Item> = {}): Item => ({ id, slot: 'bici', name, note, look, price, ...extra });
const R = (id: string, name: string, note: string, look: Partial<Look>, price: number, extra: Partial<Item> = {}): Item => ({ id, slot: 'ruote', name, note, look, price, ...extra });

export const ITEMS: Item[] = [
  // ---------- maglie ----------
  M('m-orobia', 'Oro Orobia', 'La maglia di chi comincia.', { jersey: '#ffc814', accent: '#16130a', pattern: 'fascia', shorts: '#16130a', socks: '#f4f1e8' }, 0),
  M('m-notte', 'Notte bergamasca', 'Nera, con le righe che si vedono ai fari.', { jersey: '#16130a', accent: '#ffc814', pattern: 'righe', shorts: '#16130a', socks: '#16130a' }, 180),
  M('m-brembo', 'Brembo', 'L’azzurro del fiume che scende da Foppolo.', { jersey: '#1d6fb8', accent: '#9fd8ff', pattern: 'sfumato', shorts: '#0f1d2c', socks: '#f4f1e8' }, 300),
  M('m-serio', 'Serio', 'Verde acqua, come il Serio sotto Ponte Nossa.', { jersey: '#1f9e8f', accent: '#e8fff9', pattern: 'chevron', shorts: '#0e2522', socks: '#f4f1e8' }, 300),
  M('m-maresana', 'Maresana', 'Il verde oliva del colle di casa.', { jersey: '#5b6b2a', accent: '#e9e2c4', pattern: 'diagonale', shorts: '#1c2210', socks: '#e9e2c4' }, 250),
  M('m-nerazzurra', 'Nerazzurra', 'Righe nere e blu, da stadio.', { jersey: '#1849a8', accent: '#0d0d10', pattern: 'righe', shorts: '#0d0d10', socks: '#1849a8' }, 400),
  M('m-brembana', 'Val Brembana', 'Bosco fitto e prato alto.', { jersey: '#24563a', accent: '#c7e3b3', pattern: 'cerchi', shorts: '#13261a', socks: '#c7e3b3' }, 350),
  M('m-seriana', 'Val Seriana', 'Rosso vino, come i tetti di Clusone.', { jersey: '#7d1f2b', accent: '#f1d8c0', pattern: 'chevron', shorts: '#2a0d12', socks: '#f1d8c0' }, 350),
  M('m-pois', 'Pois', 'Bianca a pois rossi: per chi va su.', { jersey: '#f6f3ea', accent: '#d8262e', pattern: 'pois', shorts: '#16130a', socks: '#f6f3ea' }, 600, { level: 4 }),
  M('m-presolana', 'Presolana', 'Grigio pietra e una banda di neve.', { jersey: '#6e6c66', accent: '#f4f1e8', pattern: 'diagonale', shorts: '#2a2926', socks: '#f4f1e8' }, 450, { level: 5 }),
  M('m-scacchi', 'Bandiera a scacchi', 'Per chi taglia tanti traguardi.', { jersey: '#f4f1e8', accent: '#121212', pattern: 'quadri', shorts: '#121212', socks: '#121212' }, 900, { level: 10, rare: true }),
  M('m-leggenda', 'Leggenda', 'Nero e oro. Si guadagna, non si compra in fretta.', { jersey: '#121008', accent: '#ffc814', pattern: 'sfumato', shorts: '#121008', socks: '#ffc814' }, 2500, { level: 18, rare: true }),
  // maglie dei traguardi
  M('m-citta-alta', 'Città Alta', 'Terracotta e pietra delle Mura.', { jersey: '#b5522e', accent: '#efe3c8', pattern: 'spalle', shorts: '#2b140b', socks: '#efe3c8' }, 0, { achievement: 'mondo-citta-alta' }),
  M('m-azzurra', 'Maglia azzurra', 'Il re della montagna: cinque GPM.', { jersey: '#1f7fe0', accent: '#ffffff', pattern: 'spalle', shorts: '#0b2a4d', socks: '#ffffff' }, 0, { achievement: 'gpm-5', rare: true }),
  M('m-differenziata', 'Differenziata', 'Verde vetro, giallo plastica, grigio secco: il re del cassonetto.', { jersey: '#2f8a3a', accent: '#f2c200', pattern: 'righe', shorts: '#5a5e64', socks: '#f2c200' }, 0, { achievement: 'cassonetto-10' }),
  M('m-ciclamino', 'Maglia ciclamino', 'Cinque volate: sei un velocista.', { jersey: '#d6267a', accent: '#ffffff', pattern: 'fascia', shorts: '#3a0a22', socks: '#ffffff' }, 0, { achievement: 'volata-5', rare: true }),
  M('m-crono', 'Oro crono', 'Tre cronometro sotto le lancette.', { jersey: '#ffb000', accent: '#ff6a00', pattern: 'sfumato', shorts: '#16130a', socks: '#16130a' }, 0, { achievement: 'crono-3', rare: true }),
  M('m-stelvio', 'Stelvio', 'Bianco ghiaccio, 48 tornanti blu.', { jersey: '#eef4fb', accent: '#1f5fbf', pattern: 'chevron', shorts: '#0d2547', socks: '#eef4fb' }, 0, { achievement: 'salita-stelvio' }),
  M('m-mortirolo', 'Mortirolo', 'Rosso scuro e nero: la salita più dura.', { jersey: '#6d0f14', accent: '#16130a', pattern: 'cerchi', shorts: '#16130a', socks: '#6d0f14' }, 0, { achievement: 'salita-mortirolo' }),
  M('m-selvino', 'Selvino', 'Verde e bianco, venti tornanti sopra Nembro.', { jersey: '#2f8f46', accent: '#ffffff', pattern: 'cerchi', shorts: '#0f2a16', socks: '#ffffff' }, 0, { achievement: 'salita-selvino' }),
  M('m-pioggia', 'Sotto la pioggia', 'Grigio antracite e arancio: chi pedala col brutto tempo.', { jersey: '#33363b', accent: '#ff7a1a', pattern: 'fascia', shorts: '#1a1b1e', socks: '#ff7a1a' }, 0, { achievement: 'pioggia' }),
  M('m-alba', 'Alba', 'Rosa e arancio, per chi esce prima delle sette.', { jersey: '#ff8a5c', accent: '#ffd36b', pattern: 'sfumato', shorts: '#2a1610', socks: '#ffd36b' }, 0, { achievement: 'alba' }),
  M('m-gruppo', 'Gruppo', 'Per chi è arrivato col gruppo.', { jersey: '#0f6e6a', accent: '#ffc814', pattern: 'chevron', shorts: '#06302e', socks: '#ffc814' }, 0, { achievement: 'sessione-gruppo' }),
  // la maglia della serie di missioni del Sellaronda (src/game/missions.ts, SERIES): grigio dolomia e ocra delle bande
  M('m-sella', 'Sella', 'Grigio dolomia a bande ocra: le quattro tappe del Sellaronda.', { jersey: '#c7c2b8', accent: '#c98a2e', pattern: 'righe', shorts: '#2a2622', socks: '#c7c2b8' }, 0, { series: 'sellaronda', rare: true }),
  // ---------- caschi ----------
  C('c-bianco', 'Bianco', 'Casco bianco, lenti fumé.', { helmet: '#f4f1e8', glasses: '#2b2b2b' }, 0),
  C('c-nero', 'Nero opaco', 'Lenti specchiate oro.', { helmet: '#17171a', glasses: '#c99a1a' }, 150),
  C('c-oro', 'Oro', 'Si vede da Città Alta.', { helmet: '#ffc814', glasses: '#16130a' }, 400, { level: 3 }),
  C('c-azzurro', 'Azzurro', 'Lenti blu.', { helmet: '#2a7fd4', glasses: '#103a6b' }, 200),
  C('c-rosso', 'Rosso', 'Lenti fumé.', { helmet: '#c9282d', glasses: '#2b2b2b' }, 200),
  C('c-crono', 'Crono', 'Per le crono: lenti oro.', { helmet: '#16130a', glasses: '#ffc814' }, 0, { achievement: 'crono-1' }),
  C('c-senza', 'Senza occhiali', 'Casco bianco, sguardo libero.', { helmet: '#f4f1e8', glasses: '' }, 60),
  // ---------- bici ----------
  B('b-notte', 'Notte', 'Telaio nero, filetti oro.', { frame: '#1d1b17', frameAccent: '#ffc814' }, 0),
  B('b-gesso', 'Gesso', 'Bianco gesso e oro.', { frame: '#ece7da', frameAccent: '#c99a1a' }, 300),
  B('b-carbonio', 'Carbonio', 'Trama nuda e rosso corsa.', { frame: '#26272b', frameAccent: '#d8262e' }, 500),
  B('b-alpino', 'Verde alpino', 'Il verde dei rifugi.', { frame: '#2f5d3a', frameAccent: '#f4f1e8' }, 400),
  B('b-celeste', 'Celeste', 'Un classico del ciclismo italiano.', { frame: '#8fd1c4', frameAccent: '#16130a' }, 450, { level: 6 }),
  B('b-arancio', 'Arancio', 'Per farsi vedere in gruppo.', { frame: '#ff7a1a', frameAccent: '#16130a' }, 300),
  B('b-oro', 'Oro massiccio', 'Il telaio dei re dei passi.', { frame: '#e0a812', frameAccent: '#16130a' }, 1800, { level: 12, rare: true }),
  // ---------- ruote ----------
  R('r-basso', 'Profilo basso', 'Leggere, da salita.', { rim: 'basso' }, 0),
  R('r-alto', 'Profilo alto', 'Cerchi da 50 mm, suonano in pianura.', { rim: 'alto' }, 500, { level: 4 }),
  R('r-lenticolare', 'Lenticolare', 'Ruota piena dietro, da cronometro.', { rim: 'lenticolare' }, 900, { level: 7 }),
];

export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export const DEFAULT_EQUIPPED: Record<Slot, string> = { maglia: 'm-orobia', casco: 'c-bianco', bici: 'b-notte', ruote: 'r-basso' };

/** I pezzi gratis senza condizioni: li ha chiunque. */
export const STARTER_ITEMS = ITEMS.filter((i) => i.price === 0 && !i.achievement && !i.series && !i.level).map((i) => i.id);

/** L'aspetto che risulta dai pezzi indossati. */
export function lookOf(equipped: Partial<Record<Slot, string>>): Look {
  let look: Look = { ...DEFAULT_LOOK };
  for (const slot of ['maglia', 'casco', 'bici', 'ruote'] as Slot[]) {
    const item = ITEM_BY_ID.get(equipped[slot] ?? DEFAULT_EQUIPPED[slot]) ?? ITEM_BY_ID.get(DEFAULT_EQUIPPED[slot]);
    if (item) look = { ...look, ...item.look };
  }
  return look;
}

export type Availability =
  | { state: 'owned' }
  | { state: 'buy'; price: number }
  | { state: 'poor'; price: number; missing: number }
  | { state: 'level'; level: number }
  | { state: 'achievement'; achievement: string }
  | { state: 'series'; series: string };

/** Si può avere? Per il negozio: comprato, da comprare, oro che manca, livello, traguardo, serie. */
export function availability(item: Item, owned: ReadonlySet<string>, oro: number, level: number): Availability {
  if (owned.has(item.id) || STARTER_ITEMS.includes(item.id)) return { state: 'owned' };
  if (item.achievement) return { state: 'achievement', achievement: item.achievement };
  if (item.series) return { state: 'series', series: item.series };
  if (item.level && level < item.level) return { state: 'level', level: item.level };
  if (oro < item.price) return { state: 'poor', price: item.price, missing: item.price - oro };
  return { state: 'buy', price: item.price };
}
