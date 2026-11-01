import { Link } from 'react-router-dom';
import { kmWithCamilla, milestoneById, nextMilestone, previousMilestone } from '@/domain/camilla';
import { formatDateTime, formatDuration, formatKm, formatKmValue, formatNumber } from '@/domain/format';
import { localDateKey, trainingLoad } from '@/domain/load';
import { sleepSecondsOnDay } from '@/domain/sleep';
import { formatHours } from '@/domain/format';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function HomePage() {
  const { t } = useI18n();
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const rides = useApp((s) => s.rides);
  const sleeps = useApp((s) => s.sleeps);
  const badges = useApp((s) => s.badges);
  const km = kmWithCamilla(rides);
  const next = nextMilestone(km);
  const prev = previousMilestone(km)?.km ?? 0;
  const progress = next ? Math.min(1, Math.max(0, (km - prev) / (next.km - prev))) : 1;
  const today = localDateKey(new Date());
  const sleep = sleepSecondsOnDay(sleeps, today);
  const load = trainingLoad(
    rides.map((ride) => ({ date: localDateKey(new Date(ride.startTime)), tss: ride.tss ?? 0 })),
  );
  const form = load[load.length - 1];
  const recent = rides.slice(0, 3);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10">
      <header className="flex items-center justify-between">
        <p className="font-display text-2xl tracking-tight md:hidden">
          Camilla <span className="text-accent">Ride</span>
        </p>
        <Link to="/profile" aria-label={t('a11y.openProfile')} className="ml-auto grid h-12 w-12 place-items-center rounded-full bg-elev text-lg font-semibold">
          {(profile.name || 'A').slice(0, 1).toUpperCase()}
        </Link>
      </header>
      <h1 className="mt-6 font-display text-5xl leading-[0.95] tracking-tight">{t('home.hello', { name: profile.name || 'Atleta' })}</h1>
      <p className="mt-3 text-lg text-muted">{settings.camilla ? t('home.withCamilla') : t('home.without')}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link to="/ride" data-testid="home-ride" className="rounded-3xl bg-accent p-5 text-accent-ink">
          <span className="block font-display text-3xl leading-none">{t('home.freeRide')}</span>
          <span className="mt-2 block text-sm font-medium opacity-80">{t('home.freeHint')}</span>
        </Link>
        <Link to="/workouts" className="rounded-3xl border border-line bg-elev p-5">
          <span className="block font-display text-3xl leading-none">{t('home.guided')}</span>
          <span className="mt-2 block text-sm text-muted">{t('home.guidedHint')}</span>
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label={t('home.km')} value={settings.camilla ? formatKmValue(km) : '–'} />
        <Stat label={t('home.sleepToday')} value={sleep > 0 ? formatHours(sleep) : '–'} />
        <Link to="/load" className="rounded-3xl border border-line bg-elev p-3">
          <span className="block text-xs uppercase tracking-wide text-muted">{t('home.form')}</span>
          <span className="num mt-1 block font-display text-2xl">{form ? formatNumber(form.tsb, 0) : '–'}</span>
        </Link>
      </div>
      {settings.camilla ? (
        <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-camilla">{t('home.next')}</p>
          <p className="mt-1 text-lg">
            {next
              ? t('home.remaining', { km: formatKmValue(next.km - km), title: t(next.titleKey) })
              : t('home.allDone')}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-elev2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
          </div>
          {badges.length > 0 ? (
            <ul className="mt-3 flex gap-2 overflow-auto">
              {badges.map((id) => {
                const item = milestoneById(id);
                return (
                  <li key={id} className="shrink-0 rounded-full bg-elev2 px-3 py-1 text-sm">
                    {item ? t(item.titleKey) : id}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-2xl">{t('home.recent')}</h2>
          <Link to="/history" className="text-sm font-semibold text-accent">
            {t('home.seeAll')}
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line p-5 text-muted">{t('home.empty')}</p>
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
    <div className="rounded-3xl border border-line bg-elev p-3">
      <span className="block text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="num mt-1 block font-display text-2xl">{value}</span>
    </div>
  );
}
