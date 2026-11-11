import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/ui';
import { usePacco, useRete } from '@/lib/rete';
import { formatGainText, formatKmText } from '@/domain/format';
import { loadRouteFile, routeMeta, trackFromRouteFile } from '@/domain/routes';
import { lastWorld, isWorldId } from '@/open/worlds';
import type { Rete, Tipo } from '@/ride/contract';
import { useApp } from '@/store/useApp';
import { cn } from '@/lib/cn';
import { MissioniRiga, ProgrammaRiga, SessioneRiga, useNow, useProgrammaOggi, useSessioneAperta } from './Home';
import { worldOfRide } from '@/multiplayer/world-rides';
import type { PlanSession } from '@/domain/plans';
import { DoveContenuto, DoveFoglio, idScelto, useMondo, type Filtro, type Scelto, type Strumento } from './pedala/Dove';
import { RulloChip, RulloFoglio, RulloPannello } from './pedala/Rullo';
import { useRullo } from '@/sim/rullo';
import { clampWatt, fisicaDi, intentoDi, leggiScelta, salvaScelta, SCELTA_VUOTA, stimaGiro, vistaGiro, vistaPercorso, vistaSalita, wattDelTipo, wattIniziali, type Scelta, type VistaDove } from './pedala/scelta';
import { AllenamentoCard, ComeSegmento, Fantasma, Giri, VaETorna, WattFissi } from './pedala/Come';
import { AllenamentoFoglio } from './pedala/Allenamento';
import { workoutTitle } from './Workouts';
import { findWorkout, workoutDuration } from '@/domain/workouts';
import { giriPer } from '@/domain/stima';
import { intentoInSearch } from '@/ride/intento';
import { useI18n } from '@/i18n';
import { vistaPedala } from './pedala/vista';

/** «Offline», una parola (piano U, A16). */
export function ReteChip() {
  return (
    <span className="inline-flex h-11 shrink-0 items-center rounded-full border border-line px-3.5 text-sm font-semibold text-muted" data-testid="rete-offline" role="status">
      Offline
    </span>
  );
}

/** La rete adesso (U-motore, src/lib/rete.ts). */
export function useReteOra(): Rete {
  return useRete();
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return !!on;
}

/** Il mondo del Dove scelto, o l'ultimo usato. */
function mondoDi(s: Scelta): string {
  const d = s.dove;
  return d && 'world' in d && isWorldId(d.world) ? d.world : lastWorld();
}

/**
 * Pedala, la casa (piano U, A2). Senza un sensore di potenza e senza la prova: «Collega il rullo»
 * e nient'altro (B1–B5, C5). Con la potenza: Dove · Come · Via, la scelta ricordata (A21).
 */
