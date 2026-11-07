import { DurableObject } from 'cloudflare:workers';
import { PING, PONG, IDLE_TIMEOUT_MS, MAX_DROPS, pickColor } from '../../../src/multiplayer/protocol';
import {
  MAX_WORLD,
  WORLD_CLOSE,
  isoWeek,
  parseResult,
  parseWorldJoin,
  parseWorldMessage,
  parseXp,
  rateCheck,
  xpBudget,
  type BoardRow,
  type RateState,
  type WorldPeer,
  type WorldServerMessage,
  type XpRow,
} from '../../../src/multiplayer/world-protocol';

/**
 * Il mondo condiviso: un Durable Object per mondo, con i socket in ibernazione come le
 * stanze. Lo stato di ognuno sta nell'attachment del suo socket; il DO non salva niente.
 */

interface Attachment {
  peer: WorldPeer;
  rate: RateState;
  /** il mondo della stanza (bergamo, sellaronda): un arco vale solo nel suo grafo */
  world?: string;
}

export class World extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/count')) {
      const n = this.ctx.getWebSockets().filter((ws) => this.att(ws)).length;
      return new Response(JSON.stringify({ riders: n }), { headers: { 'content-type': 'application/json' } });
    }
    const parsed = parseWorldJoin(url);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (!parsed.ok) return this.refuse(client, server, parsed.error, WORLD_CLOSE.bad);
    const { nick, pid, world } = parsed.join;
    const now = Date.now();
    let color: number | null = null;
    const others: WebSocket[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.att(ws);
      if (!att) continue;
      if (att.peer.id === pid) {
        color = att.peer.color;
        try {
          ws.serializeAttachment(null);
          ws.close(WORLD_CLOSE.replaced, 'replaced');
        } catch {
          /* già chiuso */
        }
      } else others.push(ws);
    }
    if (others.length >= MAX_WORLD) return this.refuse(client, server, 'full', WORLD_CLOSE.full);
    const peers = others.map((ws) => this.att(ws)!.peer).filter((p) => p.at > 0);
    const peer: WorldPeer = { id: pid, nick, color: color ?? pickColor(peers.map((p) => p.color)), e: 0, s: 0, r: 1, w: 0, v: 0, idle: true, at: 0 };
    this.ctx.acceptWebSocket(server, [pid]);
    server.serializeAttachment({ peer, rate: { last: 0, drops: 0, windowStart: now }, world } satisfies Attachment);
    this.send(server, { t: 'welcome', you: pid, color: peer.color, peers, max: MAX_WORLD });
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(now + 60_000);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = this.att(ws);
    if (!att) return;
    const msg = parseWorldMessage(typeof message === 'string' ? message : null, att.world);
    const now = Date.now();
    if (!msg) {
      att.rate.drops += 1;
      if (att.rate.drops > MAX_DROPS) ws.close(WORLD_CLOSE.bad, 'bad');
      else ws.serializeAttachment(att);
      return;
    }
    if (msg.t === 'ping') {
      this.send(ws, { t: 'pong' });
      return;
    }
    const verdict = rateCheck(att.rate, now);
    if (verdict === 'kick') {
      this.send(ws, { t: 'error', code: 'flood' });
      ws.close(WORLD_CLOSE.flood, 'flood');
      return;
    }
    if (verdict === 'drop') {
      ws.serializeAttachment(att);
      return;
    }
    att.peer = { ...att.peer, e: msg.e, s: msg.s, r: msg.r, w: msg.w, v: msg.v, idle: msg.idle === true, ride: msg.ride, at: now };
    ws.serializeAttachment(att);
    this.broadcast({ t: 'peer', p: att.peer }, ws);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.gone(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      /* già chiuso */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.gone(ws);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let alive = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.att(ws);
      const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const last = Math.max(att?.peer.at ?? 0, auto);
      if (!att || now - last > IDLE_TIMEOUT_MS) {
        try {
          ws.close(WORLD_CLOSE.idle, 'idle');
        } catch {
          /* già chiuso */
        }
        this.gone(ws);
      } else alive += 1;
    }
    if (alive > 0) await this.ctx.storage.setAlarm(now + 60_000);
  }

  private gone(ws: WebSocket): void {
    const att = this.att(ws);
    if (!att) return;
    try {
      ws.serializeAttachment(null);
    } catch {
      /* già chiuso */
    }
    const still = this.ctx.getWebSockets(att.peer.id).some((s) => s !== ws && this.att(s));
    if (!still) this.broadcast({ t: 'leave', id: att.peer.id }, ws);
  }

  private att(ws: WebSocket): Attachment | null {
    try {
      return (ws.deserializeAttachment() as Attachment | null) ?? null;
    } catch {
      return null;
    }
  }

  private send(ws: WebSocket, msg: WorldServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* in chiusura */
    }
  }

  private broadcast(msg: WorldServerMessage, except?: WebSocket): void {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || !this.att(ws)) continue;
      try {
        ws.send(text);
      } catch {
        /* in chiusura */
      }
    }
  }

  private refuse(client: WebSocket, server: WebSocket, code: Extract<WorldServerMessage, { t: 'error' }>['code'], close: number): Response {
    server.accept();
    this.send(server, { t: 'error', code });
    server.close(close, String(code));
    return new Response(null, { status: 101, webSocket: client });
  }
}

