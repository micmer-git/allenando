import { Link } from 'react-router-dom';
import { cap, formatDateTime, formatDuration, formatKm, formatNumber, formatTss } from '@/domain/format';
import { PageHeader } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function HistoryPage() {
  const { t } = useI18n();
  const rides = useApp((s) => s.rides);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10">
      <PageHeader
        back={{ to: '/tu', label: 'Tu' }}
        title={t('history.title')}
        aside={
          <Link to="/import" className="inline-flex h-11 items-center rounded-full border border-line bg-elev px-4 font-semibold">
            {t('history.import')}
          </Link>
        }
      />
      <Link to="/load" className="-ml-2 mt-1 inline-flex h-11 min-w-11 items-center px-2 text-sm font-semibold text-accent">
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
                    <span className="text-sm text-muted">{cap(formatDateTime(ride.startTime))}</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="num block font-semibold">{`${formatKm(ride.distanceM)} km`}</span>
                    <span className="text-muted">{formatDuration(ride.durationSec)}</span>
                  </span>
                </span>
                <span className="mt-2 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <span>{ride.source === 'indoor' ? t('history.sourceIndoor') : t('history.sourceImport')}</span>
                  {ride.tss != null ? <span>{`${formatTss(ride.tss)} TSS`}</span> : null}
                  {ride.np != null ? <span>{`NP ${formatNumber(ride.np, 0)}`}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
