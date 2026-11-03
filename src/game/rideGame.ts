import type { Track } from '@/domain/track';
import type { RideEngine } from '@/sim/engine';
import type { WorldSession } from '@/open/session';
import type { WorldData } from '@/open/world';
import { postResult } from '@/open/progress';
import { archSpecs, type ArchSpec, type Segment } from './arches';
import type { PersonalBest, SegmentResult } from './career';
import { PacerPack } from './pacers';
import { climbSegments, SegmentTracker, windowsOnPath, worldSegments, type Window } from './segments';
import { sessionBoardId, type SessionDef } from './sessions';

/**
 * Il gioco dentro una pedalata: cronometra i tratti (volate, GPM, crono), mette gli archi
 * sulla strada, fa correre il gruppo di una sessione e manda i tempi alle classifiche.
 * Non è React: gira nello stesso ciclo del motore, e la pagina ne legge lo stato.
 */

export interface FinishBanner {
  seg: Segment;
  sec: number;
  /** record personale di prima (null: prima volta) */
  prev: number | null;
  isPb: boolean;
  rank?: string;
  at: number;
}

export type SessionStage = 'griglia' | 'corsa' | 'arrivo';

export interface RideGameOptions {
  engine: RideEngine;
  track: Track;
  world?: { data: WorldData; session: WorldSession } | null;
  /** salita verificata: id e nome da mostrare */
  climb?: { routeId: string; name: string } | null;
  sessionDef?: SessionDef | null;
  nick: string;
  weightKg: number;
  /** i record personali della carriera, per dire «record» al traguardo */
  pbs: Record<string, PersonalBest>;
  /** true se il tempo è del simulatore */
  sim: () => boolean;
  /** quanto scorre il tempo del simulatore (1, 4, 10) */
  scale: () => number;
  /** niente classifiche dei tratti: replay e allenamenti ERG non sono corse */
  ranked: boolean;
}

export class RideGame {
  readonly engine: RideEngine;
  readonly track: Track;
  readonly world: RideGameOptions['world'];
  readonly sessionDef: SessionDef | null;
  readonly tracker: SegmentTracker;
  readonly pack: PacerPack | null;
  results: SegmentResult[] = [];
  banner: FinishBanner | null = null;
  arches: ArchSpec[] = [];
  /** cresce quando cambiano gli archi: la scena li rifà */
  archVersion = 0;
  stage: SessionStage = 'corsa';
  withPackSec = 0;
  raceSec = 0;
  sessionRank: string | null = null;
  private pathVersion = -1;
  private anchors = null as ReturnType<typeof worldSegments>['anchors'] | null;
  private readonly opts: RideGameOptions;
  private pbs: Record<string, PersonalBest>;
  private sessionPosted = false;

  constructor(opts: RideGameOptions) {
    this.opts = opts;
    this.engine = opts.engine;
    this.track = opts.track;
    this.world = opts.world ?? null;
    this.sessionDef = opts.sessionDef ?? null;
    this.pbs = { ...opts.pbs };
    let windows: Window[] = [];
    if (this.world) {
      this.anchors = worldSegments(this.world.data).anchors;
      windows = windowsOnPath(this.world.session.path, this.anchors);
      this.pathVersion = this.world.session.path.version;
    } else if (opts.climb) {
      windows = climbSegments(opts.climb.routeId, opts.climb.name, this.track.length).map((s) => ({ seg: s, from: s.from, to: s.to }));
    }
    this.tracker = new SegmentTracker(windows);
    this.tracker.prime(this.engine.distance, this.engine.elapsed);
    this.rebuildArches();
    // la sessione: in griglia fino al via; il gruppo solo nelle uscite di gruppo
    const def = this.sessionDef;
    this.pack = def && def.kind === 'gruppo' && def.pace ? new PacerPack(this.track, def.pace.wkg, 7) : null;
    if (def) {
      const now = Date.now();
      if (now < def.start) {
        this.stage = 'griglia';
        this.engine.pause();
      } else if (this.pack) {
        // si entra in corsa: il gruppo è già partito, lo si porta dov'è adesso
        this.pack.started = true;
        const late = Math.min(300, (now - def.start) / 1000);
        for (let t = 0; t < late; t += 0.1) this.pack.step(0.1);
      }
    }
  }

  /** Secondi al via della sessione (0 se partita o se non c'è). */
  get countdown(): number {
    if (!this.sessionDef || this.stage !== 'griglia') return 0;
    return Math.max(0, (this.sessionDef.start - Date.now()) / 1000);
  }

  /** Distanza dal centro del gruppo, positiva se sei davanti. */
  get packGap(): number | null {
    return this.pack && this.pack.started ? this.pack.gapTo(this.engine.distance) : null;
  }

