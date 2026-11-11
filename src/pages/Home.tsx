import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coin } from '@/components/Glyph';
import { useGame } from '@/game/useGame';
import { missionsFor } from '@/game/missions';
import { phaseOf, upcoming, WORLD_RIDE_NAMES } from '@/game/sessions';
import { seriesProgress } from '@/game/career';
import { SERIES } from '@/game/missions';
import { localDateKey } from '@/domain/load';
import { loadPlanState, planById, placeName, syncDone, todayOf, type PlanSession, savePlanState } from '@/domain/plans';
import { builtinById } from '@/domain/workouts';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';
import { paceLabel, sessionClock, sessionHref, SessionKindToken } from './Sessions';
import { workoutTitle } from './Workouts';
import { Foglio } from './pedala/Foglio';

/*
 * Oggi dentro Pedala (piano U, A2; wireframe I3): la sessione aperta e il programma di oggi sono
 * righe sopra Dove, solo quando valgono; le missioni una riga sotto «Via». Livello e oro stanno in
 * Tu, la settimana e gli ultimi giri nel Diario.
 */

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** L'ora che scorre, un tick al secondo: il conto alla rovescia della sessione. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** La sessione aperta adesso, o null. */
export function useSessioneAperta(now: number) {
  const s = upcoming(now, 1)[0];
  const ph = phaseOf(s, now);
  return ph === 'aperta' || ph === 'via' ? s : null;
}

/** La sessione aperta (I3): il tipo, il nome, il passo e il conto alla rovescia; «Entra» porta dritto in corsa. */
export function SessioneRiga({ now }: { now: number }) {
  const s = useSessioneAperta(now);
  if (!s) return null;
  const name = WORLD_RIDE_NAMES[s.rideId] ?? s.rideId;
  const clock = sessionClock(s, now);
  return (
    <section className="flex items-center gap-3 rounded-2xl border border-line bg-elev px-3 py-2" data-testid="pedala-sessione">
      {/* il nome porta a tutte le sessioni; «Entra» dritto in corsa */}
      <Link to="/sessioni" className="block min-h-11 min-w-0 flex-1" data-testid="pedala-sessioni">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <SessionKindToken kind={s.kind} />
          <span className="font-semibold leading-snug">{name}</span>
        </span>
        <span className="num mt-0.5 block text-sm leading-snug text-muted" aria-label={clock.text} data-testid="pedala-sessione-clock">
          {`${s.pace ? `${paceLabel(s.pace)} · ` : ''}${clock.text}`}
        </span>
      </Link>
      <Link to={sessionHref(s)} className="grid h-11 shrink-0 place-items-center rounded-full border border-line px-4 text-sm font-semibold" data-testid="pedala-sessione-entra">
        Entra
      </Link>
    </section>
  );
}

/** L'allenamento del programma per oggi (o da recuperare), se c'è. */
export function useProgrammaOggi(): PlanSession | null {
  const rides = useApp((s) => s.rides);
  const [sess, setSess] = useState<PlanSession | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPlanState().then((state) => {
      if (!alive || !state) return;
      const plan = planById(state.id);
      if (!plan) return;
      const synced = syncDone(plan, state, rides);
      if (synced !== state) void savePlanState(synced);
      const t = todayOf(plan, synced, localDateKey(new Date()));
      setSess(t.kind === 'sessione' ? t.day.session ?? null : null);
    });
    return () => {
      alive = false;
    };
  }, [rides]);
  return sess;
}

/** «Oggi nel programma» (I3): «Usa» riempie Dove e Come con il giorno del programma. */
export function ProgrammaRiga({ s, onUsa }: { s: PlanSession; onUsa: () => void }) {
  const { t } = useI18n();
  const w = s.workout ? builtinById(s.workout) : undefined;
  const titolo = w ? workoutTitle(w, t) : 'La prova';
  return (
    <section className="flex items-center gap-3 rounded-2xl border border-line bg-elev px-3 py-2" data-testid="pedala-programma">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug">Oggi nel programma</span>
        <span className="block text-sm leading-snug text-muted">{`${titolo} · ${placeName(s.place)}`}</span>
      </span>
      <button type="button" className="h-11 shrink-0 rounded-full border border-line px-4 text-sm font-semibold" onClick={onUsa} data-testid="pedala-programma-usa">
        Usa
      </button>
    </section>
  );
}

/** «Missioni di oggi 0/3 ›»: un tocco apre la lista. */
export function MissioniRiga() {
  const hydrate = useGame((s) => s.hydrate);
  const career = useGame((s) => s.career);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const list = missionsFor(todayKey());
  const done = career.missions.day === todayKey() ? career.missions.done : [];
  const series = SERIES.filter((s) => seriesProgress(career, s.id).done > 0).map((s) => ({ name: s.name, ...seriesProgress(career, s.id) }));
  return (
    <>
      <button type="button" className="mt-1 flex min-h-12 w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(true)} data-testid="pedala-missioni">
        <span>Missioni di oggi</span>
        <span className="num text-sm text-muted">{`${list.filter((m) => done.includes(m.id)).length}/${list.length} ›`}</span>
      </button>
      <Foglio open={open} onClose={() => setOpen(false)} title="Missioni" testId="missioni-foglio">
        <ul className="mt-2 flex flex-col gap-2 pb-2" data-testid="home-missions">
          {list.map((m) => {
            const ok = done.includes(m.id);
            return (
              <li key={m.id} className="flex min-h-11 items-center gap-2.5">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${ok ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`} aria-hidden="true">
                  {ok ? '✓' : ''}
                </span>
                <span className={`min-w-0 flex-1 ${ok ? 'text-muted line-through' : ''}`}>{m.title}</span>
                <span className="num inline-flex items-center gap-1 text-sm text-muted">
                  <Coin size={14} /> {m.oro}
                </span>
              </li>
            );
          })}
          {series.map((s) => (
            <li key={s.name} className="flex min-h-11 items-center gap-2.5 border-t border-line pt-2">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${s.finished ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`} aria-hidden="true">
                {s.finished ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1">{`Serie ${s.name}`}</span>
              <span className="num text-sm text-muted">{s.finished ? 'Finita' : `Tappa ${Math.min(s.total, s.done + 1)} di ${s.total}`}</span>
            </li>
          ))}
        </ul>
      </Foglio>
    </>
  );
}
