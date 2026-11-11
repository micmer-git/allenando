import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WorkoutChart } from '@/components/WorkoutChart';
import { Button, PageHeader } from '@/components/ui';
import { formatDuration, formatNumber, formatTss } from '@/domain/format';
import type { Workout } from '@/domain/types';
import { ALL_BUILTIN, DURATION_BANDS, duplicateWorkout, filterWorkouts, WORKOUT_KIND_LABEL, WORKOUT_TYPES, workoutEstimate } from '@/domain/workouts';
import type { Translate } from '@/i18n';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';
import { cn } from '@/lib/cn';
import { downloadZwo, importZwoFiles } from '@/io/zwo';

export function workoutTitle(workout: Workout, t: Translate): string {
  return workout.nameKey ? t(workout.nameKey) : workout.name || t('workouts.editorTitle');
}

export function workoutBlurb(workout: Workout, t: Translate): string {
  return workout.descriptionKey ? t(workout.descriptionKey) : workout.description || '';
}

/*
 * Tu › Allenamenti (piano U, F7): la libreria, i tuoi schemi, Nuovo, Importa .zwo, Programmi.
 * Niente «Inizia» né «Dove e quanto»: l'allenamento si sceglie in Pedala › Come (foglio E1),
 * dove c'è anche il posto. Qui si duplica, si modifica, si esporta.
 */
export function WorkoutsPage() {
  const { t } = useI18n();
  const ftp = useApp((s) => s.profile.ftp);
  const custom = useApp((s) => s.workouts);
  const saveWorkout = useApp((s) => s.saveWorkout);
  const navigate = useNavigate();
  const [type, setType] = useState('tutti');
  const [band, setBand] = useState('tutte');
  const [zwoNote, setZwoNote] = useState<string | null>(null);
  const list = useMemo(() => filterWorkouts(ALL_BUILTIN, type, band), [type, band]);

  async function copy(workout: Workout) {
    const next = duplicateWorkout(workout, t('workouts.copyName', { name: workoutTitle(workout, t) }));
    await saveWorkout(next);
    navigate(`/workouts/edit/${next.id}`);
  }
  const chip = (on: boolean) => cn('h-11 shrink-0 rounded-full border px-3.5 text-sm font-semibold', on ? 'border-ink/30 bg-[var(--thumb)] text-ink' : 'border-line bg-elev text-muted');

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10">
      <PageHeader
        back={{ to: '/tu', label: 'Tu' }}
        title={t('workouts.title')}
        aside={
          <Link to="/workouts/edit/new" className="inline-flex h-11 items-center rounded-full border border-line bg-elev px-4 text-sm font-semibold" data-testid="workout-new">
            Nuovo
          </Link>
        }
      />
      <Link to="/programmi" className="mt-1 flex h-11 items-center justify-between rounded-2xl border border-line bg-elev px-4 text-sm font-semibold" data-testid="workouts-plans">
        <span>Programmi a settimane</span>
        <span aria-hidden="true" className="text-muted">
          →
        </span>
      </Link>

      <div className="no-scrollbar -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="Tipo" data-testid="workout-filters">
        {WORKOUT_TYPES.map((x) => (
          <button key={x.id} type="button" aria-pressed={type === x.id} onClick={() => setType(x.id)} className={chip(type === x.id)} data-testid={`workout-type-${x.id}`}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="no-scrollbar -mx-4 mt-1.5 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="Durata" data-testid="workout-band">
        {DURATION_BANDS.map((b) => (
          <button key={b.id} type="button" aria-pressed={band === b.id} onClick={() => setBand(b.id)} className={chip(band === b.id)}>
            {b.id === 'tutte' ? 'Ogni durata' : b.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted" data-testid="workout-count">
        {list.length === 0 ? 'Nessun allenamento con questi filtri.' : list.length === 1 ? '1 allenamento' : `${list.length} allenamenti`}
      </p>
      <ul className="mt-2 flex flex-col gap-3" data-testid="workout-list">
        {list.map((workout) => (
          <WorkoutCard key={workout.id} workout={workout} ftp={ftp} onCopy={() => copy(workout)} />
        ))}
      </ul>

      <div className="mt-10 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-3xl uppercase">{t('workouts.mine')}</h2>
        {/* i file di Zwift entrano fra i tuoi: un'azione leggera, non un tasto pieno */}
        <label className="-my-3 inline-flex h-11 cursor-pointer items-center text-sm font-semibold text-accent" data-testid="zwo-import">
          Importa .zwo
          <input
            type="file"
            accept=".zwo,application/xml,text/xml"
            multiple
            className="sr-only"
            onChange={(e) => {
              const el = e.currentTarget;
              void importZwoFiles(el.files, saveWorkout).then((m) => {
                setZwoNote(m);
                el.value = '';
              });
            }}
          />
        </label>
      </div>
      {zwoNote ? (
        <p className="mt-2 text-sm text-muted" role="status" data-testid="zwo-note">
          {zwoNote}
        </p>
      ) : null}
      {custom.length === 0 ? (
        <p className="mt-3 text-muted">{t('workouts.none')}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {custom.map((workout) => (
            <WorkoutCard key={workout.id} workout={workout} ftp={ftp} editable onCopy={() => copy(workout)} />
          ))}
        </ul>
      )}
    </main>
  );
}

function WorkoutCard({ workout, ftp, onCopy, editable = false }: { workout: Workout; ftp: number; onCopy: () => void; editable?: boolean }) {
  const { t } = useI18n();
  const estimate = workoutEstimate(workout, ftp);
  return (
    <li className="rounded-3xl border border-line bg-elev p-4" data-testid={`workout-${workout.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl uppercase leading-tight">{workoutTitle(workout, t)}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{workoutBlurb(workout, t)}</p>
        </div>
        <span className="num shrink-0 rounded-full bg-elev2 px-2.5 py-1 text-xs font-semibold">{WORKOUT_KIND_LABEL[workout.kind]}</span>
      </div>
      <div className="mt-3">
        <WorkoutChart workout={workout} ftp={ftp} />
      </div>
      <p className="num mt-2 text-sm text-muted">{`${formatDuration(estimate.durationSec)} · NP ${formatNumber(estimate.np, 0)} W · TSS ${formatTss(estimate.tss)}`}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {editable ? (
          <Link to={`/workouts/edit/${workout.id}`} className="inline-flex h-11 items-center rounded-full border border-line px-4 font-semibold">
            {t('actions.edit')}
          </Link>
        ) : null}
        <Button variant="ghost" className="h-11" onClick={onCopy}>
          {t('actions.duplicate')}
        </Button>
        <button type="button" className="inline-flex h-11 items-center px-2 text-sm font-semibold text-muted" onClick={() => downloadZwo(workout, workoutTitle(workout, t), ftp)} data-testid={`zwo-export-${workout.id}`}>
          Esporta .zwo
        </button>
      </div>
    </li>
  );
}
