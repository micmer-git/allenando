import type { Track } from '@/domain/track';
import type { RideEngine } from '@/sim/engine';
import type { WorldSession } from '@/open/session';
import { POI_LABEL, type PoiKind, type WorldData } from '@/open/world';
import { monumentiPronti, monumentoPoiKind } from '@/open/monumenti';
import { postResult } from '@/open/progress';
import { archSpecs, kmArchSpecs, kmClimbs, kmMarks, type ArchSpec, type KmMark, type Segment } from './arches';
import { ErgArchPlanner, ergGates } from './ergArches';
import type { PersonalBest, SegmentResult } from './career';
import { PacerPack } from './pacers';
import { climbSegments, findClimbs, SegmentTracker, trackProfile, windowsOnPath, worldSegments, type Window } from './segments';
import { sessionBoardId, type SessionDef } from './sessions';

/**
 * Il gioco dentro una pedalata: cronometra i tratti (volate, GPM, crono, cassonetti), mette
 * gli archi sulla strada (traguardi, chilometri, cambi d'intervallo in ERG), fa correre il
 * gruppo di una sessione e manda i tempi alle classifiche.
 * Non è React: gira nello stesso ciclo del motore, e la pagina ne legge lo stato.
 */

/** I punti caldi che contano: le edicole no, si passano troppo spesso per essere una scoperta. */
const HOT = new Set<PoiKind>(['fontanella', 'fontana', 'belvedere', 'chiesa', 'santuario', 'campanile', 'castello', 'torre', 'croce', 'ponte', 'bici', 'bar', 'rifugio']);

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
  /** giro di prova: niente record, niente classifica della sessione, niente fantasma registrato */
  prova?: boolean;
  /** il fantasma da battere si mostra? (interruttore di Pedala, A9) Di serie sì */
  fantasma?: boolean;
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
  /** punti caldi passati (fontanelle, belvederi, campanili…), in ordine */
  poisPassed: string[] = [];
  /** l'ultimo punto caldo, per una riga sopra la strada */
  poiToast: { name: string; kind: PoiKind; at: number } | null = null;
  private poiClock = 0;
  private pathVersion = -1;
  private anchors = null as ReturnType<typeof worldSegments>['anchors'] | null;
  private readonly opts: RideGameOptions;
  private pbs: Record<string, PersonalBest>;
  private sessionPosted = false;
  /** archi dei tratti e dei km: cambiano solo quando cambia il percorso */
  private baseArches: ArchSpec[] = [];
  /** l'arco dell'ERG che viene, se c'è un allenamento */
  private readonly erg: ErgArchPlanner | null;
  private ergCur: { gate: { id: string; role: 'start' | 'finish'; label: string; sub?: string }; d: number } | null = null;
  private ergSpec: ArchSpec | null = null;

  /** giro di prova: niente record né fantasmi registrati */
  get prova(): boolean {
    return !!this.opts.prova;
  }

  /** il fantasma si mostra (A9) */
  get fantasma(): boolean {
    return this.opts.fantasma !== false;
  }

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
    this.erg = this.engine.workout ? new ErgArchPlanner(ergGates(this.engine.workout, this.engine.ftp)) : null;
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
    const e = this.engine;
    // il percorso finisce prima dell'allenamento: non ci si ferma, si prosegue libero
    if (this.world && e.workout && !e.workoutDone && this.world.session.planned && this.world.session.path.length - e.distance < 400) this.world.session.continueFree(e.distance);
    // il percorso del mondo cambia a ogni svolta: i tratti si rimettono sul percorso nuovo
    if (this.world && this.anchors && this.world.session.path.version !== this.pathVersion) {
      this.pathVersion = this.world.session.path.version;
      this.tracker.windows = windowsOnPath(this.world.session.path, this.anchors);
      this.rebuildArches();
    }
    this.updateErg(dt);
    for (const ev of this.tracker.update(e.distance, e.elapsed, e.power, e.altitude)) {
      if (ev.type !== 'finish') continue;
      const old = this.pbs[ev.seg.id];
      // in prova nessun record: il tempo del simulatore non batte niente
      const isPb = !this.opts.prova && (!old || ev.sec < old.sec);
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
    // punti caldi: due volte al secondo, chi è a meno di 40 m dalla strada che si fa
    this.poiClock -= dt;
    if (this.world && this.poiClock <= 0 && e.phase === 'riding') {
      this.poiClock = 0.5;
      const p = this.world.session.pose;
      const seen = new Set(this.poisPassed);
      for (const poi of this.world.data.features.pois ?? []) {
        if (!HOT.has(poi.kind) || seen.has(poi.id)) continue;
        const dx = poi.x - p.x;
        const dz = poi.z - p.z;
        if (dx * dx + dz * dz < 40 * 40) {
          this.poisPassed.push(poi.id);
          this.poiToast = { name: poi.name || POI_LABEL[poi.kind], kind: poi.kind, at: performance.now() };
        }
      }
      // i monumenti (src/open/monumenti.ts): punti caldi anche loro, col nome, entro la loro portata
      // (non quelli che sono già un luogo del percorso: il loro avviso lo dà la sessione)
      for (const m of monumentiPronti()) {
        if (seen.has(`m${m.id}`) || (m.x - p.x) ** 2 + (m.z - p.z) ** 2 > m.reach * m.reach) continue;
        if (this.world.data.features.landmarks.some((l) => l.name === m.name)) continue;
        this.poisPassed.push(`m${m.id}`);
        this.poiToast = { name: m.name, kind: monumentoPoiKind(m), at: performance.now() };
      }
    }
    if (this.poiToast && performance.now() - this.poiToast.at > 5000) this.poiToast = null;
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
      if (!this.sessionPosted && this.opts.nick && !this.opts.prova) {
        this.sessionPosted = true;
        const avg = e.samples.length ? e.samples.reduce((s, x) => s + x.power, 0) / e.samples.length : e.power3s;
        void postResult({ nick: this.opts.nick, ride: sessionBoardId(def), sec: e.elapsed, wkg: this.opts.weightKg > 0 ? avg / this.opts.weightKg : 0, sim: this.opts.sim() }).then((r) => {
          if (r.ok && r.rank) this.sessionRank = `${r.rank}° nella sessione`;
        });
      }
    }
  }

  /** Dopo una ripresa: i tratti cronometrati e i punti caldi di prima contano ancora. */
  restore(saved: { results: SegmentResult[]; pois: string[] }): void {
    this.results = saved.results.slice();
    this.poisPassed = saved.pois.slice();
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

  private readonly halfWidth = (d: number): number => {
    if (this.world) {
      const at = this.world.session.path.edgeAt(Math.max(0, Math.min(this.track.length, d)));
      return this.world.data.graph.edges[at.edge]?.hw ?? 3;
    }
    return (this.track as { halfWidth?: number }).halfWidth ?? 3;
  };

  private readonly poseAt = (d: number) => this.track.poseAt(Math.max(0, Math.min(this.track.length, d)));

  /**
   * I portali dei km: sulle salite verificate uno a ogni km fino in cima; sui percorsi del
   * mondo (e sugli anelli) uno a ogni km nelle salite e ogni 5 km altrove, finché si è sul
   * percorso; nel giro libero niente, perché non c'è un arrivo da contare.
   */
  private kmMarks(): KmMark[] {
    const t = this.track;
    if (t.closed) return [];
    if (this.world && !this.world.session.onRoute) return [];
    const alt = (d: number) => this.poseAt(d).altitude;
    if (!this.world && this.opts.climb) return kmMarks(t.length, alt, [{ from: 0, to: t.length }]);
    return kmMarks(t.length, alt, kmClimbs(findClimbs(trackProfile(t), 60, 0.03), alt));
  }

  private rebuildArches(): void {
    const segs = this.tracker.windows.map((w) => w.seg);
    const seg = archSpecs(segs, this.poseAt, this.halfWidth);
    const near = (a: ArchSpec, b: ArchSpec) => Math.hypot(a.x - b.x, a.z - b.z) < 40;
    // un portale dei km sotto un arco di un tratto non si mette (se ne vede uno solo); un
    // cartellino a bordo strada sotto un portale dei km è di troppo («1 km» e «Ultimo km»)
    const km = kmArchSpecs(this.kmMarks(), this.poseAt, this.halfWidth).filter((k) => !seg.some((a) => a.role !== 'banner' && near(a, k)));
    this.baseArches = [...seg.filter((a) => a.role !== 'banner' || !km.some((k) => near(a, k))), ...km];
    this.arches = this.ergSpec ? [...this.baseArches, this.ergSpec] : this.baseArches;
    this.archVersion++;
  }

  /** L'arco dell'ERG: si sposta con la velocità finché non è a 50 m, poi resta lì. */
  private updateErg(dt: number): void {
    if (!this.erg) return;
    const e = this.engine;
    if (e.phase === 'riding') this.ergCur = this.erg.update(e.elapsed, e.distance, e.speed, dt);
    const cur = this.ergCur;
    let spec: ArchSpec | null = null;
    if (cur && cur.d < this.track.length - 1) {
      const p = this.poseAt(cur.d);
      spec = { id: `erg:${cur.gate.id}`, kind: 'erg', role: cur.gate.role, label: cur.gate.label, sub: cur.gate.sub, x: p.x, y: p.y, z: p.z, heading: p.heading, halfWidth: this.halfWidth(cur.d), d: cur.d };
    }
    const old = this.ergSpec;
    if (old && spec ? old.id === spec.id && Math.hypot(old.x - spec.x, old.z - spec.z) < 0.5 : old === spec) return;
    this.ergSpec = spec;
    this.arches = spec ? [...this.baseArches, spec] : this.baseArches;
    this.archVersion++;
  }

  /** Dove sta l'arco dell'ERG che viene, metri sul percorso (per le prove e l'HUD). */
  get ergArch(): { d: number; label: string; role: 'start' | 'finish' } | null {
    const c = this.ergCur;
    return c ? { d: c.d, label: c.gate.label, role: c.gate.role } : null;
  }
}

/**
 * Un fotogramma della corsa. Finché il mondo non è pronto si mette solo il ciclista al suo posto
 * (il 3D carica le mattonelle intorno a lui): il tempo non corre, i tratti non partono, i punti
 * caldi non suonano. Poi motore, mondo e gioco, in quest'ordine.
 */
export function rideFrame(engine: RideEngine, world: { session: WorldSession } | null | undefined, game: RideGame, dt: number, ready: boolean): void {
  if (!ready) {
    if (world) world.session.pose = world.session.playerPose(engine.distance);
    return;
  }
  engine.tick(dt);
  world?.session.step(engine, dt);
  game.tick(dt);
}
