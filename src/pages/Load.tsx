import { Link } from 'react-router-dom';
import { LoadChart } from '@/components/Charts';
import { formatNumber } from '@/domain/format';
import { localDateKey, trainingLoad } from '@/domain/load';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function LoadPage() {
  const { t } = useI18n();
  const rides = useApp((s) => s.rides);
  const days = trainingLoad(rides.map((ride) => ({ date: localDateKey(new Date(ride.startTime)), tss: ride.tss ?? 0 })));
  const today = days[days.length - 1];
  const has = rides.some((ride) => (ride.tss ?? 0) > 0);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10">
      <h1 className="font-display text-5xl tracking-tight">{t('load.title')}</h1>
      <p className="mt-3 max-w-xl text-lg leading-relaxed text-muted">{t('load.lead')}</p>
      <div className="mt-5 grid grid-cols-3 gap-3">
        <Tile label={t('load.ctl')} value={today ? formatNumber(today.ctl, 0) : '–'} color="#7eb6ff" />
        <Tile label={t('load.atl')} value={today ? formatNumber(today.atl, 0) : '–'} color="#f0943a" />
        <Tile label={t('load.tsb')} value={today ? formatNumber(today.tsb, 0) : '–'} color="#3dbe8a" />
      </div>
      <section className="mt-5 rounded-3xl border border-line bg-elev p-4">
        {has ? <LoadChart days={days} /> : <p className="text-muted">{t('load.empty')}</p>}
        <ul className="mt-2 flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-wide text-muted">
          <li className="flex items-center gap-1"><i className="h-2 w-4 rounded-full bg-[#7eb6ff]" /> CTL</li>
          <li className="flex items-center gap-1"><i className="h-2 w-4 rounded-full bg-[#f0943a]" /> ATL</li>
          <li className="flex items-center gap-1"><i className="h-2 w-4 rounded-full bg-[#3dbe8a]" /> TSB</li>
          <li className="flex items-center gap-1"><i className="h-2 w-4 rounded-full bg-accent" /> TSS</li>
        </ul>
      </section>
      <p className="mt-3 text-sm text-muted">{t('load.hint')}</p>
      <Link to="/import" className="mt-4 inline-block font-semibold text-accent">{t('history.import')}</Link>
    </main>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-3xl border border-line bg-elev p-3">
      <span className="block text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="num mt-1 block font-display text-3xl" style={{ color }}>{value}</span>
    </div>
  );
}
