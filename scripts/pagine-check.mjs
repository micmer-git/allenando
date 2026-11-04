// I controlli delle pagine fuori dalla corsa, condivisi da ui-shot.mjs e game-shot.mjs.
// Minuscole a inizio testo, bersagli sotto 44 px, ellissi nel primo schermo, la parola «XP»,
// e i «fatto» del piano di rilascio (pista 1) pagina per pagina.
import { sleep } from './cdp.mjs';

/** I testi che cominciano in minuscolo (lo stesso controllo di pagine.mjs dell'audit). Le unità no. */
export const MINUSCOLE = `(() => {
  const res = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) {
    const t = n.textContent.trim(); if (t.length < 4 || !/\\s/.test(t)) continue;
    const el = n.parentElement; if (!el) continue; const b = el.getBoundingClientRect(); if (!b.width) continue;
    const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.textTransform === 'uppercase') continue;
    if (/^[a-zàèéìòù]/.test(t) && !/^(km|m |min|kg|bpm|rpm|ml|h )/.test(t)) res.add(t.slice(0, 60));
  }
  return [...res].slice(0, 30);
})()`;

/** Testo tagliato dall'ellissi (una riga o line-clamp) dentro il primo schermo. */
export const ELLISSI = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || !el.textContent.trim() || el.matches('input, select, textarea')) continue;
    const one = st.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    const clamp = st.webkitLineClamp && st.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
    if (one || clamp) out.push(el.textContent.trim().slice(0, 40));
  }
  return out;
})()`;

/** Un'unità (m, km, %, W…) che comincia una riga, separata dal suo numero sulla riga sopra. */
export const UNITA_A_CAPO = `(() => {
  const words = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) {
    const el = n.parentElement; if (!el || !el.getClientRects().length) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    const re = /\\S+/g; let m;
    while ((m = re.exec(n.textContent))) {
      const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      const rs = r.getClientRects(); if (!rs.length) continue;
      words.push({ t: m[0], top: rs[0].top, left: rs[0].left, el });
    }
  }
  const out = [];
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1], b = words[i];
    // a capo vuol dire: la parola dopo ricomincia più in basso e più a sinistra, nello stesso testo o in un suo span
    const stesso = a.el === b.el || b.el.parentElement === a.el;
    if (stesso && /\\d$/.test(a.t) && b.top > a.top && b.left < a.left &&/^(km|m|%|W|W\\/kg|bpm|rpm|min|h)([·,.;:)]|$)/.test(b.t)) out.push(a.t + ' ⏎ ' + b.t);
  }
  return out.slice(0, 20);
})()`;

/** Parole visibili nel primo schermo (barra in basso esclusa). */
export const PAROLE = `(() => {
  let n = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let t; while ((t = w.nextNode())) {
    const el = t.parentElement; if (!el || el.closest('[data-testid=bottom-nav]')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || r.bottom <= 0 || r.top >= innerHeight) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    n += (t.textContent.match(/\\S+/g) || []).filter((w) => /[A-Za-zÀ-ÿ0-9]/.test(w)).length;
  }
  return n;
})()`;

/** Tasti e link gialli pieni nel primo schermo. */
export const PIENI = `(() => {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const probe = document.createElement('span'); probe.style.color = accent; document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color; probe.remove();
  return [...document.querySelectorAll('a, button, [aria-hidden=true]')].filter((el) => {
    const r = el.getBoundingClientRect(); if (!r.width || r.bottom <= 0 || r.top >= innerHeight) return false;
    if (r.width < 36 || r.height < 36) return false;
    return getComputedStyle(el).backgroundColor === rgb;
  }).map((el) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 20));
})()`;

const top = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; })()`;

/** Le minuscole su qualche pagina e, nel Mondo, su ognuna delle cinque schede. */
export async function minuscoleSu(p, check, paths) {
  for (const path of paths) {
    await p.go(path);
    await p.waitFor(`!!document.body && !!document.querySelector('main')`, 30000);
    await sleep(path === '/mondo' ? 2500 : 900);
    const min = await p.evaluate(MINUSCOLE);
    check(min.length === 0, `${path}: niente testi in minuscolo`, min.join(' | '));
    if (path === '/mondo') {
      const n = await p.evaluate(`document.querySelectorAll('[data-testid=world-tabs] button').length`);
      for (let i = 0; i < n; i++) {
        await p.evaluate(`document.querySelectorAll('[data-testid=world-tabs] button')[${i}].click()`);
        await sleep(1000);
        const m = await p.evaluate(MINUSCOLE);
        check(m.length === 0, `/mondo, scheda ${i + 1}: niente testi in minuscolo`, m.join(' | '));
      }
    }
  }
}

