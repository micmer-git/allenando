import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, PageHeader, Segmented } from '@/components/ui';
import { WorldMap, legsBounds, type MapMarker, type MapOverlay } from '@/components/WorldMap';
import { cap, formatAlt, formatAltText, formatDuration, formatGainText, formatKmText, formatNumber } from '@/domain/format';
import { OfflineCard, useWorldManifests, WorldChooser } from '@/components/WorldPicker';
import { rideClimbs, rideSense, SENSE_LABEL, siblingRide } from '@/game/passes';
import { rememberWorld, worldFromParams, worldInfo } from '@/open/worlds';
import { worldCount } from '@/multiplayer/world-client';
import type { BoardRow, XpRow } from '@/multiplayer/world-protocol';
import type { Leg } from '@/open/graph';
import { CLS } from '@/open/graph';
import { suggestLoops, type LoopSuggestion, type LoopTaste } from '@/open/loops';
import { EMPTY_PROGRESS, fetchLeaders, fetchRideBoard, fetchXpBoard, levelOf, loadProgress, type Leader, type WorldProgress } from '@/open/progress';
import { worldSegments } from '@/game/segments';
import { SEGMENT_STYLE } from '@/game/arches';
import { useGame } from '@/game/useGame';
import { Terrain, loadWorld, type RideDef, type WorldData } from '@/open/world';
import { kindLabel } from '@/open/labels';
import { savePlan } from '@/open/plan';
import { planAB, type AbRoute } from '@/open/ab';
import { pickRoute } from '@/open/pick';
import { freeQueryAt, startTowns, townPoint } from '@/open/starts';

/** Le zone dei percorsi di un mondo, nell'ordine del catalogo; una zona nuova dei dati va in coda col suo nome. */
function areasOf(worldId: string, rides: RideDef[]): { id: string; label: string }[] {
  const known = worldInfo(worldId).areas;
  const out = Object.entries(known).map(([id, label]) => ({ id, label }));
  for (const r of rides) if (!out.some((a) => a.id === r.area)) out.push({ id: r.area, label: cap(r.area) });
  return out;
}

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

type Tab = 'percorsi' | 'libero' | 'anello' | 'ab' | 'classifiche';
const TABS: { value: Tab; label: string }[] = [
  { value: 'percorsi', label: 'Percorsi' },
  { value: 'libero', label: 'Libero' },
  { value: 'anello', label: 'Anello' },
  { value: 'ab', label: 'A → B' },
  { value: 'classifiche', label: 'Classifica' },
];

const ROUTE_COLORS = ['#ffc814', '#ff6b4a', '#4ab8ff', '#c8f031', '#c77dff', '#3ce0b0', '#ff5fa2'];

