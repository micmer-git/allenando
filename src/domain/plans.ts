import { loadKv, saveKv } from '@/db/db';
import { localDateKey } from './load';
import type { Ride } from './types';
import { builtinById, workoutDuration, workoutEstimate, workoutRideLink } from './workouts';

/**
 * I programmi a settimane: tre, fatti coi 33 allenamenti che ci sono, ognuno col posto dove
 * pedalarlo già scelto (un percorso del mondo o una salita). Si comincia oggi: il giorno 0 è
 * il giorno in cui lo si sceglie, le settimane sono di sette giorni da lì.
 *
 * Quello che è fatto si deduce dai giri salvati (lo stesso allenamento, quel giorno o fino a
 * due giorni dopo per recuperarlo) e si tiene in IndexedDB (`kv`, chiave `programma`), così
 * non si perde se il giro si cancella. Si può anche segnare a mano (un giro fatto fuori).
 */

export type PlanPlace = { kind: 'percorso'; ride: string } | { kind: 'salita'; route: string };

export interface PlanSession {
  /** id di un allenamento pronto; null è la prova: il percorso a tutta, contro il tuo fantasma */
  workout: string | null;
  place: PlanPlace;
}

export interface PlanWeek {
  title: string;
  /** settimana di scarico: meno carico, per assorbire le altre */
  recovery?: boolean;
  /** sette giorni dal primo della settimana; null è riposo */
  days: (PlanSession | null)[];
}

export interface TrainingPlan {
  id: string;
  name: string;
  /** a cosa serve, in una riga */
  goal: string;
  weeks: PlanWeek[];
}

/** I nomi dei posti, senza caricare il mondo (la prova li confronta con rides.json). */
export const PLACE_NAMES: Record<string, string> = {
  'citta-alta': 'Città Alta e San Vigilio',
  maresana: 'Maresana',
  selvino: 'Selvino',
  'val-seriana': 'Val Seriana',
  'colle-gallo': 'Colle Gallo',
  'val-brembana': 'Val Brembana',
  'ciclovia-brembana': 'Ciclovia della Val Brembana',
  ganda: 'Il giro della Ganda',
};

const p = (ride: string): PlanPlace => ({ kind: 'percorso', ride });
const S = (workout: string | null, ride: string): PlanSession => ({ workout, place: p(ride) });
const _ = null;

export const PLANS: TrainingPlan[] = [
  {
    id: 'primo-selvino',
    name: 'Primo Selvino',
    goal: 'In cima a Selvino da Nembro, al primo colpo',
    weeks: [
      { title: 'Le gambe', days: [S('endurance', 'val-seriana'), _, S('agilita', 'ciclovia-brembana'), _, _, S('fondo-colline', 'colle-gallo'), _] },
      { title: 'La forza', days: [S('forza-resistente', 'maresana'), _, S('sweet-spot', 'val-seriana'), _, _, S('fondo-90', 'val-brembana'), _] },
      { title: 'La soglia', days: [S('over-under-3x9', 'colle-gallo'), _, S('recupero-attivo', 'citta-alta'), _, _, S('soglia-3x12', 'selvino'), _] },
      { title: 'Selvino', days: [S('sweet-spot', 'maresana'), _, S('rifinitura', 'citta-alta'), _, _, S(null, 'selvino'), _] },
    ],
  },
  {
    id: 'base-inverno',
    name: 'Base d’inverno',
    goal: 'Fondo e tempo, per arrivare pronti a primavera',
    weeks: [
      { title: 'Il fondo', days: [S('endurance', 'val-seriana'), _, S('agilita', 'ciclovia-brembana'), _, S('tempo-3x15', 'val-brembana'), S('fondo-90', 'val-seriana'), _] },
      { title: 'La forza', days: [S('endurance', 'ciclovia-brembana'), _, S('forza-resistente', 'maresana'), _, S('tempo-60', 'val-brembana'), S('fondo-colline', 'colle-gallo'), _] },
      { title: 'Il tempo', days: [S('sweet-2x20', 'val-seriana'), _, S('agilita', 'ciclovia-brembana'), _, S('tempo-lungo', 'val-brembana'), S('fondo-lungo-acc', 'val-seriana'), _] },
      { title: 'Scarico', recovery: true, days: [S('recupero-attivo', 'citta-alta'), _, S('endurance', 'ciclovia-brembana'), _, _, S('scarico-45', 'val-seriana'), _] },
      { title: 'Sweet spot', days: [S('sweet-3x15', 'val-seriana'), _, S('forza-resistente', 'selvino'), _, S('tempo-lungo', 'val-brembana'), S('fondo-lungo-acc', 'ganda'), _] },
      { title: 'Più lungo', days: [S('sweet-4x12', 'val-brembana'), _, S('agilita', 'ciclovia-brembana'), _, S('over-under-3x9', 'colle-gallo'), S('fondo-90', 'ganda'), _] },
    ],
  },
  {
    id: 'pronti-ganda',
    name: 'Pronti per la Ganda',
    goal: 'Il giro della Ganda col tuo tempo migliore',
    weeks: [
      { title: 'Soglia', days: [S('soglia-3x12', 'selvino'), _, S('endurance', 'val-seriana'), _, S('agilita', 'ciclovia-brembana'), S('fondo-lungo-acc', 'ganda'), _] },
      { title: 'Sopra la soglia', days: [S('over-under-4x8', 'selvino'), _, S('recupero-attivo', 'citta-alta'), _, S('vo2-6x3', 'maresana'), S('fondo-90', 'ganda'), _] },
      { title: 'Il ritmo', days: [S('soglia-4x10', 'colle-gallo'), _, S('endurance', 'val-seriana'), _, S('agilita', 'ciclovia-brembana'), S('simulazione-gara', 'ganda'), _] },
      { title: 'La Ganda', days: [S('vo2-4x5', 'colle-gallo'), _, S('recupero-attivo', 'citta-alta'), _, S('rifinitura', 'citta-alta'), S(null, 'ganda'), _] },
    ],
  },
];