/**
 * La classifica: un Durable Object solo, con SQLite. Per ogni percorso il tempo migliore di
 * ogni dispositivo (rullo e simulatore separati); per ogni dispositivo i punti esperienza.
 * L'id del dispositivo non esce mai: chi chiede la classifica col proprio id si vede segnato.
 */
export class Board extends DurableObject<Env> {
  private recent = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS times (ride TEXT NOT NULL, pid TEXT NOT NULL, sim INTEGER NOT NULL, nick TEXT NOT NULL, sec REAL NOT NULL, wkg REAL NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (ride, pid, sim))`);
      this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS times_rank ON times (ride, sim, sec)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS xp (pid TEXT PRIMARY KEY, nick TEXT NOT NULL, xp INTEGER NOT NULL, week TEXT NOT NULL, wxp INTEGER NOT NULL, at INTEGER NOT NULL)`);
    });
  }

  /** Al più 40 invii all'ora per dispositivo: una classifica non ne chiede di più. */
  private limited(pid: string): boolean {
    const now = Date.now();
    const list = (this.recent.get(pid) ?? []).filter((t) => now - t < 3_600_000);
    list.push(now);
    this.recent.set(pid, list);
    return list.length > 40;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const sql = this.ctx.storage.sql;
    if (request.method === 'POST' && url.pathname === '/board/result') {
      const parsed = parseResult(await request.json().catch(() => null));
      if (!parsed.ok) return json(parsed, 400);
      const r = parsed.r;
      if (this.limited(r.pid)) return json({ ok: false, error: 'rate' }, 429);
      const sim = r.sim ? 1 : 0;
      const old = sql.exec<{ sec: number }>('SELECT sec FROM times WHERE ride = ? AND pid = ? AND sim = ?', r.ride, r.pid, sim).toArray()[0];
      const best = !old || r.sec < old.sec;
      if (best) sql.exec('INSERT OR REPLACE INTO times (ride, pid, sim, nick, sec, wkg, at) VALUES (?, ?, ?, ?, ?, ?, ?)', r.ride, r.pid, sim, r.nick, r.sec, r.wkg, Date.now());
      else sql.exec('UPDATE times SET nick = ? WHERE ride = ? AND pid = ? AND sim = ?', r.nick, r.ride, r.pid, sim);
      const mine = best ? r.sec : old!.sec;
      const rank = (sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM times WHERE ride = ? AND sim = ? AND sec < ?', r.ride, sim, mine).toArray()[0]?.n ?? 0) + 1;
      return json({ ok: true, best, rank, sec: mine });
    }
    if (request.method === 'POST' && url.pathname === '/board/xp') {
      const parsed = parseXp(await request.json().catch(() => null));
      if (!parsed.ok) return json(parsed, 400);
      const x = parsed.x;
      if (this.limited(x.pid)) return json({ ok: false, error: 'rate' }, 429);
      const now = Date.now();
      const old = sql.exec<{ xp: number; at: number; week: string; wxp: number }>('SELECT xp, at, week, wxp FROM xp WHERE pid = ?', x.pid).toArray()[0];
      if (old) {
        // i punti non crescono più in fretta di quanto si possa pedalare
        const budget = xpBudget((now - old.at) / 3_600_000);
        if (x.xp - old.xp > budget) return json({ ok: false, error: 'implausible' }, 400);
        if (x.xp < old.xp) return json({ ok: true, xp: old.xp });
      } else if (x.xp > 20_000) return json({ ok: false, error: 'implausible' }, 400);
      const week = isoWeek(new Date(now));
      const wxp = x.week === week ? Math.min(x.wxp, x.xp) : 0;
      sql.exec('INSERT OR REPLACE INTO xp (pid, nick, xp, week, wxp, at) VALUES (?, ?, ?, ?, ?, ?)', x.pid, x.nick, x.xp, week, wxp, now);
      return json({ ok: true, xp: x.xp });
    }
    // il primo di ogni classifica chiesta, in una volta: per le liste dei tratti e delle salite
    if (request.method === 'GET' && url.pathname === '/board/leaders') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter((s) => s && s.length <= 64).slice(0, 80);
      const sim = url.searchParams.get('sim') === '1' ? 1 : 0;
      const pid = url.searchParams.get('pid') ?? '';
      const out: Record<string, { nick: string; sec: number; total: number; me?: boolean; mine?: number }> = {};
      for (const id of ids) {
        const top = sql.exec<{ nick: string; sec: number; pid: string }>('SELECT nick, sec, pid FROM times WHERE ride = ? AND sim = ? ORDER BY sec ASC LIMIT 1', id, sim).toArray()[0];
        if (!top) continue;
        const total = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM times WHERE ride = ? AND sim = ?', id, sim).toArray()[0]?.n ?? 0;
        const mine = pid ? sql.exec<{ sec: number }>('SELECT sec FROM times WHERE ride = ? AND sim = ? AND pid = ?', id, sim, pid).toArray()[0] : undefined;
        out[id] = { nick: top.nick, sec: top.sec, total, me: top.pid === pid || undefined, mine: mine?.sec };
      }
      return json({ sim: sim === 1, leaders: out });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/board/ride/')) {
      const ride = decodeURIComponent(url.pathname.slice('/board/ride/'.length));
      const sim = url.searchParams.get('sim') === '1' ? 1 : 0;
      const pid = url.searchParams.get('pid') ?? '';
      const rows = sql
        .exec<{ nick: string; sec: number; wkg: number; at: number; pid: string; sim: number }>('SELECT nick, sec, wkg, at, pid, sim FROM times WHERE ride = ? AND sim = ? ORDER BY sec ASC LIMIT 50', ride, sim)
        .toArray();
      const out: BoardRow[] = rows.map((r) => ({ nick: r.nick, sec: r.sec, wkg: r.wkg, sim: r.sim === 1, at: r.at, me: r.pid === pid || undefined }));
      const total = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM times WHERE ride = ? AND sim = ?', ride, sim).toArray()[0]?.n ?? 0;
      let mine: { rank: number; sec: number } | null = null;
      if (pid && !out.some((r) => r.me)) {
        const m = sql.exec<{ sec: number }>('SELECT sec FROM times WHERE ride = ? AND sim = ? AND pid = ?', ride, sim, pid).toArray()[0];
        if (m) mine = { sec: m.sec, rank: (sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM times WHERE ride = ? AND sim = ? AND sec < ?', ride, sim, m.sec).toArray()[0]?.n ?? 0) + 1 };
      }
      return json({ ride, sim: sim === 1, total, rows: out, mine });
    }
    if (request.method === 'GET' && url.pathname === '/board/xp') {
      const scope = url.searchParams.get('scope') === 'week' ? 'week' : 'all';
      const pid = url.searchParams.get('pid') ?? '';
      const week = isoWeek(new Date());
      const rows =
        scope === 'week'
          ? sql.exec<{ nick: string; v: number; pid: string }>('SELECT nick, wxp AS v, pid FROM xp WHERE week = ? AND wxp > 0 ORDER BY wxp DESC LIMIT 50', week).toArray()
          : sql.exec<{ nick: string; v: number; pid: string }>('SELECT nick, xp AS v, pid FROM xp ORDER BY xp DESC LIMIT 50').toArray();
      const out: XpRow[] = rows.map((r) => ({ nick: r.nick, xp: r.v, me: r.pid === pid || undefined }));
      return json({ scope, week, rows: out });
    }
    return json({ error: 'not found' }, 404);
  }
}
