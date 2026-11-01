import { buildRide } from '@/domain/metrics';
import { estimateFtpFromRamp } from '@/domain/metrics';
import { stepSpeed, type PhysicsParams } from '@/domain/physics';
import type { Track, TrackPose } from '@/domain/track';
import type { Ride, RideSample } from '@/domain/types';
import type { Workout } from '@/domain/types';
import { workoutAt } from '@/domain/workouts';
import type { TelemetrySource } from './source';

export type RidePhase = 'riding' | 'paused' | 'finished';

export interface EngineOptions {
  track: Track;
  source: TelemetrySource;
  physics: PhysicsParams;
  ftp: number;
  maxHr: number;
  restHr: number;
  lthr: number;
  weightKg: number;
  workout?: Workout | null;
  withCamilla: boolean;
  crr: number;
  cw: number;
}

export class RideEngine {
  phase: RidePhase = 'riding';
  elapsed = 0;
  distance = 0;
  speed = 0;
  power = 0;
  power3s = 0;
  hr = 0;
  cadence = 0;
  grade = 0;
  altitude = 0;
  targetPower = 0;
  mode: 'free' | 'erg' = 'free';
  workoutDone = false;
  effort = 0.62;
  timeScale = 1;
  samples: RideSample[] = [];
  readonly startedAt: Date;
  readonly withCamilla: boolean;
  readonly workout: Workout | null;

  readonly track: Track;
  private readonly source: TelemetrySource;
  private readonly physics: PhysicsParams;
  readonly ftp: number;
  private readonly maxHr: number;
  private readonly restHr: number;
  private readonly lthr: number;
  private readonly weightKg: number;
  private readonly crr: number;
  private readonly cw: number;
  private sampleAcc = 0;
  private powerBuf: { t: number; p: number }[] = [];
  private listeners = new Set<() => void>();
  private sinceEmit = 0;
  /** finish() aggiunge l'ultimo campione: se si riprende a pedalare, va tolto. */
  private closingSample = false;

