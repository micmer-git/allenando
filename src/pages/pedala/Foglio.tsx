import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Il foglio di Pedala: sale dal basso, «Chiudi» in alto a destra, Esc lo chiude. `alto` lo porta a
 * tutta altezza (Dove, Allenamento: wireframe D1, E1); `indietro` mette «‹ Dove» a sinistra (D2).
 * Montato solo quando è aperto: dentro ci sono carte e liste che non servono a foglio chiuso.
 */
export function Foglio({
  open,
  onClose,
  title,
  children,
  testId,
  alto = false,
  indietro,
  aside,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
  alto?: boolean;
  indietro?: { label: string; onClick: () => void };
  aside?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')]
        .filter(el => el.getClientRects().length > 0);
      const first = items[0];
      const last = items.at(-1);
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === panel.current)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        tabIndex={-1}
        style={{ outline: 'none' }}
        className={cn(
          'absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-lg flex-col rounded-t-3xl border border-line bg-elev outline-none wide:bottom-auto wide:top-1/2 wide:-translate-y-1/2 wide:rounded-3xl',
          alto ? 'top-[max(1.5rem,env(safe-area-inset-top))] wide:top-1/2 wide:h-[min(86dvh,860px)]' : 'max-h-[88dvh]',
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line" aria-hidden="true" />
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-1">
          {indietro ? (
            <button type="button" className="-ml-2 inline-flex h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-muted" onClick={indietro.onClick} data-testid="foglio-indietro">
              <span aria-hidden="true">‹</span> {indietro.label}
            </button>
          ) : (
            <h2 className="min-w-0 font-display text-3xl uppercase leading-none">{title}</h2>
          )}
          <span className="flex shrink-0 items-center gap-1">
            {aside}
            <button type="button" className="-mr-2 h-11 rounded-full px-3 font-semibold text-muted" onClick={onClose} data-testid="foglio-chiudi">
              Chiudi
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {indietro ? <h2 className="mt-1 font-display text-3xl uppercase leading-none">{title}</h2> : null}
          {children}
        </div>
      </div>
    </div>
  );
}
