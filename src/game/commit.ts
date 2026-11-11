import type { Profile, Settings, Workout } from '@/domain/types';
import { applyRide, levelOf, loadProgress, postResult, postXp, type WorldProgress, type XpLine } from '@/open/progress';
import type { WorldSession } from '@/open/session';
import { sunFor } from '@/open/sky';
import type { RideEngine } from '@/sim/engine';
import { applyCareer, ORO_RULES, type Career, type CareerOutcome, type OroLine, type RideFacts, type SegmentResult } from './career';
import type { RideGame } from './rideGame';
import { useGame } from './useGame';

/**
 * Fine giro: punti, livello e, se vale, il tempo del percorso in classifica; poi oro, record,
 * missioni e traguardi. Era il corpo di `commitProgress` in Ride.tsx: qui non c'è React, e le
 * chiamate alla rete e al disco si possono sostituire nelle prove.
 */

/** Quanto è già stato contato: «Continua a pedalare» dopo il riepilogo non conta due volte. */
export interface Committed {
  distance: number;
  sample: number;
  elapsed: number;
  results: number;
  gain: number;
  pois: number;
}

export const NOTHING_COMMITTED: Committed = { distance: 0, sample: 0, elapsed: 0, results: 0, gain: 0, pois: 0 };

export interface XpView {
  lines: XpLine[];
  total: number;
  level: ReturnType<typeof levelOf> & { xp: number };
  rank: string | null;
  rankNote?: string;
}

export interface CommitInput {
  engine: RideEngine;
  game: RideGame;
  session: WorldSession | null;
  /** la salita verificata (fuori dal mondo) */
  routeId?: string;
  /** un tuo giro rifatto */
  replay: boolean;
  workout: Workout | null;
  profile: Pick<Profile, 'name' | 'weightKg' | 'ftp'>;
  /** il simulatore ha pedalato */
  sim: boolean;
  /** centro del mondo, per la notte */
  origin?: { lat: number; lon: number };
  rain: boolean;
  daytime: Settings['daytime'];
  together: boolean;
  /** si aggiorna qui dentro */
  committed: Committed;
}

export interface CommitDeps {
  loadProgress: () => Promise<WorldProgress>;
  postResult: typeof postResult;
  postXp: typeof postXp;
  setProgress: (p: WorldProgress) => Promise<void>;
  career: () => Career;
  setCareer: (c: Career) => Promise<void>;
  now: () => Date;
}

const defaultDeps: CommitDeps = {
  loadProgress,
  postResult,
  postXp,
  setProgress: (p) => useGame.getState().setProgress(p),
  career: () => useGame.getState().career,
  setCareer: (c) => useGame.getState().setCareer(c),
  now: () => new Date(),
};

