import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { loadRouteFile, routeMeta, trackFromGeo, trackFromRouteFile, type LoadedRoute } from '@/domain/routes';
import { createRouteTrack } from '@/domain/track';
import type { Profile, Quality, RideSample, Workout, WorkoutStep } from '@/domain/types';
import { estimateLthr, powerZone } from '@/domain/zones';
import { findWorkout, workoutAt } from '@/domain/workouts';
import { useI18n, type Translate } from '@/i18n';
import { RideEngine } from '@/sim/engine';
import { useApp } from '@/store/useApp';
import { RideScene } from '@/world/Scene';
import { decodeSection } from './ReplaySetup';
import { workoutTitle } from './Workouts';

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
  const [state, setState] = useState<{ setup: RideSetup | null; error: string | null }>({ setup: null, error: null });
  const key = params.toString();
  useEffect(() => {
    let alive = true;
    const done = (setup: RideSetup | null, error: string | null = null) => {
      if (alive) setState({ setup, error });
    };
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
  if (!setup) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <Wordmark className="text-4xl" />
          <p className="mt-3 text-muted">Carico la strada e il terreno…</p>
        </div>
      </div>
    );
  }
  return <RideSession setup={setup} />;
}

function RideSession({ setup }: { setup: RideSetup }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const custom = useApp((s) => s.workouts);
  const workoutId = params.get('workout');
  const workout = workoutId ? findWorkout(workoutId, custom) ?? null : null;
  const session = useRef<{ engine: RideEngine; trainer: BluetoothTrainer } | null>(null);
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
    });
    // ?at=metri: si parte da un punto della salita (per riprendere un tratto)
    const at = Number(params.get('at'));
    if (Number.isFinite(at) && at > 0) engine.distance = Math.min(at, setup.route.track.length - 1);
    session.current = { engine, trainer };
  }
  const { engine, trainer } = session.current;

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      engine.tick(dt);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      trainer.disconnect();
    };
  }, [engine, trainer]);

  return <RideScreen engine={engine} trainer={trainer} profile={profile} workout={workout} quality={settings.quality} setup={setup} t={t} />;
}

