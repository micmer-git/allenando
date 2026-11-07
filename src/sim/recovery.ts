import { loadKv, saveKv } from '@/db/db';
import { buildRide } from '@/domain/metrics';
import type { Ride } from '@/domain/types';
import type { SegmentResult } from '@/game/career';
import type { EngineCheckpoint, RideEngine } from './engine';

/**
 * Il giro non si perde: al «Termina» si salva da solo, e mentre si pedala ogni 15 s mette da
 * parte un punto di ripresa in IndexedDB (nel kv del database `allenando`, senza toccarne lo
 * schema). Se la scheda si chiude, Safari cade o il telefono si spegne, alla riapertura si
 * sceglie: riprendere da lì o salvarlo com'è.
 *
 * Qui non c'è React né 3D: lo usano la corsa, il foglio della ripresa e le prove.
 */

export const CHECKPOINT_KEY = 'ride:checkpoint';
/** ogni quanto si mette da parte il giro, in millisecondi di orologio */
export const CHECKPOINT_EVERY_MS = 15_000;
/** sotto questi secondi pedalati un giro non vale una domanda alla riapertura */
export const CHECKPOINT_MIN_SEC = 20;

export interface RideCheckpoint {
  v: 1;
  savedAt: string;
  /** il link della pedalata (la query, senza «?» e senza `resume`): la riapre dov'era */
  search: string;
  name: string;
  ftp: number;
  lthr: number;
  workoutId?: string;
  routeId?: string;
  engine: EngineCheckpoint;
  /** tratti cronometrati e punti caldi già fatti: valgono oro anche dopo la ripresa */
  game: { results: SegmentResult[]; pois: string[] };
  /** nel mondo: il dislivello contato e i luoghi passati */
  world?: { gainM: number; passed: string[] };
  /** il mondo aperto in cui si pedala (`bergamo`, `sellaronda`) */
  worldId?: string;
}

function valid(value: unknown): value is RideCheckpoint {
  const cp = value as RideCheckpoint | null | undefined;
  return !!cp && cp.v === 1 && !!cp.engine && Array.isArray(cp.engine.samples) && typeof cp.engine.rideId === 'string' && typeof cp.search === 'string';
}

export async function loadCheckpoint(): Promise<RideCheckpoint | null> {
  const value = await loadKv<unknown>(CHECKPOINT_KEY);
  return valid(value) ? value : null;
}

export async function saveCheckpoint(cp: RideCheckpoint): Promise<void> {
  await saveKv(CHECKPOINT_KEY, cp);
}

export async function clearCheckpoint(): Promise<void> {
  await saveKv(CHECKPOINT_KEY, null);
}

/** «Salva com'è»: il giro messo da parte diventa un giro del diario, col suo FIT. */
export function rideFromCheckpoint(cp: RideCheckpoint): Ride {
  const e = cp.engine;
  const samples = e.samples.length ? e.samples : [{ t: 1, power: 0, hr: 0, cadence: 0, speed: 0, distance: e.base + e.distance, altitude: 0, grade: 0 }];
  const ride = buildRide({
    id: e.rideId,
    name: cp.name,
    sport: 'cycling',
    source: 'indoor',
    startTime: new Date(e.startedAt),
    durationSec: Math.max(e.elapsed, samples[samples.length - 1]?.t ?? 0),
    samples,
    ftp: cp.ftp,
    lthr: cp.lthr,
    withCamilla: false,
    workoutId: cp.workoutId,
    workoutName: cp.name,
    distanceM: e.base + e.distance,
  });
  if (cp.routeId) ride.routeId = cp.routeId;
  if (cp.worldId) ride.world = cp.worldId;
  return ride;
}

/** Il link che riprende il giro. */
export function resumePath(cp: RideCheckpoint): string {
  const p = new URLSearchParams(cp.search);
  p.set('resume', '1');
  return `/ride?${p.toString()}`;
}

/** La query di una pedalata senza `resume` (e senza le chiavi in `drop`). */
export function rideSearch(params: URLSearchParams, drop: string[] = []): string {
  const p = new URLSearchParams(params);
  for (const k of ['resume', ...drop]) p.delete(k);
  return p.toString();
}

/**
 * Lo stesso giro? Lo stesso link, a parte `resume`: è la scheda riaperta dopo un crash, e lì si
 * chiede «Riprendi / Salva com'è». Un giro diverso invece salva il vecchio nel diario e parte.
 */
export function sameRide(cp: RideCheckpoint, params: URLSearchParams): boolean {
  return rideSearch(new URLSearchParams(cp.search)) === rideSearch(params);
}

export interface KeeperMeta {
  /** il nome del giro come andrà nel diario */
  name: () => string;
  /** la query che riapre la pedalata, e se il percorso ricomincia da 0 (giro libero dal punto di adesso) */
  where: () => { search: string; rebase: boolean };
  ftp: number;
  lthr: number;
  workoutId?: string;
  /** la salita o il percorso del mondo a cui legare il giro, se vale */
  routeId: () => string | undefined;
  game: () => RideCheckpoint['game'];
  world?: () => RideCheckpoint['world'];
  /** il mondo aperto, se nel mondo */
  worldId?: string;
}

/**
 * Chi tiene il giro: i punti di ripresa mentre si pedala, il salvataggio al «Termina».
 * La pagina della corsa chiama `checkpoint()` ogni 15 s e quando la scheda va in secondo piano,
 * e `finish()` al «Termina» o all'arrivo: il giro è nel diario senza toccare niente.
 */
export class RideKeeper {
  constructor(
    readonly engine: RideEngine,
    readonly meta: KeeperMeta,
    private readonly save: (ride: Ride) => Promise<void>,
  ) {}

  /** Il punto di ripresa di adesso. */
  snapshot(): RideCheckpoint {
    const where = this.meta.where();
    const engine = this.engine.checkpoint();
    if (where.rebase) {
      engine.base = this.engine.odometer;
      engine.distance = 0;
    }
    return {
      v: 1,
      savedAt: new Date().toISOString(),
      search: where.search,
      name: this.meta.name(),
      ftp: this.meta.ftp,
      lthr: this.meta.lthr,
      workoutId: this.meta.workoutId,
      routeId: this.meta.routeId(),
      engine,
      game: this.meta.game(),
      world: this.meta.world?.(),
      worldId: this.meta.worldId,
    };
  }

  /** Mette da parte il giro, se è un giro: pedalato abbastanza e non ancora finito. */
  async checkpoint(): Promise<boolean> {
    if (this.engine.phase === 'finished' || this.engine.elapsed < CHECKPOINT_MIN_SEC) return false;
    await saveCheckpoint(this.snapshot());
    return true;
  }

  /**
   * Fine giro: il motore si ferma, il giro va nel diario e il punto di ripresa si toglie.
   * Il giro torna subito (per il riepilogo); `saved` si risolve quando è scritto.
   */
  finish(): { ride: Ride; saved: Promise<void> } {
    this.engine.finish();
    const ride = this.engine.toRide(this.meta.name());
    const routeId = this.meta.routeId();
    if (routeId) ride.routeId = routeId;
    if (this.meta.worldId) ride.world = this.meta.worldId;
    const saved = this.save(ride).then(() => clearCheckpoint());
    return { ride, saved };
  }
}
