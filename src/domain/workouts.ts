import type { Workout, WorkoutStep } from './types';
import { normalizedPower, trainingStressScore } from './metrics';

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

export function builtinById(id: string): Workout | undefined {
  return BUILTIN_WORKOUTS.find((w) => w.id === id);
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
