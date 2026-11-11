import { useEffect, useRef, useState } from 'react';
import { loadKv, saveKv } from '@/db/db';
import { formatDuration } from '@/domain/format';
import type { TrackPose } from '@/domain/track';
import type { RideSample } from '@/domain/types';
import type { WorldSession } from '@/open/session';
import type { RideEngine } from '@/sim/engine';
import type { SegmentKind } from './arches';
import type { RideGame } from './rideGame';

/**
 * Il tuo fantasma: il giro migliore su un percorso del mondo (chiave `w:<percorso>`, come i
 * record della carriera) o su un tratto (volata, GPM, crono, cassonetto, la salita intera:
 * l'id del tratto), salvato come «secondi al metro» e rimesso in strada la volta dopo.
 *
 * Un fantasma è una fila di tempi a passo fisso: `t[k]` è il secondo in cui si è passati a
 * `k · step` metri dal via, l'ultimo è l'arrivo. Vive sul dispositivo, in IndexedDB (chiave
 * `ghosts` di `kv`), accanto alla carriera. Non si registra con un allenamento (in ERG i watt
 * li decide lo schema, non le gambe) né nei replay.
 */

export interface GhostTrace {
  v: 1;
  /** `w:<percorso>` o l'id del tratto */
  id: string;
  /** metri fra due tempi */
  step: number;
  /** secondi dal via a 0, step, 2·step…; l'ultimo è all'arrivo (lengthM) */
  t: number[];
  lengthM: number;
  sec: number;
  /** quando è stato fatto */
  at: string;
  sim: boolean;
}

interface GhostFile {
  v: 1;
  traces: Record<string, GhostTrace>;
}

const KEY = 'ghosts';
/** al massimo tanti tempi per fantasma: il giro delle due valli (88 km) passa a 22 m */
const MAX_POINTS = 4000;

export function ghostStep(lengthM: number): number {
  return Math.max(5, Math.ceil(lengthM / MAX_POINTS));
}

/**
 * Da punti (metri, secondi) in ordine a un fantasma. `from`/`to` sono i metri del via e
 * dell'arrivo, `t0`/`t1` i secondi; i punti fuori si ignorano. Null se non c'è strada o tempo.
 */
export function traceFromPoints(
  id: string,
  points: readonly { d: number; t: number }[],
  from: number,
  to: number,
  t0: number,
  t1: number,
  meta: { at?: string; sim?: boolean } = {},
): GhostTrace | null {
  const lengthM = to - from;
  const sec = t1 - t0;
  if (!(lengthM > 1) || !(sec > 0.5)) return null;
  // via, i punti dentro (metri e secondi che crescono), arrivo
  const pts: { d: number; t: number }[] = [{ d: 0, t: 0 }];
  for (const p of points) {
    const d = p.d - from;
    const t = p.t - t0;
    if (!(d > 0 && d < lengthM && t > 0 && t < sec)) continue;
    const last = pts[pts.length - 1];
    if (d < last.d || t <= last.t) continue;
    pts.push({ d, t });
  }
  pts.push({ d: lengthM, t: sec });
  const step = ghostStep(lengthM);
  const n = Math.ceil(lengthM / step - 1e-9);
  const t: number[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const m = Math.min(k * step, lengthM);
    // il primo punto che arriva a m: in una sosta vale l'arrivo, non la ripartenza
    while (j < pts.length - 1 && pts[j + 1].d < m) j++;
    const a = pts[j];
    const b = pts[Math.min(pts.length - 1, j + 1)];
    const f = b.d > a.d ? Math.min(1, Math.max(0, (m - a.d) / (b.d - a.d))) : 1;
    const v = Math.round((a.t + (b.t - a.t) * f) * 10) / 10;
    t.push(k === 0 ? 0 : Math.max(v, t[k - 1]));
  }
  t[n] = Math.round(sec * 10) / 10;
  return { v: 1, id, step, t, lengthM: Math.round(lengthM * 10) / 10, sec: t[n], at: meta.at ?? new Date().toISOString(), sim: meta.sim ?? false };
}

