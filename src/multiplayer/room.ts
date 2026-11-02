import {
  CLOSE,
  PING,
  SEND_INTERVAL_MS,
  newPeerId,
  newRoomId,
  type PeerState,
  type RoomRoute,
  type ServerMessage,
} from './protocol';

/** Il Worker delle stanze. Si cambia con VITE_ROOMS_URL al build. */
export const ROOMS_URL: string = (import.meta.env?.VITE_ROOMS_URL as string | undefined) ?? 'https://allenando-rooms.micmer-recastello.workers.dev';

export type RoomStatus = 'connecting' | 'open' | 'reconnecting' | 'offline' | 'full' | 'route' | 'expired' | 'error' | 'closed';

export interface RemoteRider extends PeerState {
  /** ms locali all'arrivo dell'ultimo aggiornamento: serve per stimare dove è adesso */
  seenAt: number;
}

export interface RoomSnapshot {
  status: RoomStatus;
  you: string;
  color: number | null;
  riders: RemoteRider[];
  attempts: number;
}

const PID_KEY = 'allenando.room.pid';
const NICK_KEY = 'allenando.room.nick';

export function roomPeerId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession()): string {
  const old = storage?.getItem(PID_KEY);
  if (old && /^[A-Za-z0-9_-]{8,32}$/.test(old)) return old;
  const pid = newPeerId();
  storage?.setItem(PID_KEY, pid);
  return pid;
}

