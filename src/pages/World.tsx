import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Segmented } from '@/components/ui';
import { WorldMap, legsBounds, type MapMarker, type MapOverlay } from '@/components/WorldMap';
import { formatDuration, formatKm, formatNumber } from '@/domain/format';
import { worldCount } from '@/multiplayer/world-client';
import type { BoardRow, XpRow } from '@/multiplayer/world-protocol';
import type { Leg } from '@/open/graph';
import { CLS } from '@/open/graph';
import { suggestLoops, type LoopSuggestion, type LoopTaste } from '@/open/loops';
import { EMPTY_PROGRESS, fetchRideBoard, fetchXpBoard, levelOf, loadProgress, type WorldProgress } from '@/open/progress';
import { Terrain, loadWorld, type RideDef, type WorldData } from '@/open/world';
import { kindLabel } from '@/open/WorldScene';
import { savePlan } from '@/open/plan';

const AREAS: { id: RideDef['area']; label: string }[] = [
  { id: 'citta', label: 'Bergamo città' },
  { id: 'seriana', label: 'Val Seriana' },
  { id: 'brembana', label: 'Val Brembana' },
  { id: 'valli', label: 'Fra le due valli' },
];

const ROUTE_COLORS = ['#c8f031', '#ff6b4a', '#4ab8ff', '#ffc93c', '#c77dff', '#3ce0b0', '#ff5fa2'];

/** I punti di partenza del giro libero: i paesi grandi del mondo, presi dai dati. */
const STARTS = ['Bergamo', 'Città Alta', 'Ponteranica', 'Alzano Lombardo', 'Nembro', 'Albino', 'Gazzaniga', 'Ponte Nossa', 'Clusone', 'Castione della Presolana', 'Villa d’Almè', 'Zogno', 'San Pellegrino Terme', 'San Giovanni Bianco', 'Piazza Brembana', 'Branzi', 'Serina', 'Selvino'];

export function WorldPage() {
  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [far, setFar] = useState<Float32Array | null>(null);
  const [progress, setProgress] = useState<WorldProgress>(EMPTY_PROGRESS);
  const [online, setOnline] = useState<number | null>(null);
  const [tab, setTab] = useState<'percorsi' | 'libero' | 'anello' | 'classifiche'>('percorsi');
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadWorld()
      .then((d) => {
        if (!alive) return;
        setData(d);
        const t = new Terrain(d.graph);
        void t.loadFar().then((h) => alive && setFar(h));
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'mondo non disponibile'));
    void loadProgress().then((p) => alive && setProgress(p));
    void worldCount().then((n) => alive && setOnline(n));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <main className="mx-auto max-w-3xl px-4 py-8 text-danger">{error}</main>;
  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-display text-4xl">Mondo</h1>
        <p className="mt-2 text-muted">Carico le strade di Bergamo e delle valli…</p>
      </main>
    );
  }
  const lv = levelOf(progress.xp);
  const discovered = Object.keys(progress.visited).length;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 md:pb-10" data-testid="world-page">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Mondo aperto</p>
          <h1 className="font-display text-4xl leading-none">Bergamo e le valli</h1>
        </div>
        <p className="text-right text-sm text-muted" data-testid="world-online">
          {online == null ? 'in rete: –' : online === 0 ? 'nessuno in strada adesso' : online === 1 ? '1 in strada adesso' : `${online} in strada adesso`}
        </p>
      </div>
      <LevelCard progress={progress} level={lv} discovered={discovered} total={data.features.landmarks.length} />
      <div className="mt-4">
        <Segmented<typeof tab>
          label="Sezione"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'percorsi', label: 'Percorsi' },
            { value: 'libero', label: 'Libero' },
            { value: 'anello', label: 'Anello' },
            { value: 'classifiche', label: 'Classifiche' },
          ]}
        />
      </div>
      {tab === 'percorsi' ? <RidesTab data={data} far={far} progress={progress} picked={picked} setPicked={setPicked} /> : null}
      {tab === 'libero' ? <FreeTab data={data} far={far} /> : null}
      {tab === 'anello' ? <LoopTab data={data} far={far} /> : null}
      {tab === 'classifiche' ? <BoardsTab data={data} /> : null}
      <p className="mt-8 text-xs leading-relaxed text-muted">
        Strade, edifici, fiumi, cime e paesi: © OpenStreetMap contributors (ODbL), dati del {data.graph.builtAt}. Quote: EU-DEM © Copernicus, livellate lungo la strada. I ciclisti
        «virtuali» sono simulati; le persone vere hanno il nome sopra la testa.
      </p>
    </main>
  );
}