/** Il fantasma di un pezzo di giro, dai campioni del motore (un punto al secondo). */
export function traceFromSamples(
  id: string,
  samples: readonly Pick<RideSample, 'distance' | 't'>[],
  from: number,
  to: number,
  t0: number,
  t1: number,
  meta: { at?: string; sim?: boolean } = {},
): GhostTrace | null {
  return traceFromPoints(
    id,
    samples.map((s) => ({ d: s.distance, t: s.t })),
    from,
    to,
    t0,
    t1,
    meta,
  );
}

/** Secondo in cui il fantasma è passato a `m` metri dal via. Null oltre l'arrivo. */
export function ghostTimeAt(trace: GhostTrace, m: number): number | null {
  if (!Number.isFinite(m) || m > trace.lengthM + 0.5) return null;
  if (m <= 0) return 0;
  const n = trace.t.length - 1;
  const k = Math.min(m, trace.lengthM) / trace.step;
  const i = Math.min(n - 1, Math.floor(k));
  if (i < 0) return trace.t[n];
  const p0 = i * trace.step;
  const p1 = Math.min((i + 1) * trace.step, trace.lengthM);
  const f = p1 > p0 ? Math.min(1, Math.max(0, (Math.min(m, trace.lengthM) - p0) / (p1 - p0))) : 1;
  return trace.t[i] + (trace.t[i + 1] - trace.t[i]) * f;
}

/** Metri del fantasma dopo `s` secondi dal via. All'arrivo si ferma. */
export function ghostMetersAt(trace: GhostTrace, s: number): number {
  const n = trace.t.length - 1;
  if (!(s > 0)) return 0;
  if (s >= trace.t[n]) return trace.lengthM;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace.t[mid] <= s) lo = mid;
    else hi = mid;
  }
  const p0 = lo * trace.step;
  const p1 = Math.min(hi * trace.step, trace.lengthM);
  const dt = trace.t[hi] - trace.t[lo];
  return dt > 0 ? p0 + ((s - trace.t[lo]) / dt) * (p1 - p0) : p1;
}

/** Distacco in secondi a `m` metri e `s` secondi dal via. Positivo: sei davanti. */
export function ghostGap(trace: GhostTrace, m: number, s: number): number | null {
  const g = ghostTimeAt(trace, m);
  return g == null ? null : g - s;
}

/**
 * Il distacco a parole, col soggetto: sei tu davanti o dietro al fantasma. «Davanti al fantasma
 * · 12 s», «Dietro al fantasma del GPM · 01:05», «Pari col fantasma». `of` è « del GPM» per un tratto.
 */
export function gapLabel(gap: number, of = ''): string {
  const a = Math.abs(gap);
  if (a < 0.5) return `Pari col fantasma${of}`;
  return `${gap > 0 ? 'Davanti al' : 'Dietro al'} fantasma${of} · ${a < 60 ? `${Math.round(a)} s` : formatDuration(a)}`;
}

/**
 * I colori della pillola: fondo notte quasi pieno, testo chiaro; verde solo quando sei davanti.
 * Niente rosso (nel canone vuol dire «cancella»). Contrasto ≥ 4,5:1 su qualunque cielo (la prova).
 */
export const GAP_COLORS = {
  bg: 'rgba(12, 11, 9, 0.86)',
  ahead: '#5fe0a8',
  behind: '#f6f2e6',
} as const;

export function gapStyle(gap: number): { background: string; color: string } {
  return { background: GAP_COLORS.bg, color: gap >= 0.5 ? GAP_COLORS.ahead : GAP_COLORS.behind };
}

// ---------- in IndexedDB ----------

export async function loadGhosts(): Promise<Record<string, GhostTrace>> {
  const f = await loadKv<GhostFile>(KEY);
  return f && f.v === 1 && f.traces ? { ...f.traces } : {};
}

