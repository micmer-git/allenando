import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '@/components/ui';
import { Coin, Glyph } from '@/components/Glyph';
import { useGame } from '@/game/useGame';
import { missionsFor } from '@/game/missions';
import { phaseOf, upcoming, WORLD_RIDE_NAMES } from '@/game/sessions';
import { LevelRing } from './Me';
import { paceLabel, sessionClock, sessionHref, SessionKindToken } from './Sessions';
import { InstallCard } from '@/components/Install';
import { cap, formatDateTime, formatDuration, formatKm, formatKmText, formatNumber, formatTss } from '@/domain/format';
import { localDateKey, trainingLoad } from '@/domain/load';
import { VERIFIED_ROUTES } from '@/domain/routes';
import { WORLD_RIDES } from '@/multiplayer/world-rides';
import { useWorldManifests } from '@/components/WorldPicker';
import { seriesProgress } from '@/game/career';
import { SERIES } from '@/game/missions';
import { loadLastRide, repeatHref } from '@/open/lastRide';
import { lastWorld, worldInfo } from '@/open/worlds';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';
import { cn } from '@/lib/cn';

// la carta del programma (src/pages/Plans.tsx) si carica a parte: non pesa sull'avvio
const TodayWorkout = lazy(() => import('./Plans').then((mod) => ({ default: mod.TodayWorkout })));

