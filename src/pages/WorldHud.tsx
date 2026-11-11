import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Segmented } from '@/components/ui';
import { MiniMap, WorldMap, type MapMarker, type MapOverlay } from '@/components/WorldMap';
import { gradeColor, PositionDot, ProfileChart } from '@/components/RouteViz';
import type { Track } from '@/domain/track';
import { formatAltText, formatGainText, formatKm, formatKmText, formatNumber } from '@/domain/format';
import { RIDER_COLORS } from '@/multiplayer/protocol';
import type { RideEngine } from '@/sim/engine';
import { suggestLoops, type LoopSuggestion, type LoopTaste } from '@/open/loops';
import type { WorldSession } from '@/open/session';
import type { XpLine } from '@/open/progress';
import { weatherLabel } from '@/open/weather';
import { turnChoices } from '@/game/turns';

/**
 * Le parti della schermata di pedalata che servono solo nel mondo aperto: la scelta agli
 * incroci, i luoghi che si incontrano, chi c'è intorno, la cartina, la scia, l'anello da qui.
 */

/**
 * La scelta all'incrocio: al massimo tre frecce grandi, un nome per freccia (il paese, se no la
 * via, se no la direzione), e quella del percorso dice «Percorso». La scelta fatta ha il bordo
 * d'oro: il giallo pieno nella corsa resta solo alla velocità del simulatore.
 */