let writing: Promise<unknown> = Promise.resolve();

/** Salva il fantasma se è il primo o se è più veloce di quello che c'è. True se l'ha tenuto. */
export function saveGhostIfBetter(trace: GhostTrace): Promise<boolean> {
  // una scrittura alla volta: un tratto e il percorso finiscono nello stesso istante
  const job = writing.then(async () => {
    const all = await loadGhosts();
    const old = all[trace.id];
    if (old && old.sec <= trace.sec) return false;
    all[trace.id] = trace;
    await saveKv(KEY, { v: 1, traces: all } satisfies GhostFile);
    return true;
  });
  writing = job.catch(() => undefined);
  return job;
}

// ---------- in corsa ----------

export interface GhostNow {
  kind: 'percorso' | 'tratto';
  /** di quale fantasma si parla: «» per il percorso, « del GPM», « della volata»… */
  of: string;
  /** metri del fantasma sulla strada di adesso (la stessa del motore) */
  distance: number;
  /** distacco in secondi, positivo se sei davanti; null oltre il suo arrivo */
  gap: number | null;
}

const KIND_OF: Record<SegmentKind, string> = {
  gpm: ' del GPM',
  volata: ' della volata',
  crono: ' della crono',
  cassonetto: ' del cassonetto',
};

export interface RideGhostsOptions {
  engine: RideEngine;
  game: RideGame;
  /** il mondo aperto, se si pedala lì */
  session: WorldSession | null;
  /** false con un allenamento, nei replay e quando c'è già il fantasma di una salita (?ghost=) */
  enabled: boolean;
  sim: () => boolean;
}

/**
 * I fantasmi di una pedalata: li legge all'inizio, a ogni fotogramma dice dov'è quello da
 * battere (il percorso intero prima dei tratti), e alla fine tiene i giri migliori.
 * Non è React: il motore lo chiama a ogni suo aggiornamento (`observe`).
 */
export class RideGhosts {
  traces: Record<string, GhostTrace> = {};
  private readonly startD: number;
  private readonly routeKey: string | null;
  private seen = new Map<string, { from: number; to: number; t0: number }>();
  private resultsSeen = 0;
  private routeSaved = false;
  /** gli id dei fantasmi nuovi tenuti in questa pedalata */
  kept: string[] = [];
  /** sulla salita (RideScene): i metri del fantasma, solo quando c'è qualcuno da battere */
  trackDistance: (() => number | null) | undefined = undefined;

  constructor(private readonly opts: RideGhostsOptions) {
    this.startD = opts.engine.distance;
    this.routeKey = opts.session?.ride ? `w:${opts.session.ride.id}` : null;
    this.resultsSeen = opts.game.results.length;
  }

  /** Il fantasma da battere adesso, o null. */
  now(): GhostNow | null {
    if (!this.opts.enabled || !this.opts.game.fantasma) return null;
    const e = this.opts.engine;
    const s = this.opts.session;
    // il percorso intero: solo partendo dal via e restando sul percorso
    const route = this.routeKey ? this.traces[this.routeKey] : undefined;
    if (route && s && s.onRoute && this.startD < 1) {
      return { kind: 'percorso', of: '', distance: ghostMetersAt(route, e.elapsed), gap: ghostGap(route, e.distance, e.elapsed) };
    }
    // il tratto partito per primo (la salita intera prima degli ultimi 3 km)
    let best: GhostNow | null = null;
    let t0 = Infinity;
    for (const l of this.opts.game.tracker.live) {
      const tr = this.traces[l.seg.id];
      if (!tr || l.t0 >= t0) continue;
      t0 = l.t0;
      const into = e.elapsed - l.t0;
      best = { kind: 'tratto', of: KIND_OF[l.seg.kind] ?? '', distance: l.from + ghostMetersAt(tr, into), gap: ghostGap(tr, e.distance - l.from, into) };
    }
    return best;
  }