export function HomePage() {
  const { t } = useI18n();
  const profile = useApp((s) => s.profile);
  const rides = useApp((s) => s.rides);
  const hydrateGame = useGame((s) => s.hydrate);
  const career = useGame((s) => s.career);
  const progress = useGame((s) => s.progress);
  useEffect(() => {
    void hydrateGame();
  }, [hydrateGame]);
  const now = useNow();
  const load = trainingLoad(rides.map((ride) => ({ date: localDateKey(new Date(ride.startTime)), tss: ride.tss ?? 0 })));
  const form = load[load.length - 1];
  const weekAgo = Date.now() - 7 * 86400_000;
  const week = rides.filter((r) => new Date(r.startTime).getTime() >= weekAgo);
  const weekKm = week.reduce((s, r) => s + r.distanceM, 0);
  const weekTss = week.reduce((s, r) => s + (r.tss ?? 0), 0);
  const recent = rides.slice(0, 3);
  const session = upcoming(now, 1)[0];
  const phase = phaseOf(session, now);
  // una sola azione piena per schermata: la sessione quando è aperta, altrimenti il mondo
  const sessionOpen = phase === 'aperta' || phase === 'via';
  // il mondo usato per ultimo (F.1) e l'ultimo giro (F.11): Oggi propone di ripartire da lì
  const worldId = lastWorld();
  const world = worldInfo(worldId);
  const manifests = useWorldManifests();
  const ridesCount = manifests[worldId]?.rides ?? (worldId === 'bergamo' ? Object.keys(WORLD_RIDES).length : null);
  const last = loadLastRide();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10">
      <header className="flex items-center justify-between gap-2">
        <Wordmark className="rail:hidden wide:hidden" />
        <Link to="/garage" className="num ml-auto inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-elev px-3 text-sm font-semibold" data-testid="home-oro">
          <Coin size={16} />
          {formatNumber(career.oro, 0)}
        </Link>
        <Link to="/tu" aria-label={t('a11y.openProfile')} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-elev pl-3 pr-0.5 text-sm font-semibold" data-testid="home-level">
          <span className="text-muted">Liv.</span>
          <LevelRing xp={progress.xp} size={40} />
        </Link>
      </header>
      <h1 className="mt-5 font-display text-5xl uppercase leading-[0.9]">{t('home.hello', { name: profile.name || 'Atleta' })}</h1>
      {career.streak.days >= 2 ? (
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
          <Glyph name="fiamma" size={16} /> {`${career.streak.days} giorni di fila`}
        </p>
      ) : null}

      <Suspense fallback={null}>
        <TodayWorkout className="mt-4" />
      </Suspense>
      <NextSession now={now} />

      <Missions done={career.missions.day === todayKey() ? career.missions.done : []} series={SERIES.filter((s) => s.world === worldId || seriesProgress(career, s.id).done > 0).map((s) => ({ name: s.name, ...seriesProgress(career, s.id) }))} />

      {/* il mondo è la cosa da fare: una carta grande col suo ingresso, e tre scorciatoie */}
      <section className="mt-3 overflow-hidden rounded-3xl border border-accent/50 bg-elev">
        <Link to={`/mondo?world=${worldId}`} data-testid="home-world" data-world={worldId} className="flex items-center gap-3 p-4 transition hover:bg-elev2/50">
          <span className="min-w-0 flex-1">
            <span className="eyebrow text-accent">Mondo aperto</span>
            <span className="mt-1 block font-display text-3xl uppercase leading-none">{world.name}</span>
            <span className="num mt-1.5 block text-sm text-muted">{ridesCount != null ? `${ridesCount} percorsi · ${world.blurb}` : world.blurb}</span>
          </span>
          <span
            aria-hidden="true"
            className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-full text-2xl', sessionOpen ? 'border border-accent/70 text-accent' : 'bg-accent text-accent-ink')}
          >
            →
          </span>
        </Link>
        <nav aria-label="Nel mondo" className="grid grid-cols-3 border-t border-line text-sm font-semibold">
          <Link to={`/mondo?world=${worldId}&tab=libero`} className="flex h-12 items-center justify-center">
            Giro libero
          </Link>
          <Link to={`/mondo?world=${worldId}&tab=anello`} className="flex h-12 items-center justify-center border-x border-line">
            Anello
          </Link>
          <Link to={`/mondo?world=${worldId}&tab=ab`} className="flex h-12 items-center justify-center">
            A → B
          </Link>
        </nav>
        {last ? (
          <Link to={repeatHref(last)} data-testid="home-repeat" className="flex min-h-12 items-center gap-3 border-t border-line px-4 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Ripeti l’ultimo giro</span>
              <span className="block leading-snug text-muted">{`${last.title}${last.world && last.world !== worldId ? ` · ${worldInfo(last.world).short}` : ''}`}</span>
            </span>
            <span aria-hidden="true" className="text-lg text-muted">→</span>
          </Link>
        ) : null}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="eyebrow">{t('home.climbs')}</h2>
          <Link to="/salite" className="-my-3 inline-flex h-11 items-center text-sm font-semibold text-accent">{t('home.allClimbs')}</Link>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {VERIFIED_ROUTES.map((r) => (
            <li key={r.id}>
              <Link to={`/salite/${r.id}`} data-testid={`home-climb-${r.id}`} className="block rounded-2xl border border-line bg-elev p-3 transition hover:border-accent/60">
                <span className="block font-display text-2xl uppercase leading-none">{r.name}</span>
                <span className="mt-1 block text-sm text-muted">{cap(r.side)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Link to="/giri" className="flex items-center justify-between rounded-2xl border border-line bg-elev px-4 py-4">
          <span>
            <span className="block font-display text-2xl uppercase leading-none">{t('home.replay')}</span>
            <span className="mt-1 block text-sm text-muted">{t('home.replayHint')}</span>
          </span>
          <span aria-hidden="true" className="text-2xl text-muted">→</span>
        </Link>
        <Link to="/workouts" className="flex items-center justify-between rounded-2xl border border-line bg-elev px-4 py-4">
          <span>
            <span className="block font-display text-2xl uppercase leading-none">{t('home.guided')}</span>
            <span className="mt-1 block text-sm text-muted">{t('home.guidedHint')}</span>
          </span>
          <span aria-hidden="true" className="text-2xl text-muted">→</span>
        </Link>
      </div>

      {/* i numeri della settimana compaiono col primo giro: prima sarebbero tre trattini */}
      {rides.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2" data-testid="home-week">
          <Stat label="Km · 7 gg" value={weekKm > 0 ? formatKm(weekKm) : '–'} />
          <Stat label="TSS · 7 gg" value={weekTss > 0 ? formatTss(weekTss) : '–'} />
          <Link to="/load" className="rounded-2xl border border-line bg-elev p-3">
            <span className="eyebrow block">{t('home.form')}</span>
            <span className="num mt-1 block font-display text-3xl">{form ? formatNumber(form.tsb, 0) : '–'}</span>
          </Link>
        </div>
      ) : null}

      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="eyebrow">{t('home.recent')}</h2>
          <Link to="/history" className="-my-3 inline-flex h-11 items-center text-sm font-semibold text-accent">{t('home.seeAll')}</Link>
        </div>
        {recent.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-4 text-muted">{t('home.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((ride) => (
              <li key={ride.id}>
                <Link to={`/history/${ride.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-elev px-4 py-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">{ride.name}</span>
                    <span className="text-sm text-muted">{cap(formatDateTime(ride.startTime))}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block font-semibold">{`${formatKmText(ride.distanceM)}`}</span>
                    <span className="text-sm text-muted">{`${formatDuration(ride.durationSec)}${ride.tss != null ? ` · ${formatTss(ride.tss)} TSS` : ''}`}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InstallCard className="mt-6" />
    </main>
  );
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** L'ora che scorre, un tick al secondo: il conto alla rovescia della sessione. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** La prossima sessione, col conto alla rovescia e l'ingresso se è aperta. */
function NextSession({ now }: { now: number }) {
  const s = upcoming(now, 1)[0];
  const ph = phaseOf(s, now);
  const can = ph === 'aperta' || ph === 'via';
  const name = WORLD_RIDE_NAMES[s.rideId] ?? s.rideId;
  const clock = sessionClock(s, now);
  return (
    <section className={cn('mt-4 rounded-3xl border bg-elev', can ? 'border-accent/60' : 'border-line')} data-testid="home-session">
      <div className="flex items-center gap-3 py-3 pl-4 pr-3">
        <div className="min-w-0 flex-1">
          <span className="eyebrow block" style={can ? { color: 'var(--accent)' } : undefined}>{ph === 'via' ? 'Sessione in corso' : ph === 'aperta' ? 'Sessione aperta ora' : 'Prossima sessione'}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <SessionKindToken kind={s.kind} />
            <span className="font-semibold leading-snug">{name}</span>
          </span>
          <span className="num mt-0.5 block text-sm leading-snug text-muted">
            {`${s.pace ? `${paceLabel(s.pace)} · ` : ''}${new Date(s.start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
        <p className="num shrink-0 text-right leading-none" data-testid="home-session-clock" aria-label={clock.text}>
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{clock.label}</span>
          <span className="mt-1 block font-display text-3xl">{clock.value}</span>
        </p>
        {can ? (
          <Link to={sessionHref(s)} className="grid h-11 shrink-0 place-items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink" data-testid="home-session-join">
            Entra
          </Link>
        ) : (
          <Link to="/sessioni" className="grid h-11 shrink-0 place-items-center rounded-full bg-elev2 px-4 text-sm font-semibold">
            Tutte
          </Link>
        )}
      </div>
    </section>
  );
}

/** Le tre missioni di oggi: si fanno pedalando, una spunta per ognuna. Sotto, le serie a tappe (F.7). */
function Missions({ done, series }: { done: string[]; series: { name: string; done: number; total: number; finished: boolean }[] }) {
  const list = missionsFor(todayKey());
  return (
    <section className="mt-3 rounded-3xl border border-line bg-elev p-3" data-testid="home-missions">
      <div className="flex items-baseline justify-between">
        <h2 className="eyebrow">Missioni di oggi</h2>
        <span className="num text-xs text-muted">
          {done.length}/{list.length}
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {list.map((m) => {
          const ok = done.includes(m.id);
          return (
            <li key={m.id} className="flex items-center gap-2.5">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${ok ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`} aria-hidden="true">
                {ok ? '✓' : ''}
              </span>
              <span className={`min-w-0 flex-1 text-sm ${ok ? 'text-muted line-through' : ''}`}>{m.title}</span>
              <span className="num inline-flex items-center gap-1 text-xs text-muted">
                <Coin size={13} /> {m.oro}
              </span>
            </li>
          );
        })}
      </ul>
      {series.length ? (
        <ul className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2" data-testid="home-series">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-2.5 text-sm">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${s.finished ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`} aria-hidden="true">
                {s.finished ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1">{`Serie ${s.name}`}</span>
              <span className="num text-xs text-muted">{s.finished ? 'Finita' : `Tappa ${Math.min(s.total, s.done + 1)} di ${s.total}`}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-elev p-3">
      <span className="eyebrow block">{label}</span>
      <span className="num mt-1 block font-display text-3xl">{value}</span>
    </div>
  );
}
