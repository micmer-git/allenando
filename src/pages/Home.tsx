import { Link } from 'react-router-dom';
import { Wordmark } from '@/components/ui';
import { InstallCard } from '@/components/Install';
import { formatDateTime, formatDuration, formatKm, formatNumber } from '@/domain/format';
import { localDateKey, trainingLoad } from '@/domain/load';
import { VERIFIED_ROUTES } from '@/domain/routes';
import { WORLD_RIDES } from '@/multiplayer/world-rides';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function HomePage() {
  const { t } = useI18n();
  const profile = useApp((s) => s.profile);
  const rides = useApp((s) => s.rides);
  const load = trainingLoad(rides.map((ride) => ({ date: localDateKey(new Date(ride.startTime)), tss: ride.tss ?? 0 })));
  const form = load[load.length - 1];
  const weekAgo = Date.now() - 7 * 86400_000;
  const week = rides.filter((r) => new Date(r.startTime).getTime() >= weekAgo);
  const weekKm = week.reduce((s, r) => s + r.distanceM, 0);
  const weekTss = week.reduce((s, r) => s + (r.tss ?? 0), 0);
  const recent = rides.slice(0, 3);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10">
      <header className="flex items-center justify-between">
        <Wordmark className="md:hidden" />
        <Link to="/profile" aria-label={t('a11y.openProfile')} className="ml-auto grid h-11 w-11 place-items-center rounded-full border border-line bg-elev text-base font-semibold">
          {(profile.name || 'A').slice(0, 1).toUpperCase()}
        </Link>
      </header>
      <h1 className="mt-5 font-display text-5xl uppercase leading-[0.9]">{t('home.hello', { name: profile.name || 'Atleta' })}</h1>

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-elev p-3">
      <span className="eyebrow block">{label}</span>
      <span className="num mt-1 block font-display text-3xl">{value}</span>
    </div>
  );
}