export function planById(id: string): TrainingPlan | undefined {
  return PLANS.find((x) => x.id === id);
}

/** Il link della pedalata: allenamento e posto insieme; la prova è il percorso senza schema. */
export function sessionLink(s: PlanSession): string {
  if (s.workout) return workoutRideLink(s.workout, s.place.kind === 'percorso' ? { kind: 'percorso', ride: s.place.ride } : { kind: 'salita', route: s.place.route });
  return s.place.kind === 'percorso' ? `/ride?world=bergamo&ride=${s.place.ride}` : `/ride?route=${s.place.route}`;
}

export function placeName(place: PlanPlace): string {
  return place.kind === 'percorso' ? (PLACE_NAMES[place.ride] ?? place.ride) : place.route;
}

/** Durata in secondi (null per la prova: dura quanto ci metti). */
export function sessionDuration(s: PlanSession): number | null {
  const w = s.workout ? builtinById(s.workout) : undefined;
  return w ? workoutDuration(w) : null;
}

/** Il carico di ogni settimana (TSS a una FTP qualsiasi: conta il confronto). La prova vale 80. */
export function weekLoads(plan: TrainingPlan, ftp = 250): number[] {
  return plan.weeks.map((w) =>
    w.days.reduce((sum, d) => {
      if (!d) return sum;
      const wo = d.workout ? builtinById(d.workout) : undefined;
      return sum + (wo ? workoutEstimate(wo, ftp).tss : 80);
    }, 0),
  );
}

// ---------- il calendario ----------

export interface PlanState {
  v: 1;
  id: string;
  /** il giorno 0, data locale YYYY-MM-DD */
  start: string;
  /** giorno del programma → id del giro che l'ha fatto, o «a-mano» */
  done: Record<number, string>;
}

/** Giorni fra due date locali (YYYY-MM-DD), senza farsi ingannare dall'ora legale. */
export function daysBetween(a: string, b: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + n));
}

export type DayStatus = 'fatto' | 'oggi' | 'saltato' | 'futuro' | 'riposo';

export interface PlanDay {
  index: number;
  week: number;
  date: string;
  session: PlanSession | null;
  status: DayStatus;
}

export function planLength(plan: TrainingPlan): number {
  return plan.weeks.length * 7;
}

export function sessionAt(plan: TrainingPlan, index: number): PlanSession | null {
  if (index < 0 || index >= planLength(plan)) return null;
  return plan.weeks[Math.floor(index / 7)].days[index % 7] ?? null;
}

