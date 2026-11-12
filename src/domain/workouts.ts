import type { Workout, WorkoutStep } from './types';
import { normalizedPower, trainingStressScore } from './metrics';
import { WORLD_ID, worldOfRide } from '@/multiplayer/world-rides';
import type { Dove } from '@/ride/contract';
import { intentoDaSearch, intentoInSearch } from '@/ride/intento';

export function stepPower(step: WorkoutStep, intoSec: number, ftp: number): number {
  const start =
    step.powerWatts != null ? step.powerWatts : ((step.powerPct ?? 0) / 100) * ftp;
  const end =
    step.powerEndWatts != null
      ? step.powerEndWatts
      : step.powerEndPct != null
        ? (step.powerEndPct / 100) * ftp
        : start;
  if (!(step.durationSec > 0) || start === end) return start;
  const u = Math.min(1, Math.max(0, intoSec / step.durationSec));
  return start + (end - start) * u;
}

export function workoutDuration(workout: Workout): number {
  return workout.steps.reduce((s, step) => s + step.durationSec, 0);
}

export function workoutPowerSeries(workout: Workout, ftp: number): number[] {
  const out: number[] = [];
  for (const step of workout.steps) {
    const n = Math.max(1, Math.round(step.durationSec));
    for (let i = 0; i < n; i++) out.push(stepPower(step, i, ftp));
  }
  return out;
}

export function workoutEstimate(workout: Workout, ftp: number): { durationSec: number; np: number; tss: number; if: number } {
  const series = workoutPowerSeries(workout, ftp);
  const durationSec = workoutDuration(workout);
  const np = normalizedPower(series);
  const tss = trainingStressScore(durationSec, np, ftp);
  return { durationSec, np, tss, if: ftp > 0 ? np / ftp : 0 };
}

export interface WorkoutProgress {
  stepIndex: number;
  stepElapsed: number;
  stepRemaining: number;
  targetPower: number;
  finished: boolean;
  total: number;
}

export function workoutAt(workout: Workout, elapsed: number, ftp: number): WorkoutProgress {
  const total = workoutDuration(workout);
  let t = 0;
  for (let i = 0; i < workout.steps.length; i++) {
    const step = workout.steps[i];
    if (elapsed < t + step.durationSec || i === workout.steps.length - 1) {
      const into = Math.min(step.durationSec, Math.max(0, elapsed - t));
      const finished = elapsed >= total;
      return {
        stepIndex: i,
        stepElapsed: into,
        stepRemaining: Math.max(0, step.durationSec - into),
        targetPower: finished ? 0 : stepPower(step, into, ftp),
        finished,
        total,
      };
    }
    t += step.durationSec;
  }
  return { stepIndex: 0, stepElapsed: 0, stepRemaining: 0, targetPower: 0, finished: true, total };
}

function step(partial: Omit<WorkoutStep, 'id'> & { id?: string }): WorkoutStep {
  return { id: partial.id ?? partial.name ?? `s-${partial.durationSec}-${partial.powerPct ?? partial.powerWatts}`, ...partial };
}

function rampSteps(): WorkoutStep[] {
  const steps: WorkoutStep[] = [
    step({ name: 'warmup', durationSec: 180, powerWatts: 80 }),
  ];
  for (let i = 0; i < 18; i++) {
    steps.push(step({ name: `ramp-${i}`, durationSec: 60, powerWatts: 100 + i * 20 }));
  }
  return steps;
}