function LevelCard({ progress, level, discovered, total }: { progress: WorldProgress; level: ReturnType<typeof levelOf>; discovered: number; total: number }) {
  const pct = Math.min(100, ((progress.xp - level.from) / Math.max(1, level.to - level.from)) * 100);
  return (
    <section className="mt-4 rounded-3xl bg-elev p-4" data-testid="world-level">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-2xl leading-none">
          Livello {level.level} <span className="font-sans text-sm font-medium text-muted">{level.title}</span>
        </p>
        <p className="num text-sm text-muted">{formatNumber(progress.xp, 0)} XP</p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-elev2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Verso il prossimo livello">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Questa settimana" value={`${formatNumber(progress.weekXp, 0)} XP`} />
        <Stat label="Luoghi scoperti" value={`${discovered}/${total}`} />
        <Stat label="Nel mondo" value={`${formatKm(progress.km * 1000)} km`} />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-bg/60 px-2 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="num text-[15px] font-semibold">{value}</dd>
    </div>
  );
}

function RidesTab({ data, far, progress, picked, setPicked }: { data: WorldData; far: Float32Array | null; progress: WorldProgress; picked: string | null; setPicked: (id: string | null) => void }) {
  const navigate = useNavigate();
  const sel = data.rides.find((r) => r.id === picked) ?? null;
  const overlays = useMemo<MapOverlay[]>(
    () =>
      sel
        ? [{ legs: sel.legs.map(([edge, dir]) => ({ edge, dir })), color: '#c8f031', width: 5 }]
        : data.rides.map((r, i) => ({ legs: r.legs.map(([edge, dir]) => ({ edge, dir })), color: ROUTE_COLORS[i % ROUTE_COLORS.length], width: 3 })),
    [data, sel],
  );
  const focus = useMemo(() => (sel ? legsBounds(data, sel.legs.map(([edge, dir]) => ({ edge, dir }))) : null), [data, sel]);
  const markers = useMemo<MapMarker[]>(() => {
    if (!sel) return [];
    const out: MapMarker[] = [];
    for (const l of sel.landmarks) {
      const lm = data.features.landmarks.find((x) => x.id === l.id);
      if (lm) out.push({ x: lm.x, z: lm.z, color: progress.visited[lm.id] ? '#c8f031' : '#ffffff', label: lm.name });
    }
    return out;
  }, [data, sel, progress]);
  return (
    <section className="mt-4">
      <WorldMap data={data} far={far} overlays={overlays} markers={markers} focus={focus} height={340} />
      {sel ? <RideCard data={data} ride={sel} progress={progress} onClose={() => setPicked(null)} onRide={() => navigate(`/ride?world=bergamo&ride=${sel.id}`)} /> : null}
      {AREAS.map((a) => {
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
                        <p className="font-display text-xl leading-tight">
                          {r.name} <span className="font-sans text-sm font-medium text-muted">{r.side}</span>
                        </p>
                        {rec?.bestSec != null ? <span className="num shrink-0 text-xs font-semibold text-good">{formatDuration(rec.bestSec)}</span> : null}
                      </div>
                      <p className="num mt-0.5 text-sm text-muted">
                        {formatKm(r.lengthM)} km · D+ {formatNumber(r.gainM, 0)} m · {r.kind === 'salita' ? `media ${pctStr(r.climbGrade)}` : `fino a ${formatNumber(r.maxAlt, 0)} m`} · {r.landmarks.length} luoghi
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

function RideCard({ data, ride, progress, onClose, onRide }: { data: WorldData; ride: RideDef; progress: WorldProgress; onClose: () => void; onRide: () => void }) {
  const [sim, setSim] = useState(false);
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
          <p className="mt-1 text-sm text-muted">{ride.side}</p>
        </div>
        <button type="button" className="h-11 rounded-full px-3 text-sm font-semibold text-muted" onClick={onClose}>
          Chiudi
        </button>
      </div>
      <p className="mt-2 text-[15px] leading-relaxed">{ride.blurb}</p>
      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Stat label="Km" value={formatKm(ride.lengthM)} />
        <Stat label="D+" value={`${formatNumber(ride.gainM, 0)} m`} />
        <Stat label="Quote" value={`${ride.startAlt}→${ride.endAlt}`} />
        <Stat label="Max 200 m" value={pctStr(ride.maxGrade)} />
      </dl>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Da riconoscere lungo la strada</h3>
      <ol className="mt-2 flex flex-col gap-1.5">
        {ride.landmarks.map((l) => {
          const lm = data.features.landmarks.find((x) => x.id === l.id);
          if (!lm) return null;
          return (
            <li key={l.id} className="flex gap-2.5 rounded-xl bg-bg/50 px-3 py-2">
              <span className="num w-12 shrink-0 text-xs font-semibold text-muted">km {formatKm(l.at)}</span>
              <span className="min-w-0">
                <span className="font-semibold">{lm.name}</span> <span className="text-xs text-muted">{kindLabel(lm.kind)}</span>
                {progress.visited[lm.id] ? <span className="ml-1 text-xs font-semibold text-good">✓ visto</span> : null}
                <span className="block text-[13px] leading-snug text-muted">{lm.note}</span>
              </span>
            </li>
          );
        })}
      </ol>
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
      <Button className="mt-4 w-full" onClick={onRide} data-testid="world-ride-start">
        Pedala {ride.name}
      </Button>
    </section>
  );
}

function BoardList({ board }: { board: { total: number; rows: BoardRow[]; mine: { rank: number; sec: number } | null } | null | 'loading' }) {
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
            {formatDuration(r.sec)} <span className="text-xs text-muted">{r.wkg ? `${formatNumber(r.wkg, 1)} W/kg` : ''}</span>
          </span>
        </li>
      ))}
      {board.mine ? (
        <li className="flex items-center justify-between rounded-xl bg-accent/20 px-3 py-1.5 text-sm font-semibold">
          <span>Tu: {board.mine.rank}° su {board.total}</span>
          <span className="num">{formatDuration(board.mine.sec)}</span>
        </li>
      ) : null}
    </ol>
  );
}

