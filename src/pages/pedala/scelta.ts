import { loadKv, saveKv } from '@/db/db';
import { STANDARD_AIR, type PhysicsParams } from '@/domain/physics';
import { giriPer, stimaSecondi, wattMedi } from '@/domain/stima';
import { chiuso } from '@/open/passaggi';
import type { LoadedRoute, RouteMeta } from '@/domain/routes';
import type { Profile, Ride, Workout } from '@/domain/types';
import { workoutDuration } from '@/domain/workouts';
import type { Leg } from '@/open/graph';
import { loadPlan, savePlan } from '@/open/plan';
import type { RideDef, WorldData } from '@/open/world';
import type { Dove, Intento, Tipo } from '@/ride/contract';
import { cap } from '@/domain/format';

/*
 * La scelta di Pedala: Dove + Come, ricordata in IndexedDB (kv `pedala`, piano U, A21). Ripetere
 * l'ultimo giro è un tocco, «Via». Con il Dove si tiene anche come mostrarlo (nome, km, la traccia
 * in miniatura, il profilo per la stima dei giri): Pedala si apre senza caricare il mondo.
 */

export type Gettone = 'Anello' | 'Salita' | 'Percorso' | 'Giro libero' | 'Tuo giro';

/** Come si mostra un Dove, calcolato quando lo si sceglie. */
export interface VistaDove {
  titolo: string;
  sotto: string;
  lunghezzaM: number | null;
  dislivelloM: number | null;
  gettone: Gettone;
  /** si chiude su sé stesso: si ripete a giri (A12) */
  anello: boolean;
  /** la pianta in miniatura: x, y alternati, 0–100 */
  traccia: number[];
  /** [metri dal via, quota]: al massimo 160 punti, per la stima dei tempi */
  profilo: [number, number][];
  /** il paese di partenza, per «Anello da … per N min» */
  partenza?: string;
  /** il record da battere (secondi) e quando, per «Contro il record» */
  record?: { sec: number; at: string | null; ghost?: string } | null;
  /** un tuo giro con la potenza: «Watt di allora» (A7) */
  potenza?: boolean;
}

export interface Scelta {
  dove: Dove | null;
  vista: VistaDove | null;
  tipo: Tipo;
  /** l'ultimo valore di Potenza fissa; null = la prima volta, dal 75 % dell'FTP */
  watt: number | null;
  workout: string | null;
  giri: number;
  fantasma: boolean;
  /** un anello o un A → B: le strade, per ritrovarlo dopo un riavvio (savePlan vive nella scheda) */
  piano: { name: string; legs: [number, 1 | -1][] } | null;
}

export const SCELTA_VUOTA: Scelta = { dove: null, vista: null, tipo: 'libera', watt: null, workout: null, giri: 1, fantasma: true, piano: null };

const KEY = 'pedala';

export async function leggiScelta(): Promise<Scelta> {
  const s = await loadKv<Partial<Scelta>>(KEY).catch(() => undefined);
  const out: Scelta = { ...SCELTA_VUOTA, ...(s ?? {}) };
  // un anello di ieri: la scheda nuova non ha più il suo piano, lo si rimette da parte
  if (out.dove?.kind === 'piano' && out.piano && !loadPlan(out.dove.plan)) {
    out.dove = { ...out.dove, plan: savePlan({ name: out.piano.name, legs: out.piano.legs.map(([edge, dir]) => ({ edge, dir })) }) };
  }
  return out;
}

export function salvaScelta(s: Scelta): Promise<void> {
  return saveKv(KEY, s).catch(() => undefined);
}

// ---------- potenza fissa ----------

export const WATT_MIN = 50;
export const WATT_MAX = 1000;

/** La prima volta: il 75 % dell'FTP, arrotondato a 5 (A7). */
export function wattIniziali(ftp: number): number {
  return clampWatt(Math.round((ftp * 0.75) / 5) * 5);
}

export function clampWatt(w: number): number {
  return Math.min(WATT_MAX, Math.max(WATT_MIN, Math.round(w / 5) * 5));
}

// ---------- la vista di un Dove ----------

