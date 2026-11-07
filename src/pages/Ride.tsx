import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkoutChart } from '@/components/WorkoutChart';
import { gradeColor, ProfileChart, RouteMap } from '@/components/RouteViz';
import { legsBounds, WorldMap, type MapMarker, type MapOverlay } from '@/components/WorldMap';
import { Button, Segmented, Wordmark } from '@/components/ui';
import { bluetoothSupport } from '@/bluetooth/support';
import { BluetoothTrainer } from '@/bluetooth/trainer';
import { formatDuration, formatGrade, formatKm, formatKmText, formatNumber, formatTss, msToKmh, withUnit } from '@/domain/format';
import { STANDARD_AIR, type PhysicsParams } from '@/domain/physics';
import {
  gapSeconds,
  geoPointsFromSamples,
  ghostDistanceAt,
  hasAltitude,
  hasGps,
  powerAtTime,
  profileFromSamples,
  sliceSection,
  type ReplayMode,
} from '@/domain/replay';
import { headingToBearing, loadRouteFile, mapillaryUrl, routeMeta, streetViewUrl, trackFromGeo, trackFromRouteFile, type LoadedRoute } from '@/domain/routes';
import { projector } from '@/domain/geo';
import { RIDER_COLORS } from '@/multiplayer/protocol';
import { createRouteTrack } from '@/domain/track';
import type { Profile, Quality, Ride, RideSample, Settings, Workout, WorkoutStep } from '@/domain/types';
import { estimateLthr, powerZone } from '@/domain/zones';
import { findWorkout, workoutAt } from '@/domain/workouts';
import { useI18n, type Translate } from '@/i18n';
import { RideEngine } from '@/sim/engine';
import { CHECKPOINT_EVERY_MS, clearCheckpoint, loadCheckpoint, resumePath, rideFromCheckpoint, RideKeeper, rideSearch, sameRide, type RideCheckpoint } from '@/sim/recovery';
import { useApp } from '@/store/useApp';
import { RideScene } from '@/world/Scene';
import { decodeSection } from './ReplaySetup';
import { RoomPanel, RoomSheet, useRoom } from './RideRoom';
import { RecoveryCard } from './RideRecovery';
import { workoutTitle } from './Workouts';
import { isWorld, loadWorld, Terrain, worldBase, worldInfo, type RideDef, type WorldData } from '@/open/world';
import { createWorldField } from '@/open/field';
import { WorldSession } from '@/open/session';
import { WorldScene, npcCount, type RemoteWorldRider } from '@/open/WorldScene';
import { loadPlan } from '@/open/plan';
import { WorldClient } from '@/multiplayer/world-client';
import { applyRide, levelOf, loadProgress, postResult, postXp, type XpLine } from '@/open/progress';
import { AheadProfile, cap, LoopSheet, MapSheet, Nearby, Toasts, TurnPicker, WeatherChip, WorldMini, XpSummary } from './WorldHud';
import type { Dir } from '@/open/graph';
import { fetchWeather, type WeatherNow } from '@/open/weather';
import { sunFor } from '@/open/sky';
import { applyCareer, ORO_RULES, type CareerOutcome, type OroLine, type RideFacts, type SegmentResult } from '@/game/career';
import { RideGame, rideFrame } from '@/game/rideGame';
import { SEGMENT_STYLE } from '@/game/arches';
import { sessionById } from '@/game/sessions';
import { useGame, useLook } from '@/game/useGame';
import { downloadBytes, safeFileName } from '@/lib/download';
import { cn } from '@/lib/cn';
import { ErgAheadHud, LevelUp, PoiToast, RewardsSummary, SegmentHud, SessionGrid, SessionHud } from './RideGameHud';
import { gapLabel, gapStyle, useRideGhosts } from '@/game/ghosts';
import { CartolinaButton } from '@/components/ShareCard';

const DEFAULT_ROUTE = 'selvino-nembro';
/** «Termina» si tiene premuto: un tocco col dito sudato non chiude il giro */
const HOLD_MS = 800;
/** dopo quanto il velo offre «Parti lo stesso» (rete lenta, mattonelle che non arrivano) */
const SLOW_LOAD_MS = 20_000;

interface RideSetup {
  route: LoadedRoute;
  /** id della salita verificata, per legare il giro salvato al fantasma futuro */
  routeId?: string;
  replayMode?: ReplayMode;
  replaySamples?: RideSample[];
  ghostSamples?: RideSample[];
  label: string;
  note?: string;
  /** mondo aperto: il grafo e la pedalata che lo percorre */
  world?: { data: WorldData; session: WorldSession };
}

/** La potenza media migliore su `n` campioni consecutivi (1 Hz). */
function peakAvg(powers: number[], n: number): number {
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
function sessionBonus(game: RideGame, results: SegmentResult[]): OroLine[] {
  const kind = game.sessionDef?.kind;
  if (kind !== 'volate' && kind !== 'salita') return [];
  const want = kind === 'volate' ? 'volata' : 'gpm';
  return results.filter((r) => r.kind === want).map((r) => ({ label: `Sessione, doppio: ${r.name}`, oro: ORO_RULES[want] }));
}

/** Da distanza sulla strada a latitudine e longitudine; null se la strada non è da nessuna parte. */
export function geoFor(route: LoadedRoute): ((distance: number) => { lat: number; lon: number } | null) | undefined {
  if (route.id === 'neutral' || (route.origin.lat === 0 && route.origin.lon === 0)) return undefined;
  const proj = projector(route.origin);
  return (distance) => {
    const p = route.track.poseAt(distance);
    return Number.isFinite(p.x) && Number.isFinite(p.z) ? proj.toGeo(p.x, p.z) : null;
  };
}

/** Strada neutra, dritta, per i giri senza GPS: lo diciamo, non la spacciamo per vera. */
function neutralRoute(samples: RideSample[]): LoadedRoute {
  const prof = hasAltitude(samples) ? profileFromSamples(samples) : [];
  const total = Math.max(200, samples[samples.length - 1]?.distance ?? 1000);
  const pts = [];
  for (let d = 0; d <= total; d += 10) {
    let ele: number | null = null;
    if (prof.length) {
      const k = prof.findIndex((p) => p.distance >= d);
      ele = (k < 0 ? prof[prof.length - 1] : prof[k]).altitude;
    }
    pts.push({ x: 0, z: d, ele });
  }
  return {
    id: 'neutral',
    title: 'Strada neutra',
    subtitle: 'Giro senza GPS',
    track: createRouteTrack(pts, { halfWidth: 3 }),
    dem: null,
    origin: { lat: 0, lon: 0 },
    attribution: '',
    verified: false,
  };
}

function useRideSetup(): { setup: RideSetup | null; error: string | null } {
  const [params] = useSearchParams();
  const rides = useApp((s) => s.rides);
  const quality = useApp((s) => s.settings.quality);
  const [state, setState] = useState<{ setup: RideSetup | null; error: string | null }>({ setup: null, error: null });
  // entrare o uscire da una stanza cambia ?room=, non la strada: non si ricarica niente
  const key = useMemo(() => {
    const p = new URLSearchParams(params);
    p.delete('room');
    return p.toString();
  }, [params]);
  useEffect(() => {
    let alive = true;
    const done = (setup: RideSetup | null, error: string | null = null) => {
      if (alive) setState({ setup, error });
    };
    if (params.get('world')) {
      loadWorld(params.get('world'))
        .then((data) => {
          const n = npcCount(quality);
          const rideId = params.get('ride');
          const planKey = params.get('plan');
          let session: WorldSession;
          let title: string;
          let subtitle: string;
          if (rideId) {
            const ride = data.rides.find((r) => r.id === rideId);
            if (!ride) throw new Error('Percorso sconosciuto.');
            session = new WorldSession(data, { ride }, n);
            title = ride.name;
            subtitle = ride.side;
          } else if (planKey) {
            const plan = loadPlan(planKey);
            if (!plan || plan.legs.length === 0) throw new Error('Anello non più disponibile: rifallo da Mondo.');
            session = new WorldSession(data, { legs: plan.legs, name: plan.name }, n);
            title = plan.name;
            subtitle = 'Anello suggerito';
          } else {
            const edge = Number(params.get('edge'));
            const e = data.graph.edges[edge];
            if (!e) throw new Error('Punto di partenza fuori dal mondo.');
            const dir = (params.get('dir') === '-1' ? -1 : 1) as Dir;
            const s0 = Math.min(e.length, Math.max(0, Number(params.get('s')) || 0));
            session = new WorldSession(data, { edge, dir: data.graph.allowed(edge, dir) ? dir : ((-dir) as Dir), s: s0 }, n);
            title = 'Giro libero';
            subtitle = e.name || e.ref || worldInfo(data.graph.id).name;
          }
          const route: LoadedRoute = { id: 'world', title, subtitle, track: session.path, dem: null, origin: data.graph.origin, attribution: data.graph.attribution, verified: true };
          done({ route, label: subtitle && rideId ? `${title} ${subtitle}` : title, world: { data, session } });
        })
        .catch((err: unknown) => done(null, err instanceof Error ? err.message : 'Mondo non disponibile.'));
      return () => {
        alive = false;
      };
    }
    const replayId = params.get('replay');
    if (replayId) {
      const ride = rides.find((r) => r.id === replayId);
      if (!ride) {
        done(null, 'Giro da rifare non trovato.');
        return;
      }
      const raw = params.get('mode') ?? '';
      const mode: ReplayMode = raw === 'power' || raw === 'ghost' ? raw : 'grade';
      const samples = sliceSection(ride, decodeSection(params.get('sec')));
      if (samples.length < 2) {
        done(null, 'Il pezzo scelto è vuoto.');
        return;
      }
      let route: LoadedRoute;
      let note: string | undefined;
      try {
        route = hasGps(samples)
          ? trackFromGeo(`replay-${ride.id}`, ride.name, geoPointsFromSamples(samples), 'Traccia del tuo giro')
          : neutralRoute(samples);
        if (!hasGps(samples)) note = 'Giro senza GPS: strada neutra, pendenza dal file se c’è.';
        else if (!hasAltitude(samples)) note = 'Il file non ha quota: la strada è in piano.';
      } catch {
        route = neutralRoute(samples);
        note = 'Traccia GPS inutilizzabile: strada neutra.';
      }
      done({ route, replayMode: mode, replaySamples: samples, ghostSamples: mode === 'grade' ? undefined : samples, label: ride.name, note });
      return;
    }
    const id = params.get('route') ?? DEFAULT_ROUTE;
    const meta = routeMeta(id);
    if (!meta) {
      done(null, 'Salita sconosciuta.');
      return;
    }
    const ghostId = params.get('ghost');
    const ghost = ghostId ? rides.find((r) => r.id === ghostId) : undefined;
    loadRouteFile(id)
      .then((file) => {
        const route = trackFromRouteFile(file, meta.halfWidth);
        done({ route, routeId: id, ghostSamples: ghost?.samples, label: `${meta.name} ${meta.side}` });
      })
      .catch((err: unknown) => done(null, err instanceof Error ? err.message : 'Traccia non disponibile.'));
    return () => {
      alive = false;
    };
    // salvare un giro cambia la lista: la strada non va ricaricata per questo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/**
 * Il nome del percorso subito, per il velo: le salite, gli anelli e i giri rifatti lo sanno già;
 * i percorsi del mondo lo leggono da rides.json (30 kB), senza aspettare il grafo intero.
 */
function useQuickTitle(params: URLSearchParams): { title?: string; subtitle?: string } {
  const rides = useApp((s) => s.rides);
  const rideId = params.get('world') ? params.get('ride') : null;
  const [fetched, setFetched] = useState<{ id: string; title: string; subtitle: string } | null>(null);
  useEffect(() => {
    if (!rideId) return;
    let alive = true;
    void fetch(`${worldBase(isWorld(params.get('world')) ? params.get('world')! : undefined)}rides.json`)
      .then((r) => (r.ok ? (r.json() as Promise<RideDef[]>) : []))
      .then((list) => {
        const r = list.find((x) => x.id === rideId);
        if (alive && r) setFetched({ id: rideId, title: r.name, subtitle: r.side });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [rideId]);
  if (params.get('world')) {
    if (rideId) return fetched?.id === rideId ? fetched : {};
    const planKey = params.get('plan');
    if (planKey) {
      const plan = loadPlan(planKey);
      return plan ? { title: plan.name, subtitle: 'Anello suggerito' } : {};
    }
    return { title: 'Giro libero' };
  }
  const replay = params.get('replay');
  if (replay) {
    const r = rides.find((x) => x.id === replay);
    return r ? { title: r.name } : {};
  }
  const meta = routeMeta(params.get('route') ?? DEFAULT_ROUTE);
  return meta ? { title: meta.name, subtitle: meta.side } : {};
}

export function RidePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setup, error } = useRideSetup();
  const quick = useQuickTitle(params);
  const title = setup?.route.title ?? quick.title;
  const subtitle = setup?.route.subtitle ?? quick.subtitle;
  // i record e il guardaroba servono già al primo metro: si caricano insieme alla strada
  const gameReady = useGame((s) => s.ready);
  const hydrateGame = useGame((s) => s.hydrate);
  useEffect(() => {
    void hydrateGame();
  }, [hydrateGame]);
  // il giro a metà, se c'è. Stesso link (la scheda riaperta dopo un crash): si chiede; con ?resume=1
  // si riprende; un giro diverso salva quello vecchio nel diario e parte, senza perdere niente
  const saveRide = useApp((s) => s.saveRide);
  // letto per questo link: da un giro all'altro senza uscire, la pedalata di prima si smonta (e mette
  // da parte il suo punto di ripresa) prima che si rilegga
  const rideKey = useMemo(() => rideSearch(params, ['room']), [params]);
  const [cpState, setCpState] = useState<{ key: string; cp: RideCheckpoint | null } | null>(null);
  const cp = cpState && cpState.key === rideKey ? cpState.cp : undefined;
  const setCp = (c: RideCheckpoint | null) => setCpState({ key: rideKey, cp: c });
  const [keptNote, setKeptNote] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadCheckpoint()
      .then((c) => alive && setCpState({ key: rideKey, cp: c }))
      .catch(() => alive && setCpState({ key: rideKey, cp: null }));
    return () => {
      alive = false;
    };
  }, [rideKey]);
  const resuming = params.get('resume') === '1';
  const same = !!cp && sameRide(cp, params);
  useEffect(() => {
    if (!cp || same) return;
    let alive = true;
    void saveRide(rideFromCheckpoint(cp))
      .then(() => clearCheckpoint())
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return;
        setKeptNote(true);
        setCp(null);
      });
    return () => {
      alive = false;
    };
  }, [cp, same, saveRide]);
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));
  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-lg">{error}</p>
          <Link to="/salite" className="mt-3 inline-flex h-11 items-center font-semibold text-accent">
            Salite
          </Link>
        </div>
      </div>
    );
  }
  if (cp && same && !resuming) {
    return (
      <LoadingVeil title={title} subtitle={subtitle} onBack={back} idle>
        <div className="mt-8 rounded-3xl bg-elev p-5" data-testid="ride-recovery-inline">
          <RecoveryCard cp={cp} onResume={() => navigate(resumePath(cp), { replace: true })} onDone={() => setCp(null)} saveLabel="Salvalo e riparti" />
        </div>
      </LoadingVeil>
    );
  }
  const kept = keptNote ? <p className="mt-6 text-sm text-muted" data-testid="ride-kept">Il giro di prima è nel diario</p> : null;
  if (cp === undefined || (cp && !same) || !setup || !gameReady) {
    return (
      <LoadingVeil title={title} subtitle={subtitle} onBack={back}>
        {kept}
      </LoadingVeil>
    );
  }
  const resume = cp && same && resuming ? cp : null;
  // un'altra strada (un link da un giro all'altro senza ricaricare) è un'altra pedalata: motore nuovo
  return <RideSession key={setupId(setup)} setup={setup} resume={resume} kept={kept} />;
}