/** Tutti i giorni del programma, con lo stato visto da `today`. */
export function planDays(plan: TrainingPlan, state: PlanState, today: string): PlanDay[] {
  const now = daysBetween(state.start, today);
  const out: PlanDay[] = [];
  for (let i = 0; i < planLength(plan); i++) {
    const session = sessionAt(plan, i);
    const status: DayStatus = !session ? 'riposo' : state.done[i] ? 'fatto' : i === now ? 'oggi' : i < now ? 'saltato' : 'futuro';
    out.push({ index: i, week: Math.floor(i / 7), date: addDays(state.start, i), session, status });
  }
  return out;
}

/** Fino a quanti giorni dopo un allenamento saltato si può recuperare. */
export const CATCH_UP_DAYS = 2;

export type Today =
  | { kind: 'sessione'; day: PlanDay; catchUp: boolean }
  | { kind: 'fatto'; day: PlanDay; next: PlanDay | null }
  | { kind: 'riposo'; next: PlanDay | null }
  | { kind: 'finito' };

/**
 * Cosa dice Oggi. L'allenamento del giorno, se c'è e non è fatto. In un giorno di riposo,
 * quello saltato negli ultimi due giorni (si recupera). Altrimenti riposo, e il prossimo.
 */
export function todayOf(plan: TrainingPlan, state: PlanState, today: string): Today {
  const days = planDays(plan, state, today);
  const now = daysBetween(state.start, today);
  if (now >= days.length) return { kind: 'finito' };
  const next = (from: number) => days.find((d) => d.index > from && d.session && d.status !== 'fatto') ?? null;
  const day = now >= 0 ? days[now] : null;
  if (day?.session) return day.status === 'fatto' ? { kind: 'fatto', day, next: next(now) } : { kind: 'sessione', day, catchUp: false };
  for (let back = 1; back <= CATCH_UP_DAYS; back++) {
    const d = days[now - back];
    if (d?.session && d.status === 'saltato') return { kind: 'sessione', day: d, catchUp: true };
  }
  return { kind: 'riposo', next: next(Math.max(-1, now)) };
}

/** Il giro fa quella seduta? Lo stesso allenamento; per la prova, il percorso finito. */
function rideMatches(ride: Ride, s: PlanSession): boolean {
  if (s.workout) return ride.workoutId === s.workout;
  return s.place.kind === 'percorso' ? ride.routeId === `bergamo:${s.place.ride}` : ride.routeId === s.place.route;
}

/**
 * Segna fatte le sedute che i giri raccontano: il giorno stesso, o fino a due giorni dopo per
 * una saltata. Restituisce lo stato nuovo (lo stesso oggetto se non cambia niente).
 */
export function syncDone(plan: TrainingPlan, state: PlanState, rides: readonly Ride[]): PlanState {
  let done: Record<number, string> | null = null;
  const used = new Set(Object.values(state.done));
  const sorted = [...rides].sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
  for (const ride of sorted) {
    if (used.has(ride.id)) continue;
    const day = daysBetween(state.start, localDateKey(new Date(ride.startTime)));
    if (day < 0 || day >= planLength(plan)) continue;
    // prima il giorno stesso, poi i giorni prima (il recupero), il più recente per primo
    for (let back = 0; back <= CATCH_UP_DAYS; back++) {
      const i = day - back;
      const s = sessionAt(plan, i);
      const cur = done ?? state.done;
      if (!s || cur[i] || !rideMatches(ride, s)) continue;
      done = { ...(done ?? state.done), [i]: ride.id };
      used.add(ride.id);
      break;
    }
  }
  return done ? { ...state, done } : state;
}

export function startPlan(id: string, today: string): PlanState {
  return { v: 1, id, start: today, done: {} };
}

export function markDone(state: PlanState, index: number): PlanState {
  return { ...state, done: { ...state.done, [index]: 'a-mano' } };
}

export function progressOf(plan: TrainingPlan, state: PlanState): { done: number; total: number } {
  let total = 0;
  let done = 0;
  for (let i = 0; i < planLength(plan); i++) {
    if (!sessionAt(plan, i)) continue;
    total++;
    if (state.done[i]) done++;
  }
  return { done, total };
}

// ---------- in IndexedDB ----------

const KEY = 'programma';

export async function loadPlanState(): Promise<PlanState | null> {
  const s = await loadKv<PlanState | null>(KEY);
  return s && s.v === 1 && planById(s.id) ? s : null;
}

export async function savePlanState(s: PlanState | null): Promise<void> {
  await saveKv(KEY, s);
}