export const BUILTIN_WORKOUTS: Workout[] = [
  {
    id: 'risveglio',
    nameKey: 'workouts.opener.name',
    descriptionKey: 'workouts.opener.description',
    builtin: true,
    kind: 'opener',
    steps: [
      step({ name: 'spin', durationSec: 40, powerPct: 50 }),
      step({ name: 'sweet', durationSec: 50, powerPct: 90 }),
      step({ name: 'vo2', durationSec: 40, powerPct: 120 }),
      step({ name: 'easy', durationSec: 40, powerPct: 50 }),
    ],
  },
  {
    id: 'endurance',
    nameKey: 'workouts.endurance.name',
    descriptionKey: 'workouts.endurance.description',
    builtin: true,
    kind: 'endurance',
    steps: [
      step({ name: 'warmup', durationSec: 5 * 60, powerPct: 50 }),
      step({ name: 'steady', durationSec: 45 * 60, powerPct: 65 }),
      step({ name: 'cooldown', durationSec: 5 * 60, powerPct: 45 }),
    ],
  },
  {
    id: 'sweet-spot',
    nameKey: 'workouts.sweet.name',
    descriptionKey: 'workouts.sweet.description',
    builtin: true,
    kind: 'sweetspot',
    steps: [
      step({ name: 'warmup', durationSec: 10 * 60, powerPct: 50 }),
      ...repeat(3, (i) => [
        step({ name: `ss-${i}`, durationSec: 8 * 60, powerPct: 90 }),
        step({ name: `rec-${i}`, durationSec: 4 * 60, powerPct: 55 }),
      ]).flat(),
      step({ name: 'cooldown', durationSec: 8 * 60, powerPct: 45 }),
    ],
  },
  {
    id: 'vo2-5x4',
    nameKey: 'workouts.vo2.name',
    descriptionKey: 'workouts.vo2.description',
    builtin: true,
    kind: 'vo2',
    steps: [
      step({ name: 'warmup', durationSec: 12 * 60, powerPct: 55 }),
      ...repeat(5, (i) => [
        step({ name: `vo2-${i}`, durationSec: 4 * 60, powerPct: 118 }),
        step({ name: `rec-${i}`, durationSec: 4 * 60, powerPct: 50 }),
      ]).flat(),
      step({ name: 'cooldown', durationSec: 8 * 60, powerPct: 45 }),
    ],
  },
  {
    id: 'threshold-2x20',
    nameKey: 'workouts.threshold.name',
    descriptionKey: 'workouts.threshold.description',
    builtin: true,
    kind: 'threshold',
    steps: [
      step({ name: 'warmup', durationSec: 10 * 60, powerPct: 50 }),
      step({ name: 'opener', durationSec: 5 * 60, powerPct: 75 }),
      step({ name: 't1', durationSec: 20 * 60, powerPct: 100 }),
      step({ name: 'rest', durationSec: 5 * 60, powerPct: 55 }),
      step({ name: 't2', durationSec: 20 * 60, powerPct: 100 }),
      step({ name: 'cooldown', durationSec: 10 * 60, powerPct: 45 }),
    ],
  },
  {
    id: 'ramp',
    nameKey: 'workouts.ramp.name',
    descriptionKey: 'workouts.ramp.description',
    builtin: true,
    kind: 'ramp',
    ftpTest: true,
    steps: rampSteps(),
  },
];

function repeat<T>(n: number, fn: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => fn(i));
}

// ---------- la libreria lunga: da mezz'ora a due ore ----------

/** Un blocco: secondi, % FTP (e % finale se è una rampa), nome del tipo, cadenza. */
interface Block {
  s: number;
  p: number;
  e?: number;
  n?: 'warmup' | 'cooldown' | 'rec' | 'work' | 'z2' | 'acc' | 'spin';
  c?: number;
}

const min = (m: number) => Math.round(m * 60);
const W = (m: number, from = 45, to = 70): Block => ({ s: min(m), p: from, e: to, n: 'warmup' });
const C = (m: number, from = 60, to = 40): Block => ({ s: min(m), p: from, e: to, n: 'cooldown' });
const R = (m: number, p = 55, c?: number): Block => ({ s: min(m), p, n: 'rec', c });
const Z = (m: number, p = 67, c?: number): Block => ({ s: min(m), p, n: 'z2', c });
const L = (m: number, p: number, c?: number): Block => ({ s: min(m), p, n: 'work', c });
const S = (sec: number, p: number): Block => ({ s: sec, p, n: 'work' });

/** Ripete un gruppo di blocchi `n` volte; l'ultimo recupero (se `drop`) si toglie. */
function reps(n: number, group: Block[], drop = true): Block[] {
  const out = repeat(n, () => group).flat();
  return drop && out[out.length - 1]?.n === 'rec' ? out.slice(0, -1) : out;
}

/** Dai blocchi ai passi, con nomi unici (warmup, work, work-1, rec, rec-1…). */
function build(blocks: Block[]): WorkoutStep[] {
  const seen = new Map<string, number>();
  return blocks.map((b) => {
    const base = b.n ?? 'work';
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    const name = k ? `${base}-${k}` : base;
    const st: WorkoutStep = { id: name, name, durationSec: b.s, powerPct: b.p };
    if (b.e != null) st.powerEndPct = b.e;
    if (b.c) st.cadence = b.c;
    return st;
  });
}

function lib(id: string, name: string, description: string, kind: Workout['kind'], blocks: Block[]): Workout {
  return { id, name, description, builtin: true, kind, steps: build(blocks) };
}

