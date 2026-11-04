import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BoardPanel } from '@/components/Board';
import { formatKm, formatNumber } from '@/domain/format';
import { phaseOf, sessionAt, sessionBoardId, SESSION_STYLE, slotOf, upcoming, WORLD_RIDE_NAMES, type SessionDef, type SessionKind } from '@/game/sessions';
import { Glyph } from '@/components/Glyph';
import { PageHeader } from '@/components/ui';
import type { Glyph as GlyphName } from '@/game/achievements';
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

/** Il passo del gruppo, scritto per esteso: è il dato che decide se entrare. */
export function paceLabel(pace: { label: string; wkg: number }): string {
  return `Passo ${pace.label} · ${pace.wkg.toFixed(1).replace('.', ',')} W/kg`;
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
      <PageHeader eyebrow="Ogni mezz’ora, per tutti" title="Sessioni" />

      <ul className="mt-4 flex flex-col gap-2">
        {list.map((s, i) => {
          const ph = phaseOf(s, now);
          const r = rideOf(s.rideId);
          const can = ph === 'aperta' || ph === 'via';
          return (
            <li
              key={s.id}
              data-testid={`session-${i}`}
              data-href={sessionHref(s)}
              data-phase={ph}
              className={cn('rounded-2xl border bg-elev', can ? 'border-accent/70' : 'border-line')}
            >
              <div className="flex items-center gap-3 p-3">
                <div className="w-[4.6rem] shrink-0 text-center">
                  <span className="num block font-display text-3xl leading-none">{hhmm(s.start)}</span>
                  <span className={cn('mt-1 block whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide', can ? 'text-accent' : 'text-muted')}>
                    {ph === 'via' ? 'In corso' : ph === 'aperta' ? countdown(s.start - now) : `Fra ${countdown(s.start - now)}`}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <SessionKindToken kind={s.kind} />
                  <span className="mt-1 block font-semibold leading-snug">{r?.name ?? WORLD_RIDE_NAMES[s.rideId] ?? s.rideId}</span>
                  <span className="num flex flex-wrap gap-x-1.5 text-sm leading-snug text-muted">
                    {s.pace ? <span className="whitespace-nowrap">{`${paceLabel(s.pace)}${r ? ' ·' : ''}`}</span> : null}
                    {r ? <span className="whitespace-nowrap">{`${formatKm(r.lengthM)} km · ${formatNumber(r.gainM, 0)} m`}</span> : null}
                  </span>
                </div>
                {can ? (
                  <div className="flex shrink-0 flex-col items-center gap-1" data-testid={`session-open-${i}`}>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">{ph === 'via' ? 'Partita' : 'Aperta ora'}</span>
                    <Link to={sessionHref(s)} data-testid={`session-join-${i}`} className="grid h-11 place-items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">
                      Entra
                    </Link>
                  </div>
                ) : (
                  <span className="num shrink-0 text-right text-xs leading-snug text-muted">
                    Apre
                    <br />
                    {hhmm(s.start - 15 * 60_000)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <section className="mt-6 rounded-2xl border border-line bg-elev p-3">
        <p className="eyebrow">{`Ultima sessione · ${hhmm(last.start)}`}</p>
        <h2 className="mt-0.5 font-semibold">{`${last.title} · ${rideOf(last.rideId)?.name ?? WORLD_RIDE_NAMES[last.rideId] ?? last.rideId}`}</h2>
        <div className="mt-2">
          <BoardPanel id={sessionBoardId(last)} title="Arrivo" />
        </div>
      </section>

      <dl className="mt-6 grid gap-2 sm:grid-cols-2">
        {(Object.keys(SESSION_STYLE) as SessionKind[]).map((k) => (
          <div key={k} className="rounded-2xl bg-elev/60 p-3">
            <dt>
              <SessionKindToken kind={k} />
            </dt>
            <dd className="mt-1.5 text-sm text-muted">{SESSION_STYLE[k].blurb}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}

const KIND_TOKEN: Record<SessionKind, { label: string; glyph: GlyphName }> = {
  gruppo: { label: 'Gruppo', glyph: 'gruppo' },
  crono: { label: 'Crono', glyph: 'crono' },
  volate: { label: 'Volate', glyph: 'volata' },
  salita: { label: 'Salita', glyph: 'gpm' },
};

/** Il tipo della sessione, scritto e col suo segno: il colore da solo non lo dice. */
export function SessionKindToken({ kind }: { kind: SessionKind }) {
  const st = SESSION_STYLE[kind];
  const k = KIND_TOKEN[kind];
  return (
    <span
      className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-bold uppercase tracking-wide text-ink"
      style={{ borderColor: `color-mix(in oklab, ${st.color} 70%, transparent)` }}
      data-testid={`session-kind-${kind}`}
    >
      <span style={{ color: st.color }} className="grid place-items-center">
        <Glyph name={k.glyph} size={13} />
      </span>
      {k.label}
    </span>
  );
}