export function TurnPicker({ session, engine }: { session: WorldSession; engine: RideEngine }) {
  const j = session.junction;
  // tastiera: ← → spostano la scelta fra le frecce che si vedono, ↑ torna al percorso (o alla più dritta)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const jj = session.junction;
      if (!jj) return;
      const shown = turnChoices(jj.options, jj.selected);
      const at = Math.max(0, shown.findIndex((c) => c.selected));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const k = Math.min(shown.length - 1, Math.max(0, at + (e.key === 'ArrowLeft' ? -1 : 1)));
        session.choose(shown[k].index);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const straight = shown.reduce((b, c) => (Math.abs(c.turn) < Math.abs(b.turn) ? c : b), shown[0]);
        session.choose((shown.find((c) => c.onRoute) ?? straight).index);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);
  if (!j || j.dist > 220 || engine.phase === 'finished') return null;
  const choices = turnChoices(j.options, j.selected);
  return (
    <div className="pointer-events-auto w-full max-w-[23rem] rounded-2xl bg-bg/80 p-1.5 backdrop-blur-md" data-testid="turn-picker" role="group" aria-label="Svolta al prossimo incrocio">
      <p className="px-1.5 pb-1 text-[13px] font-semibold text-muted">
        {j.roundabout ? 'Rotatoria fra' : 'Incrocio fra'} <span className="num text-ink">{Math.max(0, Math.round(j.dist))} m</span>
      </p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
        {choices.map((c, k) => (
          <button
            key={c.index}
            type="button"
            onClick={() => session.choose(c.index)}
            aria-pressed={c.selected}
            data-testid={`turn-${k}`}
            data-route={c.onRoute ? 'yes' : undefined}
            className={`flex min-h-[4.75rem] min-w-0 flex-col items-center justify-start gap-1 rounded-xl px-1.5 py-1.5 text-center transition-colors duration-200 ${c.selected ? 'bg-accent/20 ring-2 ring-accent ring-inset' : 'bg-elev2/90'}`}
          >
            {c.exit ? (
              <span className="num font-display text-[28px] leading-none">
                {c.exit}ª<span className="ml-0.5 font-sans text-[11px] font-semibold">uscita</span>
              </span>
            ) : (
              <TurnIcon deg={c.turn} uTurn={c.uTurn} />
            )}
            <span lang="it" className={`w-full break-words text-[13px] font-semibold leading-tight [hyphens:auto] ${c.onRoute ? 'text-accent' : ''}`}>
              {c.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TurnIcon({ deg, uTurn }: { deg: number; uTurn: boolean }) {
  if (uTurn) {
    return (
      <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 20V9a4 4 0 0 1 8 0v6M13 12l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // freccia ruotata dell'angolo di svolta: positivo = sinistra
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-deg}deg)` }}>
      <path d="M12 20V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** L'ultimo avviso del mondo (un luogo, un paese, fuori percorso): uno alla volta, sotto il titolo. */
export function Toasts({ session }: { session: WorldSession }) {
  const t = session.toasts[session.toasts.length - 1];
  if (!t) return null;
  return (
    <div className="pointer-events-none flex flex-col items-start gap-1.5" aria-live="polite" data-testid="world-toasts">
      <div key={t.id} className="rise-in max-w-full rounded-2xl bg-bg/85 px-3 py-1.5 backdrop-blur-md">
        <p className="text-sm font-semibold leading-tight">
          {t.kind === 'luogo' ? <span className="text-accent">● </span> : null}
          {cap(t.title)}
        </p>
        {t.sub ? <p className="text-xs leading-snug text-muted">{cap(t.sub)}</p> : null}
      </div>
    </div>
  );
}

/** La prima lettera maiuscola: i testi che arrivano dai dati non sempre ce l'hanno. */
export function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function Nearby({ session }: { session: WorldSession }) {
  const list = session.nearby(session.pose);
  if (list.length === 0) return null;
  return (
    <ul className="pointer-events-none flex flex-col items-start gap-1" data-testid="world-nearby" aria-label="Chi c'è intorno">
      {list.slice(0, 4).map((r, i) => (
        <li key={i} className="flex items-center gap-1.5 rounded-full bg-bg/70 px-2.5 py-1 text-xs backdrop-blur-md">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.real ? RIDER_COLORS[(r.color ?? 0) % RIDER_COLORS.length] : '#9aa0a8' }} />
          <span className={`break-words ${r.real ? 'font-semibold' : 'text-muted'}`}>{cap(r.name)}</span>
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

export function WorldMini({ session, size, onOpen }: { session: WorldSession; size: number; onOpen?: () => void }) {
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
  const map = <MiniMap data={session.data} pose={pose} legs={legs} riders={riders} size={size} />;
  if (!onOpen) return map;
  return (
    <button type="button" onClick={onOpen} aria-label="Apri la carta: dove sei" data-testid="world-mini" className="pointer-events-auto relative block rounded-full">
      {map}
      <span aria-hidden="true" className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-bg/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">
        Carta
      </span>
    </button>
  );
}

/**
 * L'altimetria dei prossimi km, colorata per pendenza: nel giro libero non si sa dove si arriva.
 * Comincia un po' prima di dove sei, così il pallino si vede.
 */
export function AheadProfile({ session, engine, span = 3000, height = 36, className = 'h-9' }: { session: WorldSession; engine: RideEngine; span?: number; height?: number; className?: string }) {
  const W = 1000;
  const H = height;
  const d0 = engine.distance;
  const from = Math.max(0, d0 - span * 0.08);
  const pts: { d: number; y: number }[] = [];
  for (let i = 0; i <= 60; i++) {
    const d = from + (i / 60) * span;
    pts.push({ d: d - from, y: session.path.poseAt(Math.min(session.path.length, d)).altitude });
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
  const here = session.path.poseAt(Math.min(session.path.length, d0)).altitude;
  return (
    <div className={`relative w-full ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={`Prossimi ${Math.round(span / 1000)} km: da ${Math.round(here)} a ${Math.round(pts[60].y)} m`}>
        {bars}
      </svg>
      <PositionDot left={(d0 - from) / span} top={y(here) / H} />
    </div>
  );
}

/**
 * La carta grande, aperta toccando la cartina: dove sei nel mondo intero, il percorso, chi c'è
 * intorno, e sotto l'altimetria col pallino. La pedalata continua: la carta si aggiorna da sola.
 */
export function MapSheet({ session, engine, far, track, onClose }: { session: WorldSession; engine: RideEngine; far: Float32Array | null; track: Track | null; onClose: () => void }) {
  const [, setTick] = useState(0);
  const [focus, setFocus] = useState(() => around(session.pose, 1400));
  const [mapH, setMapH] = useState(() => mapHeight());
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const t = window.setInterval(() => setTick((n) => n + 1), 500);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onResize = () => setMapH(mapHeight());
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);
  const legs = session.planned ? session.plannedLegs : session.path.legs;
  const overlays = useMemo<MapOverlay[]>(() => [{ legs, color: '#ffc814', width: 5 }], [legs]);
  const p = session.pose;
  const markers: MapMarker[] = [];
  for (const n of session.crowd.npcs) if (n.active) markers.push({ x: n.x, z: n.z, color: '#9aa0a8', small: true });
  for (const r of session.remoteNow.values()) markers.push({ x: r.x, z: r.z, color: RIDER_COLORS[r.color % RIDER_COLORS.length], label: r.nick });
  markers.push({ x: p.x, z: p.z, color: '#ffc814', heading: p.heading, label: 'Tu' });
  const where = cap([session.placeName(), session.roadLabel(engine.distance), formatAltText(engine.altitude)].filter(Boolean).join(' · '));
  const left = session.onRoute && track ? Math.max(0, track.length - engine.distance) : null;
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Carta: dove sei" data-testid="map-sheet">
      <header className="flex items-center gap-2 px-3 pb-2 pt-[max(0.6rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Sei qui</p>
          <p className="break-words font-semibold leading-tight" data-testid="map-where">
            {where}
          </p>
        </div>
        <button ref={close} type="button" onClick={onClose} className="h-11 shrink-0 rounded-full bg-elev2 px-4 text-sm font-semibold" data-testid="map-close">
          Torna in strada
        </button>
      </header>
      <div className="relative px-3">
        <WorldMap data={session.data} far={far} overlays={overlays} markers={markers} focus={focus} height={mapH} />
        <button
          type="button"
          onClick={() => setFocus(around(session.pose, 1400))}
          className="absolute bottom-3 right-5 h-11 rounded-full bg-bg/85 px-3.5 text-sm font-semibold shadow backdrop-blur"
          data-testid="map-center"
        >
          Centra su di me
        </button>
      </div>
      <div className="mt-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <dl className="mb-2 grid grid-cols-3 gap-2 text-center">
          <SheetStat label="Fatti" value={`${formatKm(engine.odometer)} km`} />
          <SheetStat label={left != null ? 'All’arrivo' : 'Quota'} value={left != null ? `${formatKm(left)} km` : formatAltText(engine.altitude)} />
          <SheetStat label="Pendenza" value={`${engine.grade >= 0 ? '+' : '−'}${formatNumber(Math.abs(engine.grade * 100), 1)}%`} />
        </dl>
        <div className="rounded-xl bg-elev p-1.5">
          {session.onRoute && track ? (
            <ProfileChart key={session.path.version} track={track} className="block h-16 w-full" height={64} bin={Math.max(100, track.length / 80)} position={engine.distance} />
          ) : (
            <AheadProfile session={session} engine={engine} span={5000} height={64} className="h-16" />
          )}
        </div>
      </div>
    </div>
  );
}

function SheetStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-elev px-2 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="num font-semibold">{value}</dd>
    </div>
  );
}