export function savedNick(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNick(nick: string): void {
  try {
    localStorage.setItem(NICK_KEY, nick);
  } catch {
    /* modalità privata */
  }
}

function safeSession(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export { newRoomId };

/** Il link da mandare: apre la stessa salita nella stessa stanza. */
export function inviteUrl(route: RoomRoute, room: string, base = `${location.origin}${import.meta.env.BASE_URL}`): string {
  return `${base.replace(/\/$/, '')}/ride?route=${route}&room=${room}`;
}

/** Dove si trova adesso un ciclista lontano: l'ultima distanza più la velocità, al massimo 3 s di stima. */
export function estimateDistance(r: RemoteRider, now: number): number {
  if (r.idle) return r.d;
  return r.d + r.v * Math.min(3, Math.max(0, (now - r.seenAt) / 1000));
}

type Socket = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
};

export interface RoomOptions {
  room: string;
  route: RoomRoute;
  nick: string;
  pid?: string;
  baseUrl?: string;
  /** per i test */
  socketFactory?: (url: string) => Socket;
  now?: () => number;
}

/**
 * Il collegamento alla stanza. Rientra da solo dopo un taglio (attese crescenti fino a
 * 15 s), tiene vivo il socket con un ping ogni 25 s, e non manda più di un aggiornamento
 * ogni 500 ms qualunque sia il ritmo con cui lo si chiama.
 */
export class RoomClient {
  readonly room: string;
  readonly route: RoomRoute;
  readonly pid: string;
  nick: string;
  private base: string;
  private ws: Socket | null = null;
  private listeners = new Set<() => void>();
  private riders = new Map<string, RemoteRider>();
  private status: RoomStatus = 'connecting';
  private color: number | null = null;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private lastSent = 0;
  private stopped = false;
  private factory: (url: string) => Socket;
  private now: () => number;
  private snap: RoomSnapshot | null = null;

  constructor(opts: RoomOptions) {
    this.room = opts.room;
    this.route = opts.route;
    this.nick = opts.nick;
    this.pid = opts.pid ?? roomPeerId();
    this.base = (opts.baseUrl ?? ROOMS_URL).replace(/\/$/, '').replace(/^http/, 'ws');
    this.factory = opts.socketFactory ?? ((url) => new WebSocket(url) as Socket);
    this.now = opts.now ?? (() => Date.now());
    this.onOnline = this.onOnline.bind(this);
  }

  connect(): void {
    this.stopped = false;
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    this.open();
  }

  private onOnline(): void {
    if (this.status === 'offline' || this.status === 'reconnecting') {
      if (this.retry) clearTimeout(this.retry);
      this.open();
    }
  }

  private open(): void {
    if (this.stopped) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.set('offline');
      return;
    }
    const url = `${this.base}/rooms/${this.room}/ws?route=${this.route}&nick=${encodeURIComponent(this.nick)}&pid=${this.pid}`;
    let ws: Socket;
    try {
      ws = this.factory(url);
    } catch {
      this.set('error');
      return;
    }
    this.ws = ws;
    this.set(this.attempts === 0 ? 'connecting' : 'reconnecting');
    let fatal: RoomStatus | null = null;
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg, (s) => (fatal = s));
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      if (this.stopped) return;
      const code = ev.code;
      if (fatal || code === CLOSE.full || code === CLOSE.route || code === CLOSE.expired || code === CLOSE.replaced) {
        this.set(fatal ?? (code === CLOSE.full ? 'full' : code === CLOSE.route ? 'route' : code === CLOSE.expired ? 'expired' : 'closed'));
        return;
      }
      this.riders.clear();
      this.attempts += 1;
      this.set(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'reconnecting');
      const wait = Math.min(15_000, 600 * 2 ** Math.min(5, this.attempts - 1));
      this.retry = setTimeout(() => this.open(), wait);
    };
    ws.onerror = () => {
      /* segue sempre onclose */
    };
    ws.onopen = () => {
      this.stopPing();
      this.ping = setInterval(() => {
        if (this.ws?.readyState === 1) this.ws.send(PING);
      }, 25_000);
    };
  }

  private handle(msg: ServerMessage, fatal: (s: RoomStatus) => void): void {
    const now = this.now();
    switch (msg.t) {
      case 'welcome':
        this.attempts = 0;
        this.color = msg.color;
        this.riders.clear();
        for (const p of msg.peers) this.riders.set(p.id, { ...p, seenAt: now });
        this.set('open');
        break;
      case 'peer':
        if (msg.p.id === this.pid) break;
        this.riders.set(msg.p.id, { ...msg.p, seenAt: now });
        this.emit();
        break;
      case 'leave':
        this.riders.delete(msg.id);
        this.emit();
        break;
      case 'error':
        if (msg.code === 'full' || msg.code === 'route' || msg.code === 'expired') fatal(msg.code);
        else if (msg.code === 'replaced') fatal('closed');
        break;
      default:
        break;
    }
  }

  /** Da chiamare a ogni fotogramma: manda solo se è passato abbastanza tempo. */
  update(state: { distance: number; power: number; speed: number; idle: boolean }, force = false): boolean {
    const now = this.now();
    if (!force && now - this.lastSent < SEND_INTERVAL_MS) return false;
    if (this.status !== 'open' || this.ws?.readyState !== 1) return false;
    this.lastSent = now;
    this.ws.send(
      JSON.stringify({
        t: 'state',
        d: Math.max(0, Math.round(state.distance * 10) / 10),
        w: Math.max(0, Math.min(3000, Math.round(state.power))),
        v: Math.max(0, Math.min(40, Math.round(state.speed * 100) / 100)),
        idle: state.idle,
      }),
    );
    return true;
  }

  /** Riprova subito, dopo un errore o un «stanza piena». */
  rejoin(): void {
    if (this.retry) clearTimeout(this.retry);
    this.attempts = 0;
    const old = this.ws;
    this.ws = null;
    old?.close(1000, 'rejoin');
    this.open();
  }

  leave(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.stopPing();
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'bye');
    this.riders.clear();
    this.set('closed');
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): RoomSnapshot {
    if (!this.snap) {
      this.snap = { status: this.status, you: this.pid, color: this.color, riders: [...this.riders.values()], attempts: this.attempts };
    }
    return this.snap;
  }

  /** I ciclisti lontani, senza copiare: per il mondo 3D, letto a ogni fotogramma. */
  remote(): Map<string, RemoteRider> {
    return this.riders;
  }

  private stopPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }

  private set(status: RoomStatus): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
    this.snap = null;
    for (const fn of this.listeners) fn();
  }
}
