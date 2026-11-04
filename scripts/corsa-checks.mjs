// Collaudo della corsa (pista 2): velo di caricamento, numeri grandi, niente tasti gialli, fascia
// centrale libera, pausa che si vede, «Termina» da tenere premuto, giro salvato da solo, ripresa
// dopo la scheda chiusa, incrocio con tre frecce, orizzontale e computer.
// Lo chiamano ui-shot.mjs (in coda) e game-shot.mjs (holdFinish). Non apre un Chrome suo.
import { sleep } from './cdp.mjs';

const ready = `document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`;

/** Tiene premuto un elemento col dito (eventi touch veri di Chrome) per `ms` millisecondi. */
export async function hold(p, sel, ms = 1100) {
  const at = await p.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!at) return false;
  // Chrome sotto carico consegna i tocchi finti in ritardo, e l'app misura la pressione sui tempi
  // degli eventi. Pressione lunga: si aspetta che il tocco sia arrivato, poi si tiene `ms` (dura
  // almeno `ms`). Tocco breve: il dito si alza `ms` dopo senza aspettare (non si allunga)
  const down = p.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
  if (ms >= 800) await down;
  await sleep(ms);
  const up = p.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await Promise.all([down, up]);
  return true;
}

/** «Termina» col dito: 1,1 s premuto, poi il riepilogo. */
export const holdFinish = (p) => hold(p, '[data-testid=ride-finish]', 1100);

/** Le misure della corsa, prese nella pagina. */
export const probe = `(() => {
  const r = document.querySelector('[data-testid=ride-screen]');
  if (!r) return null;
  const vis = (e) => { const b = e.getBoundingClientRect(); const st = getComputedStyle(e); return b.width > 0 && b.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && b.bottom > 0 && b.top < innerHeight; };
  const c = r.querySelector('[data-testid=ride-stage] canvas');
  const cb = c ? c.getBoundingClientRect() : null;
  const big = [...r.querySelectorAll('[data-big]')].map((e) => Math.round(parseFloat(getComputedStyle(e).fontSize)));
  // tasti gialli pieni: ammessa solo la velocità scelta del simulatore
  const yellow = [...r.querySelectorAll('button')].filter((b) => vis(b) && getComputedStyle(b).backgroundColor === 'rgb(255, 200, 20)' && !(b.closest('[aria-label="Velocità del simulatore"]') && b.getAttribute('aria-pressed') === 'true')).map((b) => (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 24));
  // la fascia 35–65% dell'altezza del 3D: libera, tranne l'incrocio
  const band = cb ? [cb.top + cb.height * 0.35, cb.top + cb.height * 0.65] : [0, 0];
  const panels = [
    ...r.querySelectorAll('[data-testid=ride-route], [data-testid=ride-hud-center] > *, [data-testid=ride-hud-right] > *, [data-testid=ride-hud-bottom] > *, [data-testid=world-mini], [data-testid=ride-profile]'),
  ].filter((e) => vis(e) && e.dataset.testid !== 'turn-picker');
  const inBand = panels.filter((e) => { const b = e.getBoundingClientRect(); return b.bottom > band[0] && b.top < band[1]; }).map((e) => (e.dataset.testid || e.className.split(' ')[0] || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().top) + '-' + Math.round(e.getBoundingClientRect().bottom));
  return {
    canvas: cb ? [Math.round(cb.width), Math.round(cb.height)] : null,
    big, yellow, inBand, band: band.map(Math.round),
    time: document.querySelector('[data-testid=ride-time]')?.textContent ?? '',
    km: document.querySelector('[data-testid=ride-km] [data-big]')?.textContent ?? '',
    live: !!document.querySelector('[data-testid=segment-live]'),
    poi: !!document.querySelector('[data-testid=poi-toast]'),
    summary: !!document.querySelector('[data-testid=ride-summary]'),
    pause: !!document.querySelector('[data-testid=pause-veil]'),
    veil: !!document.querySelector('[data-testid=ride-loading]'),
  };
})()`;

