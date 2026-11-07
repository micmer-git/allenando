import type { RideFacts } from './career';

/**
 * Tre missioni al giorno, le stesse per tutti in quel giorno (dipendono solo dalla data).
 * Si completano in un giro solo: sono piccole apposta, per dare un motivo a uscire oggi.
 */

export interface Mission {
  id: string;
  title: string;
  oro: number;
  check: (f: RideFacts) => boolean;
}

const POOL: Mission[] = [
  { id: 'km-10', title: 'Pedala 10 km', oro: 40, check: (f) => f.distanceM >= 10_000 },
  { id: 'km-25', title: 'Pedala 25 km', oro: 80, check: (f) => f.distanceM >= 25_000 },
  { id: 'min-30', title: 'Mezz’ora in sella', oro: 40, check: (f) => f.durationSec >= 1800 },
  { id: 'min-60', title: 'Un’ora in sella', oro: 70, check: (f) => f.durationSec >= 3600 },
  { id: 'su-200', title: 'Sali 200 metri', oro: 50, check: (f) => f.gainM >= 200 },
  { id: 'su-500', title: 'Sali 500 metri', oro: 90, check: (f) => f.gainM >= 500 },
  { id: 'volata', title: 'Tira una volata', oro: 50, check: (f) => f.segments.some((s) => s.kind === 'volata' || s.kind === 'cassonetto') },
  { id: 'gpm', title: 'Prendi un GPM', oro: 60, check: (f) => f.segments.some((s) => s.kind === 'gpm') },
  { id: 'crono', title: 'Fai una crono', oro: 70, check: (f) => f.segments.some((s) => s.kind === 'crono') },
  { id: 'tre-tratti', title: 'Tre tratti cronometrati', oro: 80, check: (f) => f.segments.length >= 3 },
  { id: 'punti', title: 'Passa da 3 punti caldi', oro: 50, check: (f) => f.pois.length >= 3 },
  { id: 'luoghi', title: 'Passa da 4 luoghi del mondo', oro: 50, check: (f) => new Set(f.landmarks).size >= 4 },
  { id: 'sessione', title: 'Finisci una sessione', oro: 80, check: (f) => !!f.session?.finished },
  { id: 'soglia', title: '5 minuti alla FTP', oro: 70, check: (f) => f.ftp > 0 && f.peak5min >= f.ftp },
  { id: 'scatto', title: 'Uno scatto oltre 1,5 volte la FTP', oro: 40, check: (f) => f.ftp > 0 && f.peak5s >= 1.5 * f.ftp },
  { id: 'percorso', title: 'Finisci un percorso del mondo', oro: 80, check: (f) => !!f.worldRideDone },
];

/**
 * Una serie: missioni a tappe, nell'ordine, che restano fatte da un giorno all'altro. Finita la
 * serie arriva un pezzo del guardaroba (kit.ts, `series`). La prima è il Sellaronda: tre passi
 * uno per volta, poi il giro intero. I percorsi e i luoghi sono quelli della pista S1
 * (`sella-canazei`, `pordoi-arabba`…, luoghi `passo-sella`…): si contano sia col percorso finito
 * sia passando dal passo in un giro qualunque.
 */
export interface SeriesStep {
  id: string;
  title: string;
  oro: number;
  check: (f: RideFacts) => boolean;
}

export interface MissionSeries {
  id: string;
  name: string;
  /** in una riga: perché farla */
  blurb: string;
  /** il mondo in cui si fa */
  world: string;
  steps: SeriesStep[];
  /** oro alla fine della serie, oltre alla maglia */
  oro: number;
}

const passOrRide = (pass: string, rides: string[]) => (f: RideFacts) => f.landmarks.includes(pass) || (!!f.worldRideDone && rides.includes(f.worldRideDone));

export const SERIES: MissionSeries[] = [
  {
    id: 'sellaronda',
    name: 'Sellaronda',
    blurb: 'Tre passi uno alla volta, poi il giro intero: la maglia Sella.',
    world: 'sellaronda',
    oro: 300,
    steps: [
      { id: 'sella', title: 'Passo Sella', oro: 60, check: passOrRide('passo-sella', ['sella-canazei']) },
      { id: 'pordoi', title: 'Passo Pordoi', oro: 60, check: passOrRide('passo-pordoi', ['pordoi-arabba', 'pordoi-canazei']) },
      { id: 'gardena', title: 'Passo Gardena', oro: 60, check: passOrRide('passo-gardena', ['gardena-corvara', 'gardena-selva']) },
      { id: 'giro', title: 'Il giro intero', oro: 120, check: (f) => f.worldRideDone === 'sellaronda' || f.worldRideDone === 'sellaronda-orario' },
    ],
  },
];

export const SERIES_BY_ID = new Map(SERIES.map((s) => [s.id, s]));

/**
 * Fa avanzare una serie con un giro: le tappe si prendono nell'ordine, ma un giro che ne vale
 * più d'una (il Sellaronda intero passa da tutti i passi) le prende tutte. Ritorna le tappe
 * nuove e se la serie si è chiusa adesso.
 */
export function advanceSeries(series: MissionSeries, done: readonly string[], f: RideFacts): { done: string[]; fresh: SeriesStep[]; completed: boolean } {
  const next = [...done];
  const fresh: SeriesStep[] = [];
  for (const step of series.steps) {
    if (next.includes(step.id)) continue;
    if (!step.check(f)) break;
    next.push(step.id);
    fresh.push(step);
  }
  const all = series.steps.every((s) => next.includes(s.id));
  return { done: next, fresh, completed: all && fresh.length > 0 };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Le tre missioni del giorno `day` (AAAA-MM-GG): tre diverse, mai due dello stesso tipo. */
export function missionsFor(day: string): Mission[] {
  const out: Mission[] = [];
  const used = new Set<string>();
  let h = hash(day);
  for (let guard = 0; out.length < 3 && guard < 50; guard++) {
    const m = POOL[h % POOL.length];
    const family = m.id.split('-')[0];
    if (!used.has(family)) {
      used.add(family);
      out.push(m);
    }
    h = hash(`${day}:${h}`);
  }
  return out;
}
