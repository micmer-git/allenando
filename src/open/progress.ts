import { loadKv, saveKv } from '@/db/db';
import { ROOMS_URL } from '@/multiplayer/room';
import { isoWeek, type BoardRow, type XpRow } from '@/multiplayer/world-protocol';
import { devicePid } from '@/multiplayer/world-client';

/**
 * Punti esperienza, livelli e luoghi scoperti. Si contano sul dispositivo (IndexedDB, chiave
 * `world`) e il totale si manda alla classifica se c'è rete. Le regole sono poche e scritte
 * qui, così chi pedala sa perché ha preso dei punti.
 */

export const XP_RULES = {
  perKm: 10,
  /** per ogni 10 m di dislivello positivo */
  per10m: 1,
  landmarkFirst: 25,
  landmarkAgain: 3,
  rideFirst: 120,
  rideAgain: 40,
  personalBest: 60,
  firstOfDay: 30,
} as const;

export interface RideRecord {
  count: number;
  bestSec: number | null;
  bestAt: string | null;
  /** il miglior tempo era col simulatore? */
  bestSim: boolean;
}

export interface WorldProgress {
  xp: number;
  week: string;
  weekXp: number;
  km: number;
  gainM: number;
  visited: Record<string, string>;
  rides: Record<string, RideRecord>;
  lastDay: string;
}

export const EMPTY_PROGRESS: WorldProgress = { xp: 0, week: '', weekXp: 0, km: 0, gainM: 0, visited: {}, rides: {}, lastDay: '' };

export async function loadProgress(): Promise<WorldProgress> {
  const p = await loadKv<WorldProgress>('world');
  return { ...EMPTY_PROGRESS, ...p, visited: { ...(p?.visited ?? {}) }, rides: { ...(p?.rides ?? {}) } };
}

export async function saveProgress(p: WorldProgress): Promise<void> {
  await saveKv('world', p);
}

/** Punti necessari per arrivare al livello L (L ≥ 1): 0, 500, 1500, 3000, 5000… */
export function xpForLevel(level: number): number {
  return (500 * (level - 1) * level) / 2;
}

export function levelOf(xp: number): { level: number; from: number; to: number; title: string } {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, from: xpForLevel(level), to: xpForLevel(level + 1), title: levelTitle(level) };
}

const TITLES: [number, string][] = [
  [1, 'Pedalatore della domenica'],
  [3, 'Habitué della Maresana'],
  [5, 'Gregario della Val Seriana'],
  [8, 'Scalatore delle Orobie'],
  [12, 'Re dei passi bergamaschi'],
  [18, 'Leggenda della Presolana'],
];

export function levelTitle(level: number): string {
  let t = TITLES[0][1];
  for (const [l, name] of TITLES) if (level >= l) t = name;
  return t;
}

export interface XpLine {
  label: string;
  xp: number;
}

export interface RideOutcome {
  rideId?: string;
  /** il percorso è stato fatto tutto, nell'ordine, senza uscirne */
  completed: boolean;
  sec?: number;
  sim: boolean;
  distanceM: number;
  gainM: number;
  /** luoghi passati in questo giro */
  landmarks: string[];
}

/** Applica un giro ai progressi: ritorna le righe dei punti e i progressi nuovi (senza salvarli). */
export function applyRide(prev: WorldProgress, out: RideOutcome, now = new Date()): { next: WorldProgress; lines: XpLine[]; personalBest: boolean } {
  const next: WorldProgress = { ...prev, visited: { ...prev.visited }, rides: { ...prev.rides } };
  const lines: XpLine[] = [];
  const km = out.distanceM / 1000;
  if (km >= 0.05) lines.push({ label: `${km.toFixed(1).replace('.', ',')} km`, xp: Math.round(km * XP_RULES.perKm) });
  if (out.gainM >= 10) lines.push({ label: `${Math.round(out.gainM)} m di dislivello`, xp: Math.floor(out.gainM / 10) * XP_RULES.per10m });
  let fresh = 0;
  let again = 0;
  for (const id of new Set(out.landmarks)) {
    if (next.visited[id]) again++;
    else {
      fresh++;
      next.visited[id] = now.toISOString();
    }
  }
  if (fresh) lines.push({ label: fresh === 1 ? '1 luogo scoperto' : `${fresh} luoghi scoperti`, xp: fresh * XP_RULES.landmarkFirst });
  if (again) lines.push({ label: again === 1 ? '1 luogo ripassato' : `${again} luoghi ripassati`, xp: again * XP_RULES.landmarkAgain });
  let personalBest = false;
  if (out.rideId && out.completed) {
    const rec = next.rides[out.rideId] ?? { count: 0, bestSec: null, bestAt: null, bestSim: false };
    lines.push({ label: rec.count === 0 ? 'Percorso completato, la prima volta' : 'Percorso completato', xp: rec.count === 0 ? XP_RULES.rideFirst : XP_RULES.rideAgain });
    if (out.sec != null && (rec.bestSec == null || out.sec < rec.bestSec)) {
      if (rec.bestSec != null) {
        personalBest = true;
        lines.push({ label: 'Record personale', xp: XP_RULES.personalBest });
      }
      rec.bestSec = Math.round(out.sec);
      rec.bestAt = now.toISOString();
      rec.bestSim = out.sim;
    }
    rec.count += 1;
    next.rides[out.rideId] = rec;
  }
  const day = now.toISOString().slice(0, 10);
  if (lines.length && next.lastDay !== day) {
    lines.push({ label: 'Primo giro della giornata', xp: XP_RULES.firstOfDay });
    next.lastDay = day;
  }
  const total = lines.reduce((s, l) => s + l.xp, 0);
  const week = isoWeek(now);
  next.weekXp = (next.week === week ? next.weekXp : 0) + total;
  next.week = week;
  next.xp += total;
  next.km += km;
  next.gainM += out.gainM;
  return { next, lines, personalBest };
}

// ---------- classifica in rete ----------

const base = () => ROOMS_URL.replace(/\/$/, '');

export async function postResult(r: { nick: string; ride: string; sec: number; wkg: number; sim: boolean }): Promise<{ ok: boolean; rank?: number; best?: boolean; error?: string }> {
  try {
    const res = await fetch(`${base()}/board/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: devicePid(), ...r }) });
    return (await res.json()) as { ok: boolean; rank?: number; best?: boolean; error?: string };
  } catch {
    return { ok: false, error: 'rete' };
  }
}

export async function postXp(p: WorldProgress, nick: string): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/board/xp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pid: devicePid(), nick, xp: p.xp, week: p.week || isoWeek(new Date()), wxp: p.weekXp }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchRideBoard(ride: string, sim: boolean): Promise<{ total: number; rows: BoardRow[]; mine: { rank: number; sec: number } | null } | null> {
  try {
    const res = await fetch(`${base()}/board/ride/${encodeURIComponent(ride)}?sim=${sim ? 1 : 0}&pid=${devicePid()}`);
    if (!res.ok) return null;
    return (await res.json()) as { total: number; rows: BoardRow[]; mine: { rank: number; sec: number } | null };
  } catch {
    return null;
  }
}

export async function fetchXpBoard(scope: 'week' | 'all'): Promise<XpRow[] | null> {
  try {
    const res = await fetch(`${base()}/board/xp?scope=${scope}&pid=${devicePid()}`);
    if (!res.ok) return null;
    return ((await res.json()) as { rows: XpRow[] }).rows;
  } catch {
    return null;
  }
}
