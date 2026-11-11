import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cap, formatDateTime, formatDuration, formatKmText, formatNumber, formatTss } from '@/domain/format';
import { PageHeader, Segmented } from '@/components/ui';
import { WORLD_CATALOG, worldInfo, worldOfRide } from '@/open/worlds';

type WorldFilter = 'tutti' | 'altro' | (string & {});

/** Le scelte del filtro: solo i mondi che compaiono nel diario, e «Altro» per salite e giri importati (F.10). */
export function worldFilters(worlds: readonly (string | null)[]): { value: WorldFilter; label: string }[] {
  const have = new Set(worlds);
  const out: { value: WorldFilter; label: string }[] = [{ value: 'tutti', label: 'Tutti' }];
  for (const w of WORLD_CATALOG) if (have.has(w.id)) out.push({ value: w.id, label: w.short });
  if (have.has(null) && out.length > 1) out.push({ value: 'altro', label: 'Altro' });
  return out.length > 2 ? out : [];
}
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function HistoryPage() {
  const { t } = useI18n();
  const rides = useApp((s) => s.rides);
  const worlds = useMemo(() => rides.map((r) => worldOfRide(r)), [rides]);
  const filters = useMemo(() => worldFilters(worlds), [worlds]);
  const [filter, setFilter] = useState<WorldFilter>('tutti');
  const shown = filter === 'tutti' || !filters.length ? rides : rides.filter((_, i) => (filter === 'altro' ? worlds[i] === null : worlds[i] === filter));
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10">
      <PageHeader
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
      {filters.length ? (
        <div className="mt-3">
          <Segmented<WorldFilter> label="Mondo" value={filter} onChange={setFilter} options={filters} testId="history-worlds" />
        </div>
      ) : null}
      {rides.length === 0 ? (
        <p className="mt-8 rounded-3xl border border-dashed border-line p-5 text-muted">{t('history.empty')}</p>
      ) : (
        <ul className={`${filters.length ? 'mt-3' : 'mt-6'} flex flex-col gap-2`} data-testid="history-list" data-filter={filter}>
          {shown.map((ride, i) => (
            <li key={ride.id}>
              <Link to={`/history/${ride.id}`} className="block rounded-3xl border border-line bg-elev px-4 py-3">
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block font-semibold">{ride.name}</span>
                    <span className="text-sm text-muted">{cap(formatDateTime(ride.startTime))}</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="num block font-semibold">{`${formatKmText(ride.distanceM)}`}</span>
                    <span className="text-muted">{formatDuration(ride.durationSec)}</span>
                  </span>
                </span>
                <span className="mt-2 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <span>{ride.source === 'indoor' ? t('history.sourceIndoor') : t('history.sourceImport')}</span>
                  {worlds[rides.indexOf(ride)] ? <span data-testid={`history-world-${i}`}>{worldInfo(worlds[rides.indexOf(ride)]).short}</span> : null}
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