/** La potenza media migliore su `n` campioni consecutivi (1 Hz). */
export function peakAvg(powers: number[], n: number): number {
  if (powers.length < n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += powers[i];
  let best = sum;
  for (let i = n; i < powers.length; i++) {
    sum += powers[i] - powers[i - n];
    if (sum > best) best = sum;
  }
  return best / n;
}

/** Nelle sessioni «volate» e «salita» i tratti del loro tipo valgono doppio. */
export function sessionBonus(game: RideGame, results: SegmentResult[]): OroLine[] {
  const kind = game.sessionDef?.kind;
  if (kind !== 'volate' && kind !== 'salita') return [];
  const want = kind === 'volate' ? 'volata' : 'gpm';
  return results.filter((r) => r.kind === want).map((r) => ({ label: `Sessione, doppio: ${r.name}`, oro: ORO_RULES[want] }));
}

/** Il riepilogo di un giro di prova: niente punti, livello invariato, nessun oro (A11). */
async function commitProva(input: CommitInput, d: CommitDeps): Promise<{ xp: XpView; outcome: CareerOutcome; results: SegmentResult[] }> {
  const { engine, game } = input;
  const prev = await d.loadProgress();
  const career = d.career();
  const results = game.results.slice(input.committed.results);
  const xp: XpView = { lines: [], total: 0, level: { ...levelOf(prev.xp), xp: prev.xp }, rank: null, rankNote: 'Giro di prova: niente classifica, punti né oro.' };
  const outcome: CareerOutcome = { next: career, lines: [], total: 0, unlocked: [], pbs: [], missions: [], steps: [], items: [] };
  input.session?.markCommitted(engine.distance);
  input.committed.distance = engine.odometer;
  input.committed.sample = engine.samples.length;
  input.committed.elapsed = engine.elapsed;
  input.committed.results = game.results.length;
  input.committed.gain = 0;
  input.committed.pois = game.poisPassed.length;
  return { xp, outcome, results };
}

/** Punti, livello e, se vale, il tempo del percorso in classifica. Poi oro e traguardi. */
export async function commitProgress(input: CommitInput, deps: Partial<CommitDeps> = {}): Promise<{ xp: XpView; outcome: CareerOutcome; results: SegmentResult[] }> {
  const d: CommitDeps = { ...defaultDeps, ...deps };
  // la prova non tocca classifiche, punti, livello, oro, missioni né traguardi (A11)
  if (input.engine.prova) return commitProva(input, d);
  const { engine, game, session, workout, profile, sim } = input;
  const c = input.committed;
  const climbId = !session && input.routeId && engine.arrived && !input.replay && !workout ? input.routeId : undefined;
  // un allenamento più lungo del percorso prosegue libero: il percorso è fatto quando si passa la sua fine
  const routeFinished = !!session && (engine.arrived || session.giriFatti.length > 0 || (session.routeEnd != null && engine.distance >= session.routeEnd));
  // con più passaggi il tempo del percorso è quello del passaggio migliore (sull'aperto, l'andata);
  // se nessun passaggio ha un tempo (una ripresa a metà), il giro non va in classifica
  const routeSec = session && session.giri > 1 ? session.tempoPercorso() : engine.elapsed;
  const completed = session ? routeFinished && session.rankable && routeSec != null : !!climbId;
  const sec = routeSec ?? engine.elapsed;
  // dislivello: il mondo lo conta da sé; sulle salite e nei replay dai campioni
  const fresh = engine.samples.slice(c.sample);
  let climbGain = 0;
  for (let i = 1; i < fresh.length; i++) climbGain += Math.max(0, fresh[i].altitude - fresh[i - 1].altitude);
  const gainM = session ? session.gainM - session.committedGain : climbGain;
  const landmarks = session ? [...session.passed].filter((id) => !session.committedLandmarks.has(id)) : [];
  const prev = await d.loadProgress();
  const out = applyRide(prev, {
    rideId: session ? session.ride?.id : climbId ? `salita:${climbId}` : undefined,
    completed,
    // con un allenamento il tempo non è quello del percorso: niente record
    sec: completed && !workout ? sec : undefined,
    sim,
    distanceM: engine.odometer - c.distance,
    gainM,
    landmarks,
  });
  session?.markCommitted(engine.distance);
  await d.setProgress(out.next);
  const total = out.lines.reduce((a, l) => a + l.xp, 0);
  let rank: string | null = null;
  let rankNote: string | undefined;
  if (session?.ride && workout) rankNote = 'Con un allenamento il tempo non va in classifica.';
  else if (session && completed && session.ride && profile.name) {
    const avg = engine.samples.length ? engine.samples.reduce((a, x) => a + x.power, 0) / engine.samples.length : engine.power3s;
    const res = await d.postResult({ nick: profile.name, ride: session.ride.id, sec, wkg: profile.weightKg > 0 ? avg / profile.weightKg : 0, sim });
    if (res.ok && res.rank) rank = `${res.rank}° in classifica${sim ? ' (simulatore)' : ''}${res.best ? ', il tuo tempo migliore' : ''}`;
    else if (res.error === 'implausible') rankNote = 'Tempo troppo veloce per essere vero: non va in classifica.';
    else if (res.error === 'rete') rankNote = 'Senza rete: il tempo resta qui, non in classifica.';
  } else if (session?.ride && !completed) rankNote = session.offRoute || session.rejoined ? 'Sei uscito dal percorso: il tempo non va in classifica.' : 'Percorso non finito: niente tempo in classifica.';
  if (profile.name) void d.postXp(out.next, profile.name);
  const xp: XpView = { lines: out.lines, total, level: { ...levelOf(out.next.xp), xp: out.next.xp }, rank, rankNote };

  // la carriera: oro, record, missioni, traguardi
  const powers = fresh.map((s) => s.power);
  const results = game.results.slice(c.results);
  const origin = input.origin;
  const facts: RideFacts = {
    distanceM: engine.odometer - c.distance,
    gainM,
    durationSec: engine.elapsed - c.elapsed,
    sim,
    startedAt: engine.startedAt,
    avgPower: powers.length ? powers.reduce((a, p) => a + p, 0) / powers.length : 0,
    peak5s: peakAvg(powers, 5),
    peak5min: peakAvg(powers, 300),
    ftp: profile.ftp,
    climbDone: climbId,
    worldRideDone: session?.ride && completed ? session.ride.id : undefined,
    segments: results,
    pois: game.poisPassed.slice(c.pois),
    landmarks,
    discovered: Object.keys(out.next.visited).length,
    rain: input.rain,
    night: !!origin && sunFor(input.daytime, d.now(), origin.lat, origin.lon).night,
    session: game.sessionDef ? { id: game.sessionDef.id, kind: game.sessionDef.kind, finished: game.stage === 'arrivo', withPack: game.pack ? game.withPack : 1 } : undefined,
    workoutDone: engine.workoutDone,
    together: input.together,
    level: levelOf(out.next.xp).level,
    extra: sessionBonus(game, results),
  };
  const outcome = applyCareer(d.career(), facts);
  // il tempo del percorso intero, per i record della pagina Classifiche
  if (facts.worldRideDone && !workout) {
    const key = `w:${facts.worldRideDone}`;
    const old = outcome.next.pbs[key];
    if (!old || sec < old.sec) outcome.next.pbs[key] = { sec: Math.round(sec), at: d.now().toISOString(), sim, count: (old?.count ?? 0) + 1 };
  }
  await d.setCareer(outcome.next);
  input.committed.distance = engine.odometer;
  input.committed.sample = engine.samples.length;
  input.committed.elapsed = engine.elapsed;
  input.committed.results = game.results.length;
  input.committed.gain = 0;
  input.committed.pois = game.poisPassed.length;
  return { xp, outcome, results };
}
