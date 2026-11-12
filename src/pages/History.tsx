import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cap, formatDuration, formatHours, formatKmText, formatNumber, formatTss } from '@/domain/format';
import { localDateKey, trainingLoad } from '@/domain/load';
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
  // la settimana nei gettoni (A3): km, ore, TSS degli ultimi 7 giorni, e la forma (TSB) che porta al Carico
  const weekAgo = Date.now() - 7 * 86400_000;
  const week = rides.filter((r) => new Date(r.startTime).getTime() >= weekAgo);
  const km = week.reduce((s, r) => s + r.distanceM, 0);
  const sec = week.reduce((s, r) => s + r.durationSec, 0);
  const tss = week.reduce((s, r) => s + (r.tss ?? 0), 0);
  const load = trainingLoad(rides.map((ride) => ({ date: localDateKey(new Date(ride.startTime)), tss: ride.tss ?? 0 })));
  const form = load[load.length - 1];
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10" data-testid="diario">
      <PageHeader
        title={t('history.title')}
        aside={
          <Link to="/import" className="inline-flex h-11 items-center rounded-full border border-line bg-elev px-4 font-semibold" data-testid="diario-importa">
            {t('history.import')}
          </Link>
        }
      />
      {rides.length > 0 ? (
        <p className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="diario-settimana">
          {week.length > 0 ? (
            <>
              <Gettone>{`7 gg · ${formatKmText(km)}`}</Gettone>
              <Gettone>{formatHours(sec)}</Gettone>
              <Gettone>{`TSS ${formatTss(tss)}`}</Gettone>
            </>
          ) : (
            <Gettone>7 gg · Nessun giro</Gettone>
          )}
          <Link to="/load" className="inline-flex h-11 items-center rounded-full border border-line px-3 text-xs font-semibold" data-testid="diario-forma">
            {`Forma ${form ? `${form.tsb > 0 ? '+' : ''}${formatNumber(form.tsb, 0)}` : '–'} ›`}
          </Link>
        </p>
      ) : null}
      {filters.length ? (
        <div className="mt-3">
          <Segmented<WorldFilter> label="Mondo" value={filter} onChange={setFilter} options={filters} testId="history-worlds" />
        </div>
      ) : null}
      {rides.length === 0 ? (
        <p className="mt-8 rounded-3xl border border-dashed border-line p-5 text-muted">{t('history.empty')}</p>
      ) : (
        <ul className="mt-2" data-testid="history-list" data-filter={filter}>
          {shown.map((ride, i) => {
            const w = worlds[rides.indexOf(ride)];
            const dove = ride.source === 'import' ? `${(ride.fileType ?? 'file').toUpperCase()} importato` : w ? worldInfo(w).short : ride.workoutName ?? '';
            return (
              <li key={ride.id}>
                <Link to={`/history/${ride.id}`} className="flex min-h-14 items-center justify-between gap-3 border-b border-line py-2" data-testid={`diario-giro-${i}`}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 font-semibold leading-snug">
                      {ride.name}
                      {ride.prova ? <span className="rounded-full border border-line px-2 py-px text-xs font-semibold" data-testid="diario-prova">Prova</span> : null}
                    </span>
                    <span className="block text-sm leading-snug text-muted">
                      {cap(quando(ride.startTime))}
                      {dove ? <span data-testid={w ? `history-world-${i}` : undefined}>{` · ${dove}`}</span> : null}
                    </span>
                  </span>
                  <span className="num shrink-0 text-right leading-snug">
                    <b className="block">{formatKmText(ride.distanceM)}</b>
                    <span className="text-sm text-muted">{formatDuration(ride.durationSec)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function Gettone({ children }: { children: string }) {
  return <span className="inline-flex h-8 items-center rounded-full border border-line px-3 text-xs font-semibold">{children}</span>;
}

/** «Oggi, 18:40», «Ieri», «9 novembre». */
function quando(iso: string): string {
  const d = new Date(iso);
  const oggi = new Date();
  const ieri = new Date(oggi.getTime() - 86400_000);
  const stesso = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (stesso(d, oggi)) return `Oggi, ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  if (stesso(d, ieri)) return 'Ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', ...(d.getFullYear() !== oggi.getFullYear() ? { year: 'numeric' } : {}) });
}