export function PedalaPage() {
  const r = useRullo();
  const rete = useReteOra();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const updateSettings = useApp((s) => s.updateSettings);
  const rides = useApp((s) => s.rides);
  const largo = useMedia('(min-width: 1024px) and (min-height: 600px)');
  const [foglio, setFoglio] = useState(false);
  const [allenamenti, setAllenamenti] = useState(false);
  const profile = useApp((s) => s.profile);
  const workouts = useApp((s) => s.workouts);
  const { t } = useI18n();
  const chiudiFoglio = useCallback(() => setFoglio(false), []);
  const [scelta, setSceltaState] = useState<Scelta | null>(null);
  const [dove, setDove] = useState<{ open: boolean; strumento: Strumento; filtro: Filtro; solo?: boolean; ride?: string | null }>({ open: false, strumento: 'lista', filtro: 'tutti' });
  const [worldId, setWorldId] = useState(lastWorld);
  // un Dove chiesto dall'indirizzo (un link vecchio, «Rifai» dal Diario) che aspetta il mondo
  const [attesa, setAttesa] = useState<{ world: string; ride: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void leggiScelta().then((s) => {
      if (!alive) return;
      setSceltaState(s);
      setWorldId(mondoDi(s));
    });
    return () => {
      alive = false;
    };
  }, []);
  const setScelta = useCallback((patch: Partial<Scelta>) => {
    setSceltaState((prev) => {
      const next = { ...(prev ?? SCELTA_VUOTA), ...patch };
      void salvaScelta(next);
      return next;
    });
  }, []);

  const v = vistaPedala(r, rete, { dove: scelta?.dove ?? null, tipo: scelta?.tipo, record: !!scelta?.vista?.record, giri: !!scelta?.vista?.anello, allora: !!scelta?.vista?.potenza });
  const puo = !v.pannello;
  const mondo = useMondo(worldId, puo && (dove.open || largo || !!attesa));
  const pacco = usePacco(scelta?.dove && 'world' in scelta.dove ? scelta.dove.world : worldId);

  // ?dove=… dall'indirizzo: apre il foglio, o sceglie un Dove (piano U, § 2.6)
  const letti = useRef(false);
  useEffect(() => {
    if (!scelta || letti.current) return;
    const d = params.get('dove');
    if (!d) return;
    letti.current = true;
    const w = params.get('world');
    if (w && isWorldId(w)) setWorldId(w);
    if (d === 'giro') {
      const ride = rides.find((x) => x.id === params.get('replay'));
      if (ride) setScelta({ dove: { kind: 'giro', replay: ride.id }, vista: vistaGiro(ride), piano: null, tipo: scelta.tipo === 'allenamento' ? 'libera' : scelta.tipo });
    } else if (d === 'percorso' && params.get('ride')) {
      setAttesa({ world: w && isWorldId(w) ? w : lastWorld(), ride: params.get('ride')! });
    } else if (d === 'salita' && params.get('route')) {
      const meta = routeMeta(params.get('route')!);
      if (meta) void loadRouteFile(meta.id).then((f) => setScelta({ dove: { kind: 'salita', route: meta.id }, vista: vistaSalita(trackFromRouteFile(f, meta.halfWidth), meta), piano: null }));
    } else {
      const strumento: Strumento = d === 'libero' || d === 'anello' || d === 'ab' ? d : 'lista';
      setDove({ open: true, strumento, filtro: d === 'salite' ? 'salite' : d === 'giri' ? 'giri' : 'tutti' });
    }
    setParams({}, { replace: true });
  }, [scelta, params, setParams, rides, setScelta]);
  useEffect(() => {
    if (!attesa || !mondo.data || mondo.id !== attesa.world) return;
    const ride = mondo.data.rides.find((x) => x.id === attesa.ride);
    if (ride) {
      const rec = mondo.progress.rides[ride.id];
      setScelta({ dove: { kind: 'percorso', world: mondo.id, ride: ride.id }, vista: vistaPercorso(mondo.data, ride, rec?.bestSec ? { sec: rec.bestSec, at: rec.bestAt } : null), piano: null });
    }
    setAttesa(null);
  }, [attesa, mondo, setScelta]);

  const scegli = (s: Scelto) => {
    setScelta({ dove: s.dove, vista: s.vista, piano: s.piano, giri: 1, tipo: scelta?.tipo === 'allora' && s.dove.kind !== 'giro' ? 'libera' : scelta?.tipo ?? 'libera' });
    setDove((d) => ({ ...d, open: false, strumento: 'lista', solo: false }));
  };
  const spegniProva = () => {
    try {
      sessionStorage.removeItem('orobia.prova');
    } catch {
      /* niente storage */
    }
    void updateSettings({ prova: false });
    setFoglio(false);
  };
  // ---- Come: il tipo, i watt, l'allenamento, i giri (F4) ----
  const tipo: Tipo = scelta && v.tipi.includes(scelta.tipo) ? scelta.tipo : v.tipi[0] ?? 'libera';
  const workout = scelta?.workout ? findWorkout(scelta.workout, workouts) ?? null : null;
  const watt = scelta?.watt ?? wattIniziali(profile.ftp);
  const vistaD = scelta?.vista ?? null;
  const fisica = useMemo(() => fisicaDi(profile), [profile]);
  /** secondi per un passaggio del Dove, ai watt del tipo (A14) */
  const giroSec = useMemo(() => (vistaD && vistaD.profilo.length > 1 ? stimaGiro(vistaD.profilo, wattDelTipo(tipo, profile.ftp, watt, workout), fisica) : null), [vistaD, tipo, profile.ftp, watt, workout, fisica]);
  const durataAll = workout ? workoutDuration(workout) : null;
  const aperto = !!vistaD && !vistaD.anello && scelta?.dove?.kind !== 'libero' && scelta?.dove?.kind !== 'giro' && scelta?.dove?.kind !== 'salita';
  const giriSi = !!vistaD?.anello || (aperto && tipo === 'allenamento' && !!workout);
  const now = useNow();
  const sessione = useSessioneAperta(now);
  const programma = useProgrammaOggi();
  const vv = vistaPedala(r, rete, { dove: scelta?.dove ?? null, tipo, record: !!vistaD?.record, giri: giriSi, allora: !!vistaD?.potenza, sessione: !!sessione, programma: !!programma });
  /** «Usa» del programma: Dove e Come dal giorno del programma (I3). */
  const usaProgramma = (ps: PlanSession) => {
    proposta.current = '';
    setScelta({ tipo: ps.workout ? 'allenamento' : 'libera', workout: ps.workout ?? scelta?.workout ?? null, fantasma: !ps.workout });
    if (ps.place.kind === 'percorso') {
      const w = worldOfRide(ps.place.ride) ?? lastWorld();
      setWorldId(w);
      setAttesa({ world: w, ride: ps.place.ride });
    }
    else {
      const meta = routeMeta(ps.place.route);
      if (meta) void loadRouteFile(meta.id).then((f) => setScelta({ dove: { kind: 'salita', route: meta.id }, vista: vistaSalita(trackFromRouteFile(f, meta.halfWidth), meta), piano: null }));
    }
  };
  // con un allenamento i giri si propongono da soli: durata / stima del giro (A12), il va e torna sul percorso aperto (A13)
  const proposta = useRef<string>('');
  useEffect(() => {
    if (!scelta?.dove || tipo !== 'allenamento' || !workout || !giroSec || !durataAll) return;
    const key = `${JSON.stringify(scelta.dove)}|${workout.id}`;
    if (proposta.current === key) return;
    proposta.current = key;
    const n = vistaD?.anello ? giriPer(durataAll, giroSec) : aperto ? (durataAll > giroSec * 1.08 ? 2 : 1) : 1;
    if (n !== scelta.giri) setScelta({ giri: n });
  }, [scelta?.dove, scelta?.giri, tipo, workout, giroSec, durataAll, vistaD?.anello, aperto, setScelta]);

  const sceltaTipo = (t: Tipo) => {
    setScelta({ tipo: t, watt: t === 'fissa' ? watt : scelta?.watt ?? null });
    if (t === 'allenamento' && !workout) setAllenamenti(true);
  };
  const intento = scelta && scelta.dove ? intentoDi({ ...scelta, tipo, watt: tipo === 'fissa' ? watt : scelta.watt, giri: giriSi ? scelta.giri : 1 }, vv.tipi, giriSi) : null;
  let via = intento ? `/ride?${intentoInSearch(intento)}` : null;
  // la salita col fantasma: il giro piu' veloce del diario (?route=R&ghost=ID, par. 2.2)
  if (via && intento?.dove.kind === 'salita' && intento.fantasma !== false && vistaD?.record?.ghost && tipo !== 'allenamento') via += `&ghost=${encodeURIComponent(vistaD.record.ghost)}`;
  const minutiAll = tipo === 'allenamento' && durataAll ? durataAll / 60 : undefined;
  const fineInCima = scelta?.dove?.kind === 'salita' && tipo === 'allenamento' && !!durataAll && !!giroSec && giroSec < durataAll * 0.98;

  const doveProps = {
    mondo,
    setWorld: setWorldId,
    strumento: dove.strumento,
    setStrumento: (strumento: Strumento) => setDove((d) => ({ ...d, strumento })),
    filtro: dove.filtro,
    setFiltro: (filtro: Filtro) => setDove((d) => ({ ...d, filtro })),
    onScegli: scegli,
    scelto: idScelto(scelta?.dove ?? null),
    offline: v.offline,
    schedaRide: dove.ride ?? null,
    soloStrumento: dove.solo,
    minuti: minutiAll,
    watt: wattDelTipo(tipo, profile.ftp, watt, workout),
  };
  const apriDove = () => setDove({ open: true, strumento: 'lista', filtro: dove.filtro });
  const scheda = scelta?.dove?.kind === 'percorso' ? () => setDove({ open: true, strumento: 'scheda', filtro: dove.filtro, solo: true, ride: (scelta.dove as { ride: string }).ride }) : scelta?.dove?.kind === 'libero' ? () => setDove({ open: true, strumento: 'libero', filtro: dove.filtro, solo: true }) : scelta?.dove?.kind === 'salita' ? () => navigate(`/salite/${(scelta.dove as { route: string }).route}`) : null;

  const rigaGiri = vv.blocchi.includes('giri') && !!vistaD?.anello;
  // il mondo del Dove sul telefono: «Leggero» quando c'è solo il pacco leggero (G1)
  const leggero = pacco.stato === 'leggero' && !!scelta?.dove && 'world' in scelta.dove;
  const schedaTasto = scheda ? (
    <button type="button" className="-mr-2 h-11 rounded-full px-3 font-semibold" onClick={scheda} data-testid="pedala-scheda">
      Scheda
    </button>
  ) : null;
  const pannelloScelta = scelta ? (
    <div className="flex flex-col" data-testid="pedala-scelta">
      {vv.blocchi.includes('sessione') || (programma && vv.blocchi.includes('programma')) ? (
        <div className="mb-1 flex flex-col gap-2">
          {vv.blocchi.includes('sessione') ? <SessioneRiga now={now} /> : null}
          {programma && vv.blocchi.includes('programma') ? <ProgrammaRiga s={programma} onUsa={() => usaProgramma(programma)} /> : null}
        </div>
      ) : null}
      {!largo ? (
        <div className="flex min-h-11 items-end justify-between gap-2">
          <Occhiello>Dove</Occhiello>
          {scheda && !rigaGiri ? schedaTasto : null}
        </div>
      ) : null}
      {!largo ? <DoveCard vista={vistaD} onClick={apriDove} leggero={leggero} /> : <DoveTesta vista={vistaD} leggero={leggero} />}
      {rigaGiri || (largo && scheda) ? (
        <div className="mt-1.5 flex min-h-11 items-center justify-between gap-2">
          {rigaGiri ? <Giri n={scelta.giri} durataSec={tipo === 'allenamento' && giroSec ? giroSec * scelta.giri : null} onChange={(n) => setScelta({ giri: n })} /> : <span />}
          {scheda ? schedaTasto : null}
        </div>
      ) : null}
      {vv.blocchi.includes('giri') && aperto ? <VaETorna n={Math.min(2, scelta.giri)} andataSec={giroSec} onChange={(n) => setScelta({ giri: n })} /> : null}
      {aperto && tipo === 'allenamento' && workout && vistaD?.partenza && durataAll ? (
        <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-line text-left" onClick={() => setDove({ open: true, strumento: 'anello', filtro: dove.filtro, solo: true })} data-testid="pedala-anello-per">
          <span>{`Anello da ${vistaD.partenza} per ${Math.round(durataAll / 60)} min`}</span>
          <span aria-hidden="true" className="text-muted">
            ›
          </span>
        </button>
      ) : null}
      {fineInCima && giroSec && durataAll ? <p className="mt-2 text-sm font-semibold text-warn" data-testid="pedala-fine-in-cima">{`⚠ Finisce in cima · ${Math.round(giroSec / 60)} di ${Math.round(durataAll / 60)} min`}</p> : null}
      <Occhiello>Come</Occhiello>
      <ComeSegmento tipi={vv.tipi} tipo={tipo} sa={r.sa} prova={r.prova} onChange={sceltaTipo} />
      {tipo === 'fissa' ? <WattFissi watt={watt} ftp={profile.ftp} durataSec={giroSec ? giroSec * (giriSi ? scelta.giri : 1) : null} onChange={(w) => setScelta({ watt: clampWatt(w) })} /> : null}
      {tipo === 'allenamento' ? <AllenamentoCard workout={workout} titolo={workout ? workoutTitle(workout, t) : ''} ftp={profile.ftp} onClick={() => setAllenamenti(true)} /> : null}
      {vv.blocchi.includes('fantasma') && vistaD?.record ? (
        <Fantasma on={scelta.fantasma} sec={vistaD.record.sec} at={vistaD.record.at} titolo={scelta.dove?.kind === 'giro' ? 'Contro il fantasma' : 'Contro il record'} onChange={(f) => setScelta({ fantasma: f })} />
      ) : null}
      {via ? (
        <Link to={via} className="mt-4 flex h-14 items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-accent-ink transition active:scale-[0.98]" data-testid="pedala-via">
          Via
        </Link>
      ) : (
        <button type="button" disabled className="mt-4 flex h-14 items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-accent-ink opacity-50" data-testid="pedala-via">
          Via
        </button>
      )}
      <MissioniRiga />
    </div>
  ) : null;

  return (
    <main
      className={cn('mx-auto flex w-full flex-col px-4 pb-nav pt-[max(0.5rem,env(safe-area-inset-top))] md:px-8 wide:min-h-dvh wide:pt-6', largo && puo ? 'max-w-6xl' : 'min-h-[calc(100dvh-4.5rem)] max-w-3xl')}
      data-testid="pedala"
      data-pannello={v.pannello ?? ''}
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-2">
        <Wordmark className="rail:hidden wide:hidden" />
        <h1 className="hidden font-display text-4xl uppercase leading-none wide:block">Pedala</h1>
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          {v.offline ? <ReteChip /> : null}
          {v.chip ? <RulloChip r={r} onClick={() => setFoglio(true)} /> : null}
        </span>
      </header>
      {v.pannello ? (
        <div className="flex flex-1 flex-col justify-center">
          <RulloPannello r={r} pannello={v.pannello} />
        </div>
      ) : largo ? (
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_380px] gap-6 pb-6">
          <DoveContenuto {...doveProps} strumento="lista" setStrumento={(strumento) => setDove((d) => ({ ...d, open: true, strumento, solo: true }))} colonna />
          <aside className="self-start rounded-3xl border border-line bg-elev p-4" data-testid="pedala-colonna">
            {pannelloScelta}
          </aside>
        </div>
      ) : (
        <>{pannelloScelta}</>
      )}
      {!largo ? <DoveFoglio {...doveProps} open={dove.open} onClose={() => setDove((d) => ({ ...d, open: false, strumento: 'lista', solo: false }))} /> : null}
      {largo && dove.open && dove.strumento !== 'lista' ? <DoveFoglio {...doveProps} open onClose={() => setDove((d) => ({ ...d, open: false, strumento: 'lista', solo: false }))} /> : null}
      <AllenamentoFoglio
        open={allenamenti}
        onClose={() => setAllenamenti(false)}
        scelto={scelta?.workout ?? null}
        onScegli={(w) => {
          proposta.current = '';
          setScelta({ workout: w.id, tipo: 'allenamento' });
          setAllenamenti(false);
        }}
      />
      <RulloFoglio r={r} open={foglio} onClose={chiudiFoglio} onSpegniProva={spegniProva} />
    </main>
  );
}

