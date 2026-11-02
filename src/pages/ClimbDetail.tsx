import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GRADE_LEGEND, gradeColor, ProfileChart, RouteMap, useVerifiedRoute } from '@/components/RouteViz';
import { Button } from '@/components/ui';
import { formatDuration, formatKm, formatNumber } from '@/domain/format';
import { projector } from '@/domain/geo';
import { osmUrl, routeMeta, routeStats, streetViewUrl } from '@/domain/routes';
import { BUILTIN_WORKOUTS } from '@/domain/workouts';
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
        <Link to="/salite" className="text-accent">Torna alle salite</Link>
      </main>
    );
  }
  const start = route?.track.points[0];
  const startGeo = route && start ? projector(route.origin).toGeo(start.x, start.z) : null;
  const endP = route?.track.points[route.track.points.length - 1];
  const endGeo = route && endP ? projector(route.origin).toGeo(endP.x, endP.z) : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="climb-detail">
      <Link to="/salite" className="text-sm font-semibold text-muted">← Salite</Link>
      <p className="eyebrow mt-4">{meta.region}</p>
      <h1 className="font-display text-6xl uppercase leading-[0.9]">{meta.name}</h1>
      <p className="text-lg text-muted">{meta.side}</p>

      {stats ? (
        <dl className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Big label="Lunghezza" value={formatKm(stats.lengthM)} unit="km" />
          <Big label="Dislivello" value={formatNumber(stats.endAlt - stats.startAlt, 0)} unit="m" />
          <Big label="Media" value={formatNumber(stats.avgGrade * 100, 1)} unit="%" />
          <Big label="Km più duro" value={formatNumber(stats.maxKmGrade * 100, 1)} unit="%" />
          <Big label="Quota" value={`${formatNumber(stats.startAlt, 0)}→${formatNumber(stats.endAlt, 0)}`} unit="m" />
          <Big label="Tornanti" value={String(stats.hairpins)} unit="" />
        </dl>
      ) : (
        <p className="mt-5 text-muted">{error ?? 'Carico la traccia…'}</p>
      )}

      {route ? (
        <>
          <section className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr]">
            <div className="rounded-2xl border border-line bg-elev p-3">
              <RouteMap track={route.track} className="aspect-square w-full" />
              <p className="mt-2 text-xs text-muted">Nord in alto · ● partenza · ■ arrivo · punti verdi: tornanti trovati nella geometria</p>
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
                <p className="eyebrow">Pedala</p>
                <div className="mt-3 flex flex-col gap-2">
                  <Button data-testid="climb-ride" onClick={() => navigate(`/ride?route=${id}`)}>
                    Pedala · pendenza al rullo
                  </Button>
                  <div className="flex gap-2">
                    <select
                      aria-label="Allenamento ERG"
                      className="h-12 min-w-0 flex-1 rounded-full border border-line bg-elev2 px-4 text-sm"
                      value={workoutId}
                      onChange={(e) => setWorkoutId(e.target.value)}
                    >
                      <option value="">Allenamento ERG…</option>
                      {[...BUILTIN_WORKOUTS, ...custom].map((w) => (
                        <option key={w.id} value={w.id}>
                          {workoutTitle(w, t)}
                        </option>
                      ))}
                    </select>
                    <Button variant="soft" disabled={!workoutId} onClick={() => navigate(`/ride?route=${id}&workout=${workoutId}`)}>
                      ERG
                    </Button>
                  </div>
                  {best ? (
                    <Button variant="ghost" onClick={() => navigate(`/ride?route=${id}&ghost=${best.id}`)}>
                      Contro il fantasma · {formatDuration(best.durationSec)}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted">Al primo arrivo in cima il tuo tempo diventa un fantasma da battere.</p>
                  )}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  In pedalata libera il rullo riceve la pendenza (simulazione FTMS). In ERG riceve solo i watt: le due cose non vanno mai insieme.
                </p>
              </div>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="font-display text-2xl uppercase">Chilometro per chilometro</h2>
            <ol className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {kms.map((k, i) => (
                <li key={i} className="flex items-center justify-between rounded-xl bg-elev px-3 py-2">
                  <span className="text-sm text-muted">km {i + 1}</span>
                  <span className="num font-semibold" style={{ color: gradeColor(k.grade) }}>
                    {formatNumber(k.grade * 100, 1)}%
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-6 rounded-2xl border border-line p-4 text-sm leading-relaxed text-muted">
            <h2 className="font-semibold text-ink">Da dove vengono i dati</h2>
            <p className="mt-1">
              Strada: OpenStreetMap, percorso calcolato con OSRM tra il centro di partenza e il punto d’arrivo. Quota: EU-DEM 25 m (Copernicus) via OpenTopoData,
              livellata entro ±{formatNumber(Math.ceil(route.track.maxElevationDelta), 0)} m dalla sorgente; la pendenza è mediata su circa 40 m. È una ricostruzione da dati aperti, non un rilievo:
              precisione di qualche metro, non di centimetri. I tornanti sono quelli che la geometria mostra (curve oltre 150° in 70 m), non il conteggio dei cartelli.
            </p>
            <p className="mt-2">{route.attribution}</p>
            {startGeo && endGeo ? (
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <a className="font-semibold text-accent" href={streetViewUrl(startGeo)} target="_blank" rel="noreferrer">
                  Street View alla partenza ↗
                </a>
                <a className="font-semibold text-accent" href={streetViewUrl(endGeo)} target="_blank" rel="noreferrer">
                  Street View all’arrivo ↗
                </a>
                <a className="font-semibold text-accent" href={osmUrl(startGeo, 13)} target="_blank" rel="noreferrer">
                  Mappa OSM ↗
                </a>
              </p>
            ) : null}
            <p className="mt-1 text-xs">Street View si apre su Google Maps come riferimento visivo: dalle sue immagini l’app non ricava niente.</p>
          </section>
        </>
      ) : null}
    </main>
  );
}

function Big({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl border border-line bg-elev px-3 py-2">
      <dt className="eyebrow">{label}</dt>
      <dd className="num font-display text-3xl leading-tight">
        {value}
        {unit ? <span className="ml-1 text-base text-muted">{unit}</span> : null}
      </dd>
    </div>
  );
}