  constructor(opts: EngineOptions) {
    this.track = opts.track;
    this.source = opts.source;
    this.physics = opts.physics;
    this.ftp = opts.ftp;
    this.maxHr = opts.maxHr;
    this.restHr = opts.restHr;
    this.lthr = opts.lthr;
    this.weightKg = opts.weightKg;
    this.workout = opts.workout ?? null;
    this.withCamilla = opts.withCamilla;
    this.crr = opts.crr;
    this.cw = opts.cw;
    this.startedAt = new Date();
    this.mode = this.workout ? 'erg' : 'free';
    // il bersaglio è giusto già prima del primo fotogramma, non 0 W
    if (this.workout) this.targetPower = workoutAt(this.workout, 0, this.ftp).targetPower;
    const pose = this.track.poseAt(0);
    this.grade = pose.grade;
    this.altitude = pose.altitude;
    this.hr = opts.restHr + 8;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pose(): TrackPose {
    return this.track.poseAt(this.distance);
  }

  pause(): void {
    if (this.phase === 'riding') {
      this.phase = 'paused';
      this.emit();
    }
  }

  resume(): void {
    if (this.phase === 'paused') {
      this.phase = 'riding';
      this.emit();
    }
  }

  finish(): void {
    if (this.phase === 'finished') return;
    this.closingSample = this.sampleAcc > 0 || this.samples.length === 0;
    if (this.closingSample) this.pushSample();
    this.phase = 'finished';
    this.emit();
  }

  /** Annulla un «Termina» toccato per sbaglio: il giro continua da dove era. */
  reopen(): void {
    if (this.phase !== 'finished') return;
    if (this.closingSample) this.samples.pop();
    this.closingSample = false;
    this.phase = 'riding';
    this.emit();
  }

  /** Avanza di `dt` secondi di orologio. timeScale vale solo per il simulatore. */
  tick(dt: number): void {
    if (this.phase !== 'riding') return;
    const scaled = dt * (this.source.mode === 'simulator' ? this.timeScale : 1);
    const steps = Math.max(1, Math.ceil(scaled / 0.05));
    const h = scaled / steps;
    for (let i = 0; i < steps; i++) this.step(h);
    this.sinceEmit += dt;
    if (this.sinceEmit >= 0.2) {
      this.sinceEmit = 0;
      this.emit();
    }
  }

  wkg(): number {
    if (!(this.weightKg > 0)) return 0;
    return this.power3s / this.weightKg;
  }

  estimatedFtp(): number | null {
    if (!this.workout?.ftpTest) return null;
    const powers = this.samples.map((s) => s.power);
    if (this.samples.length === 0) powers.push(this.power);
    const ftp = estimateFtpFromRamp(powers);
    return ftp > 0 ? ftp : null;
  }

  toRide(name: string): Ride {
    const samples = this.samples.length > 0 ? this.samples : [this.currentSample()];
    return buildRide({
      id: `ride-${crypto.randomUUID()}`,
      name,
      sport: 'cycling',
      source: 'indoor',
      startTime: this.startedAt,
      durationSec: Math.max(this.elapsed, samples[samples.length - 1]?.t ?? 0),
      samples,
      ftp: this.ftp,
      lthr: this.lthr,
      withCamilla: this.withCamilla,
      workoutId: this.workout?.id,
      workoutName: name,
      distanceM: this.distance,
    });
  }

  private step(dt: number): void {
    this.elapsed += dt;
    if (this.workout && !this.workoutDone) {
      const progress = workoutAt(this.workout, this.elapsed, this.ftp);
      if (progress.finished) {
        this.workoutDone = true;
        this.mode = 'free';
        this.targetPower = 0;
      } else {
        this.mode = 'erg';
        this.targetPower = progress.targetPower;
      }
    } else if (!this.workout) {
      this.mode = 'free';
      this.targetPower = 0;
    }

    this.source.update({
      dt,
      grade: this.grade,
      targetPower: this.mode === 'erg' ? this.targetPower : null,
      effort: this.effort,
      ftp: this.ftp,
      maxHr: this.maxHr,
      restHr: this.restHr,
      erg: this.mode === 'erg',
      crr: this.crr,
      cw: this.cw,
    });
    this.power = Math.max(0, this.source.power);
    this.hr = Math.max(0, this.source.hr);
    this.cadence = Math.max(0, this.source.cadence);

    const pose = this.track.poseAt(this.distance);
    this.grade = pose.grade;
    this.altitude = pose.altitude;
    this.speed = stepSpeed(this.power, this.speed, this.grade, dt, this.physics);
    this.distance += this.speed * dt;

    this.powerBuf.push({ t: this.elapsed, p: this.power });
    const cutoff = this.elapsed - 3;
    while (this.powerBuf.length && this.powerBuf[0].t < cutoff) this.powerBuf.shift();
    let sum = 0;
    for (const item of this.powerBuf) sum += item.p;
    this.power3s = this.powerBuf.length ? sum / this.powerBuf.length : this.power;

    this.sampleAcc += dt;
    while (this.sampleAcc >= 1) {
      this.sampleAcc -= 1;
      this.pushSample();
    }
  }

  private currentSample(): RideSample {
    return {
      t: this.elapsed,
      power: this.power,
      hr: this.hr,
      cadence: this.cadence,
      speed: this.speed,
      distance: this.distance,
      altitude: this.altitude,
      grade: this.grade,
    };
  }

  private pushSample(): void {
    const sample = this.currentSample();
    sample.t = this.samples.length === 0 ? Math.max(1, Math.round(this.elapsed)) : this.samples.length + 1;
    if (this.samples.length > 0) {
      const prev = this.samples[this.samples.length - 1];
      if (sample.t <= prev.t) sample.t = prev.t + 1;
    }
    this.samples.push(sample);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
