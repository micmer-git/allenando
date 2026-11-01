import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LineChart, ZoneBar } from '@/components/Charts';
import { Button } from '@/components/ui';
import { formatDateTime, formatDuration, formatKm, formatNumber, msToKmh } from '@/domain/format';
import { HR_ZONES, POWER_ZONES } from '@/domain/zones';
import { encodeActivityFit } from '@/io/fit';
import { encodeTcx } from '@/io/tcx';
import { useI18n } from '@/i18n';
import { downloadBytes, downloadText, safeFileName } from '@/lib/download';
import { useApp } from '@/store/useApp';

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
        <Link to="/history" className="mt-4 inline-block font-semibold text-accent">{t('actions.back')}</Link>
      </main>
    );
  }
  const powers = ride.samples.map((sample) => sample.power);
  const hrs = ride.samples.map((sample) => sample.hr);
  const alts = ride.samples.map((sample) => sample.altitude);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10" data-testid="ride-detail">
      <Link to="/history" className="text-sm font-semibold text-muted">{t('actions.back')}</Link>
      <p className="mt-4 text-sm uppercase tracking-wide text-muted">{formatDateTime(ride.startTime)}</p>
      <h1 className="font-display text-4xl leading-tight">{ride.name}</h1>
      <p className="mt-2 text-sm text-muted">
        {ride.source === 'indoor' ? t('history.sourceIndoor') : t('history.sourceImport')}
        {ride.withCamilla ? ` · ${t('history.withCamilla')}` : ''}
        {ride.tssSource === 'power' ? ` · ${t('history.tssPower')}` : ''}
        {ride.tssSource === 'hr' ? ` · ${t('history.tssHr')}` : ''}
        {ride.tssSource === 'file' ? ` · ${t('history.tssFile')}` : ''}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={t('metrics.time')} value={formatDuration(ride.durationSec)} />
        <Metric label={t('metrics.distance')} value={`${formatKm(ride.distanceM)} km`} />
        <Metric label={t('metrics.avgPower')} value={ride.avgPower != null ? `${formatNumber(ride.avgPower, 0)} W` : '–'} />
        <Metric label={t('metrics.npLong')} value={ride.np != null ? `${formatNumber(ride.np, 0)} W` : '–'} />
        <Metric label={t('metrics.ifLong')} value={ride.intensityFactor != null ? formatNumber(ride.intensityFactor, 2) : '–'} />
        <Metric label={t('metrics.tss')} value={ride.tss != null ? formatNumber(ride.tss, 0) : '–'} />
        <Metric label={t('metrics.hr')} value={ride.avgHr != null ? `${ride.avgHr} ${t('units.bpm')}` : '–'} />
        <Metric label={t('metrics.speed')} value={`${formatNumber(msToKmh(ride.avgSpeed ?? 0), 1)} ${t('units.kmh')}`} />
      </dl>
      <section className="mt-6">
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
      {powers.some((value) => value > 0) ? (
        <section className="mt-5 h-28">
          <h2 className="mb-1 text-sm text-muted">{t('history.chartPower')}</h2>
          <LineChart values={downsample(powers)} color="#f0943a" />
        </section>
      ) : null}
      {hrs.some((value) => value > 0) ? (
        <section className="mt-4 h-24">
          <h2 className="mb-1 text-sm text-muted">{t('history.chartHr')}</h2>
          <LineChart values={downsample(hrs)} color="#ff6d8a" />
        </section>
      ) : null}
      {alts.length > 2 ? (
        <section className="mt-4 h-20">
          <h2 className="mb-1 text-sm text-muted">{t('history.chartAlt')}</h2>
          <LineChart values={downsample(alts)} color="#7eb6ff" />
        </section>
      ) : null}
      <p className="mt-4 text-xs text-muted">{t('history.hrZones')}</p>
      <ZoneBar seconds={ride.hrZoneSec} zones={HR_ZONES} />
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          onClick={() => downloadBytes(safeFileName(ride.name, 'fit'), encodeActivityFit(ride), 'application/octet-stream')}
        >
          {t('history.exportFit')}
        </Button>
        <Button variant="ghost" onClick={() => downloadText(safeFileName(ride.name, 'tcx'), encodeTcx(ride), 'application/vnd.garmin.tcx+xml')}>
          {t('history.exportTcx')}
        </Button>
        <Button
          variant="danger"
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-elev p-3">
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
