// Gli attrezzi comuni dei collaudi del flusso Pedala · Diario · Tu (piano U): una scheda isolata
// col profilo fatto, il rullo finto (A23) e il tocco contato. Li usano flusso-shot.mjs e ui-shot.mjs.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from './cdp.mjs';

export const PRONTO = `document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`;

/** Uno script che il browser esegue prima della pagina: iPhone senza Web Bluetooth (B4). */
export const IPHONE = `Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }); try { delete Navigator.prototype.bluetooth; } catch {}`;
/** Firefox: niente Web Bluetooth, non è un iPhone. */
export const SENZA_BT = `try { delete Navigator.prototype.bluetooth; } catch {}`;
/** Il selettore del browser resta aperto: «Cerco il rullo» (B2). */
export const SELETTORE_APERTO = `if (window.Bluetooth) Bluetooth.prototype.requestDevice = () => new Promise(() => {});`;
/** Il rullo risponde male: «Collegamento non riuscito» (B3). */
export const SELETTORE_ROTTO = `if (window.Bluetooth) Bluetooth.prototype.requestDevice = () => Promise.reject(new DOMException('GATT Server is disconnected', 'NetworkError'));`;

/** Scrive una chiave nel kv del database `allenando` (IndexedDB), dalla pagina. */
export const kv = (key, value) => `new Promise((res) => { const r = indexedDB.open('allenando', 1); r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('kv'); const rides = db.createObjectStore('rides', { keyPath: 'id' }); rides.createIndex('by-start', 'startTime'); db.createObjectStore('workouts', { keyPath: 'id' }); }; r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(${JSON.stringify(value)}, ${JSON.stringify(key)}); tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => res(false); }; r.onerror = () => res(false); })`;

/**
 * Una scheda nuova, isolata, col profilo fatto. `collaudo`: il rullo finto ('rullo', 'potenza',
 * 'cardio'), messo in localStorage prima di caricare. `init`: uno script prima della pagina.
 * `bassa`: la grafica bassa, per i collaudi della corsa su una macchina piccola.
 */
export async function apri(b, base, { width = 390, height = 844, desktop = false, collaudo = null, init = '', bassa = false, esempi = false } = {}) {
  const p = await b.phone(base, { width, height, isolato: true });
  if (desktop) await p.s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (init) await p.s('Page.addScriptToEvaluateOnNewDocument', { source: init });
  await p.go('/start');
  await p.evaluate(`(() => { ${collaudo ? `localStorage.setItem('orobia.collaudo', '${collaudo}');` : ''} localStorage.setItem('allenando.install.dismissed', '1'); return true; })()`);
  await p.go('/start');
  await p.waitFor(`!!document.querySelector('[data-testid=onboarding]')`, 15000);
  await p.evaluate(`(() => { const i = document.querySelector('[data-testid=onboarding-name]'); if (!i) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Anna'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await p.click('[data-testid=onboarding-start]');
  await p.waitFor(`!location.pathname.includes('/start')`, 8000);
  if (bassa) {
    await p.go('/impostazioni');
    await p.waitFor(`!!document.querySelector('[data-testid=impostazioni-grafica] button')`, 8000);
    await p.evaluate(`document.querySelector('[data-testid=impostazioni-grafica] button')?.click()`);
    await sleep(300);
  }
  if (esempi) {
    await p.go('/import');
    await p.waitFor(`!!document.querySelector('[data-testid=import-page]')`, 8000);
    await p.clickText('Carica gli esempi');
    await p.waitFor(`!!document.querySelector('[data-testid=import-result]')`, 20000);
  }
  return p;
}

/** Un tocco contato: il clic su un elemento visibile. */
export function contatore(p) {
  let n = 0;
  const tocca = async (sel, attesa = 15000) => {
    const ok = await p.waitFor(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled; })()`, attesa);
    if (!ok) throw new Error(`non trovo ${sel}`);
    await p.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
    n += 1;
    await sleep(350);
  };
  return { tocca, get n() { return n; }, azzera: () => (n = 0) };
}

/** Si esce dalla corsa come farebbe chi pedala: pausa, «Termina e salva», «Fatto». In-app, il rullo resta. */
export async function esci(p) {
  await p.click('[data-testid=ride-back]');
  await p.waitFor(`!!document.querySelector('[data-testid=pause-finish]')`, 8000);
  await sleep(400);
  await p.click('[data-testid=pause-finish]');
  await p.waitFor(`!!document.querySelector('[data-testid=ride-done]')`, 15000);
  await sleep(400);
  await p.click('[data-testid=ride-done]');
  await p.waitFor(`location.pathname.replace(/\\/$/, '').endsWith('/allenando') || location.pathname === '/'`, 15000);
  await sleep(600);
}

/** Una pagina dell'app senza ricaricare (come un tocco su un link): il rullo collegato resta. */
export async function naviga(p, path, attesa = null) {
  await p.evaluate(`(() => { const base = document.querySelector('base')?.getAttribute('href') ?? '/allenando/'; history.pushState({}, '', (base.endsWith('/') ? base.slice(0, -1) : base) + ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate')); return true; })()`);
  if (attesa) await p.waitFor(attesa, 15000);
  await sleep(500);
}

