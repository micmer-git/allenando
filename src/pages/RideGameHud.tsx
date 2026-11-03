import { Link } from 'react-router-dom';
import { Coin, Glyph } from '@/components/Glyph';
import { formatDuration, formatKm } from '@/domain/format';
import { SEGMENT_STYLE } from '@/game/arches';
import type { CareerOutcome, SegmentResult } from '@/game/career';
import { ITEM_BY_ID } from '@/game/kit';
import type { RideGame } from '@/game/rideGame';
import { SESSION_STYLE } from '@/game/sessions';
import { cn } from '@/lib/cn';

/** Tempo con i decimi: 0:31,4 — sui tratti brevi il decimo conta. */
export function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const whole = Math.floor(s);
  const tenth = Math.floor((s - whole) * 10);
  return `${m}:${String(whole).padStart(2, '0')},${tenth}`;
}

/** Il tratto in corso, quello che arriva, e il risultato appena tagliato il traguardo. */
export function SegmentHud({ game }: { game: RideGame }) {
  const e = game.engine;
  const live = game.live[0];
  const banner = game.banner;
  if (banner) {
    const st = SEGMENT_STYLE[banner.seg.kind];
    const delta = banner.prev != null ? banner.sec - banner.prev : null;
    return (
      <div className="pop-in pointer-events-none overflow-hidden rounded-2xl shadow-lg" style={{ background: st.color, color: st.ink }} data-testid="segment-banner">
        <div className="px-4 py-2 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-90">
            {st.short} · {banner.seg.name}
          </p>
          <p className="num font-display text-4xl leading-none">{clock(banner.sec)}</p>
          <p className="mt-0.5 text-xs font-semibold">
            {banner.prev == null ? 'Primo tempo' : banner.isPb ? `Record! −${formatDuration(Math.abs(delta!))}` : `+${formatDuration(Math.abs(delta!))} dal record`}
            {banner.rank ? ` · ${banner.rank}` : ''}
          </p>
        </div>
      </div>
    );
  }
  if (live) {
    const st = SEGMENT_STYLE[live.seg.kind];
    const t = e.elapsed - live.t0;
    const left = Math.max(0, live.to - e.distance);
    const f = Math.min(1, Math.max(0, (e.distance - live.from) / Math.max(1, live.to - live.from)));
    const pb = game.pbOf(live.seg.id);
    return (
      <div className="pointer-events-none min-w-56 overflow-hidden rounded-2xl bg-bg/80 backdrop-blur" data-testid="segment-live">
        <div className="flex items-center gap-2 px-3 pt-2">
          <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: st.color, color: st.ink }}>
            <Glyph name={live.seg.kind} size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: st.color }}>
              {st.short}
            </span>
            <span className="block truncate text-sm font-semibold leading-tight">{live.seg.name}</span>
          </span>
          <span className="num font-display text-3xl leading-none">{clock(t)}</span>
        </div>
        <div className="num flex justify-between px-3 pb-1.5 pt-1 text-[11px] text-muted">
          <span>{left >= 1000 ? `${formatKm(left)} km` : `${Math.round(left)} m`} all’arrivo</span>
          {pb != null ? <span>record {formatDuration(pb)}</span> : <span>primo tempo</span>}
        </div>
        <div className="h-1 bg-elev2">
          <div className="h-full" style={{ width: `${f * 100}%`, background: st.color }} />
        </div>
      </div>
    );
  }
  const next = game.ahead();
  if (next && next.from - e.distance < 600) {
    const st = SEGMENT_STYLE[next.seg.kind];
    return (
      <p className="pointer-events-none inline-flex items-center gap-2 rounded-full bg-bg/75 px-3 py-1.5 text-xs font-semibold backdrop-blur" data-testid="segment-ahead">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
        Fra {Math.round(next.from - e.distance)} m · {st.short} {next.seg.name}
      </p>
    );
  }
  return null;
}

