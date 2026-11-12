import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LineChart, ZoneBar } from '@/components/Charts';
import { Button, PageHeader } from '@/components/ui';
import { esportabile } from '@/domain/types';
import { CartolinaButton } from '@/components/ShareCard';
import { WorldMap, type MapMarker, type MapOverlay } from '@/components/WorldMap';
import { loadWorld, Terrain, WORLD_KV, type WorldData } from '@/open/world';
import { loadKv } from '@/db/db';
import type { Ride } from '@/domain/types';
import { cap, formatDateTime, formatDuration, formatKmText, formatNumber, formatTss, msToKmh } from '@/domain/format';
import { HR_ZONES, POWER_ZONES } from '@/domain/zones';
import { encodeActivityFit } from '@/io/fit';
import { encodeTcx } from '@/io/tcx';
import { encodeGpx } from '@/io/gpx-export';
import { validPosition } from '@/domain/metrics';
import { useI18n } from '@/i18n';
import { downloadBytes, downloadText, safeFileName } from '@/lib/download';
import { useApp } from '@/store/useApp';
import { worldOfRide } from '@/open/worlds';

export function RideDetailPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const ride = useApp((s) => s.rides.find((item) => item.id === id));
  const deleteRide = useApp((s) => s.deleteRide);
  const [armed, setArmed] = useState(false);
  if (!ride) {
    return (
      <main className="px-4 pt-10">
        <p className="text-muted">{t('history.empty')}</p>
        <Link to="/history" className="mt-4 inline-flex h-11 items-center font-semibold text-accent">{t('actions.back')}</Link>
      </main>
    );
  }
  const powers = ride.samples.map((sample) => sample.power);
  const hrs = ride.samples.map((sample) => sample.hr);
  const alts = ride.samples.map((sample) => sample.altitude);
  const gps = ride.samples.some((s) => validPosition(s.lat, s.lon));
  // un giro di prova non si esporta: Strava avrebbe un giro finto (A11)
  const prova = !esportabile(ride);
  const rifai = ride.samples.length > 10 && ride.distanceM > 200;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="ride-detail">
      <PageHeader
        back={{ to: '/history', label: t('history.title') }}
        eyebrow={cap(formatDateTime(ride.startTime))}
        title={ride.name}
        size="md"
        aside={prova ? <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold" data-testid="ride-detail-prova">{ride.manuale ? 'Watt virtuali' : 'Prova'}</span> : undefined}
      />
      <p className="mt-2 text-sm text-muted">
        {`${ride.manuale ? 'Pedalata virtuale' : ride.source === 'indoor' ? t('history.sourceIndoor') : t('history.sourceImport')}${
          ride.tssSource === 'power' ? ` · ${t('history.tssPower')}` : ride.tssSource === 'hr' ? ` · ${t('history.tssHr')}` : ride.tssSource === 'file' ? ` · ${t('history.tssFile')}` : ''
        }`}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={t('metrics.time')} value={formatDuration(ride.durationSec)} />
        <Metric label={t('metrics.distance')} value={`${formatKmText(ride.distanceM)}`} />
        <Metric label={t('metrics.avgPower')} value={ride.avgPower != null ? `${formatNumber(ride.avgPower, 0)}\u00a0W` : '–'} />
        <Metric label={t('metrics.npLong')} value={ride.np != null ? `${formatNumber(ride.np, 0)}\u00a0W` : '–'} />
        <Metric label={t('metrics.ifLong')} value={ride.intensityFactor != null ? formatNumber(ride.intensityFactor, 2) : '–'} />
        <Metric label={t('metrics.tss')} value={formatTss(ride.tss)} testId="ride-detail-tss" />
        <Metric label={t('metrics.hr')} value={ride.avgHr != null ? `${ride.avgHr} ${t('units.bpm')}` : '–'} />
        <Metric label={t('metrics.speed')} value={`${formatNumber(msToKmh(ride.avgSpeed ?? 0), 1)} ${t('units.kmh')}`} />
      </dl>
      {rifai ? (
        <Link to={`/?dove=giro&replay=${encodeURIComponent(ride.id)}`} className="mt-5 flex h-14 items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-accent-ink" data-testid="ride-detail-rifai">
          Rifai
        </Link>
      ) : null}
      {gps ? <RideTrackMap ride={ride} /> : null}
      <section className="mt-6" data-testid="chart-zones">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('history.zones')}</h2>
        <ZoneBar seconds={ride.powerZoneSec} zones={POWER_ZONES} />
        <ul className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
          {POWER_ZONES.map((zone) => (
            <li key={zone.zone} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: zone.color }} />
              {t(zone.nameKey)}
            </li>
          ))}
        </ul>
      </section>
      {/* ogni grafico nella sua scatola: il titolo sopra, il disegno alto quanto la scatola, poi spazio */}
      {powers.some((value) => value > 0) ? (
        <section className="mt-6" data-testid="chart-power">
          <h2 className="mb-1.5 text-sm text-muted">{t('history.chartPower')}</h2>
          <div className="h-24">
            <LineChart values={downsample(powers)} color="#f0943a" />
          </div>
        </section>
      ) : null}
      {hrs.some((value) => value > 0) ? (
        <section className="mt-6" data-testid="chart-hr">
          <h2 className="mb-1.5 text-sm text-muted">{t('history.chartHr')}</h2>
          <div className="h-20">
            <LineChart values={downsample(hrs)} color="#ff6d8a" />
          </div>
        </section>
      ) : null}
      {alts.length > 2 ? (
        <section className="mt-6" data-testid="chart-alt">
          <h2 className="mb-1.5 text-sm text-muted">{t('history.chartAlt')}</h2>
          <div className="h-20">
            <LineChart values={downsample(alts)} color="#7eb6ff" />
          </div>
        </section>
      ) : null}
      {ride.hrZoneSec.some((v) => v > 0) ? (
        <section className="mt-6" data-testid="chart-hrzones">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('history.hrZones')}</h2>
          <ZoneBar seconds={ride.hrZoneSec} zones={HR_ZONES} />
        </section>
      ) : null}
      <div className={prova ? 'hidden' : 'mt-8 flex flex-wrap gap-2'} data-testid="ride-detail-export">
        <Button
          variant="ghost"
          onClick={() => downloadBytes(safeFileName(ride.name, 'fit'), encodeActivityFit(ride), 'application/octet-stream')}
        >
          {t('history.exportFit')}
        </Button>
        <Button variant="ghost" onClick={() => downloadText(safeFileName(ride.name, 'tcx'), encodeTcx(ride), 'application/vnd.garmin.tcx+xml')}>
          {t('history.exportTcx')}
        </Button>
        {gps ? (
          <Button
            variant="ghost"
            onClick={() => {
              const gpx = encodeGpx(ride);
              if (gpx) downloadText(safeFileName(ride.name, 'gpx'), gpx, 'application/gpx+xml');
            }}
          >
            {t('history.exportGpx')}
          </Button>
        ) : null}
        <CartolinaButton ride={ride} />
      </div>
      {ride.source === 'indoor' && !prova ? <p className="mt-2 text-xs text-muted">{gps ? t('history.gpsYes') : t('history.gpsNo')}</p> : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant={armed ? 'danger' : 'ghost'}
          className={armed ? '' : 'text-danger!'}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            void deleteRide(ride.id).then(() => navigate('/history'));
          }}
        >
          {armed ? t('history.deleteConfirm') : t('actions.delete')}
        </Button>
      </div>
    </main>
  );
}