/** Un giro di tutte le pagine a 390×844: minuscole, bersagli, overflow, «XP», e i «fatto» della pista 1. */
export async function giroPagine(p, check, { shot = null } = {}) {
  const base = async (name) => {
    const min = await p.evaluate(MINUSCOLE);
    check(min.length === 0, `${name}: niente testi in minuscolo`, min.join(' | '));
    const a = await p.audit();
    check(a.overflow <= 0, `${name}: niente overflow`, a.overflow > 0 ? `${a.overflow}px` : '');
    check(a.small.length === 0, `${name}: bersagli ≥ 44 px`, a.small.join(' | '));
    const xp = await p.evaluate(`/\\bXP\\b/.test(document.body.innerText)`);
    check(!xp, `${name}: nessun «XP» a schermo`);
    const capo = await p.evaluate(UNITA_A_CAPO);
    check(capo.length === 0, `${name}: nessuna unità a capo da sola`, capo.join(' | '));
    const v = await p.evaluate(`document.body.innerText.includes('\\u2304')`);
    check(!v, `${name}: nessuna «⌄» di testo come freccia`);
  };
  const go = async (name, path, wait = null, ms = 900) => {
    await p.go(path);
    await p.waitFor(`!!document.body && !!document.querySelector('main')`, 30000);
    if (wait) await p.waitFor(wait, 30000);
    await sleep(ms);
    await p.evaluate('scrollTo(0, 0)');
    if (shot) await p.shot(`p1-${name}`);
  };
  const ellissi = async (name) => {
    const e = await p.evaluate(ELLISSI);
    check(e.length === 0, `${name}: nessuna ellissi nel primo schermo`, e.join(' | '));
  };
  const backTo = async (name, to) => {
    const href = await p.evaluate(`document.querySelector('[data-testid=page-header] [data-testid=back-link]')?.getAttribute('href') ?? ''`);
    check(href.endsWith(to), `${name}: la testata ha il ritorno a ${to}`, href);
  };

  // Oggi, senza giri: un solo pieno, niente riquadri dei 7 giorni
  await go('oggi', '/', `!!document.querySelector('[data-testid=home-missions]')`);
  await base('oggi');
  await ellissi('oggi');
  const pieni = await p.evaluate(PIENI);
  check(pieni.length <= 1, 'oggi: un solo tasto giallo pieno nel primo schermo', pieni.join(' | '));
  check(!(await p.evaluate(`!!document.querySelector('[data-testid=home-week]')`)), 'oggi: niente riquadri dei 7 giorni senza giri');
  const orologio = await p.evaluate(`document.querySelector('[data-testid=home-session-clock]')?.getAttribute('aria-label') ?? ''`);
  check(/^(Fra|Via fra|Partita da) \S/.test(orologio), 'oggi: il conto alla rovescia ha la sua parola', orologio);
  check(!(await p.evaluate(`[...document.querySelectorAll('[data-testid=home-session] *')].some((e) => parseFloat(getComputedStyle(e).width) <= 8 && e.getBoundingClientRect().height > 40)`)), 'oggi: niente barretta sul lato della sessione');

  // Mondo e le sue cinque schede
  await go('mondo', '/mondo', `!!document.querySelector('[data-testid=world-ride-citta-alta]')`, 1500);
  await base('mondo');
  const carta = await p.evaluate(top('[data-testid=world-page] canvas'));
  check(!!carta && carta.top <= 220, 'mondo: la carta comincia entro 220 px', JSON.stringify(carta));
  check(!(await p.evaluate(`/in rete/i.test(document.body.innerText)`)), 'mondo: niente «in rete: –»');
  const righe = await p.evaluate(`[...document.querySelectorAll('[data-testid^=world-ride-]')].filter((b) => b.querySelector('[data-testid=world-ride-side]')).filter((b) => { const n = b.querySelector('[data-testid=world-ride-name]').getBoundingClientRect(); const s = b.querySelector('[data-testid=world-ride-side]').getBoundingClientRect(); return s.top < n.bottom - 2; }).map((b) => b.textContent.trim().slice(0, 40))`);
  check(righe.length === 0, 'mondo: il sottotitolo del percorso su una riga sua', righe.join(' | '));
  const tabs = await p.evaluate(`[...document.querySelectorAll('[data-testid=world-tabs] button')].map((b) => b.textContent.trim())`);
  for (const [i, tab] of tabs.entries()) {
    await p.evaluate(`document.querySelectorAll('[data-testid=world-tabs] button')[${i}].click()`);
    await sleep(1200);
    await base(`mondo, ${tab}`);
  }

  // Salite: poca prosa
  await go('salite', '/salite', `!!document.querySelector('[data-testid=climb-selvino-nembro]')`);
  await base('salite');
  const parole = await p.evaluate(PAROLE);
  check(parole <= 60, 'salite: al massimo 60 parole nel primo schermo', String(parole));

  // La scheda della salita: «Pedala» nel primo schermo, numeri dentro i riquadri, legenda, fonti chiuse
  await go('salita', '/salite/selvino-nembro', `!!document.querySelector('[data-testid=climb-stats]')`, 1500);
  await base('salita');
  const ride = await p.evaluate(top('[data-testid=climb-ride]'));
  check(!!ride && ride.top >= 0 && ride.bottom <= (await p.evaluate('innerHeight')), 'salita: «Pedala» nel primo schermo a scrollY=0', JSON.stringify(ride));
  const fuori = await p.evaluate(`[...document.querySelectorAll('[data-testid=climb-stats] > div, [data-testid=climb-stats] dd')].filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent.trim())`);
  check(fuori.length === 0, 'salita: nessun numero esce dal suo riquadro', fuori.join(' | '));
  check(await p.evaluate(`/Tornanti/.test(document.querySelector('[data-testid=climb-legend]')?.textContent ?? '') && !/verdi/.test(document.body.innerText)`), 'salita: la legenda dice cosa sono i punti');
  check(await p.evaluate(`document.querySelector('[data-testid=climb-sources]')?.open === false`), 'salita: «Fonti» chiuso');

  // Sessioni: niente barretta, il gettone del tipo, «Aperta ora · Entra» sulla sessione aperta
  await go('sessioni', '/sessioni', `document.querySelectorAll('[data-testid^=session-kind-]').length >= 6`);
  await base('sessioni');
  await ellissi('sessioni');
  const barrette = await p.evaluate(`[...document.querySelectorAll('[data-testid^=session-]')].filter((li) => /^session-\\d+$/.test(li.dataset.testid)).filter((li) => parseFloat(getComputedStyle(li).borderLeftWidth) > 2 || [...li.children].some((c) => getComputedStyle(c).position === 'absolute' && c.getBoundingClientRect().width <= 8)).length`);
  check(barrette === 0, 'sessioni: nessuna barretta colorata sul lato', String(barrette));
  const aperta = await p.evaluate(`(() => { const li = document.querySelector('[data-testid^=session-][data-phase=aperta], [data-testid^=session-][data-phase=via]'); if (!li) return 'nessuna aperta adesso'; const i = li.dataset.testid.split('-')[1]; const box = document.querySelector('[data-testid=session-open-' + i + ']'); return box && /Aperta ora|In corso/.test(box.textContent) && /Entra/.test(box.textContent) ? 'ok' : 'manca'; })()`);
  check(aperta !== 'manca', 'sessioni: «Aperta ora · Entra» sulla sessione aperta', aperta);
  const orologi = await p.evaluate(`[...document.querySelectorAll('[data-testid^=session-clock-]')].map((e) => e.textContent.trim()).filter((t) => !/^(Fra|Via fra|Partita da|Chiusa da) \\S/.test(t))`);
  check(orologi.length === 0, 'sessioni: ogni conto alla rovescia ha la sua parola', orologi.join(' | '));

  await go('garage', '/garage', `!!document.querySelector('[data-testid=item-m-orobia]')`);
  await base('garage');

  await go('tu', '/tu', `!!document.querySelector('[data-testid=me-achievements]')`);
  await base('tu');
  await ellissi('tu');

  // Traguardi: niente barra di scorrimento, «Quasi tuoi» in cima
  await go('traguardi', '/traguardi', `document.querySelectorAll('[data-testid^=ach-]').length > 30`);
  await base('traguardi');
  await backTo('traguardi', '/tu');
  const gruppi = await p.evaluate(`(() => { const g = document.querySelector('[data-testid=ach-groups]'); return g ? g.scrollWidth - g.clientWidth : -1; })()`);
  check(gruppi === 0, 'traguardi: i filtri stanno tutti nello schermo, senza barra', String(gruppi));
  const quasi = await p.evaluate(`(() => { const n = document.querySelector('[data-testid=ach-near]'); const a = [...document.querySelectorAll('li[data-testid^=ach-]')][0]; return !!n && n.querySelectorAll('li').length === 3 && (!a || n.getBoundingClientRect().top < a.getBoundingClientRect().top); })()`);
  check(quasi, 'traguardi: «Quasi tuoi» (tre) in cima');

  await go('classifiche', '/classifiche', `!!document.querySelector('[data-testid="lb-salita:stelvio-prato"]')`);
  await base('classifiche');
  await ellissi('classifiche');
  await backTo('classifiche', '/tu');
  for (const tab of ['percorsi', 'tratti']) {
    await go(`classifiche-${tab}`, `/classifiche?tab=${tab}`, tab === 'tratti' ? `document.querySelectorAll('[data-testid^="lb-w:"]').length > 10` : `document.querySelectorAll('[data-testid^=lb-]').length > 5`, 1200);
    await base(`classifiche, ${tab}`);
  }
  const doppie = await p.evaluate(`[...document.querySelectorAll('[data-testid^="lb-"] button')].filter((b) => { const s = [...b.querySelectorAll('span span')].map((x) => x.textContent.trim()); return s.length >= 2 && s[1].toLowerCase().startsWith(s[0].toLowerCase()); }).length`);
  check(doppie === 0, 'classifiche: il nome del tratto scritto una volta sola', String(doppie));

  // Allenamenti: il primo entro 450 px; l'editor col grafico in cima e «Blocco 1»
  await go('allenamenti', '/workouts', `document.querySelectorAll('[data-testid=workout-list] > li').length >= 30`);
  await base('allenamenti');
  await backTo('allenamenti', '/tu');
  const primo = await p.evaluate(top('[data-testid=workout-list] > li'));
  check(!!primo && primo.top <= 450, 'allenamenti: il primo allenamento entro 450 px', JSON.stringify(primo));
  const riga = await p.evaluate(`(() => { const g = document.querySelector('[data-testid=workout-filters]'); return g ? new Set([...g.children].map((c) => { const r = c.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 4); })).size : 0; })()`);
  check(riga === 1, 'allenamenti: i filtri in una riga', String(riga));
  await p.click('[data-testid=workout-where-open]');
  await sleep(500);
  if (shot) await p.shot('p1-allenamenti-foglio');
  await base('allenamenti, foglio');
  await p.evaluate(`[...document.querySelectorAll('[data-testid=workout-sheet] button')].find((b) => b.textContent.trim() === 'Fatto')?.click()`);
  await sleep(300);
  await go('editor', '/workouts/edit/new', `!!document.querySelector('[data-testid=workout-editor]')`);
  await base('editor');
  const ed = await p.evaluate(`(() => { const c = document.querySelector('[data-testid=editor-chart]')?.getBoundingClientRect(); const s = document.querySelector('[data-testid=editor-step-0]'); return { chart: c ? Math.round(c.top) : null, step: s ? Math.round(s.getBoundingClientRect().top) : null, label: s ? /Blocco 1/.test(s.textContent) : false }; })()`);
  check(ed.chart != null && (ed.step == null || ed.chart < ed.step), 'editor: il grafico in cima', JSON.stringify(ed));
  check(ed.step == null || ed.label, 'editor: «Blocco 1»', JSON.stringify(ed));

  await go('diario', '/history');
  await base('diario');
  await backTo('diario', '/tu');
  await go('giri', '/giri', `!!document.querySelector('[data-testid=rides-page]')`);
  await base('giri');
  await go('profilo', '/profile', `!!document.querySelector('[data-testid=profile]')`);
  await base('profilo');
  await backTo('profilo', '/tu');
  const reset = await p.evaluate(`(() => { const b = document.querySelector('[data-testid=profile-reset]'); const d = document.querySelector('[data-testid=profile-danger]'); return { visibile: !!b && b.checkVisibility(), chiuso: !!d && !d.open }; })()`);
  check(!reset.visibile && reset.chiuso, 'profilo: «Cancella» solo dentro un blocco chiuso', JSON.stringify(reset));
  await go('carico', '/load');
  await base('carico');

  // Importa gli esempi: diario pieno, dettaglio di un giro e «rifai un giro»
  await go('importa', '/import', `!!document.querySelector('[data-testid=import-page]')`);
  await base('importa');
  await p.clickText('Carica gli esempi');
  check(await p.waitFor(`!!document.querySelector('[data-testid=import-result]')`, 15000), 'importa: gli esempi entrano nel diario');
  await sleep(600);
  await base('importa, risultato');
  await go('diario-pieno', '/history');
  await base('diario con i giri');
  const det = await p.evaluate(`document.querySelector('a[href*="/history/"]')?.getAttribute('href') ?? ''`);
  if (det) {
    const path = det.replace(/^.*?(\/history\/)/, '/history/');
    await go('dettaglio', path, `!!document.querySelector('[data-testid=ride-detail]')`, 1500);
    await base('dettaglio del giro');
    const sovrapposti = await p.evaluate(`(() => { const box = [...document.querySelectorAll('[data-testid^=chart-]')].map((s) => s.getBoundingClientRect()); let n = 0; for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) { const a = box[i], b = box[j]; if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) n++; } const kids = [...document.querySelectorAll('[data-testid^=chart-]')].filter((s) => [...s.children].some((c) => c.getBoundingClientRect().bottom > s.getBoundingClientRect().bottom + 1)).length; return n + kids; })()`);
    check(sovrapposti === 0, 'dettaglio: i grafici e le loro etichette non si sovrappongono', String(sovrapposti));
  }
  const replay = await p.evaluate(`document.querySelector('[data-testid=replay-ride]')?.getAttribute('href') ?? ''`);
  await go('giri-pieno', '/giri', `!!document.querySelector('[data-testid=replay-ride]')`);
  const rp = await p.evaluate(`document.querySelector('[data-testid=replay-ride]')?.getAttribute('href') ?? ''`);
  if (rp || replay) {
    await go('rifai', (rp || replay).replace(/^.*?(\/giri\/)/, '/giri/'), `!!document.querySelector('[data-testid=replay-setup]')`, 1200);
    await base('rifai un giro');
  }
  await go('oggi-con-giri', '/', `!!document.querySelector('[data-testid=home-week]')`);
  await base('oggi con i giri');
}

