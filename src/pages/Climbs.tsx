import { Link } from 'react-router-dom';
import { ProfileChart, RouteMap, useVerifiedRoute } from '@/components/RouteViz';
import { formatKm, formatNumber } from '@/domain/format';
import { CATALOG, routeStats, VERIFIED_ROUTES, type RouteMeta } from '@/domain/routes';

export function ClimbsPage() {
  const missing = CATALOG.filter((c) => !c.routeId);
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-nav pt-6 md:px-8 md:pt-10" data-testid="climbs-page">
      <p className="eyebrow">Strade vere · OSM + EU-DEM</p>
      <h1 className="mt-1 font-display text-5xl uppercase leading-none">Salite</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Tre salite, quattro versanti. La pianta è la strada di OpenStreetMap, nodo per nodo; la quota viene dal modello del terreno europeo a 25 m.
      </p>
      <ul className="mt-6 grid gap-3 md:grid-cols-2">
        {VERIFIED_ROUTES.map((meta) => (
          <ClimbCard key={meta.id} meta={meta} />
        ))}
      </ul>

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-3xl uppercase">Catalogo</h2>
          <span className="text-sm text-muted">
            {CATALOG.length - missing.length} su {CATALOG.length} con traccia
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Le altre grandi salite arrivano quando c’è una traccia verificata. Fino ad allora niente numeri inventati: se hai il GPX di un tuo giro lassù, importalo e pedalalo.
        </p>
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-elev">
          {CATALOG.map((c) => (
            <li key={`${c.name}-${c.side}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="block truncate text-sm text-muted">
                  {c.side} · {c.region}
                </span>
              </span>
              {c.routeId ? (
                <Link to={`/salite/${c.routeId}`} className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent-ink">
                  Traccia verificata
                </Link>
              ) : (
                <Link to="/giri" className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  Traccia da acquisire
                </Link>
              )}
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
            <p className="text-muted">{meta.side}</p>
            {stats ? (
              <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
                <Fact label="km" value={formatKm(stats.lengthM)} />
                <Fact label="D+" value={`${formatNumber(stats.endAlt - stats.startAlt, 0)} m`} />
                <Fact label="media" value={`${formatNumber(stats.avgGrade * 100, 1)}%`} />
                <Fact label="arrivo" value={`${formatNumber(stats.endAlt, 0)} m`} />
                <Fact label="km duro" value={`${formatNumber(stats.maxKmGrade * 100, 1)}%`} />
                <Fact label="tornanti" value={String(stats.hairpins)} />
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