function startPoint(data: WorldData, name: string): { x: number; z: number } | null {
  if (name === 'Città Alta') {
    const lm = data.features.landmarks.find((l) => /Piazza Vecchia/.test(l.name));
    if (lm) return lm;
  }
  const p = data.features.places.find((pl) => pl.name.replace(/[’']/g, "'") === name.replace(/[’']/g, "'") && pl.kind !== 'hamlet');
  return p ?? null;
}

function FreeTab({ data, far }: { data: WorldData; far: Float32Array | null }) {
  const navigate = useNavigate();
  const [point, setPoint] = useState<{ x: number; z: number; label: string } | null>(null);
  const starts = useMemo(() => STARTS.map((n) => ({ name: n, p: startPoint(data, n) })).filter((s) => s.p), [data]);
  function go(x: number, z: number) {
    const hit = data.graph.nearest(x, z, 400, (e) => e.cls !== CLS.trunk);
    if (!hit) return;
    const e = data.graph.edges[hit.edge];
    const dir = data.graph.allowed(hit.edge, 1) ? 1 : -1;
    navigate(`/ride?world=bergamo&edge=${hit.edge}&s=${Math.round(Math.min(e.length - 1, hit.s))}&dir=${dir}`);
  }
  return (
    <section className="mt-4">
      <p className="text-[15px] leading-relaxed">
        Parti da dove vuoi e gira dove vuoi: a ogni incrocio scegli sinistra, dritto o destra (frecce della tastiera o i pulsanti sullo schermo). Tocca la carta per scegliere il punto, o un paese qui sotto.
      </p>
      <div className="mt-3">
        <WorldMap
          data={data}
          far={far}
          height={320}
          markers={point ? [{ x: point.x, z: point.z, color: '#c8f031', label: point.label, ring: true }] : []}
          onPick={(x, z) => {
            const hit = data.graph.nearest(x, z, 600, (e) => e.cls !== CLS.trunk);
            if (!hit) return;
            const p = data.graph.pose(hit.edge, hit.s);
            const e = data.graph.edges[hit.edge];
            setPoint({ x: p.x, z: p.z, label: e.name || e.ref || 'qui' });
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
            <button type="button" className="h-12 w-full rounded-2xl border border-line bg-elev px-3 text-left text-sm font-semibold" onClick={() => go(s.p!.x, s.p!.z)}>
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
  const [start, setStart] = useState('Bergamo');
  const [km, setKm] = useState(40);
  const [taste, setTaste] = useState<LoopTaste>('misto');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<LoopSuggestion[] | null>(null);
  const [chosen, setChosen] = useState(0);
  const starts = useMemo(() => STARTS.map((n) => ({ name: n, p: startPoint(data, n) })).filter((s) => s.p), [data]);
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
    navigate(`/ride?world=bergamo&plan=${key}`);
  }
  return (
    <section className="mt-4">
      <p className="text-[15px] leading-relaxed">Scegli da dove parti, quanti chilometri e che strade: ti propongo tre anelli diversi che tornano al punto di partenza.</p>
      <label className="mt-3 block text-sm font-semibold">
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
                  <p className="num mt-0.5 text-sm text-muted">
                    {formatKm(l.lengthM)} km · D+ {formatNumber(l.gainM, 0)} m · {Math.round(l.overlap * 100)}% di strada ripetuta
                  </p>
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

function BoardsTab({ data }: { data: WorldData }) {
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
                {r.nick} <span className="text-xs text-muted">liv. {levelOf(r.xp).level}</span>
              </span>
              <span className="num">{formatNumber(r.xp, 0)} XP</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="mt-4 text-sm text-muted">
        I tempi di ognuno dei {data.rides.length} percorsi stanno nella sua scheda, in Percorsi; quelli del simulatore in una classifica a parte.
      </p>
    </section>
  );
}
