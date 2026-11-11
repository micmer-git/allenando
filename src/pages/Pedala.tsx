import { useCallback, useState } from 'react';
import { Wordmark } from '@/components/ui';
import { useOnline } from '@/components/Install';
import type { Settings } from '@/domain/types';
import type { Rete } from '@/ride/contract';
import { useApp } from '@/store/useApp';
import { HomePage } from './Home';
import { RulloChip, RulloFoglio, RulloPannello } from './pedala/Rullo';
import { useRullo } from './pedala/rulloFinto';
import { vistaPedala } from './pedala/vista';

/** «Offline», una parola (piano U, A16). */
export function ReteChip() {
  return (
    <span className="inline-flex h-11 shrink-0 items-center rounded-full border border-line px-3.5 text-sm font-semibold text-muted" data-testid="rete-offline" role="status">
      Offline
    </span>
  );
}

export function useReteOra(): Rete {
  return useOnline() ? 'online' : 'offline';
}

/**
 * Pedala, la casa (piano U, A2). Senza un sensore di potenza e senza la prova: «Collega il rullo»
 * e nient'altro (B1–B5, C5). Con la potenza: Dove · Come · Via.
 */
export function PedalaPage() {
  const r = useRullo();
  const rete = useReteOra();
  const updateSettings = useApp((s) => s.updateSettings);
  const [foglio, setFoglio] = useState(false);
  const chiudi = useCallback(() => setFoglio(false), []);
  const v = vistaPedala(r, rete);
  const spegniProva = () => {
    try {
      sessionStorage.removeItem('orobia.prova');
    } catch {
      /* niente storage */
    }
    void updateSettings({ prova: false } as Partial<Settings>);
    setFoglio(false);
  };
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4.5rem)] w-full max-w-3xl flex-col px-4 pb-nav pt-[max(0.75rem,env(safe-area-inset-top))] md:px-8 wide:min-h-dvh wide:pt-8" data-testid="pedala" data-pannello={v.pannello ?? ''}>
      <header className="flex h-14 shrink-0 items-center justify-between gap-2">
        <Wordmark className="rail:hidden wide:hidden" />
        <h1 className="hidden font-display text-4xl uppercase leading-none wide:block">Pedala</h1>
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          {v.offline ? <ReteChip /> : null}
          {v.chip ? <RulloChip r={r} onClick={() => setFoglio(true)} /> : null}
        </span>
      </header>
      {v.pannello ? (
        <div className="flex flex-1 flex-col justify-center">
          <RulloPannello r={r} pannello={v.pannello} />
        </div>
      ) : (
        <HomePage />
      )}
      <RulloFoglio r={r} open={foglio} onClose={chiudi} onSpegniProva={spegniProva} />
    </main>
  );
}
