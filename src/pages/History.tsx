import { Link } from 'react-router-dom';
import { formatDateTime, formatDuration, formatKm, formatNumber } from '@/domain/format';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function HistoryPage() {
  const { t } = useI18n();
  const rides = useApp((s) => s.rides);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10">
      <div className="flex items-end justify-between gap-3">
        <h1 className="font-display text-5xl tracking-tight">{t('history.title')}</h1>
        <Link to="/import" className="inline-flex h-11 items-center rounded-full bg-accent px-4 font-semibold text-accent-ink">
          {t('history.import')}
        </Link>
      </div>
      <Link to="/load" className="mt-4 inline-block text-sm font-semibold text-accent">
        {t('history.load')}
      </Link>
      {rides.length === 0 ? (
        <p className="mt-8 rounded-3xl border border-dashed border-line p-5 text-muted">{t('history.empty')}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rides.map((ride) => (
            <li key={ride.id}>
              <Link to={`/history/${ride.id}`} className="block rounded-3xl border border-line bg-elev px-4 py-3">
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block font-semibold">{ride.name}</span>
                    <span className="text-sm text-muted">{formatDateTime(ride.startTime)}</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="num block font-semibold">{formatKm(ride.distanceM)} km</span>
                    <span className="text-muted">{formatDuration(ride.durationSec)}</span>
                  </span>
                </span>
                <span className="mt-2 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <span>{ride.source === 'indoor' ? t('history.sourceIndoor') : t('history.sourceImport')}</span>
                  {ride.withCamilla ? <span className="text-camilla">{t('history.withCamilla')}</span> : null}
                  {ride.tss != null ? <span>{formatNumber(ride.tss, 0)} TSS</span> : null}
                  {ride.np != null ? <span>NP {formatNumber(ride.np, 0)}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
