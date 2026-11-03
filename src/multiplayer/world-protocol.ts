/**
 * Il mondo aperto condiviso e la classifica. Come protocol.ts, lo usano l'app e il Worker
 * (server/allenando-room): stesse regole di validazione dai due lati.
 *
 * Nel mondo si vede chi sta pedalando adesso, ovunque sia nella provincia: passa sul filo il
 * nome scelto e la posizione SUL GRAFO DELLE STRADE (arco, metri, verso), i watt e la
 * velocità. Niente GPS: la posizione è quella virtuale sul rullo, non quella di casa.
 *
 * La classifica tiene, per ogni percorso, il tempo migliore di ogni ciclista (un id casuale
 * del dispositivo, mai mostrato) e i punti esperienza. I tempi da simulatore stanno a parte.
 */

import { cleanNick, rateCheck, type RateState } from './protocol';
import { WORLD_EDGES, WORLD_RIDES } from './world-rides';

export { cleanNick, rateCheck, type RateState };

export const MAX_WORLD = 60;
export const WORLD_SEND_MS = 500;

export const WORLD_CLOSE = { full: 4001, bad: 4003, flood: 4008, idle: 4009, replaced: 4010 } as const;

const PID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const WORLD_RE = /^[a-z][a-z0-9-]{1,30}$/;

export function isPid(v: unknown): v is string {
  return typeof v === 'string' && PID_RE.test(v);
}

export interface WorldJoin {
  world: string;
  nick: string;
  pid: string;
}

/** Legge `/world/:id/ws?nick=…&pid=…`. */
export function parseWorldJoin(url: URL): { ok: true; join: WorldJoin } | { ok: false; error: 'world' | 'nick' | 'pid' } {
  const m = url.pathname.match(/^\/world\/([^/]+)\/ws$/);
  const world = m?.[1];
  if (!world || !WORLD_RE.test(world) || world !== 'bergamo') return { ok: false, error: 'world' };
  const nick = cleanNick(url.searchParams.get('nick'));
  if (!nick) return { ok: false, error: 'nick' };
  const pid = url.searchParams.get('pid');
  if (!isPid(pid)) return { ok: false, error: 'pid' };
  return { ok: true, join: { world, nick, pid } };
}

export interface WorldPeer {
  id: string;
  nick: string;
  color: number;
  /** arco del grafo */
  e: number;
  /** metri lungo l'arco dal nodo a */
  s: number;
  /** verso di marcia sull'arco */
  r: 1 | -1;
  w: number;
  v: number;
  idle: boolean;
  /** percorso che sta facendo, se ne sta facendo uno */
  ride?: string;
  at: number;
}

export type WorldClientMessage = { t: 'pos'; e: number; s: number; r: 1 | -1; w: number; v: number; idle?: boolean; ride?: string } | { t: 'ping' };

export type WorldServerMessage =
  | { t: 'welcome'; you: string; color: number; peers: WorldPeer[]; max: number }
  | { t: 'peer'; p: WorldPeer }
  | { t: 'leave'; id: string }
  | { t: 'error'; code: keyof typeof WORLD_CLOSE | 'world' | 'nick' | 'pid' | 'origin' }
  | { t: 'pong' };

function finite(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

export function parseWorldMessage(raw: unknown): WorldClientMessage | null {
  if (typeof raw !== 'string' || raw.length > 220) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const o = msg as Record<string, unknown>;
  if (o.t === 'ping') return { t: 'ping' };
  if (o.t !== 'pos') return null;
  const e = finite(o.e, 0, WORLD_EDGES - 1);
  const s = finite(o.s, 0, 100_000);
  const w = finite(o.w, 0, 3000);
  const v = finite(o.v, 0, 40);
  if (e == null || !Number.isInteger(e) || s == null || w == null || v == null || (o.r !== 1 && o.r !== -1)) return null;
  const ride = typeof o.ride === 'string' && o.ride in WORLD_RIDES ? o.ride : undefined;
  return { t: 'pos', e, s: Math.round(s * 10) / 10, r: o.r, w: Math.round(w), v: Math.round(v * 100) / 100, idle: o.idle === true, ride };
}

// ---------- classifica ----------

export interface ResultPost {
  pid: string;
  nick: string;
  ride: string;
  sec: number;
  /** watt medi per kg del tratto, solo da mostrare */
  wkg: number;
  /** true se fatto col simulatore e non con un rullo o un misuratore */
  sim: boolean;
}

export type Invalid = { ok: false; error: string };

export function parseResult(body: unknown): { ok: true; r: ResultPost } | Invalid {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body' };
  const o = body as Record<string, unknown>;
  if (!isPid(o.pid)) return { ok: false, error: 'pid' };
  const nick = cleanNick(o.nick);
  if (!nick) return { ok: false, error: 'nick' };
  if (typeof o.ride !== 'string' || !(o.ride in WORLD_RIDES)) return { ok: false, error: 'ride' };
  const lim = WORLD_RIDES[o.ride];
  const sec = finite(o.sec, 1, 36_000);
  if (sec == null) return { ok: false, error: 'sec' };
  // sotto il tempo di un professionista non è un giro: è un errore o un trucco
  if (sec < lim.minSec) return { ok: false, error: 'implausible' };
  const wkg = finite(o.wkg, 0, 12) ?? 0;
  return { ok: true, r: { pid: o.pid, nick, ride: o.ride, sec: Math.round(sec * 10) / 10, wkg: Math.round(wkg * 100) / 100, sim: o.sim === true } };
}

export interface XpPost {
  pid: string;
  nick: string;
  /** punti totali */
  xp: number;
  /** punti della settimana in corso (lunedì-domenica, ora italiana) */
  week: string;
  wxp: number;
}

export function parseXp(body: unknown): { ok: true; x: XpPost } | Invalid {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body' };
  const o = body as Record<string, unknown>;
  if (!isPid(o.pid)) return { ok: false, error: 'pid' };
  const nick = cleanNick(o.nick);
  if (!nick) return { ok: false, error: 'nick' };
  const xp = finite(o.xp, 0, 10_000_000);
  const wxp = finite(o.wxp, 0, 1_000_000);
  if (xp == null || wxp == null || typeof o.week !== 'string' || !/^\d{4}-W\d{2}$/.test(o.week)) return { ok: false, error: 'xp' };
  return { ok: true, x: { pid: o.pid, nick, xp: Math.round(xp), week: o.week, wxp: Math.round(wxp) } };
}

/** Quanti punti si possono guadagnare al massimo in `hours` ore di pedalata: oltre, non si accettano. */
export function xpBudget(hours: number): number {
  return 600 + Math.max(0, hours) * 2500;
}

export interface BoardRow {
  nick: string;
  sec: number;
  wkg: number;
  sim: boolean;
  at: number;
  me?: boolean;
}

export interface XpRow {
  nick: string;
  xp: number;
  me?: boolean;
}

/** Settimana ISO (lunedì) di una data, nel fuso di Roma: «2026-W45». */
export function isoWeek(d: Date): string {
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
  const t = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
