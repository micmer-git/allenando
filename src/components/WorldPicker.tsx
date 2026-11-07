import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { downloadWorld, formatBytes, removeWorld, worldStorage, type WorldStorage } from '@/open/offline';
import { fetchManifest, WORLD_CATALOG, worldFacts, type WorldInfo, type WorldManifest } from '@/open/worlds';

/**
 * La scelta del mondo (F.1) e «Scarica per usarlo senza rete» (F.2). Una riga per mondo: il nome,
 * i km di strade e i percorsi dal manifesto, e se è scaricato. Le stesse righe stanno nella pagina
 * Mondo e, come carte con la figura, nell'onboarding (F.19).
 */

type Manifests = Record<string, WorldManifest | null | undefined>;

/** Quando lo scarico finisce o si toglie un mondo, le righe della scelta si rileggono. */
const CHANGED = 'orobia-mondo-offline';
const announce = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
};

/** I manifesti dei mondi, uno per uno: `undefined` finché non è arrivato, `null` se il mondo non è costruito. */
export function useWorldManifests(): Manifests {
  const [m, setM] = useState<Manifests>({});
  useEffect(() => {
    let alive = true;
    for (const w of WORLD_CATALOG) void fetchManifest(w.id).then((x) => alive && setM((prev) => ({ ...prev, [w.id]: x })));
    return () => {
      alive = false;
    };
  }, []);
  return m;
}

export interface OfflineHandle {
  state: WorldStorage | null;
  busy: boolean;
  progress: { done: number; total: number; bytes: number } | null;
  error: string | null;
  download: () => void;
  stop: () => void;
  remove: () => void;
}

/** Lo stato dello scarico di un mondo e le tre azioni: scarica, ferma, togli. */
export function useWorldOffline(id: string, manifest: WorldManifest | null | undefined): OfflineHandle {
  const [state, setState] = useState<WorldStorage | null>(null);
  const [progress, setProgress] = useState<OfflineHandle['progress']>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    if (manifest === undefined) return;
    void worldStorage(id, manifest).then(setState);
  }, [id, manifest]);
  useEffect(() => {
    setState(null);
    setProgress(null);
    setError(null);
    refresh();
  }, [refresh]);
  const download = useCallback(() => {
    if (!manifest || ctrl.current) return;
    const c = new AbortController();
    ctrl.current = c;
    setError(null);
    setProgress({ done: 0, total: manifest.files.length, bytes: 0 });
    downloadWorld(id, manifest, (p) => setProgress({ ...p }), c.signal)
      .then((s) => {
        setState(s);
        announce();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Scarico interrotto.');
        refresh();
      })
      .finally(() => {
        ctrl.current = null;
        setProgress(null);
      });
  }, [id, manifest, refresh]);
  const stop = useCallback(() => ctrl.current?.abort(), []);
  const remove = useCallback(() => {
    setState(null);
    void removeWorld(id).then(() => {
      refresh();
      announce();
    });
  }, [id, refresh]);
  return { state, busy: !!progress, progress, error, download, stop, remove };
}

/** «Scaricato · 19,6 MB», «Da scaricare · 19,6 MB», «A metà · 4 di 20 MB», o il manifesto che manca. */
export function storageLabel(s: WorldStorage | null, m: WorldManifest | null | undefined): string {
  if (m === undefined) return '…';
  if (m === null) return 'Non ancora disponibile';
  if (!s) return formatBytes(m.bytes);
  if (!s.available) return `${formatBytes(m.bytes)} · Senza rete non si tiene`;
  if (s.downloaded) return `Scaricato · ${formatBytes(s.totalBytes)}`;
  if (s.cached > 0) return `A metà · ${formatBytes(s.bytes)} di ${formatBytes(s.totalBytes)}`;
  return `Da scaricare · ${formatBytes(s.totalBytes)}`;
}

/** Una riga per mondo: nome, numeri, scaricato o no. Quella scelta ha il bordo d'oro. */
export function WorldChooser({ value, onChange, manifests }: { value: string; onChange: (id: string) => void; manifests: Manifests }) {
  return (
    <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Mondo" data-testid="world-chooser">
      {WORLD_CATALOG.map((w) => (
        <li key={w.id}>
          <WorldRow world={w} manifest={manifests[w.id]} selected={w.id === value} onPick={() => onChange(w.id)} />
        </li>
      ))}
    </ul>
  );
}

function WorldRow({ world, manifest, selected, onPick }: { world: WorldInfo; manifest: WorldManifest | null | undefined; selected: boolean; onPick: () => void }) {
  const [state, setState] = useState<WorldStorage | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => {
      if (manifest) void worldStorage(world.id, manifest).then((s) => alive && setState(s));
    };
    read();
    window.addEventListener(CHANGED, read);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED, read);
    };
  }, [world.id, manifest]);
  const missing = manifest === null;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={missing || undefined}
      onClick={() => !missing && onPick()}
      className={cn('flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left', selected ? 'border-accent bg-elev2' : 'border-line bg-elev', missing && 'opacity-70')}
      data-testid={`world-pick-${world.id}`}
      data-state={missing ? 'manca' : state?.downloaded ? 'scaricato' : 'da-scaricare'}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-xl leading-tight">{world.name}</span>
        <span className="num block text-sm text-muted" data-testid={`world-pick-${world.id}-facts`}>
          {manifest ? `${worldFacts(manifest)} · ${storageLabel(state, manifest)}` : storageLabel(state, manifest)}
        </span>
      </span>
      <span aria-hidden="true" className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full border text-sm font-bold', selected ? 'border-accent bg-accent text-accent-ink' : 'border-line text-transparent')}>
        ✓
      </span>
    </button>
  );
}

