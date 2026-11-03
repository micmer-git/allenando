import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE,
  IDLE_TIMEOUT_MS,
  MAX_DROPS,
  MAX_RIDERS,
  PING,
  PONG,
  ROOM_TTL_MS,
  parseClientMessage,
  parseJoin,
  parseOrigins,
  pickColor,
  rateCheck,
  type PeerState,
  type RateState,
  type RoomRoute,
  type ServerMessage,
} from '../../../src/multiplayer/protocol';
import { parseWorldJoin } from '../../../src/multiplayer/world-protocol';
import { Board, World } from './world';

export { Board, World };

/**
 * Stanze «Pedala insieme».
 *
 * Il Worker controlla origine e parametri e passa il WebSocket al Durable Object della
 * stanza (uno per id). Il DO tiene i socket in ibernazione: lo stato di ogni ciclista sta
 * nell'attachment del suo socket, non in un database. Nella memoria della stanza restano
 * solo la salita e l'ora di apertura, cancellate dall'allarme quando la stanza si svuota.
 */

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  WORLDS: DurableObjectNamespace<World>;
  BOARD: DurableObjectNamespace<Board>;
  ALLOWED_ORIGINS: string;
}

interface Attachment {
  peer: PeerState;
  rate: RateState;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(origin) },
  });
}

