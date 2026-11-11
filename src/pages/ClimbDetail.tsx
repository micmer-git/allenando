import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GRADE_LEGEND, gradeColor, ProfileChart, RouteMap, useVerifiedRoute } from '@/components/RouteViz';
import { Button, PageHeader } from '@/components/ui';
import { BoardPanel } from '@/components/Board';
import { Chevron } from '@/components/Glyph';
import { cap, formatAlt, formatAltText, formatDuration, formatKm, formatNumber } from '@/domain/format';
import { projector } from '@/domain/geo';
import { osmUrl, routeMeta, routeStats, streetViewUrl } from '@/domain/routes';
import { ALL_BUILTIN } from '@/domain/workouts';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';
import { workoutTitle } from './Workouts';

export function ClimbDetailPage() {
  const { id = '' } = useParams();
  const meta = routeMeta(id);
  const { route, error } = useVerifiedRoute(id);
  const navigate = useNavigate();
  const { t } = useI18n();
  const rides = useApp((s) => s.rides);
  const custom = useApp((s) => s.workouts);
  const [workoutId, setWorkoutId] = useState('');
  const stats = route ? routeStats(route.track) : null;
  const best = useMemo(
    () =>
      rides
        .filter((r) => r.routeId === id && route && r.distanceM >= route.track.length - 5)
        .sort((a, b) => a.durationSec - b.durationSec)[0],
    [rides, id, route],
  );
  const kms = useMemo(() => {
    if (!route) return [];
    const out: { from: number; to: number; grade: number; alt: number }[] = [];
    const L = route.track.length;
    for (let d = 0; d < L - 50; d += 1000) {
      const a = route.track.poseAt(d);
      const b = route.track.poseAt(Math.min(L, d + 1000));
      out.push({ from: d, to: b.distance, grade: (b.altitude - a.altitude) / (b.distance - a.distance || 1), alt: b.altitude });
    }
    return out;
  }, [route]);

  if (!meta) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-10">
        <p>Salita non trovata.</p>
        <Link to="/salite" className="inline-flex h-11 items-center font-semibold text-accent">Torna alle salite</Link>
      </main>
    );
  }
  const start = route?.track.points[0];
  const startGeo = route && start ? projector(route.origin).toGeo(start.x, start.z) : null;
  const endP = route?.track.points[route.track.points.length - 1];
  const endGeo = route && endP ? projector(route.origin).toGeo(endP.x, endP.z) : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-nav-cta pt-3 md:px-8 md:pt-8" data-testid="climb-detail">
      <PageHeader back={{ to: '/salite', label: 'Salite' }} eyebrow={meta.region} title={meta.name} sub={cap(meta.side)} size="lg" />

      {stats ? (
        <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="climb-stats">
          <Big label="Lunghezza" value={formatKm(stats.lengthM)} unit="km" />
          <Big label="Dislivello" value={formatAlt(stats.endAlt - stats.startAlt)} unit="m" />
          <Big label="Media" value={formatNumber(stats.avgGrade * 100, 1)} unit="%" />
          <Big label="Km duro" value={formatNumber(stats.maxKmGrade * 100, 1)} unit="%" />
          <Big label="Quota" value={formatAlt(stats.endAlt)} unit="m" note={`Da ${formatAltText(stats.startAlt)}`} />
          <Big label="Tornanti" value={String(stats.hairpins)} unit="" />
        </dl>
      ) : (
        <p className="mt-4 text-muted">{error ?? 'Carico la traccia…'}</p>
      )}

      {/* il tasto per cui si apre la pagina: fisso sopra la barra, sempre nel primo schermo */}
      <div className="cta-bar border-t border-line bg-bg/92 backdrop-blur-xl" data-testid="climb-cta">
        <div className="mx-auto flex w-full max-w-4xl gap-2 px-4 py-2.5 md:px-8">
          <Button className="flex-1" data-testid="climb-ride" onClick={() => navigate(`/ride?route=${id}`)}>
            Pedala
          </Button>
          {best ? (
            <Button variant="ghost" className="shrink-0" onClick={() => navigate(`/ride?route=${id}&ghost=${best.id}`)} data-testid="climb-ghost">
              Fantasma · {formatDuration(best.durationSec)}
            </Button>
          ) : null}
        </div>
      </div>

      {route ? (
        <>
          <section className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr]">
            <div className="rounded-2xl border border-line bg-elev p-3">
              <RouteMap track={route.track} className="aspect-square w-full" />
              <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" data-testid="climb-legend">
                <li>Nord in alto</li>
                <li className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-ink bg-bg" aria-hidden="true" />
                  Partenza
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-accent" aria-hidden="true" />
                  Arrivo
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                  Tornanti
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-line bg-elev p-3">
                <ProfileChart track={route.track} className="block h-40 w-full" height={160} bin={250} />
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  {GRADE_LEGEND.map((g) => (
                    <li key={g.label} className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} />
                      {g.label}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-line bg-elev p-4">
                <p className="eyebrow">In ERG</p>
                <div className="mt-2 flex gap-2">
                  <select
                    aria-label="Allenamento ERG"
                    className="h-12 min-w-0 flex-1 rounded-full border border-line bg-elev2 px-4 text-sm"
                    value={workoutId}
                    onChange={(e) => setWorkoutId(e.target.value)}
                  >
                    <option value="">Scegli l’allenamento</option>
                    {[...ALL_BUILTIN, ...custom].map((w) => (
                      <option key={w.id} value={w.id}>
                        {workoutTitle(w, t)}
                      </option>
                    ))}
                  </select>
                  <Button variant="soft" disabled={!workoutId} onClick={() => navigate(`/ride?route=${id}&workout=${workoutId}`)}>
                    Parti
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-line bg-elev p-4" data-testid="climb-board">
            <BoardPanel id={`salita:${id}`} title="Classifica della salita" />
            {route.track.length > 6500 ? (
              <div className="mt-4 border-t border-line pt-3">
                <BoardPanel id={`salita:${id}:fine`} title="Gli ultimi 3 km" limit={5} />
              </div>
            ) : null}
          </section>

          <section className="mt-6">
            <h2 className="font-display text-2xl uppercase">Chilometro per chilometro</h2>
            <ol className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {kms.map((k, i) => (
                <li key={i} className="flex items-center justify-between rounded-xl bg-elev px-3 py-2">
                  <span className="text-sm text-muted">{`Km ${i + 1}`}</span>
                  <span className="num font-semibold" style={{ color: gradeColor(k.grade) }}>
                    {formatNumber(k.grade * 100, 1)}%
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <details className="group mt-6 rounded-2xl border border-line text-sm text-muted" data-testid="climb-sources">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-semibold text-ink">
              Fonti
              <Chevron className="shrink-0 text-muted transition group-open:rotate-180" />
            </summary>
            <div className="space-y-2 px-4 pb-4 leading-relaxed">
              <p>
                {`Strada: OpenStreetMap, con OSRM. Quota: EU-DEM 25 m (Copernicus) via OpenTopoData, entro ±${formatAltText(Math.ceil(route.track.maxElevationDelta))}; pendenza mediata su 40 m.`}
              </p>
              <p>Tornanti: curve oltre 150° in 70 m.</p>
              <p>{route.attribution}</p>
              {startGeo && endGeo ? (
                <p className="flex flex-wrap gap-x-4">
                  <a className="inline-flex h-11 items-center font-semibold text-accent" href={streetViewUrl(startGeo)} target="_blank" rel="noreferrer">
                    Street View alla partenza ↗
                  </a>
                  <a className="inline-flex h-11 items-center font-semibold text-accent" href={streetViewUrl(endGeo)} target="_blank" rel="noreferrer">
                    Street View all’arrivo ↗
                  </a>
                  <a className="inline-flex h-11 items-center font-semibold text-accent" href={osmUrl(startGeo, 13)} target="_blank" rel="noreferrer">
                    Mappa OSM ↗
                  </a>
                </p>
              ) : null}
            </div>
          </details>
        </>
      ) : null}
    </main>
  );
}

function Big({ label, value, unit, note }: { label: string; value: string; unit: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-elev px-3 py-2">
      <dt className="eyebrow whitespace-nowrap">{label}</dt>
      <dd className="num font-display text-3xl leading-tight">
        {value}
        {unit ? <span className="ml-1 text-base text-muted">{unit}</span> : null}
      </dd>
      {note ? <dd className="num -mt-0.5 text-xs text-muted">{note}</dd> : null}
    </div>
  );
}