/** I tasti pieni (gialli) visibili dentro un contenitore: per i fogli, che coprono la pagina sotto. */
export const pieniIn = (sel) => `(() => {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const probe = document.createElement('span'); probe.style.color = accent; document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color; probe.remove();
  const root = document.querySelector(${JSON.stringify(sel)}); if (!root) return [];
  return [...root.querySelectorAll('a, button')].filter((el) => { const r = el.getBoundingClientRect(); return r.width >= 36 && r.height >= 36 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).backgroundColor === rgb; }).map((el) => el.textContent.trim().slice(0, 20));
})()`;

/**
 * I tocchi da app aperta a «sto pedalando» (§ 1 e § 5 del piano): rullo finto, mondo in cache,
 * profilo con due giri importati. Si conta da Pedala a world-ready=yes; si esce come chi pedala
 * (pausa, «Termina e salva», «Fatto»), senza ricaricare: il rullo resta collegato.
 */
export async function misuraTocchi(b, base, check, out = null) {
  const p = await apri(b, base, { collaudo: 'rullo', bassa: true, esempi: true });
  await p.evaluate(kv('world', { xp: 0, week: '', weekXp: 0, km: 0, gainM: 0, visited: {}, rides: { selvino: { count: 1, bestSec: 2480, bestAt: '2026-11-02T18:00:00.000Z', bestSim: false } }, lastDay: '' }));
  await p.go('/');
  const t = contatore(p);
  const righe = [];
  const pedala = async (caso, soglia, passi) => {
    t.azzera();
    for (const s of passi) await t.tocca(s, 40000);
    const href = await p.evaluate(`location.pathname + location.search`);
    const ok = await p.waitFor(PRONTO, 150000);
    righe.push({ caso, tocchi: t.n, soglia, link: href.replace(/^\/allenando/, '') });
    check(ok && t.n <= soglia, `tocchi · ${caso}: ${t.n} (soglia ${soglia})`, href);
    if (ok) await esci(p);
    else await p.go('/');
  };
  // il collegamento: un tocco qui, uno nel selettore del browser
  t.azzera();
  await t.tocca('[data-testid=pedala-collega]');
  const coll = t.n + 1;
  righe.push({ caso: 'Collegamento, prima corsa (+ selettore del browser)', tocchi: coll, soglia: 2 });
  check(coll <= 2, `tocchi · collegamento: ${coll} (1 + il selettore)`);
  await pedala('Percorso del mondo', 3, ['[data-testid=pedala-dove]', '[data-testid=dove-riga-val-seriana]', '[data-testid=pedala-via]']);
  const ancora = await p.evaluate(`document.querySelector('[data-testid=rullo-chip]')?.dataset.stato === 'collegato' && !document.querySelector('[data-testid=pedala-collega]')`);
  righe.push({ caso: 'Collegamento, seconda corsa', tocchi: ancora ? 0 : 1, soglia: 0 });
  check(ancora, 'tocchi · collegamento alla seconda corsa: 0, il rullo resta');
  await pedala('Ripeti l’ultimo giro', 1, ['[data-testid=pedala-via]']);
  await pedala('Giro libero', 3, ['[data-testid=pedala-dove]', '[data-testid=dove-libero]', '[data-testid=pedala-via]']);
  await pedala('Salita (col fantasma del record)', 3, ['[data-testid=pedala-dove]', '[data-testid=dove-riga-selvino]', '[data-testid=pedala-via]']);
  // l'anello: la Ganda come Dove (non contato), poi Allenamento → riga → Via
  await t.tocca('[data-testid=pedala-dove]', 40000);
  await t.tocca('[data-testid=dove-riga-ganda]', 40000);
  const sweet = async () => {
    const id = await p.evaluate(`[...document.querySelectorAll('[data-testid^=allenamento-riga-]')].find((b) => /Sweet spot/.test(b.textContent))?.dataset.testid ?? ''`);
    return `[data-testid=${id}]`;
  };
  t.azzera();
  await t.tocca('[data-testid=pedala-come-allenamento]');
  await p.waitFor(`!!document.querySelector('[data-testid=allenamento-foglio]')`, 5000);
  await t.tocca(await sweet());
  await pedala('Allenamento su un anello', 3, ['[data-testid=pedala-via]']);
  righe[righe.length - 1].tocchi += 2;
  // un tuo giro salvato, col fantasma: Dove → riga in Tuoi giri → Via
  await t.tocca('[data-testid=pedala-come-libera]');
  const giro = await p.evaluate(`(async () => { document.querySelector('[data-testid=pedala-dove]').click(); await new Promise((r) => setTimeout(r, 1500)); return document.querySelector('[data-testid^=dove-riga-giro-]')?.dataset.testid ?? ''; })()`);
  if (giro) {
    // il foglio Dove è già aperto: il tocco che lo ha aperto si aggiunge qui sotto
    await pedala('Fantasma di un giro salvato', 3, [`[data-testid=${giro}]`, '[data-testid=pedala-via]']);
    righe[righe.length - 1].tocchi += 1;
  } else check(false, 'tocchi · un giro salvato in Tuoi giri');
  if (out) writeFileSync(join(out, 'tocchi.json'), JSON.stringify(righe, null, 2));
  console.log(righe.map((r) => `${r.caso}: ${r.tocchi} (soglia ${r.soglia})`).join('\n'));
  await p.chiudi();
  return righe;
}
