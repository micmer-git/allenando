import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BoardPanel } from '@/components/Board';
import { formatKm, formatNumber } from '@/domain/format';
import { phaseOf, sessionAt, sessionBoardId, SESSION_STYLE, slotOf, upcoming, type SessionDef } from '@/game/sessions';
import { loadWorld, type RideDef } from '@/open/world';
import { cn } from '@/lib/cn';

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

export function countdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
  if (m >= 10) return `${m} min`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Il link per entrare in una sessione. */
export function sessionHref(s: SessionDef): string {
  return `/ride?world=bergamo&ride=${encodeURIComponent(s.rideId)}&session=${s.id}`;
}

export function SessionsPage() {
  const [now, setNow] = useState(() => Date.now());
  const [rides, setRides] = useState<RideDef[] | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    let alive = true;
    void loadWorld()
      .then((d) => alive && setRides(d.rides))
      .catch(() => undefined);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  const list = upcoming(now, 8);
  const last = sessionAt(slotOf(now) - 1);
  const rideOf = (id: string) => rides?.find((r) => r.id === id);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="sessions">
      <p className="eyebrow">Ogni mezz’ora, per tutti</p>
      <h1 className="font-display text-5xl uppercase leading-[0.9]">Sessioni</h1>

      <ul className="mt-4 flex flex-col gap-2">
        {list.map((s, i) => {
          const st = SESSION_STYLE[s.kind];
          const ph = phaseOf(s, now);
          const r = rideOf(s.rideId);
          const can = ph === 'aperta' || ph === 'via';
          return (
            <li
              key={s.id}
              data-testid={`session-${i}`}
              data-href={sessionHref(s)}
              className={cn('relative overflow-hidden rounded-2xl border bg-elev', can ? 'border-accent/70' : 'border-line')}
            >
              <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: st.color }} aria-hidden="true" />
              <div className="flex items-center gap-3 py-3 pl-5 pr-3">
                <div className="w-[4.6rem] shrink-0 text-center">
                  <span className="num block font-display text-3xl leading-none">{hhmm(s.start)}</span>
                  <span className="mt-1 block whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {ph === 'via' ? 'in corso' : ph === 'aperta' ? countdown(s.start - now) : `fra ${countdown(s.start - now)}`}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.title}</span>
                  <span className="block truncate text-sm text-muted">
                    {r ? `${r.name} · ${formatKm(r.lengthM)} km · ${formatNumber(r.gainM, 0)} m` : s.rideId}
                  </span>
                  {i === 0 ? <span className="mt-0.5 block text-xs text-muted">{st.blurb}</span> : null}
                </div>
                {can ? (
                  <Link to={sessionHref(s)} data-testid={`session-join-${i}`} className="grid h-11 shrink-0 place-items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">
                    Entra
                  </Link>
                ) : (
                  <span className="shrink-0 text-xs text-muted">
                    apre
                    <br />
                    <span className="num">{hhmm(s.start - 15 * 60_000)}</span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <section className="mt-6 rounded-2xl border border-line bg-elev p-3">
        <p className="eyebrow">Ultima sessione · {hhmm(last.start)}</p>
        <h2 className="mt-0.5 font-semibold">
          {last.title} · {rideOf(last.rideId)?.name ?? last.rideId}
        </h2>
        <div className="mt-2">
          <BoardPanel id={sessionBoardId(last)} title="Arrivo" />
        </div>
      </section>

      <dl className="mt-6 grid gap-2 sm:grid-cols-2">
        {(Object.keys(SESSION_STYLE) as (keyof typeof SESSION_STYLE)[]).map((k) => (
          <div key={k} className="flex gap-3 rounded-2xl bg-elev/60 p-3">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: SESSION_STYLE[k].color }} aria-hidden="true" />
            <div>
              <dt className="font-semibold">{SESSION_STYLE[k].name}</dt>
              <dd className="text-sm text-muted">{SESSION_STYLE[k].blurb}</dd>
            </div>
          </div>
        ))}
      </dl>
    </main>
  );
}
