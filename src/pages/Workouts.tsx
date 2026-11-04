import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WorkoutChart } from '@/components/WorkoutChart';
import { Button, PageHeader, Segmented, Sheet } from '@/components/ui';
import { formatDuration, formatKmText, formatNumber, formatTss } from '@/domain/format';
import { VERIFIED_ROUTES } from '@/domain/routes';
import type { Workout } from '@/domain/types';
import {
  ALL_BUILTIN,
  DURATION_BANDS,
  duplicateWorkout,
  filterWorkouts,
  WORKOUT_KIND_LABEL,
  WORKOUT_TYPES,
  workoutDuration,
  workoutEstimate,
  workoutRideLink,
  type WorkoutPlace,
} from '@/domain/workouts';
import type { Translate } from '@/i18n';
import { useI18n } from '@/i18n';
import { freeStartQuery, loopStartQuery, START_TOWNS } from '@/open/starts';
import { loadWorld, type WorldData } from '@/open/world';
import { useApp } from '@/store/useApp';
import { cn } from '@/lib/cn';
import { downloadZwo, importZwoFiles } from '@/io/zwo';

export function workoutTitle(workout: Workout, t: Translate): string {
  return workout.nameKey ? t(workout.nameKey) : workout.name || t('workouts.editorTitle');
}

export function workoutBlurb(workout: Workout, t: Translate): string {
  return workout.descriptionKey ? t(workout.descriptionKey) : workout.description || '';
}

type Where = 'salita' | 'percorso' | 'libero' | 'anello';

interface Choice {
  where: Where;
  route: string;
  ride: string;
  town: string;
}

const CHOICE_KEY = 'allenando.workouts.where';
const DEFAULT_CHOICE: Choice = { where: 'salita', route: 'selvino-nembro', ride: 'selvino', town: 'Bergamo' };

/** La scelta di dove pedalare resta per la prossima volta (solo su questo dispositivo). */
function readChoice(): Choice {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    return raw ? { ...DEFAULT_CHOICE, ...(JSON.parse(raw) as Partial<Choice>) } : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

function writeChoice(c: Choice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
  } catch {
    /* modalità privata */
  }
}

const HINT: Record<Where, string> = {
  salita: 'In cima il giro finisce, anche se l’allenamento no.',
  percorso: 'Se il percorso finisce prima, prosegui libero.',
  libero: 'Agli incroci scegli tu. Si va finché dura l’allenamento.',
  anello: 'Un anello lungo quanto l’allenamento, calcolato da lì.',
};

const selectCls = 'mt-1 h-12 w-full rounded-2xl border border-line bg-elev px-3 text-[15px]';

