// Un Chrome headless pilotato via DevTools, con «telefoni» a 390×844. Lo usa ui-shot.mjs.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ out, chromePath = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'allenando-ui-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(chromePath, [
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
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    await sleep(200);
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
  }
  if (!version) throw new Error('Chrome non risponde');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method && msg.sessionId && handlers.has(msg.sessionId)) handlers.get(msg.sessionId)(msg);
  });
  const send = (method, params = {}, sessionId) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  async function phone(base, { width = 390, height = 844 } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const errors = [];
    handlers.set(sessionId, (msg) => {
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon|open-meteo|workers\.dev/.test(`${msg.params.entry.url ?? ''} ${msg.params.entry.text}`)) errors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
    });
    const s = (m, p) => send(m, p, sessionId);
    await s('Runtime.enable');
    await s('Log.enable');
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const evaluate = async (expression) => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const go = async (path) => {
      await s('Page.navigate', { url: `${base}${path}` });
      await sleep(700);
    };
    const waitFor = async (expr, ms = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await evaluate(expr).catch(() => false)) return true;
        await sleep(250);
      }
      return false;
    };
    const shot = async (name, full = false) => {
      let params = { format: 'png' };
      if (full) {
        const h = await evaluate('Math.ceil(document.documentElement.scrollHeight)');
        params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(h, 4000), scale: 1 } };
      }
      const { data } = await s('Page.captureScreenshot', params);
      writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'));
    };
    const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
    const clickText = (text) => evaluate(`(() => { const el = [...document.querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
    const audit = async () =>
      evaluate(`(() => {
        const overflow = document.documentElement.scrollWidth - innerWidth;
        const small = [...document.querySelectorAll('button, a, input, select, summary, [role=switch]')]
          .filter((el) => { const b = el.getBoundingClientRect(); const st = getComputedStyle(el);
            return b.width > 0 && b.height > 0 && st.visibility !== 'hidden' && !el.closest('.sr-only') && el.type !== 'range' && el.type !== 'checkbox' && (b.height < 43.5 || b.width < 43.5) && !el.closest('p, li > p'); })
          .map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
        return { overflow, small };
      })()`);
    return { s, evaluate, go, waitFor, shot, click, clickText, audit, errors };
  }

  // Browser.close prima di tutto: su Windows chrome.kill() ferma solo il lanciatore e i figli
  // restano vivi, con il loro GPU software, a mangiare memoria
  const close = async () => {
    await Promise.race([send('Browser.close').catch(() => null), sleep(3000)]);
    await sleep(500);
    chrome.kill();
  };
  return { phone, close };
}
