import { useEffect, useMemo, useState, type Ref } from 'react';
import { Button, Segmented } from '@/components/ui';
import { WorldMap, legsBounds, type MapMarker, type MapOverlay } from '@/components/WorldMap';
import { cap, formatAlt, formatAltText, formatDuration, formatGainText, formatKmText, formatNumber } from '@/domain/format';
import { rideClimbs, rideSense, SENSE_LABEL, siblingRide } from '@/game/passes';
import { worldInfo } from '@/open/worlds';
import type { BoardRow } from '@/multiplayer/world-protocol';
import type { Leg } from '@/open/graph';
import { CLS } from '@/open/graph';
import { suggestLoops, type LoopSuggestion, type LoopTaste } from '@/open/loops';
import { fetchLeaders, fetchRideBoard, type Leader, type WorldProgress } from '@/open/progress';
import { worldSegments } from '@/game/segments';
import { SEGMENT_STYLE } from '@/game/arches';
import { useGame } from '@/game/useGame';
import type { RideDef, WorldData } from '@/open/world';
import { kindLabel } from '@/open/labels';
import { planAB, type AbRoute } from '@/open/ab';
import { startTowns, townPoint } from '@/open/starts';

/** La riga delle fonti sotto il percorso (F.14): strade e quote; il confronto in rete solo dove qualcuno ha confrontato davvero. */
export const SOURCES_LINE = 'Strade OSM · Quote EU-DEM';
export const PENDENZE_URL = 'https://github.com/micmer-git/allenando/blob/main/docs/pendenze-2026-11.md';
/**
 * I percorsi la cui salita sta nella tabella di docs/pendenze-2026-11.md (pista M.5) con una scheda
 * climbfinder accanto. Fuori: Città Alta («non confrontabili») e la Maresana (solo bikeclimbs).
 */
export const CONFRONTATE = ['ganda', 'selvino', 'presolana', 'zambla-nossa', 'zambla-zogno', 'foppolo', 'san-marco', 'colle-gallo'] as const;
/**
 * La tabella c'è nel repo? Si decide alla build (`define` in vite.config.ts): finché la pista M non la
 * consegna, il link porterebbe a una pagina che non esiste, e la riga dice solo strade e quote.
 */
export const PENDENZE_PRONTE: boolean = typeof __PENDENZE_PRONTE__ === 'boolean' && __PENDENZE_PRONTE__;
export const isConfrontata = (rideId: string, pronte: boolean = PENDENZE_PRONTE): boolean => pronte && (CONFRONTATE as readonly string[]).includes(rideId);

export const ROUTE_COLORS = ['#ffc814', '#ff6b4a', '#4ab8ff', '#c8f031', '#c77dff', '#3ce0b0', '#ff5fa2'];