export function WorkoutsPage() {
  const { t } = useI18n();
  const ftp = useApp((s) => s.profile.ftp);
  const custom = useApp((s) => s.workouts);
  const saveWorkout = useApp((s) => s.saveWorkout);
  const navigate = useNavigate();
  const [choice, setChoiceState] = useState<Choice>(readChoice);
  const [type, setType] = useState('tutti');
  const [band, setBand] = useState('tutte');
  const [world, setWorld] = useState<WorldData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);
  const [zwoNote, setZwoNote] = useState<string | null>(null);
  const needWorld = choice.where !== 'salita';

  useEffect(() => {
    if (!needWorld || world) return;
    let alive = true;
    void loadWorld()
      .then((d) => alive && setWorld(d))
      .catch(() => alive && setNote('Mondo non disponibile: scegli una salita.'));
    return () => {
      alive = false;
    };
  }, [needWorld, world]);

  function setChoice(next: Partial<Choice>) {
    const c = { ...choice, ...next };
    setChoiceState(c);
    writeChoice(c);
  }

  const list = useMemo(() => filterWorkouts(ALL_BUILTIN, type, band), [type, band]);
  const freeQuery = useMemo(() => (world && choice.where === 'libero' ? freeStartQuery(world, choice.town) : null), [world, choice.where, choice.town]);

  /** Dove porta «Inizia»: null se il posto non è ancora pronto (il mondo si sta caricando). */
  function placeFor(): WorkoutPlace | null {
    if (choice.where === 'salita') return { kind: 'salita', route: choice.route };
    if (choice.where === 'percorso') return world ? { kind: 'percorso', ride: choice.ride } : null;
    if (choice.where === 'libero') return freeQuery ? { kind: 'libero', query: freeQuery } : null;
    return null;
  }

  /** L'anello si calcola al tocco, lungo quanto l'allenamento a una media da rullo. */
  function startLoop(workout: Workout) {
    if (!world) return;
    setBusy(workout.id);
    setNote(null);
    setTimeout(() => {
      const km = Math.min(90, Math.max(10, Math.round((workoutDuration(workout) / 3600) * 27)));
      const q = loopStartQuery(world, choice.town, km);
      setBusy(null);
      if (!q) {
        setNote(`Nessun anello da ${choice.town}: prova un altro paese.`);
        return;
      }
      navigate(workoutRideLink(workout.id, { kind: 'anello', query: q }));
    }, 30);
  }

  async function copy(workout: Workout) {
    const next = duplicateWorkout(workout, t('workouts.copyName', { name: workoutTitle(workout, t) }));
    await saveWorkout(next);
    navigate(`/workouts/edit/${next.id}`);
  }

  const place = placeFor();
  const start = (w: Workout) => ({ href: place ? workoutRideLink(w.id, place) : null, loop: choice.where === 'anello' ? () => startLoop(w) : null, busy: busy === w.id, ready: choice.where === 'anello' ? !!world : !!place });

  const placeLabel =
    choice.where === 'salita'
      ? VERIFIED_ROUTES.find((r) => r.id === choice.route)?.name ?? 'Salita'
      : choice.where === 'percorso'
        ? world?.rides.find((r) => r.id === choice.ride)?.name ?? 'Percorso'
        : choice.where === 'libero'
          ? `Libero da ${choice.town}`
          : `Anello da ${choice.town}`;
  const bandLabel = band === 'tutte' ? 'Durata' : DURATION_BANDS.find((b) => b.id === band)?.label ?? 'Durata';

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
        <span aria-hidden="true" className="text-muted">→</span>
      </Link>

      <div className="no-scrollbar -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="Filtri" data-testid="workout-filters">
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-accent/60 px-3.5 text-sm font-semibold text-ink"
          data-testid="workout-where-open"
        >
          <Pin />
          {placeLabel}
        </button>
        <button
          type="button"
          onClick={() => setSheet(true)}
          className={cn('inline-flex h-11 shrink-0 items-center rounded-full border px-3.5 text-sm font-semibold', band === 'tutte' ? 'border-line text-muted' : 'border-accent bg-accent/15 text-ink')}
          data-testid="workout-band-open"
        >
          {bandLabel}
        </button>
        <span className="my-2 w-px shrink-0 bg-line" aria-hidden="true" />
        {WORKOUT_TYPES.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={type === x.id}
            onClick={() => setType(x.id)}
            className={cn('h-11 shrink-0 rounded-full border px-3.5 text-sm font-semibold', type === x.id ? 'border-ink/30 bg-[var(--thumb)] text-ink' : 'border-line bg-elev text-muted')}
            data-testid={`workout-type-${x.id}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {note ? <p className="mt-2 text-sm text-warn">{note}</p> : null}
      <p className="mt-3 text-sm text-muted" data-testid="workout-count">
        {list.length === 0 ? 'Nessun allenamento con questi filtri.' : list.length === 1 ? '1 allenamento' : `${list.length} allenamenti`}
      </p>
      <ul className="mt-2 flex flex-col gap-3" data-testid="workout-list">
        {list.map((workout) => (
          <WorkoutCard key={workout.id} workout={workout} ftp={ftp} start={start(workout)} onCopy={() => copy(workout)} />
        ))}
      </ul>

      <div className="mt-10 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-3xl uppercase">{t('workouts.mine')}</h2>
        {/* i file di Zwift entrano fra i tuoi: un'azione leggera, non un terzo tasto pieno */}
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
      {zwoNote ? <p className="mt-2 text-sm text-muted" role="status" data-testid="zwo-note">{zwoNote}</p> : null}
      {custom.length === 0 ? (
        <p className="mt-3 text-muted">{t('workouts.none')}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {custom.map((workout) => (
            <WorkoutCard key={workout.id} workout={workout} ftp={ftp} start={start(workout)} editable onCopy={() => copy(workout)} />
          ))}
        </ul>
      )}

      <Sheet open={sheet} onClose={closeSheet} title="Dove e quanto" testId="workout-sheet">
        <section className="mt-3" data-testid="workout-where">
          <h3 className="eyebrow">Dove pedali</h3>
          <div className="mt-2">
            <Segmented<Where>
              label="Dove pedali"
              value={choice.where}
              onChange={(where) => setChoice({ where })}
              options={[
                { value: 'salita', label: 'Salita' },
                { value: 'percorso', label: 'Percorso' },
                { value: 'libero', label: 'Libero' },
                { value: 'anello', label: 'Anello' },
              ]}
              testId="workout-where-tabs"
            />
          </div>
          {choice.where === 'salita' ? (
            <label className="mt-3 block text-sm font-semibold">
              Salita verificata
              <select className={selectCls} value={choice.route} onChange={(e) => setChoice({ route: e.target.value })} data-testid="workout-where-route">
                {VERIFIED_ROUTES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {`${r.name} ${r.side}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {choice.where === 'percorso' ? (
            <label className="mt-3 block text-sm font-semibold">
              Percorso del mondo
              <select className={selectCls} value={choice.ride} disabled={!world} onChange={(e) => setChoice({ ride: e.target.value })} data-testid="workout-where-ride">
                {world ? (
                  world.rides.map((r) => (
                    <option key={r.id} value={r.id}>
                      {`${r.name} · ${formatKmText(r.lengthM)}`}
                    </option>
                  ))
                ) : (
                  <option>Carico i percorsi…</option>
                )}
              </select>
            </label>
          ) : null}
          {choice.where === 'libero' || choice.where === 'anello' ? (
            <label className="mt-3 block text-sm font-semibold">
              Parti da
              <select className={selectCls} value={choice.town} onChange={(e) => setChoice({ town: e.target.value })} data-testid="workout-where-town">
                {START_TOWNS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="mt-2 text-sm text-muted">{needWorld && !world && !note ? 'Carico il mondo…' : HINT[choice.where]}</p>
        </section>
        <section className="mt-5">
          <h3 className="eyebrow">Durata</h3>
          <div className="mt-2">
            <Segmented<string> label="Durata" value={band} onChange={setBand} options={DURATION_BANDS.map((b) => ({ value: b.id, label: b.label }))} testId="workout-band" />
          </div>
        </section>
      </Sheet>
    </main>
  );
}

function Pin() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-accent">
      <path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="9.8" r="2.3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function WorkoutCard({
  workout,
  ftp,
  start,
  onCopy,
  editable = false,
}: {
  workout: Workout;
  ftp: number;
  start: { href: string | null; loop: (() => void) | null; busy: boolean; ready: boolean };
  onCopy: () => void;
  editable?: boolean;
}) {
  const { t } = useI18n();
  const estimate = workoutEstimate(workout, ftp);
  const startCls = 'inline-flex h-11 items-center rounded-full border border-accent/70 px-4 font-semibold text-accent';
  return (
    <li className="rounded-3xl border border-line bg-elev p-4">
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
      <p className="num mt-2 text-sm text-muted">{`${formatDuration(estimate.durationSec)} · NP ${formatNumber(estimate.np, 0)}\u00a0W · TSS ${formatTss(estimate.tss)}`}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {start.loop ? (
          <button type="button" className={cn(startCls, 'disabled:opacity-50')} disabled={!start.ready || start.busy} onClick={start.loop} data-testid={`workout-${workout.id}`}>
            {start.busy ? 'Cerco l’anello…' : t('workouts.start')}
          </button>
        ) : start.href ? (
          <Link to={start.href} data-testid={`workout-${workout.id}`} className={startCls}>
            {t('workouts.start')}
          </Link>
        ) : (
          <button type="button" className={cn(startCls, 'opacity-50')} disabled data-testid={`workout-${workout.id}`}>
            {t('workouts.start')}
          </button>
        )}
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
