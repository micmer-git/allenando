import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProfileChart, RouteMap } from '@/components/RouteViz';
import { Button, PageHeader, Segmented, TextInput } from '@/components/ui';
import { formatAltText, formatDuration, formatKm, formatKmText, formatNumber } from '@/domain/format';
import { geoPointsFromSamples, hasAltitude, hasGps, hasPower, sectionSummary, sliceSection, type ReplayMode, type SectionSpec } from '@/domain/replay';
import { trackFromGeo } from '@/domain/routes';
import { useApp } from '@/store/useApp';

type Kind = SectionSpec['kind'];

/** "12:30" o "750" → secondi. */
function parseClock(v: string): number {
  const parts = v.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function encodeSection(spec: SectionSpec): string {
  return JSON.stringify(spec);
}

export function decodeSection(raw: string | null): SectionSpec {
  try {
    const v = raw ? (JSON.parse(raw) as SectionSpec) : null;
    if (v && ['full', 'time', 'distance', 'lap'].includes(v.kind)) return v;
  } catch {
    /* sezione illeggibile: giro intero */
  }
  return { kind: 'full' };
}

export function ReplaySetupPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const ride = useApp((s) => s.rides.find((r) => r.id === id));
  const [kind, setKind] = useState<Kind>('full');
  const [from, setFrom] = useState('0:00');
  const [to, setTo] = useState('');
  const [fromKm, setFromKm] = useState('0');
  const [toKm, setToKm] = useState('');
  const [lap, setLap] = useState(0);
  const [mode, setMode] = useState<ReplayMode>('grade');

  const spec: SectionSpec = useMemo(() => {
    if (kind === 'time') return { kind, fromSec: parseClock(from) || 0, toSec: parseClock(to) || Number.MAX_SAFE_INTEGER };
    if (kind === 'distance') return { kind, fromM: (Number(fromKm.replace(',', '.')) || 0) * 1000, toM: (Number(toKm.replace(',', '.')) || 1e9) * 1000 };
    if (kind === 'lap') return { kind, index: lap };
    return { kind: 'full' };
  }, [kind, from, to, fromKm, toKm, lap]);

  const slice = useMemo(() => (ride ? sliceSection(ride, spec) : []), [ride, spec]);
  const summary = useMemo(() => (slice.length > 1 ? sectionSummary(slice) : null), [slice]);
  const gps = slice.length > 1 && hasGps(slice);
  const power = slice.length > 1 && hasPower(slice);
  const alt = slice.length > 1 && hasAltitude(slice);
  const preview = useMemo(() => {
    if (!gps) return null;
    try {
      return trackFromGeo('preview', ride?.name ?? '', geoPointsFromSamples(slice));
    } catch {
      return null;
    }
  }, [gps, slice, ride?.name]);

  if (!ride) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-10">
        <p>Giro non trovato.</p>
        <Link to="/giri" className="inline-flex h-11 items-center font-semibold text-accent">Torna ai giri</Link>
      </main>
    );
  }

  const laps = ride.laps ?? [];
  const canStart = slice.length > 10 && (mode !== 'power' || power) && (mode !== 'grade' || gps || alt);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="replay-setup">
      <PageHeader back={{ to: '/giri', label: 'Giri' }} title={ride.name} size="md" />
      <p className="num mt-1 text-muted">
        {`${formatKmText(ride.distanceM)} · ${formatDuration(ride.durationSec)}${ride.externalId?.startsWith('intervals:') ? ' · Da Intervals.icu' : ride.fileType ? ` · ${ride.fileType.toUpperCase()}` : ''}`}
      </p>

      <section className="mt-5">
        <p className="eyebrow mb-2">Quale pezzo</p>
        <Segmented<Kind>
          label="Sezione"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'full', label: 'Tutto' },
            { value: 'time', label: 'Tempo' },
            { value: 'distance', label: 'Km' },
            ...(laps.length > 1 ? [{ value: 'lap' as Kind, label: 'Giri' }] : []),
          ]}
        />
        {kind === 'time' ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <TextInput aria-label="Dal minuto" placeholder="0:00" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextInput aria-label="Al minuto" placeholder={formatDuration(ride.durationSec)} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        ) : null}
        {kind === 'distance' ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <TextInput aria-label="Dal km" inputMode="decimal" value={fromKm} onChange={(e) => setFromKm(e.target.value)} />
            <TextInput aria-label="Al km" inputMode="decimal" placeholder={formatKm(ride.distanceM)} value={toKm} onChange={(e) => setToKm(e.target.value)} />
          </div>
        ) : null}
        {kind === 'lap' ? (
          <ul className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {laps.map((l, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setLap(i)}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm ${lap === i ? 'bg-accent text-accent-ink' : 'bg-elev'}`}
                >
                  <span className="block font-semibold">{l.name || `Giro ${i + 1}`}</span>
                  <span className="opacity-75">{formatDuration(l.endSec - l.startSec)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-elev p-4">
        {summary ? (
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Cell label="Tempo" value={formatDuration(summary.durationSec)} />
            <Cell label="km" value={formatKm(summary.distanceM)} />
            <Cell label="D+" value={formatAltText(summary.gainM)} />
            <Cell label="Watt" value={summary.avgPower != null ? formatNumber(summary.avgPower, 0) : '–'} />
          </dl>
        ) : (
          <p className="text-sm text-warn">Il pezzo scelto è vuoto.</p>
        )}
        {preview ? (
          <div className="mt-3 grid grid-cols-[6rem_1fr] items-center gap-3">
            <RouteMap track={preview.track} className="h-24 w-24" />
            <ProfileChart track={preview.track} className="block h-20 w-full" height={80} bin={Math.max(100, preview.track.length / 60)} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">{alt ? 'Senza GPS: si pedala su una strada neutra con la pendenza del file.' : 'Senza GPS né quota: si pedala su una strada neutra in piano.'}</p>
        )}
      </section>

      <section className="mt-4">
        <p className="eyebrow mb-2">Come rifarlo</p>
        <div className="flex flex-col gap-2">
          <ModeCard on={mode === 'power'} disabled={!power} onClick={() => setMode('power')} title="I watt di allora" text={power ? 'Il rullo in ERG con i watt di allora, secondo per secondo. La pendenza non viene inviata.' : 'Questo giro non ha potenza.'} />
          <ModeCard on={mode === 'grade'} disabled={!gps && !alt} onClick={() => setMode('grade')} title="La pendenza di allora" text={gps || alt ? 'Il rullo riceve la pendenza della strada (simulazione). I watt li metti tu.' : 'Servono GPS o quota.'} />
          <ModeCard on={mode === 'ghost'} onClick={() => setMode('ghost')} title="Fantasma" text="Pendenza al rullo, e accanto a te il giro di allora alla sua velocità. Vedi il distacco in secondi." />
        </div>
      </section>

      <Button
        className="mt-5 w-full"
        data-testid="replay-start"
        disabled={!canStart}
        onClick={() => navigate(`/ride?replay=${encodeURIComponent(ride.id)}&mode=${mode}&sec=${encodeURIComponent(encodeSection(spec))}`)}
      >
        Pedala
      </Button>
    </main>
  );
}

function ModeCard({ on, disabled, onClick, title, text }: { on: boolean; disabled?: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-2xl border p-3 text-left transition disabled:opacity-45 ${on ? 'border-accent bg-accent/10' : 'border-line bg-elev'}`}
    >
      <span className="block font-display text-xl uppercase">{title}</span>
      <span className="text-sm text-muted">{text}</span>
    </button>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="num font-display text-2xl">{value}</dd>
    </div>
  );
}