function Occhiello({ children }: { children: ReactNode }) {
  return <p className="eyebrow mb-1.5 mt-2">{children}</p>;
}

/** La pianta in miniatura del Dove scelto. */
function Miniatura({ vista, className }: { vista: VistaDove | null; className?: string }) {
  const pts = vista?.traccia ?? [];
  const d = useMemo(() => {
    let s = '';
    for (let i = 0; i + 1 < pts.length; i += 2) s += `${i ? 'L' : 'M'}${pts[i] + 10} ${pts[i + 1] + 10}`;
    return s;
  }, [pts]);
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-xl bg-elev2', className)} aria-hidden="true">
      <svg viewBox="0 0 120 120" className="h-full w-full">
        {d ? (
          <>
            <path d={d} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={pts[0] + 10} cy={pts[1] + 10} r="6" fill="var(--bg)" stroke="var(--accent)" strokeWidth="3" />
          </>
        ) : (
          <path d="M20 86c18-4 22-30 40-34s26 18 40 10" fill="none" stroke="var(--muted)" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 10" />
        )}
      </svg>
    </span>
  );
}

function Numeri({ vista, leggero = false }: { vista: VistaDove; leggero?: boolean }) {
  const km = vista.lunghezzaM != null ? formatKmText(vista.lunghezzaM) : null;
  const m = vista.dislivelloM != null ? formatGainText(vista.dislivelloM) : null;
  return (
    <span className="num mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      {km || m ? <b className="whitespace-nowrap">{[km, m].filter(Boolean).join(' · ')}</b> : null}
      <span className="inline-flex items-center rounded-full border border-line px-2 py-px text-xs font-semibold">{vista.gettone}</span>
      {leggero ? (
        <span className="inline-flex items-center rounded-full border border-line px-2 py-px text-xs font-semibold" data-testid="pedala-leggero">
          Leggero
        </span>
      ) : null}
    </span>
  );
}

