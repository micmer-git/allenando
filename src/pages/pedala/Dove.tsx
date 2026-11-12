import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WorldMap, legsBounds, type MapOverlay } from '@/components/WorldMap';
import { useWorldManifests, WorldChooser } from '@/components/WorldPicker';
import { Chevron } from '@/components/Glyph';
import { cap, formatDuration, formatGainText, formatKmText } from '@/domain/format';
import { loadRouteFile, trackFromRouteFile, VERIFIED_ROUTES, type RouteMeta } from '@/domain/routes';
import type { Ride } from '@/domain/types';
import type { Leg } from '@/open/graph';
import { usePacco } from '@/lib/rete';
import { pickRoute } from '@/open/pick';
import { chiuso } from '@/open/passaggi';
import { savePlan } from '@/open/plan';
import { EMPTY_PROGRESS, loadProgress, type WorldProgress } from '@/open/progress';
import { GANDA_LINK, GANDA_NAME, roadStart } from '@/open/partenze';
import { startTowns, townPoint } from '@/open/starts';
import { loadWorld, Terrain, type RideDef, type WorldData } from '@/open/world';
import { rememberWorld, worldInfo } from '@/open/worlds';
import { worldInfo as worldTable } from '@/open/world-table';
import type { Dove } from '@/ride/contract';
import { useApp } from '@/store/useApp';
import { cn } from '@/lib/cn';
import { AbTab, FreeTab, LoopTab, RideCard, ROUTE_COLORS, type PuntoLibero } from '../World';
import { Foglio } from './Foglio';
import { vistaGiro, vistaLibero, vistaPercorso, vistaPiano, vistaSalita, type Scelta, type VistaDove } from './scelta';

/*
 * Dove (piano U, F3; wireframe D1, D2, G2, P1). Un foglio a tutta altezza (sul computer una
 * colonna): la carta, tre strumenti, quattro filtri, la lista per gruppo. Un tocco su una riga
 * sceglie e chiude: nessun secondo «Pedala», il tasto pieno è «Via».
 */

export type Strumento = 'lista' | 'libero' | 'anello' | 'ab' | 'scheda';
export type Filtro = 'tutti' | 'anelli' | 'salite' | 'giri';

export interface Scelto {
  dove: Dove;
  vista: VistaDove;
  piano: Scelta['piano'];
}

/** Le salite fuori dal mondo: le verificate, tranne Selvino (sta nel mondo, A17). */
export const GRANDI_SALITE: RouteMeta[] = VERIFIED_ROUTES.filter((r) => r.id !== 'selvino-nembro');

export interface Mondo {
  id: string;
  data: WorldData | null;
  far: Float32Array | null;
  error: string | null;
  progress: WorldProgress;
}

/** Il mondo per Dove: si carica solo quando serve (foglio aperto, o la colonna sul computer). */
export function useMondo(id: string, attivo: boolean): Mondo {
  const [state, setState] = useState<Mondo>({ id, data: null, far: null, error: null, progress: EMPTY_PROGRESS });
  useEffect(() => {
    if (!attivo) return;
    let alive = true;
    setState((s) => (s.id === id && s.data ? s : { id, data: null, far: null, error: null, progress: s.progress }));
    loadWorld(id)
      .then((d) => {
        if (!alive) return;
        // si ricorda solo un mondo che si è caricato davvero (R6)
        rememberWorld(id);
        setState((s) => ({ ...s, id, data: d, error: null }));
        void new Terrain(d.graph).loadFar().then((h) => alive && setState((s) => (s.id === id ? { ...s, far: h } : s)));
      })
      .catch((e: unknown) => alive && setState((s) => ({ ...s, id, data: null, error: e instanceof Error ? e.message : 'Mondo non disponibile' })));
    void loadProgress().then((p) => alive && setState((s) => ({ ...s, progress: p })));
    return () => {
      alive = false;
    };
  }, [id, attivo]);
  return state;
}