  /** Metri del fantasma, per il profilo e per la salita (RideScene). */
  readonly distance = (): number | null => this.now()?.distance ?? null;

  /** La posa del fantasma nel mondo: nella corsia accanto alla tua, più verso il centro. */
  readonly pose = (): TrackPose | null => {
    const s = this.opts.session;
    const n = this.now();
    if (!s || !n) return null;
    const d = Math.max(0, Math.min(s.path.length, n.distance));
    const p = s.path.poseAt(d);
    const hw = s.graph.edges[s.path.edgeAt(d).edge]?.hw ?? 3;
    const lane = 1 - Math.max(0.15, hw - 1.15);
    return { ...p, x: p.x + Math.cos(p.heading) * lane, z: p.z - Math.sin(p.heading) * lane };
  };

  /** C'è un fantasma per questa strada: il percorso o uno dei suoi tratti (per montare il ciclista solo se serve). */
  get any(): boolean {
    if (!this.opts.enabled || !this.opts.game.fantasma) return false;
    if (this.routeKey && this.traces[this.routeKey]) return true;
    return this.opts.game.tracker.windows.some((w) => !!this.traces[w.seg.id]);
  }

  /**
   * Guarda il gioco e il motore: ricorda dove sono partiti i tratti, e quando uno finisce (o
   * finisce il percorso) ne fa un fantasma, che resta se è il primo o il più veloce.
   */
  readonly observe = (): void => {
    // un giro di prova non lascia fantasmi (A11)
    if (!this.opts.enabled || this.opts.game.prova) return;
    const { engine: e, game, session } = this.opts;
    for (const l of game.tracker.live) this.seen.set(l.seg.id, { from: l.from, to: l.to, t0: l.t0 });
    while (this.resultsSeen < game.results.length) {
      const r = game.results[this.resultsSeen++];
      const w = this.seen.get(r.id);
      if (!w) continue;
      this.offer(traceFromSamples(r.id, e.samples, w.from, w.to, w.t0, w.t0 + r.sec, { sim: this.opts.sim() }));
    }
    if (this.routeKey && session && !this.routeSaved && this.startD < 1 && e.arrived && session.rankable) {
      this.routeSaved = true;
      this.offer(traceFromSamples(this.routeKey, e.samples, 0, e.distance, 0, e.elapsed, { sim: this.opts.sim() }));
    }
  };

  private offer(trace: GhostTrace | null): void {
    if (!trace) return;
    const old = this.traces[trace.id];
    if (old && old.sec <= trace.sec) return;
    // il fantasma nuovo vale già da adesso: il tratto rifatto nello stesso giro lo trova
    this.traces[trace.id] = trace;
    this.kept.push(trace.id);
    this.saving.push(saveGhostIfBetter(trace));
  }

  private saving: Promise<boolean>[] = [];

  /** Aspetta che i fantasmi tenuti siano scritti in IndexedDB. */
  async flush(): Promise<void> {
    await Promise.all(this.saving);
  }
}

/** I fantasmi della pedalata, letti da IndexedDB e legati al motore. */
export function useRideGhosts(opts: RideGhostsOptions): RideGhosts {
  const ref = useRef<RideGhosts | null>(null);
  if (!ref.current) ref.current = new RideGhosts(opts);
  const ghosts = ref.current;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadGhosts().then((all) => {
      if (!alive) return;
      // quelli tenuti in questa pedalata prima della lettura restano
      ghosts.traces = { ...all, ...ghosts.traces };
      setLoaded(true);
    });
    const off = opts.engine.subscribe(ghosts.observe);
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghosts]);
  // sulla salita (RideScene) il ciclista fantasma si monta solo quando c'è da battere qualcuno
  ghosts.trackDistance = loaded && !opts.session && ghosts.any ? ghosts.distance : undefined;
  return ghosts;
}
