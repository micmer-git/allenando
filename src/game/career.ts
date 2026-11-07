import { loadKv, saveKv } from '@/db/db';
import { ACHIEVEMENTS, type Achievement } from './achievements';
import { DEFAULT_EQUIPPED, ITEM_BY_ID, STARTER_ITEMS, type Slot } from './kit';
import { advanceSeries, missionsFor, SERIES, type Mission, type SeriesStep } from './missions';
import type { SegmentKind } from './arches';

/**
 * La carriera: oro, guardaroba, traguardi, record dei tratti, serie di giorni e missioni.
 * Vive sul dispositivo (IndexedDB, chiave `career`) come i giri. I punti esperienza e il
 * livello restano in src/open/progress.ts, che li manda alla classifica.
 */

export interface PersonalBest {
  sec: number;
  at: string;
  sim: boolean;
  count: number;
}

export interface Career {
  v: 1;
  oro: number;
  /** oro guadagnato da sempre (non scende quando si compra) */
  oroTotal: number;
  owned: string[];
  equipped: Record<Slot, string>;
  /** id del traguardo → quando è stato preso */
  achievements: Record<string, string>;
  /** id del tratto (volata, GPM, crono, salita) → miglior tempo */
  pbs: Record<string, PersonalBest>;
  counts: {
    rides: number;
    km: number;
    gainM: number;
    volata: number;
    gpm: number;
    crono: number;
    /** volate del cassonetto */
    cassonetto: number;
    sessions: number;
    workouts: number;
    night: number;
    rain: number;
    dawn: number;
    rooms: number;
    pois: number;
    /** id → volte */
    climbs: Record<string, number>;
    worldRides: Record<string, number>;
  };
  streak: { days: number; best: number; last: string };
  missions: { day: string; done: string[] };
  /** le serie di missioni (missions.ts): id della serie → tappe fatte */
  series: Record<string, string[]>;
}

export const EMPTY_CAREER: Career = {
  v: 1,
  oro: 0,
  oroTotal: 0,
  owned: [],
  equipped: { ...DEFAULT_EQUIPPED },
  achievements: {},
  pbs: {},
  counts: { rides: 0, km: 0, gainM: 0, volata: 0, gpm: 0, crono: 0, cassonetto: 0, sessions: 0, workouts: 0, night: 0, rain: 0, dawn: 0, rooms: 0, pois: 0, climbs: {}, worldRides: {} },
  streak: { days: 0, best: 0, last: '' },
  missions: { day: '', done: [] },
  series: {},
};

export async function loadCareer(): Promise<Career> {
  const c = await loadKv<Partial<Career>>('career');
  return normalize(c);
}

export function normalize(c: Partial<Career> | null | undefined): Career {
  const base = structuredClone(EMPTY_CAREER);
  if (!c) return base;
  return {
    ...base,
    ...c,
    owned: [...(c.owned ?? [])],
    equipped: { ...base.equipped, ...(c.equipped ?? {}) },
    achievements: { ...(c.achievements ?? {}) },
    pbs: { ...(c.pbs ?? {}) },
    counts: { ...base.counts, ...(c.counts ?? {}), climbs: { ...(c.counts?.climbs ?? {}) }, worldRides: { ...(c.counts?.worldRides ?? {}) } },
    streak: { ...base.streak, ...(c.streak ?? {}) },
    missions: { ...base.missions, ...(c.missions ?? {}) },
    series: Object.fromEntries(Object.entries(c.series ?? {}).map(([k, v]) => [k, [...(v ?? [])]])),
  };
}

export async function saveCareer(c: Career): Promise<void> {
  await saveKv('career', c);
}

/** Le regole dell'oro, scritte qui per poterle mostrare. */
export const ORO_RULES = {
  perKm: 2,
  per100m: 6,
  volata: 15,
  gpm: 25,
  crono: 30,
  cassonetto: 12,
  personalBest: 20,
  session: 60,
  sessionPack: 40,
  poi: 4,
} as const;

export interface SegmentResult {
  id: string;
  kind: SegmentKind;
  name: string;
  sec: number;
  /** watt medi per kg nel tratto */
  wkg: number;
  /** distanza del tratto, metri; dislivello positivo, metri */
  lengthM: number;
  gainM: number;
}

