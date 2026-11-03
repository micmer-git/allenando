import { useEffect, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/cn';

/*
 * Installare l'app sul telefono. Chrome su Android offre il suo prompt (beforeinstallprompt),
 * che va catturato presto, prima che React monti: lo fa captureInstallPrompt() in main.tsx.
 * Safari su iPhone non ha prompt: si spiega il gesto «Condividi → Aggiungi alla schermata Home».
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());
let version = 0;

export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    version += 1;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    version += 1;
    emit();
  });
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent, touch = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints): boolean {
  // iPadOS si presenta come Mac: lo tradisce il touch
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touch > 1);
}

export function useInstall() {
  useSyncExternalStore(subscribe, () => version);
  return {
    canPrompt: deferred != null,
    installed: installed || isStandalone(),
    ios: isIos(),
    async prompt(): Promise<boolean> {
      const event = deferred;
      if (!event) return false;
      deferred = null;
      version += 1;
      await event.prompt();
      const choice = await event.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
      emit();
      return choice.outcome === 'accepted';
    },
  };
}

const DISMISS_KEY = 'allenando.install.dismissed';

export function InstallCard({ className }: { className?: string }) {
  const install = useInstall();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (install.installed || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* modalità privata */
    }
  };
  return (
    <section className={cn('rounded-2xl border border-line bg-elev p-4', className)} data-testid="install-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl uppercase leading-none">Mettila sul telefono</h2>
          <p className="mt-1 text-sm leading-snug text-muted">A schermo intero, si apre dall’icona e le salite funzionano anche senza rete.</p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Non ora" className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {install.canPrompt ? (
        <button
          type="button"
          data-testid="install-button"
          className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-full bg-accent font-semibold text-accent-ink"
          onClick={() => void install.prompt()}
        >
          Installa OROBIA
        </button>
      ) : install.ios ? (
        <ol className="mt-3 space-y-2 text-sm" data-testid="install-ios">
          <li className="flex items-center gap-3">
            <Step n={1} />
            <span>
              In Safari tocca <ShareGlyph /> <b>Condividi</b>
            </span>
          </li>
          <li className="flex items-center gap-3">
            <Step n={2} />
            <span>
              Scegli <b>Aggiungi alla schermata Home</b>
            </span>
          </li>
          <li className="flex items-center gap-3">
            <Step n={3} />
            <span>icona Apri’icona: niente barre del browser</span>
          </li>
        </ol>
      ) : (
        <p className="mt-3 text-sm leading-snug text-muted" data-testid="install-manual">
          Dal menu del browser scegli <b className="text-ink">Installa app</b> o <b className="text-ink">Aggiungi a schermata Home</b>.
        </p>
      )}
    </section>
  );
}

function Step({ n }: { n: number }) {
  return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elev2 text-xs font-bold">{n}</span>;
}

function ShareGlyph() {
  return (
    <svg className="-mt-1 inline" width="16" height="18" viewBox="0 0 16 20" aria-label="icona Condividi">
      <path d="M8 1v11M4 5l4-4 4 4M3 9H1v10h14V9h-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" data-testid="offline-banner" className="sticky top-0 z-40 bg-warn/15 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm text-warn backdrop-blur">
      Sei offline: salite, giri salvati e simulatore funzionano; le stanze «Pedala insieme» no.
    </p>
  );
}