/*
 * I pezzi della vecchia pagina Mondo, ripresi come contenuto del foglio Dove di Pedala (piano U,
 * F3): la scheda di un percorso, il giro libero, «Crea un anello», A → B. Ognuno sceglie con
 * `onScegli` e non porta più alla corsa: il tasto pieno è «Via», in Pedala.
 */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dd className="font-semibold text-ink">{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function pctStr(g: number): string {
  return `${(g * 100).toFixed(1).replace('.', ',')}%`;
}

export function RideCard({ data, ride, progress, onClose, onRide, onPick, startRef }: { data: WorldData; ride: RideDef; progress: WorldProgress; onClose?: () => void; onRide?: () => void; onPick?: (id: string) => void; startRef?: Ref<HTMLDivElement> }) {
  // le salite del giro e il verso (F.3): dal profilo, una volta per percorso
  const climbs = useMemo(() => rideClimbs(data, ride), [data, ride]);
  const sense = useMemo(() => (ride.kind === 'giro' ? rideSense(data.graph, ride) : null), [data, ride]);
  const other = useMemo(() => siblingRide(data.graph, data.rides, ride), [data, ride]);
  const [board, setBoard] = useState<{ total: number; rows: BoardRow[]; mine: { rank: number; sec: number } | null } | null | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    setBoard('loading');
    void fetchRideBoard(ride.id, false).then((b) => alive && setBoard(b));
    return () => {
      alive = false;
    };
  }, [ride.id]);
  return (
    <section className="mt-3 rounded-3xl bg-elev p-4" data-testid="world-ride-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl leading-none">{ride.name}</h2>
          <p className="mt-1 text-sm text-muted">{cap(ride.side)}</p>
        </div>
        {onClose ? (
          <button type="button" className="h-11 rounded-full px-3 text-sm font-semibold text-muted" onClick={onClose}>
            Chiudi
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-[15px] leading-relaxed">{ride.blurb}</p>
      {sense ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="world-ride-sense" data-sense={sense}>
          <span className="rounded-full bg-elev2 px-2.5 py-1 font-semibold">{SENSE_LABEL[sense]}</span>
          {other && onPick ? (
            <button type="button" className="inline-flex h-11 items-center font-semibold text-accent" onClick={() => onPick(other.id)} data-testid="world-ride-other-sense">
              {`Anche ${SENSE_LABEL[sense === 'orario' ? 'antiorario' : 'orario'].toLowerCase()} →`}
            </button>
          ) : null}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <Stat label="Lunghezza" value={formatKmText(ride.lengthM)} />
        <Stat label="D+" value={formatAltText(ride.gainM)} />
        <Stat label="Quote" value={`${formatAlt(ride.startAlt)} → ${formatAltText(ride.maxAlt)}`} />
        <Stat label="Max 200 m" value={pctStr(ride.maxGrade)} />
      </dl>
      {onRide ? (
        <div ref={startRef} className="mt-3 scroll-mb-4">
          <Button className="w-full" onClick={onRide} data-testid="world-ride-start">
            Pedala {ride.name}
          </Button>
        </div>
      ) : null}
      {climbs.length ? (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">{climbs.length === 1 ? 'La salita' : 'Le salite del giro'}</h3>
          <ol className="mt-2 flex flex-col gap-1.5" data-testid="world-ride-climbs">
            {climbs.map((c, i) => (
              <li key={i} className="flex items-center gap-2.5 rounded-xl bg-bg/50 px-3 py-2" data-pass={c.passId ?? ''}>
                <span className="num w-14 shrink-0 text-xs font-semibold text-muted">{`Al km ${formatNumber(c.from / 1000, 1)}`}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.name}</span>
                  <span className="num block text-xs text-muted">{`${formatKmText(c.lengthM)} · ${formatGainText(c.gainM)} · Media ${pctStr(c.grade)} · In cima ${formatAltText(c.topAlt)}`}</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Da riconoscere lungo la strada</h3>
      <ol className="mt-2 flex flex-col gap-1.5">
        {ride.landmarks.map((l) => {
          const lm = data.features.landmarks.find((x) => x.id === l.id);
          if (!lm) return null;
          return (
            <li key={l.id} className="flex gap-2.5 rounded-xl bg-bg/50 px-3 py-2">
              <span className="num w-14 shrink-0 text-xs font-semibold text-muted">{`Al km ${formatNumber(l.at / 1000, 1)}`}</span>
              <span className="min-w-0">
                <span className="font-semibold">{lm.name}</span> <span className="text-xs text-muted">{cap(kindLabel(lm.kind))}</span>
                {progress.visited[lm.id] ? <span className="ml-1 text-xs font-semibold text-good">✓ Visto</span> : null}
                <span className="block text-[13px] leading-snug text-muted">{cap(lm.note)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <RideSegments data={data} ride={ride} />
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Classifica</h3>
      <BoardList board={board} />
      <p className="mt-4 text-xs leading-relaxed text-muted" data-testid="world-ride-sources" data-confronto={isConfrontata(ride.id) ? 'si' : 'no'}>
        {SOURCES_LINE}
        {isConfrontata(ride.id) ? (
          <>
            {' · '}
            <a href={PENDENZE_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-semibold text-accent">
              Confronto climbfinder
            </a>
          </>
        ) : null}
      </p>
    </section>
  );
}

/** I tratti cronometrati del percorso: volate, GPM e crono, col primo in classifica e il tuo record. */
function RideSegments({ data, ride }: { data: WorldData; ride: RideDef }) {
  const segs = worldSegments(data).byRide.get(ride.id) ?? [];
  const pbs = useGame((s) => s.career.pbs);
  const [leaders, setLeaders] = useState<Record<string, Leader> | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchLeaders(
      segs.map((s) => s.id),
      false,
    ).then((l) => alive && setLeaders(l));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride.id]);
  if (!segs.length) return null;
  return (
    <>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Tratti cronometrati</h3>
      <ul className="mt-2 flex flex-col gap-1.5" data-testid="world-ride-segments">
        {segs.map((s) => {
          const st = SEGMENT_STYLE[s.kind];
          const lead = leaders?.[s.id];
          return (
            <li key={s.id} className="flex items-center gap-2.5 rounded-xl bg-bg/50 px-3 py-2 text-sm">
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: st.color, color: st.ink }}>
                {st.short}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="num block text-xs text-muted">{`Dal km ${formatNumber(s.from / 1000, 1)} al km ${formatNumber(s.to / 1000, 1)}${lead ? ` · 1° ${lead.nick} ${formatDuration(lead.sec)}` : ''}`}</span>
              </span>
              {pbs[s.id] ? <span className="num shrink-0 text-xs font-semibold text-accent">{`Tu ${formatDuration(pbs[s.id].sec)}`}</span> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function BoardList({ board }:{ board: { total: number; rows: BoardRow[]; mine: { rank: number; sec: number } | null } | null | 'loading' }) {
  if (board === 'loading') return <p className="mt-2 text-sm text-muted">Carico la classifica…</p>;
  if (!board) return <p className="mt-2 text-sm text-muted">Classifica non raggiungibile: serve la rete.</p>;
  if (board.rows.length === 0) return <p className="mt-2 text-sm text-muted">Nessun tempo ancora. Il primo è tuo.</p>;
  return (
    <ol className="mt-2 flex flex-col gap-1" data-testid="world-board">
      {board.rows.slice(0, 10).map((r, i) => (
        <li key={i} className={`flex items-center justify-between rounded-xl px-3 py-1.5 text-sm ${r.me ? 'bg-accent/20 font-semibold' : 'bg-bg/50'}`}>
          <span className="flex items-center gap-2">
            <span className="num w-6 text-muted">{i + 1}</span>
            {r.nick}
          </span>
          <span className="num">
            {formatDuration(r.sec)} <span className="text-xs text-muted">{r.wkg ? `${formatNumber(r.wkg, 1)}\u00a0W/kg` : ''}</span>
          </span>
        </li>
      ))}
      {board.mine ? (
        <li className="flex items-center justify-between rounded-xl bg-accent/20 px-3 py-1.5 text-sm font-semibold">
          <span>{`Tu: ${board.mine.rank}° su ${board.total}`}</span>
          <span className="num">{formatDuration(board.mine.sec)}</span>
        </li>
      ) : null}
    </ol>
  );
}

const startPoint = townPoint;

/** Il punto di partenza scelto del giro libero. */
export interface PuntoLibero {
  edge: number;
  s: number;
  dir: 1 | -1;
  paese: string;
}

/** Il giro libero: un paese o un punto sulla carta. Un tocco su un paese sceglie e chiude. */
export function FreeTab({ data, far, onScegli }: { data: WorldData; far: Float32Array | null; onScegli: (p: PuntoLibero) => void }) {
  const [point, setPoint] = useState<{ x: number; z: number; label: string } | null>(null);
  const starts = useMemo(() => startTowns(data).map((n) => ({ name: n, p: startPoint(data, n) })).filter((s) => s.p), [data]);
  function go(x: number, z: number, label: string, town = false) {
    // una strada vera, non l'anellino di una pista attorno a un'aiuola (a Nembro girava a vuoto)
    const hit = data.graph.freeStart(x, z, 400, town);
    if (!hit) return;
    const e = data.graph.edges[hit.edge];
    onScegli({ edge: hit.edge, s: Math.round(Math.min(e.length - 1, hit.s)), dir: data.graph.allowed(hit.edge, 1) ? 1 : -1, paese: label });
  }
  return (
    <section className="mt-3" data-testid="dove-libero-vista">
      <WorldMap
        data={data}
        far={far}
        height={240}
        markers={point ? [{ x: point.x, z: point.z, color: '#ffc814', label: point.label, ring: true }] : []}
        onPick={(x, z) => {
          const hit = data.graph.freeStart(x, z, 600);
          if (!hit) return;
          const p = data.graph.pose(hit.edge, hit.s);
          const e = data.graph.edges[hit.edge];
          setPoint({ x: p.x, z: p.z, label: e.name || e.ref || 'Qui' });
        }}
      />
      {point ? (
        <button type="button" className="mt-3 flex h-12 w-full items-center justify-between rounded-2xl border border-accent/60 px-4 font-semibold" onClick={() => go(point.x, point.z, point.label)} data-testid="world-free-start">
          {`Parti da ${point.label}`}
          <span aria-hidden="true">›</span>
        </button>
      ) : null}
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {starts.map((s) => (
          <li key={s.name}>
            <button type="button" className="h-12 w-full rounded-2xl border border-line bg-elev2/50 px-3 text-left text-sm font-semibold" onClick={() => go(s.p!.x, s.p!.z, s.name, true)} data-testid={`dove-paese-${s.name}`}>
              {s.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Velocità media in piano a quei watt, per tradurre i minuti di un allenamento in km di anello. */
export function kmPerMinuti(minuti: number, watt: number, taste: LoopTaste): number {
  // P = v·(Crr·m·g + ½·ρ·CdA·v²): con 85 kg, Crr 0,004, CdA 0,32 si risolve per bisezione
  let lo = 1;
  let hi = 20;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2;
    const p = v * (0.004 * 85 * 9.81 + 0.5 * 1.225 * 0.32 * v * v);
    if (p > watt) hi = v;
    else lo = v;
  }
  const lento = taste === 'salita' ? 0.62 : taste === 'misto' ? 0.8 : 0.95;
  return Math.min(120, Math.max(10, Math.round((lo * 3.6 * lento * minuti) / 60 / 5) * 5));
}

/**
 * «Crea un anello» (wireframe D2): partenza, lunghezza − +, strade, «Cerca». Con un allenamento
 * scelto la lunghezza diventa «Per 54 min» e si calcola da sé. Toccare una proposta la sceglie.
 */
export function LoopTab({ data, far, onScegli, minuti, watt = 160 }: { data: WorldData; far: Float32Array | null; onScegli: (legs: Leg[], name: string, partenza: string) => void; minuti?: number; watt?: number }) {
  const starts = useMemo(() => startTowns(data).map((n) => ({ name: n, p: startPoint(data, n) })).filter((s) => s.p), [data]);
  const [start, setStart] = useState(() => starts[0]?.name ?? '');
  const [taste, setTaste] = useState<LoopTaste>('misto');
  const [kmScelti, setKm] = useState(20);
  const km = minuti ? kmPerMinuti(minuti, watt, taste) : kmScelti;
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<LoopSuggestion[] | null>(null);
  function compute() {
    const p = startPoint(data, start);
    if (!p) return;
    const node = data.graph.nearestNode(p.x, p.z, 600, (e) => e.cls !== CLS.trunk && e.cls !== CLS.pedestrian);
    if (node == null) return;
    setBusy(true);
    setList(null);
    // lascia disegnare il «sto cercando» prima del calcolo
    setTimeout(() => {
      setList(suggestLoops(data.graph, node, { targetM: km * 1000, taste, places: data.features.places }));
      setBusy(false);
    }, 30);
  }
  const overlays = useMemo<MapOverlay[]>(() => (list ?? []).map((l, i) => ({ legs: l.legs, color: ROUTE_COLORS[i], width: i === 0 ? 5 : 3 })), [list]);
  const focus = useMemo(() => (list && list[0] ? legsBounds(data, list[0].legs) : null), [data, list]);
  const sq = 'grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-xl font-semibold disabled:opacity-40';
  return (
    <section className="mt-3" data-testid="dove-anello-vista">
      <label className="flex min-h-12 items-center justify-between gap-3">
        <span className="font-semibold">Partenza</span>
        <select className="h-11 max-w-[60%] rounded-full border border-line bg-elev px-3 text-[15px] font-semibold" value={start} onChange={(e) => setStart(e.target.value)} data-testid="anello-partenza">
          {starts.map((s) => (
            <option key={s.name}>{s.name}</option>
          ))}
        </select>
      </label>
      <div className="flex min-h-12 items-center justify-between gap-3">
        <span className="font-semibold">{minuti ? `Per ${Math.round(minuti)} min` : 'Lunghezza'}</span>
        <span className="flex items-center gap-2">
          {minuti ? (
            <b className="num">{`≈ ${km} km`}</b>
          ) : (
            <>
              <button type="button" className={sq} aria-label="Più corto" disabled={km <= 10} onClick={() => setKm((k) => Math.max(10, k - 5))}>
                −
              </button>
              <b className="num w-16 text-center">{`${km} km`}</b>
              <button type="button" className={sq} aria-label="Più lungo" disabled={km >= 120} onClick={() => setKm((k) => Math.min(120, k + 5))}>
                +
              </button>
            </>
          )}
        </span>
      </div>
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
      <Button className="mt-3 h-14 w-full text-[17px]" onClick={compute} disabled={busy} data-testid="world-loop-compute">
        {busy ? 'Cerco' : 'Cerca'}
      </Button>
      {list ? (
        <div className="mt-3">
          <WorldMap data={data} far={far} overlays={overlays} focus={focus} height={200} />
          {list.length === 0 ? <p className="mt-3 text-sm text-muted">Nessun anello di questa lunghezza da qui.</p> : null}
          <ul className="mt-2 flex flex-col" data-testid="anello-proposte">
            {list.map((l, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-line py-2 text-left"
                  onClick={() => onScegli(l.legs, `Anello da ${start}`, start)}
                  data-testid={`world-loop-${i}`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-semibold">
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: ROUTE_COLORS[i] }} />
                      {l.via.slice(0, 3).join(' · ') || `Anello ${i + 1}`}
                    </span>
                    <span className="num block text-sm text-muted">{`${Math.round(l.overlap * 100)} % di strada ripetuta`}</span>
                  </span>
                  <span className="num shrink-0 text-right text-sm text-muted">
                    {formatKmText(l.lengthM)}
                    <br />
                    {formatGainText(l.gainM)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

type AbPoint = { x: number; z: number; label: string };

/** A → B: due paesi o due punti sulla carta, e ritorno. Un tocco sul percorso trovato lo mette in Dove. */
export function AbTab({ data, far, onScegli }: { data: WorldData; far: Float32Array | null; onScegli: (legs: Leg[], name: string, partenza: string) => void }) {
  const starts = useMemo(() => startTowns(data).map((n) => ({ name: n, p: startPoint(data, n) })).filter((s) => s.p), [data]);
  const fromName = (n: string): AbPoint | null => {
    const p = startPoint(data, n);
    return p ? { x: p.x, z: p.z, label: n } : null;
  };
  const ends = worldInfo(data.graph.id);
  const [a, setA] = useState<AbPoint | null>(() => fromName(ends.home));
  const [b, setB] = useState<AbPoint | null>(() => fromName(ends.away));
  const [picking, setPicking] = useState<'a' | 'b'>('b');
  const [back, setBack] = useState(true);
  const [cycle, setCycle] = useState(false);
  const [route, setRoute] = useState<AbRoute | null | 'none'>(null);
  useEffect(() => {
    if (!a || !b) {
      setRoute(null);
      return;
    }
    // il calcolo su 28 mila archi prende qualche decimo: si lascia prima disegnare
    const id = window.setTimeout(() => setRoute(planAB(data.graph, data.features.places, a, b, { back, prefs: { preferCycleways: cycle } }) ?? 'none'), 30);
    return () => window.clearTimeout(id);
  }, [data, a, b, back, cycle]);
  const real = route && route !== 'none' ? route : null;
  const overlays = useMemo<MapOverlay[]>(() => (real ? [{ legs: real.legs, color: '#ffc814', width: 5 }] : []), [real]);
  const focus = useMemo(() => (real ? legsBounds(data, real.legs) : null), [data, real]);
  const markers = useMemo<MapMarker[]>(
    () => [...(a ? [{ x: a.x, z: a.z, color: '#5fe0a8', label: `A · ${a.label}`, ring: true }] : []), ...(b ? [{ x: b.x, z: b.z, color: '#ff6464', label: `B · ${b.label}`, ring: true }] : [])],
    [a, b],
  );
  const select = (value: string, set: (p: AbPoint | null) => void) => set(fromName(value));
  return (
    <section className="mt-3" data-testid="dove-ab-vista">
      <div className="grid grid-cols-2 gap-2">
        {(['a', 'b'] as const).map((k) => {
          const cur = k === 'a' ? a : b;
          return (
            <label key={k} className="block text-sm font-semibold">
              {k === 'a' ? 'Da' : 'A'}
              <select
                className="mt-1 h-12 w-full rounded-2xl border border-line bg-elev px-3 text-[15px]"
                value={starts.some((s) => s.name === cur?.label) ? cur?.label : ''}
                onChange={(e) => select(e.target.value, k === 'a' ? setA : setB)}
                data-testid={`world-ab-${k}`}
              >
                <option value="" disabled>
                  {cur ? cur.label : 'Scegli'}
                </option>
                {starts.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <div className="mt-3">
        <Segmented<'a' | 'b'>
          label="Toccando la carta scegli"
          value={picking}
          onChange={setPicking}
          options={[
            { value: 'a', label: 'Tocca la partenza' },
            { value: 'b', label: 'Tocca l’arrivo' },
          ]}
        />
      </div>
      <div className="mt-3">
        <WorldMap
          data={data}
          far={far}
          height={240}
          overlays={overlays}
          focus={focus}
          markers={markers}
          onPick={(x, z) => {
            const hit = data.graph.nearest(x, z, 600, (e) => e.cls !== CLS.trunk);
            if (!hit) return;
            const p = data.graph.pose(hit.edge, hit.s);
            const e = data.graph.edges[hit.edge];
            const pt = { x: p.x, z: p.z, label: e.name || e.ref || 'Punto sulla carta' };
            if (picking === 'a') {
              setA(pt);
              setPicking('b');
            } else setB(pt);
          }}
        />
      </div>
      <label className="mt-2 flex min-h-11 items-center justify-between gap-3 text-sm">
        <span className="font-semibold">E ritorno, per un’altra strada</span>
        <input type="checkbox" className="h-6 w-6 accent-[var(--accent)]" checked={back} onChange={(e) => setBack(e.target.checked)} data-testid="world-ab-back" />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        <span className="font-semibold">Preferisci le ciclabili</span>
        <input type="checkbox" className="h-6 w-6 accent-[var(--accent)]" checked={cycle} onChange={(e) => setCycle(e.target.checked)} />
      </label>
      {route === 'none' ? <p className="mt-2 text-sm text-warn">Fra questi due punti non c’è una strada pedalabile.</p> : null}
      {real ? (
        <button
          type="button"
          className="mt-2 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-accent/60 px-4 py-2 text-left"
          onClick={() => onScegli(real.legs, `${a?.label} → ${b?.label}${back ? ' e ritorno' : ''}`, a?.label ?? '')}
          data-testid="world-ab-ride"
        >
          <span className="min-w-0">
            <span className="block font-semibold">{real.via.slice(0, 4).join(' · ') || `${a?.label} → ${b?.label}`}</span>
            <span className="num block text-sm text-muted">{`${formatKmText(real.lengthM)} · ${formatGainText(real.gainM)}`}</span>
          </span>
          <span aria-hidden="true" className="text-lg">
            ›
          </span>
        </button>
      ) : null}
    </section>
  );
}
