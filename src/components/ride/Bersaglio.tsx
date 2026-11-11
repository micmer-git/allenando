import { Passo } from '@/pages/pedala/Come';
import type { RideEngine } from '@/sim/engine';
import { cn } from '@/lib/cn';

/**
 * Potenza fissa in corsa (piano U, F8; wireframe H2, O2): il bersaglio con − e + sopra le cifre
 * (in orizzontale a sinistra, a portata di pollice). Un tocco 5 W, tenuto premuto 25 W. I watt
 * grandi sotto restano quelli veri.
 */
export function Bersaglio({ engine, onChange, className }: { engine: RideEngine; onChange?: () => void; className?: string }) {
  if (engine.tipo !== 'fissa' || engine.wattFissi == null) return null;
  const w = engine.wattFissi;
  const step = (d: number) => {
    engine.setWattFissi((engine.wattFissi ?? w) + d);
    onChange?.();
  };
  return (
    <div className={cn('flex items-center justify-between gap-3', className)} data-testid="ride-bersaglio-riga">
      <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold landscape:hidden">Potenza fissa</span>
      <span className="flex items-center gap-3">
        <Passo segno="−" label="Meno watt" onStep={(n) => step(-5 * n)} testId="ride-bersaglio-meno" disabled={w <= 50} />
        <span className="num w-[5.5ch] text-center font-display text-[30px] font-bold leading-none" data-testid="ride-bersaglio" data-watt={w}>{`${w} W`}</span>
        <Passo segno="+" label="Più watt" onStep={(n) => step(5 * n)} testId="ride-bersaglio-piu" disabled={w >= 1000} />
      </span>
    </div>
  );
}
