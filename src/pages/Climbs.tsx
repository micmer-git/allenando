import { Link } from 'react-router-dom';
import { ProfileChart, RouteMap, useVerifiedRoute } from '@/components/RouteViz';
import { cap, formatAltText, formatKm, formatNumber } from '@/domain/format';
import { PageHeader } from '@/components/ui';
import { CATALOG, routeStats, VERIFIED_ROUTES, type RouteMeta } from '@/domain/routes';

export function ClimbsPage() {
  const missing = CATALOG.filter((c) => !c.routeId);
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-nav pt-6 md:px-8 md:pt-10" data-testid="climbs-page">
      <PageHeader title="Salite" />
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {VERIFIED_ROUTES.map((meta) => (
          <ClimbCard key={meta.id} meta={meta} />
        ))}
      </ul>

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-3xl uppercase">Catalogo</h2>
          <span className="num text-sm text-muted">{`${CATALOG.length - missing.length} su ${CATALOG.length} con traccia`}</span>
        </div>
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-elev">
          {CATALOG.map((c) => (
            <li key={`${c.name}-${c.side}`}>
              {/* tutta la riga si tocca, non solo la pillola: bersaglio alto quanto la riga */}
              <Link
                to={c.routeId ? `/salite/${c.routeId}` : '/giri'}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition hover:bg-elev2"
              >
                <span className="min-w-0">
                  <span className="block font-semibold leading-snug">{c.name}</span>
                  <span className="block text-sm leading-snug text-muted">{`${cap(c.side ?? '')}${c.side ? ' · ' : ''}${c.region}`}</span>
                </span>
                {c.routeId ? (
                  <span className="shrink-0 rounded-full border border-accent/60 px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent">Traccia verificata</span>
                ) : (
                  <span className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">Traccia da acquisire</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function ClimbCard({ meta }: { meta: RouteMeta }) {
  const { route, error } = useVerifiedRoute(meta.id);
  const stats = route ? routeStats(route.track) : null;
  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-elev">
      <Link to={`/salite/${meta.id}`} className="block" data-testid={`climb-${meta.id}`}>
        <div className="flex gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{meta.region}</p>
            <h3 className="mt-1 font-display text-3xl uppercase leading-none">{meta.name}</h3>
            <p className="text-muted">{cap(meta.side)}</p>
            {stats ? (
              <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
                <Fact label="Km" value={formatKm(stats.lengthM)} />
                <Fact label="D+" value={formatAltText(stats.endAlt - stats.startAlt)} />
                <Fact label="Media" value={`${formatNumber(stats.avgGrade * 100, 1)}%`} />
              </dl>
            ) : (
              <p className="mt-3 text-sm text-muted">{error ?? 'Carico la traccia…'}</p>
            )}
          </div>
          <div className="w-28 shrink-0 self-center">{route ? <RouteMap track={route.track} className="h-28 w-28" /> : <div className="h-28 w-28 rounded-xl bg-elev2" />}</div>
        </div>
        {route ? <ProfileChart track={route.track} className="block h-16 w-full" height={64} /> : <div className="h-16 bg-elev2" />}
      </Link>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="num font-semibold">{value}</dd>
    </div>
  );
}