/** Il giro della lista: si può rifare se ha i campioni con la distanza. */
export function rifacibile(r: Ride): boolean {
  return r.samples.length > 10 && r.distanceM > 200;
}

/** Il record di una salita verificata: il giro più veloce del diario fatto tutto. */
function recordSalita(rides: readonly Ride[], id: string, lunghezza: number): VistaDove['record'] {
  const best = rides.filter((r) => r.routeId === id && r.distanceM >= lunghezza - 5 && !r.prova).sort((a, b) => a.durationSec - b.durationSec)[0];
  return best ? { sec: best.durationSec, at: best.startTime, ghost: best.id } : null;
}

const salite = new Map<string, Promise<VistaDove | null>>();
/** La vista di una grande salita: dal file della traccia (sta nel guscio, si legge anche senza rete). */
function vistaGrandeSalita(meta: RouteMeta, rides: readonly Ride[]): Promise<VistaDove | null> {
  let p = salite.get(meta.id);
  if (!p) {
    p = loadRouteFile(meta.id)
      .then((f) => vistaSalita(trackFromRouteFile(f, meta.halfWidth), meta))
      .catch(() => null);
    salite.set(meta.id, p);
    p.then((v) => !v && salite.delete(meta.id));
  }
  return p.then((v) => (v ? { ...v, record: v.lunghezzaM ? recordSalita(rides, meta.id, v.lunghezzaM) : null } : null));
}

export function useGrandiSalite(attivo: boolean): Record<string, VistaDove | null> {
  const rides = useApp((s) => s.rides);
  const [out, setOut] = useState<Record<string, VistaDove | null>>({});
  useEffect(() => {
    if (!attivo) return;
    let alive = true;
    for (const m of GRANDI_SALITE) void vistaGrandeSalita(m, rides).then((v) => alive && setOut((o) => ({ ...o, [m.id]: v })));
    return () => {
      alive = false;
    };
  }, [attivo, rides]);
  return out;
}

/** Si chiude su sé stesso: finisce nel nodo da cui parte (`chiuso` di U-motore). */
function chiusoRide(data: WorldData, r: RideDef): boolean {
  return chiuso(data.graph, r.legs.map(([edge, dir]) => ({ edge, dir })));
}

export function DoveFoglio(props: Omit<DoveProps, 'colonna'> & { open: boolean; onClose: () => void }) {
  const { open, onClose, strumento, setStrumento } = props;
  const titolo = strumento === 'anello' ? 'Crea un anello' : strumento === 'libero' ? 'Giro libero' : strumento === 'ab' ? 'A → B' : strumento === 'scheda' ? 'Scheda' : 'Dove';
  return (
    <Foglio
      open={open}
      onClose={onClose}
      title={titolo}
      alto
      testId="dove-foglio"
      indietro={strumento !== 'lista' && !props.soloStrumento ? { label: 'Dove', onClick: () => setStrumento('lista') } : undefined}
    >
      <DoveContenuto {...props} />
    </Foglio>
  );
}

interface DoveProps {
  mondo: Mondo;
  setWorld: (id: string) => void;
  strumento: Strumento;
  setStrumento: (s: Strumento) => void;
  /** aperto direttamente su uno strumento (la «Scheda» di un giro libero): niente «‹ Dove» */
  soloStrumento?: boolean;
  filtro: Filtro;
  setFiltro: (f: Filtro) => void;
  onScegli: (s: Scelto) => void;
  /** l'id della riga scelta (evidenziata) */
  scelto: string | null;
  /** la durata dell'allenamento scelto: «Crea un anello» cerca per minuti (D2) */
  minuti?: number;
  watt?: number;
  /** sul computer: la colonna, carta più alta */
  colonna?: boolean;
  /** la scheda del percorso scelto */
  schedaRide?: string | null;
  offline?: boolean;
}