/** Riduce una linea a ~n punti e la normalizza in 0–100 (y verso il basso, nord in alto). */
export function traccia(points: readonly { x: number; z: number }[], n = 48): number[] {
  if (points.length < 2) return [];
  const step = Math.max(1, Math.floor(points.length / n));
  const pick = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of pick) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  const span = Math.max(x1 - x0, z1 - z0, 1);
  const ox = (span - (x1 - x0)) / 2;
  const oz = (span - (z1 - z0)) / 2;
  const out: number[] = [];
  for (const p of pick) out.push(Math.round(((p.x - x0 + ox) / span) * 100), Math.round(((p.z - z0 + oz) / span) * 100));
  return out;
}

/** Riduce un profilo a ~n punti. */
export function riduci(profilo: [number, number][], n = 160): [number, number][] {
  if (profilo.length <= n) return profilo;
  const step = profilo.length / n;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push(profilo[Math.floor(i * step)]);
  out.push(profilo[profilo.length - 1]);
  return out;
}

/** Le strade di una sequenza di archi: punti in pianta e profilo. */
export function lineaDiLegs(data: WorldData, legs: readonly Leg[]): { punti: { x: number; z: number }[]; profilo: [number, number][] } {
  const punti: { x: number; z: number }[] = [];
  const profilo: [number, number][] = [];
  let d = 0;
  for (const l of legs) {
    const e = data.graph.edges[l.edge];
    if (!e) continue;
    const n = e.xs.length;
    for (let k = 0; k < n; k++) {
      const i = l.dir > 0 ? k : n - 1 - k;
      const prev = punti[punti.length - 1];
      if (prev) d += Math.hypot(e.xs[i] - prev.x, e.zs[i] - prev.z);
      punti.push({ x: e.xs[i], z: e.zs[i] });
      profilo.push([Math.round(d), Math.round(e.ys[i])]);
    }
  }
  return { punti, profilo };
}

/** Un percorso si chiude su sé stesso se arrivo e partenza stanno a meno di 150 m. */
export function siChiude(punti: readonly { x: number; z: number }[]): boolean {
  if (punti.length < 3) return false;
  const a = punti[0];
  const b = punti[punti.length - 1];
  return Math.hypot(a.x - b.x, a.z - b.z) < 150;
}

const salitaGain = (profilo: [number, number][]) => {
  let g = 0;
  for (let i = 1; i < profilo.length; i++) g += Math.max(0, profilo[i][1] - profilo[i - 1][1]);
  return Math.round(g);
};

export function vistaPercorso(data: WorldData, ride: RideDef, record?: VistaDove['record']): VistaDove {
  const legs = ride.legs.map(([edge, dir]) => ({ edge, dir }));
  const { punti, profilo } = lineaDiLegs(data, legs);
  const anello = chiuso(data.graph, legs);
  return {
    titolo: ride.name,
    sotto: cap(ride.side),
    lunghezzaM: ride.lengthM,
    dislivelloM: ride.gainM,
    gettone: anello ? 'Anello' : ride.kind === 'salita' ? 'Salita' : 'Percorso',
    anello,
    traccia: traccia(punti),
    profilo: riduci(profilo),
    partenza: ride.side.split(/[,·]/)[0]?.replace(/^(da|dal|dalla)\s+/i, '').trim() || undefined,
    record: record ?? null,
  };
}

export function vistaPiano(data: WorldData, legs: readonly Leg[], titolo: string, sotto: string, partenza?: string): VistaDove {
  const { punti, profilo } = lineaDiLegs(data, legs);
  const anello = chiuso(data.graph, [...legs]);
  const p = riduci(profilo);
  return {
    titolo,
    sotto,
    lunghezzaM: profilo.length ? profilo[profilo.length - 1][0] : null,
    dislivelloM: salitaGain(profilo),
    gettone: anello ? 'Anello' : 'Percorso',
    anello,
    traccia: traccia(punti),
    profilo: p,
    partenza,
  };
}

export function vistaLibero(paese: string): VistaDove {
  return { titolo: 'Giro libero', sotto: `Da ${paese}`, lunghezzaM: null, dislivelloM: null, gettone: 'Giro libero', anello: false, traccia: [], profilo: [], partenza: paese };
}

