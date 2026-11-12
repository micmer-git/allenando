// Collaudo senza rete (piano U, M5): il mondo leggero scende da solo al primo avvio, poi la rete
// sparisce davvero (server spento e Chrome offline) e si misura: l'app che si apre dal service
// worker, la corsa nel mondo leggero (pronta, motivo «leggero», nessuna richiesta a dem/ o b/),
// e le schermate della Ganda e di Città Alta accanto a quelle del mondo intero, fatte prima online.
//
//   npm run build && node scripts/offline-check.mjs [--port 4187] [--out <cartella>]
//
// Lancia lui il suo `vite preview` (e lo spegne a metà: è così che la rete sparisce anche per il
// service worker), e chiude Chrome e il server alla fine, anche se qualcosa va storto.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const port = Number(arg('port', '4187'));
const out = arg('out', join(process.env.LOCALAPPDATA ?? '.', 'Temp', 'orobia-sellaronda', 'u', 'motore'));
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}/allenando`;
const report = [];
let failed = 0;
const check = (ok, what, extra = '') => {
  report.push(`${ok ? 'ok ' : 'NO '} ${what}${extra ? ` · ${extra}` : ''}`);
  if (!ok) failed++;
  console.log(report.at(-1));
};
const note = (what) => {
  report.push(`   ${what}`);
  console.log(report.at(-1));
};

let server = null;
function startServer() {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', 'localhost', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
}
function stopServer() {
  if (!server) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
  server = null;
}
async function serverUp() {
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${base}/`).then((r) => r.ok).catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}

const readyExpr = `document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`;
const LIGHT = ['manifest.json', 'graph.json', 'rides.json', 'features.json', 'far.bin', 'monumenti.json'];
/** dove si fotografa: la partenza, e un punto in salita (metri sul percorso) dove si vede il pendio */
const SHOTS = [
  ['ganda', 'ganda', 0],
  ['ganda', 'ganda-salita', 17500],
  ['citta-alta', 'citta-alta', 0],
  ['citta-alta', 'citta-alta-salita', 3300],
];