/**
 * La traccia del giro sulla carta. Se il giro è a Bergamo e nelle valli, sulla carta del mondo
 * (rilievo, strade, paesi); altrove, la sola linea con partenza e arrivo.
 */
function RideTrackMap({ ride }: { ride: Ride }) {
  const pts = useMemo(() => {
    const all = ride.samples.filter((s) => validPosition(s.lat, s.lon)).map((s) => ({ lat: s.lat as number, lon: s.lon as number }));
    const step = Math.max(1, Math.floor(all.length / 1500));
    const out = all.filter((_, i) => i % step === 0);
    if (all.length && out[out.length - 1] !== all[all.length - 1]) out.push(all[all.length - 1]);
    return out;
  }, [ride]);
  const [world, setWorld] = useState<WorldData | null | 'fuori'>(null);
  const [far, setFar] = useState<Float32Array | null>(null);
  useEffect(() => {
    if (pts.length < 2) return;
    let alive = true;
    // il mondo del giro: il campo, il prefisso del percorso o il GPS; sennò l'ultimo scelto
    void (async () => loadWorld(worldOfRide(ride) ?? (await loadKv<string>(WORLD_KV))))()
      .then((d) => {
        if (!alive) return;
        setWorld(d);
        void new Terrain(d.graph).loadFar().then((h) => alive && setFar(h));
      })
      .catch(() => alive && setWorld('fuori'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts.length, ride.id]);
  const local = useMemo(() => {
    if (!world || world === 'fuori') return null;
    const b = world.graph.bounds;
    const xs: number[] = [];
    const zs: number[] = [];
    let inside = 0;
    for (const p of pts) {
      const q = world.proj.toLocal(p);
      xs.push(q.x);
      zs.push(q.z);
      if (q.x > b.x0 && q.x < b.x1 && q.z > b.z0 && q.z < b.z1) inside += 1;
    }
    return inside >= pts.length * 0.8 ? { xs, zs } : null;
  }, [world, pts]);
  const overlays = useMemo<MapOverlay[]>(() => (local ? [{ legs: [], path: local, color: '#ffc814', width: 4 }] : []), [local]);
  const markers = useMemo<MapMarker[]>(
    () =>
      local
        ? [
            { x: local.xs[0], z: local.zs[0], color: '#ffc814', label: 'Partenza', ring: true },
            // l'arrivo col suo nome solo se non cade sopra la partenza (un anello, un giro corto)
            ...(Math.hypot(local.xs[local.xs.length - 1] - local.xs[0], local.zs[local.zs.length - 1] - local.zs[0]) > 250
              ? [{ x: local.xs[local.xs.length - 1], z: local.zs[local.zs.length - 1], color: '#16130a', label: 'Arrivo' }]
              : []),
          ]
        : [],
    [local],
  );
  const focus = useMemo(() => {
    if (!local) return null;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < local.xs.length; i++) {
      x0 = Math.min(x0, local.xs[i]);
      x1 = Math.max(x1, local.xs[i]);
      z0 = Math.min(z0, local.zs[i]);
      z1 = Math.max(z1, local.zs[i]);
    }
    const pad = Math.max(300, (x1 - x0 + z1 - z0) * 0.08);
    return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
  }, [local]);
  if (pts.length < 2) return null;
  return (
    <section className="mt-6" data-testid="ride-map" data-map={local ? 'mondo' : world ? 'traccia' : 'carico'}>
      {world && world !== 'fuori' && local ? (
        <WorldMap data={world} far={far} overlays={overlays} markers={markers} focus={focus} height={300} />
      ) : world ? (
        <TrackSvg pts={pts} />
      ) : (
        <div className="h-[300px] rounded-2xl bg-elev" aria-hidden="true" />
      )}
    </section>
  );
}

/** Fuori dal mondo di Bergamo: la sola traccia, nord in alto. */
function TrackSvg({ pts }: { pts: { lat: number; lon: number }[] }) {
  const { d, vb, a, b, w } = useMemo(() => {
    const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xy = pts.map((p) => ({ x: p.lon * k * 111_320, y: -p.lat * 111_320 }));
    const xs = xy.map((p) => p.x);
    const ys = xy.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const size = Math.max(maxX - minX, maxY - minY, 50);
    const pad = size * 0.08;
    return {
      d: xy.map((p, i) => `${i ? 'L' : 'M'}${(p.x - minX).toFixed(1)} ${(p.y - minY).toFixed(1)}`).join(''),
      vb: `${-pad} ${-pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
      a: { x: xy[0].x - minX, y: xy[0].y - minY },
      b: { x: xy[xy.length - 1].x - minX, y: xy[xy.length - 1].y - minY },
      w: size / 110,
    };
  }, [pts]);
  return (
    <svg viewBox={vb} className="h-[300px] w-full rounded-2xl bg-elev" role="img" aria-label="Traccia del giro">
      <path d={d} fill="none" stroke="var(--line)" strokeWidth={w * 3.2} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={w * 1.3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={a.x} cy={a.y} r={w * 2.4} fill="var(--bg)" stroke="var(--ink)" strokeWidth={w} />
      <rect x={b.x - w * 2.2} y={b.y - w * 2.2} width={w * 4.4} height={w * 4.4} fill="var(--ink)" />
    </svg>
  );
}

function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-2xl bg-elev p-3" data-testid={testId}>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="num mt-1 font-display text-2xl">{value}</dd>
    </div>
  );
}

function downsample(values: number[], max = 240): number[] {
  if (values.length <= max) return values;
  const step = values.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(values[Math.floor(i * step)] ?? 0);
  return out;
}