/** «Scarica per usarlo senza rete»: lo stato, l'avanzamento, «Togli». Niente tasto pieno: il pieno della pagina è «Pedala». */
export function OfflineCard({ id, manifest }: { id: string; manifest: WorldManifest | null | undefined }) {
  const h = useWorldOffline(id, manifest);
  if (manifest === null) return null;
  const s = h.state;
  const pct = h.progress && h.progress.total > 0 ? Math.round((h.progress.done / h.progress.total) * 100) : 0;
  return (
    <section className="mt-2 rounded-2xl border border-line bg-elev px-3.5 py-2.5" data-testid="world-offline" data-state={h.busy ? 'scarico' : s?.downloaded ? 'scaricato' : 'da-scaricare'}>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Senza rete</span>
          <span className="num block text-sm text-muted" data-testid="world-offline-label">
            {h.busy && h.progress ? `Scarico · ${formatBytes(h.progress.bytes)} di ${formatBytes(manifest?.bytes ?? 0)} · ${pct}%` : h.error ?? storageLabel(s, manifest)}
          </span>
        </p>
        {s && !s.available ? null : h.busy ? (
          <button type="button" className="h-11 shrink-0 rounded-full border border-line px-4 text-sm font-semibold" onClick={h.stop} data-testid="world-offline-stop">
            Ferma
          </button>
        ) : s?.downloaded ? (
          <button type="button" className="h-11 shrink-0 rounded-full border border-line px-4 text-sm font-semibold text-muted" onClick={h.remove} data-testid="world-offline-remove">
            Togli
          </button>
        ) : (
          <button type="button" className="h-11 shrink-0 rounded-full border border-accent px-4 text-sm font-semibold text-accent" onClick={h.download} disabled={manifest === undefined || !s} data-testid="world-offline-download">
            Scarica
          </button>
        )}
      </div>
      {h.busy ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elev2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Scarico del mondo">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * La figura di un mondo, disegnata: Bergamo con le torri di Città Alta sul colle, il Sellaronda
 * con le torri di dolomia sopra il bosco. Non una fotografia finta: una sagoma, finché le
 * schermate del 3D del Sellaronda non ci sono (pista S2).
 */
export function WorldArt({ id, className }: { id: string; className?: string }) {
  const sky = id === 'sellaronda' ? '#1b2a44' : '#2a2416';
  return (
    <svg viewBox="0 0 160 90" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="160" height="90" fill={sky} />
      {id === 'sellaronda' ? (
        <>
          <path d="M0 62 L18 50 L30 54 L44 30 L52 26 L58 40 L66 22 L74 20 L80 34 L92 18 L100 16 L108 30 L122 24 L134 40 L146 36 L160 48 V90 H0 Z" fill="#8f8a80" />
          <path d="M44 30 L52 26 L58 40 L50 42 Z M66 22 L74 20 L80 34 L70 36 Z M92 18 L100 16 L108 30 L96 32 Z" fill="#c9c4b8" />
          <path d="M0 70 Q40 62 80 68 T160 66 V90 H0 Z" fill="#2f4a2a" />
          <path d="M20 72 l4 -9 l4 9 Z M40 74 l4 -10 l4 10 Z M100 72 l4 -9 l4 9 Z M130 74 l4 -10 l4 10 Z" fill="#1f331c" />
          <path d="M0 84 Q50 78 100 82 T160 80" fill="none" stroke="#4a4642" strokeWidth="3" />
          <path d="M0 84 Q50 78 100 82 T160 80" fill="none" stroke="#f4f1e8" strokeWidth="0.6" strokeDasharray="4 4" />
        </>
      ) : (
        <>
          <path d="M0 58 Q30 40 60 52 T120 46 T160 52 V90 H0 Z" fill="#4f6b3a" />
          <path d="M44 62 Q70 44 96 56 L96 62 Z" fill="#6b5a3e" />
          <rect x="62" y="36" width="5" height="22" fill="#a8946a" />
          <rect x="74" y="30" width="4" height="28" fill="#a8946a" />
          <path d="M60 36 l3.5 -5 l3.5 5 Z M73 30 l3 -4 l3 4 Z" fill="#c9b48a" />
          <path d="M50 58 h50 l-4 6 h-42 Z" fill="#8c7a58" />
          <path d="M0 80 Q50 74 100 78 T160 74" fill="none" stroke="#4a4642" strokeWidth="3" />
          <path d="M0 80 Q50 74 100 78 T160 74" fill="none" stroke="#ffc814" strokeWidth="0.8" strokeDasharray="4 4" />
        </>
      )}
    </svg>
  );
}