/** Tutto quello che un giro finito racconta alla carriera. */
export interface RideFacts {
  distanceM: number;
  gainM: number;
  durationSec: number;
  sim: boolean;
  /** quando è partito, ora locale */
  startedAt: Date;
  /** potenza: media, picchi di 5 s e di 5 minuti, e la FTP di allora */
  avgPower: number;
  peak5s: number;
  peak5min: number;
  ftp: number;
  /** id della salita verificata finita, se c'è */
  climbDone?: string;
  /** id del percorso del mondo finito senza uscirne */
  worldRideDone?: string;
  segments: SegmentResult[];
  /** punti caldi (fontanelle, belvederi, campanili…) passati */
  pois: string[];
  /** luoghi del mondo passati (landmark) */
  landmarks: string[];
  /** quanti luoghi del mondo si sono scoperti in tutto, dopo questo giro */
  discovered: number;
  /** pioveva, nel mondo col meteo vero */
  rain: boolean;
  /** era notte, nel mondo con l'ora vera */
  night: boolean;
  /** una sessione di gruppo: finita, e quanta parte col gruppo (0-1) */
  session?: { id: string; kind: string; finished: boolean; withPack: number };
  /** allenamento ERG completato */
  workoutDone: boolean;
  /** pedalato in una stanza o con altri ciclisti veri vicini */
  together: boolean;
  /** livello dopo il giro (da progress.ts) */
  level: number;
  /** oro in più deciso da chi chiama (per esempio i tratti doppi di una sessione) */
  extra?: OroLine[];
}

export interface OroLine {
  label: string;
  oro: number;
}

export interface CareerOutcome {
  next: Career;
  lines: OroLine[];
  total: number;
  /** traguardi presi in questo giro */
  unlocked: Achievement[];
  /** tratti in cui si è fatto il record personale */
  pbs: string[];
  /** missioni del giorno completate in questo giro */
  missions: Mission[];
  /** tappe delle serie prese in questo giro, con la serie */
  steps: { series: string; step: SeriesStep }[];
  /** pezzi del guardaroba sbloccati dai traguardi */
  items: string[];
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function prevDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y, m - 1, d - 1);
  return dayKey(t);
}

/** Applica un giro alla carriera: oro, contatori, record, serie, missioni, traguardi. Non salva. */
export function applyCareer(prev: Career, f: RideFacts, now = new Date()): CareerOutcome {
  const next = normalize(prev);
  const lines: OroLine[] = [];
  const km = f.distanceM / 1000;
  const real = km >= 0.2 || f.durationSec >= 120;
  if (km >= 0.2) lines.push({ label: `${km.toFixed(1).replace('.', ',')} km`, oro: Math.round(km * ORO_RULES.perKm) });
  if (f.gainM >= 50) lines.push({ label: `${Math.round(f.gainM)} m in salita`, oro: Math.floor(f.gainM / 100) * ORO_RULES.per100m + (f.gainM % 100 >= 50 ? ORO_RULES.per100m / 2 : 0) });

  // tratti: volate, GPM, crono, cassonetti, salite
  const pbs: string[] = [];
  for (const s of f.segments) {
    const base = ORO_RULES[s.kind];
    lines.push({ label: s.kind === 'cassonetto' ? s.name : `${s.kind === 'volata' ? 'Volata' : s.kind === 'gpm' ? 'GPM' : 'Crono'}: ${s.name}`, oro: base });
    next.counts[s.kind] += 1;
    const old = next.pbs[s.id];
    if (!old || s.sec < old.sec) {
      if (old) {
        pbs.push(s.id);
        lines.push({ label: `Record personale: ${s.name}`, oro: ORO_RULES.personalBest });
      }
      next.pbs[s.id] = { sec: Math.round(s.sec * 10) / 10, at: now.toISOString(), sim: f.sim, count: (old?.count ?? 0) + 1 };
    } else next.pbs[s.id] = { ...old, count: old.count + 1 };
  }
  for (const l of f.extra ?? []) lines.push(l);
  if (f.pois.length) lines.push({ label: f.pois.length === 1 ? '1 punto caldo' : `${f.pois.length} punti caldi`, oro: f.pois.length * ORO_RULES.poi });
  if (f.session) {
    next.counts.sessions += f.session.finished ? 1 : 0;
    if (f.session.finished) lines.push({ label: 'Sessione finita', oro: ORO_RULES.session });
    if (f.session.finished && f.session.withPack >= 0.7) lines.push({ label: 'Arrivato col gruppo', oro: ORO_RULES.sessionPack });
  }

  // contatori
  if (real) {
    next.counts.rides += 1;
    next.counts.km += km;
    next.counts.gainM += f.gainM;
    if (f.night) next.counts.night += 1;
    if (f.rain) next.counts.rain += 1;
    const h = f.startedAt.getHours();
    if (h >= 4 && h < 7) next.counts.dawn += 1;
    if (f.workoutDone) next.counts.workouts += 1;
    if (f.together) next.counts.rooms += 1;
    next.counts.pois += f.pois.length;
    if (f.climbDone) next.counts.climbs[f.climbDone] = (next.counts.climbs[f.climbDone] ?? 0) + 1;
    if (f.worldRideDone) next.counts.worldRides[f.worldRideDone] = (next.counts.worldRides[f.worldRideDone] ?? 0) + 1;
  }

  // la serie di giorni in fila
  const today = dayKey(now);
  if (real && next.streak.last !== today) {
    next.streak.days = next.streak.last === prevDay(today) ? next.streak.days + 1 : 1;
    next.streak.last = today;
    next.streak.best = Math.max(next.streak.best, next.streak.days);
    if (next.streak.days >= 2) lines.push({ label: `${next.streak.days} giorni di fila`, oro: Math.min(70, 10 * next.streak.days) });
  }

  // missioni del giorno
  if (next.missions.day !== today) next.missions = { day: today, done: [] };
  const missions: Mission[] = [];
  for (const m of missionsFor(today)) {
    if (next.missions.done.includes(m.id)) continue;
    if (m.check(f)) {
      next.missions.done.push(m.id);
      missions.push(m);
      lines.push({ label: `Missione: ${m.title}`, oro: m.oro });
    }
  }

  // le serie: tappe nell'ordine, la maglia alla fine
  const steps: CareerOutcome['steps'] = [];
  const items: string[] = [];
  for (const s of SERIES) {
    const adv = advanceSeries(s, next.series[s.id] ?? [], f);
    if (!adv.fresh.length) continue;
    next.series[s.id] = adv.done;
    for (const step of adv.fresh) {
      steps.push({ series: s.id, step });
      lines.push({ label: `${s.name}: ${step.title}`, oro: step.oro });
    }
    if (adv.completed) {
      lines.push({ label: `Serie ${s.name} finita`, oro: s.oro });
      for (const [id, item] of ITEM_BY_ID) {
        if (item.series === s.id && !next.owned.includes(id)) {
          next.owned.push(id);
          items.push(id);
        }
      }
    }
  }

  // traguardi
  const unlocked: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (next.achievements[a.id]) continue;
    if (a.check(next, f)) {
      next.achievements[a.id] = now.toISOString();
      unlocked.push(a);
      if (a.oro) lines.push({ label: `Traguardo: ${a.name}`, oro: a.oro });
      for (const it of a.items ?? []) {
        if (!next.owned.includes(it)) {
          next.owned.push(it);
          items.push(it);
        }
      }
    }
  }
  // pezzi legati a un traguardo già preso (anche se il catalogo cresce dopo)
  for (const [id] of ITEM_BY_ID) {
    const item = ITEM_BY_ID.get(id)!;
    if (item.achievement && next.achievements[item.achievement] && !next.owned.includes(id)) {
      next.owned.push(id);
      items.push(id);
    }
  }

  const total = lines.reduce((s, l) => s + l.oro, 0);
  next.oro += total;
  next.oroTotal += total;
  return { next, lines, total, unlocked, pbs, missions, steps, items };
}