/** La sessione: il conto alla rovescia in griglia, poi dov'è il gruppo. */
export function SessionHud({ game }: { game: RideGame }) {
  const def = game.sessionDef;
  if (!def) return null;
  const st = SESSION_STYLE[def.kind];
  if (game.stage === 'griglia') {
    const s = Math.ceil(game.countdown);
    return (
      <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/35" data-testid="session-grid">
        <div className="rounded-3xl bg-black/55 px-7 py-4 text-center backdrop-blur-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: st.color }}>
            {def.title}
          </p>
          <p className="num mt-1 font-display text-8xl leading-none text-white drop-shadow">{s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : s}</p>
          <p className="mt-2 text-sm text-white/85">Partenza alle {new Date(def.start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}. Tutti insieme.</p>
        </div>
      </div>
    );
  }
  const gap = game.packGap;
  if (gap == null) {
    return (
      <p className="pointer-events-none inline-flex items-center gap-2 rounded-full bg-bg/75 px-3 py-1.5 text-xs font-semibold backdrop-blur" data-testid="session-chip">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
        {def.title}
        {game.sessionRank ? ` · ${game.sessionRank}` : ''}
      </p>
    );
  }
  const inPack = Math.abs(gap) < 25;
  return (
    <p
      className={cn('pointer-events-none inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur', inPack ? 'bg-good/30 text-good' : 'bg-bg/75')}
      data-testid="session-chip"
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
      {inPack ? 'Nel gruppo' : gap > 0 ? `${Math.round(gap)} m davanti al gruppo` : `Gruppo a ${Math.round(-gap)} m`}
      <span className="num text-muted">· {Math.round(game.withPack * 100)}% col gruppo</span>
    </p>
  );
}

/** Il riepilogo del gioco: oro, traguardi presi, missioni, pezzi nuovi, tratti cronometrati. */
export function RewardsSummary({ outcome, results }: { outcome: CareerOutcome; results: SegmentResult[] }) {
  return (
    <section className="mt-4 flex flex-col gap-3" data-testid="rewards">
      {outcome.unlocked.length ? (
        <div className="rounded-3xl border border-accent bg-accent/10 p-4">
          <p className="eyebrow text-accent">{outcome.unlocked.length === 1 ? 'Traguardo preso' : `${outcome.unlocked.length} traguardi presi`}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {outcome.unlocked.map((a, i) => (
              <li key={a.id} className="pop-in flex items-center gap-3" style={{ animationDelay: `${i * 120}ms` }}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
                  <Glyph name={a.glyph} />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{a.name}</span>
                  <span className="block text-sm text-muted">{a.desc}</span>
                </span>
              </li>
            ))}
          </ul>
          {outcome.items.length ? (
            <p className="mt-3 text-sm">
              Nel garage:{' '}
              <Link to="/garage" className="font-semibold text-accent">
                {outcome.items.map((id) => ITEM_BY_ID.get(id)?.name ?? id).join(', ')}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      {results.length ? (
        <div className="rounded-3xl bg-elev p-4">
          <p className="eyebrow">Tratti cronometrati</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {results.map((r, i) => {
              const st = SEGMENT_STYLE[r.kind];
              return (
                <li key={`${r.id}-${i}`} className="flex items-center gap-2.5 text-sm">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: st.color, color: st.ink }}>
                    {st.short}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  {outcome.pbs.includes(r.id) ? <span className="text-xs font-semibold text-accent">record</span> : null}
                  <span className="num font-semibold">{clock(r.sec)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="rounded-3xl bg-elev p-4">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow">Oro</p>
          <p className="num inline-flex items-center gap-1.5 font-display text-3xl">
            <Coin size={22} />+{outcome.total}
          </p>
        </div>
        {outcome.lines.length === 0 ? <p className="mt-1 text-sm text-muted">Giro troppo corto per l’oro.</p> : null}
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {outcome.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-muted">{l.label}</span>
              <span className="num shrink-0">+{l.oro}</span>
            </li>
          ))}
        </ul>
        <p className="num mt-2 text-right text-xs text-muted">Saldo: {outcome.next.oro.toLocaleString('it-IT')}</p>
      </div>

      {outcome.missions.length ? (
        <p className="rounded-2xl bg-good/15 px-4 py-2.5 text-sm font-semibold text-good">
          Missioni di oggi completate: {outcome.missions.map((m) => m.title).join(' · ')}
        </p>
      ) : null}
    </section>
  );
}
