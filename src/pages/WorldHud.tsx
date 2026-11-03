import { useEffect, useMemo, useState } from 'react';
import { Button, Segmented } from '@/components/ui';
import { MiniMap } from '@/components/WorldMap';
import { gradeColor } from '@/components/RouteViz';
import { formatKm, formatNumber } from '@/domain/format';
import { RIDER_COLORS } from '@/multiplayer/protocol';
import type { RideEngine } from '@/sim/engine';
import { suggestLoops, type LoopSuggestion, type LoopTaste } from '@/open/loops';
import type { WorldSession } from '@/open/session';
import type { XpLine } from '@/open/progress';

/**
 * Le parti della schermata di pedalata che servono solo nel mondo aperto: la scelta agli
 * incroci, i luoghi che si incontrano, chi c'è intorno, la cartina, la scia, l'anello da qui.
 */

export function TurnPicker({ session, engine }: { session: WorldSession; engine: RideEngine }) {
  const j = session.junction;
  // tastiera: ← → spostano la scelta, ↑ torna alla più dritta (o al percorso)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const jj = session.junction;
      if (!jj) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        session.nudge(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        session.nudge(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const route = jj.options.findIndex((o) => o.onRoute);
        let best = 0;
        jj.options.forEach((o, i) => {
          if (Math.abs(o.turn) < Math.abs(jj.options[best].turn)) best = i;
        });
        session.choose(route >= 0 ? route : best);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);
  if (!j || j.dist > 220 || engine.phase === 'finished') return null;
  return (
    <div className="pointer-events-auto rounded-2xl bg-bg/80 p-1.5 backdrop-blur" data-testid="turn-picker" role="group" aria-label="Svolta al prossimo incrocio">
      <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Incrocio tra <span className="num text-ink">{Math.max(0, Math.round(j.dist))} m</span>
      </p>
      <div className="flex gap-1.5">
        {j.options.map((o, i) => {
          const sel = i === j.selected;
          return (
            <button
              key={`${o.edge}:${o.dir}`}
              type="button"
              onClick={() => session.choose(i)}
              aria-pressed={sel}
              data-testid={`turn-${i}`}
              className={`flex min-h-12 min-w-[64px] max-w-[132px] flex-col items-center justify-center rounded-xl px-2 py-1 text-center ${sel ? 'bg-accent text-accent-ink' : 'bg-elev2 text-ink'} ${o.onRoute && !sel ? 'ring-2 ring-accent' : ''}`}
            >
              <TurnIcon deg={o.turn} uTurn={o.uTurn} />
              <span className="mt-0.5 line-clamp-1 text-[11px] font-semibold leading-tight">{o.uTurn ? 'inversione' : o.toward ? `verso ${o.toward}` : turnWord(o.turn)}</span>
              <span className={`line-clamp-1 text-[10px] leading-tight ${sel ? 'text-accent-ink/75' : 'text-muted'}`}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function turnWord(deg: number): string {
  if (Math.abs(deg) < 25) return 'dritto';
  if (deg > 0) return deg > 120 ? 'tutta a sinistra' : 'sinistra';
  return deg < -120 ? 'tutta a destra' : 'destra';
}

function TurnIcon({ deg, uTurn }: { deg: number; uTurn: boolean }) {
  if (uTurn) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 20V9a4 4 0 0 1 8 0v6M13 12l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // freccia ruotata dell'angolo di svolta: positivo = sinistra
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-deg}deg)` }}>
      <path d="M12 20V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Toasts({ session }: { session: WorldSession }) {
  if (session.toasts.length === 0) return null;
  return (
    <div className="pointer-events-none flex flex-col items-center gap-1.5" aria-live="polite" data-testid="world-toasts">
      {session.toasts.map((t) => (
        <div key={t.id} className="max-w-[min(92vw,420px)] rounded-2xl bg-bg/85 px-3.5 py-2 text-center shadow-lg backdrop-blur">
          <p className="text-sm font-semibold leading-tight">
            {t.kind === 'luogo' ? <span className="text-accent">● </span> : null}
            {t.title}
          </p>
          <p className="text-xs leading-snug text-muted">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

export function Nearby({ session }: { session: WorldSession }) {
  const list = session.nearby(session.pose);
  if (list.length === 0) return null;
  return (
    <ul className="pointer-events-none flex flex-col gap-1" data-testid="world-nearby" aria-label="Chi c'è intorno">
      {list.slice(0, 4).map((r, i) => (
        <li key={i} className="flex items-center gap-1.5 rounded-full bg-bg/70 px-2.5 py-1 text-[11px] backdrop-blur">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.real ? RIDER_COLORS[(r.color ?? 0) % RIDER_COLORS.length] : '#9aa0a8' }} />
          <span className={`max-w-[96px] truncate ${r.real ? 'font-semibold' : 'text-muted'}`}>{r.name}</span>
          <span className="num font-semibold">
            {r.ahead >= 0 ? '+' : '−'}
            {Math.abs(Math.round(r.ahead))} m
          </span>
          <span className="num text-muted">{r.w} W</span>
        </li>
      ))}
    </ul>
  );
}

export function WorldMini({ session, size }: { session: WorldSession; size: number }) {
  const pose = useMemo(() => () => session.pose, [session]);
  const legs = useMemo(() => () => session.path.legs, [session]);
  const riders = useMemo(
    () => () => {
      const out: { x: number; z: number; color: string; real: boolean }[] = [];
      for (const n of session.crowd.npcs) if (n.active) out.push({ x: n.x, z: n.z, color: '#9aa0a8', real: false });
      for (const r of session.remoteNow.values()) out.push({ x: r.x, z: r.z, color: RIDER_COLORS[r.color % RIDER_COLORS.length], real: true });
      return out;
    },
    [session],
  );
  return <MiniMap data={session.data} pose={pose} legs={legs} riders={riders} size={size} />;
}

/** L'altimetria dei prossimi 3 km, colorata per pendenza: nel giro libero non si sa dove si arriva. */
export function AheadProfile({ session, engine }: { session: WorldSession; engine: RideEngine }) {
  const W = 1000;
  const H = 36;
  const span = 3000;
  const d0 = engine.distance;
  const pts: { d: number; y: number }[] = [];
  for (let i = 0; i <= 60; i++) {
    const d = d0 + (i / 60) * span;
    pts.push({ d: d - d0, y: session.path.poseAt(Math.min(session.path.length, d)).altitude });
  }
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(minY + 30, ...pts.map((p) => p.y));
  const y = (a: number) => H - 3 - ((a - minY) / (maxY - minY)) * (H - 8);
  const bars = [];
  for (let i = 0; i < 60; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const g = (b.y - a.y) / (b.d - a.d || 1);
    const x0 = (a.d / span) * W;
    const x1 = (b.d / span) * W;
    bars.push(<path key={i} d={`M${x0} ${H}L${x0} ${y(a.y)}L${x1} ${y(b.y)}L${x1} ${H}Z`} fill={gradeColor(g)} opacity={0.9} />);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-9 w-full" role="img" aria-label={`Prossimi 3 km: da ${Math.round(pts[0].y)} a ${Math.round(pts[60].y)} m`}>
      {bars}
    </svg>
  );
}

export function LoopSheet({ session, engine, onClose }: { session: WorldSession; engine: RideEngine; onClose: () => void }) {
  const [km, setKm] = useState(30);
  const [taste, setTaste] = useState<LoopTaste>('misto');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<LoopSuggestion[] | null>(null);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-3 md:items-center">
      <section className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-3xl bg-elev p-5" data-testid="loop-sheet">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-3xl">Un anello da qui</h2>
          <button type="button" className="h-10 rounded-full px-3 text-sm font-semibold" onClick={onClose}>
            Chiudi
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">Parte dal prossimo incrocio e torna lì. Mentre scegli, il mondo resta in pausa se lo metti in pausa tu.</p>
        <label className="mt-3 block">
          <span className="flex justify-between text-sm font-semibold">
            <span>Lunghezza</span>
            <span className="num">{km} km</span>
          </span>
          <input type="range" min={5} max={100} step={5} value={km} onChange={(e) => setKm(Number(e.target.value))} className="mt-1 h-8 w-full accent-[var(--accent)]" aria-label="Lunghezza in km" />
        </label>
        <div className="mt-2">
          <Segmented<LoopTaste>
            label="Strade"
            value={taste}
            onChange={setTaste}
            options={[
              { value: 'piatto', label: 'Pianeggiante' },
              { value: 'misto', label: 'Misto' },
              { value: 'salita', label: 'In salita' },
            ]}
          />
        </div>
        <Button
          className="mt-3 w-full"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setTimeout(() => {
              setList(suggestLoops(session.graph, session.nextNode(engine.distance), { targetM: km * 1000, taste, places: session.data.features.places }));
              setBusy(false);
            }, 30);
          }}
        >
          {busy ? 'Cerco…' : 'Cerca'}
        </Button>
        {list ? (
          <ul className="mt-3 flex flex-col gap-2">
            {list.length === 0 ? <li className="text-sm text-muted">Nessun anello di questa lunghezza da qui.</li> : null}
            {list.map((l, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="w-full rounded-2xl border border-line bg-bg/50 px-3.5 py-3 text-left"
                  onClick={() => {
                    session.followLegs(engine.distance, l.legs);
                    onClose();
                  }}
                >
                  <p className="font-semibold">{l.via.slice(0, 4).join(' · ') || `Anello ${i + 1}`}</p>
                  <p className="num text-sm text-muted">
                    {formatKm(l.lengthM)} km · D+ {formatNumber(l.gainM, 0)} m
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

export function XpSummary({ lines, total, level, rank, rankNote }: { lines: XpLine[]; total: number; level: { level: number; title: string; from: number; to: number; xp: number }; rank: string | null; rankNote?: string }) {
  const pct = Math.min(100, ((level.xp - level.from) / Math.max(1, level.to - level.from)) * 100);
  return (
    <div className="mt-4 rounded-3xl bg-elev p-4" data-testid="xp-summary">
      <div className="flex items-baseline justify-between">
        <p className="font-display text-2xl">+{formatNumber(total, 0)} XP</p>
        <p className="text-sm text-muted">
          livello {level.level} · {level.title}
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-elev2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex justify-between">
            <span className="text-muted">{l.label}</span>
            <span className="num font-semibold">+{l.xp}</span>
          </li>
        ))}
      </ul>
      {rank ? <p className="mt-3 text-sm font-semibold text-accent">{rank}</p> : null}
      {rankNote ? <p className="mt-1 text-xs text-muted">{rankNote}</p> : null}
    </div>
  );
}
