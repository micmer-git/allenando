import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkoutChart } from '@/components/WorkoutChart';
import { ProfileChart } from '@/components/RouteViz';
import { Button, Segmented, Wordmark } from '@/components/ui';
import { bluetoothSupport } from '@/bluetooth/support';
import { BluetoothTrainer } from '@/bluetooth/trainer';
import { formatDuration, formatGrade, formatKm, formatNumber, msToKmh } from '@/domain/format';
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
import type { Profile, Quality, RideSample, Settings, Workout, WorkoutStep } from '@/domain/types';
import { estimateLthr, powerZone } from '@/domain/zones';
import { findWorkout, workoutAt } from '@/domain/workouts';
import { useI18n, type Translate } from '@/i18n';
import { RideEngine } from '@/sim/engine';
import { useApp } from '@/store/useApp';
import { RideScene } from '@/world/Scene';
import { decodeSection } from './ReplaySetup';
import { RoomPanel, RoomSheet, useRoom } from './RideRoom';
import { workoutTitle } from './Workouts';
import { Terrain, loadWorld, type WorldData } from '@/open/world';
import { createWorldField } from '@/open/field';
import { WorldSession } from '@/open/session';
import { WorldScene, npcCount, type RemoteWorldRider } from '@/open/WorldScene';
import { loadPlan } from '@/open/plan';
import { WorldClient } from '@/multiplayer/world-client';
import { applyRide, levelOf, loadProgress, postResult, postXp, type XpLine } from '@/open/progress';
import { AheadProfile, LoopSheet, MapSheet, Nearby, Toasts, TurnPicker, WeatherChip, WorldMini, XpSummary } from './WorldHud';
import type { Dir } from '@/open/graph';
import { fetchWeather, type WeatherNow } from '@/open/weather';
import { sunFor } from '@/open/sky';
import { applyCareer, ORO_RULES, type CareerOutcome, type OroLine, type RideFacts, type SegmentResult } from '@/game/career';
import { RideGame } from '@/game/rideGame';
import { SEGMENT_STYLE } from '@/game/arches';
import { sessionById } from '@/game/sessions';
import { useGame, useLook } from '@/game/useGame';
import { ErgAheadHud, LevelUp, PoiToast, RewardsSummary, SegmentHud, SessionHud } from './RideGameHud';
import { gapLabel, gapStyle, useRideGhosts } from '@/game/ghosts';
import { CartolinaButton } from '@/components/ShareCard';

const DEFAULT_ROUTE = 'selvino-nembro';

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
    subtitle: 'giro senza GPS',
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
      loadWorld()
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
            subtitle = 'anello suggerito';
          } else {
            const edge = Number(params.get('edge'));
            const e = data.graph.edges[edge];
            if (!e) throw new Error('Punto di partenza fuori dal mondo.');
            const dir = (params.get('dir') === '-1' ? -1 : 1) as Dir;
            const s0 = Math.min(e.length, Math.max(0, Number(params.get('s')) || 0));
            session = new WorldSession(data, { edge, dir: data.graph.allowed(edge, dir) ? dir : ((-dir) as Dir), s: s0 }, n);
            title = 'Giro libero';
            subtitle = e.name || e.ref || 'Bergamo e le valli';
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
          ? trackFromGeo(`replay-${ride.id}`, ride.name, geoPointsFromSamples(samples), 'traccia del tuo giro')
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

export function RidePage() {
  const { setup, error } = useRideSetup();
  // i record e il guardaroba servono già al primo metro: si caricano insieme alla strada
  const gameReady = useGame((s) => s.ready);
  const hydrateGame = useGame((s) => s.hydrate);
  useEffect(() => {
    void hydrateGame();
  }, [hydrateGame]);
  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-lg">{error}</p>
          <Link to="/salite" className="mt-3 inline-block font-semibold text-accent">
            Salite
          </Link>
        </div>
      </div>
    );
  }
  if (!setup || !gameReady) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <Wordmark className="text-4xl" />
          <p className="mt-3 text-muted">Carico la strada e il terreno…</p>
        </div>
      </div>
    );
  }
  // un'altra strada (un link da un giro all'altro senza ricaricare) è un'altra pedalata: motore nuovo
  return <RideSession key={setupId(setup)} setup={setup} />;
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