export function WorldPage() {
  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [far, setFar] = useState<Float32Array | null>(null);
  const [progress, setProgress] = useState<WorldProgress>(EMPTY_PROGRESS);
  const [online, setOnline] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.value === params.get('tab')) ? (params.get('tab') as Tab) : 'percorsi'));
  const [picked, setPicked] = useState<string | null>(null);
  // il mondo: dall'indirizzo (?world=) o l'ultimo usato; la scelta si ricorda (F.1)
  const worldId = worldFromParams(params);
  const manifests = useWorldManifests();
  const info = worldInfo(worldId);
  const chooseWorld = (id: string) => {
    if (id === worldId) return;
    // niente rememberWorld qui: lo fa il caricamento riuscito, così un mondo che non c'è non si ricorda (R6)
    setPicked(null);
    const next = new URLSearchParams(params);
    next.set('world', id);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    setFar(null);
    loadWorld(worldId)
      .then((d) => {
        if (!alive) return;
        // si ricorda solo un mondo che si è caricato davvero (R6)
        rememberWorld(worldId);
        setData(d);
        const t = new Terrain(d.graph);
        void t.loadFar().then((h) => alive && setFar(h));
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Mondo non disponibile'));
    void worldCount(worldId).then((n) => alive && setOnline(n));
    return () => {
      alive = false;
    };
  }, [worldId]);
  useEffect(() => {
    let alive = true;
    void loadProgress().then((p) => alive && setProgress(p));
    return () => {
      alive = false;
    };
  }, []);

  const head = (
    <>
      <PageHeader
        eyebrow="Mondo aperto"
        title={info.name}
        size="md"
        aside={
          data ? (
            <p className="num text-right text-sm leading-snug text-muted">
              {online != null && online > 0 ? (
                <span className="block font-semibold text-good" data-testid="world-online">{`In strada ora: ${online}`}</span>
              ) : null}
              <span className="block" data-testid="world-places">{`Luoghi ${Object.keys(progress.visited).length}/${data.features.landmarks.length}`}</span>
            </p>
          ) : undefined
        }
      />
      <div className="mt-3">
        <WorldChooser value={worldId} onChange={chooseWorld} manifests={manifests} />
        <OfflineCard id={worldId} manifest={manifests[worldId]} />
      </div>
    </>
  );
  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="world-page">
        {head}
        <p className="mt-4 text-danger" data-testid="world-error">
          {manifests[worldId] === null ? `${info.name} non è ancora costruito: scegli un altro mondo.` : cap(error)}
        </p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10">
        {head}
        <p className="mt-3 text-muted">{`Carico le strade: ${info.blurb}…`}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="world-page" data-world={worldId}>
      {head}
      <div className="mt-4">
        <Segmented<Tab> label="Sezione" value={tab} onChange={setTab} options={TABS} testId="world-tabs" />
      </div>
      {tab === 'percorsi' ? <RidesTab data={data} far={far} progress={progress} picked={picked} setPicked={setPicked} /> : null}
      {tab === 'libero' ? <FreeTab data={data} far={far} /> : null}
      {tab === 'anello' ? <LoopTab data={data} far={far} /> : null}
      {tab === 'ab' ? <AbTab data={data} far={far} /> : null}
      {tab === 'classifiche' ? <BoardsTab /> : null}
      <p className="mt-8 text-xs leading-relaxed text-muted">{`© OpenStreetMap contributors (ODbL), dati del ${data.graph.builtAt} · Quote EU-DEM © Copernicus.`}</p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dd className="font-semibold text-ink">{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function RidesTab({ data, far, progress, picked, setPicked }: { data: WorldData; far: Float32Array | null; progress: WorldProgress; picked: string | null; setPicked: (id: string | null) => void }) {
  const navigate = useNavigate();
  const sel = data.rides.find((r) => r.id === picked) ?? null;
  const cardStart = useRef<HTMLDivElement>(null);
  const [fromMap, setFromMap] = useState(0);
  const overlays = useMemo<MapOverlay[]>(() => {
    if (!sel) return data.rides.map((r, i) => ({ legs: r.legs.map(([edge, dir]) => ({ edge, dir })), color: ROUTE_COLORS[i % ROUTE_COLORS.length], width: 3 }));
    // gli altri percorsi restano, sottili e grigi, per poterli toccare; sopra quello scelto e i suoi tratti
    const segs = worldSegments(data).anchors.filter((a) => a.rideId === sel.id);
    return [
      ...data.rides.filter((r) => r.id !== sel.id).map((r) => ({ legs: r.legs.map(([edge, dir]) => ({ edge, dir })), color: 'rgba(58,62,70,0.55)', width: 2 })),
      { legs: sel.legs.map(([edge, dir]) => ({ edge, dir })), color: '#ffc814', width: 6 },
      ...segs.map((a) => ({ legs: a.legs, color: SEGMENT_STYLE[a.seg.kind].color, width: 8 })),
    ];
  }, [data, sel]);
  // scelto dalla carta: si porta in vista il pulsante «Pedala», senza perdere la carta
  useEffect(() => {
    if (fromMap) cardStart.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [fromMap]);
  const focus = useMemo(() => (sel ? legsBounds(data, sel.legs.map(([edge, dir]) => ({ edge, dir }))) : null), [data, sel]);
  const markers = useMemo<MapMarker[]>(() => {
    if (!sel) return [];
    const out: MapMarker[] = [];
    // partenza e arrivo del percorso scelto, col nome
    const legs = sel.legs.map(([edge, dir]) => ({ edge, dir }));
    const a = legs[0];
    const b = legs[legs.length - 1];
    const ea = data.graph.edges[a.edge];
    const eb = data.graph.edges[b.edge];
    const ia = a.dir > 0 ? 0 : ea.xs.length - 1;
    const ib = b.dir > 0 ? eb.xs.length - 1 : 0;
    out.push({ x: ea.xs[ia], z: ea.zs[ia], color: '#ffc814', label: 'Partenza', ring: true });
    if (Math.hypot(eb.xs[ib] - ea.xs[ia], eb.zs[ib] - ea.zs[ia]) > 300) out.push({ x: eb.xs[ib], z: eb.zs[ib], color: '#16130a', label: 'Arrivo' });
    for (const l of sel.landmarks) {
      const lm = data.features.landmarks.find((x) => x.id === l.id);
      if (lm) out.push({ x: lm.x, z: lm.z, color: progress.visited[lm.id] ? '#ffc814' : '#ffffff', label: lm.name });
    }
    return out;
  }, [data, sel, progress]);
  return (
    <section className="mt-4">
      <WorldMap
        data={data}
        far={far}
        overlays={overlays}
        markers={markers}
        focus={focus}
        height={340}
        onPick={(x, z, mpp) => {
          const r = pickRoute(data.graph, data.rides, x, z, mpp);
          if (!r) return;
          setPicked(r.id);
          setFromMap((n) => n + 1);
        }}
      />
      {sel ? <RideCard data={data} ride={sel} progress={progress} startRef={cardStart} onClose={() => setPicked(null)} onRide={() => navigate(`/ride?world=${encodeURIComponent(data.graph.id)}&ride=${sel.id}`)} onPick={setPicked} /> : null}
      {areasOf(data.graph.id, data.rides).map((a) => {
        const list = data.rides.filter((r) => r.area === a.id);
        if (list.length === 0) return null;
        return (
          <div key={a.id} className="mt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{a.label}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {list.map((r) => {
                const rec = progress.rides[r.id];
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`w-full rounded-2xl border px-3.5 py-3 text-left ${picked === r.id ? 'border-accent bg-elev2' : 'border-line bg-elev'}`}
                      onClick={() => setPicked(picked === r.id ? null : r.id)}
                      data-testid={`world-ride-${r.id}`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0">
                          <span className="block font-display text-xl leading-tight" data-testid="world-ride-name">
                            {r.name}
                          </span>
                          <span className="block text-sm font-medium text-muted" data-testid="world-ride-side">
                            {cap(r.side)}
                          </span>
                        </p>
                        {rec?.bestSec != null ? <span className="num shrink-0 text-xs font-semibold text-good">{formatDuration(rec.bestSec)}</span> : null}
                      </div>
                      <p className="num mt-0.5 text-sm text-muted">
                        {`${formatKmText(r.lengthM)} · ${formatGainText(r.gainM)} · ${r.kind === 'salita' ? `Media ${pctStr(r.climbGrade)}` : `Fino a ${formatAltText(r.maxAlt)}`} · ${r.landmarks.length} luoghi`}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function pctStr(g: number): string {
  return `${(g * 100).toFixed(1).replace('.', ',')}%`;
}

function RideCard({ data, ride, progress, onClose, onRide, onPick, startRef }: { data: WorldData; ride: RideDef; progress: WorldProgress; onClose: () => void; onRide: () => void; onPick?: (id: string) => void; startRef?: Ref<HTMLDivElement> }) {
  const [sim, setSim] = useState(false);
  // le salite del giro e il verso (F.3): dal profilo, una volta per percorso
  const climbs = useMemo(() => rideClimbs(data, ride), [data, ride]);
  const sense = useMemo(() => (ride.kind === 'giro' ? rideSense(data.graph, ride) : null), [data, ride]);
  const other = useMemo(() => siblingRide(data.graph, data.rides, ride), [data, ride]);
  const [board, setBoard] = useState<{ total: number; rows: BoardRow[]; mine: { rank: number; sec: number } | null } | null | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    setBoard('loading');
    void fetchRideBoard(ride.id, sim).then((b) => alive && setBoard(b));
    return () => {
      alive = false;
    };
  }, [ride.id, sim]);
  return (
    <section className="mt-3 rounded-3xl bg-elev p-4" data-testid="world-ride-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl leading-none">{ride.name}</h2>
          <p className="mt-1 text-sm text-muted">{cap(ride.side)}</p>
        </div>
        <button type="button" className="h-11 rounded-full px-3 text-sm font-semibold text-muted" onClick={onClose}>
          Chiudi
        </button>
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
      <div ref={startRef} className="mt-3 scroll-mb-4">
        <Button className="w-full" onClick={onRide} data-testid="world-ride-start">
          Pedala {ride.name}
        </Button>
      </div>
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
      <div className="mt-4 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Classifica</h3>
        <div className="w-52">
          <Segmented<'rullo' | 'sim'>
            label="Tipo di tempo"
            value={sim ? 'sim' : 'rullo'}
            onChange={(v) => setSim(v === 'sim')}
            options={[
              { value: 'rullo', label: 'Rullo' },
              { value: 'sim', label: 'Simulatore' },
            ]}
          />
        </div>
      </div>
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

function FreeTab({ data, far }: { data: WorldData; far: Float32Array | null }) {
  const navigate = useNavigate();
  const [point, setPoint] = useState<{ x: number; z: number; label: string } | null>(null);
  const starts = useMemo(() => startTowns(data).map((n) => ({ name: n, p: startPoint(data, n) })).filter((s) => s.p), [data]);
  function go(x: number, z: number, town = false) {
    // una strada vera, non l'anellino di una pista attorno a un'aiuola (a Nembro girava a vuoto)
    const q = freeQueryAt(data, x, z, town);
    if (q) navigate(`/ride?${q}`);
  }
  return (
    <section className="mt-4">
      <div>
        <WorldMap
          data={data}
          far={far}
          height={320}
          markers={point ? [{ x: point.x, z: point.z, color: '#ffc814', label: point.label, ring: true }] : []}
          onPick={(x, z) => {
            const hit = data.graph.freeStart(x, z, 600);
            if (!hit) return;
            const p = data.graph.pose(hit.edge, hit.s);
            const e = data.graph.edges[hit.edge];
            setPoint({ x: p.x, z: p.z, label: e.name || e.ref || 'Qui' });
          }}
        />
      </div>
      {point ? (
        <Button className="mt-3 w-full" onClick={() => go(point.x, point.z)} data-testid="world-free-start">
          Parti da {point.label}
        </Button>
      ) : null}
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {starts.map((s) => (
          <li key={s.name}>
            <button type="button" className="h-12 w-full rounded-2xl border border-line bg-elev px-3 text-left text-sm font-semibold" onClick={() => go(s.p!.x, s.p!.z, true)}>
              {s.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LoopTab({ data, far }: { data: WorldData; far: Float32Array | null }) {
  const navigate = useNavigate();
  const starts = useMemo(() => startTowns(data).map((n) => ({ name: n, p: startPoint(data, n) })).filter((s) => s.p), [data]);
  const [start, setStart] = useState(() => starts[0]?.name ?? '');
  const [km, setKm] = useState(40);
  const [taste, setTaste] = useState<LoopTaste>('misto');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<LoopSuggestion[] | null>(null);
  const [chosen, setChosen] = useState(0);
  function compute() {
    const p = startPoint(data, start);
    if (!p) return;
    const node = data.graph.nearestNode(p.x, p.z, 600, (e) => e.cls !== CLS.trunk && e.cls !== CLS.pedestrian);
    if (node == null) return;
    setBusy(true);
    setList(null);
    // lascia disegnare il «sto cercando» prima del calcolo
    setTimeout(() => {
      const out = suggestLoops(data.graph, node, { targetM: km * 1000, taste, places: data.features.places });
      setList(out);
      setChosen(0);
      setBusy(false);
    }, 30);
  }
  const overlays = useMemo<MapOverlay[]>(() => (list ?? []).map((l, i) => ({ legs: l.legs, color: ROUTE_COLORS[i], width: i === chosen ? 5 : 2.5, dashed: i !== chosen })), [list, chosen]);
  const focus = useMemo(() => (list && list[chosen] ? legsBounds(data, list[chosen].legs) : null), [data, list, chosen]);
  function ride(legs: Leg[], name: string) {
    const key = savePlan({ legs, name });
    navigate(`/ride?world=${encodeURIComponent(data.graph.id)}&plan=${key}`);
  }
  return (
    <section className="mt-4">
      <label className="block text-sm font-semibold">
        Partenza
        <select className="mt-1 h-12 w-full rounded-2xl border border-line bg-elev px-3 text-[15px]" value={start} onChange={(e) => setStart(e.target.value)}>
          {starts.map((s) => (
            <option key={s.name}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="mt-3 block">
        <span className="flex justify-between text-sm font-semibold">
          <span>Lunghezza</span>
          <span className="num">{km} km</span>
        </span>
        <input type="range" min={10} max={120} step={5} value={km} onChange={(e) => setKm(Number(e.target.value))} className="mt-1 h-8 w-full accent-[var(--accent)]" aria-label="Lunghezza dell'anello in km" />
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
      <Button className="mt-3 w-full" onClick={compute} disabled={busy} data-testid="world-loop-compute">
        {busy ? 'Cerco gli anelli…' : 'Suggeriscimi un anello'}
      </Button>
      {list ? (
        <div className="mt-4">
          <WorldMap data={data} far={far} overlays={overlays} focus={focus} height={320} />
          {list.length === 0 ? <p className="mt-3 text-sm text-muted">Nessun anello di questa lunghezza da qui: prova un'altra partenza o un'altra lunghezza.</p> : null}
          <ul className="mt-3 flex flex-col gap-2">
            {list.map((l, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={`w-full rounded-2xl border px-3.5 py-3 text-left ${i === chosen ? 'border-accent bg-elev2' : 'border-line bg-elev'}`}
                  onClick={() => setChosen(i)}
                  data-testid={`world-loop-${i}`}
                >
                  <p className="flex items-center gap-2 font-semibold">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: ROUTE_COLORS[i] }} />
                    {l.via.slice(0, 4).join(' · ') || `Anello ${i + 1}`}
                  </p>
                  <p className="num mt-0.5 text-sm text-muted">{`${formatKmText(l.lengthM)} · ${formatGainText(l.gainM)} · ${Math.round(l.overlap * 100)}% di strada ripetuta`}</p>
                </button>
              </li>
            ))}
          </ul>
          {list[chosen] ? (
            <Button className="mt-3 w-full" onClick={() => ride(list[chosen].legs, `Anello da ${start}`)} data-testid="world-loop-ride">
              Pedala questo anello
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type AbPoint = { x: number; z: number; label: string };

function AbTab({ data, far }: { data: WorldData; far: Float32Array | null }) {
  const navigate = useNavigate();
  const starts = useMemo(() => startTowns(data).map((n) => ({ name: n, p: startPoint(data, n) })).filter((s) => s.p), [data]);
  const fromName = (n: string): AbPoint | null => {
    const p = startPoint(data, n);
    return p ? { x: p.x, z: p.z, label: n } : null;
  };
  const [a, setA] = useState<AbPoint | null>(() => fromName(starts[0]?.name ?? ''));
  const [b, setB] = useState<AbPoint | null>(() => fromName(starts.find((s) => s.name === 'Selvino')?.name ?? starts[starts.length - 1]?.name ?? ''));
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
    <section className="mt-4">
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(['a', 'b'] as const).map((k) => {
          const cur = k === 'a' ? a : b;
          return (
            <label key={k} className="block text-sm font-semibold">
              {k === 'a' ? 'Partenza (A)' : 'Arrivo (B)'}
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
          height={320}
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
      <label className="mt-3 flex min-h-11 items-center justify-between gap-3 text-sm">
        <span className="font-semibold">E ritorno, per un’altra strada</span>
        <input type="checkbox" className="h-6 w-6 accent-[var(--accent)]" checked={back} onChange={(e) => setBack(e.target.checked)} data-testid="world-ab-back" />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        <span className="font-semibold">Preferisci le ciclabili</span>
        <input type="checkbox" className="h-6 w-6 accent-[var(--accent)]" checked={cycle} onChange={(e) => setCycle(e.target.checked)} />
      </label>
      {route === 'none' ? <p className="mt-2 text-sm text-warn">Fra questi due punti non trovo una strada pedalabile: prova un altro punto.</p> : null}
      {real ? (
        <div className="mt-2 rounded-2xl bg-elev px-3.5 py-3" data-testid="world-ab-route">
          <p className="font-semibold">{real.via.slice(0, 5).join(' · ') || `${a?.label} → ${b?.label}`}</p>
          <p className="num mt-0.5 text-sm text-muted">{`${formatKmText(real.lengthM)} · ${formatGainText(real.gainM)}${back ? ` · ${Math.round(real.overlap * 100)}% di ritorno sulla stessa strada` : ''}`}</p>
          <Button className="mt-3 w-full" onClick={() => navigate(`/ride?world=${encodeURIComponent(data.graph.id)}&plan=${savePlan({ legs: real.legs, name: `${a?.label} → ${b?.label}${back ? ' e ritorno' : ''}` })}`)} data-testid="world-ab-ride">
            Pedala da A a B
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function BoardsTab() {
  const [scope, setScope] = useState<'week' | 'all'>('week');
  const [rows, setRows] = useState<XpRow[] | null | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    setRows('loading');
    void fetchXpBoard(scope).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [scope]);
  return (
    <section className="mt-4">
      <Segmented<'week' | 'all'>
        label="Periodo"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'week', label: 'Questa settimana' },
          { value: 'all', label: 'Di sempre' },
        ]}
      />
      {rows === 'loading' ? <p className="mt-3 text-sm text-muted">Carico…</p> : null}
      {rows === null ? <p className="mt-3 text-sm text-muted">Classifica non raggiungibile: serve la rete.</p> : null}
      {Array.isArray(rows) && rows.length === 0 ? <p className="mt-3 text-sm text-muted">Ancora nessuno: pedala un giro nel mondo e sei in testa.</p> : null}
      {Array.isArray(rows) && rows.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-1" data-testid="world-xp-board">
          {rows.map((r, i) => (
            <li key={i} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${r.me ? 'bg-accent/20 font-semibold' : 'bg-elev'}`}>
              <span className="flex items-center gap-2">
                <span className="num w-6 text-muted">{i + 1}</span>
                {r.nick} <span className="text-xs text-muted">{`Liv. ${levelOf(r.xp).level}`}</span>
              </span>
              <span className="num">{`${formatNumber(r.xp, 0)} punti`}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="mt-4 text-sm text-muted">I tempi di ogni percorso stanno nella sua scheda.</p>
    </section>
  );
}
