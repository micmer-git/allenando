import { buildRide } from '@/domain/metrics';
import { estimateFtpFromRamp } from '@/domain/metrics';
import { stepSpeed, type PhysicsParams } from '@/domain/physics';
import type { Track, TrackPose } from '@/domain/track';
import type { Ride, RideSample } from '@/domain/types';
import type { Workout } from '@/domain/types';
import { workoutAt } from '@/domain/workouts';
import type { TelemetrySource } from './source';

export type RidePhase = 'riding' | 'paused' | 'finished';

/** Secondi a 0 W e 0 rpm col rullo vero prima della pausa automatica. */
export const AUTO_PAUSE_SEC = 3;

/**
 * Quanto serve per riprendere un giro dopo un crash o una scheda chiusa: il resto (la strada,
 * l'allenamento, il profilo) si ricostruisce dal link della pedalata.
 */
export interface EngineCheckpoint {
  rideId: string;
  startedAt: string;
  elapsed: number;
  /** metri sul percorso di adesso */
  distance: number;
  /** metri fatti prima che il percorso ricominciasse da 0 (giro libero ripreso) */
  base: number;
  samples: RideSample[];
  workoutDone: boolean;
  effort: number;
  speed: number;
}

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
  /**
   * Potenza obiettivo da un giro registrato (power replay): watt per tempo trascorso e
   * distanza, oppure null dove il giro originale non ha potenza. Con un allenamento attivo
   * vince l'allenamento. Quando c'è un bersaglio il rullo va in ERG e NON riceve la pendenza.
   */
  powerTarget?: (elapsed: number, distance: number) => number | null;
  /**
   * Dove si è sulla Terra a una certa distanza: le strade del mondo e delle salite sono
   * georeferenziate, così il FIT esportato ha la traccia GPS vera (Strava la mostra come
   * «giro virtuale» sulla mappa). Null per la strada neutra, che non è da nessuna parte.
   */
  geoAt?: (distance: number) => { lat: number; lon: number } | null;
  /** pausa automatica col rullo vero (0 W e 0 rpm per 3 s); mai col simulatore. Di serie sì. */
  autoPause?: boolean;
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
  /** Strada aperta finita: arrivati in cima. */
  arrived = false;
  effort = 0.62;
  timeScale = 1;
  /**
   * Moltiplicatori del mondo aperto: `aero` scende in scia a un altro ciclista (CdA fino a
   * −30%), `rolling` sale sul porfido e sullo sterrato. Valgono per la fisica e per il rullo.
   */
  aero = 1;
  rolling = 1;
  /** vento contro (positivo) o a favore, m/s: lo mette il mondo aperto col meteo vero */
  wind = 0;
  samples: RideSample[] = [];
  /** L'id del giro: resta lo stesso dopo «Continua a pedalare» e dopo una ripresa, così il salvataggio sovrascrive. */
  rideId = `ride-${crypto.randomUUID()}`;
  /** Metri fatti prima che il percorso ricominciasse da 0 (un giro libero ripreso dopo un crash). */
  base = 0;
  /** La pausa l'ha messa il motore (rullo fermo): riparte da sola alla prima pedalata. */
  autoPaused = false;
  startedAt: Date;
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
  private readonly powerTarget: EngineOptions['powerTarget'];
  private readonly geoAt: EngineOptions['geoAt'];
  private readonly autoPause: boolean;
  /** secondi di fila a 0 W e 0 rpm */
  private idle = 0;
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
    this.powerTarget = opts.powerTarget;
    this.geoAt = opts.geoAt;
    this.autoPause = opts.autoPause ?? true;
    this.startedAt = new Date();
    this.mode = this.workout ? 'erg' : 'free';
    // il bersaglio è giusto già prima del primo fotogramma, non 0 W
    if (this.workout) this.targetPower = workoutAt(this.workout, 0, this.ftp).targetPower;
    else if (this.powerTarget) {
      const w = this.powerTarget(0, 0);
      if (w != null) {
        this.mode = 'erg';
        this.targetPower = w;
      }
    }
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

  /** Il contachilometri del giro: i metri sul percorso più quelli di prima di una ripresa. */
  get odometer(): number {
    return this.base + this.distance;
  }

  pause(): void {
    if (this.phase === 'riding') {
      this.phase = 'paused';
      this.autoPaused = false;
      this.emit();
    }
  }

  resume(): void {
    if (this.phase === 'paused') {
      this.phase = 'riding';
      this.autoPaused = false;
      this.idle = 0;
      this.emit();
    }
  }

  /** Lo stato da mettere da parte ogni 15 s: con questo il giro riprende dove era. */
  checkpoint(): EngineCheckpoint {
    return {
      rideId: this.rideId,
      startedAt: this.startedAt.toISOString(),
      elapsed: this.elapsed,
      distance: this.distance,
      base: this.base,
      samples: this.samples.slice(),
      workoutDone: this.workoutDone,
      effort: this.effort,
      speed: this.speed,
    };
  }

  /** Riprende un giro messo da parte: stesso id, stesso tempo, stessi metri, stessi campioni. */
  restore(cp: EngineCheckpoint): void {
    this.rideId = cp.rideId;
    const started = new Date(cp.startedAt);
    if (Number.isFinite(started.getTime())) this.startedAt = started;
    this.elapsed = Math.max(0, cp.elapsed);
    this.base = Math.max(0, cp.base);
    this.distance = Math.max(0, this.track.closed ? cp.distance : Math.min(cp.distance, this.track.length - 1));
    this.samples = cp.samples.slice();
    this.workoutDone = cp.workoutDone;
    this.effort = cp.effort;
    this.speed = Math.max(0, cp.speed);
    this.sampleAcc = 0;
    this.powerBuf = [];
    this.closingSample = false;
    this.arrived = false;
    const pose = this.track.poseAt(this.distance);
    this.grade = pose.grade;
    this.altitude = pose.altitude;
    if (this.workout && !this.workoutDone) this.targetPower = workoutAt(this.workout, this.elapsed, this.ftp).targetPower;
    this.emit();
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
    if (this.phase === 'paused' && this.autoPaused) {
      this.watchPedals(dt);
      return;
    }
    if (this.phase !== 'riding') return;
    const scaled = dt * (this.source.mode === 'simulator' ? this.timeScale : 1);
    const steps = Math.max(1, Math.ceil(scaled / 0.05));
    const h = scaled / steps;
    for (let i = 0; i < steps && this.phase === 'riding'; i++) this.step(h);
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
      id: this.rideId,
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
      distanceM: this.odometer,
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
    } else if (!this.workout && this.powerTarget) {
      const w = this.powerTarget(this.elapsed, this.distance);
      this.mode = w != null ? 'erg' : 'free';
      this.targetPower = w ?? 0;
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
      crr: this.crr * this.rolling,
      cw: this.cw * this.aero,
      windSpeedMs: this.wind,
    });
    this.power = Math.max(0, this.source.power);
    this.hr = Math.max(0, this.source.hr);
    this.cadence = Math.max(0, this.source.cadence);
    // il rullo fermo (0 W e 0 rpm per 3 s) mette in pausa: il tempo non corre mentre si beve
    if (this.autoPause && this.source.mode !== 'simulator') {
      this.idle = this.power <= 0 && this.cadence <= 0 ? this.idle + dt : 0;
      if (this.idle >= AUTO_PAUSE_SEC) {
        this.idle = 0;
        this.phase = 'paused';
        this.autoPaused = true;
        this.speed = 0;
        this.emit();
        return;
      }
    }

    const pose = this.track.poseAt(this.distance);
    this.grade = pose.grade;
    this.altitude = pose.altitude;
    const physics =
      this.aero === 1 && this.rolling === 1 && this.wind === 0 ? this.physics : { ...this.physics, cda: this.physics.cda * this.aero, crr: this.physics.crr * this.rolling, wind: this.wind };
    this.speed = stepSpeed(this.power, this.speed, this.grade, dt, physics);
    this.distance += this.speed * dt;
    if (!this.track.closed && this.distance >= this.track.length) {
      this.distance = this.track.length;
      this.arrived = true;
    }

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
    if (this.arrived) this.finish();
  }

  /** In pausa automatica: si ascolta il rullo, e alla prima pedalata si riparte. */
  private watchPedals(dt: number): void {
    this.source.update({
      dt,
      grade: this.grade,
      targetPower: this.mode === 'erg' ? this.targetPower : null,
      effort: this.effort,
      ftp: this.ftp,
      maxHr: this.maxHr,
      restHr: this.restHr,
      erg: this.mode === 'erg',
      crr: this.crr * this.rolling,
      cw: this.cw * this.aero,
      windSpeedMs: this.wind,
    });
    if (this.source.mode === 'simulator' || this.source.power > 0 || this.source.cadence > 0) {
      this.autoPaused = false;
      this.idle = 0;
      this.phase = 'riding';
      this.emit();
    }
  }

  private currentSample(): RideSample {
    const sample: RideSample = {
      t: this.elapsed,
      power: this.power,
      hr: this.hr,
      cadence: this.cadence,
      speed: this.speed,
      distance: this.odometer,
      altitude: this.altitude,
      grade: this.grade,
    };
    const geo = this.geoAt?.(this.distance) ?? null;
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) && !(geo.lat === 0 && geo.lon === 0)) {
      // sette decimali: un centimetro, più che abbastanza
      sample.lat = Math.round(geo.lat * 1e7) / 1e7;
      sample.lon = Math.round(geo.lon * 1e7) / 1e7;
    }
    return sample;
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