function cors(origin: string | null): Record<string, string> {
  return origin
    ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' }
    : {};
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = parseOrigins(env.ALLOWED_ORIGINS);
    const okOrigin = origin && allowed.includes(origin) ? origin : null;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(okOrigin) });

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'allenando-rooms', maxRiders: MAX_RIDERS, world: true, board: true }, 200, okOrigin);
    }

    // il mondo aperto: chi pedala adesso, e quanti sono
    if (url.pathname.startsWith('/world/')) {
      const m = url.pathname.match(/^\/world\/([a-z0-9-]+)\/(ws|count)$/);
      if (!m) return json({ error: 'not found' }, 404, okOrigin);
      if (m[2] === 'count') {
        const res = await env.WORLDS.get(env.WORLDS.idFromName(m[1])).fetch(request);
        return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(okOrigin) } });
      }
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'websocket' }, 426, okOrigin);
      if (!okOrigin) return json({ error: 'origin' }, 403, null);
      const parsed = parseWorldJoin(url);
      if (!parsed.ok) return json({ error: parsed.error }, 400, okOrigin);
      return env.WORLDS.get(env.WORLDS.idFromName(parsed.join.world)).fetch(request);
    }

    // la classifica: scrivere solo dal sito, leggere da chiunque
    if (url.pathname.startsWith('/board/')) {
      if (request.method === 'POST' && !okOrigin) return json({ error: 'origin' }, 403, null);
      if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method' }, 405, okOrigin);
      const len = Number(request.headers.get('content-length') ?? 0);
      if (len > 2000) return json({ error: 'body' }, 413, okOrigin);
      const res = await env.BOARD.get(env.BOARD.idFromName('bergamo')).fetch(request);
      return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(okOrigin) } });
    }

    if (url.pathname.startsWith('/rooms/')) {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'websocket' }, 426, okOrigin);
      // i browser mandano sempre Origin: senza, o da un altro sito, la stanza non si apre
      if (!okOrigin) return json({ error: 'origin' }, 403, null);
      const parsed = parseJoin(url);
      if (!parsed.ok) return json({ error: parsed.error }, 400, okOrigin);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(parsed.join.room));
      return stub.fetch(request);
    }

    return json({ error: 'not found' }, 404, okOrigin);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // il ping di tenuta riceve risposta senza svegliare la stanza
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(request: Request): Promise<Response> {
    const parsed = parseJoin(new URL(request.url));
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (!parsed.ok) return this.refuse(client, server, parsed.error, CLOSE.bad);
    const { route, nick, pid } = parsed.join;
    const now = Date.now();

    let roomRoute = await this.ctx.storage.get<RoomRoute>('route');
    let created = await this.ctx.storage.get<number>('created');
    if (created != null && now - created > ROOM_TTL_MS && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      roomRoute = undefined;
      created = undefined;
    }
    if (roomRoute && roomRoute !== route) return this.refuse(client, server, 'route', CLOSE.route);

    // chi rientra con lo stesso id prende il posto del suo socket vecchio
    let color: number | null = null;
    const others: WebSocket[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.att(ws);
      if (!att) continue;
      if (att.peer.id === pid) {
        color = att.peer.color;
        try {
          ws.serializeAttachment(null);
          ws.close(CLOSE.replaced, 'replaced');
        } catch {
          /* già chiuso */
        }
      } else {
        others.push(ws);
      }
    }
    if (others.length >= MAX_RIDERS) return this.refuse(client, server, 'full', CLOSE.full);

    if (!roomRoute) {
      await this.ctx.storage.put({ route, created: now });
    }
    const peers = others.map((ws) => this.att(ws)!.peer);
    const peer: PeerState = {
      id: pid,
      nick,
      color: color ?? pickColor(peers.map((p) => p.color)),
      d: 0,
      w: 0,
      v: 0,
      idle: true,
      at: now,
    };
    this.ctx.acceptWebSocket(server, [pid]);
    server.serializeAttachment({ peer, rate: { last: 0, drops: 0, windowStart: now } } satisfies Attachment);
    this.send(server, { t: 'welcome', you: pid, color: peer.color, route, peers, max: MAX_RIDERS });
    this.broadcast({ t: 'peer', p: peer }, server);
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(now + 60_000);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = this.att(ws);
    if (!att) return;
    const msg = parseClientMessage(typeof message === 'string' ? message : null);
    const now = Date.now();
    if (!msg) {
      att.rate.drops += 1;
      if (att.rate.drops > MAX_DROPS) ws.close(CLOSE.bad, 'bad');
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
      ws.close(CLOSE.flood, 'flood');
      return;
    }
    if (verdict === 'drop') {
      ws.serializeAttachment(att);
      return;
    }
    att.peer = { ...att.peer, d: msg.d, w: msg.w, v: msg.v, idle: msg.idle === true, at: now };
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

  /** Ogni minuto finché c'è qualcuno: via i socket muti, via la stanza scaduta o vuota. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const created = (await this.ctx.storage.get<number>('created')) ?? now;
    const expired = now - created > ROOM_TTL_MS;
    let alive = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.att(ws);
      const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const last = Math.max(att?.peer.at ?? 0, auto);
      if (!att || expired || now - last > IDLE_TIMEOUT_MS) {
        try {
          if (expired) this.send(ws, { t: 'error', code: 'expired' });
          ws.close(expired ? CLOSE.expired : CLOSE.idle, expired ? 'expired' : 'idle');
        } catch {
          /* già chiuso */
        }
        this.gone(ws);
      } else {
        alive += 1;
      }
    }
    if (alive > 0) await this.ctx.storage.setAlarm(now + 60_000);
    else await this.ctx.storage.deleteAll();
  }

  private gone(ws: WebSocket): void {
    const att = this.att(ws);
    if (!att) return;
    try {
      ws.serializeAttachment(null);
    } catch {
      /* già chiuso */
    }
    // se lo stesso ciclista è già rientrato con un altro socket, non è uscito
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

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket in chiusura */
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || !this.att(ws)) continue;
      try {
        ws.send(text);
      } catch {
        /* socket in chiusura */
      }
    }
  }

  private refuse(client: WebSocket, server: WebSocket, code: Extract<ServerMessage, { t: 'error' }>['code'], close: number): Response {
    server.accept();
    this.send(server, { t: 'error', code });
    server.close(close, String(code));
    return new Response(null, { status: 101, webSocket: client });
  }
}
