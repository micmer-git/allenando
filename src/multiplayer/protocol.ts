/**
 * Protocollo delle stanze «Pedala insieme». Lo usano sia l'app sia il Worker
 * (server/allenando-room): un file solo, niente dipendenze, così le regole di
 * validazione sono le stesse dai due lati.
 *
 * Cosa passa sul filo, e basta: un nome da mostrare, i metri percorsi sulla salita,
 * i watt e la velocità di adesso. Niente frequenza cardiaca, niente coordinate, niente
 * storico: il server non salva il giro, inoltra l'ultimo stato e lo dimentica.
 */

/** Le salite su cui si può aprire una stanza: devono essere le stesse per tutti. */
export const ROOM_ROUTES = ['selvino-nembro', 'mortirolo-mazzo', 'stelvio-prato', 'stelvio-bormio'] as const;
export type RoomRoute = (typeof ROOM_ROUTES)[number];

export const MAX_RIDERS = 8;
/** Un aggiornamento ogni 500 ms basta per vedersi; il server ne scarta di più fitti. */
export const SEND_INTERVAL_MS = 500;
export const MIN_INTERVAL_MS = 350;
/** Oltre questi scarti nella stessa finestra di 10 s, il socket si chiude. */
export const MAX_DROPS = 20;
export const IDLE_TIMEOUT_MS = 90_000;
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
export const NICK_MAX = 24;

/** Dieci colori ben distinti sul verde e sul grigio del mondo 3D. */
export const RIDER_COLORS = ['#c8f031', '#ff6b4a', '#4ab8ff', '#ffc93c', '#c77dff', '#3ce0b0', '#ff5fa2', '#f4f4f0'] as const;

export const CLOSE = {
  full: 4001,
  route: 4002,
  bad: 4003,
  flood: 4008,
  idle: 4009,
  replaced: 4010,
  expired: 4011,
} as const;

const ROOM_RE = /^[A-Za-z0-9_-]{22}$/;
const PID_RE = /^[A-Za-z0-9_-]{8,32}$/;

export function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_RE.test(value);
}

export function isRoute(value: unknown): value is RoomRoute {
  return typeof value === 'string' && (ROOM_ROUTES as readonly string[]).includes(value);
}

/** 128 bit casuali in base64url: 22 caratteri, non si indovinano. */
export function newRoomId(random: (n: number) => Uint8Array = cryptoBytes): string {
  return base64url(random(16));
}

export function newPeerId(random: (n: number) => Uint8Array = cryptoBytes): string {
  return base64url(random(12));
}

function cryptoBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Caratteri di controllo e invisibili (anche i ribaltamenti di direzione), costruiti senza scriverli. */
const HIDDEN = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2066, 0x2069],
  ]
    .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`)
    .join('')}]`,
  'g',
);

/** Toglie i caratteri di controllo e taglia: il nome è solo da mostrare. */
export function cleanNick(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return Array.from(s).slice(0, NICK_MAX).join('');
}

export interface JoinRequest {
  room: string;
  route: RoomRoute;
  nick: string;
  pid: string;
}

export type JoinError = 'room' | 'route' | 'nick' | 'pid';

/** Legge `/rooms/:id/ws?route=…&nick=…&pid=…`. */
export function parseJoin(url: URL): { ok: true; join: JoinRequest } | { ok: false; error: JoinError } {
  const m = url.pathname.match(/^\/rooms\/([^/]+)\/ws$/);
  const room = m?.[1];
  if (!isRoomId(room)) return { ok: false, error: 'room' };
  const route = url.searchParams.get('route');
  if (!isRoute(route)) return { ok: false, error: 'route' };
  const nick = cleanNick(url.searchParams.get('nick'));
  if (!nick) return { ok: false, error: 'nick' };
  const pid = url.searchParams.get('pid');
  if (!pid || !PID_RE.test(pid)) return { ok: false, error: 'pid' };
  return { ok: true, join: { room, route, nick, pid } };
}

/** Lo stato di un ciclista, così come lo vede chi è nella stanza. */
export interface PeerState {
  id: string;
  nick: string;
  color: number;
  /** metri dalla partenza della salita */
  d: number;
  /** watt (media 3 s) */
  w: number;
  /** m/s */
  v: number;
  /** true se in pausa o arrivato */
  idle: boolean;
  /** ms epoch del server all'ultimo aggiornamento */
  at: number;
}

export type ClientMessage = { t: 'state'; d: number; w: number; v: number; idle?: boolean } | { t: 'ping' };

export type ServerMessage =
  | { t: 'welcome'; you: string; color: number; route: RoomRoute; peers: PeerState[]; max: number }
  | { t: 'peer'; p: PeerState }
  | { t: 'leave'; id: string }
  | { t: 'error'; code: keyof typeof CLOSE | JoinError | 'origin' }
  | { t: 'pong' };

export const PING = JSON.stringify({ t: 'ping' });
export const PONG = JSON.stringify({ t: 'pong' });

function finite(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/** Valida un messaggio del client. `null` = da scartare (e contare come scarto). */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const o = msg as Record<string, unknown>;
  if (o.t === 'ping') return { t: 'ping' };
  if (o.t !== 'state') return null;
  const d = finite(o.d, 0, 300_000);
  const w = finite(o.w, 0, 3000);
  const v = finite(o.v, 0, 40);
  if (d == null || w == null || v == null) return null;
  return { t: 'state', d: Math.round(d * 10) / 10, w: Math.round(w), v: Math.round(v * 100) / 100, idle: o.idle === true };
}

/** Il primo colore libero; se sono tutti presi (non succede con 8 posti), il meno usato. */
export function pickColor(used: number[]): number {
  for (let i = 0; i < RIDER_COLORS.length; i++) if (!used.includes(i)) return i;
  return used.length % RIDER_COLORS.length;
}

/** Limitatore a finestra: al massimo un messaggio ogni MIN_INTERVAL_MS. */
export interface RateState {
  last: number;
  drops: number;
  windowStart: number;
}

export function rateCheck(s: RateState, now: number): 'ok' | 'drop' | 'kick' {
  if (now - s.windowStart > 10_000) {
    s.windowStart = now;
    s.drops = 0;
  }
  if (now - s.last < MIN_INTERVAL_MS) {
    s.drops += 1;
    return s.drops > MAX_DROPS ? 'kick' : 'drop';
  }
  s.last = now;
  return 'ok';
}

export function parseOrigins(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
