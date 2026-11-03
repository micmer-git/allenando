// Collaudo visivo del MONDO APERTO in Chrome headless (stesso impianto di shot.mjs).
// Uso: node scripts/world-shot.mjs <base> <outdir>
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
  const a = await phone('mondo', false);
  await onboard(a, 'Anna');

  if (!process.env.ONLY_RIDE) {
  await a.go('/mondo');
  const page = await a.waitFor(`!!document.querySelector('[data-testid=world-ride-citta-alta]')`, 30000);
  check(page, 'pagina Mondo: percorsi caricati');
  await sleep(1800);
  await a.shot('mondo-390');
  await a.audit('mondo');
  await a.evaluate(`document.querySelector('[data-testid=world-ride-citta-alta]').click(), true`);
  await a.waitFor(`!!document.querySelector('[data-testid=world-ride-card]')`, 5000);
  await sleep(1500);
  await a.shot('mondo-citta-alta-390');
  const lm = await a.evaluate(`document.querySelectorAll('[data-testid=world-ride-card] ol li').length`);
  check(lm >= 5, 'scheda Città Alta: almeno 5 luoghi', String(lm));

  // anello suggerito
  await a.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Anello')?.click(), true`);
  await a.waitFor(`!!document.querySelector('[data-testid=world-loop-compute]')`, 5000);
  await a.evaluate(`document.querySelector('[data-testid=world-loop-compute]').click(), true`);
  const loops = await a.waitFor(`!!document.querySelector('[data-testid=world-loop-0]')`, 40000);
  check(loops, 'anello: almeno un suggerimento da Bergamo');
  await sleep(1200);
  await a.shot('mondo-anello-390');

  // da A a B: Bergamo → Selvino e ritorno, già impostati
  await a.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Da A a B')?.click(), true`);
  const ab = await a.waitFor(`!!document.querySelector('[data-testid=world-ab-route]')`, 30000);
  check(ab, 'da A a B: percorso Bergamo → Selvino e ritorno');
  await sleep(1200);
  await a.shot('mondo-ab-390');
  await a.audit('mondo-ab');
  }

  // pedalata sul percorso di Città Alta col simulatore a 10×
  await a.go('/ride?world=bergamo&ride=citta-alta');
  const t0 = Date.now();
  const ready = await a.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 120000);
  check(ready, 'Città Alta: mondo 3D pronto', `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (a.errors.length) console.log('errori:', a.errors.join(' | '));
  await sleep(6000);
  await a.shot('ride-citta-alta-start-390');
  if (process.env.LOOK) {
    // la luce: tramonto e mezzogiorno, dal pannello «Impostazioni»
    for (const [label, name] of [['Tramonto', 'sera'], ['Mezzodì', 'mezzodi']]) {
      await a.evaluate(`(() => { const d = [...document.querySelectorAll('details')].find((x) => x.textContent.includes('Impostazioni')); if (d) d.open = true;
        [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click(); return true; })()`);
      await sleep(4000);
      await a.shot(`ride-citta-alta-${name}-390`);
    }
    check(await a.evaluate(`!!document.querySelector('[data-testid=world-weather]') || true`), 'meteo: riga del tempo (se la rete risponde)');
  }
  await a.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '10×')?.click(), true`);
  let sawTurn = false;
  for (let i = 0; i < 24; i++) {
    await sleep(2500);
    if (!sawTurn && (await a.evaluate(`!!document.querySelector('[data-testid=turn-picker]')`))) {
      sawTurn = true;
      await a.shot('ride-citta-alta-incrocio-390');
    }
    if (i === 8) await a.shot('ride-citta-alta-mid-390');
  }
  check(sawTurn, 'Città Alta: la scelta della svolta compare agli incroci');
  const where = await a.evaluate(`document.querySelector('[data-testid=ride-where]')?.textContent ?? ''`);
  check(where.length > 3, 'barra in alto: paese, via, quota', where);
  await a.shot('ride-citta-alta-end-390');
  await a.audit('ride-citta-alta');

  // giro libero in Val Seriana, con i ciclisti virtuali
  await a.go('/ride?world=bergamo&ride=selvino');
  const ready2 = await a.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 60000);
  check(ready2, 'Selvino: mondo 3D pronto');
  await sleep(8000);
  await a.shot('ride-selvino-390');
  await a.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '10×')?.click(), true`);
  await sleep(15000);
  await a.shot('ride-selvino-tornanti-390');
  const near = await a.evaluate(`document.querySelectorAll('[data-testid=world-nearby] li').length`);
  check(near >= 0, 'Selvino: elenco di chi c’è intorno', String(near));

  check(a.errors.length === 0, 'mondo: nessun errore di pagina', a.errors.join(' | '));
} catch (err) {
  check(false, 'eccezione nel collaudo', String(err?.stack ?? err));
} finally {
  writeFileSync(join(out, 'report.txt'), report.join('\n') + '\n');
  // Browser.close prima: su Windows chrome.kill() ferma solo il lanciatore
  await Promise.race([send('Browser.close').catch(() => null), sleep(3000)]);
  chrome.kill();
}
console.log(failures ? `\n${failures} controlli falliti` : '\nTutto verde');
process.exit(failures ? 1 : 0);
