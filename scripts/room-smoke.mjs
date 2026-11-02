// Prova a due (e più) client WebSocket delle stanze «Pedala insieme».
// Uso: node scripts/room-smoke.mjs [https://allenando-rooms.<sub>.workers.dev]
// Default: http://127.0.0.1:8787 (npx wrangler dev in server/allenando-room).
// Esce con 1 al primo controllo che fallisce.

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const ORIGIN = 'https://micmer-git.github.io';

const rnd = (n) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(ok, label, extra = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

function join(room, route, nick, pid = rnd(12), origin = ORIGIN) {
  const url = `${WS_BASE}/rooms/${room}/ws?route=${route}&nick=${encodeURIComponent(nick)}&pid=${pid}`;
  const ws = new WebSocket(url, { headers: { origin } });
  const c = { ws, pid, nick, msgs: [], closed: null, opened: false };
  ws.addEventListener('open', () => (c.opened = true));
  ws.addEventListener('message', (e) => c.msgs.push(JSON.parse(String(e.data))));
  ws.addEventListener('close', (e) => (c.closed = e.code));
  ws.addEventListener('error', () => {});
  return c;
}

async function until(fn, label, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(40);
  }
  check(false, `timeout: ${label}`);
  return false;
}

const welcome = (c) => c.msgs.find((m) => m.t === 'welcome');
const peerUpdates = (c, id) => c.msgs.filter((m) => m.t === 'peer' && m.p.id === id);

const health = await fetch(`${BASE}/health`, { headers: { origin: ORIGIN } });
const hj = await health.json();
check(health.ok && hj.ok === true, 'GET /health', JSON.stringify(hj));
check(health.headers.get('access-control-allow-origin') === ORIGIN, 'CORS per micmer-git.github.io');

// fetch non può chiedere l'upgrade: si prova col WebSocket vero, che deve fallire senza benvenuto
const evil = join(rnd(16), 'selvino-nembro', 'x', rnd(12), 'https://evil.example');
await until(() => evil.closed != null, 'origine estranea chiusa');
check(!evil.opened && !welcome(evil), 'origine estranea rifiutata (403, niente socket)', String(evil.closed));
const badRoom = new WebSocket(`${WS_BASE}/rooms/corto/ws?route=selvino-nembro&nick=x&pid=${rnd(12)}`, { headers: { origin: ORIGIN } });
const badState = { opened: false, closed: null };
badRoom.addEventListener('open', () => (badState.opened = true));
badRoom.addEventListener('close', (e) => (badState.closed = e.code));
badRoom.addEventListener('error', () => {});
await until(() => badState.closed != null, 'id corto chiuso');
check(!badState.opened, 'id stanza indovinabile rifiutato (400)');

const room = rnd(16);
const a = join(room, 'selvino-nembro', 'Anna');
await until(() => welcome(a), 'welcome A');
check(welcome(a)?.peers.length === 0 && welcome(a)?.route === 'selvino-nembro', 'A entra in una stanza vuota su Selvino');

const b = join(room, 'selvino-nembro', 'Bruno');
await until(() => welcome(b), 'welcome B');
check(welcome(b)?.peers.some((p) => p.id === a.pid && p.nick === 'Anna'), 'B vede A nel benvenuto');
await until(() => peerUpdates(a, b.pid).length > 0, 'A vede B entrare');
check(welcome(a).color !== welcome(b).color, 'colori diversi', `${welcome(a).color} / ${welcome(b).color}`);

a.ws.send(JSON.stringify({ t: 'state', d: 120.5, w: 251, v: 6.12 }));
await until(() => peerUpdates(b, a.pid).some((m) => m.p.d === 120.5), 'B riceve lo stato di A');
const pa = peerUpdates(b, a.pid).at(-1)?.p;
check(pa?.d === 120.5 && pa?.w === 251 && pa?.v === 6.12, 'A → B: distanza, watt, velocità', JSON.stringify(pa));
check(pa && !('hr' in pa) && !('lat' in pa), 'nessun dato oltre nick/distanza/watt/velocità');

await sleep(400);
b.ws.send(JSON.stringify({ t: 'state', d: 80, w: 190, v: 5 }));
await until(() => peerUpdates(a, b.pid).some((m) => m.p.d === 80), 'A riceve lo stato di B');
check(peerUpdates(a, b.pid).at(-1)?.p.w === 190, 'B → A: aggiornamento nell’altra direzione');

const c = join(room, 'mortirolo-mazzo', 'Carlo');
await until(() => c.closed != null, 'C chiuso');
check(c.closed === 4002 && c.msgs.some((m) => m.t === 'error' && m.code === 'route'), 'salita diversa rifiutata', String(c.closed));

// rientro con lo stesso id: il socket vecchio cede il posto, niente doppioni
const b2 = join(room, 'selvino-nembro', 'Bruno', b.pid);
await until(() => welcome(b2), 'welcome B2');
await until(() => b.closed != null, 'B vecchio chiuso');
check(b.closed === 4010, 'rientro: il socket vecchio è sostituito', String(b.closed));
check(welcome(b2).peers.filter((p) => p.id === b.pid).length === 0 && welcome(b2).color === welcome(b).color, 'rientro: stesso colore, non vede sé stesso');

// limite di frequenza: una raffica viene scartata, poi il socket è chiuso
const before = peerUpdates(b2, a.pid).length;
await sleep(400);
for (let i = 0; i < 30; i++) a.ws.send(JSON.stringify({ t: 'state', d: 200 + i, w: 300, v: 7 }));
await until(() => a.closed != null, 'A chiuso per raffica');
await sleep(300);
const passed = peerUpdates(b2, a.pid).length - before;
check(a.closed === 4008, 'raffica di 30 messaggi: chiusura per flood', String(a.closed));
check(passed <= 2, 'raffica: al massimo 1-2 aggiornamenti inoltrati', String(passed));
await until(() => b2.msgs.some((m) => m.t === 'leave' && m.id === a.pid), 'B vede A uscire');
check(b2.msgs.some((m) => m.t === 'leave' && m.id === a.pid), 'uscita notificata');

// stanza piena: 8 posti
const full = rnd(16);
const crowd = [];
for (let i = 0; i < 8; i++) {
  crowd.push(join(full, 'stelvio-prato', `R${i}`));
  await until(() => welcome(crowd[i]), `welcome R${i}`);
}
const ninth = join(full, 'stelvio-prato', 'Nono');
await until(() => ninth.closed != null, 'nono chiuso');
check(ninth.closed === 4001 && ninth.msgs.some((m) => m.code === 'full'), 'nono ciclista: stanza piena', String(ninth.closed));
const nick = join(rnd(16), 'stelvio-prato', '‮abc');
await until(() => welcome(nick) || nick.closed != null, 'nick');
check(!nick.closed, 'nick con caratteri invisibili ripulito, non rifiutato');

for (const x of [b2, nick, ...crowd]) x.ws.close();
await sleep(200);
console.log(failures ? `\n${failures} controlli falliti su ${BASE}` : `\nTutto verde su ${BASE}`);
process.exit(failures ? 1 : 0);