const setupIds = new WeakMap<RideSetup, number>();
let nextSetupId = 0;
function setupId(setup: RideSetup): number {
  let id = setupIds.get(setup);
  if (id == null) {
    id = ++nextSetupId;
    setupIds.set(setup, id);
  }
  return id;
}

function RideSession({ setup, resume, kept }: { setup: RideSetup; resume: RideCheckpoint | null; kept?: ReactNode }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const custom = useApp((s) => s.workouts);
  const workoutId = params.get('workout');
  const workout = workoutId ? findWorkout(workoutId, custom) ?? null : null;
  const parts = useRef<{ engine: RideEngine; trainer: BluetoothTrainer; game: RideGame } | null>(null);
  if (!parts.current) {
    const trainer = new BluetoothTrainer();
    const replay = setup.replayMode === 'power' ? setup.replaySamples : undefined;
    const engine = new RideEngine({
      track: setup.route.track,
      source: trainer,
      physics: physicsFrom(profile),
      ftp: profile.ftp,
      maxHr: profile.maxHr,
      restHr: profile.restingHr,
      lthr: estimateLthr(profile.maxHr, profile.thresholdHr),
      weightKg: profile.weightKg,
      workout,
      withCamilla: false,
      crr: profile.crr,
      cw: profile.cda * 1.225,
      powerTarget: replay ? (elapsed) => powerAtTime(replay, elapsed) : undefined,
      // la traccia GPS vera nel FIT: dalla posa sulla strada, riproiettata sull'origine del mondo
      geoAt: geoFor(setup.route),
    });
    // un giro ripreso torna dov'era; ?at=metri parte da un punto della salita (per riprendere un tratto)
    const at = Number(params.get('at'));
    if (resume) engine.restore(resume.engine);
    else if (Number.isFinite(at) && at > 0) engine.distance = Math.min(at, setup.route.track.length - 1);
    // la sessione vale solo sul suo percorso
    const def = sessionById(params.get('session') ?? '');
    const sessionDef = def && setup.world?.session.ride?.id === def.rideId ? def : null;
    const climb = !setup.world && setup.routeId && !setup.replayMode ? routeMeta(setup.routeId) : undefined;
    const game = new RideGame({
      engine,
      track: setup.route.track,
      world: setup.world ?? null,
      climb: climb ? { routeId: climb.id, name: `${climb.name} ${climb.side}` } : null,
      sessionDef,
      nick: profile.name,
      weightKg: profile.weightKg,
      pbs: useGame.getState().career.pbs,
      sim: () => trainer.snapshot().mode === 'simulator',
      scale: () => (trainer.snapshot().mode === 'simulator' ? engine.timeScale : 1),
      ranked: !setup.replayMode && !workout,
    });
    if (resume) {
      // i tratti, i punti caldi, il dislivello e i luoghi di prima valgono ancora; si riparte in pausa
      game.restore(resume.game);
      const ws = setup.world?.session;
      if (ws && resume.world) {
        ws.gainM = resume.world.gainM;
        for (const id of resume.world.passed) ws.passed.add(id);
      }
      engine.pause();
    }
    parts.current = { engine, trainer, game };
  }
  const { engine, trainer, game } = parts.current;
  // il mondo pronto: prima il tempo non corre e i tratti non partono (rideFrame)
  const ready = useRef(false);
  const markReady = useCallback(() => {
    ready.current = true;
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      rideFrame(engine, setup.world, game, dt, ready.current);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      trainer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, trainer]);

  return (
    <RideScreen
      engine={engine}
      trainer={trainer}
      game={game}
      profile={profile}
      workout={workout}
      quality={settings.quality}
      setup={setup}
      t={t}
      resume={resume}
      onReady={markReady}
      kept={kept}
    />
  );
}

/** Una media query, viva: l'orientamento e la larghezza decidono la misura della cartina. */
function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/**
 * Sul largo il pannello dei numeri galleggia sopra il 3D: quanto è alto (e quanto è largo il
 * simulatore accanto all'altimetria) lo dicono due variabili CSS sul palco, misurate dal vero.
 */
function useStageVars(stage: RefObject<HTMLDivElement | null>, dock: RefObject<HTMLElement | null>, sim: RefObject<HTMLElement | null>, simOn: boolean) {
  useLayoutEffect(() => {
    const st = stage.current;
    const dk = dock.current;
    if (!st || !dk) return;
    const mq = window.matchMedia('(orientation: landscape)');
    const apply = () => {
      const wide = mq.matches;
      st.style.setProperty('--dock', wide ? `${Math.ceil(dk.getBoundingClientRect().height) + 8}px` : '0px');
      const s = sim.current;
      st.style.setProperty('--simw', wide && s ? `${Math.ceil(s.getBoundingClientRect().width) + 8}px` : '0px');
    };
    const ro = new ResizeObserver(apply);
    ro.observe(dk);
    if (sim.current) ro.observe(sim.current);
    mq.addEventListener('change', apply);
    apply();
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', apply);
    };
  }, [stage, dock, sim, simOn]);
}

/** Montato finché esce: quello che entra in dissolvenza esce in dissolvenza, e intanto non si tocca. */
function useFade(open: boolean, ms = 220): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const id = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(id);
  }, [open, ms]);
  return { mounted, shown };
}