/** Testi tagliati con l'ellissi dentro un contenitore. */
export const ellipsis = (sel) => `(() => {
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return [];
  return [...root.querySelectorAll('*')].filter((e) => { const st = getComputedStyle(e); const b = e.getBoundingClientRect(); return b.width > 0 && st.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1; }).map((e) => e.textContent.trim().slice(0, 40));
})()`;

/** Testi che cominciano in minuscolo (lo stesso controllo di pagine.mjs), dentro un contenitore. */
export const lowercase = (sel) => `(() => {
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return [];
  const res = new Set();
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) {
    const t = n.textContent.trim(); if (t.length < 4 || !/\\s/.test(t)) continue;
    const el = n.parentElement; if (!el) continue; const b = el.getBoundingClientRect(); if (!b.width) continue;
    const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.textTransform === 'uppercase') continue;
    if (/^[a-zàèéìòù]/.test(t) && !/^(km|m |min|kg|bpm|rpm|ml|h )/.test(t)) res.add(t.slice(0, 60));
  }
  return [...res];
})()`;

/**
 * Il collaudo intero della corsa. `b` è il browser di cdp.mjs, `check` quello dello script che
 * chiama. Le schermate vanno in `out` coi nomi `c2-*`.
 */
export async function collaudoCorsa({ b, base, check, out = '' }) {
  void out;
  const p = await b.phone(base);
  // il profilo c'è già nel browser (onboarding fatto da chi chiama): si entra
  // 2.2 il velo prima del mondo
  await p.go('/ride?world=bergamo&ride=citta-alta');
  // l'app si avvia (sotto carico anche qualche secondo), poi la corsa si monta sotto il velo e aspetta il mondo
  await p.waitFor(`!!document.querySelector('[data-testid=ride-loading]') || ${ready}`, 60000);
  const veil0 = await p.evaluate(`({ veil: !!document.querySelector('[data-testid=ride-loading]') && !(${ready}), title: document.querySelector('[data-testid=ride-loading-title]')?.textContent ?? '' })`);
  await p.shot('c2-20-velo');
  await p.waitFor(`!!document.querySelector('[data-testid=ride-screen]') || ${ready}`, 120000);
  const early = await p.evaluate(probe);
  const before = await p.evaluate(`({ ready: ${ready}, veil: !!document.querySelector('[data-testid=ride-loading]'), title: document.querySelector('[data-testid=ride-loading-title]')?.textContent ?? '' })`);
  check(veil0.veil, 'corsa: prima del mondo c’è il velo', JSON.stringify(veil0));
  check(/Città Alta/i.test(veil0.title) || /Città Alta/i.test(before.title), 'corsa: il velo dice il nome del percorso', JSON.stringify([veil0, before]));
  // se il mondo è già pronto qui, il controllo del tempo fermo non si può fare su questa macchina
  check(before.ready || (!!early && !early.live && !early.poi && /^00:00$/.test(early.time)), 'corsa: prima del mondo tempo 00:00, niente tratti né punti caldi', JSON.stringify(early));
  check(await p.waitFor(ready, 150000), 'corsa: mondo pronto');
  await sleep(600);
  check(!(await p.evaluate(`!!document.querySelector('[data-testid=ride-loading]')`)), 'corsa: il velo se ne va');
  await p.clickText('10×');
  await sleep(8000);
  await p.shot('c2-22-corsa');
  const m = await p.evaluate(probe);
  check(m.canvas && m.canvas[1] >= 620, 'corsa: 3D ≥ 620 px su 844', JSON.stringify(m.canvas));
  check(m.big.length === 3 && m.big.every((s) => s >= 28), 'corsa: watt, tempo e km ≥ 28 px', m.big.join(' '));
  check(m.yellow.length === 0, 'corsa: nessun tasto giallo pieno tranne la velocità scelta', m.yellow.join(' | '));
  check(m.inBand.length === 0, 'corsa: fascia 35–65% del 3D libera (tranne l’incrocio)', `${m.band} ${m.inBand.join(' | ')}`);
  const cut = await p.evaluate(ellipsis('[data-testid=ride-screen]'));
  check(cut.length === 0, 'corsa: nessun testo troncato', cut.join(' | '));
  const low = await p.evaluate(lowercase('[data-testid=ride-screen]'));
  check(low.length === 0, 'corsa: nessun testo in minuscolo', low.join(' | '));
  const a = await p.audit();
  check(a.small.length === 0, 'corsa: bersagli ≥ 44 px', a.small.join(' | '));
  // 2.3 Termina: un clic non chiude
  await p.click('[data-testid=ride-finish]');
  check(await p.waitFor(`/Tieni premuto/.test(document.querySelector('[data-testid=ride-finish]')?.textContent ?? '')`, 3000), 'termina: il clic dice «Tieni premuto»');
  await sleep(3000);
  check(!(await p.evaluate(`!!document.querySelector('[data-testid=ride-summary]')`)), 'termina: un clic non apre il riepilogo');
  // un tocco breve col dito nemmeno
  await hold(p, '[data-testid=ride-finish]', 150);
  await sleep(3000);
  check(!(await p.evaluate(`!!document.querySelector('[data-testid=ride-summary]')`)), 'termina: un tocco breve non apre il riepilogo');
  // 2.4 la pausa si vede, e i numeri stanno fermi
  await p.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Pausa$/.test(x.textContent.trim())); b?.click(); return !!b; })()`);
  check(await p.waitFor(`!!document.querySelector('[data-testid=pause-veil]') && getComputedStyle(document.querySelector('[data-testid=pause-veil]')).opacity === '1'`, 4000), 'pausa: il velo «In pausa»');
  const t0 = await p.evaluate(`[document.querySelector('[data-testid=ride-time]').textContent, document.querySelector('[data-testid=ride-km]').textContent, document.querySelector('[data-testid=ride-power]').textContent]`);
  await sleep(1500);
  await p.shot('c2-24-pausa');
  await sleep(3600);
  const t1 = await p.evaluate(`[document.querySelector('[data-testid=ride-time]').textContent, document.querySelector('[data-testid=ride-km]').textContent, document.querySelector('[data-testid=ride-power]').textContent]`);
  check(JSON.stringify(t0) === JSON.stringify(t1), 'pausa: tempo, km e watt fermi per 5 s', `${t0} → ${t1}`);
  const lowP = await p.evaluate(lowercase('[data-testid=pause-veil]'));
  check(lowP.length === 0, 'pausa: nessun testo in minuscolo', lowP.join(' | '));
  await p.click('[data-testid=pause-resume]');
  check(await p.waitFor(`!document.querySelector('[data-testid=pause-veil]')`, 4000), 'pausa: «Riprendi» riparte');
  await sleep(1500);
  // tenendo premuto sì, e il giro è già nel diario
  check(await holdFinish(p), 'termina: il dito tiene premuto');
  check(await p.waitFor(`!!document.querySelector('[data-testid=ride-summary]')`, 30000), 'termina: tenuto 1 s apre il riepilogo');
  check(await p.waitFor(`document.querySelector('[data-testid=ride-saved]')?.dataset.state === 'saved'`, 30000), 'riepilogo: «Giro salvato» senza toccare niente');
  check(await p.waitFor(`!!document.querySelector('[data-testid=rewards]')`, 15000), 'riepilogo: oro e traguardi');
  check(await p.evaluate(`!!document.querySelector('[data-testid=summary-map] canvas') && !!document.querySelector('[data-testid=summary-profile]')`), 'riepilogo: la carta con la traccia e il profilo');
  check(await p.evaluate(`!!document.querySelector('[data-testid=ride-summary-extra]')`), 'riepilogo: la riga delle azioni secondarie (FIT, diario; cartolina)');
  await sleep(800);
  await p.shot('c2-25-riepilogo');
  await p.shot('c2-25-riepilogo-tutta', true);
  const lowS = await p.evaluate(lowercase('[data-testid=ride-summary]'));
  check(lowS.length === 0, 'riepilogo: nessun testo in minuscolo', lowS.join(' | '));
  const cutS = await p.evaluate(ellipsis('[data-testid=ride-summary]'));
  check(cutS.length === 0, 'riepilogo: nessun testo troncato', cutS.join(' | '));
  const aS = await p.audit();
  check(aS.small.length === 0, 'riepilogo: bersagli ≥ 44 px', aS.small.join(' | '));
  const saved = await p.evaluate(`document.querySelector('[data-testid=ride-summary] h2')?.textContent ?? ''`);
  // ricaricando, il giro è nel diario
  await p.go('/history');
  await sleep(1500);
  check(await p.evaluate(`document.body.innerText.includes(${JSON.stringify(saved)})`), 'salvataggio: il giro è nel diario dopo un ricaricamento', saved);

  // 2.1 la scheda si chiude a metà giro: alla riapertura «Riprendi»
  await p.go('/ride?world=bergamo&ride=citta-alta');
  await p.waitFor(ready, 150000);
  await p.clickText('10×');
  // si chiude la scheda a 60 s di giro (sul tempo del giro: col 3D lento il simulatore va più piano dell'orologio)
  check(await p.waitFor(`(() => { const t = (document.querySelector('[data-testid=ride-time]')?.textContent ?? '0:0').split(':').map(Number); return t[0] * 60 + t[1] >= 60; })()`, 300000), 'ripresa: il giro arriva a 60 s');
  const atClose = await p.evaluate(`({ time: document.querySelector('[data-testid=ride-time]').textContent, km: document.querySelector('[data-testid=ride-km] [data-big]').textContent })`);
  await p.s('Page.close').catch(() => null);
  await sleep(1500);
  const q = await b.phone(base);
  await q.go('/');
  const sheet = await q.waitFor(`!!document.querySelector('[data-testid=ride-recovery]')`, 10000);
  check(sheet, 'ripresa: riaprendo, «Hai un giro a metà»');
  await sleep(500);
  await q.shot('c2-30-giro-a-meta');
  if (sheet) {
    const card = await q.evaluate(`document.querySelector('[data-testid=ride-recovery]').innerText`);
    await q.click('[data-testid=recovery-resume]');
    check(await q.waitFor(ready, 150000), 'ripresa: il mondo riparte');
    await sleep(800);
    const resumed = await q.evaluate(`({ time: document.querySelector('[data-testid=ride-time]').textContent, km: document.querySelector('[data-testid=ride-km] [data-big]').textContent, pause: !!document.querySelector('[data-testid=pause-veil]') })`);
    const sec = (s) => s.split(':').reduce((acc, x) => acc * 60 + Number(x), 0);
    const kmv = (s) => Number(String(s).replace(',', '.'));
    check(Math.abs(sec(resumed.time) - sec(atClose.time)) <= 1 && Math.abs(kmv(resumed.km) - kmv(atClose.km)) <= 0.02, 'ripresa: tempo e km come alla chiusura (entro 1 s)', `${JSON.stringify(atClose)} → ${JSON.stringify(resumed)} · ${card.replace(/\n/g, ' / ')}`);
    check(resumed.pause, 'ripresa: si riparte in pausa, con «Riprendi»');
    await q.shot('c2-31-ripreso');
    await q.click('[data-testid=pause-resume]');
    await sleep(1200);
    await holdFinish(q);
    check(await q.waitFor(`document.querySelector('[data-testid=ride-saved]')?.dataset.state === 'saved'`, 30000), 'ripresa: finito, il giro è salvato');
    await q.go('/');
    await sleep(1500);
    check(!(await q.evaluate(`!!document.querySelector('[data-testid=ride-recovery]')`)), 'ripresa: dopo il salvataggio non si chiede più');
  }

  // 2.7 l'incrocio, a Città Alta at=130 e at=1500
  for (const at of [130, 1500]) {
    await q.go(`/ride?world=bergamo&ride=citta-alta&at=${at}`);
    await q.waitFor(ready, 150000);
    await q.clickText('4×');
    const seen = await q.waitFor(`!!document.querySelector('[data-testid=turn-picker]')`, 40000);
    await sleep(400);
    await q.shot(`c2-26-incrocio-${at}`);
    if (!seen) {
      check(false, `incrocio at=${at}: compare la scelta`);
      continue;
    }
    const turns = await q.evaluate(`[...document.querySelectorAll('[data-testid=turn-picker] button')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`);
    const cutT = await q.evaluate(ellipsis('[data-testid=turn-picker]'));
    check(turns.length >= 2 && turns.length <= 3, `incrocio at=${at}: al massimo 3 frecce`, turns.join(' | '));
    check(new Set(turns).size === turns.length, `incrocio at=${at}: nomi diversi`, turns.join(' | '));
    check(cutT.length === 0, `incrocio at=${at}: nessun nome troncato`, cutT.join(' | '));
    check((await q.evaluate(lowercase('[data-testid=turn-picker]'))).length === 0, `incrocio at=${at}: maiuscole`);
    const route = await q.evaluate(`document.querySelector('[data-testid=turn-picker] [data-route=yes]')?.innerText.trim() ?? ''`);
    check(!route || /Percorso/.test(route), `incrocio at=${at}: la freccia del percorso dice «Percorso»`, route);
  }
  // un giro rimasto a metà non deve restare nel browser di chi chiama
  await q.evaluate(`(async () => { const r = indexedDB.open('allenando'); await new Promise((ok) => (r.onsuccess = ok)); const db = r.result; const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(null, 'ride:checkpoint'); await new Promise((ok) => (tx.oncomplete = ok)); return true; })()`);
  return [p, q];
}

/** Orizzontale 844×390 e computer 1280×800: il 3D a tutto schermo, i numeri grandi. */
export async function collaudoLargo({ b, base, check }) {
  for (const [w, h, name, minFont] of [
    [844, 390, 'c2-w30-corsa-orizzontale', 28],
    [1280, 800, 'c2-d44-corsa', 32],
  ]) {
    const p = await b.phone(base, { width: w, height: h });
    if (w >= 1280) await p.s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await p.go('/ride?world=bergamo&ride=citta-alta&at=1500');
    check(await p.waitFor(ready, 150000), `${w}×${h}: mondo pronto`);
    await p.clickText('4×');
    await sleep(5000);
    await p.shot(name);
    const m = await p.evaluate(probe);
    check(m.canvas && m.canvas[0] >= Math.min(w, 1280) - 4 && m.canvas[1] >= h, `${w}×${h}: 3D a tutto schermo`, JSON.stringify(m.canvas));
    check(m.big.length === 3 && m.big.every((s) => s >= minFont), `${w}×${h}: watt, tempo e km ≥ ${minFont} px`, m.big.join(' '));
    check(m.yellow.length === 0, `${w}×${h}: nessun tasto giallo pieno tranne la velocità`, m.yellow.join(' | '));
    const a = await p.audit();
    check(a.overflow <= 0, `${w}×${h}: niente overflow`, String(a.overflow));
    check(a.small.length === 0, `${w}×${h}: bersagli ≥ 44 px`, a.small.join(' | '));
    const cut = await p.evaluate(ellipsis('[data-testid=ride-screen]'));
    check(cut.length === 0, `${w}×${h}: nessun testo troncato`, cut.join(' | '));
    await p.s('Page.close').catch(() => null);
    await sleep(500);
  }
}
