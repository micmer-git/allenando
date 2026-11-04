import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';
import { formatHours } from '@/domain/format';
import { localDateKey } from '@/domain/load';
import {
  daysBetween,
  loadPlanState,
  markDone,
  planById,
  planDays,
  placeName,
  PLANS,
  progressOf,
  savePlanState,
  sessionDuration,
  sessionLink,
  startPlan,
  syncDone,
  todayOf,
  weekLoads,
  type PlanDay,
  type PlanSession,
  type PlanState,
  type TrainingPlan,
} from '@/domain/plans';
import { builtinById } from '@/domain/workouts';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/useApp';
import { workoutTitle } from './Workouts';

/**
 * I programmi a settimane (src/domain/plans.ts): quello che stai facendo, la settimana giorno
 * per giorno, e gli altri da cominciare. `TodayWorkout` è la carta di Oggi.
 */

/** Il programma in corso: letto da IndexedDB e allineato coi giri salvati. */
function usePlan(): { state: PlanState | null; ready: boolean; set: (s: PlanState | null) => void } {
  const rides = useApp((s) => s.rides);
  const [state, setState] = useState<PlanState | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadPlanState().then((s) => {
      if (!alive) return;
      setState(s);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  // un giro nuovo che fa la seduta di oggi (o una da recuperare) la segna fatta
  useEffect(() => {
    if (!state) return;
    const plan = planById(state.id);
    if (!plan) return;
    const next = syncDone(plan, state, rides);
    if (next !== state) {
      setState(next);
      void savePlanState(next);
    }
  }, [state, rides]);
  return {
    state,
    ready,
    set: (s) => {
      setState(s);
      void savePlanState(s);
    },
  };
}

function useSessionTitle(): (s: PlanSession) => string {
  const { t } = useI18n();
  return (s) => {
    if (!s.workout) return 'La prova';
    const w = builtinById(s.workout);
    return w ? workoutTitle(w, t) : s.workout;
  };
}

function sessionMeta(s: PlanSession): string {
  const sec = sessionDuration(s);
  return s.workout ? `${placeName(s.place)} · ${sec != null ? formatHours(sec) : ''}` : `${placeName(s.place)} a tutta, contro il tuo fantasma`;
}

/** «Mar 5»: il giorno della settimana con la maiuscola. */
function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const s = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric' }).format(new Date(y, m - 1, d));
  return s.charAt(0).toLocaleUpperCase('it-IT') + s.slice(1);
}

/** La carta di Oggi: l'allenamento del giorno, un tocco per partire. Niente se non c'è un programma. */
export function TodayWorkout({ className }: { className?: string }) {
  const { state } = usePlan();
  const title = useSessionTitle();
  const plan = state ? planById(state.id) : undefined;
  if (!state || !plan) return null;
  return <TodayCard plan={plan} state={state} title={title} className={className} />;
}

function TodayCard({ plan, state, title, className }: { plan: TrainingPlan; state: PlanState; title: (s: PlanSession) => string; className?: string }) {
  const today = localDateKey(new Date());
  const t = todayOf(plan, state, today);
  const week = Math.min(plan.weeks.length, Math.floor(daysBetween(state.start, today) / 7) + 1);
  const where = `${plan.name} · Settimana ${week} di ${plan.weeks.length}`;
  if (t.kind === 'sessione') {
    const s = t.day.session!;
    return (
      <section className={cn('overflow-hidden rounded-3xl border border-line bg-elev', className)} data-testid="today-workout" data-day={t.day.index}>
        <Link to={sessionLink(s)} className="flex items-center gap-3 p-4 transition hover:bg-elev2/50" data-testid="today-workout-go">
          <span className="min-w-0 flex-1">
            <span className="eyebrow block">{t.catchUp ? `Da recuperare · ${dayLabel(t.day.date)}` : 'L’allenamento di oggi'}</span>
            <span className="mt-1 block font-display text-3xl uppercase leading-none">{title(s)}</span>
            <span className="num mt-1.5 block text-sm">{sessionMeta(s)}</span>
            <span className="mt-0.5 block text-xs text-muted">{where}</span>
          </span>
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-accent text-2xl text-accent">
            →
          </span>
        </Link>
      </section>
    );
  }
  const next = t.kind === 'fatto' || t.kind === 'riposo' ? t.next : null;
  return (
    <section className={cn('rounded-3xl border border-line bg-elev', className)} data-testid="today-workout" data-day="riposo">
      <Link to="/programmi" className="flex min-h-11 items-center gap-3 p-4">
        <span className="min-w-0 flex-1">
          <span className="eyebrow block">{t.kind === 'fatto' ? 'Fatto per oggi' : t.kind === 'finito' ? 'Programma finito' : 'Oggi riposo'}</span>
          <span className="mt-1 block font-semibold">{next?.session ? `${dayLabel(next.date)}: ${title(next.session)}` : t.kind === 'finito' ? 'Scegline un altro' : plan.name}</span>
          <span className="mt-0.5 block text-xs text-muted">{t.kind === 'finito' ? plan.name : where}</span>
        </span>
        <span aria-hidden="true" className="text-2xl text-muted">
          →
        </span>
      </Link>
    </section>
  );
}

const STATUS: Record<PlanDay['status'], { label: string; cls: string }> = {
  fatto: { label: 'Fatto', cls: 'bg-good/20 text-good' },
  oggi: { label: 'Oggi', cls: 'bg-accent text-accent-ink' },
  saltato: { label: 'Saltato', cls: 'bg-elev2 text-muted' },
  futuro: { label: '', cls: '' },
  riposo: { label: 'Riposo', cls: 'text-muted' },
};

export function PlansPage() {
  const { state, ready, set } = usePlan();
  const title = useSessionTitle();
  const plan = state ? planById(state.id) : undefined;
  const today = localDateKey(new Date());
  const [week, setWeek] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const days = plan && state ? planDays(plan, state, today) : [];
  const nowWeek = plan && state ? Math.max(0, Math.min(plan.weeks.length - 1, Math.floor(daysBetween(state.start, today) / 7))) : 0;
  const shown = week ?? nowWeek;
  const prog = plan && state ? progressOf(plan, state) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-4 md:px-8 md:pt-10" data-testid="plans-page">
      <Link to="/workouts" className="-ml-1 inline-flex h-11 items-center px-1 text-sm font-semibold text-muted">
        ← Allenamenti
      </Link>
      <h1 className="font-display text-5xl uppercase leading-none">Programmi</h1>

      {plan && state && prog ? (
        <section className="mt-5" data-testid="plan-active" data-plan={plan.id}>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Il tuo programma</p>
              <h2 className="mt-1 font-display text-3xl uppercase leading-none">{plan.name}</h2>
            </div>
            <p className="num shrink-0 text-sm text-muted" data-testid="plan-progress">
              {prog.done}/{prog.total} fatti
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elev2" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(prog.done / Math.max(1, prog.total)) * 100}%` }} />
          </div>
          <TodayCard plan={plan} state={state} title={title} className="mt-4" />

          <div className="mt-5 flex items-center justify-between gap-2">
            <button type="button" aria-label="Settimana prima" className="grid h-11 w-11 place-items-center rounded-full bg-elev2 disabled:opacity-40" disabled={shown === 0} onClick={() => setWeek(shown - 1)}>
              ‹
            </button>
            <p className="text-center">
              <span className="eyebrow block">Settimana {shown + 1} di {plan.weeks.length}</span>
              <span className="font-semibold">{plan.weeks[shown].title}</span>
              {plan.weeks[shown].recovery ? <span className="text-muted"> · Scarico</span> : null}
            </p>
            <button
              type="button"
              aria-label="Settimana dopo"
              className="grid h-11 w-11 place-items-center rounded-full bg-elev2 disabled:opacity-40"
              disabled={shown === plan.weeks.length - 1}
              onClick={() => setWeek(shown + 1)}
            >
              ›
            </button>
          </div>
          <ol className="mt-3 flex flex-col gap-1.5" data-testid="plan-week">
            {days
              .filter((d) => d.week === shown)
              .map((d) => (
                <li key={d.index} className={cn('flex items-center gap-3 rounded-2xl px-3', d.session ? 'min-h-14 bg-elev py-2' : 'min-h-9 py-1')} data-testid={`plan-day-${d.index}`} data-status={d.status}>
                  <span className="num w-14 shrink-0 text-sm text-muted">{dayLabel(d.date)}</span>
                  {d.session ? (
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-tight">{title(d.session)}</span>
                      <span className="block text-sm text-muted">{sessionMeta(d.session)}</span>
                    </span>
                  ) : (
                    <span className="flex-1 text-sm text-muted">Riposo</span>
                  )}
                  {d.session && (d.status === 'saltato' || d.status === 'oggi') ? (
                    <button type="button" className="h-11 shrink-0 rounded-full border border-line px-3 text-sm font-semibold" onClick={() => set(markDone(state, d.index))} data-testid={`plan-mark-${d.index}`}>
                      Segna fatto
                    </button>
                  ) : d.session && d.status !== 'futuro' ? (
                    <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', STATUS[d.status].cls)}>{STATUS[d.status].label}</span>
                  ) : null}
                </li>
              ))}
          </ol>
          <div className="mt-4">
            {leaving ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="danger" className="h-11" onClick={() => (set(null), setLeaving(false), setWeek(null))} data-testid="plan-leave-confirm">
                  Lascia il programma
                </Button>
                <Button variant="ghost" className="h-11" onClick={() => setLeaving(false)}>
                  Resta
                </Button>
              </div>
            ) : (
              <button type="button" className="h-11 text-sm font-semibold text-muted" onClick={() => setLeaving(true)} data-testid="plan-leave">
                Lascia il programma
              </button>
            )}
          </div>
        </section>
      ) : null}

      {ready ? (
        <section className="mt-8">
          <h2 className="eyebrow">{plan ? 'Gli altri programmi' : 'Scegli un programma'}</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {PLANS.filter((p) => p.id !== plan?.id).map((p) => (
              <PlanCard key={p.id} plan={p} onStart={() => (set(startPlan(p.id, today)), setWeek(null), window.scrollTo(0, 0))} replacing={!!plan} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function PlanCard({ plan, onStart, replacing }: { plan: TrainingPlan; onStart: () => void; replacing: boolean }) {
  const loads = weekLoads(plan);
  const max = Math.max(...loads);
  const sessions = plan.weeks.reduce((n, w) => n + w.days.filter(Boolean).length, 0);
  const hours = plan.weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + (d ? (sessionDuration(d) ?? 3600) : 0), 0), 0);
  const [armed, setArmed] = useState(false);
  return (
    <li className="rounded-3xl border border-line bg-elev p-4" data-testid={`plan-${plan.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-3xl uppercase leading-none">{plan.name}</h3>
          <p className="mt-1.5 text-sm text-muted">{plan.goal}</p>
        </div>
        <span className="num shrink-0 rounded-full bg-elev2 px-2.5 py-1 text-xs font-semibold">{plan.weeks.length} settimane</span>
      </div>
      {/* il carico settimana per settimana: lo scarico si vede */}
      <div className="mt-3 flex h-10 items-end gap-1" aria-label="Carico per settimana" role="img">
        {loads.map((l, i) => (
          <span key={i} className={cn('flex-1 rounded-t', plan.weeks[i].recovery ? 'bg-ink/10' : 'bg-ink/25')} style={{ height: `${Math.max(12, (l / max) * 100)}%` }} title={plan.weeks[i].title} />
        ))}
      </div>
      <p className="num mt-2 text-sm text-muted">
        {sessions} uscite · {formatHours(hours)} in tutto
      </p>
      <Button
        variant="soft"
        className="mt-3 h-11 w-full"
        onClick={() => {
          if (replacing && !armed) return setArmed(true);
          onStart();
        }}
        data-testid={`plan-start-${plan.id}`}
      >
        {replacing ? (armed ? 'Sì, cambia programma' : 'Cambia con questo') : 'Comincia oggi'}
      </Button>
    </li>
  );
}
