import { loadKv, saveKv } from '@/db/db';
import { buildRide } from '@/domain/metrics';
import type { Ride } from '@/domain/types';
import type { SegmentResult } from '@/game/career';
import { intentoDaSearch, normalizzaSearch } from '@/ride/intento';
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
  /** URL da cui è partita la sessione; search individua il punto attuale. */
  originSearch?: string;
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

/** I vecchi checkpoint ?at registravano nei campioni anche il tratto saltato all'inizio. */
function relativeDistances(cp: RideCheckpoint): RideCheckpoint {
  const e = cp.engine;
  if (e.startDistance !== undefined) return cp;
  const at = Number(new URLSearchParams(cp.search).get('at'));
  if (!(at > 0) || !Number.isFinite(at)) return cp;
  const offset = Math.min(at, Math.max(0, e.base + e.distance));
  const fromBase = Math.min(e.base, offset);
  return { ...cp, routeId: undefined, engine: {
    ...e, base: e.base-fromBase, startDistance: offset-fromBase,
    samples: e.samples.map(s => ({ ...s, distance: s.distance == null ? s.distance : Math.max(0,s.distance-offset) })),
  } };
}

export async function loadCheckpoint(): Promise<RideCheckpoint | null> {
  const value = await loadKv<unknown>(CHECKPOINT_KEY);
  return valid(value) ? relativeDistances(value) : null;
}

export async function saveCheckpoint(cp: RideCheckpoint): Promise<void> {
  await saveKv(CHECKPOINT_KEY, cp);
}

export async function clearCheckpoint(): Promise<void> {
  await saveKv(CHECKPOINT_KEY, null);
}

/** «Salva com'è»: il giro messo da parte diventa un giro del diario, col suo FIT. */
export function rideFromCheckpoint(cp: RideCheckpoint): Ride {
  cp = relativeDistances(cp);
  const e = cp.engine;
  const distance = Math.max(0,e.base + e.distance - (e.startDistance ?? 0));
  const samples = e.samples.length ? e.samples : [{ t: 1, power: 0, hr: 0, cadence: 0, speed: 0, distance, altitude: 0, grade: 0 }];
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
    distanceM: distance,
  });
  if (cp.routeId && !e.startDistance) ride.routeId = cp.routeId;
  if (cp.worldId) ride.world = cp.worldId;
  if (e.tipo) ride.tipo = e.tipo;
  if (e.giri && e.giri > 1) ride.giri = e.giri;
  if (e.prova) ride.prova = true;
  if (e.prova && new URLSearchParams(cp.search).get('manuale') === '1') ride.manuale = true;
  return ride;
}

/** Il link che riprende il giro: lo stesso intento (dove, tipo, giri), più `resume`. */
export function resumePath(cp: RideCheckpoint): string {
  const p = new URLSearchParams(normalizzaSearch(cp.search) ?? cp.search);
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
export function sameRideSearch(search: string, params: URLSearchParams): boolean {
  const a = rideSearch(new URLSearchParams(search), ['room']);
  const b = rideSearch(params, ['room']);
  if (a === b) return true;
  const canonical = normalizzaSearch(a);
  return canonical != null && canonical === normalizzaSearch(b);
}

export function sameRide(cp: RideCheckpoint, params: URLSearchParams): boolean {
  return sameRideSearch(cp.search, params) || (!!cp.originSearch && sameRideSearch(cp.originSearch, params));
}

/** I vecchi giri liberi salvavano solo l'ultimo punto. Si chiede quale giro aprire se la partenza è incerta. */
export function possibileRipresaPrecedente(cp: RideCheckpoint, params: URLSearchParams): boolean {
  if (cp.originSearch || cp.engine.distance !== 0 || cp.engine.base <= 0) return false;
  const old = intentoDaSearch(new URLSearchParams(cp.search));
  const next = intentoDaSearch(params);
  if (old?.dove.kind !== 'libero' || !next || !('world' in next.dove)) return false;
  return old.dove.world === next.dove.world && old.tipo === next.tipo && old.workout === next.workout && !!old.manuale === !!next.manuale;
}

export interface KeeperMeta {
  /** il nome del giro come andrà nel diario */
  name: () => string;
  /** la query che riapre la pedalata, e se il percorso ricomincia da 0 (giro libero dal punto di adesso) */
  where: () => { search: string; originSearch?: string; rebase: boolean };
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
    const engine = this.engine.checkpoint();
    const where = this.meta.where();
    if (where.rebase) {
      engine.base = this.engine.odometer;
      engine.distance = 0;
      engine.startDistance = 0;
    }
    return {
      v: 1,
      savedAt: new Date().toISOString(),
      search: where.search,
      originSearch: where.originSearch,
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