/** Il telefono in orizzontale (844×390) e il computer (1280×800): la navigazione al posto giusto. */
export async function largo(b, base, check, { shot = null } = {}) {
  const onboard = async (p) => {
    await p.go('/start');
    await p.waitFor(`!!document.querySelector('[data-testid=onboarding]')`, 6000);
    await p.evaluate(`(() => { const i = document.querySelector('[data-testid=onboarding-name]'); if (!i) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Anna'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    for (let s = 0; s < 4; s++) {
      if (await p.evaluate(`!location.pathname.includes('/start')`)) break;
      if (!(await p.click('[data-testid=onboarding-next]'))) await p.click('[data-testid=onboarding-start]');
      await sleep(600);
    }
  };
  const w = await b.phone(base, { width: 844, height: 390 });
  await onboard(w);
  await w.go('/');
  await w.waitFor(`!!document.querySelector('[data-testid=home-session]')`, 8000);
  await sleep(800);
  if (shot) await w.shot('p1-oggi-orizzontale');
  const nav = await w.evaluate(`[...document.querySelectorAll('nav a')].filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0; }).map((a) => { const r = a.getBoundingClientRect(); return { t: a.getAttribute('aria-label') || a.textContent.trim(), ok: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }; }).filter((x) => /Oggi|Mondo|Salite|Sessioni|Garage|Tu/.test(x.t))`);
  check(nav.length >= 6 && nav.every((x) => x.ok), 'orizzontale: tutte le voci di navigazione dentro lo schermo', JSON.stringify(nav.filter((x) => !x.ok)));
  const card = await w.evaluate(top('[data-testid=home-session]'));
  check(!!card && card.top >= 0 && card.bottom <= 390, 'orizzontale: la prima carta di Oggi intera', JSON.stringify(card));
  const a = await w.audit();
  check(a.overflow <= 0, 'orizzontale: niente overflow', String(a.overflow));
  const d = await b.phone(base, { width: 1280, height: 800 });
  await d.s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await onboard(d);
  await d.go('/');
  // sotto carico la prima pittura arriva tardi: si aspetta Oggi, non un tempo fisso
  await d.waitFor(`!!document.querySelector('[data-testid=home-session]')`, 20000);
  await sleep(600);
  if (shot) await d.shot('p1-oggi-computer');
  const side = await d.evaluate(top('[data-testid=side-nav]'));
  check(!!side && side.w >= 200, 'computer: il menu laterale con le voci resta', JSON.stringify(side));
}