function RideScreen({
  engine,
  trainer,
  profile,
  workout,
  quality,
  setup,
  t,
}: {
  engine: RideEngine;
  trainer: BluetoothTrainer;
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
  const gap = ghostSamples && ghostSamples.length > 1 ? gapSeconds(ghostSamples, engine.distance / ghostScale, engine.elapsed) : null;
  const hairpinsDone = track.hairpins.filter((h) => h.distance <= engine.distance).length;

  function finish() {
    engine.finish();
    const ride = engine.toRide(rideName);
    if (setup.routeId && !workout && !setup.replayMode) ride.routeId = setup.routeId;
    setSummary(ride);
  }

  useEffect(() => {
    if (engine.arrived && !summary) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return (
    <div className="flex h-dvh flex-col bg-bg md:flex-row" data-testid="ride-screen">
      <div className="relative min-h-0 flex-1">
        <WorldBoundary onFail={() => setWebgl(false)}>
          {webgl ? (
            <RideScene
              key={quality}
              engine={engine}
              route={setup.route}
              quality={quality}
              ghostDistance={ghostDistance}
              onReady={() => setReady(true)}
            />
          ) : (
            <div className="grid h-full place-items-center bg-elev p-6 text-center text-muted">{t('ride.webgl')}</div>
          )}
        </WorldBoundary>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <button type="button" className="pointer-events-auto h-11 rounded-full bg-bg/70 px-4 text-sm font-semibold backdrop-blur" onClick={finish}>
            {t('actions.back')}
          </button>
          <button
            type="button"
            className="pointer-events-auto h-11 rounded-full bg-bg/70 px-4 text-sm font-semibold backdrop-blur"
            onClick={() => setSensorsOpen(true)}
          >
            {snap.mode === 'bluetooth' ? snap.deviceName || t('ride.connected') : t('ride.simulator')}
          </button>
        </div>
        <div className="pointer-events-none absolute left-3 top-16 max-w-[62%] rounded-xl bg-bg/70 px-3 py-2 backdrop-blur" data-testid="ride-route">
          <p className="font-display text-xl uppercase leading-none">{setup.route.title}</p>
          <p className="text-xs text-muted">
            {setup.route.subtitle}
            {modeLabel ? ` · ${modeLabel}` : ''}
            {!setup.route.verified ? ' · traccia non verificata' : ''}
          </p>
          {setup.note ? <p className="mt-1 text-xs text-warn">{setup.note}</p> : null}
        </div>
        <div className="pointer-events-none absolute right-3 top-16 flex flex-col items-end gap-1">
          <p className="rounded-xl bg-bg/70 px-3 py-1.5 text-right backdrop-blur">
            <span className="num font-display text-2xl leading-none">{formatKm(Math.max(0, track.length - engine.distance))}</span>
            <span className="ml-1 text-xs text-muted">km all’arrivo</span>
          </p>
          <p className="rounded-xl bg-bg/70 px-3 py-1 text-sm backdrop-blur">
            <span className="num font-semibold">{formatNumber(engine.altitude, 0)} m</span>
            {track.hairpins.length > 0 ? (
              <span className="ml-2 text-muted">
                tornanti {hairpinsDone}/{track.hairpins.length}
              </span>
            ) : null}
          </p>
          {gap != null ? (
            <p
              className={`rounded-xl px-3 py-1 text-sm font-semibold backdrop-blur ${gap >= 0 ? 'bg-good/25 text-good' : 'bg-danger/25 text-danger'}`}
              data-testid="ghost-gap"
            >
              fantasma {gap >= 0 ? '+' : '−'}
              {formatDuration(Math.abs(gap))}
            </p>
          ) : null}
        </div>
        <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-xl bg-bg/60 p-1.5 backdrop-blur">
          <ProfileChart
            track={track}
            className="block h-12 w-full"
            height={48}
            bin={Math.max(100, track.length / 80)}
            position={engine.distance}
            ghost={ghostDistance ? ghostDistance() : null}
          />
        </div>

        <span data-testid="world-ready" data-ready={ready ? 'yes' : 'no'} className="sr-only" />
      </div>
      <aside className="max-h-[56%] overflow-auto border-t border-line bg-elev px-4 pb-[max(0.8rem,env(safe-area-inset-bottom))] pt-3 md:max-h-none md:w-[400px] md:shrink-0 md:border-l md:border-t-0">
        {progress && engine.workout ? (
          <div className="mb-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent" data-testid="erg-target">
                  {t('ride.erg')} {formatNumber(engine.targetPower, 0)} {t('units.watt')}
                </p>
                <p className="font-display text-3xl leading-none">{step ? stepLabel(step, t) : ''}</p>
              </div>
              <p className="num font-display text-4xl" data-testid="interval-clock">{formatDuration(progress.stepRemaining)}</p>
            </div>
            <div className="mt-2">
              <WorkoutChart workout={engine.workout} ftp={engine.ftp} elapsed={engine.elapsed} />
            </div>
          </div>
        ) : null}
        {engine.workoutDone ? <p className="mb-3 text-sm text-good">{t('ride.done')}</p> : null}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">{t('metrics.power3s')}</p>
            <p className="num font-display text-6xl leading-none" data-testid="ride-power" style={{ color: zone.color }}>
              {formatNumber(engine.power3s, 0)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold" style={{ color: zone.color }}>
              {t('metrics.zone')} {zone.zone} · {t(zone.nameKey)}
            </p>
            <p className="num text-lg">{formatNumber(engine.wkg(), 1)} {t('metrics.wkg')}</p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Cell label={t('metrics.hr')} value={formatNumber(engine.hr, 0)} unit={t('units.bpm')} />
          <Cell label={t('metrics.cadence')} value={formatNumber(engine.cadence, 0)} unit={t('units.rpm')} />
          <Cell label={t('metrics.speed')} value={formatNumber(msToKmh(engine.speed), 1)} unit={t('units.kmh')} />
        </dl>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm text-muted">
          <Cell label={t('metrics.distance')} value={formatKm(engine.distance)} unit="km" />
          <Cell label={t('metrics.time')} value={formatDuration(engine.elapsed)} />
          <Cell label={t('metrics.grade')} value={formatGrade(engine.grade)} />
        </dl>
        {/* su telefono il pannello scorre: Pausa e Termina restano sempre a portata di dito */}
        <div className="sticky bottom-0 z-10 -mx-4 mt-3 grid grid-cols-2 gap-2 bg-elev px-4 py-2 md:static md:mx-0 md:px-0 md:py-0">
          <Button
            variant="ghost"
            onClick={() => (engine.phase === 'paused' ? engine.resume() : engine.pause())}
          >
            {engine.phase === 'paused' ? t('actions.resume') : t('actions.pause')}
          </Button>
          <Button data-testid="ride-finish" onClick={finish}>
            {t('actions.finish')}
          </Button>
        </div>
        {snap.mode === 'simulator' && engine.mode === 'free' ? (
          <label className="mt-3 block">
            <span className="flex justify-between text-sm text-muted">
              <span>{t('ride.effort')}</span>
              <span className="num">{effort}%</span>
            </span>
            <input
              aria-label={t('a11y.effort')}
              className="mt-1 w-full accent-[var(--accent)]"
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
          </label>
        ) : null}
        {snap.mode === 'simulator' ? (
          <div className="mt-3 flex gap-2">
            {[1, 4, 10].map((scale) => (
              <button
                key={scale}
                type="button"
                className={`h-10 flex-1 rounded-full text-sm font-semibold ${engine.timeScale === scale ? 'bg-accent text-accent-ink' : 'bg-elev2'}`}
                onClick={() => {
                  engine.timeScale = scale;
                  bump((n) => n + 1);
                }}
              >
                {scale}×
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-3">
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
        </div>
        {snap.mode === 'bluetooth' && snap.status === 'connected' && engine.power <= 0 ? (
          <p className="mt-2 text-sm text-warn">{t('ride.waiting')}</p>
        ) : null}
        {snap.mode === 'bluetooth' && snap.status === 'disconnected' ? (
          <p className="mt-2 flex items-center justify-between gap-3 text-sm text-warn" role="status">
            {t('ride.lost')}
            <button type="button" className="font-semibold underline" onClick={() => setSensorsOpen(true)}>
              {t('ride.reconnect')}
            </button>
          </p>
        ) : null}
      </aside>
      {sensorsOpen ? (
        <SensorSheet
          trainer={trainer}
          supportReason={support.available ? undefined : support.reason}
          onClose={() => setSensorsOpen(false)}
          t={t}
        />
      ) : null}
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
            {engine.arrived ? <p className="mt-3 font-semibold text-accent">In cima: {setup.route.title} {setup.route.subtitle}.</p> : null}
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

function Cell({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-2xl bg-bg/60 px-2 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="num font-semibold">
        {value}
        {unit ? <span className="ml-1 text-xs font-medium text-muted">{unit}</span> : null}
      </dd>
    </div>
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
  return t('workouts.stepWork');
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
