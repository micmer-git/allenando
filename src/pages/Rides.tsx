import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, PageHeader, TextInput } from '@/components/ui';
import { cap, formatDateTime, formatDuration, formatGainText, formatKmText } from '@/domain/format';
import { hasAltitude, hasGps, hasPower } from '@/domain/replay';
import type { Ride } from '@/domain/types';
import { estimateLthr } from '@/domain/zones';
import { fileActivitySource } from '@/io/sources';
import {
  fetchActivityLaps,
  fetchActivityStreams,
  IntervalsError,
  listActivities,
  rideFromIntervals,
  type IntervalsActivity,
} from '@/io/intervals';
import { useApp } from '@/store/useApp';

const DAY = 86400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function RidesPage() {
  const rides = useApp((s) => s.rides);
  const replayable = rides.filter((r) => r.samples.length > 30);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10" data-testid="rides-page">
      <PageHeader back={{ to: '/tu', label: 'Tu' }} title="Rifai un giro" />
      <p className="mt-2 max-w-xl text-muted">Un tuo giro vero, sul rullo: coi watt di allora, con la pendenza di allora, o contro te stesso.</p>
      <IntervalsImport />
      <FileImport />
      <section className="mt-8">
        <h2 className="font-display text-2xl uppercase">I tuoi giri</h2>
        {replayable.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-line p-4 text-muted">Nessun giro ancora. Importane uno qui sopra.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {replayable.map((r) => (
              <RideRow key={r.id} ride={r} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function RideRow({ ride }: { ride: Ride }) {
  const gps = hasGps(ride.samples);
  const power = hasPower(ride.samples);
  const alt = hasAltitude(ride.samples);
  return (
    <li>
      <Link to={`/giri/${ride.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-elev px-4 py-3" data-testid="replay-ride">
        <span className="min-w-0">
          <span className="block truncate font-semibold">{ride.name}</span>
          <span className="num text-sm text-muted">{`${cap(formatDateTime(ride.startTime))} · ${formatKmText(ride.distanceM)} · ${formatDuration(ride.durationSec)}`}</span>
          <span className="mt-1 flex gap-1.5">
            <Tag on={gps}>GPS</Tag>
            <Tag on={power}>Watt</Tag>
            <Tag on={alt}>Quota</Tag>
            {ride.laps && ride.laps.length > 1 ? <Tag on>{`${ride.laps.length} giri`}</Tag> : null}
          </span>
        </span>
        <span aria-hidden="true" className="text-xl text-muted">→</span>
      </Link>
    </li>
  );
}

function Tag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${on ? 'bg-accent/15 text-accent' : 'bg-elev2 text-muted line-through'}`}>
      {children}
    </span>
  );
}

/**
 * Intervals.icu con la chiave API personale. La chiave vive solo nello stato di questa
 * pagina: niente localStorage, niente IndexedDB, niente log. Si chiude la pagina, sparisce.
 */
function IntervalsImport() {
  const profile = useApp((s) => s.profile);
  const importRides = useApp((s) => s.importRides);
  const [apiKey, setApiKey] = useState('');
  const [athlete, setAthlete] = useState('0');
  const [oldest, setOldest] = useState(iso(new Date(Date.now() - 30 * DAY)));
  const [newest, setNewest] = useState(iso(new Date()));
  const [list, setList] = useState<IntervalsActivity[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const opts = { apiKey: apiKey.trim(), athleteId: athlete.trim() || '0' };

  function explain(err: unknown): string {
    if (err instanceof IntervalsError) {
      if (err.kind === 'auth') return 'Chiave non accettata da Intervals.icu (401/403). Controlla la chiave e l’id atleta.';
      return err.message;
    }
    return 'Intervals.icu non risponde. Puoi sempre importare il file FIT, TCX o GPX qui sotto.';
  }

  async function load() {
    setBusy('list');
    setMessage(null);
    try {
      const items = await listActivities(opts, oldest, newest);
      setList(items);
      if (items.length === 0) setMessage({ tone: 'ok', text: 'Nessuna attività in questo intervallo.' });
    } catch (err) {
      setList(null);
      setMessage({ tone: 'err', text: explain(err) });
    } finally {
      setBusy(null);
    }
  }

  async function take(a: IntervalsActivity) {
    setBusy(a.id);
    setMessage(null);
    try {
      const samples = await fetchActivityStreams(opts, a.id);
      const laps = await fetchActivityLaps(opts, a.id, samples).catch(() => []);
      const ride = rideFromIntervals(a, samples, laps, profile.ftp, estimateLthr(profile.maxHr, profile.thresholdHr));
      await importRides([ride]);
      setMessage({ tone: 'ok', text: `«${a.name}» importato. Lo trovi in «I tuoi giri».` });
    } catch (err) {
      setMessage({ tone: 'err', text: explain(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-line bg-elev p-4" data-testid="intervals">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl uppercase">Intervals.icu</h2>
        <span className="text-xs text-muted">{list ? `${list.length} attività` : 'Non collegato'}</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Chiave API da Intervals.icu → Settings → Developer. Resta solo in questa pagina, non viene salvata. Le attività arrivate da Strava non hanno dati
        via API: per quelle serve il file.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_7rem]">
        <TextInput
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Chiave API"
          aria-label="Chiave API Intervals.icu"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <TextInput aria-label="Id atleta (0 = tu)" placeholder="0" value={athlete} onChange={(e) => setAthlete(e.target.value)} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <TextInput type="date" aria-label="Dal" value={oldest} onChange={(e) => setOldest(e.target.value)} />
        <TextInput type="date" aria-label="Al" value={newest} onChange={(e) => setNewest(e.target.value)} />
      </div>
      <Button className="mt-3 w-full" disabled={!apiKey.trim() || busy != null} onClick={() => void load()}>
        {busy === 'list' ? 'Chiedo a Intervals.icu…' : 'Mostra le attività'}
      </Button>
      {message ? <p className={`mt-3 text-sm ${message.tone === 'err' ? 'text-danger' : 'text-good'}`}>{message.text}</p> : null}
      {list && list.length > 0 ? (
        <ul className="mt-3 divide-y divide-line">
          {list.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{a.name || a.id}</span>
                <span className="num text-xs text-muted">{`${a.startTime ? `${cap(formatDateTime(a.startTime))} · ` : ''}${formatKmText(a.distanceM)} · ${formatGainText(a.elevationGainM)}${a.hasPower ? ' · Watt' : ''}`}</span>
                {a.unavailable ? <span className="block text-xs text-warn">{a.unavailableReason ?? 'Non disponibile via API'}</span> : null}
              </span>
              <Button variant="soft" className="h-11 shrink-0 px-4 text-sm" disabled={a.unavailable || busy != null} onClick={() => void take(a)}>
                {busy === a.id ? '…' : 'Importa'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function FileImport() {
  const profile = useApp((s) => s.profile);
  const importRides = useApp((s) => s.importRides);
  const [note, setNote] = useState<string | null>(null);
  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const ctx = { ftp: profile.ftp, lthr: estimateLthr(profile.maxHr, profile.thresholdHr) };
    const found: Ride[] = [];
    const bad: string[] = [];
    for (const file of [...files]) {
      const parsed = fileActivitySource.importBytes?.(file.name, new Uint8Array(await file.arrayBuffer()), ctx) ?? { rides: [], errors: [] };
      found.push(...parsed.rides);
      bad.push(...parsed.errors.map((e) => e.file));
    }
    if (found.length) await importRides(found);
    setNote(`${found.length} giri importati${bad.length ? ` · non letti: ${bad.join(', ')}` : ''}`);
  }
  return (
    <section className="mt-3 rounded-2xl border border-line bg-elev p-4" id="file">
      <h2 className="font-display text-2xl uppercase">File</h2>
      <p className="mt-1 text-sm text-muted">FIT, TCX, GPX o lo ZIP di Garmin Connect. Si legge tutto sul dispositivo.</p>
      <label className="mt-3 flex h-24 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line text-center font-semibold">
        Scegli i file
        <input className="sr-only" type="file" multiple accept=".fit,.tcx,.gpx,.zip" data-testid="rides-file" onChange={(e) => void onFiles(e.target.files)} />
      </label>
      {note ? <p className="mt-2 text-sm text-good">{note}</p> : null}
      <Link className="mt-1 inline-flex h-11 items-center text-sm font-semibold text-accent" to="/import">
        File di esempio
      </Link>
    </section>
  );
}
