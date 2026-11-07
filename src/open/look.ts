import * as THREE from 'three';
import { COVER } from './world';

/*
 * L'aspetto di un mondo: quello che cambia fra le Prealpi di Bergamo e le Dolomiti del
 * Sellaronda senza che cambi una riga di tiles.ts o WorldScene.tsx. Niente DOM, niente WebGL:
 * si prova in Node (tests/mondo-look.test.ts).
 *
 * - il colore della roccia (il calcare grigio delle Orobie, la dolomia chiara con le bande ocra)
 * - la linea del bosco, il prato alpino, la ghiaia sopra
 * - la linea di neve per la data, più bassa sui versanti a nord, e il ghiacciaio sempre bianco
 * - le specie degli alberi per quota, col larice che si fa d'oro in ottobre
 * - quanto lontano si vedono le cime, e quante mattonelle in più servono perché le pareti entrino
 *   prima (nelle Dolomiti si vedono da 5 km)
 * - l'archetipo delle case dei paesi (lombardo o ladino)
 *
 * S1 definisce i mondi in world.ts (`WORLDS`); qui basta `lookFor(id)`.
 */

export type WorldLookId = 'bergamo' | 'sellaronda';

export interface RockLook {
  /** la parete al sole */
  light: string;
  /** la parete in ombra, bagnata, coi licheni */
  dark: string;
  /** il ghiaione ai piedi delle pareti */
  scree: string;
  /** la ghiaia e la roccia affiorante sopra il prato alpino */
  gravel: string;
  /** le bande orizzontali (strati di 3-4 m, uno su sei più spesso): quanto si vedono, 0-1 */
  bands: number;
}

export interface WorldLook {
  id: WorldLookId;
  rock: RockLook;
  /** sotto questa quota il bosco è pieno; sopra si dirada fino a `treeLine`, dove non c'è un albero */
  forestFull: number;
  treeLine: number;
  /** fin qui il prato alpino; sopra, ghiaia e roccia */
  meadowTop: number;
  /** scostamento della linea di neve rispetto alla curva base (snowLineBase), metri */
  snowOffset: number;
  /** pendenza (gradi) oltre cui il suolo è parete di roccia, qualunque sia la quota */
  cliffDeg: number;
  /** il terreno lontano non si dimezza mai (anche in grafica bassa): l'orizzonte è il punto */
  farFine: boolean;
  /** anelli di mattonelle in più rispetto alla qualità scelta */
  ringExtra: number;
  /** archetipo delle case dei paesi */
  case: 'lombardo' | 'ladino';
  /** fin dove si legge il nome di una cima, metri */
  peakRange: number;
}

export const LOOKS: Record<WorldLookId, WorldLook> = {
  bergamo: {
    id: 'bergamo',
    // calcare grigio delle Orobie, poche bande
    rock: { light: '#9a958c', dark: '#6e6a63', scree: '#aaa59b', gravel: '#9b9566', bands: 0.35 },
    forestFull: 1750,
    treeLine: 2150,
    meadowTop: 2250,
    snowOffset: 0,
    cliffDeg: 40,
    farFine: false,
    ringExtra: 0,
    case: 'lombardo',
    peakRange: 8000,
  },
  sellaronda: {
    id: 'sellaronda',
    // dolomia: grigio chiaro 0.78/0.76/0.72 con l'ocra nelle bande, ghiaioni quasi bianchi
    rock: { light: '#c7c2b8', dark: '#8d877d', scree: '#c9c5bc', gravel: '#b5ae9f', bands: 1 },
    forestFull: 1850,
    treeLine: 2150,
    meadowTop: 2250,
    snowOffset: 0,
    cliffDeg: 38,
    farFine: true,
    ringExtra: 1,
    case: 'ladino',
    peakRange: 8000,
  },
};

/** L'aspetto di un mondo dal suo id; un id sconosciuto ha l'aspetto di Bergamo. */
export function lookFor(id: string): WorldLook {
  return LOOKS[id as WorldLookId] ?? LOOKS.bergamo;
}

// ---------- la stagione ----------

/**
 * La linea di neve nelle Alpi orientali, quota in metri per mese (indice 0 = 1º gennaio, 12 = il
 * gennaio dopo). Giugno 2600, agosto 2900, ottobre 2500, inverno 1500: fra un punto e l'altro si
 * interpola per giorno.
 */
const SNOW_BY_MONTH = [1500, 1500, 1650, 1900, 2250, 2600, 2800, 2900, 2800, 2500, 2000, 1600, 1500];

