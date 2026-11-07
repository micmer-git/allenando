import { PING } from './protocol';
import { ROOMS_URL } from './room';
import { WORLD_CLOSE, WORLD_SEND_MS, type WorldPeer, type WorldServerMessage } from './world-protocol';
import { WORLD_ID } from './world-rides';

/**
 * Il collegamento al mondo condiviso: chi pedala adesso nella provincia, dovunque sia.
 * Si rientra da soli dopo un taglio (attese crescenti fino a 20 s); si manda al più un
 * aggiornamento ogni 500 ms; senza rete si aspetta che torni. Non blocca mai la pedalata:
 * se il server non risponde, il mondo resta quello dei ciclisti virtuali.
 */

export type WorldStatus = 'connecting' | 'open' | 'reconnecting' | 'offline' | 'full' | 'error' | 'closed';

export interface WorldRemote extends WorldPeer {
  seenAt: number;
}

const PID_KEY = 'allenando.device';

/** Id casuale del dispositivo, per la classifica e il mondo: resta sul telefono, non è un account. */
export function devicePid(): string {
  try {
    const old = localStorage.getItem(PID_KEY);
    if (old && /^[A-Za-z0-9_-]{16,32}$/.test(old)) return old;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    const pid = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem(PID_KEY, pid);
    return pid;
  } catch {
    return 'anonimo-senza-memoria';
  }
}

type Socket = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
};

export interface WorldClientOptions {
  world: string;
  nick: string;
  pid?: string;
  baseUrl?: string;
  socketFactory?: (url: string) => Socket;
  now?: () => number;
}

export class WorldClient {
  readonly pid: string;
  readonly world: string;
  nick: string;
  private base: string;
  private ws: Socket | null = null;
  private riders = new Map<string, WorldRemote>();
  private listeners = new Set<() => void>();
  status: WorldStatus = 'connecting';
  color: number | null = null;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private lastSent = 0;
  private stopped = false;
  private factory: (url: string) => Socket;
  private now: () => number;

  constructor(opts: WorldClientOptions) {
    this.world = opts.world;
    this.nick = opts.nick;
    this.pid = opts.pid ?? devicePid();
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
    let ws: Socket;
    try {
      ws = this.factory(`${this.base}/world/${this.world}/ws?nick=${encodeURIComponent(this.nick)}&pid=${this.pid}`);
    } catch {
      this.set('error');
      return;
    }
    this.ws = ws;
    this.set(this.attempts === 0 ? 'connecting' : 'reconnecting');
    let fatal: WorldStatus | null = null;
    ws.onmessage = (ev) => {
      let msg: WorldServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as WorldServerMessage;
      } catch {
        return;
      }
      const now = this.now();
      if (msg.t === 'welcome') {
        this.attempts = 0;
        this.color = msg.color;
        this.riders.clear();
        for (const p of msg.peers) this.riders.set(p.id, { ...p, seenAt: now });
        this.set('open');
      } else if (msg.t === 'peer') {
        if (msg.p.id !== this.pid) {
          this.riders.set(msg.p.id, { ...msg.p, seenAt: now });
          this.emit();
        }
      } else if (msg.t === 'leave') {
        this.riders.delete(msg.id);
        this.emit();
      } else if (msg.t === 'error' && msg.code === 'full') fatal = 'full';
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      if (this.stopped) return;
      if (fatal || ev.code === WORLD_CLOSE.full || ev.code === WORLD_CLOSE.replaced) {
        this.set(fatal ?? (ev.code === WORLD_CLOSE.full ? 'full' : 'closed'));
        return;
      }
      this.riders.clear();
      this.attempts += 1;
      this.set(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'reconnecting');
      this.retry = setTimeout(() => this.open(), Math.min(20_000, 800 * 2 ** Math.min(5, this.attempts - 1)));
    };
    ws.onerror = () => {
      /* segue onclose */
    };
    ws.onopen = () => {
      this.stopPing();
      this.ping = setInterval(() => {
        if (this.ws?.readyState === 1) this.ws.send(PING);
      }, 25_000);
    };
  }

  /** Da chiamare a ogni fotogramma: manda solo se è passato abbastanza tempo. */
  update(state: { edge: number; s: number; dir: 1 | -1; power: number; speed: number; idle: boolean; ride?: string }): boolean {
    const now = this.now();
    if (now - this.lastSent < WORLD_SEND_MS || this.status !== 'open' || this.ws?.readyState !== 1) return false;
    this.lastSent = now;
    this.ws.send(
      JSON.stringify({
        t: 'pos',
        e: state.edge,
        s: Math.max(0, Math.round(state.s * 10) / 10),
        r: state.dir,
        w: Math.max(0, Math.min(3000, Math.round(state.power))),
        v: Math.max(0, Math.min(40, Math.round(state.speed * 100) / 100)),
        idle: state.idle,
        ride: state.ride,
      }),
    );
    return true;
  }

  remote(): Map<string, WorldRemote> {
    return this.riders;
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

  private stopPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }

  private set(s: WorldStatus): void {
    this.status = s;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Quanti stanno pedalando adesso nel mondo (per la pagina Mondo), o null se non si sa. */
export async function worldCount(world = WORLD_ID, base = ROOMS_URL): Promise<number | null> {
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/world/${world}/count`);
    if (!res.ok) return null;
    const json = (await res.json()) as { riders?: number };
    return typeof json.riders === 'number' ? json.riders : null;
  } catch {
    return null;
  }
}