/** A che punto è una serie: tappe fatte su tappe totali. */
export function seriesProgress(c: Career, seriesId: string): { done: number; total: number; finished: boolean } {
  const s = SERIES.find((x) => x.id === seriesId);
  const done = (c.series[seriesId] ?? []).length;
  const total = s?.steps.length ?? 0;
  return { done, total, finished: total > 0 && done >= total };
}

/** Compra un pezzo: ritorna la carriera nuova, o un motivo. */
export function buy(c: Career, id: string, level: number): { ok: true; next: Career } | { ok: false; why: string } {
  const item = ITEM_BY_ID.get(id);
  if (!item) return { ok: false, why: 'Pezzo sconosciuto.' };
  if (c.owned.includes(id) || STARTER_ITEMS.includes(id)) return { ok: false, why: 'Ce l’hai già.' };
  if (item.achievement) return { ok: false, why: 'Si sblocca con un traguardo.' };
  if (item.series) return { ok: false, why: 'Si sblocca finendo una serie di missioni.' };
  if (item.level && level < item.level) return { ok: false, why: `Serve il livello ${item.level}.` };
  if (c.oro < item.price) return { ok: false, why: `Mancano ${item.price - c.oro} d’oro.` };
  const next = normalize(c);
  next.oro -= item.price;
  next.owned.push(id);
  return { ok: true, next };
}

export function equip(c: Career, id: string): Career {
  const item = ITEM_BY_ID.get(id);
  if (!item) return c;
  if (!c.owned.includes(id) && !STARTER_ITEMS.includes(id)) return c;
  return { ...c, equipped: { ...c.equipped, [item.slot]: id } };
}

export function owns(c: Career, id: string): boolean {
  return c.owned.includes(id) || STARTER_ITEMS.includes(id);
}