startServer();
let browser = null;
try {
  check(await serverUp(), `vite preview su ${base}`);
  browser = await launch({ out });
  const p = await browser.phone(base);
  // ogni fetch della pagina, anche quelle che falliscono: senza rete non deve partire niente verso dem/ e b/
  await p.s('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const f = window.fetch.bind(window); window.__fetched = []; window.fetch = (u, o) => { try { window.__fetched.push(String(u && u.url ? u.url : u)); } catch {} return f(u, o); }; })();`,
  });

  // ---------- online: un profilo, il service worker, il mondo leggero che scende da solo ----------
  await p.go('/');
  await p.evaluate(`(async () => {
    const r = indexedDB.open('allenando', 1);
    r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('kv'); const rides = db.createObjectStore('rides', { keyPath: 'id' }); rides.createIndex('by-start', 'startTime'); db.createObjectStore('workouts', { keyPath: 'id' }); };
    await new Promise((ok, ko) => { r.onsuccess = ok; r.onerror = ko; });
    const db = r.result;
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put({ name: 'Collaudo', ftp: 250, weightKg: 72, maxHr: 186, restingHr: 52, bikeWeightKg: 8.5, cda: 0.32, crr: 0.004, onboarded: true }, 'profile');
    await new Promise((ok) => (tx.oncomplete = ok));
    db.close();
    localStorage.setItem('orobia.world', 'bergamo');
    return true;
  })()`);
  await p.go('/');
  check(await p.waitFor(`!!navigator.serviceWorker && !!navigator.serviceWorker.controller`, 30000) || (await p.go('/'), await p.waitFor(`!!navigator.serviceWorker.controller`, 20000)), 'il service worker controlla la pagina');
  const lightIn = `(async () => { const c = await caches.open('allenando-world-v1'); const keys = (await c.keys()).map((r) => r.url); return ${JSON.stringify(LIGHT)}.every((f) => keys.some((u) => u.endsWith('/world/bergamo/' + f))); })()`;
  const t0 = Date.now();
  check(await p.waitFor(lightIn, 90000), 'il mondo leggero di Bergamo scende da solo dopo l’avvio', `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const sizes = await p.evaluate(`(async () => {
    const c = await caches.open('allenando-world-v1');
    let cache = 0, dem = 0, b = 0;
    for (const r of await c.keys()) {
      if (!r.url.includes('/world/bergamo/')) continue;
      const size = (await (await c.match(r)).blob()).size;
      if (r.url.includes('/dem/')) dem += size; else if (r.url.includes('/b/')) b += size; else cache += size;
    }
    const net = performance.getEntriesByType('resource').filter((e) => /\\/world\\/bergamo\\/(manifest|graph|rides|features|far|monumenti)/.test(e.name));
    const wire = net.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0);
    return { cache, dem, b, wire };
  })()`);
  const mb = (n) => (n / 1e6).toFixed(2);
  check(sizes.cache <= 7e6, 'pacco leggero di Bergamo in cache ≤ 7 MB', `${mb(sizes.cache)} MB`);
  note(`scaricati per il leggero (Resource Timing): ${mb(sizes.wire)} MB; dem/ in cache ${mb(sizes.dem)} MB, b/ ${mb(sizes.b)} MB`);

  // ---------- online: il mondo intero, per il confronto ----------
  for (const [id, name, at] of SHOTS) {
    await p.go(`/ride?world=bergamo&ride=${id}&prova=1&stats=1${at ? `&at=${at}` : ''}`);
    const t = Date.now();
    const ok = await p.waitFor(readyExpr, 150000);
    const why = await p.evaluate('window.__orobiaReady ?? null');
    check(ok, `intero, ${name}: pronto`, `${((Date.now() - t) / 1000).toFixed(1)} s, motivo ${why?.reason}`);
    await sleep(2500);
    await p.shot(`intero-${name}`);
  }
  await p.go('/');
  await sleep(500);

  // ---------- la rete sparisce: server spento, Chrome offline ----------
  stopServer();
  await p.s('Network.enable');
  await p.s('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  check(!(await fetch(`${base}/`).then(() => true).catch(() => false)), 'la rete è sparita davvero (server spento)');

  // l'app si apre dal service worker
  await p.s('Page.navigate', { url: `${base}/` });
  const tOpen = Date.now();
  const opened = await p.waitFor(`!!document.querySelector('[data-testid^=pedala-], [data-testid^=home-]')`, 10000);
  const openMs = Date.now() - tOpen;
  check(opened && openMs <= 1500 + 250, 'offline: l’app si apre dal service worker', `${openMs} ms (soglia 1,5 s; la misura include i 250 ms del sondaggio)`);
  check(await p.evaluate('navigator.onLine === false'), 'offline: navigator.onLine è falso');
  await p.shot('offline-apertura');

  // la corsa nel mondo leggero
  for (const [id, name, at] of SHOTS) {
    await p.s('Page.navigate', { url: `${base}/ride?world=bergamo&ride=${id}&prova=1&stats=1${at ? `&at=${at}` : ''}` });
    const t = Date.now();
    const ok = await p.waitFor(readyExpr, 30000);
    const ms = Date.now() - t;
    const why = await p.evaluate('window.__orobiaReady ?? null');
    check(ok && ms <= 8000, `offline, ${name}: corsa pronta nel leggero ≤ 8 s`, `${ms} ms dalla navigazione; «pronto» del 3D a ${why?.ms} ms`);
    check(why?.reason === 'leggero', `offline, ${name}: motivo del «pronto» = leggero`, String(why?.reason));
    await sleep(2500);
    await p.shot(`leggero-${name}`);
    const asked = await p.evaluate('(window.__fetched || []).filter((u) => /\\/world\\/[^/]+\\/(dem|b)\\//.test(u))');
    check(asked.length === 0, `offline, ${name}: nessuna richiesta a dem/ o b/`, asked.slice(0, 3).join(' '));
  }
  check(p.errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|NetworkError|net::|WebSocket|workers\.dev/.test(e)).length === 0, 'nessun errore nella console (a parte la rete che non c’è)', p.errors.slice(0, 3).join(' | '));
} catch (e) {
  check(false, 'collaudo interrotto', e instanceof Error ? e.message : String(e));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  stopServer();
  writeFileSync(join(out, 'offline-check.txt'), `${report.join('\n')}\n`);
  console.log(`\n${failed ? `${failed} controlli NON passati` : 'tutto ok'} · ${out}`);
  process.exit(failed ? 1 : 0);
}