export function DoveContenuto({ mondo, setWorld, strumento, setStrumento, filtro, setFiltro, onScegli, scelto, minuti, watt, colonna, schedaRide, offline }: DoveProps) {
  const rides = useApp((s) => s.rides);
  const manifests = useWorldManifests();
  const [scegliMondo, setScegliMondo] = useState(false);
  const [evidenza, setEvidenza] = useState<string | null>(null);
  const grandi = useGrandiSalite(true);
  const data = mondo.data;
  const info = worldInfo(mondo.id);
  const pacco = usePacco(mondo.id);

  const giri = useMemo(() => rides.filter(rifacibile), [rides]);
  const gruppi = useMemo(() => {
    if (!data) return { anelli: [] as RideDef[], salite: [] as RideDef[], percorsi: [] as RideDef[] };
    const anelli: RideDef[] = [];
    const sal: RideDef[] = [];
    const percorsi: RideDef[] = [];
    for (const r of data.rides) {
      if (chiusoRide(data, r)) anelli.push(r);
      else if (r.kind === 'salita') sal.push(r);
      else percorsi.push(r);
    }
    return { anelli, salite: sal, percorsi };
  }, [data]);

  const scegliPercorso = (r: RideDef) => {
    if (!data) return;
    const rec = mondo.progress.rides[r.id];
    onScegli({ dove: { kind: 'percorso', world: data.graph.id, ride: r.id }, vista: vistaPercorso(data, r, rec?.bestSec ? { sec: rec.bestSec, at: rec.bestAt } : null), piano: null });
  };
  const scegliPiano = (legs: Leg[], name: string, partenza: string) => {
    if (!data) return;
    const plan = savePlan({ legs, name });
    const sotto = chiuso(data.graph, legs) ? `Da ${partenza}` : name;
    onScegli({ dove: { kind: 'piano', world: data.graph.id, plan }, vista: vistaPiano(data, legs, name, sotto, partenza), piano: { name, legs: legs.map((l) => [l.edge, l.dir]) } });
  };
  const scegliLibero = (p: PuntoLibero) => {
    if (!data) return;
    onScegli({ dove: { kind: 'libero', world: data.graph.id, edge: p.edge, dir: p.dir, s: p.s }, vista: vistaLibero(p.paese), piano: null });
  };
  /** «Giro libero» in testa: parte subito dal paese di casa del mondo (si cambia dalla Scheda). */
  const liberoSubito = () => {
    if (!data) return;
    const paese = startTowns(data)[0] ?? info.home;
    const pt = townPoint(data, paese);
    const hit = pt ? data.graph.freeStart(pt.x, pt.z, 400, true) : null;
    if (!hit) {
      setStrumento('libero');
      return;
    }
    const start = roadStart(data.graph, hit.edge, hit.s);
    if (start) scegliLibero({ ...start, paese });
  };
  const scegliSalita = (m: RouteMeta) => {
    const v = grandi[m.id];
    if (!v) return;
    onScegli({ dove: { kind: 'salita', route: m.id }, vista: v, piano: null });
  };
  const scegliGiro = (r: Ride) => onScegli({ dove: { kind: 'giro', replay: r.id }, vista: vistaGiro(r), piano: null });

  // ---- gli strumenti ----
  if (strumento !== 'lista') {
    if (!data) return <Caricamento mondo={mondo} offline={offline} />;
    if (strumento === 'libero') return <FreeTab data={data} far={mondo.far} onScegli={scegliLibero} />;
    if (strumento === 'anello') return <LoopTab data={data} far={mondo.far} onScegli={scegliPiano} minuti={minuti} watt={watt} />;
    if (strumento === 'ab') return <AbTab data={data} far={mondo.far} onScegli={scegliPiano} />;
    const ride = data.rides.find((r) => r.id === schedaRide);
    return ride ? <RideCard data={data} ride={ride} progress={mondo.progress} /> : <Caricamento mondo={mondo} offline={offline} />;
  }

  const mostra = (g: 'anelli' | 'salite' | 'percorsi' | 'grandi' | 'giri') =>
    filtro === 'tutti' || (filtro === 'anelli' && g === 'anelli') || (filtro === 'salite' && (g === 'salite' || g === 'grandi')) || (filtro === 'giri' && g === 'giri');
  const visibili = data ? [...(mostra('anelli') ? gruppi.anelli : []), ...(mostra('salite') ? gruppi.salite : []), ...(mostra('percorsi') ? gruppi.percorsi : [])] : [];

  return (
    <div className={cn(colonna ? 'flex min-h-0 flex-col gap-2' : 'mt-2')} data-testid="dove" data-world={mondo.id}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="inline-flex h-11 min-w-0 items-center gap-1.5 rounded-full border border-line bg-elev2/60 px-3.5 font-semibold" onClick={() => setScegliMondo((v) => !v)} aria-expanded={scegliMondo} data-testid="dove-mondo">
          <span className="min-w-0 whitespace-nowrap">{info.name}</span>
          <Chevron size={16} className={cn('shrink-0 text-muted transition', scegliMondo && 'rotate-180')} />
        </button>
        {offline && !data ? <Token>Offline</Token> : pacco.stato === 'intero' ? <Token>Intero ✓</Token> : pacco.stato === 'leggero' ? <Token>Leggero</Token> : null}
      </div>
      {scegliMondo ? (
        <div className="mt-2">
          <WorldChooser
            value={mondo.id}
            manifests={manifests}
            onChange={(id) => {
              setScegliMondo(false);
              setWorld(id);
            }}
          />
          <p className="mt-2 text-sm text-muted" data-testid="world-tagline">
            {info.blurb}
          </p>
        </div>
      ) : null}
      {data ? (
        <CartaDove data={data} far={mondo.far} rides={visibili} scelto={evidenza ?? scelto} height={colonna ? 330 : 190} onPick={(id) => setEvidenza(id)} />
      ) : (
        <Caricamento mondo={mondo} offline={offline} />
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" disabled={!data} className="min-h-11 text-left font-semibold text-accent disabled:opacity-50" onClick={() => setStrumento('libero')} data-testid="dove-libero-mappa">Giro libero sulla mappa</button>
        {mondo.id === 'bergamo' && <Link to={GANDA_LINK} className="inline-flex min-h-11 items-center text-left font-semibold text-accent" data-testid="dove-ganda-salita">{GANDA_NAME}</Link>}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <Strumentino onClick={liberoSubito} disabled={!data} testId="dove-libero">
          {`Libero da ${info.home}`}
        </Strumentino>
        <Strumentino onClick={() => setStrumento('anello')} disabled={!data} testId="dove-anello">
          Crea un anello
        </Strumentino>
        <Strumentino onClick={() => setStrumento('ab')} disabled={!data} testId="dove-ab">
          A → B
        </Strumentino>
      </div>
      <div className="mt-2 flex gap-1.5" role="group" aria-label="Filtro">
        {(
          [
            ['tutti', 'Tutti'],
            ['anelli', 'Anelli'],
            ['salite', 'Salite'],
            ['giri', 'Tuoi giri'],
          ] as const
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            aria-pressed={filtro === f}
            onClick={() => setFiltro(f)}
            className={cn('h-11 min-w-0 flex-auto whitespace-nowrap rounded-full border px-2.5 text-sm font-semibold', filtro === f ? 'border-ink/30 bg-[var(--thumb)] text-ink' : 'border-line text-muted')}
            data-testid={`dove-filtro-${f}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={cn(colonna && 'min-h-0 flex-1 overflow-y-auto pr-1')}>
        {data && mostra('anelli') && gruppi.anelli.length ? (
          <Gruppo titolo="Anelli">
            {gruppi.anelli.map((r) => (
              <RigaPercorso key={r.id} r={r} rec={mondo.progress.rides[r.id]?.bestSec} on={scelto === r.id || evidenza === r.id} onClick={() => scegliPercorso(r)} />
            ))}
          </Gruppo>
        ) : null}
        {data && mostra('salite') && gruppi.salite.length ? (
          <Gruppo titolo="Salite">
            {gruppi.salite.map((r) => (
              <RigaPercorso key={r.id} r={r} rec={mondo.progress.rides[r.id]?.bestSec} on={scelto === r.id || evidenza === r.id} onClick={() => scegliPercorso(r)} />
            ))}
          </Gruppo>
        ) : null}
        {data && mostra('percorsi') && gruppi.percorsi.length ? (
          <Gruppo titolo="Percorsi">
            {gruppi.percorsi.map((r) => (
              <RigaPercorso key={r.id} r={r} rec={mondo.progress.rides[r.id]?.bestSec} on={scelto === r.id || evidenza === r.id} onClick={() => scegliPercorso(r)} />
            ))}
          </Gruppo>
        ) : null}
        {!data && mondo.error && filtro !== 'giri' ? (
          <Gruppo titolo={info.name}>
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line opacity-50">
              <span className="font-semibold">{`${info.short}: i percorsi`}</span>
              <Token>{offline ? 'Offline' : 'Non disponibile'}</Token>
            </div>
          </Gruppo>
        ) : null}
        {mostra('grandi') ? (
          <Gruppo titolo="Grandi salite">
            {GRANDI_SALITE.map((m) => (
              <Riga
                key={m.id}
                id={m.id}
                titolo={m.name}
                sotto={`${cap(m.side)}${grandi[m.id]?.record ? ` · Record ${formatDuration(grandi[m.id]!.record!.sec)}` : ''}`}
                km={grandi[m.id]?.lunghezzaM ?? null}
                m={grandi[m.id]?.dislivelloM ?? null}
                on={scelto === m.id}
                disabled={!grandi[m.id]}
                onClick={() => scegliSalita(m)}
              />
            ))}
          </Gruppo>
        ) : null}
        {mostra('giri') ? (
          <Gruppo titolo="Tuoi giri">
            {giri.length === 0 ? <p className="py-3 text-sm text-muted">Nessun giro nel diario.</p> : null}
            {(filtro === 'giri' ? giri : giri.slice(0, 3)).map((r) => (
              <Riga
                key={r.id}
                id={`giro-${r.id}`}
                titolo={r.name}
                sotto={cap(new Date(r.startTime).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }))}
                km={r.distanceM}
                m={r.elevationGainM}
                on={scelto === r.id}
                onClick={() => scegliGiro(r)}
              />
            ))}
            {filtro !== 'giri' && giri.length > 3 ? (
              <button type="button" className="flex h-12 w-full items-center text-sm font-semibold text-accent" onClick={() => setFiltro('giri')}>
                {`Tutti i ${giri.length} giri`}
              </button>
            ) : null}
          </Gruppo>
        ) : null}
        {data && <Link to={'/confronto?world=' + encodeURIComponent(data.graph.id) + '&ride=' + encodeURIComponent(data.rides.find(r => r.id === (evidenza ?? scelto))?.id ?? (data.graph.id === 'bergamo' ? 'ganda' : 'sellaronda'))} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent">Esplora il percorso ogni 100 m ↗</Link>}
        {data ? <p className="mt-6 text-xs leading-relaxed text-muted" data-testid="dove-fonti">{`© OpenStreetMap contributors (ODbL), dati del ${data.graph.builtAt} · ${worldTable(data.graph.id).quoteCredits} · Colori del terreno: ortofoto © AGEA (voli 2023–2024) e ESA WorldCover, dati Copernicus Sentinel-2 modificati (2021), CC BY 4.0.`}</p> : null}
      </div>
    </div>
  );
}

function Caricamento({ mondo, offline }: { mondo: Mondo; offline?: boolean }) {
  const info = worldInfo(mondo.id);
  return (
    <div className="mt-2 grid h-[190px] place-items-center rounded-2xl border border-line bg-elev2/40 text-sm text-muted" data-testid="dove-carica">
      {mondo.error ? (offline ? 'Offline' : `${info.name} non è disponibile`) : `Carico ${info.name}`}
    </div>
  );
}

function Token({ children }: { children: string }) {
  return <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold">{children}</span>;
}

function Strumentino({ children, onClick, disabled, testId }: { children: string; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="h-11 rounded-full border border-line px-2 text-sm font-semibold disabled:opacity-50" data-testid={testId}>
      {children}
    </button>
  );
}

function Gruppo({ titolo, children }: { titolo: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="eyebrow">{titolo}</h3>
      <ul className="mt-1">{children}</ul>
    </section>
  );
}

function RigaPercorso({ r, rec, on, onClick }: { r: RideDef; rec?: number | null; on: boolean; onClick: () => void }) {
  return <Riga id={r.id} titolo={r.name} sotto={`${cap(r.side)}${rec ? ` · Record ${formatDuration(rec)}` : ''}`} km={r.lengthM} m={r.gainM} on={on} onClick={onClick} />;
}

function Riga({ id, titolo, sotto, km, m, on, onClick, disabled }: { id: string; titolo: string; sotto: string; km: number | null; m: number | null; on: boolean; onClick: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [on]);
  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-current={on || undefined}
        className={cn('flex min-h-14 w-full items-center justify-between gap-3 border-b border-line py-2 text-left disabled:opacity-60', on && '-mx-2 w-[calc(100%+1rem)] rounded-xl border-transparent bg-elev2 px-2')}
        data-testid={`dove-riga-${id}`}
      >
        <span className="min-w-0">
          <span className="block font-semibold leading-snug">{titolo}</span>
          <span className="num block text-sm leading-snug text-muted">{sotto}</span>
        </span>
        <span className="num shrink-0 text-right text-sm leading-snug text-muted">
          {km != null ? formatKmText(km) : ''}
          <br />
          {m != null ? formatGainText(m) : ''}
        </span>
      </button>
    </li>
  );
}

/** La carta di Dove: i percorsi della lista; un tocco su un percorso lo evidenzia nella lista. */
function CartaDove({ data, far, rides, scelto, height, onPick }: { data: WorldData; far: Float32Array | null; rides: RideDef[]; scelto: string | null; height: number; onPick: (id: string) => void }) {
  const sel = rides.find((r) => r.id === scelto) ?? null;
  const overlays = useMemo<MapOverlay[]>(() => {
    const leg = (r: RideDef) => r.legs.map(([edge, dir]) => ({ edge, dir }));
    if (!sel) return rides.map((r, i) => ({ legs: leg(r), color: ROUTE_COLORS[i % ROUTE_COLORS.length], width: 3 }));
    return [...rides.filter((r) => r.id !== sel.id).map((r) => ({ legs: leg(r), color: 'rgba(58,62,70,0.55)', width: 2 })), { legs: leg(sel), color: '#ffc814', width: 6 }];
  }, [rides, sel]);
  const focus = useMemo(() => (sel ? legsBounds(data, sel.legs.map(([edge, dir]) => ({ edge, dir }))) : null), [data, sel]);
  return (
    <div className="mt-2 overflow-hidden rounded-2xl" data-testid="dove-carta">
      <WorldMap
        data={data}
        far={far}
        overlays={overlays}
        focus={focus}
        height={height}
        onPick={(x, z, mpp) => {
          const r = pickRoute(data.graph, rides, x, z, mpp);
          if (r) onPick(r.id);
        }}
      />
    </div>
  );
}

/** Il nome della riga scelta, per l'evidenza nella lista. */
export function idScelto(d: Dove | null): string | null {
  if (!d) return null;
  if (d.kind === 'percorso') return d.ride;
  if (d.kind === 'salita') return d.route;
  if (d.kind === 'giro') return d.replay;
  return null;
}

