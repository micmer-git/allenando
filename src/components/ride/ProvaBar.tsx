import { forwardRef } from 'react';
import type { RideEngine } from '@/sim/engine';
import { cn } from '@/lib/cn';

/**
 * La riga della prova (piano U, F8; wireframe H4, O4): lo sforzo del simulatore e la velocità del
 * tempo 1× 4× 10×. Solo in Modalità prova: col rullo vero non c'è niente da regolare.
 */
export const ProvaBar = forwardRef<HTMLDivElement, { engine: RideEngine; effort: number; onEffort: (v: number) => void; onScale: () => void }>(function ProvaBar({ engine, effort, onEffort, onScale }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-2 landscape:absolute landscape:bottom-[calc(100%+0.5rem)] landscape:right-0 landscape:h-12 landscape:rounded-xl landscape:bg-bg/72 landscape:px-2 landscape:backdrop-blur-md',
        engine.mode === 'free' ? 'basis-full landscape:w-[21rem]' : 'shrink-0',
      )}
      data-testid="sim-controls"
    >
      {engine.mode === 'free' ? (
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-xs text-muted">Sforzo</span>
          <input
            aria-label="Sforzo della prova, in percentuale della FTP"
            className="h-11 min-w-0 flex-1 accent-[var(--accent)]"
            type="range"
            min={0}
            max={160}
            value={effort}
            onChange={(event) => onEffort(Number(event.target.value))}
          />
          <span className="num w-10 text-right text-xs">{`${effort} %`}</span>
        </label>
      ) : null}
      <div className="grid shrink-0 grid-cols-3 gap-0.5 rounded-full bg-elev2 p-0.5" role="group" aria-label="Velocità del tempo nella prova">
        {[1, 4, 10].map((scale) => (
          <button
            key={scale}
            type="button"
            aria-pressed={engine.timeScale === scale}
            className={cn('h-11 w-11 rounded-full text-sm font-semibold', engine.timeScale === scale ? 'bg-[var(--thumb)] text-ink' : 'text-muted')}
            onClick={() => {
              engine.timeScale = scale;
              onScale();
            }}
          >
            {scale}×
          </button>
        ))}
      </div>
    </div>
  );
});
