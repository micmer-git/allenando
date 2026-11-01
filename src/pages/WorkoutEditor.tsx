import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Field, TextInput } from '@/components/ui';
import { formatDuration, formatNumber } from '@/domain/format';
import type { Workout, WorkoutStep } from '@/domain/types';
import { emptyWorkout, workoutEstimate } from '@/domain/workouts';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';
import { workoutTitle } from './Workouts';

interface DraftStep {
  id: string;
  minutes: string;
  seconds: string;
  mode: 'pct' | 'watt';
  power: string;
  ramp: boolean;
  end: string;
}

export function WorkoutEditorPage() {
  const { id } = useParams();
  const existing = useApp((s) => s.workouts.find((item) => item.id === id));
  const initial = useMemo(() => existing ?? emptyWorkout(), [existing]);
  return <Editor key={initial.id} initial={initial} isNew={!existing} />;
}

function Editor({ initial, isNew }: { initial: Workout; isNew: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ftp = useApp((s) => s.profile.ftp);
  const saveWorkout = useApp((s) => s.saveWorkout);
  const deleteWorkout = useApp((s) => s.deleteWorkout);
  const [name, setName] = useState(isNew ? '' : workoutTitle(initial, t));
  const [steps, setSteps] = useState<DraftStep[]>(() => initial.steps.map(toDraft));
  const [error, setError] = useState('');

  const preview = useMemo(() => draftToWorkout(initial.id, name, steps), [initial.id, name, steps]);
  const estimate = workoutEstimate(preview, ftp);

  function update(idStep: string, patch: Partial<DraftStep>) {
    setSteps((current) => current.map((step) => (step.id === idStep ? { ...step, ...patch } : step)));
  }

  async function save() {
    if (!name.trim()) {
      setError(t('workouts.needName'));
      return;
    }
    // un passo con numeri illeggibili non va scartato in silenzio: lo si segnala
    const unreadable = preview.steps.length !== steps.length;
    const badPower = preview.steps.some((step) => !((step.powerPct ?? step.powerWatts ?? 0) > 0));
    if (preview.steps.length === 0 || unreadable || badPower || preview.steps.some((step) => step.durationSec < 10)) {
      setError(t('workouts.needStep'));
      return;
    }
    const workout: Workout = { ...preview, name: name.trim(), builtin: false, kind: 'custom', nameKey: undefined, descriptionKey: undefined };
    await saveWorkout(workout);
    navigate('/workouts');
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10">
      <Link to="/workouts" className="text-sm font-semibold text-muted">
        {t('actions.back')}
      </Link>
      <h1 className="mt-3 font-display text-4xl">{t('workouts.editorTitle')}</h1>
      <div className="mt-5">
        <Field label={t('workouts.name')}>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder={t('workouts.namePlaceholder')} />
        </Field>
      </div>
      <p className="num mt-4 text-sm text-muted">
        {formatDuration(estimate.durationSec)} · TSS {formatNumber(estimate.tss, 0)}
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.id} className="rounded-3xl border border-line bg-elev p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">
                {index + 1}. {t('workouts.steps')}
              </span>
              <button type="button" className="text-sm font-semibold text-danger" onClick={() => setSteps((current) => current.filter((item) => item.id !== step.id))}>
                {t('workouts.remove')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={t('workouts.minutes')}>
                <TextInput inputMode="numeric" value={step.minutes} onChange={(event) => update(step.id, { minutes: event.target.value })} />
              </Field>
              <Field label={t('workouts.seconds')}>
                <TextInput inputMode="numeric" value={step.seconds} onChange={(event) => update(step.id, { seconds: event.target.value })} />
              </Field>
              <Field label={step.mode === 'pct' ? t('workouts.pct') : t('workouts.watts')}>
                <TextInput inputMode="numeric" value={step.power} onChange={(event) => update(step.id, { power: event.target.value })} />
              </Field>
              <Field label={t('workouts.power')}>
                <select
                  className="h-12 w-full rounded-2xl border border-line bg-elev2 px-3"
                  value={step.mode}
                  onChange={(event) => update(step.id, { mode: event.target.value as 'pct' | 'watt' })}
                >
                  <option value="pct">{t('workouts.pct')}</option>
                  <option value="watt">{t('workouts.watts')}</option>
                </select>
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={step.ramp} onChange={(event) => update(step.id, { ramp: event.target.checked })} />
              {t('workouts.rampTo')}
            </label>
            {step.ramp ? (
              <div className="mt-3 max-w-[10rem]">
                <TextInput inputMode="numeric" value={step.end} onChange={(event) => update(step.id, { end: event.target.value })} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-4 h-12 w-full rounded-full border border-dashed border-line font-semibold"
        onClick={() => setSteps((current) => [...current, blankStep()])}
      >
        {t('workouts.addStep')}
      </button>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => void save()}>{t('actions.save')}</Button>
        {!isNew ? (
          <Button
            variant="danger"
            onClick={() => {
              void deleteWorkout(initial.id).then(() => navigate('/workouts'));
            }}
          >
            {t('workouts.delete')}
          </Button>
        ) : null}
      </div>
    </main>
  );
}

function blankStep(): DraftStep {
  return { id: crypto.randomUUID(), minutes: '1', seconds: '0', mode: 'pct', power: '60', ramp: false, end: '80' };
}

function toDraft(step: WorkoutStep): DraftStep {
  const watts = step.powerWatts != null;
  return {
    id: step.id,
    minutes: String(Math.floor(step.durationSec / 60)),
    seconds: String(step.durationSec % 60),
    mode: watts ? 'watt' : 'pct',
    power: String(watts ? step.powerWatts : step.powerPct ?? 50),
    ramp: step.powerEndPct != null || step.powerEndWatts != null,
    end: String(step.powerEndWatts ?? step.powerEndPct ?? (watts ? step.powerWatts : step.powerPct) ?? 50),
  };
}

function draftToWorkout(id: string, name: string, steps: DraftStep[]): Workout {
  return {
    id,
    builtin: false,
    kind: 'custom',
    name,
    steps: steps
      .map((step) => {
        const durationSec = Math.max(0, Math.round(readNumber(step.minutes || '0') * 60 + readNumber(step.seconds || '0')));
        const power = readNumber(step.power);
        const end = readNumber(step.end);
        if (step.mode === 'watt') {
          return {
            id: step.id,
            durationSec,
            powerWatts: power,
            powerEndWatts: step.ramp ? end : undefined,
          };
        }
        return {
          id: step.id,
          durationSec,
          powerPct: power,
          powerEndPct: step.ramp ? end : undefined,
        };
      })
      .filter((step) => step.durationSec > 0 && Number.isFinite(step.powerPct ?? step.powerWatts)),
  };
}

/** Come lo si scrive a mano: "1,5" vale 1.5, vuoto non vale niente. */
function readNumber(value: string): number {
  const text = value.trim().replace(',', '.');
  return text === '' ? Number.NaN : Number(text);
}
