import { useMemo, useState } from 'react';
import { WorkoutChart } from '@/components/WorkoutChart';
import { formatHours, formatNumber, formatTss } from '@/domain/format';
import type { Workout } from '@/domain/types';
import { ALL_BUILTIN, DURATION_BANDS, filterWorkouts, WORKOUT_TYPES, workoutEstimate } from '@/domain/workouts';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';
import { cn } from '@/lib/cn';
import { workoutTitle } from '../Workouts';
import { Foglio } from './Foglio';

/**
 * Scegli l'allenamento (wireframe E1): una riga per allenamento, tocco = scelto, si torna a Pedala.
 * L'ultimo usato in cima. Duplica, Esporta .zwo, Nuovo e Programmi stanno in Tu › Allenamenti.
 */
export function AllenamentoFoglio({ open, onClose, scelto, onScegli }: { open: boolean; onClose: () => void; scelto: string | null; onScegli: (w: Workout) => void }) {
  const { t } = useI18n();
  const ftp = useApp((s) => s.profile.ftp);
  const tuoi = useApp((s) => s.workouts);
  const [tipo, setTipo] = useState('tutti');
  const [banda, setBanda] = useState('tutte');
  const lista = useMemo(() => {
    const all = filterWorkouts([...tuoi, ...ALL_BUILTIN], tipo, banda);
    const i = all.findIndex((w) => w.id === scelto);
    return i > 0 ? [all[i], ...all.slice(0, i), ...all.slice(i + 1)] : all;
  }, [tuoi, tipo, banda, scelto]);
  const chip = (on: boolean) => cn('h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold', on ? 'border-ink/30 bg-[var(--thumb)] text-ink' : 'border-line text-muted');
  return (
    <Foglio open={open} onClose={onClose} title="Allenamento" alto testId="allenamento-foglio">
      <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="Tipo">
        {WORKOUT_TYPES.map((x) => (
          <button key={x.id} type="button" aria-pressed={tipo === x.id} className={chip(tipo === x.id)} onClick={() => setTipo(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="no-scrollbar -mx-4 mt-1.5 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="Durata">
        {DURATION_BANDS.map((b) => (
          <button key={b.id} type="button" aria-pressed={banda === b.id} className={chip(banda === b.id)} onClick={() => setBanda(b.id)}>
            {b.id === 'tutte' ? 'Ogni durata' : b.label}
          </button>
        ))}
      </div>
      <ul className="mt-2" data-testid="allenamento-lista">
        {lista.length === 0 ? <li className="py-4 text-sm text-muted">Nessun allenamento con questi filtri.</li> : null}
        {lista.map((w) => {
          const est = workoutEstimate(w, ftp);
          return (
            <li key={w.id}>
              <button type="button" className="block w-full border-b border-line py-2.5 text-left" onClick={() => onScegli(w)} data-testid={`allenamento-riga-${w.id}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{workoutTitle(w, t)}</span>
                  {w.id === scelto ? <span className="shrink-0 rounded-full border border-line px-2 py-px text-xs font-semibold">Ultimo</span> : !w.builtin ? <span className="shrink-0 rounded-full border border-line px-2 py-px text-xs font-semibold">Tuo</span> : null}
                </span>
                <span className="mt-1 block [&_svg]:h-7">
                  <WorkoutChart workout={w} ftp={ftp} />
                </span>
                <span className="num mt-0.5 block text-sm text-muted">{`${formatHours(est.durationSec)} · NP ${formatNumber(est.np, 0)} W · TSS ${formatTss(est.tss)}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Foglio>
  );
}