/** La libreria lunga: fondo, tempo, sweet spot, soglia, over-under, VO2, piramidi, sprint, cadenza, gara, recupero. */
export const LIBRARY_WORKOUTS: Workout[] = [
  lib('fondo-lungo-acc', 'Fondo lungo con accelerazioni', 'Due ore in zona 2, con sei accelerazioni da 20″ per svegliare le gambe.', 'endurance', [
    W(12),
    ...reps(6, [Z(15 + 40 / 60, 68), { s: 20, p: 130, n: 'acc' }], false),
    C(12),
  ]),
  lib('fondo-90', 'Fondo, novanta minuti', 'Settanta minuti regolari al 67%: la base di tutto.', 'endurance', [W(10), Z(70, 67), C(10)]),
  lib('fondo-colline', 'Fondo con colline', 'Cinque strappi da 3′ all’85% dentro il fondo, come le salitelle di valle.', 'endurance', [W(10), ...reps(5, [Z(8, 68), L(3, 85)], false), C(10)]),
  lib('tempo-lungo', 'Tempo lungo', 'Tre volte 25′ al 78%: il passo da granfondo, per due ore.', 'tempo', [W(15), ...reps(3, [L(25, 78), R(5, 60)]), Z(5, 65), C(10)]),
  lib('tempo-3x15', 'Tempo 3×15′', 'Tre blocchi all’82% con 5′ facili in mezzo.', 'tempo', [W(12), ...reps(3, [L(15, 82), R(5, 58)]), C(8)]),
  lib('tempo-60', 'Un’ora di tempo', 'Sessanta minuti filati all’80%. Testa e regolarità.', 'tempo', [W(10), L(60, 80), C(10)]),
  lib('sweet-2x20', 'Sweet spot 2×20′', 'Due volte venti minuti al 90%: tanto lavoro, poca fatica da smaltire.', 'sweetspot', [W(10), ...reps(2, [L(20, 90), R(5)]), C(10)]),
  lib('sweet-3x15', 'Sweet spot 3×15′', 'Tre blocchi al 90% e una chiusura in fondo.', 'sweetspot', [W(12), ...reps(3, [L(15, 90), R(5)]), Z(5, 65), C(8)]),
  lib('sweet-4x12', 'Sweet spot 4×12′', 'Quattro blocchi al 92%, recupero breve: un’ora e mezza densa.', 'sweetspot', [W(12), ...reps(4, [L(12, 92), R(4)]), Z(14, 66), C(10)]),
  lib('soglia-3x12', 'Soglia 3×12′', 'Tre volte dodici minuti alla FTP, cinque di recupero.', 'threshold', [W(12), ...reps(3, [L(12, 100), R(5)]), C(12)]),
  lib('soglia-4x10', 'Soglia 4×10′', 'Quattro blocchi appena sopra la FTP.', 'threshold', [W(10), ...reps(4, [L(10, 102), R(4)]), C(13)]),
  lib('soglia-lunga', 'Soglia lunga 2×30′', 'Due mezz’ore al 95%: per chi prepara una cronoscalata.', 'threshold', [W(15), ...reps(2, [L(30, 95), R(8)]), Z(10, 65), C(10)]),
  lib('over-under-3x9', 'Over-under 3×9′', 'Due minuti al 95% e uno al 105%, tre volte per blocco: si impara a stare sopra soglia.', 'threshold', [
    W(15),
    ...reps(3, [...reps(3, [L(2, 95), L(1, 105)], false), R(5)]),
    C(13),
  ]),
  lib('over-under-4x8', 'Over-under 4×8′', 'Un minuto al 110% e uno al 90%, quattro volte per blocco.', 'threshold', [
    W(15),
    ...reps(4, [...reps(4, [L(1, 110), L(1, 90)], false), R(4)]),
    C(11),
  ]),
  lib('vo2-30-30', 'VO2max 30/30', 'Tre serie da dieci: 30″ al 125%, 30″ facili.', 'vo2', [
    W(12),
    ...reps(3, [...reps(10, [S(30, 125), { s: 30, p: 50, n: 'rec' }], false), R(5)]),
    C(8),
  ]),
  lib('vo2-4x5', 'VO2max 4×5′', 'Quattro ripetute da 5′ al 112%, recupero pari.', 'vo2', [W(15), ...reps(4, [L(5, 112), R(5, 50)]), C(10)]),
  lib('vo2-6x3', 'VO2max 6×3′', 'Sei volte tre minuti al 120%: corte e cattive.', 'vo2', [W(12), ...reps(6, [L(3, 120), R(3, 50)]), C(10)]),
  lib('piramide', 'Piramide 1-2-3-4-3-2-1', 'Su e giù al 110%, recupero lungo quanto lo sforzo.', 'vo2', [W(15), ...reps(1, [1, 2, 3, 4, 3, 2, 1].flatMap((m) => [L(m, 110), R(m, 50)])), C(14)]),
  lib('piramide-soglia', 'Piramide di soglia', 'Cinque, dieci, quindici, dieci, cinque minuti fra il 95 e il 100%.', 'threshold', [
    W(12),
    ...reps(1, [5, 10, 15, 10, 5].flatMap((m) => [L(m, m === 15 ? 95 : m === 10 ? 97 : 100), R(4)])),
    C(12),
  ]),
  lib('sprint-10x15', 'Sprint 10×15″', 'Due serie da cinque sprint al doppio della FTP, recupero completo.', 'sprint', [
    W(15),
    ...reps(2, [...reps(5, [S(15, 200), { s: 165, p: 50, n: 'rec' }], false), R(5)]),
    C(10),
  ]),
  lib('volate-lanciate', 'Volate lanciate', 'Un minuto di lancio all’85%, poi 20″ a tutta: sei volte.', 'sprint', [W(12), ...reps(6, [L(1, 85), S(20, 180), R(3 + 40 / 60, 50)]), C(8)]),
  lib('agilita', 'Agilità', 'Frulla: due minuti a 110 rpm, poi uno a 120. Watt bassi, gambe veloci.', 'cadence', [
    W(8),
    ...reps(6, [L(2, 70, 110), R(2, 60, 90)], false),
    ...reps(4, [L(1, 65, 120), R(1, 55, 90)]),
    C(5),
  ]),
  lib('forza-resistente', 'Forza resistente', 'Cinque blocchi da 5′ all’85% a 55 rpm: la salita senza la salita.', 'cadence', [W(12), ...reps(5, [L(5, 85, 55), R(3, 55, 90)]), C(11)]),
  lib('rifinitura', 'Rifinitura pre-gara', 'Quaranta minuti per arrivare freschi: qualche apertura, niente fatica.', 'race', [
    W(12, 50, 70),
    L(3, 90),
    R(3),
    ...reps(3, [L(1, 115), R(2)], false),
    ...reps(2, [S(10, 180), R(1 + 50 / 60, 50)], false),
    C(9),
  ]),
  lib('simulazione-gara', 'Simulazione di gara', 'Novanta minuti con gli scatti, il forcing e la volata finale.', 'race', [
    W(15),
    Z(25, 75),
    ...reps(3, [L(2, 115), R(3, 65)], false),
    L(10, 90),
    ...reps(5, [S(30, 150), R(1.5, 60)], false),
    Z(5, 65),
    C(10),
  ]),
  lib('recupero-attivo', 'Recupero attivo', 'Mezz’ora facile a cadenza alta, per smaltire.', 'recovery', [W(5, 40, 50), Z(20, 52, 95), C(5, 50, 40)]),
  lib('scarico-45', 'Scarico', 'Tre quarti d’ora sotto il 60%, il giorno dopo la fatica.', 'recovery', [W(5, 40, 55), Z(35, 57), C(5, 50, 40)]),
];

