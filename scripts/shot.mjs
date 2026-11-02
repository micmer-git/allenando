// Collaudo visivo in Chrome headless via DevTools Protocol, senza dipendenze.
// Uso: node scripts/shot.mjs <base> <outdir> [--room]
//   base: es. http://127.0.0.1:4173/allenando  (o https://micmer-git.github.io/allenando)
// Telefono 390×844, WebGL software. Per ogni pagina: screenshot, errori JS, overflow
// orizzontale, bersagli tattili sotto 44 px. Con --room apre due «telefoni» in due contesti
// separati nella stessa stanza e controlla che ognuno veda l'altro.
// Esce con 1 se ci sono errori di pagina o controlli falliti.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base = 'http://127.0.0.1:4173/allenando', out = 'shots'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOM = process.argv.includes('--room');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const report = [];
function check(ok, label, extra = '') {
  const line = `${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`;
  console.log(line);
  report.push(line);
  if (!ok) failures += 1;
}

const profile = mkdtempSync(join(tmpdir(), 'allenando-shot-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  'about:blank',
]);
chrome.on('error', (e) => {
  console.error(e);
  process.exit(2);
});

let version;
for (let i = 0; i < 50 && !version; i++) {
  await sleep(200);
  version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
}
const browser = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => browser.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const handlers = new Map();
browser.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message}`));
    else resolve(msg.result);
  } else if (msg.method && msg.sessionId && handlers.has(msg.sessionId)) {
    handlers.get(msg.sessionId)(msg);
  }
});
function send(method, params = {}, sessionId) {
  const id = ++seq;
  browser.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function phone(label, isolated = true) {
  // il primo telefono usa il profilo normale (l'installabilità non vale in incognito), gli altri un contesto separato
  const { browserContextId } = isolated ? await send('Target.createBrowserContext', { disposeOnDetach: true }) : {};
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', ...(browserContextId ? { browserContextId } : {}) });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  handlers.set(sessionId, (msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon/.test(msg.params.entry.url ?? '')) errors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  });
  const s = (m, p) => send(m, p, sessionId);
  await s('Runtime.enable');
  await s('Log.enable');
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await s('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  });
  const evaluate = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const go = async (path) => {
    await s('Page.navigate', { url: `${base}${path}` });
    await sleep(600);
  };
  const waitFor = async (expr, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await evaluate(expr).catch(() => false)) return true;
      await sleep(250);
    }
    return false;
  };
  const shot = async (name) => {
    const { data } = await s('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const zoom = async (name, clip) => {
    const { data } = await s('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 3 } });
    writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const audit = async (name) => {
    const r = await evaluate(`(() => {
      const w = innerWidth;
      const overflow = document.documentElement.scrollWidth - w;
      const small = [...document.querySelectorAll('button, a, input, select, [role=switch]')]
        .filter((el) => { const b = el.getBoundingClientRect(); const st = getComputedStyle(el);
          return b.width > 0 && b.height > 0 && st.visibility !== 'hidden' && !el.closest('.sr-only') && el.type !== 'range' && el.type !== 'checkbox' && (b.height < 43.5 || b.width < 43.5) && !el.closest('p, li > p'); })
        .map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
      return { overflow, small };
    })()`);
    check(r.overflow <= 0, `${label}/${name}: niente overflow orizzontale a 390 px`, r.overflow > 0 ? `${r.overflow}px` : '');
    check(r.small.length === 0, `${label}/${name}: bersagli tattili ≥ 44 px`, r.small.join(' | '));
    return r;
  };
  return { label, s, evaluate, go, waitFor, shot, zoom, audit, errors, sessionId };
}

async function onboard(p, name) {
  await p.go('/start');
  await p.waitFor(`!!document.querySelector('[data-testid=onboarding-name]')`);
  await p.evaluate(`(() => { const i = document.querySelector('[data-testid=onboarding-name]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(name)});
    i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); return true; })()`);
  await p.waitFor(`location.pathname.endsWith('/allenando/') || location.pathname.endsWith('/allenando')`, 8000);
}

try {
  const a = await phone('telefono-A', false);
  await onboard(a, 'Anna');
  await a.evaluate(`localStorage.setItem('allenando.room.nick', 'Anna'), true`);

  await a.go('/');
  await a.waitFor(`!!document.querySelector('[data-testid^=home-climb]')`);
  await sleep(500);
  await a.shot('home-390');
  await a.audit('home');

  await a.go('/salite');
  await a.waitFor(`document.body.innerText.includes('Selvino')`);
  await sleep(500);
  await a.shot('salite-390');
  await a.audit('salite');

  // installabilità: manifest, service worker, errori di Chrome
  await a.go('/');
  await sleep(2500);
  const manifest = await a.s('Page.getAppManifest');
  const parsed = manifest.data ? JSON.parse(manifest.data) : {};
  check(manifest.errors.length === 0 && parsed.display === 'standalone', 'manifest valido, display standalone', `${manifest.url} errori:${manifest.errors.length}`);
  const sw = await a.waitFor(`navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active))`, 15000);
  check(sw, 'service worker attivo');
  const inst = await a.s('Page.getInstallabilityErrors');
  check(inst.installabilityErrors.length === 0, 'Chrome: nessun errore di installabilità', JSON.stringify(inst.installabilityErrors));

  await a.go('/ride?route=selvino-nembro');
  const ready = await a.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 30000);
  check(ready, 'telefono-A: mondo 3D pronto');
  await sleep(2500);

  if (ROOM) {
    // la stanza si crea dalla UI, come farebbe una persona: icona → nome → «Crea la stanza e invita»
    await a.evaluate(`document.querySelector('[data-testid=room-open]').click(), true`);
    await a.waitFor(`!!document.querySelector('[data-testid=room-create]')`, 5000);
    await a.evaluate(`document.querySelector('[data-testid=room-create]').click(), true`);
    const linked = await a.waitFor(`/[?&]room=[A-Za-z0-9_-]{22}/.test(location.search) && !!document.querySelector('[data-testid=room-link]')`, 8000);
    const invite = await a.evaluate(`document.querySelector('[data-testid=room-link]')?.value ?? ''`);
    check(linked && /\/allenando\/ride\?route=selvino-nembro&room=[A-Za-z0-9_-]{22}$/.test(invite), 'stanza creata dalla UI, link d’invito pronto', invite);
    const stillReady = await a.evaluate(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`);
    check(stillReady, 'creare la stanza non ricarica la strada');
    await a.waitFor(`document.body.innerText.includes('In stanza')`, 8000);
    await a.shot('ride-room-sheet-A-390');
    await a.audit('room-sheet');
    await a.evaluate(`[...document.querySelectorAll('[data-testid=room-sheet] button')].find((x) => x.textContent.trim() === 'Chiudi').click(), true`);
    const ridePath = invite.slice(invite.indexOf('/ride'));

    const b = await phone('telefono-B');
    await onboard(b, 'Bruno');
    await b.go(ridePath);
    await b.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 30000);
    // chi arriva dal link senza un nome salvato vede il foglio d'invito e sceglie come farsi vedere
    const invitedSheet = await b.waitFor(`!!document.querySelector('[data-testid=room-join]')`, 8000);
    check(invitedSheet, 'telefono-B: dal link si apre il foglio «Entra nella stanza»');
    await b.shot('ride-invite-B-390');
    await b.evaluate(`(() => { const i = document.querySelector('[data-testid=room-nick]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Bruno');
      i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(200);
    await b.evaluate(`document.querySelector('[data-testid=room-join]').click(), true`);
    await b.waitFor(`!!document.querySelector('[data-testid=room-leave]')`, 8000);
    await b.evaluate(`[...document.querySelectorAll('[data-testid=room-sheet] button')].find((x) => x.textContent.trim() === 'Chiudi').click(), true`);
    const seesA = await b.waitFor(`[...document.querySelectorAll('[data-testid=room-rider]')].some((el) => el.textContent.includes('Anna'))`, 15000);
    const seesB = await a.waitFor(`[...document.querySelectorAll('[data-testid=room-rider]')].some((el) => el.textContent.includes('Bruno'))`, 15000);
    check(seesA, 'telefono-B vede Anna nel pannello');
    check(seesB, 'telefono-A vede Bruno nel pannello');
    const status = await a.evaluate(`document.querySelector('[data-testid=room-status]')?.dataset.status`);
    check(status === 'open', 'stato stanza «open» su A', String(status));
    const clickText = (p, text) => p.evaluate(`(() => { const el = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); el?.click(); return !!el; })()`);
    const panel = (p) => p.evaluate(`[...document.querySelectorAll('[data-testid=room-rider]')].map((el) => el.textContent).join(' / ')`);
    // A si ferma, B accelera: su A il distacco di Bruno deve passare da «dietro» a «davanti»
    check(await clickText(a, 'Pausa'), 'A mette in pausa');
    await sleep(1500);
    const idleOnB = await b.waitFor(`[...document.querySelectorAll('[data-testid=room-rider]')].some((el) => el.textContent.includes('fermo'))`, 8000);
    check(idleOnB, 'su B, Anna risulta «fermo» (pausa trasmessa)');
    await clickText(b, '10×');
    const ahead = await a.waitFor(`[...document.querySelectorAll('[data-testid=room-rider]')].some((el) => /davanti/.test(el.textContent))`, 40000);
    check(ahead, 'su A, Bruno risulta davanti (distanza dal vivo)', await panel(a));
    const remote3d = await a.evaluate(`document.querySelector('[data-testid=room-3d]')?.dataset.count`);
    check(remote3d === '1', 'su A, un ciclista lontano nel mondo 3D', String(remote3d));
    const remote3dB = await b.evaluate(`document.querySelector('[data-testid=room-3d]')?.dataset.count`);
    check(remote3dB === '1', 'su B, un ciclista lontano nel mondo 3D', String(remote3dB));
    await clickText(b, 'Pausa');
    await sleep(1200);
    await b.shot('ride-room-B-390');
    await a.shot('ride-room-A-390');
    await b.audit('ride');
    check(b.errors.length === 0, 'telefono-B: nessun errore di pagina', b.errors.join(' | '));
  } else {
    await a.shot('ride-390');
  }
  // il ciclista da vicino: proporzioni, gambe sui pedali, ruote
  await a.zoom('ride-rider-zoom', { x: 115, y: 190, width: 160, height: 140 });
  await a.audit('ride');
  check(a.errors.length === 0, 'telefono-A: nessun errore di pagina', a.errors.join(' | '));
} catch (err) {
  check(false, 'eccezione nel collaudo', String(err?.stack ?? err));
} finally {
  writeFileSync(join(out, 'report.txt'), report.join('\n') + '\n');
  chrome.kill();
}
console.log(failures ? `\n${failures} controlli falliti` : '\nTutto verde');
process.exit(failures ? 1 : 0);