function RideSession({ setup }: { setup: RideSetup }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const custom = useApp((s) => s.workouts);
  const workoutId = params.get('workout');
  const workout = workoutId ? findWorkout(workoutId, custom) ?? null : null;
  const session = useRef<{ engine: RideEngine; trainer: BluetoothTrainer; game: RideGame } | null>(null);
  if (!session.current) {
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
    // ?at=metri: si parte da un punto della salita (per riprendere un tratto)
    const at = Number(params.get('at'));
    if (Number.isFinite(at) && at > 0) engine.distance = Math.min(at, setup.route.track.length - 1);
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
    session.current = { engine, trainer, game };
  }
  const { engine, trainer, game } = session.current;

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      engine.tick(dt);
      setup.world?.session.step(engine, dt);
      game.tick(dt);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      trainer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, trainer]);

  return <RideScreen engine={engine} trainer={trainer} game={game} profile={profile} workout={workout} quality={settings.quality} setup={setup} t={t} />;
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
}: {
  engine: RideEngine;
  trainer: BluetoothTrainer;
  game: RideGame;
  profile: Profile;
  workout: Workout | null;
  quality: Quality;
  setup: RideSetup;
  t: Translate;
}) {
  const navigate = useNavigate();
  const updateSettings = useApp((s) => s.updateSettings);
  const saveRide = useApp((s) => s.saveRide);
  const updateProfile = useApp((s) => s.updateProfile);
  const [, bump] = useState(0);
  const look = useLook();
  const [ready, setReady] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const [sensorsOpen, setSensorsOpen] = useState(false);
  const [effort, setEffort] = useState(62);
  const [summary, setSummary] = useState<ReturnType<RideEngine['toRide']> | null>(null);
  const [saved, setSaved] = useState(false);
  const [ftpApplied, setFtpApplied] = useState(false);

  useEffect(() => engine.subscribe(() => bump((n) => n + 1)), [engine]);
  useEffect(() => trainer.subscribe(() => bump((n) => n + 1)), [trainer]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.target instanceof HTMLInputElement) return;
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
  const support = bluetoothSupport();
  const modeLabel =
    setup.replayMode === 'power' ? 'Power replay' : setup.replayMode === 'grade' ? 'Grade replay' : setup.replayMode === 'ghost' ? 'Fantasma' : null;
  const rideName = workout ? `${workoutTitle(workout, t)} · ${setup.label}` : modeLabel ? `${modeLabel} · ${setup.label}` : setup.label;
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
  // un arco (traguardo, km, ERG) fra 15 e 110 m: è lì che lo copre la colonna dei tratti
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
    if (!session || !share) return;
    const client = new WorldClient({ world: 'bergamo', nick: profile.name || 'Ciclista' });
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
  }, [session, share, profile.name]);
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
      distanceM: engine.distance - c.distance,
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
      distanceM: engine.distance - c.distance,
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
    committed.current = { distance: engine.distance, sample: engine.samples.length, elapsed: engine.elapsed, results: game.results.length, gain: 0, pois: game.poisPassed.length };
    setRewards({ outcome, results });
  }

  // dove sei, per aprire la strada vera nel visore ufficiale (non per disegnarla nel 3D)
  const pose = engine.pose();
  const here = setup.route.id !== 'neutral' ? projector(setup.route.origin).toGeo(pose.x, pose.z) : null;
  const bearing = headingToBearing(pose.heading);

  function finish() {
    engine.finish();
    const ride = engine.toRide(rideName);
    if (setup.routeId && !workout && !setup.replayMode) ride.routeId = setup.routeId;
    if (session?.ride && session.rankable && engine.arrived) ride.routeId = `bergamo:${session.ride.id}`;
    setSummary(ride);
    setRewards(null);
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

  return (
    <div className="flex h-dvh flex-col bg-bg md:flex-row" data-testid="ride-screen">
      <div className="relative min-h-0 flex-1">
        <WorldBoundary onFail={() => setWebgl(false)}>
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
              onReady={() => setReady(true)}
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
              onReady={() => setReady(true)}
              arches={game.arches}
              look={look}
            />
          ) : (
            <div className="grid h-full place-items-center bg-elev p-6 text-center text-muted">{t('ride.webgl')}</div>
          )}
        </WorldBoundary>
        {/* barra in alto: una riga sola, il mondo resta libero */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/35 to-transparent px-2.5 pb-6 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t('actions.back')}
              className="pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-full bg-bg/70 backdrop-blur"
              onClick={finish}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="min-w-0 flex-1 rounded-full bg-bg/70 px-3.5 py-1.5 backdrop-blur" data-testid="ride-route">
              <p className="truncate font-display text-lg uppercase leading-tight">
                {setup.route.title} <span className="font-sans text-xs font-medium normal-case text-muted">{setup.route.subtitle}</span>
              </p>
              <p className="truncate text-[11px] leading-tight text-muted" data-testid="ride-where">
                {session ? (
                  <>
                    {[session.placeName(), session.roadLabel(engine.distance), `${formatNumber(engine.altitude, 0)} m`].filter(Boolean).join(' · ')}
                    {engine.aero < 0.93 ? <span className="font-semibold text-good"> · in scia −{Math.round((1 - engine.aero) * 100)}% aria</span> : null}
                    {engine.rolling > 1.2 ? <span className="text-warn"> · {engine.rolling > 2 ? 'sterrato' : 'porfido'}</span> : null}
                  </>
                ) : (
                  <>
                    {modeLabel ? `${modeLabel} · ` : ''}
                    {!setup.route.verified ? 'traccia non verificata' : `${formatNumber(engine.altitude, 0)} m`}
                    {track.hairpins.length > 0 ? ` · tornanti ${hairpinsDone}/${track.hairpins.length}` : ''}
                  </>
                )}
              </p>
            </div>
            {room.available ? (
              <button
                type="button"
                aria-label="Pedala insieme"
                data-testid="room-open"
                className={`pointer-events-auto relative grid h-11 w-11 shrink-0 place-items-center rounded-full backdrop-blur ${room.client ? 'bg-accent text-accent-ink' : 'bg-bg/70'}`}
                onClick={() => room.setSheet(true)}
              >
                <PeopleIcon />
                {room.snap && room.snap.riders.length > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-bg px-1 text-[11px] font-bold text-ink">
                    {room.snap.riders.length + 1}
                  </span>
                ) : null}
              </button>
            ) : null}
            <button
              type="button"
              aria-label={snap.mode === 'bluetooth' ? snap.deviceName || t('ride.connected') : t('ride.simulator')}
              className={`pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-full backdrop-blur ${snap.mode === 'bluetooth' && snap.status === 'connected' ? 'bg-good/30 text-good' : 'bg-bg/70'}`}
              onClick={() => setSensorsOpen(true)}
              data-testid="ride-sensors"
            >
              {snap.mode === 'bluetooth' ? <BleIcon /> : <SimIcon />}
            </button>
          </div>
          <div className="mt-1.5 flex items-start justify-between gap-2">
            <div className="flex flex-col items-start gap-1.5">
              {room.snap ? <RoomPanel snap={room.snap} myDistance={engine.distance} onOpen={() => room.setSheet(true)} /> : null}
              {setup.note ? <p className="max-w-[60vw] rounded-xl bg-bg/70 px-2.5 py-1 text-xs text-warn backdrop-blur">{setup.note}</p> : null}
              {session ? <Nearby session={session} /> : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="rounded-xl bg-bg/70 px-2.5 py-1 text-right leading-none backdrop-blur" data-testid="ride-km">
                {session && !session.onRoute ? (
                  <>
                    <span className="num font-display text-[22px]">{formatKm(engine.distance)}</span>
                    <span className="ml-1 text-[11px] text-muted">km fatti</span>
                  </>
                ) : (
                  <>
                    <span className="num font-display text-[22px]">{formatKm(Math.max(0, track.length - engine.distance))}</span>
                    <span className="ml-1 text-[11px] text-muted">km all’arrivo</span>
                  </>
                )}
              </p>
              {session ? <WeatherChip session={session} engine={engine} /> : null}
              {session && session.offRoute ? (
                <button type="button" className="pointer-events-auto h-11 rounded-full bg-accent px-3.5 text-sm font-semibold text-accent-ink" onClick={() => session.rejoin(engine.distance)} data-testid="world-rejoin">
                  Torna sul percorso
                </button>
              ) : null}
              {session && !session.planned ? (
                <button type="button" className="pointer-events-auto h-11 rounded-full bg-bg/75 px-3.5 text-sm font-semibold backdrop-blur" onClick={() => setLoopOpen(true)} data-testid="world-loop-here">
                  Anello da qui
                </button>
              ) : null}
              {gap != null ? (
                <p className="rounded-xl px-2.5 py-1 text-xs font-semibold backdrop-blur" style={gapStyle(gap)} data-testid="ghost-gap">
                  {gapLabel(gap, own?.of)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        {/* la colonna dei tratti sta proprio sulla fascia dell'orizzonte: quando un arco è vicino si fa trasparente, e l'arco si legge */}
        <div className={`pointer-events-none absolute inset-x-0 top-[8rem] flex flex-col items-center gap-1.5 px-14 transition-opacity duration-300 ${archNear ? 'opacity-25' : ''}`} data-testid="ride-hud-center">
          <SessionHud game={game} />
          <SegmentHud game={game} />
          <ErgAheadHud game={game} />
          <PoiToast game={game} />
          {session ? <Toasts session={session} /> : null}
        </div>
        {session ? (
          <div className="pointer-events-none absolute inset-x-2.5 bottom-[3.6rem] flex items-end justify-between gap-2">
            <div className="min-w-0">
              <TurnPicker session={session} engine={engine} />
            </div>
            <div className="shrink-0">
              <WorldMini session={session} size={112} onOpen={() => setMapOpen(true)} />
            </div>
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-2.5 bottom-2 rounded-xl bg-bg/55 p-1 backdrop-blur">
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

        <span data-testid="world-ready" data-ready={ready ? 'yes' : 'no'} className="sr-only" />
        <span data-testid="room-3d" data-count={remote?.list.length ?? 0} className="sr-only" />
        {/* gli archi sulla strada adesso (traguardi, km, ERG): per il collaudo, non si vede */}
        <span data-testid="ride-arches" data-list={game.arches.map((a) => `${a.kind}:${a.role}:${a.label}@${Math.round(a.d ?? -1)}`).join('|')} className="sr-only" />
      </div>
      <aside className="max-h-[45%] overflow-auto border-t border-line bg-elev px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:max-h-none md:w-[400px] md:shrink-0 md:border-l md:border-t-0 md:pt-4">
        {progress && engine.workout ? (
          <div className="mb-2.5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent" data-testid="erg-target">
                  {t('ride.erg')} {formatNumber(engine.targetPower, 0)} {t('units.watt')}
                </p>
                <p className="font-display text-2xl leading-none">
                  {step ? stepLabel(step, t) : ''}
                  {step?.cadence ? <span className="num ml-1.5 font-sans text-sm font-semibold text-muted">{step.cadence} rpm</span> : null}
                </p>
              </div>
              <p className="num font-display text-3xl" data-testid="interval-clock">{formatDuration(progress.stepRemaining)}</p>
            </div>
            <div className="mt-1.5">
              <WorkoutChart workout={engine.workout} ftp={engine.ftp} elapsed={engine.elapsed} />
            </div>
          </div>
        ) : null}
        {engine.workoutDone ? <p className="mb-2 text-sm text-good">{t('ride.done')}</p> : null}
        {/* una riga di numeri: i watt grandi, poi velocità, pendenza e cadenza; il resto in piccolo sotto */}
        <dl className="flex items-stretch gap-1.5">
          <div className="min-w-0 flex-[1.4] rounded-xl bg-bg/60 px-2 py-1">
            <dt className="sr-only">{t('units.watt')} 3 s</dt>
            <dd className="flex items-baseline gap-1">
              <span className="num font-display text-[40px] leading-none" data-testid="ride-power" style={{ color: zone.color }}>
                {formatNumber(engine.power3s, 0)}
              </span>
              <span className="text-[11px] font-semibold uppercase text-muted">W</span>
            </dd>
            <dd className="truncate text-[11px] font-semibold leading-tight" style={{ color: zone.color }}>
              Z{zone.zone} · <span className="num text-ink/80">{formatNumber(engine.wkg(), 1)} W/kg</span>
            </dd>
          </div>
          <Cell label={t('metrics.speed')} value={formatNumber(msToKmh(engine.speed), 1)} unit={t('units.kmh')} strong />
          <Cell label={t('metrics.grade')} value={formatGrade(engine.grade)} strong />
          <Cell label={t('metrics.cadence')} value={formatNumber(engine.cadence, 0)} unit={t('units.rpm')} strong />
        </dl>
        <p className="num mt-1 flex justify-between px-1 text-xs text-muted">
          <span>
            {t('metrics.hr')} <span className="font-semibold text-ink">{formatNumber(engine.hr, 0)}</span>
          </span>
          <span>
            <span className="font-semibold text-ink">{formatKm(engine.distance)}</span> km
          </span>
          <span className="font-semibold text-ink">{formatDuration(engine.elapsed)}</span>
          <span>{t(zone.nameKey)}</span>
        </p>
        {/* su telefono il pannello scorre: Pausa e Termina restano sempre a portata di dito */}
        <div className="sticky bottom-0 z-10 -mx-4 mt-1.5 grid grid-cols-2 gap-2 bg-elev px-4 py-1 md:static md:mx-0 md:px-0 md:py-0">
          <Button variant="ghost" className="h-11" disabled={game.stage === 'griglia'} onClick={() => (engine.phase === 'paused' ? engine.resume() : engine.pause())}>
            {game.stage === 'griglia' ? 'In griglia' : engine.phase === 'paused' ? t('actions.resume') : t('actions.pause')}
          </Button>
          <Button data-testid="ride-finish" className="h-11" onClick={finish}>
            {t('actions.finish')}
          </Button>
        </div>
        {snap.mode === 'simulator' ? (
          <div className="mt-1.5 flex items-center gap-2">
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
            ) : (
              <span className="flex-1 text-xs text-muted">{t('ride.simulator')}</span>
            )}
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
        {snap.mode === 'bluetooth' && snap.status === 'connected' && engine.power <= 0 ? (
          <p className="mt-2 text-sm text-warn">{t('ride.waiting')}</p>
        ) : null}
        {snap.mode === 'bluetooth' && snap.status === 'disconnected' ? (
          <p className="mt-2 flex items-center justify-between gap-3 text-sm text-warn" role="status">
            {t('ride.lost')}
            <button type="button" className="h-11 font-semibold underline" onClick={() => setSensorsOpen(true)}>
              {t('ride.reconnect')}
            </button>
          </p>
        ) : null}
        <details className="group mt-1.5 rounded-2xl border border-line">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold">
            Impostazioni
            <span aria-hidden="true" className="text-muted transition group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="px-3 pb-3">
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
              <>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <a
                    href={streetViewUrl(here, bearing)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex h-11 items-center justify-center rounded-full bg-elev2 px-3 text-sm font-semibold"
                    data-testid="street-view"
                  >
                    Guarda la strada vera ↗
                  </a>
                  <a
                    href={mapillaryUrl(here)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex h-11 items-center justify-center rounded-full bg-elev2 px-3 text-sm font-semibold"
                  >
                    Mapillary ↗
                  </a>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">Nel punto e nella direzione in cui sei. Foto © Google e Mapillary; il 3D viene da OpenStreetMap e dal DEM.</p>
              </>
            ) : null}
          </div>
        </details>
      </aside>
      {sensorsOpen ? (
        <SensorSheet
          trainer={trainer}
          supportReason={support.available ? undefined : support.reason}
          onClose={() => setSensorsOpen(false)}
          t={t}
        />
      ) : null}
      {loopOpen && session ? <LoopSheet session={session} engine={engine} onClose={() => setLoopOpen(false)} /> : null}
      {mapOpen && session ? <MapSheet session={session} engine={engine} far={far} track={track} onClose={closeMap} /> : null}
      {room.sheet && room.available ? <RoomSheet handle={room} routeTitle={`${setup.route.title} ${setup.route.subtitle}`} onClose={() => room.setSheet(false)} /> : null}
      {summary ? (
        <div className="fixed inset-0 z-40 overflow-auto bg-bg/95 px-4 py-8 backdrop-blur" data-testid="ride-summary">
          <div className="mx-auto w-full max-w-lg">
            <p className="text-sm uppercase tracking-wide text-muted">{saved ? t('ride.saved') : t('ride.finishTitle')}</p>
            <h2 className="mt-1 font-display text-4xl">{summary.name}</h2>
            {saved ? <p className="mt-2 text-muted">{t('ride.savedHint')}</p> : null}
            <dl className="mt-5 grid grid-cols-2 gap-3">
              <Sum label={t('metrics.time')} value={formatDuration(summary.durationSec)} />
              <Sum label={t('metrics.distance')} value={`${formatKm(summary.distanceM)} km`} />
              <Sum label={t('metrics.avgPower')} value={summary.avgPower != null ? `${formatNumber(summary.avgPower, 0)} W` : '–'} />
              <Sum label={t('metrics.np')} value={summary.np != null ? `${formatNumber(summary.np, 0)} W` : '–'} />
              <Sum label={t('metrics.if')} value={summary.intensityFactor != null ? formatNumber(summary.intensityFactor, 2) : '–'} />
              <Sum label={t('metrics.tss')} value={summary.tss != null ? formatNumber(summary.tss, 1) : '–'} />
            </dl>
            {engine.estimatedFtp() != null ? (
              <div className="mt-4 rounded-3xl bg-elev p-4">
                <p className="text-sm text-muted">{t('ride.ftpEstimate')}</p>
                <p className="num font-display text-4xl">{engine.estimatedFtp()} W</p>
                {ftpApplied ? (
                  <p className="mt-2 text-sm text-good">{t('ride.ftpApplied')}</p>
                ) : (
                  <Button className="mt-3" onClick={() => void updateProfile({ ftp: engine.estimatedFtp() ?? profile.ftp }).then(() => setFtpApplied(true))}>
                    {t('ride.applyFtp', { ftp: String(engine.estimatedFtp()) })}
                  </Button>
                )}
              </div>
            ) : null}
            {engine.arrived && !session ? <p className="mt-3 font-semibold text-accent">In cima: {setup.route.title} {setup.route.subtitle}.</p> : null}
            {engine.arrived && session?.planned ? <p className="mt-3 font-semibold text-accent">Arrivato: {setup.route.title}.</p> : null}
            {game.sessionDef ? (
              <p className="mt-3 rounded-2xl bg-elev px-4 py-2.5 text-sm">
                <span className="font-semibold">{game.sessionDef.title}</span>
                {game.stage === 'arrivo' ? ' · arrivato' : ' · non finita'}
                {game.pack ? ` · ${Math.round(game.withPack * 100)}% col gruppo` : ''}
                {game.sessionRank ? ` · ${game.sessionRank}` : ''}
              </p>
            ) : null}
            {xp ? <LevelUp xp={xp.level.xp} gained={xp.total} /> : null}
            {rewards ? <RewardsSummary outcome={rewards.outcome} results={rewards.results} /> : null}
            {xp ? <XpSummary lines={xp.lines} total={xp.total} level={xp.level} rank={xp.rank} rankNote={xp.rankNote} /> : null}
            <div className="mt-6 flex flex-col gap-2">
              {saved ? (
                <Button data-testid="ride-open-history" onClick={() => navigate(`/history/${summary.id}`)}>
                  {t('ride.toHistory')}
                </Button>
              ) : (
                <Button
                  data-testid="ride-save"
                  onClick={() => {
                    void saveRide(summary).then(() => setSaved(true));
                  }}
                >
                  {t('actions.save')}
                </Button>
              )}
              {!saved ? (
                <Button
                  variant="soft"
                  data-testid="ride-continue"
                  onClick={() => {
                    engine.reopen();
                    setSummary(null);
                  }}
                >
                  {t('ride.keepRiding')}
                </Button>
              ) : null}
              <CartolinaButton ride={summary} />
              {!saved ? (
                <Button variant="ghost" onClick={() => navigate('/')}>
                  {t('actions.discard')}
                </Button>
              ) : (
                <Link to="/" className="inline-flex h-12 items-center justify-center rounded-full border border-line font-semibold">
                  {t('nav.home')}
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
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

function Cell({ label, value, unit, strong = false }: { label: string; value: string; unit?: string; strong?: boolean }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-bg/60 px-1 py-1.5 text-center">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`num whitespace-nowrap font-semibold leading-tight ${strong ? 'text-lg' : 'text-[15px] text-ink/85'}`}>
        {value}
        {unit ? <span className="ml-0.5 text-[11px] font-medium text-muted">{unit}</span> : null}
      </dd>
    </div>
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
    <div className="rounded-2xl bg-elev p-3">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="num font-display text-2xl">{value}</dd>
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
