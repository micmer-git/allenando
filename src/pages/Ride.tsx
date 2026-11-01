import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkoutChart } from '@/components/WorkoutChart';
import { Button, Segmented } from '@/components/ui';
import { bluetoothSupport } from '@/bluetooth/support';
import { BluetoothTrainer } from '@/bluetooth/trainer';
import { formatDuration, formatGrade, formatKm, formatNumber, msToKmh } from '@/domain/format';
import { STANDARD_AIR, type PhysicsParams } from '@/domain/physics';
import { getTrack } from '@/domain/track';
import type { Profile, Quality, Workout, WorkoutStep } from '@/domain/types';
import { estimateLthr, powerZone } from '@/domain/zones';
import { findWorkout, workoutAt } from '@/domain/workouts';
import { useI18n, type Translate } from '@/i18n';
import { RideEngine } from '@/sim/engine';
import { useApp } from '@/store/useApp';
import { RideScene } from '@/world/Scene';
import { workoutTitle } from './Workouts';

export function RidePage() {
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
    const engine = new RideEngine({
      track: getTrack(),
      source: trainer,
      physics: physicsFrom(profile),
      ftp: profile.ftp,
      maxHr: profile.maxHr,
      restHr: profile.restingHr,
      lthr: estimateLthr(profile.maxHr, profile.thresholdHr),
      weightKg: profile.weightKg,
      workout,
      withCamilla: settings.camilla,
      crr: profile.crr,
      cw: profile.cda * 1.225,
    });
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

  return (
    <RideScreen engine={engine} trainer={trainer} profile={profile} workout={workout} quality={settings.quality} t={t} />
  );
}

function RideScreen({
  engine,
  trainer,
  profile,
  workout,
  quality,
  t,
}: {
  engine: RideEngine;
  trainer: BluetoothTrainer;
  profile: Profile;
  workout: Workout | null;
  quality: Quality;
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
  const [badges, setBadges] = useState<string[]>([]);
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
  const rideName = workout
    ? workoutTitle(workout, t)
    : engine.withCamilla
      ? t('rides.withCamilla')
      : t('rides.free');

  function finish() {
    engine.finish();
    setSummary(engine.toRide(rideName));
  }

  return (
    <div className="flex h-dvh flex-col bg-bg md:flex-row" data-testid="ride-screen" data-camilla={engine.withCamilla ? 'yes' : 'no'}>
      <div className="relative min-h-0 flex-1">
        <WorldBoundary onFail={() => setWebgl(false)}>
          {webgl ? (
            <RideScene
              key={quality}
              engine={engine}
              quality={quality}
              camilla={engine.withCamilla}
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
        {engine.withCamilla ? (
          <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-bg/70 px-3 py-1 text-sm font-semibold text-camilla backdrop-blur">
            {t('ride.camillaAboard')}
          </p>
        ) : null}
        <span data-testid="world-ready" data-ready={ready ? 'yes' : 'no'} className="sr-only" />
      </div>
      <aside className="max-h-[48%] overflow-auto border-t border-line bg-elev px-4 pb-[max(0.8rem,env(safe-area-inset-bottom))] pt-3 md:max-h-none md:w-[400px] md:shrink-0 md:border-l md:border-t-0">
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
        <div className="mt-3 grid grid-cols-2 gap-2">
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
            {badges.length > 0 ? (
              <p className="mt-4 text-camilla">{t('ride.newBadge')}: {badges.join(', ')}</p>
            ) : null}
            <div className="mt-6 flex flex-col gap-2">
              {saved ? (
                <Button data-testid="ride-open-history" onClick={() => navigate(`/history/${summary.id}`)}>
                  {t('ride.toHistory')}
                </Button>
              ) : (
                <Button
                  data-testid="ride-save"
                  onClick={() => {
                    void saveRide(summary).then((fresh) => {
                      setBadges(fresh);
                      setSaved(true);
                    });
                  }}
                >
                  {t('actions.save')}
                </Button>
              )}
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
