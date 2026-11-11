import { useState } from 'react';
import { RulloFoglio } from '@/pages/pedala/Rullo';
import { rullo, useRullo } from '@/sim/rullo';
import { cn } from '@/lib/cn';

/**
 * Il rullo in corsa (piano U, F8; wireframe H1–H4): un tondo in alto a destra al posto del foglio
 * dei sensori. ● collegato, ◐ prova, arancio se perso: allora un tocco ricollega. Collegato, un
 * tocco apre il foglio del rullo (fascia cardio, un altro rullo, scollega).
 */
export function RulloChip({ className }: { className?: string }) {
  const r = useRullo();
  const [open, setOpen] = useState(false);
  const prova = r.prova && !r.sa.potenza;
  const perso = r.stato === 'perso' || r.stato === 'fallito';
  const label = prova ? 'Prova' : perso ? 'Rullo perso: ricollega' : r.nome ?? 'Rullo';
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        className={cn(
          'pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-full backdrop-blur-md',
          perso ? 'bg-warn/30 text-warn ring-2 ring-warn ring-inset' : prova ? 'bg-bg/70 text-accent' : 'bg-good/25 text-good',
          className,
        )}
        onClick={() => (perso ? void rullo.ricollega() : setOpen(true))}
        data-testid="rullo-chip"
        data-stato={prova ? 'prova' : r.stato}
      >
        <span aria-hidden="true" className={cn('h-3.5 w-3.5 rounded-full', prova ? 'border-2 border-accent bg-[linear-gradient(90deg,var(--accent)_50%,transparent_50%)]' : perso ? 'border-2 border-warn' : 'bg-good')} />
      </button>
      {/* in corsa la prova non si spegne e il rullo non si scollega: la corsa resterebbe senza sorgente */}
      <RulloFoglio r={r} open={open} onClose={() => setOpen(false)} inCorsa />
    </>
  );
}
