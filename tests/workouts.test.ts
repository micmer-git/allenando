import { describe, expect, it } from 'vitest';
import { STANDARD_AIR, type PhysicsParams } from '../src/domain/physics';
import { createTrack } from '../src/domain/track';
import { BUILTIN_WORKOUTS, stepPower, workoutAt, workoutDuration } from '../src/domain/workouts';
import { RideEngine } from '../src/sim/engine';
import type { TelemetrySource, TrainerSnapshot } from '../src/sim/source';

class FixedPower implements TelemetrySource {
  readonly mode = 'simulator' as const;
  power: number;
  hr = 140;
  cadence = 90;
  constructor(power: number) {
    this.power = power;
  }
  snapshot(): TrainerSnapshot {
    return {
      mode: 'simulator',
      deviceName: null,
      services: { ftms: false, power: false, hr: false, csc: false },
      control: 'none',
      simulation: 'none',
      status: 'idle',
      busy: false,
    };
  }
  subscribe(): () => void {
    return () => undefined;
  }
  update(): void {}
  useSimulator(): Promise<void> {
    return Promise.resolve();
  }
  connectBluetooth(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): void {}
}

const physics: PhysicsParams = {
  massKg: 83,
  cda: 0.32,
  crr: 0.004,
  ...STANDARD_AIR,
  rotatingFactor: 1,
};

describe('allenamenti e motore', () => {
  it('contiene sweet spot, VO2 5×4, soglia 2×20, fondo e rampa', () => {
    const ids = BUILTIN_WORKOUTS.map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining(['sweet-spot', 'vo2-5x4', 'threshold-2x20', 'endurance', 'ramp', 'risveglio']));
    const threshold = BUILTIN_WORKOUTS.find((w) => w.id === 'threshold-2x20')!;
    const hard = threshold.steps.filter((s) => s.powerPct === 100);
    expect(hard).toHaveLength(2);
    expect(hard.every((s) => s.durationSec === 20 * 60)).toBe(true);
    const vo2 = BUILTIN_WORKOUTS.find((w) => w.id === 'vo2-5x4')!;
    expect(vo2.steps.filter((s) => s.powerPct === 118)).toHaveLength(5);
    expect(BUILTIN_WORKOUTS.find((w) => w.id === 'ramp')?.ftpTest).toBe(true);
  });

  it('interpola una rampa e scade al termine', () => {
    const workout = {
      id: 'mini',
      builtin: false,
      kind: 'custom' as const,
      steps: [
        { id: 'a', durationSec: 10, powerPct: 50 },
        { id: 'b', durationSec: 10, powerWatts: 100, powerEndWatts: 200 },
      ],
    };
    expect(stepPower(workout.steps[1], 5, 250)).toBeCloseTo(150, 5);
    expect(workoutAt(workout, 5, 200).targetPower).toBeCloseTo(100, 5);
    expect(workoutAt(workout, 15, 200).targetPower).toBeCloseTo(150, 5);
    expect(workoutAt(workout, workoutDuration(workout), 200).finished).toBe(true);
  });

  it('il motore percorre il circuito e segue l’ERG', () => {
    const track = createTrack();
    expect(track.length).toBeCloseTo(4800, 0);
    expect(track.poseAt(0).altitude).toBeCloseTo(track.poseAt(track.length).altitude, 5);
    const grades = track.points.map((p) => Math.abs(p.grade));
    expect(Math.max(...grades)).toBeGreaterThan(0.02);
    expect(Math.max(...grades)).toBeLessThan(0.12);

    const workout = BUILTIN_WORKOUTS.find((w) => w.id === 'risveglio')!;
    const engine = new RideEngine({
      track,
      source: new FixedPower(0),
      physics,
      ftp: 200,
      maxHr: 186,
      restHr: 52,
      lthr: 166,
      weightKg: 75,
      workout,
      withCamilla: true,
      crr: 0.004,
      cw: 0.39,
    });
    engine.tick(5);
    expect(engine.mode).toBe('erg');
    expect(engine.targetPower).toBeCloseTo(100, 5);
    engine.tick(45);
    expect(engine.targetPower).toBeCloseTo(180, 5);

    const free = new RideEngine({
      track,
      source: new FixedPower(200),
      physics,
      ftp: 220,
      maxHr: 186,
      restHr: 52,
      lthr: 166,
      weightKg: 78,
      withCamilla: true,
      crr: 0.004,
      cw: 0.39,
    });
    free.tick(30);
    expect(free.distance).toBeGreaterThan(50);
    expect(free.speed).toBeGreaterThan(3);
    expect(free.samples.length).toBeGreaterThan(20);
  });
});
