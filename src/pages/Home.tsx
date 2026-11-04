import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '@/components/ui';
import { Coin, Glyph } from '@/components/Glyph';
import { useGame } from '@/game/useGame';
import { missionsFor } from '@/game/missions';
import { phaseOf, SESSION_STYLE, upcoming, WORLD_RIDE_NAMES } from '@/game/sessions';
import { LevelRing } from './Me';
import { countdown, sessionHref } from './Sessions';
import { InstallCard } from '@/components/Install';
import { formatDateTime, formatDuration, formatKm, formatNumber } from '@/domain/format';
import { localDateKey, trainingLoad } from '@/domain/load';
import { VERIFIED_ROUTES } from '@/domain/routes';
import { WORLD_RIDES } from '@/multiplayer/world-rides';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

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
  const load = trainingLoad(rides.map((ride) => ({ date: localDateKey(new Date(ride.startTime)), tss: ride.tss ?? 0 })));
  const form = load[load.length - 1];
  const weekAgo = Date.now() - 7 * 86400_000;
  const week = rides.filter((r) => new Date(r.startTime).getTime() >= weekAgo);
  const weekKm = week.reduce((s, r) => s + r.distanceM, 0);
  const weekTss = week.reduce((s, r) => s + (r.tss ?? 0), 0);
  const recent = rides.slice(0, 3);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10">
      <header className="flex items-center justify-between gap-2">
        <Wordmark className="md:hidden" />
        <Link to="/garage" className="num ml-auto inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-elev px-3 text-sm font-semibold" data-testid="home-oro">
          <Coin size={16} />
          {formatNumber(career.oro, 0)}
        </Link>
        <Link to="/tu" aria-label={t('a11y.openProfile')} className="rounded-full" data-testid="home-level">
          <LevelRing xp={progress.xp} size={44} />
        </Link>
      </header>
      <h1 className="mt-5 font-display text-5xl uppercase leading-[0.9]">{t('home.hello', { name: profile.name || 'Atleta' })}</h1>
      {career.streak.days >= 2 ? (
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
          <Glyph name="fiamma" size={16} /> {career.streak.days} giorni di fila
        </p>
      ) : null}

      <Suspense fallback={null}>
        <TodayWorkout className="mt-4" />
      </Suspense>
      <NextSession />
      <Missions done={career.missions.day === todayKey() ? career.missions.done : []} />

      {/* il mondo è la cosa da fare: una carta grande col suo ingresso, e tre scorciatoie */}
      <section className="mt-5 overflow-hidden rounded-3xl border border-accent/50 bg-elev">
        <Link to="/mondo" data-testid="home-world" className="flex items-center gap-3 p-4 transition hover:bg-elev2/50">
          <span className="min-w-0 flex-1">
            <span className="eyebrow text-accent">Mondo aperto</span>
            <span className="mt-1 block font-display text-3xl uppercase leading-none">Bergamo e le valli</span>
            <span className="num mt-1.5 block text-sm text-muted">{Object.keys(WORLD_RIDES).length} percorsi · Città Alta, Val Brembana, Val Seriana</span>
          </span>
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent text-2xl text-accent-ink">
            →
          </span>
        </Link>
        <nav aria-label="Nel mondo" className="grid grid-cols-3 border-t border-line text-sm font-semibold">
          <Link to="/mondo?tab=libero" className="flex h-12 items-center justify-center">
            Giro libero
          </Link>
          <Link to="/mondo?tab=anello" className="flex h-12 items-center justify-center border-x border-line">
            Anello
          </Link>
          <Link to="/mondo?tab=ab" className="flex h-12 items-center justify-center">
            A → B
          </Link>
        </nav>
      </section>

      <InstallCard className="mt-3" />

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
                <span className="mt-1 block text-sm text-muted">{r.side}</span>
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

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="km · 7 gg" value={weekKm > 0 ? formatKm(weekKm) : '–'} />
        <Stat label="TSS · 7 gg" value={weekTss > 0 ? formatNumber(weekTss, 0) : '–'} />
        <Link to="/load" className="rounded-2xl border border-line bg-elev p-3">
          <span className="eyebrow block">{t('home.form')}</span>
          <span className="num mt-1 block font-display text-3xl">{form ? formatNumber(form.tsb, 0) : '–'}</span>
        </Link>
      </div>

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
                <Link to={`/history/${ride.id}`} className="flex items-center justify-between rounded-2xl bg-elev px-4 py-3">
                  <span>
                    <span className="block font-semibold">{ride.name}</span>
                    <span className="text-sm text-muted">{formatDateTime(ride.startTime)}</span>
                  </span>
                  <span className="text-right">
                    <span className="num block font-semibold">{formatKm(ride.distanceM)} km</span>
                    <span className="text-sm text-muted">
                      {formatDuration(ride.durationSec)}
                      {ride.tss != null ? ` · ${formatNumber(ride.tss, 0)} TSS` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** La prossima sessione, col conto alla rovescia e l'ingresso se è aperta. */
function NextSession() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = upcoming(now, 1)[0];
  const ph = phaseOf(s, now);
  const st = SESSION_STYLE[s.kind];
  const can = ph === 'aperta' || ph === 'via';
  const name = WORLD_RIDE_NAMES[s.rideId] ?? s.rideId;
  return (
    <section className="relative mt-4 overflow-hidden rounded-3xl border border-line bg-elev" data-testid="home-session">
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: st.color }} aria-hidden="true" />
      <div className="flex items-center gap-3 py-3 pl-5 pr-3">
        <div className="min-w-0 flex-1">
          <span className="eyebrow">{ph === 'via' ? 'Sessione in corso' : 'Prossima sessione'}</span>
          <span className="mt-0.5 block truncate font-semibold">{s.title}</span>
          <span className="block truncate text-sm text-muted">
            {name} · {new Date(s.start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <span className="num shrink-0 font-display text-3xl leading-none">{ph === 'via' ? 'VIA' : countdown(s.start - now)}</span>
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

/** Le tre missioni di oggi: si fanno pedalando, una spunta per ognuna. */
function Missions({ done }: { done: string[] }) {
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
