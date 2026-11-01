import { Link, useNavigate } from 'react-router-dom';
import { WorkoutChart } from '@/components/WorkoutChart';
import { Button } from '@/components/ui';
import { formatDuration, formatNumber } from '@/domain/format';
import type { Workout } from '@/domain/types';
import { BUILTIN_WORKOUTS, duplicateWorkout, workoutEstimate } from '@/domain/workouts';
import type { Translate } from '@/i18n';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function workoutTitle(workout: Workout, t: Translate): string {
  return workout.nameKey ? t(workout.nameKey) : workout.name || t('workouts.editorTitle');
}

export function workoutBlurb(workout: Workout, t: Translate): string {
  return workout.descriptionKey ? t(workout.descriptionKey) : workout.description || '';
}

export function WorkoutsPage() {
  const { t } = useI18n();
  const ftp = useApp((s) => s.profile.ftp);
  const custom = useApp((s) => s.workouts);
  const saveWorkout = useApp((s) => s.saveWorkout);
  const navigate = useNavigate();

  async function copy(workout: Workout) {
    const next = duplicateWorkout(workout, t('workouts.copyName', { name: workoutTitle(workout, t) }));
    await saveWorkout(next);
    navigate(`/workouts/edit/${next.id}`);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10">
      <h1 className="font-display text-5xl tracking-tight">{t('workouts.title')}</h1>
      <p className="mt-3 max-w-xl text-lg text-muted">{t('workouts.lead')}</p>
      <Link to="/workouts/edit/new" className="mt-5 inline-flex h-12 items-center rounded-full bg-accent px-5 font-semibold text-accent-ink">
        {t('workouts.new')}
      </Link>
      <ul className="mt-6 flex flex-col gap-3">
        {BUILTIN_WORKOUTS.map((workout) => (
          <WorkoutCard key={workout.id} workout={workout} ftp={ftp} onCopy={() => copy(workout)} />
        ))}
      </ul>
      <h2 className="mt-10 font-display text-3xl">{t('workouts.mine')}</h2>
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

function WorkoutCard({
  workout,
  ftp,
  onCopy,
  editable = false,
}: {
  workout: Workout;
  ftp: number;
  onCopy: () => void;
  editable?: boolean;
}) {
  const { t } = useI18n();
  const estimate = workoutEstimate(workout, ftp);
  return (
    <li className="rounded-3xl border border-line bg-elev p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl leading-tight">{workoutTitle(workout, t)}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{workoutBlurb(workout, t)}</p>
        </div>
      </div>
      <div className="mt-3">
        <WorkoutChart workout={workout} ftp={ftp} />
      </div>
      <p className="num mt-2 text-sm text-muted">
        {formatDuration(estimate.durationSec)} · NP {formatNumber(estimate.np, 0)} W · TSS {formatNumber(estimate.tss, 0)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/ride?workout=${workout.id}`}
          data-testid={`workout-${workout.id}`}
          className="inline-flex h-11 items-center rounded-full bg-accent px-4 font-semibold text-accent-ink"
        >
          {t('workouts.start')}
        </Link>
        {editable ? (
          <Link to={`/workouts/edit/${workout.id}`} className="inline-flex h-11 items-center rounded-full border border-line px-4 font-semibold">
            {t('actions.edit')}
          </Link>
        ) : null}
        <Button variant="ghost" className="h-11" onClick={onCopy}>
          {t('actions.duplicate')}
        </Button>
      </div>
    </li>
  );
}