function RideScreen({
  engine,
  trainer,
  game,
  profile,
  workout,
  quality,
  setup,
  t,
  resume,
  onReady,
  kept,
}: {
  engine: RideEngine;
  trainer: BluetoothTrainer;
  game: RideGame;
  profile: Profile;
  workout: Workout | null;
  quality: Quality;
  setup: RideSetup;
  t: Translate;
  resume: RideCheckpoint | null;
  onReady: () => void;
  kept?: ReactNode;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const updateSettings = useApp((s) => s.updateSettings);
  const saveRide = useApp((s) => s.saveRide);
  const deleteRide = useApp((s) => s.deleteRide);
  const updateProfile = useApp((s) => s.updateProfile);
  const [, bump] = useState(0);
  const look = useLook();
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  // l'avanzamento del mondo, da 0 a 1, da WorldScene (onProgress): finché non arriva, la barra è indeterminata
  const [worldProgress, setWorldProgress] = useState<number | undefined>(undefined);
  const [webgl, setWebgl] = useState(true);
  const [sensorsOpen, setSensorsOpen] = useState(false);
  const [effort, setEffort] = useState(() => Math.round(engine.effort * 100));
  const [summary, setSummary] = useState<Ride | null>(null);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'failed'>('saving');
  const [ftpApplied, setFtpApplied] = useState(false);
  const summaryRef = useRef<Ride | null>(null);
  const savedRef = useRef<Promise<void>>(Promise.resolve());
  const readyRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const simRef = useRef<HTMLDivElement>(null);
  const wide = useMedia('(orientation: landscape)');
  const big = useMedia('(min-width: 1024px)');

  const goLive = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady();
    setReady(true);
  }, [onReady]);
  const veil = useFade(!ready, 260);

  useEffect(() => engine.subscribe(() => bump((n) => n + 1)), [engine]);
  useEffect(() => trainer.subscribe(() => bump((n) => n + 1)), [trainer]);
  // il mondo che non arriva (rete lenta, niente mattonelle): dopo un po' si può partire lo stesso
  useEffect(() => {
    if (ready) return;
    const id = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(id);
  }, [ready]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.target instanceof HTMLInputElement || !readyRef.current || summaryRef.current) return;
      event.preventDefault();
      if (engine.phase === 'riding') engine.pause();
      else if (engine.phase === 'paused') engine.resume();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const zone = powerZone(engine.power3s, engine.ftp);
  const progress = engine.workout && !engine.workoutDone ? workoutAt(engine.workout, engine.elapsed, engine.ftp) : null;
  const step = progress && engine.workout ? engine.workout.steps[progress.stepIndex] : undefined;
  const snap = trainer.snapshot();
  const sim = snap.mode === 'simulator';
  const support = bluetoothSupport();
  const modeLabel = setup.replayMode === 'power' ? 'Watt di allora' : setup.replayMode === 'grade' ? 'Pendenza di allora' : setup.replayMode === 'ghost' ? 'Fantasma' : null;
  const rideName = resume?.name ?? (workout ? `${workoutTitle(workout, t)} · ${setup.label}` : modeLabel ? `${modeLabel} · ${setup.label}` : setup.label);
  const track = setup.route.track;
  const ghostSamples = setup.ghostSamples;
  // la traccia ricostruita e il file possono differire di qualche metro: si scala sulla lunghezza
  const ghostScale = useMemo(() => {
    const total = ghostSamples?.[ghostSamples.length - 1]?.distance ?? 0;
    return total > 0 ? track.length / total : 1;
  }, [ghostSamples, track]);
  const ghostDistance = useMemo(
    () => (ghostSamples && ghostSamples.length > 1 ? () => ghostDistanceAt(ghostSamples, engine.elapsed) * ghostScale : undefined),
    [ghostSamples, ghostScale, engine],
  );
  // il tuo fantasma sui percorsi del mondo, sui tratti e sulle salite (src/game/ghosts.ts)
  const ghosts = useRideGhosts({ engine, game, session: setup.world?.session ?? null, enabled: !setup.replayMode && !workout && !ghostSamples, sim: () => trainer.snapshot().mode === 'simulator' });
  const own = ghosts.now();
  const gap = ghostSamples && ghostSamples.length > 1 ? gapSeconds(ghostSamples, engine.distance / ghostScale, engine.elapsed) : (own?.gap ?? null);
  const hairpinsDone = track.hairpins.filter((h) => h.distance <= engine.distance).length;
  // un arco (traguardo, km, ERG) fra 15 e 110 m: la colonna dei tratti si fa trasparente, e l'arco si legge
  const archNear = !game.banner && game.arches.some((a) => a.role !== 'banner' && a.d != null && a.d - engine.distance > 15 && a.d - engine.distance < 110);
  const room = useRoom(setup.routeId, engine, profile.name);
  const riders = room.snap?.riders;
  const riderKey = riders?.map((r) => `${r.id}:${r.color}:${r.nick}`).join('|') ?? '';
  const remote = useMemo(() => {
    const client = room.client;
    if (!client || !riders) return undefined;
    return {
      source: { riders: () => client.remote(), colors: RIDER_COLORS },
      list: riders.map((r) => ({ id: r.id, nick: r.nick, color: r.color })),
    };
    // la lista cambia solo quando qualcuno entra o esce, non a ogni aggiornamento
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.client, riderKey]);
  // ---------- mondo aperto ----------
  const world = setup.world;
  const session = world?.session ?? null;
  const [share, setShare] = useState(readShare);
  const [loopOpen, setLoopOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [far, setFar] = useState<Float32Array | null>(null);
  const [worldColor, setWorldColor] = useState<number | null>(null);
  const [peers, setPeers] = useState<{ id: string; nick: string; color: number }[]>([]);
  const [xp, setXp] = useState<{ lines: XpLine[]; total: number; level: ReturnType<typeof levelOf> & { xp: number }; rank: string | null; rankNote?: string } | null>(null);
  const terrainField = useMemo(() => {
    if (!world) return null;
    const terrain = new Terrain(world.data.graph);
    return { terrain, field: createWorldField(world.data.graph, terrain, world.data.features) };
  }, [world]);
  const weatherMode = useApp((s) => s.settings.weather);
  const daytime = useApp((s) => s.settings.daytime);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  useEffect(() => {
    if (!world || !session) return;
    if (weatherMode !== 'vero') {
      session.weather = null;
      setWeather(null);
      return;
    }
    let alive = true;
    void fetchWeather(world.data.graph.origin.lat, world.data.graph.origin.lon).then((w) => {
      if (!alive) return;
      session.weather = w;
      setWeather(w);
    });
    return () => {
      alive = false;
    };
  }, [world, session, weatherMode]);
  useEffect(() => {
    if (!session || !share || !world) return;
    const client = new WorldClient({ world: world.data.graph.id, nick: profile.name || 'Ciclista' });
    session.client = client;
    let key = '';
    const off = client.subscribe(() => {
      const list = [...client.remote().values()].filter((r) => r.at > 0).map((r) => ({ id: r.id, nick: r.nick, color: r.color }));
      const k = list.map((r) => `${r.id}:${r.color}:${r.nick}`).join('|');
      if (k !== key) {
        key = k;
        setPeers(list);
      }
      setWorldColor(client.color);
    });
    client.connect();
    return () => {
      off();
      client.leave();
      session.client = null;
      setPeers([]);
    };
  }, [session, share, world, profile.name]);
  const worldRemote = useMemo<RemoteWorldRider[]>(() => {
    if (!session) return [];
    const real = peers.map((p) => ({ id: p.id, nick: p.nick, color: RIDER_COLORS[p.color % RIDER_COLORS.length], pose: () => session.remoteNow.get(p.id) ?? null }));
    // il gruppo della sessione pedala nel mondo come gli altri, col nome sopra
    const pack = game.pack;
    const pacers = pack ? pack.pacers.map((p) => ({ id: p.id, nick: p.name, color: p.color, pose: () => pack.pose(p) })) : [];
    return [...real, ...pacers];
  }, [session, peers, game]);
  const playerPose = useMemo(() => () => session?.pose ?? engine.pose(), [session, engine]);
  const nextTurn = useMemo(() => () => session?.arrow(engine.distance) ?? null, [session, engine]);

  // ---------- il giro non si perde: punti di ripresa e salvataggio al «Termina» ----------
  const nameRef = useRef(rideName);
  nameRef.current = rideName;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const keeper = useMemo(
    () =>
      new RideKeeper(
        engine,
        {
          name: () => nameRef.current,
          where: () => {
            const s = setup.world?.session;
            // fuori dal percorso (o nel giro libero) si riparte dal punto di adesso: la strada fatta resta nei km
            if (s && (!s.onRoute || s.rejoined || s.routeEnd != null)) {
              const q = new URLSearchParams(rideSearch(paramsRef.current, ['ride', 'plan', 'session', 'edge', 's', 'dir']));
              const at = s.path.edgeAt(engine.distance);
              q.set('edge', String(at.edge));
              q.set('s', String(Math.round(at.s)));
              q.set('dir', String(at.dir));
              return { search: q.toString(), rebase: true };
            }
            return { search: rideSearch(paramsRef.current), rebase: false };
          },
          ftp: profile.ftp,
          lthr: estimateLthr(profile.maxHr, profile.thresholdHr),
          workoutId: workout?.id,
          routeId: () => {
            const s = setup.world?.session;
            if (s?.ride && s.rankable && engine.arrived) return `${setup.world!.data.graph.id}:${s.ride.id}`;
            if (setup.routeId && !workout && !setup.replayMode) return setup.routeId;
            return undefined;
          },
          game: () => ({ results: game.results.slice(), pois: game.poisPassed.slice() }),
          world: setup.world ? () => ({ gainM: setup.world!.session.gainM, passed: [...setup.world!.session.passed] }) : undefined,
        },
        (ride) => saveRide(ride),
      ),
    // il giro è questo dall'inizio alla fine: profilo e allenamento non cambiano a metà
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, game, setup],
  );
  useEffect(() => {
    if (!ready) return;
    const save = () => {
      if (!summaryRef.current) void keeper.checkpoint().catch(() => undefined);
    };
    const id = window.setInterval(save, CHECKPOINT_EVERY_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', save);
    // in pausa si mette da parte subito: è lì che si chiude la scheda
    let phase = engine.phase;
    const off = engine.subscribe(() => {
      if (engine.phase === phase) return;
      phase = engine.phase;
      if (phase === 'paused') save();
    });
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
      off();
      // si esce dalla corsa senza «Termina» (il tasto indietro del telefono): resta il punto di ripresa
      save();
    };
  }, [ready, keeper, engine]);

  // quanto è già stato contato: «Continua a pedalare» dopo il riepilogo non conta due volte
  const committed = useRef({ distance: 0, sample: 0, elapsed: 0, results: 0, gain: 0, pois: 0 });
  const [rewards, setRewards] = useState<{ outcome: CareerOutcome; results: SegmentResult[] } | null>(null);
  const setGameProgress = useGame((s) => s.setProgress);
  const setCareer = useGame((s) => s.setCareer);

  /** Punti, livello e, se vale, il tempo del percorso in classifica. Poi oro e traguardi. */
  async function commitProgress(): Promise<void> {
    const c = committed.current;
    const sim = snap.mode === 'simulator';
    const climbId = !session && setup.routeId && engine.arrived && !setup.replayMode && !workout ? setup.routeId : undefined;
    // un allenamento più lungo del percorso prosegue libero: il percorso è fatto quando si passa la sua fine
    const routeFinished = !!session && (engine.arrived || (session.routeEnd != null && engine.distance >= session.routeEnd));
    const completed = session ? routeFinished && session.rankable : !!climbId;
    // dislivello: il mondo lo conta da sé; sulle salite e nei replay dai campioni
    const fresh = engine.samples.slice(c.sample);
    let climbGain = 0;
    for (let i = 1; i < fresh.length; i++) climbGain += Math.max(0, fresh[i].altitude - fresh[i - 1].altitude);
    const gainM = session ? session.gainM - session.committedGain : climbGain;
    const landmarks = session ? [...session.passed].filter((id) => !session.committedLandmarks.has(id)) : [];
    const prev = await loadProgress();
    const out = applyRide(prev, {
      rideId: session ? session.ride?.id : climbId ? `salita:${climbId}` : undefined,
      completed,
      // con un allenamento il tempo non è quello del percorso: niente record
      sec: completed && !workout ? engine.elapsed : undefined,
      sim,
      distanceM: engine.odometer - c.distance,
      gainM,
      landmarks,
    });
    session?.markCommitted(engine.distance);
    await setGameProgress(out.next);
    const total = out.lines.reduce((a, l) => a + l.xp, 0);
    let rank: string | null = null;
    let rankNote: string | undefined;
    if (session?.ride && workout) rankNote = 'Con un allenamento il tempo non va in classifica.';
    else if (session && completed && session.ride && profile.name) {
      const avg = engine.samples.length ? engine.samples.reduce((a, x) => a + x.power, 0) / engine.samples.length : engine.power3s;
      const res = await postResult({ nick: profile.name, ride: session.ride.id, sec: engine.elapsed, wkg: profile.weightKg > 0 ? avg / profile.weightKg : 0, sim });
      if (res.ok && res.rank) rank = `${res.rank}° in classifica${sim ? ' (simulatore)' : ''}${res.best ? ', il tuo tempo migliore' : ''}`;
      else if (res.error === 'implausible') rankNote = 'Tempo troppo veloce per essere vero: non va in classifica.';
      else if (res.error === 'rete') rankNote = 'Senza rete: il tempo resta qui, non in classifica.';
    } else if (session?.ride && !completed) rankNote = session.offRoute || session.rejoined ? 'Sei uscito dal percorso: il tempo non va in classifica.' : 'Percorso non finito: niente tempo in classifica.';
    if (profile.name) void postXp(out.next, profile.name);
    setXp({ lines: out.lines, total, level: { ...levelOf(out.next.xp), xp: out.next.xp }, rank, rankNote });

    // la carriera: oro, record, missioni, traguardi
    const powers = fresh.map((s) => s.power);
    const results = game.results.slice(c.results);
    const origin = world?.data.graph.origin;
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
      rain: !!session && weatherMode === 'vero' && (weather?.rain ?? 0) >= 0.1,
      night: !!origin && sunFor(daytime, new Date(), origin.lat, origin.lon).night,
      session: game.sessionDef ? { id: game.sessionDef.id, kind: game.sessionDef.kind, finished: game.stage === 'arrivo', withPack: game.pack ? game.withPack : 1 } : undefined,
      workoutDone: engine.workoutDone,
      together: (room.snap?.riders.length ?? 0) > 0 || peers.length > 0,
      level: levelOf(out.next.xp).level,
      extra: sessionBonus(game, results),
    };
    const outcome = applyCareer(useGame.getState().career, facts);
    // il tempo del percorso intero, per i record della pagina Classifiche
    if (facts.worldRideDone && !workout) {
      const key = `w:${facts.worldRideDone}`;
      const old = outcome.next.pbs[key];
      if (!old || engine.elapsed < old.sec) outcome.next.pbs[key] = { sec: Math.round(engine.elapsed), at: new Date().toISOString(), sim, count: (old?.count ?? 0) + 1 };
    }
    await setCareer(outcome.next);
    committed.current = { distance: engine.odometer, sample: engine.samples.length, elapsed: engine.elapsed, results: game.results.length, gain: 0, pois: game.poisPassed.length };
    setRewards({ outcome, results });
  }

  // dove sei, per aprire la strada vera nel visore ufficiale (non per disegnarla nel 3D)
  const pose = engine.pose();
  const here = setup.route.id !== 'neutral' ? projector(setup.route.origin).toGeo(pose.x, pose.z) : null;
  const bearing = headingToBearing(pose.heading);

  /** Fine giro: il giro va nel diario da solo, il riepilogo dice che è salvato. */
  function finish() {
    if (summaryRef.current) return;
    const { ride, saved } = keeper.finish();
    summaryRef.current = ride;
    savedRef.current = saved.catch(() => undefined);
    setSummary(ride);
    setSaveState('saving');
    setRewards(null);
    saved.then(
      () => setSaveState('saved'),
      () => setSaveState('failed'),
    );
    void commitProgress();
  }

  const closeMap = useCallback(() => setMapOpen(false), []);
  useEffect(() => {
    if (!mapOpen || far || !terrainField) return;
    let alive = true;
    void terrainField.terrain.loadFar().then((h) => alive && setFar(h));
    return () => {
      alive = false;
    };
  }, [mapOpen, far, terrainField]);

  useEffect(() => {
    if (engine.arrived && !summary) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const paused = engine.phase === 'paused' && game.stage !== 'griglia';
  const pauseFade = useFade(ready && paused && !summary, 220);
  const simOn = sim && !summary;
  useStageVars(stageRef, dockRef, simRef, simOn);
  const onRoute = !session || session.onRoute;
  const kmLeft = Math.max(0, track.length - engine.distance);
  const turning = !!session?.junction && session.junction.dist <= 220 && engine.phase !== 'finished';
  const mini = big && wide ? 132 : wide ? 88 : 96;
  const where = session
    ? cap([session.placeName(), session.roadLabel(engine.distance), `${formatNumber(engine.altitude, 0)} m`].filter(Boolean).join(' · '))
    : cap([modeLabel, !setup.route.verified ? 'traccia non verificata' : `${formatNumber(engine.altitude, 0)} m`, track.hairpins.length > 0 ? `tornanti ${hairpinsDone}/${track.hairpins.length}` : ''].filter(Boolean).join(' · '));

  const settingsPanel = (
    <details className="group rounded-2xl border border-line bg-bg/60 text-left" data-testid="ride-settings">
      <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold">
        Impostazioni
        <span aria-hidden="true" className="text-muted transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4">
        {session ? (
          <label className="mb-3 flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-semibold">Mostrami agli altri nel mondo</span>
              <span className="block text-xs text-muted">Nome, posizione nel mondo e watt. Niente GPS.</span>
            </span>
            <input
              type="checkbox"
              className="h-6 w-6 accent-[var(--accent)]"
              checked={share}
              onChange={(e) => {
                setShare(e.target.checked);
                writeShare(e.target.checked);
              }}
              data-testid="world-share"
            />
          </label>
        ) : null}
        <Segmented<Quality>
          label={t('ride.quality')}
          value={quality}
          onChange={(next) => void updateSettings({ quality: next })}
          options={[
            { value: 'low', label: t('quality.low') },
            { value: 'medium', label: t('quality.medium') },
            { value: 'high', label: t('quality.high') },
          ]}
        />
        {session ? (
          <>
            <div className="mt-3">
              <Segmented<Settings['weather']>
                label="Meteo"
                value={weatherMode}
                onChange={(next) => void updateSettings({ weather: next })}
                options={[
                  { value: 'vero', label: 'Vero, col vento' },
                  { value: 'sereno', label: 'Sempre sereno' },
                ]}
              />
            </div>
            <div className="mt-3">
              <Segmented<Settings['daytime']>
                label="Luce"
                value={daytime}
                onChange={(next) => void updateSettings({ daytime: next })}
                options={[
                  { value: 'vera', label: 'Adesso' },
                  { value: 'mattina', label: 'Mattina' },
                  { value: 'mezzogiorno', label: 'Mezzodì' },
                  { value: 'sera', label: 'Tramonto' },
                ]}
              />
            </div>
          </>
        ) : null}
        {here ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a
              href={streetViewUrl(here, bearing)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-11 items-center justify-center rounded-full bg-elev2 px-3 text-sm font-semibold"
              data-testid="street-view"
            >
              La strada vera ↗
            </a>
            <a href={mapillaryUrl(here)} target="_blank" rel="noreferrer noopener" className="inline-flex h-11 items-center justify-center rounded-full bg-elev2 px-3 text-sm font-semibold">
              Mapillary ↗
            </a>
          </div>
        ) : null}
      </div>
    </details>
  );

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg landscape:block" data-testid="ride-screen" data-ready={ready ? 'yes' : 'no'}>
      {/* il palco: il 3D, e sopra quello che serve in sella. In verticale sta sopra i numeri, sul largo è tutto lo schermo */}
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 [--dock:0px] [--simw:0px] landscape:absolute landscape:inset-0"
        style={{ '--mini': `${mini}px` } as CSSProperties}
        data-testid="ride-stage"
      >
        <WorldBoundary
          onFail={() => {
            setWebgl(false);
            goLive();
          }}
        >
          {webgl && world && session && terrainField ? (
            <WorldScene
              key={quality}
              engine={engine}
              data={world.data}
              path={session.path}
              field={terrainField.field}
              terrain={terrainField.terrain}
              quality={quality}
              crowd={session.crowd}
              remote={worldRemote}
              selfColor={worldColor != null ? RIDER_COLORS[worldColor % RIDER_COLORS.length] : undefined}
              nextTurn={nextTurn}
              playerPose={playerPose}
              onReady={goLive}
              onProgress={setWorldProgress}
              weather={weather}
              daytime={daytime}
              ride={session.onRoute ? session.ride : null}
              arches={game.arches}
              look={look}
              ghost={ghosts.pose}
            />
          ) : webgl ? (
            <RideScene
              key={quality}
              engine={engine}
              route={setup.route}
              quality={quality}
              ghostDistance={ghostDistance ?? ghosts.trackDistance}
              remote={remote}
              selfColor={room.snap?.color != null ? RIDER_COLORS[room.snap.color % RIDER_COLORS.length] : undefined}
              onReady={goLive}
              arches={game.arches}
              look={look}
            />
          ) : (
            <div className="grid h-full place-items-center bg-elev p-6 text-center text-muted">{t('ride.webgl')}</div>
          )}
        </WorldBoundary>

        {ready ? (
          <>
            {/* in alto: chi sei, dove sei, e sotto il titolo quello che sta succedendo adesso */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/40 to-transparent px-2.5 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  aria-label="Pausa e uscita"
                  data-testid="ride-back"
                  className="pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-full bg-bg/70 backdrop-blur-md"
                  onClick={() => engine.pause()}
                >
                  <BackIcon />
                </button>
                <div className="min-w-0 flex-1 rounded-[1.375rem] bg-bg/70 px-3.5 py-1.5 backdrop-blur-md landscape:max-w-[40rem]" data-testid="ride-route">
                  <p className="break-words font-display text-lg uppercase leading-tight lg:text-2xl">{setup.route.title}</p>
                  <p className="break-words text-[13px] leading-tight text-muted lg:text-[15px]" data-testid="ride-where">
                    {where}
                    {session && engine.aero < 0.93 ? <span className="font-semibold text-good"> · In scia −{Math.round((1 - engine.aero) * 100)}% aria</span> : null}
                    {session && engine.rolling > 1.2 ? <span className="text-warn"> · {engine.rolling > 2 ? 'Sterrato' : 'Porfido'}</span> : null}
                  </p>
                </div>
                {room.available ? (
                  <button
                    type="button"
                    aria-label="Pedala insieme"
                    data-testid="room-open"
                    className={cn('pointer-events-auto relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-bg/70 backdrop-blur-md landscape:ml-auto', room.client && 'text-accent ring-2 ring-accent ring-inset')}
                    onClick={() => room.setSheet(true)}
                  >
                    <PeopleIcon />
                    {room.snap && room.snap.riders.length > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-bg px-1 text-[11px] font-bold text-ink">{room.snap.riders.length + 1}</span>
                    ) : null}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={snap.mode === 'bluetooth' ? snap.deviceName || t('ride.connected') : t('ride.simulator')}
                  className={`pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-full backdrop-blur-md ${room.available ? '' : 'landscape:ml-auto'} ${snap.mode === 'bluetooth' && snap.status === 'connected' ? 'bg-good/30 text-good' : 'bg-bg/70'}`}
                  onClick={() => setSensorsOpen(true)}
                  data-testid="ride-sensors"
                >
                  {snap.mode === 'bluetooth' ? <BleIcon /> : <SimIcon />}
                </button>
              </div>
              <div className="mt-2 flex items-start justify-between gap-2">
                <div
                  className={`flex min-w-0 max-w-[15.5rem] flex-col items-start gap-1.5 transition-opacity duration-300 lg:max-w-[20rem] ${archNear ? 'opacity-25' : ''}`}
                  data-testid="ride-hud-center"
                >
                  <SessionHud game={game} />
                  <SegmentHud game={game} />
                  <ErgAheadHud game={game} />
                  {game.poiToast ? <PoiToast game={game} /> : session ? <Toasts session={session} /> : null}
                  {setup.note ? <p className="rounded-2xl bg-bg/75 px-3 py-1.5 text-xs font-semibold text-warn backdrop-blur-md">{setup.note}</p> : null}
                  {engine.workoutDone ? <p className="rounded-2xl bg-bg/75 px-3 py-1.5 text-xs font-semibold text-good backdrop-blur-md">Allenamento finito: pedala libero</p> : null}
                  {snap.mode === 'bluetooth' && snap.status === 'connected' && engine.power <= 0 && engine.phase === 'riding' ? (
                    <p className="rounded-2xl bg-bg/75 px-3 py-1.5 text-xs font-semibold text-warn backdrop-blur-md">{t('ride.waiting')}</p>
                  ) : null}
                  {snap.mode === 'bluetooth' && snap.status === 'disconnected' ? (
                    <p className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-bg/80 pl-3 pr-1 text-xs font-semibold text-warn backdrop-blur-md" role="status">
                      Sensore perso
                      <button type="button" className="h-11 rounded-full px-3 font-semibold text-ink underline" onClick={() => setSensorsOpen(true)}>
                        {t('ride.reconnect')}
                      </button>
                    </p>
                  ) : null}
                </div>
                <div className={cn('flex shrink-0 flex-col items-end gap-1.5', session && 'landscape:pt-[calc(var(--mini)+0.5rem)]')} data-testid="ride-hud-right">
                  {session ? <WeatherChip session={session} engine={engine} /> : null}
                  {gap != null ? (
                    <p className="rounded-xl px-2.5 py-1 text-xs font-semibold backdrop-blur-md" style={gapStyle(gap)} data-testid="ghost-gap">
                      {gapLabel(gap, own?.of)}
                    </p>
                  ) : null}
                  {session && session.offRoute ? (
                    <button
                      type="button"
                      className="pointer-events-auto h-11 rounded-full bg-bg/75 px-3.5 text-sm font-semibold text-accent ring-2 ring-accent ring-inset backdrop-blur-md"
                      onClick={() => session.rejoin(engine.distance)}
                      data-testid="world-rejoin"
                    >
                      Torna sul percorso
                    </button>
                  ) : null}
                  {session && !session.planned ? (
                    <button type="button" className="pointer-events-auto h-11 rounded-full bg-bg/75 px-3.5 text-sm font-semibold backdrop-blur-md" onClick={() => setLoopOpen(true)} data-testid="world-loop-here">
                      Anello da qui
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {/* in basso, sopra l'altimetria: l'incrocio quando arriva, se no chi c'è intorno; a destra la cartina */}
            <div
              className={cn(
                'pointer-events-none absolute bottom-[calc(var(--dock)+3.75rem)] left-2.5 z-10 flex items-end landscape:right-[45%]',
                session ? 'right-[calc(var(--mini)+1.25rem)]' : 'right-2.5',
              )}
              data-testid="ride-hud-bottom"
            >
              {session ? turning ? <TurnPicker session={session} engine={engine} /> : <Nearby session={session} /> : null}
              {room.snap ? <RoomPanel snap={room.snap} myDistance={engine.distance} onOpen={() => room.setSheet(true)} /> : null}
            </div>
            {session ? (
              <div className="absolute bottom-[calc(var(--dock)+3.75rem)] right-2.5 z-10 landscape:bottom-auto landscape:top-[4.5rem]">
                <WorldMini session={session} size={mini} onOpen={() => setMapOpen(true)} />
              </div>
            ) : null}
            <div className="pointer-events-none absolute bottom-[calc(var(--dock)+0.5rem)] left-2.5 right-[calc(var(--simw)+0.625rem)] z-10 rounded-xl bg-bg/55 p-1 backdrop-blur-md" data-testid="ride-profile">
              {session && !session.onRoute ? (
                <AheadProfile session={session} engine={engine} />
              ) : (
                <ProfileChart
                  key={session ? session.path.version : 0}
                  track={track}
                  className="block h-9 w-full"
                  height={36}
                  bin={Math.max(100, track.length / 80)}
                  position={engine.distance}
                  ghost={ghostDistance ? ghostDistance() : ghosts.distance()}
                  marks={game.tracker.windows.map((w) => ({ from: w.from, to: w.to, color: SEGMENT_STYLE[w.seg.kind].color }))}
                />
              )}
            </div>
            <SessionGrid game={game} />
          </>
        ) : null}

        {pauseFade.mounted ? (
          <PauseVeil
            engine={engine}
            shown={pauseFade.shown}
            onResume={() => engine.resume()}
            onFinish={finish}
          >
            {settingsPanel}
          </PauseVeil>
        ) : null}

        <span data-testid="world-ready" data-ready={ready ? 'yes' : 'no'} className="sr-only" />
        <span data-testid="room-3d" data-count={remote?.list.length ?? 0} className="sr-only" />
        {/* gli archi sulla strada adesso (traguardi, km, ERG): per il collaudo, non si vede */}
        <span data-testid="ride-arches" data-list={game.arches.map((a) => `${a.kind}:${a.role}:${a.label}@${Math.round(a.d ?? -1)}`).join('|')} className="sr-only" />
      </div>

      {/* i numeri: watt, tempo e km grandi, il resto in una riga; Pausa e Termina sempre a portata */}
      <section
        ref={dockRef}
        className="relative z-20 shrink-0 border-t border-line bg-elev px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 landscape:absolute landscape:inset-x-2 landscape:bottom-2 landscape:rounded-2xl landscape:border landscape:bg-bg/72 landscape:px-3 landscape:py-2 landscape:backdrop-blur-md"
        data-testid="ride-dock"
      >
        {progress && engine.workout ? (
          <div className="mb-2 landscape:mb-1.5 landscape:flex landscape:items-center landscape:gap-4" data-testid="erg-row">
            <div className="flex items-end justify-between gap-3 landscape:shrink-0">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent" data-testid="erg-target">
                  {t('ride.erg')} {formatNumber(engine.targetPower, 0)} {t('units.watt')}
                </p>
                <p className="font-display text-xl leading-none">
                  {step ? stepLabel(step, t) : ''}
                  {step?.cadence ? <span className="num ml-1.5 font-sans text-sm font-semibold text-muted">{step.cadence} rpm</span> : null}
                </p>
              </div>
              <p className="num font-display text-[28px] leading-none" data-testid="interval-clock">
                {formatDuration(progress.stepRemaining)}
              </p>
            </div>
            <div className="mt-1.5 landscape:mt-0 landscape:min-w-0 landscape:flex-1 [&_svg]:h-8">
              <WorkoutChart workout={engine.workout} ftp={engine.ftp} elapsed={engine.elapsed} />
            </div>
          </div>
        ) : null}
        <div className="landscape:flex landscape:items-center landscape:gap-5">
          <dl className={cn('grid grid-cols-3 gap-2 transition-opacity duration-200 landscape:flex landscape:shrink-0 landscape:gap-6', paused && 'opacity-45')} data-testid="ride-numbers">
            <div className="min-w-0">
              <dt className="sr-only">{t('units.watt')} 3 s</dt>
              <dd className="num font-display text-[38px] leading-none lg:text-[48px]" style={{ color: paused ? undefined : zone.color }}>
                <span data-testid="ride-power" data-big="">
                  {paused ? '–' : formatNumber(engine.power3s, 0)}
                </span>
                <span className="ml-0.5 font-sans text-sm font-semibold text-muted">W</span>
              </dd>
              <dd className="mt-0.5 text-xs font-semibold leading-tight" style={{ color: paused ? undefined : zone.color }}>
                Z{zone.zone} · <span className="num text-ink/80">{formatNumber(engine.wkg(), 1)} W/kg</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="sr-only">{t('metrics.time')}</dt>
              <dd className="num font-display text-[38px] leading-none lg:text-[48px]" data-testid="ride-time" data-big="">
                {formatDuration(engine.elapsed)}
              </dd>
              <dd className="mt-0.5 text-xs leading-tight text-muted">Tempo</dd>
            </div>
            <div className="min-w-0" data-testid="ride-km">
              <dt className="sr-only">{t('metrics.distance')}</dt>
              <dd className="num font-display text-[38px] leading-none lg:text-[48px]" data-big="">
                {formatKm(onRoute ? kmLeft : engine.odometer)}
              </dd>
              <dd className="mt-0.5 text-xs leading-tight text-muted">{onRoute ? 'km all’arrivo' : 'km fatti'}</dd>
            </div>
          </dl>
          <p className={cn('num mt-1.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[15px] leading-tight landscape:mt-0 landscape:grid landscape:min-w-0 landscape:flex-1 landscape:grid-cols-[auto_auto] landscape:justify-start landscape:gap-x-3 landscape:gap-y-0.5 lg:landscape:flex lg:landscape:gap-x-4', paused && 'opacity-45')} data-testid="ride-secondary">
            <span>
              <span className="font-semibold">{paused ? '–' : formatNumber(msToKmh(engine.speed), 1)}</span> <span className="text-xs text-muted">{t('units.kmh')}</span>
            </span>
            <span className="font-semibold">{formatGrade(engine.grade)}</span>
            <span>
              <span className="font-semibold">{paused ? '–' : formatNumber(engine.cadence, 0)}</span> <span className="text-xs text-muted">{t('units.rpm')}</span>
            </span>
            <span>
              <span className="text-xs text-muted">FC</span> <span className="font-semibold">{formatNumber(engine.hr, 0)}</span>
            </span>
            <span className="text-muted">{t(zone.nameKey)}</span>
          </p>
          <div className={cn('mt-2 flex flex-wrap gap-2 landscape:mt-0 landscape:shrink-0 landscape:flex-nowrap', (paused || !ready) && 'invisible')} data-testid="ride-controls">
            <Button
              variant="ghost"
              className="h-12 min-w-0 flex-1 landscape:w-28 landscape:flex-none"
              disabled={game.stage === 'griglia' || !ready}
              onClick={() => (engine.phase === 'paused' ? engine.resume() : engine.pause())}
            >
              {game.stage === 'griglia' ? 'In griglia' : t('actions.pause')}
            </Button>
            <HoldButton testid="ride-finish" className="h-12 min-w-0 flex-1 landscape:w-40 landscape:flex-none" disabled={!ready} onDone={finish}>
              {t('actions.finish')}
            </HoldButton>
            {simOn ? (
              <div
                ref={simRef}
                className={cn(
                  'flex items-center gap-2 landscape:absolute landscape:bottom-[calc(100%+0.5rem)] landscape:right-0 landscape:h-12 landscape:rounded-xl landscape:bg-bg/72 landscape:px-2 landscape:backdrop-blur-md',
                  engine.mode === 'free' ? 'basis-full landscape:w-[19rem]' : 'shrink-0',
                )}
                data-testid="sim-controls"
              >
                {engine.mode === 'free' ? (
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="text-xs text-muted">{t('ride.effort')}</span>
                    <input
                      aria-label={t('a11y.effort')}
                      className="h-11 min-w-0 flex-1 accent-[var(--accent)]"
                      type="range"
                      min={0}
                      max={160}
                      value={effort}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setEffort(value);
                        engine.effort = value / 100;
                      }}
                    />
                    <span className="num w-9 text-right text-xs">{effort}%</span>
                  </label>
                ) : null}
                <div className="grid shrink-0 grid-cols-3 gap-0.5 rounded-full bg-elev2 p-0.5" role="group" aria-label="Velocità del simulatore">
                  {[1, 4, 10].map((scale) => (
                    <button
                      key={scale}
                      type="button"
                      aria-pressed={engine.timeScale === scale}
                      className={`h-11 w-11 rounded-full text-sm font-semibold ${engine.timeScale === scale ? 'bg-accent text-accent-ink' : 'text-muted'}`}
                      onClick={() => {
                        engine.timeScale = scale;
                        bump((n) => n + 1);
                      }}
                    >
                      {scale}×
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {veil.mounted ? (
        <LoadingVeil
          title={setup.route.title}
          subtitle={setup.route.subtitle}
          progress={worldProgress}
          leaving={!veil.shown || ready}
          onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
        >
          {kept}
          {slow && !ready ? (
            <div className="mt-6 flex flex-col items-center gap-2">
              <p className="text-sm text-muted">Il mondo ci mette più del solito</p>
              <Button variant="ghost" data-testid="ride-start-anyway" onClick={goLive}>
                Parti lo stesso
              </Button>
            </div>
          ) : null}
        </LoadingVeil>
      ) : null}

      {sensorsOpen ? <SensorSheet trainer={trainer} supportReason={support.available ? undefined : support.reason} onClose={() => setSensorsOpen(false)} t={t} /> : null}
      {loopOpen && session ? <LoopSheet session={session} engine={engine} onClose={() => setLoopOpen(false)} /> : null}
      {mapOpen && session ? <MapSheet session={session} engine={engine} far={far} track={track} onClose={closeMap} /> : null}
      {room.sheet && room.available ? <RoomSheet handle={room} routeTitle={`${setup.route.title} ${setup.route.subtitle}`} onClose={() => room.setSheet(false)} /> : null}
      {summary ? (
        <RideSummary
          ride={summary}
          saveState={saveState}
          engine={engine}
          setup={setup}
          game={game}
          xp={xp}
          rewards={rewards}
          ftpApplied={ftpApplied}
          onApplyFtp={() => void updateProfile({ ftp: engine.estimatedFtp() ?? profile.ftp }).then(() => setFtpApplied(true))}
          onDone={() => void savedRef.current.then(() => navigate('/'))}
          onHistory={() => void savedRef.current.then(() => navigate(`/history/${summary.id}`))}
          onContinue={() => {
            engine.reopen();
            summaryRef.current = null;
            setSummary(null);
          }}
          onDiscard={() =>
            void savedRef.current
              .then(() => deleteRide(summary.id))
              .then(() => clearCheckpoint())
              .then(() => navigate('/'))
          }
          t={t}
        />
      ) : null}
    </div>
  );
}

/**
 * Il velo del caricamento: il marchio, il nome del percorso e l'avanzamento, opaco, finché il
 * mondo intorno non c'è. Niente strada grigia, niente ciclista che galleggia, niente orologio che
 * corre. `progress` (da 0 a 1) arriverà dal 3D; finché non c'è, l'avanzamento è indeterminato.
 */
export function LoadingVeil({
  title,
  subtitle,
  progress,
  leaving = false,
  idle = false,
  onBack,
  children,
}: {
  title?: string;
  subtitle?: string;
  progress?: number;
  leaving?: boolean;
  /** niente barra: il velo aspetta una risposta (il giro a metà) */
  idle?: boolean;
  onBack?: () => void;
  children?: ReactNode;
}) {
  // solo CSS, solo transform: mentre il 3D carica un fotogramma può restare occupato 400 ms, e
  // un'animazione in JS scatterebbe. Il compositore la porta avanti da solo
  const determinate = progress != null;
  const p = determinate ? Math.max(0.04, Math.min(1, progress)) : 0;
  return (
    <div
      className={cn('fixed inset-0 z-[60] flex flex-col overflow-auto bg-bg transition-opacity duration-200', leaving ? 'pointer-events-none opacity-0' : 'opacity-100')}
      data-testid="ride-loading"
      aria-busy={!leaving && !idle}
      inert={leaving || undefined}
    >
      <div className="flex h-14 shrink-0 items-center px-2.5 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {onBack ? (
          <button type="button" aria-label="Indietro" className="grid h-11 w-11 place-items-center rounded-full bg-elev2" onClick={onBack}>
            <BackIcon />
          </button>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-14 text-center">
        <div className="w-full max-w-sm">
          <Wordmark className="text-2xl" />
          {title ? (
            <h1 className="mt-7 break-words font-display text-4xl uppercase leading-[0.95] lg:text-5xl" data-testid="ride-loading-title">
              {title}
            </h1>
          ) : (
            <span aria-hidden="true" className="mx-auto mt-7 block h-9 w-56 rounded-lg bg-elev2" />
          )}
          {subtitle ? <p className="mt-2 text-muted">{cap(subtitle)}</p> : title ? null : <span aria-hidden="true" className="mx-auto mt-3 block h-4 w-40 rounded bg-elev2" />}
          {idle ? null : (
            <div
              role="progressbar"
              aria-label="Carico il mondo"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={determinate ? Math.round(progress * 100) : undefined}
              className="mx-auto mt-8 h-1.5 w-56 overflow-hidden rounded-full bg-elev2"
            >
              {determinate ? (
                <span
                  className="block h-full w-full origin-left rounded-full bg-accent"
                  style={{ transform: `scaleX(${p})`, transition: 'transform 220ms cubic-bezier(.32,.72,0,1)' }}
                  data-testid="ride-loading-bar"
                />
              ) : (
                // indeterminata: una barra che scorre (con «riduci movimento» resta ferma, il CSS globale la spegne)
                <span className="block h-full w-2/5 rounded-full bg-accent" style={{ animation: 'orobia-veil 1.3s cubic-bezier(.32,.72,0,1) infinite' }} data-testid="ride-loading-bar" />
              )}
            </div>
          )}
          <style>{'@keyframes orobia-veil{from{transform:translateX(-110%)}to{transform:translateX(260%)}}'}</style>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * La pausa si vede: un velo sul 3D, «In pausa» e il tempo fermo, i numeri spenti sotto.
 * «Riprendi» è l'unica azione piena; «Termina e salva» qui è un tocco solo, perché ci si è fermati apposta.
 */
function PauseVeil({ engine, shown, onResume, onFinish, children }: { engine: RideEngine; shown: boolean; onResume: () => void; onFinish: () => void; children: ReactNode }) {
  const auto = engine.autoPaused;
  const box = useRef<HTMLDivElement>(null);
  // il fuoco su «Riprendi» appena il velo c'è: Spazio o Invio ripartono
  useEffect(() => {
    if (shown) box.current?.querySelector<HTMLButtonElement>('[data-testid=pause-resume]')?.focus({ preventScroll: true });
  }, [shown]);
  return (
    <div
      ref={box}
      className={cn('absolute inset-0 z-30 overflow-auto bg-bg/75 backdrop-blur-sm transition-opacity duration-200', shown ? 'opacity-100' : 'pointer-events-none opacity-0')}
      data-testid="pause-veil"
      inert={!shown || undefined}
    >
      <div className="flex min-h-full flex-col items-center justify-center px-5 py-5 text-center">
        <p className="font-display text-5xl uppercase leading-none lg:text-6xl" role="status">
          {auto ? 'Pausa automatica' : 'In pausa'}
        </p>
        <p className="num mt-2 text-xl font-semibold" data-testid="pause-clock">
          {formatDuration(engine.elapsed)} · {formatKm(engine.odometer)} km
        </p>
        {auto ? <p className="mt-1 text-sm text-muted">Riparte quando pedali</p> : null}
        <div className="mt-5 flex w-full max-w-xs flex-col gap-2">
          <Button data-testid="pause-resume" className="h-14 text-lg" onClick={onResume}>
            Riprendi
          </Button>
          <Button variant="ghost" data-testid="pause-finish" onClick={onFinish}>
            Termina e salva
          </Button>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * «Termina» si tiene premuto: l'anello si riempie in 0,8 s e poi il giro finisce. Un tocco, un
 * clic o un Invio veloce non chiudono niente: dicono «Tieni premuto». Dalla tastiera si tiene
 * premuto Spazio o Invio.
 */
function HoldButton({ onDone, disabled, children, className, testid, ms = HOLD_MS }: { onDone: () => void; disabled?: boolean; children: ReactNode; className?: string; testid?: string; ms?: number }) {
  const ring = useRef<SVGCircleElement>(null);
  const hold = useRef<{ t0: number; raf: number; timer: number } | null>(null);
  const hintTimer = useRef(0);
  const [hint, setHint] = useState(false);
  const C = 2 * Math.PI * 8.5;
  const paint = (f: number) => {
    if (ring.current) ring.current.style.strokeDashoffset = String(C * (1 - f));
  };
  const nudge = () => {
    setHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(false), 1800);
  };
  // due strade per finire: il dito ancora giù quando l'anello è pieno (timer + fotogramma), oppure
  // il dito alzato dopo 0,8 s misurati sui tempi degli eventi (con il 3D lento, un fotogramma ogni
  // mezzo secondo, il dito può alzarsi prima che arrivi il fotogramma)
  const complete = () => {
    const h = hold.current;
    if (!h) return;
    cancelAnimationFrame(h.raf);
    window.clearTimeout(h.timer);
    hold.current = null;
    paint(0);
    // il riepilogo compare sotto il dito: il clic che segue l'alzata non deve premere quello che c'è
    // lì adesso («Continua a pedalare» sta proprio sotto «Termina»)
    swallowNextClick();
    onDone();
  };
  // i tempi del dito sono quelli degli eventi (quando il dito tocca e si alza), non quelli in cui la
  // pagina, occupata dal 3D, riesce a gestirli: 1 s tenuto vale 1 s anche se il telefono è in affanno
  const at = (stamp?: number) => (stamp != null && stamp > 0 && stamp <= performance.now() ? stamp : performance.now());
  const start = (stamp?: number) => {
    if (disabled || hold.current) return;
    const t0 = at(stamp);
    const step = (now: number) => {
      paint(Math.min(1, (now - t0) / ms));
      if (hold.current) hold.current.raf = requestAnimationFrame(step);
    };
    // l'anello pieno chiude il giro dentro il fotogramma dopo: Chrome consegna prima gli eventi del
    // dito arrivati intanto, così un tocco breve gestito in ritardo non viene scambiato per una pressione
    const timer = window.setTimeout(() => requestAnimationFrame(complete), ms);
    hold.current = { t0, raf: requestAnimationFrame(step), timer };
  };
  // il dito che si alza decide coi tempi degli eventi: tenuto 0,8 s vale anche se la pagina era in ritardo
  const stop = (stamp?: number) => {
    const h = hold.current;
    if (!h) return;
    // tenuto abbastanza ma il timer non è ancora passato (il telefono era occupato): vale
    if (at(stamp) - h.t0 >= ms) {
      complete();
      return;
    }
    cancelAnimationFrame(h.raf);
    window.clearTimeout(h.timer);
    hold.current = null;
    paint(0);
    nudge();
  };
  useEffect(
    () => () => {
      if (hold.current) {
        cancelAnimationFrame(hold.current.raf);
        window.clearTimeout(hold.current.timer);
      }
      window.clearTimeout(hintTimer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      data-testid={testid}
      disabled={disabled}
      aria-label="Termina il giro: tieni premuto"
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-full border border-line bg-elev/70 px-4 text-base font-semibold transition active:scale-[0.98] disabled:opacity-50 [-webkit-touch-callout:none] [touch-action:none]',
        className,
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start(e.timeStamp);
      }}
      onPointerUp={(e) => stop(e.timeStamp)}
      onPointerCancel={() => stop()}
      onLostPointerCapture={() => stop()}
      onContextMenu={(e) => e.preventDefault()}
      // un tocco su «Termina» non genera clic: lo decide la pressione, e il clic finirebbe sul riepilogo
      onTouchEnd={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) start(e.timeStamp);
      }}
      onKeyUp={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        stop(e.timeStamp);
      }}
      onClick={(e) => {
        // un clic senza dito (uno script, un lettore di schermo) non chiude il giro: lo dice
        if (e.detail === 0 && !hold.current) nudge();
      }}
    >
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0 -rotate-90">
        <circle cx="11" cy="11" r="8.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <circle ref={ring} cx="11" cy="11" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C} />
        <rect x="8" y="8" width="6" height="6" rx="1.2" fill="currentColor" />
      </svg>
      <span className={hint ? 'text-sm' : undefined} data-testid={testid ? `${testid}-label` : undefined}>
        {hint ? 'Tieni premuto' : children}
      </span>
    </button>
  );
}

/**
 * Il riepilogo: è già salvato. Prima la strada (la carta e l'altimetria), poi tempo, km, D+ e
 * watt medi, poi oro e punti. «Fatto» è l'unica azione piena; sotto FIT e diario (e qui la pista 4
 * aggiunge «Cartolina», nella riga `ride-summary-extra`).
 */
function RideSummary({
  ride,
  saveState,
  engine,
  setup,
  game,
  xp,
  rewards,
  ftpApplied,
  onApplyFtp,
  onDone,
  onHistory,
  onContinue,
  onDiscard,
  t,
}: {
  ride: Ride;
  saveState: 'saving' | 'saved' | 'failed';
  engine: RideEngine;
  setup: RideSetup;
  game: RideGame;
  xp: { lines: XpLine[]; total: number; level: ReturnType<typeof levelOf> & { xp: number }; rank: string | null; rankNote?: string } | null;
  rewards: { outcome: CareerOutcome; results: SegmentResult[] } | null;
  ftpApplied: boolean;
  onApplyFtp: () => void;
  onDone: () => void;
  onHistory: () => void;
  onContinue: () => void;
  onDiscard: () => void;
  t: Translate;
}) {
  const [ask, setAsk] = useState(false);
  const session = setup.world?.session ?? null;
  const ftp = engine.estimatedFtp();
  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-bg px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]" data-testid="ride-summary">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <header>
          <p className={cn('eyebrow flex items-center gap-1.5', saveState === 'saved' ? 'text-good' : saveState === 'failed' ? 'text-danger' : '')} data-testid="ride-saved" data-state={saveState} role="status">
            {saveState === 'saved' ? <CheckIcon /> : null}
            {saveState === 'saved' ? 'Giro salvato' : saveState === 'saving' ? 'Salvo il giro…' : 'Non salvato: riprova dal diario'}
          </p>
          <h2 className="mt-1.5 break-words font-display text-4xl leading-[0.95]">{ride.name}</h2>
          {engine.arrived && !session ? (
            <p className="mt-2 font-semibold text-accent">
              In cima: {setup.route.title} {setup.route.subtitle}
            </p>
          ) : null}
          {engine.arrived && session?.planned ? <p className="mt-2 font-semibold text-accent">Arrivato: {setup.route.title}</p> : null}
        </header>

        <SummaryMap ride={ride} engine={engine} setup={setup} />

        <dl className="grid grid-cols-2 gap-2" data-testid="summary-numbers">
          <Sum label={t('metrics.time')} value={formatDuration(ride.durationSec)} />
          <Sum label={t('metrics.distance')} value={formatKmText(ride.distanceM)} />
          <Sum label="Dislivello" value={withUnit(formatNumber(ride.elevationGainM, 0), 'm')} />
          <Sum label={t('metrics.avgPower')} value={ride.avgPower != null ? `${formatNumber(ride.avgPower, 0)} W` : '–'} />
        </dl>
        <p className="num -mt-1.5 px-1 text-sm text-muted">
          {/* lo stesso formattatore del dettaglio del giro: riepilogo e diario dicono lo stesso numero */}
          NP {ride.np != null ? withUnit(formatNumber(ride.np, 0), 'W') : '–'} · IF {ride.intensityFactor != null ? formatNumber(ride.intensityFactor, 2) : '–'} · TSS {ride.tss != null ? formatTss(ride.tss) : '–'}
        </p>

        {ftp != null ? (
          <div className="rounded-3xl bg-elev p-4">
            <p className="text-sm text-muted">{t('ride.ftpEstimate')}</p>
            <p className="num font-display text-4xl">{ftp} W</p>
            {ftpApplied ? (
              <p className="mt-2 text-sm text-good">{t('ride.ftpApplied')}</p>
            ) : (
              <Button variant="ghost" className="mt-3" onClick={onApplyFtp}>
                {t('ride.applyFtp', { ftp: String(ftp) })}
              </Button>
            )}
          </div>
        ) : null}
        {game.sessionDef ? (
          <p className="rounded-2xl bg-elev px-4 py-2.5 text-sm">
            <span className="font-semibold">{game.sessionDef.title}</span>
            {game.stage === 'arrivo' ? ' · Arrivato' : ' · Non finita'}
            {game.pack ? ` · ${Math.round(game.withPack * 100)}% col gruppo` : ''}
            {game.sessionRank ? ` · ${game.sessionRank}` : ''}
          </p>
        ) : null}
        {xp ? <LevelUp xp={xp.level.xp} gained={xp.total} /> : null}
        {rewards ? <RewardsSummary outcome={rewards.outcome} results={rewards.results} /> : null}
        {xp ? <XpSummary lines={xp.lines} total={xp.total} level={xp.level} rank={xp.rank} rankNote={xp.rankNote} /> : null}

        <div className="mt-1 flex flex-col gap-2">
          <Button data-testid="ride-done" className="h-14 text-lg" onClick={onDone}>
            Fatto
          </Button>
          {/* azioni secondarie del giro salvato: qui entra anche «Cartolina» (pista 4) */}
          <div className="grid auto-cols-fr grid-flow-col gap-2" data-testid="ride-summary-extra">
            <Button
              variant="ghost"
              data-testid="ride-fit"
              onClick={() => void import('@/io/fit').then(({ encodeActivityFit }) => downloadBytes(safeFileName(ride.name, 'fit'), encodeActivityFit(ride), 'application/octet-stream'))}
            >
              File FIT
            </Button>
            <Button variant="ghost" data-testid="ride-open-history" onClick={onHistory}>
              Nel diario
            </Button>
            <CartolinaButton ride={ride} />
          </div>
          <Button variant="soft" data-testid="ride-continue" onClick={onContinue}>
            {t('ride.keepRiding')}
          </Button>
          {ask ? (
            <div className="mt-1 rounded-2xl border border-line p-3" data-testid="ride-discard-confirm">
              <p className="text-sm font-semibold">Scartare il giro? Non torna più.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="danger" data-testid="ride-discard-yes" onClick={onDiscard}>
                  Scarta
                </Button>
                <Button variant="ghost" onClick={() => setAsk(false)}>
                  Tienilo
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" className="h-12 text-sm font-semibold text-muted" data-testid="ride-discard" onClick={() => setAsk(true)}>
              Scarta il giro
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * La strada fatta: nel mondo la carta vera di Bergamo con la traccia, sulle salite la pianta;
 * sotto, l'altimetria del giro dai campioni. Ferma: si guarda, non si trascina (la pagina scorre).
 */
function SummaryMap({ ride, engine, setup }: { ride: Ride; engine: RideEngine; setup: RideSetup }) {
  const session = setup.world?.session ?? null;
  const data = setup.world?.data ?? null;
  const legs = useMemo(() => (session ? session.path.legs.slice(0, session.path.legAt(Math.max(0, engine.distance - 1)) + 1).map((l) => ({ edge: l.edge, dir: l.dir })) : []), [session, engine]);
  const overlays = useMemo<MapOverlay[]>(() => (legs.length ? [{ legs, color: '#ffc814', width: 5 }] : []), [legs]);
  const markers = useMemo<MapMarker[]>(() => {
    if (!session) return [];
    const a = session.path.poseAt(0);
    const b = session.path.poseAt(Math.min(session.path.length, engine.distance));
    return [
      { x: a.x, z: a.z, color: '#f6f2e6', ring: true },
      { x: b.x, z: b.z, color: '#ffc814', label: 'Arrivo' },
    ];
  }, [session, engine]);
  const focus = useMemo(() => (data && legs.length ? legsBounds(data, legs, 350) : null), [data, legs]);
  const hasRoad = setup.route.id !== 'neutral';
  return (
    <section className="overflow-hidden rounded-3xl bg-elev" data-testid="summary-map" aria-label="La strada fatta">
      {data && legs.length ? (
        <div className="pointer-events-none [&_button]:hidden">
          <WorldMap data={data} far={null} overlays={overlays} markers={markers} focus={focus} height={210} className="rounded-none!" />
        </div>
      ) : hasRoad ? (
        <div className="grid h-[210px] place-items-center bg-elev2/60 p-3">
          <RouteMap track={setup.route.track} className="h-full w-full" position={engine.distance} />
        </div>
      ) : null}
      <div className="px-3 pb-2 pt-2">
        <SampleProfile samples={ride.samples} />
      </div>
    </section>
  );
}

/** L'altimetria del giro dai campioni (quota e metri), colorata per pendenza come in corsa. */
function SampleProfile({ samples }: { samples: RideSample[] }) {
  const W = 1000;
  const H = 64;
  const pts = samples.filter((s) => Number.isFinite(s.altitude) && Number.isFinite(s.distance));
  if (pts.length < 2) return null;
  const d0 = pts[0].distance;
  const span = Math.max(1, pts[pts.length - 1].distance - d0);
  let minA = Infinity;
  let maxA = -Infinity;
  for (const p of pts) {
    minA = Math.min(minA, p.altitude);
    maxA = Math.max(maxA, p.altitude);
  }
  const top = Math.max(maxA, minA + 20);
  const y = (a: number) => H - 3 - ((a - minA) / (top - minA)) * (H - 10);
  const x = (d: number) => ((d - d0) / span) * W;
  const bins = Math.min(80, pts.length - 1);
  const bars: ReactNode[] = [];
  for (let i = 0; i < bins; i++) {
    const a = pts[Math.floor((i / bins) * (pts.length - 1))];
    const b = pts[Math.floor(((i + 1) / bins) * (pts.length - 1))];
    const g = (b.altitude - a.altitude) / Math.max(1, b.distance - a.distance);
    bars.push(<path key={i} d={`M${x(a.distance)} ${H}L${x(a.distance)} ${y(a.altitude)}L${x(b.distance)} ${y(b.altitude)}L${x(b.distance)} ${H}Z`} fill={gradeColor(g)} opacity={0.9} />);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-14 w-full" role="img" aria-label={`Altimetria del giro, da ${Math.round(minA)} a ${Math.round(maxA)} m`} data-testid="summary-profile">
      {bars}
    </svg>
  );
}

function SensorSheet({
  trainer,
  supportReason,
  onClose,
  t,
}: {
  trainer: BluetoothTrainer;
  supportReason?: 'ios' | 'missing';
  onClose: () => void;
  t: Translate;
}) {
  const snap = trainer.snapshot();
  const [note, setNote] = useState<string | null>(supportReason ?? null);
  async function connect(all: boolean) {
    setNote(null);
    try {
      await trainer.connectBluetooth(all);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'ios' || message === 'missing') setNote(message);
      else if (trainer.snapshot().status === 'cancelled') setNote('cancelled');
      else setNote('failed');
    }
  }
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-3 md:items-center">
      <section className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-3xl bg-elev p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-3xl">{t('sensors.title')}</h2>
          <button type="button" className="h-10 rounded-full px-3 text-sm font-semibold" onClick={onClose}>
            {t('actions.close')}
          </button>
        </div>
        {supportReason === 'ios' || note === 'ios' ? (
          <p className="mt-3 rounded-2xl bg-warn/15 p-3 text-sm leading-relaxed">
            {t('sensors.ios')}{' '}
            <a className="font-semibold underline" href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055">
              {t('sensors.iosLink')}
            </a>
          </p>
        ) : null}
        {supportReason === 'missing' || note === 'missing' ? <p className="mt-3 text-sm leading-relaxed">{t('sensors.missing')}</p> : null}
        {note === 'cancelled' ? <p className="mt-3 text-sm">{t('sensors.cancelled')}</p> : null}
        {note === 'failed' ? <p className="mt-3 text-sm text-danger">{t('sensors.failed')}</p> : null}
        {snap.status === 'disconnected' ? <p className="mt-3 text-sm text-warn">{t('sensors.disconnected')}</p> : null}
        <p className="mt-3 text-sm leading-relaxed text-muted">{snap.mode === 'simulator' ? t('sensors.simLead') : t('sensors.bleLead')}</p>
        {snap.deviceName ? <p className="mt-2 font-semibold">{snap.deviceName}</p> : null}
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          <Service on={snap.services.ftms} label={t('sensors.ftms')} />
          <Service on={snap.services.power} label={t('sensors.power')} />
          <Service on={snap.services.hr} label={t('sensors.hr')} />
          <Service on={snap.services.csc} label={t('sensors.csc')} />
        </ul>
        {snap.control === 'granted' ? <p className="mt-3 text-sm text-good">{t('sensors.controlOn')}</p> : null}
        {snap.control === 'denied' ? <p className="mt-3 text-sm text-warn">{t('sensors.controlOff')}</p> : null}
        {snap.control === 'unsupported' ? <p className="mt-3 text-sm text-warn">{t('sensors.controlMissing')}</p> : null}
        {snap.simulation === 'active' ? <p className="mt-1 text-sm text-good">{t('sensors.simOn')}</p> : null}
        {snap.simulation === 'unsupported' ? <p className="mt-1 text-sm text-muted">{t('sensors.simOff')}</p> : null}
        <p className="mt-3 text-xs leading-relaxed text-muted">{t('sensors.weightNote')}</p>
        <div className="mt-4 flex flex-col gap-2">
          <Button disabled={!supportReason ? snap.busy : true} onClick={() => void connect(false)}>
            {t('sensors.search')}
          </Button>
          <Button variant="ghost" disabled={Boolean(supportReason) || snap.busy} onClick={() => void connect(true)}>
            {t('sensors.searchAll')}
          </Button>
          <Button variant="soft" onClick={() => void trainer.useSimulator().then(onClose)}>
            {t('sensors.useSim')}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Service({ on, label }: { on: boolean; label: string }) {
  return <li className={`rounded-full px-3 py-1 ${on ? 'bg-good/20 text-good' : 'bg-elev2 text-muted'}`}>{label}</li>;
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="16.8" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16.5 13.6c2.4.1 4 1.7 4.5 4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SimIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="16.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="16.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 16.5 9.5 9h4.5l4 7.5M9.5 9l2.5 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function BleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10-5 4V3l5 4L7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sum({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-elev px-3.5 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="num mt-0.5 font-display text-3xl leading-none">{value}</dd>
    </div>
  );
}

function stepLabel(step: WorkoutStep, t: Translate): string {
  const name = step.name ?? '';
  if (name.startsWith('warmup')) return t('workouts.stepWarmup');
  if (name.startsWith('cool')) return t('workouts.stepCooldown');
  if (name.startsWith('rec') || name.startsWith('rest') || name === 'easy' || name === 'spin') return t('workouts.stepRest');
  if (name.startsWith('ramp')) return t('workouts.stepRamp');
  if (name.startsWith('z2')) return t('workouts.stepZ2');
  if (name.startsWith('acc')) return t('workouts.stepAcc');
  return t('workouts.stepWork');
}

const SHARE_KEY = 'allenando.world.share';

function readShare(): boolean {
  try {
    return localStorage.getItem(SHARE_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeShare(on: boolean): void {
  try {
    localStorage.setItem(SHARE_KEY, on ? '1' : '0');
  } catch {
    /* modalità privata */
  }
}

function physicsFrom(profile: Profile): PhysicsParams {
  return {
    massKg: profile.weightKg + profile.bikeWeightKg,
    cda: profile.cda,
    crr: profile.crr,
    ...STANDARD_AIR,
  };
}

class WorldBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(): void {
    this.props.onFail();
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/**
 * Il prossimo clic (entro 0,7 s) non arriva a nessuno: dopo una pressione che apre un foglio, il
 * clic dell'alzata del dito cadrebbe su quello che il foglio ha messo sotto il dito.
 */
function swallowNextClick(ms = 700): void {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    off();
  };
  const off = () => {
    window.removeEventListener('click', swallow, true);
    window.clearTimeout(timer);
  };
  window.addEventListener('click', swallow, true);
  const timer = window.setTimeout(off, ms);
}