  get withPack(): number {
    return this.raceSec > 0 ? this.withPackSec / this.raceSec : 0;
  }

  /** Un fotogramma: dopo engine.tick e session.step. */
  tick(dt: number): void {
    const def = this.sessionDef;
    if (def && this.stage === 'griglia') {
      if (Date.now() >= def.start) {
        this.stage = 'corsa';
        if (this.pack) this.pack.started = true;
        this.engine.resume();
      } else if (this.engine.phase === 'riding') this.engine.pause();
      return;
    }
    // il percorso del mondo cambia a ogni svolta: i tratti si rimettono sul percorso nuovo
    if (this.world && this.anchors && this.world.session.path.version !== this.pathVersion) {
      this.pathVersion = this.world.session.path.version;
      this.tracker.windows = windowsOnPath(this.world.session.path, this.anchors);
      this.rebuildArches();
    }
    const e = this.engine;
    for (const ev of this.tracker.update(e.distance, e.elapsed, e.power, e.altitude)) {
      if (ev.type !== 'finish') continue;
      const old = this.pbs[ev.seg.id];
      const isPb = !old || ev.sec < old.sec;
      const wkg = this.opts.weightKg > 0 ? ev.avgPower / this.opts.weightKg : 0;
      this.results.push({ id: ev.seg.id, kind: ev.seg.kind, name: ev.seg.name, sec: ev.sec, wkg, lengthM: ev.lengthM, gainM: ev.gainM });
      if (isPb) this.pbs[ev.seg.id] = { sec: ev.sec, at: new Date().toISOString(), sim: this.opts.sim(), count: (old?.count ?? 0) + 1 };
      const banner: FinishBanner = { seg: ev.seg, sec: ev.sec, prev: old?.sec ?? null, isPb: isPb && !!old, at: performance.now() };
      this.banner = banner;
      if (this.opts.ranked && this.opts.nick) {
        void postResult({ nick: this.opts.nick, ride: ev.seg.id, sec: ev.sec, wkg, sim: this.opts.sim(), len: Math.round(ev.lengthM), gain: Math.round(ev.gainM) }).then((r) => {
          if (r.ok && r.rank) banner.rank = `${r.rank}°${this.opts.sim() ? ' col simulatore' : ''}`;
        });
      }
    }
    if (this.banner && performance.now() - this.banner.at > 9000) this.banner = null;
    // il gruppo e la sua scia
    if (this.pack && this.stage === 'corsa' && e.phase !== 'finished') {
      const sdt = e.phase === 'riding' ? dt * this.opts.scale() : 0;
      this.pack.step(sdt);
      if (e.phase === 'riding') {
        this.raceSec += sdt;
        if (Math.abs(this.pack.gapTo(e.distance)) < 25) this.withPackSec += sdt;
        e.aero = Math.min(e.aero, this.pack.draft(e.distance));
      }
    } else if (def && this.stage === 'corsa' && e.phase === 'riding') this.raceSec += dt * this.opts.scale();
    // arrivo della sessione: tempo nella classifica della sessione
    if (def && this.stage === 'corsa' && e.arrived) {
      this.stage = 'arrivo';
      if (!this.sessionPosted && this.opts.nick) {
        this.sessionPosted = true;
        const avg = e.samples.length ? e.samples.reduce((s, x) => s + x.power, 0) / e.samples.length : e.power3s;
        void postResult({ nick: this.opts.nick, ride: sessionBoardId(def), sec: e.elapsed, wkg: this.opts.weightKg > 0 ? avg / this.opts.weightKg : 0, sim: this.opts.sim() }).then((r) => {
          if (r.ok && r.rank) this.sessionRank = `${r.rank}° nella sessione`;
        });
      }
    }
  }

  /** I tratti che stanno correndo adesso, il più recente per primo. */
  get live() {
    return [...this.tracker.live].reverse();
  }

  /** Il prossimo tratto davanti, entro 800 m. */
  ahead() {
    return this.tracker.ahead(this.engine.distance, 800);
  }

  /** Il record personale di un tratto, se c'è. */
  pbOf(id: string): number | null {
    return this.pbs[id]?.sec ?? null;
  }

  private rebuildArches(): void {
    const windows = this.tracker.windows;
    const segs = windows.map((w) => w.seg);
    const halfWidth = (d: number) => {
      if (this.world) {
        const at = this.world.session.path.edgeAt(Math.max(0, Math.min(this.track.length, d)));
        return this.world.data.graph.edges[at.edge]?.hw ?? 3;
      }
      return (this.track as { halfWidth?: number }).halfWidth ?? 3;
    };
    this.arches = archSpecs(segs, (d) => this.track.poseAt(Math.max(0, Math.min(this.track.length, d))), halfWidth);
    this.archVersion++;
  }
}
