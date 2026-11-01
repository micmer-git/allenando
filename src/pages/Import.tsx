import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';
import { estimateLthr } from '@/domain/zones';
import { fileActivitySource } from '@/io/sources';
import type { Ride } from '@/domain/types';
import { formatNumber } from '@/domain/format';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

const EXAMPLES = ['giro-parco.gpx', 'Collina del martedì.fit', 'archivio-garmin.zip'];

export function ImportPage() {
  const { t } = useI18n();
  const profile = useApp((s) => s.profile);
  const importRides = useApp((s) => s.importRides);
  const [busy, setBusy] = useState(false);
  const [rides, setRides] = useState<Ride[]>([]);
  const [errors, setErrors] = useState<{ file: string; message: string }[]>([]);
  const [counts, setCounts] = useState<{ added: number; updated: number } | null>(null);

  async function ingest(files: { name: string; data: Uint8Array }[]) {
    setBusy(true);
    const ctx = { ftp: profile.ftp, lthr: estimateLthr(profile.maxHr, profile.thresholdHr) };
    const found: Ride[] = [];
    const problems: { file: string; message: string }[] = [];
    for (const file of files) {
      const parsed = fileActivitySource.importBytes?.(file.name, file.data, ctx) ?? { rides: [], errors: [] };
      found.push(...parsed.rides);
      problems.push(...parsed.errors);
    }
    const result = found.length ? await importRides(found) : { added: 0, updated: 0 };
    setRides(found);
    setErrors(problems);
    setCounts(result);
    setBusy(false);
  }

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = await Promise.all(
      [...list].map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) })),
    );
    await ingest(files);
  }

  async function loadExamples() {
    const base = import.meta.env.BASE_URL;
    const files = await Promise.all(
      EXAMPLES.map(async (name) => {
        const response = await fetch(`${base}samples/${encodeURIComponent(name)}`);
        if (!response.ok) throw new Error(name);
        return { name, data: new Uint8Array(await response.arrayBuffer()) };
      }),
    );
    await ingest(files);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10" data-testid="import-page">
      <Link to="/history" className="text-sm font-semibold text-muted">{t('import.back')}</Link>
      <h1 className="mt-3 font-display text-5xl tracking-tight">{t('import.title')}</h1>
      <p className="mt-3 max-w-xl text-lg text-muted">{t('import.lead')}</p>
      <label className="mt-6 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-line bg-elev px-4 py-8 text-center">
        <span className="font-display text-2xl">{t('import.pick')}</span>
        <span className="mt-2 text-sm text-muted">{t('import.drop')}</span>
        <input
          data-testid="import-input"
          className="sr-only"
          type="file"
          multiple
          accept=".fit,.tcx,.gpx,.zip,application/zip"
          onChange={(event) => void onFiles(event.target.files)}
        />
      </label>
      <Button variant="ghost" className="mt-4" disabled={busy} onClick={() => void loadExamples().catch(() => setErrors([{ file: 'samples', message: 'parse' }]))}>
        {busy ? t('import.working') : t('import.examples')}
      </Button>
      {counts ? (
        <section className="mt-6" data-testid="import-result">
          <h2 className="font-display text-3xl">{t('import.done', { count: String(rides.length) })}</h2>
          <p className="mt-1 text-muted">
            {t('import.added', { n: String(counts.added) })} · {t('import.updated', { n: String(counts.updated) })}
          </p>
          {rides.length === 0 ? <p className="mt-3 text-muted">{t('import.none')}</p> : null}
          <ul className="mt-4 flex flex-col gap-2">
            {rides.map((ride) => (
              <li key={ride.id}>
                <Link to={`/history/${ride.id}`} className="flex items-center justify-between rounded-2xl bg-elev px-4 py-3">
                  <span>
                    <span className="block font-semibold">{ride.name}</span>
                    <span className="text-xs uppercase tracking-wide text-muted">{ride.fileType}</span>
                  </span>
                  <span className="num text-sm">{ride.tss != null ? `${formatNumber(ride.tss, 0)} TSS` : '–'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {errors.length > 0 ? (
        <section className="mt-4 text-sm text-danger">
          <p>{t('import.errors')}</p>
          <ul className="mt-1">
            {errors.map((error) => (
              <li key={`${error.file}-${error.message}`}>
                {error.file}: {t(`import.err.${error.message}`)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