export function vistaSalita(route: LoadedRoute, meta: RouteMeta, record?: VistaDove['record']): VistaDove {
  const pts = route.track.points;
  const profilo: [number, number][] = [];
  const L = route.track.length;
  for (let d = 0; d <= L; d += Math.max(50, L / 160)) {
    const p = route.track.poseAt(Math.min(d, L));
    profilo.push([Math.round(p.distance), Math.round(p.altitude)]);
  }
  return {
    titolo: meta.name,
    sotto: cap(meta.side),
    lunghezzaM: L,
    dislivelloM: profilo.length ? Math.max(0, profilo[profilo.length - 1][1] - profilo[0][1]) : null,
    gettone: 'Salita',
    anello: false,
    traccia: traccia(pts),
    profilo: riduci(profilo),
    record: record ?? null,
  };
}

export function vistaGiro(ride: Ride): VistaDove {
  const gps = ride.samples.filter((s) => typeof s.lat === 'number' && typeof s.lon === 'number');
  const lat0 = gps[0]?.lat ?? 0;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const punti = gps.map((s) => ({ x: (s.lon ?? 0) * 111_320 * k, z: -(s.lat ?? 0) * 110_540 }));
  const profilo = riduci(ride.samples.filter((s) => Number.isFinite(s.distance)).map((s) => [Math.round(s.distance), Math.round(s.altitude)] as [number, number]));
  return {
    titolo: ride.name,
    sotto: cap(new Date(ride.startTime).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })),
    lunghezzaM: ride.distanceM,
    dislivelloM: ride.elevationGainM,
    gettone: 'Tuo giro',
    anello: false,
    traccia: traccia(punti),
    profilo,
    record: { sec: ride.durationSec, at: ride.startTime },
    potenza: ride.samples.some((s) => s.power > 0),
  };
}

// ---------- stime ----------

export function fisicaDi(p: Pick<Profile, 'weightKg' | 'bikeWeightKg' | 'cda' | 'crr'>): PhysicsParams {
  return { massKg: p.weightKg + p.bikeWeightKg, cda: p.cda, crr: p.crr, ...STANDARD_AIR };
}

/** Secondi per un passaggio del profilo a watt costanti: la fisica del motore, senza scia né vento (A14). */
export function stimaGiro(profilo: readonly [number, number][], watt: number, fisica: PhysicsParams): number {
  return stimaSecondi(profilo.map(([distance, altitude]) => ({ distance, altitude })), watt, fisica);
}

/** I watt con cui si stima un giro, per tipo (A14). */
export function wattDelTipo(tipo: Tipo, ftp: number, watt: number | null, w: Workout | null): number {
  if (tipo === 'fissa') return watt ?? wattIniziali(ftp);
  if (tipo === 'allenamento' && w) return wattMedi(w, ftp);
  return ftp * 0.75;
}

/** I giri proposti per un allenamento su un anello (piano U, § 3 «Prove»). */
export function giriProposti(w: Workout, vista: Pick<VistaDove, 'profilo'>, profilo: Profile): number {
  const giro = stimaGiro(vista.profilo, wattMedi(w, profilo.ftp), fisicaDi(profilo));
  return giriPer(workoutDuration(w), giro);
}

// ---------- il link della corsa ----------

/**
 * L'intento della scelta, coi tipi che il rullo permette; null se manca il Dove. `conGiri`: il Dove
 * si fa a passaggi (un anello, il va e torna) e i giri vanno nel link anche quando è uno solo, così
 * un allenamento più lungo aggiunge da sé un giro (A12).
 */
export function intentoDi(s: Scelta, tipi: readonly Tipo[], conGiri = false): Intento | null {
  if (!s.dove) return null;
  const tipo = tipi.includes(s.tipo) ? s.tipo : tipi[0] ?? 'libera';
  const i: Intento = { dove: s.dove, tipo };
  if (tipo === 'fissa') i.watt = s.watt ?? undefined;
  if (tipo === 'allenamento' && s.workout) i.workout = s.workout;
  if (tipo === 'allenamento' && !s.workout) i.tipo = 'libera';
  if (conGiri || s.giri > 1) i.giri = Math.max(1, s.giri);
  if (!s.fantasma) i.fantasma = false;
  return i;
}