/** Tutti gli allenamenti pronti: i sei di sempre e la libreria lunga. */
export const ALL_BUILTIN: Workout[] = [...BUILTIN_WORKOUTS, ...LIBRARY_WORKOUTS];

export function builtinById(id: string): Workout | undefined {
  return ALL_BUILTIN.find((w) => w.id === id);
}

export function findWorkout(id: string, custom: Workout[]): Workout | undefined {
  return builtinById(id) ?? custom.find((w) => w.id === id);
}

export function duplicateWorkout(workout: Workout, displayName: string): Workout {
  return {
    ...workout,
    id: crypto.randomUUID(),
    builtin: false,
    kind: 'custom',
    name: displayName,
    description: workout.description,
    nameKey: undefined,
    descriptionKey: undefined,
    ftpTest: workout.ftpTest,
    steps: workout.steps.map((s) => ({ ...s, id: crypto.randomUUID() })),
  };
}

export function emptyWorkout(): Workout {
  return {
    id: crypto.randomUUID(),
    builtin: false,
    kind: 'custom',
    name: '',
    description: '',
    steps: [{ id: crypto.randomUUID(), durationSec: 60, powerPct: 60 }],
  };
}

// ---------- dove pedalarlo, e i filtri della pagina ----------

/** Dove si pedala un allenamento: una salita verificata, un percorso del mondo, il giro libero da un paese, un anello. */
export type WorkoutPlace =
  | { kind: 'salita'; route: string }
  /** `world`: il mondo del percorso; senza, Bergamo */
  | { kind: 'percorso'; ride: string; world?: string }
  /** `query`: i parametri del punto di partenza nel mondo (world=…&edge=…&s=…&dir=… oppure world=…&plan=…) */
  | { kind: 'libero' | 'anello'; query: string };