export function snowLineBase(date: Date): number {
  const m = date.getMonth();
  const days = new Date(date.getFullYear(), m + 1, 0).getDate();
  const t = (date.getDate() - 1) / days;
  return SNOW_BY_MONTH[m] + (SNOW_BY_MONTH[m + 1] - SNOW_BY_MONTH[m]) * t;
}

export function snowLine(date: Date, look: WorldLook): number {
  return snowLineBase(date) + look.snowOffset;
}

export type LarchSeason = 'verde' | 'chiaro' | 'oro' | 'spoglio';

/** Il larice: verde chiaro ad aprile-maggio, d'oro da ottobre a novembre, spoglio d'inverno. */
export function larchSeason(date: Date): LarchSeason {
  const m = date.getMonth();
  if (m >= 9 && m <= 10) return 'oro';
  if (m === 11 || m <= 2) return 'spoglio';
  if (m <= 4) return 'chiaro';
  return 'verde';
}

export const LARCH_PALETTE: Record<LarchSeason, string[]> = {
  verde: ['#5b7a3a', '#6b8a40', '#4f6e35'],
  chiaro: ['#86b055', '#97bd60', '#7aa64e'],
  oro: ['#c9962e', '#dba83a', '#b8832a', '#e0b24a'],
  spoglio: ['#7a6a57', '#6d5f4e', '#857462'],
};

export interface Season {
  /** quota della neve, prima di esposizione e rumore */
  snowLine: number;
  larch: LarchSeason;
  /** quanto il prato alpino è ocra invece che verde, 0-1 (ottobre-novembre 1, estate 0) */
  meadowOcra: number;
}

/** L'aspetto e la stagione insieme: quello che le mattonelle e il terreno lontano si passano. */
export interface LookCtx {
  look: WorldLook;
  season: Season;
}

export function lookContext(id: string, date = new Date()): LookCtx {
  const look = lookFor(id);
  return { look, season: seasonOf(date, look) };
}

export function seasonOf(date: Date, look: WorldLook): Season {
  const m = date.getMonth();
  const meadowOcra = m >= 9 && m <= 10 ? 1 : m === 8 ? 0.45 : m === 11 || m <= 3 ? 0.7 : m === 4 ? 0.3 : 0;
  return { snowLine: snowLine(date, look), larch: larchSeason(date), meadowOcra };
}

// ---------- il colore del suolo ----------

const C = {
  valley: new THREE.Color('#5d8a3c'),
  valley2: new THREE.Color('#77a04a'),
  forest: new THREE.Color('#3f6a33'),
  meadow: new THREE.Color('#729548'),
  meadowOcra: new THREE.Color('#a89a5a'),
  piste: new THREE.Color('#86a85a'),
  snow: new THREE.Color('#eef2f6'),
  glacier: new THREE.Color('#dfe9f2'),
};

const tmp = new THREE.Color();
const rockCache = new Map<string, { light: THREE.Color; dark: THREE.Color; scree: THREE.Color; gravel: THREE.Color }>();

function rockColors(look: WorldLook) {
  let r = rockCache.get(look.id);
  if (!r) {
    r = { light: new THREE.Color(look.rock.light), dark: new THREE.Color(look.rock.dark), scree: new THREE.Color(look.rock.scree), gravel: new THREE.Color(look.rock.gravel) };
    rockCache.set(look.id, r);
  }
  return r;
}

const RAD = Math.PI / 180;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface GroundSample {
  /** quanto il punto è parete di roccia, 0-1: va nell'attributo `rock` del terreno (le bande) */
  rock: number;
  /** quanto è coperto di neve, 0-1 */
  snow: number;
}

/**
 * Il colore del suolo in un punto, per quota, pendenza (ny della normale), esposizione (nzSouth:
 * la normale verso sud è positiva), rumore 0-1 e uso del suolo. La transizione prato → roccia è
 * per pendenza, non a scalini; il ghiaione sta ai piedi delle pareti (pendii di 22-34°), la neve
 * sopra la linea della stagione, più bassa a nord, poca sulle pareti verticali.
 */