function around(p: { x: number; z: number }, r: number) {
  return { x0: p.x - r, z0: p.z - r, x1: p.x + r, z1: p.z + r };
}

function mapHeight(): number {
  return Math.max(240, Math.round(window.innerHeight - 250));
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
                    {`${formatKmText(l.lengthM)} · ${formatGainText(l.gainM)}`}
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

/** I punti del giro, che fanno salire di livello (l'oro, che compra, è nel riquadro sopra). */
export function XpSummary({ lines, total, level, rank, rankNote }: { lines: XpLine[]; total: number; level: { level: number; title: string; from: number; to: number; xp: number }; rank: string | null; rankNote?: string }) {
  const pct = Math.min(100, ((level.xp - level.from) / Math.max(1, level.to - level.from)) * 100);
  return (
    <div className="rounded-3xl bg-elev p-4" data-testid="xp-summary">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="eyebrow">Punti</p>
        <p className="num font-display text-3xl">
          +{formatNumber(total, 0)} <span className="font-sans text-base font-semibold text-muted">punti</span>
        </p>
      </div>
      <p className="mt-0.5 text-sm text-muted">
        Livello {level.level} · {level.title}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-elev2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="text-muted">{cap(l.label)}</span>
            <span className="num shrink-0 font-semibold">+{l.xp}</span>
          </li>
        ))}
      </ul>
      {rank ? <p className="mt-3 text-sm font-semibold text-accent">{cap(rank)}</p> : null}
      {rankNote ? <p className="mt-1 text-xs text-muted">{cap(rankNote)}</p> : null}
    </div>
  );
}

/** Meteo vero in una riga: temperatura, tempo, e da dove arriva il vento rispetto a chi pedala. */
export function WeatherChip({ session, engine }: { session: WorldSession; engine: RideEngine }) {
  const w = session.weather;
  if (!w) return null;
  // freccia: dove va il vento rispetto alla strada davanti (su = a favore, giù = contro)
  const rel = w.windFrom + session.pose.heading;
  const kmh = Math.round(w.windMs * 3.6);
  const head = engine.wind;
  const text = w.windMs < 1.2 ? 'Aria ferma' : Math.abs(head) < 0.5 ? `Laterale ${kmh} km/h` : head > 0 ? `Contro ${kmh} km/h` : `A favore ${kmh} km/h`;
  return (
    <div className="flex flex-col items-end rounded-xl bg-bg/70 px-2.5 py-1 text-xs leading-tight backdrop-blur-md" data-testid="world-weather" aria-label={`Meteo: ${weatherLabel(w.code)}, vento ${text.toLowerCase()}`}>
      <p>
        <span className="num font-semibold">{Math.round(w.tempC)}°</span> <span className="text-muted">{cap(weatherLabel(w.code))}</span>
      </p>
      <p className="flex items-center gap-1">
        {w.windMs >= 1.2 ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" style={{ transform: `rotate(${rel}rad)` }} aria-hidden="true">
            <path d="M6 1 L10 7 H7.2 V11 H4.8 V7 H2 Z" fill={head > 0.5 ? 'var(--danger, #e5484d)' : head < -0.5 ? 'var(--good, #3fbf7f)' : 'currentColor'} />
          </svg>
        ) : null}
        <span className="font-semibold">{text}</span>
      </p>
    </div>
  );
}