/** Il link della pedalata: l'allenamento e il posto insieme. */
export function workoutRideLink(id: string, place: WorkoutPlace): string {
  let dove: Dove | null;
  if (place.kind === 'salita') dove = { kind: 'salita', route: place.route };
  else if (place.kind === 'percorso') dove = { kind: 'percorso', world: place.world ?? worldOfRide(place.ride) ?? WORLD_ID, ride: place.ride };
  else dove = intentoDaSearch(new URLSearchParams(place.query))?.dove ?? null;
  // un posto illeggibile: l'allenamento sulla salita di sempre
  return `/ride?${intentoInSearch({ dove: dove ?? { kind: 'salita', route: 'selvino-nembro' }, tipo: 'allenamento', workout: id })}`;
}

/**
 * «Una salita di 30 minuti» dal mondo attivo (F.15): fra i percorsi in salita quello che, a una
 * velocità da rullo (18 km/h in piano, meno con la pendenza), dura quanto l'allenamento. Se
 * nessuno ci si avvicina (entro il 40%) ritorna null e si resta dove si era.
 */
export function climbForMinutes(rides: readonly { id: string; kind: string; lengthM: number; climbGrade: number }[], minutes: number): string | null {
  let best: string | null = null;
  let bestErr = Infinity;
  for (const r of rides) {
    if (r.kind !== 'salita') continue;
    const kmh = Math.max(7, 18 - r.climbGrade * 100 * 1.6);
    const min = r.lengthM / 1000 / kmh * 60;
    const err = Math.abs(min - minutes) / Math.max(1, minutes);
    if (err < bestErr) {
      bestErr = err;
      best = r.id;
    }
  }
  return bestErr <= 0.4 ? best : null;
}

/** I tipi del filtro, ognuno coi suoi `kind`. */
export const WORKOUT_TYPES: { id: string; label: string; kinds: Workout['kind'][] }[] = [
  { id: 'tutti', label: 'Tutti', kinds: [] },
  { id: 'fondo', label: 'Fondo', kinds: ['endurance', 'recovery'] },
  { id: 'tempo', label: 'Tempo', kinds: ['tempo', 'sweetspot'] },
  { id: 'soglia', label: 'Soglia', kinds: ['threshold'] },
  { id: 'vo2', label: 'VO2max', kinds: ['vo2'] },
  { id: 'sprint', label: 'Sprint', kinds: ['sprint'] },
  { id: 'cadenza', label: 'Cadenza', kinds: ['cadence'] },
  { id: 'gara', label: 'Gara e test', kinds: ['race', 'opener', 'ramp'] },
];

export const WORKOUT_KIND_LABEL: Record<Workout['kind'], string> = {
  endurance: 'Fondo',
  recovery: 'Recupero',
  tempo: 'Tempo',
  sweetspot: 'Sweet spot',
  threshold: 'Soglia',
  vo2: 'VO2max',
  sprint: 'Sprint',
  cadence: 'Cadenza',
  race: 'Gara',
  ramp: 'Test',
  opener: 'Attivazione',
  custom: 'Tuo',
};

/** Le fasce di durata del filtro, in minuti: [da, a). */
export const DURATION_BANDS: { id: string; label: string; from: number; to: number }[] = [
  { id: 'tutte', label: 'Tutte', from: 0, to: Infinity },
  { id: 'corti', label: 'Fino a 45′', from: 0, to: 46 },
  { id: 'medi', label: '45–75′', from: 46, to: 76 },
  { id: 'lunghi', label: 'Oltre 75′', from: 76, to: Infinity },
];

export function filterWorkouts(list: Workout[], type: string, band: string): Workout[] {
  const t = WORKOUT_TYPES.find((x) => x.id === type);
  const b = DURATION_BANDS.find((x) => x.id === band) ?? DURATION_BANDS[0];
  return list.filter((w) => {
    const m = workoutDuration(w) / 60;
    return (!t || t.kinds.length === 0 || t.kinds.includes(w.kind)) && m >= b.from && m < b.to;
  });
}