export function groundLook(out: THREE.Color, look: WorldLook, season: Season, alt: number, ny: number, nzSouth: number, noise: number, cover: number): GroundSample {
  const R = rockColors(look);
  const slopeDeg = Math.acos(Math.min(1, Math.max(-1, ny))) / RAD;
  // la quota sposta la fascia: il bosco finisce dove dice il mondo
  const open = cover === COVER.open || cover === COVER.farmland || cover === COVER.park || cover === COVER.piste;
  if (cover === COVER.glacier) out.copy(C.glacier);
  else if (cover === COVER.rock) out.copy(R.gravel).lerp(R.scree, 0.3 + noise * 0.5);
  else if (alt < 1100) out.copy(C.valley).lerp(C.valley2, noise);
  else if (alt < look.forestFull) {
    out.copy(C.forest).lerp(C.valley, noise * 0.5);
    // i prati di mezza montagna restano prati
    if (open) out.lerp(C.meadow, 0.55);
  } else if (alt < look.meadowTop) {
    // il prato alpino, verde d'estate e ocra in autunno, che si dirada verso la ghiaia in alto
    out.copy(C.meadow).lerp(C.meadowOcra, season.meadowOcra * (0.55 + noise * 0.3));
    if (alt < look.forestFull + 120 && !open) out.lerp(C.forest, (1 - (alt - look.forestFull) / 120) * 0.5);
    out.lerp(R.gravel, smoothstep(look.meadowTop - 250, look.meadowTop, alt) * (0.4 + noise * 0.4));
  } else out.copy(R.gravel).lerp(R.scree, noise * 0.7);
  if (cover === COVER.piste && alt < look.meadowTop) out.lerp(C.piste, 0.5);
  // pareti ripide: roccia, qualunque sia la quota. La dolomia è chiara al sole, scura in ombra
  const cliff = smoothstep(look.cliffDeg - 9, look.cliffDeg + 4, slopeDeg);
  if (cliff > 0) {
    tmp.copy(R.light).lerp(R.dark, noise * 0.55 + (alt < 1500 ? 0.25 : 0));
    out.lerp(tmp, cliff);
  }
  // il ghiaione: ai piedi delle pareti, in alto; a mezza quota solo una traccia
  const foot = smoothstep(22, 32, slopeDeg) * (1 - cliff) * (alt > look.meadowTop - 400 ? 1 : alt > look.forestFull ? 0.45 : 0);
  if (foot > 0) out.lerp(R.scree, foot * 0.75 * (0.35 + 0.65 * noise));
  // la neve: la linea della stagione, 220 m più bassa a nord, col rumore; sulle pareti ne resta poca
  const north = Math.min(1, Math.max(0, -nzSouth * 3));
  const line = season.snowLine - 220 * north + (noise - 0.5) * 220;
  let snow = cover === COVER.glacier ? 1 : smoothstep(line - 120, line + 140, alt) * (1 - cliff * 0.75);
  if (cover === COVER.water) snow = 0;
  if (snow > 0) out.lerp(C.snow, snow * 0.95);
  return { rock: cliff * (1 - snow * 0.6), snow };
}

// ---------- gli alberi ----------

export type TreeSpecies = 'spruce' | 'larch' | 'broadleaf' | 'rock' | 'cypress';

/**
 * La specie plausibile per la quota (r: un numero 0-1 che sceglie fra le specie della fascia).
 * Nessun albero sopra `treeLine`: lì restano solo i sassi.
 */
export function treeSpecies(look: WorldLook, alt: number, r: number): TreeSpecies | null {
  if (alt >= look.treeLine) return r < 0.3 ? 'rock' : null;
  if (look.case === 'ladino') {
    // abete rosso in basso, larice più su, qualche latifoglia solo nel fondovalle
    if (alt < 1400) return r < 0.12 ? 'broadleaf' : 'spruce';
    if (alt < 1750) return r < 0.76 ? 'spruce' : 'larch';
    if (alt < 2000) return r < 0.58 ? 'larch' : r < 0.9 ? 'spruce' : 'rock';
    return r < 0.62 ? 'larch' : r < 0.78 ? 'rock' : null;
  }
  if (alt < 650) return r < 0.82 ? 'broadleaf' : r < 0.9 ? 'cypress' : 'spruce';
  if (alt < 1100) return r < 0.62 ? 'broadleaf' : 'spruce';
  if (alt < 1600) return r < 0.2 ? 'broadleaf' : r < 0.85 ? 'spruce' : 'larch';
  if (alt < 2000) return r < 0.55 ? 'spruce' : 'larch';
  return r < 0.4 ? 'larch' : r < 0.6 ? 'rock' : null;
}

/** La densità del bosco rispetto a quella piena: cala dalla linea del bosco pieno fino a zero. */
export function treeDensity(look: WorldLook, alt: number): number {
  if (alt >= look.treeLine) return 0;
  if (alt <= look.forestFull) return 1;
  const t = (alt - look.forestFull) / (look.treeLine - look.forestFull);
  return Math.max(0.08, 1 - t * t * 1.1);
}