/** Il Dove scelto (C1): miniatura, nome, da dove a dove, i numeri. Un tocco apre Dove. */
function DoveCard({ vista, onClick, leggero }: { vista: VistaDove | null; onClick: () => void; leggero?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-elev p-2.5 text-left" data-testid="pedala-dove">
      <Miniatura vista={vista} className="h-[84px] w-[84px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="font-semibold leading-snug" data-testid="pedala-dove-titolo">
            {vista?.titolo ?? 'Scegli dove pedalare'}
          </span>
          <span aria-hidden="true" className="text-lg leading-none text-muted">
            ›
          </span>
        </span>
        {vista ? <span className="block text-sm leading-snug text-muted">{vista.sotto}</span> : null}
        {vista ? <Numeri vista={vista} leggero={leggero} /> : <span className="block text-sm text-muted">Percorsi, anelli, salite, i tuoi giri</span>}
      </span>
    </button>
  );
}

/** Sul computer, in testa alla colonna di destra (P1): il nome e i numeri, e l'altimetria. */
function DoveTesta({ vista, leggero }: { vista: VistaDove | null; leggero?: boolean }) {
  if (!vista) return <p className="font-semibold text-muted">Scegli dove pedalare</p>;
  return (
    <div data-testid="pedala-dove">
      <p className="font-display text-2xl leading-tight">{vista.titolo}</p>
      <p className="text-sm text-muted">{vista.sotto}</p>
      <Numeri vista={vista} leggero={leggero} />
      <Altimetria profilo={vista.profilo} />
    </div>
  );
}

function Altimetria({ profilo }: { profilo: [number, number][] }) {
  const d = useMemo(() => {
    if (profilo.length < 2) return '';
    const L = profilo[profilo.length - 1][0] || 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (const [, a] of profilo) {
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    const span = Math.max(40, hi - lo);
    let s = `M0 46`;
    for (const [x, a] of profilo) s += ` L${((x / L) * 300).toFixed(1)} ${(46 - ((a - lo) / span) * 40).toFixed(1)}`;
    return `${s} L300 46 Z`;
  }, [profilo]);
  if (!d) return null;
  return (
    <svg viewBox="0 0 300 48" className="mt-2 h-12 w-full" aria-hidden="true" preserveAspectRatio="none">
      <path d={d} fill="color-mix(in oklab, var(--accent) 30%, transparent)" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
