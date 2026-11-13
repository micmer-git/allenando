// I controlli delle pagine fuori dalla corsa, condivisi da ui-shot.mjs e game-shot.mjs.
// Minuscole a inizio testo, bersagli sotto 44 px, ellissi nel primo schermo, la parola «XP»,
// «Simulatore» mai a schermo, e i «fatto» dei piani (pista 1, piano U) pagina per pagina.
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

/**
 * Un'unità (m, km, %, W…) che comincia una riga, separata dal suo numero sulla riga sopra; con
 * `punto` anche un «·» appeso a fine riga col resto della frase sotto (la pillola del passo, F.4).
 */
const aCapo = (punto) => `(() => {
  const punto = ${punto ? 'true' : 'false'};
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
    // un «·» appeso a fine riga, con il resto della frase sotto
    if (punto && stesso && /·$/.test(a.t) && b.top > a.top && b.left < a.left) out.push(a.t + ' ⏎ ' + b.t);
  }
  return out.slice(0, 20);
})()`;
export const UNITA_A_CAPO = aCapo(false);
export const PUNTO_A_CAPO = aCapo(true);

/** Quote scritte senza il separatore delle migliaia («1288 m»): si scrive «1.288 m» (F.13). */
export const QUOTE_NUDE = `(() => {
  const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) {
    const el = n.parentElement; if (!el || !el.getClientRects().length) continue;
    const t = n.textContent + ' ' + (n.nextSibling?.textContent ?? '');
    const re = /(^|[^\\d.,])(\\d{4,})[\\s\\u00a0]?m\\b/g; let m;
    while ((m = re.exec(t))) out.add(m[2] + ' m');
  }
  return [...out].slice(0, 20);
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

/** Le minuscole su qualche pagina. */
export async function minuscoleSu(p, check, paths) {
  for (const path of paths) {
    await p.go(path);
    await p.waitFor(`!!document.body && !!document.querySelector('main')`, 30000);
    await sleep(900);
    const min = await p.evaluate(MINUSCOLE);
    check(min.length === 0, `${path}: niente testi in minuscolo`, min.join(' | '));
  }
}

/** Un giro di tutte le pagine a 390×844: minuscole, bersagli, overflow, «XP», «Simulatore», e i «fatto» dei piani. */
export async function giroPagine(p, check, { shot = null } = {}) {
  const base = async (name) => {
    const min = await p.evaluate(MINUSCOLE);
    check(min.length === 0, `${name}: niente testi in minuscolo`, min.join(' | '));
    const a = await p.audit();
    check(a.overflow <= 0, `${name}: niente overflow`, a.overflow > 0 ? `${a.overflow}px` : '');
    check(a.small.length === 0, `${name}: bersagli ≥ 44 px`, a.small.join(' | '));
    const xp = await p.evaluate(`/\\bXP\\b/.test(document.body.innerText)`);
    check(!xp, `${name}: nessun «XP» a schermo`);
    // piano U, A11: la prova non si chiama «Simulatore» e non va in classifica, nessun interruttore Rullo/Simulatore
    const sim = await p.evaluate(`/simulator[ei]/i.test(document.body.innerText)`);
    check(!sim, `${name}: «Simulatore» non c'è`);
    const capo = await p.evaluate(UNITA_A_CAPO);
    check(capo.length === 0, `${name}: nessuna unità a capo da sola`, capo.join(' | '));
    const v = await p.evaluate(`document.body.innerText.includes('\\u2304')`);
    check(!v, `${name}: nessuna «⌄» di testo come freccia`);
    const nude = await p.evaluate(QUOTE_NUDE);
    check(nude.length === 0, `${name}: le quote col separatore delle migliaia`, nude.join(' | '));
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

  // Navigazione: tre voci, Pedala · Diario · Tu (piano U, A1)
  await go('pedala', '/', `!!document.querySelector('[data-testid=pedala]')`);
  const voci = await p.evaluate(`[...document.querySelectorAll('[data-testid=bottom-nav] li a')].map((a) => { const r = a.getBoundingClientRect(); return { t: a.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width) }; })`);
  check(voci.length === 3 && voci.map((x) => x.t).join('|') === 'Pedala|Diario|Tu' && voci.every((x) => x.h >= 44 && x.w >= 44), 'barra: tre voci, bersagli ≥ 44 px', JSON.stringify(voci));

  // Pedala senza rullo e senza prova: solo «Collega il rullo» (A4); il link diretto a una corsa torna qui
  await base('pedala, senza rullo');
  await ellissi('pedala, senza rullo');
  const solo = await p.evaluate(`({ mappa: !!document.querySelector('[data-testid=dove]'), collega: !!document.querySelector('[data-testid=pedala-collega]'), altro: ['pedala-come', 'pedala-via'].filter((t) => document.querySelector('[data-testid=' + t + ']')) })`);
  check(solo.mappa && solo.collega && solo.altro.length === 0, 'pedala: senza rullo si esplorano i percorsi, Via resta indisponibile', JSON.stringify(solo));
  const pieni = await p.evaluate(PIENI);
  check(pieni.length <= 1, 'pedala: un solo tasto pieno nel primo schermo', pieni.join(' | '));
  await go('ride-senza-rullo', '/ride?world=bergamo&ride=ganda', `!location.pathname.includes('/ride')`, 600);
  check(await p.evaluate(`!location.pathname.includes('/ride') && !!document.querySelector('[data-testid=pedala-collega]')`), 'corsa: /ride?world=bergamo&ride=ganda senza rullo torna a Pedala');

  // Le rotte vecchie arrivano dove la cosa sta adesso (§ 2.6), nessuna pagina bianca
  for (const [from, sel] of [
    ['/mondo', '[data-testid=pedala]'],
    ['/salite', '[data-testid=pedala]'],
    ['/giri', '[data-testid=diario]'],
    ['/profile', '[data-testid=impostazioni]'],
  ]) {
    await go(`rotta${from.replace(/\//g, '-')}`, from, `!!document.querySelector('${sel}')`, 500);
    check(await p.evaluate(`!!document.querySelector('${sel}')`), `rotta vecchia ${from}: si apre la pagina nuova`);
  }

  // La scheda della salita: «Pedala» nel primo schermo, numeri dentro i riquadri, legenda, fonti chiuse
  await go('salita', '/salite/selvino-nembro', `!!document.querySelector('[data-testid=climb-stats]')`, 1500);
  await base('salita');
  const ride = await p.evaluate(top('[data-testid=climb-ride]'));
  check(!!ride && ride.top >= 0 && ride.bottom <= (await p.evaluate('innerHeight')), 'salita: «Pedala» nel primo schermo a scrollY=0', JSON.stringify(ride));
  const fuori = await p.evaluate(`[...document.querySelectorAll('[data-testid=climb-stats] > div, [data-testid=climb-stats] dd')].filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent.trim())`);
  check(fuori.length === 0, 'salita: nessun numero esce dal suo riquadro', fuori.join(' | '));
  check(await p.evaluate(`/Tornanti/.test(document.querySelector('[data-testid=climb-legend]')?.textContent ?? '') && !/verdi/.test(document.body.innerText)`), 'salita: la legenda dice cosa sono i punti');
  check(await p.evaluate(`document.querySelector('[data-testid=climb-sources]')?.open === false`), 'salita: «Fonti» chiuso');
  check(!(await p.evaluate(`/In ERG/.test(document.body.innerText)`)), 'salita: niente «In ERG» (il come si sceglie in Pedala)');

  // Sessioni: niente barretta, il gettone del tipo, «Aperta ora · Entra» sulla sessione aperta
  await go('sessioni', '/sessioni', `document.querySelectorAll('[data-testid^=session-kind-]').length >= 6`);
  await base('sessioni');
  await ellissi('sessioni');
  const barrette = await p.evaluate(`[...document.querySelectorAll('[data-testid^=session-]')].filter((li) => /^session-\\d+$/.test(li.dataset.testid)).filter((li) => parseFloat(getComputedStyle(li).borderLeftWidth) > 2 || [...li.children].some((c) => getComputedStyle(c).position === 'absolute' && c.getBoundingClientRect().width <= 8)).length`);
  check(barrette === 0, 'sessioni: nessuna barretta colorata sul lato', String(barrette));
  const orologi = await p.evaluate(`[...document.querySelectorAll('[data-testid^=session-clock-]')].map((e) => e.textContent.trim()).filter((t) => !/^(Fra|Via fra|Partita da|Chiusa da) \\S/.test(t))`);
  check(orologi.length === 0, 'sessioni: ogni conto alla rovescia ha la sua parola', orologi.join(' | '));

  await go('garage', '/garage', `!!document.querySelector('[data-testid=item-m-orobia]')`);
  await base('garage');
  await backTo('garage', '/tu');

  // Tu a righe (A2): il livello e l'oro solo qui
  await go('tu', '/tu', `!!document.querySelector('[data-testid=me-settings]')`);
  await base('tu');
  await ellissi('tu');
  const righeTu = await p.evaluate(`[...document.querySelectorAll('[data-testid=me] nav a')].map((a) => a.getAttribute('href').replace(/^.*?(\\/[a-z]+)$/, '$1'))`);
  check(['/garage', '/traguardi', '/classifiche', '/workouts', '/impostazioni'].every((r) => righeTu.includes(r)), 'tu: Garage, Traguardi, Classifiche, Allenamenti, Impostazioni', JSON.stringify(righeTu));

  // Traguardi: niente barra di scorrimento, «Quasi tuoi» in cima
  await go('traguardi', '/traguardi', `document.querySelectorAll('[data-testid^=ach-]').length > 30`);
  await base('traguardi');
  await backTo('traguardi', '/tu');
  const gruppi = await p.evaluate(`(() => { const g = document.querySelector('[data-testid=ach-groups]'); return g ? g.scrollWidth - g.clientWidth : -1; })()`);
  check(gruppi === 0, 'traguardi: i filtri stanno tutti nello schermo, senza barra', String(gruppi));

  await go('classifiche', '/classifiche', `!!document.querySelector('[data-testid="lb-salita:stelvio-prato"]')`);
  await base('classifiche');
  await ellissi('classifiche');
  await backTo('classifiche', '/tu');

  // Allenamenti: niente «Inizia» né «Dove e quanto»; Duplica, Esporta, Nuovo, Importa .zwo, Programmi restano
  await go('allenamenti', '/workouts', `document.querySelectorAll('[data-testid=workout-list] > li').length >= 30`);
  await base('allenamenti');
  await backTo('allenamenti', '/tu');
  check(!(await p.evaluate(`/\\bInizia\\b|Dove e quanto/.test(document.body.innerText)`)), 'allenamenti: niente «Inizia» né «Dove e quanto»');
  check(await p.evaluate(`!!document.querySelector('[data-testid=workout-new]') && !!document.querySelector('[data-testid=zwo-import]') && !!document.querySelector('[data-testid=workouts-plans]')`), 'allenamenti: Nuovo, Importa .zwo, Programmi');
  await go('editor', '/workouts/edit/new', `!!document.querySelector('[data-testid=workout-editor]')`);
  await base('editor');

  // Impostazioni (A20): la modalità prova vive qui, spenta di serie
  await go('impostazioni', '/impostazioni', `!!document.querySelector('[data-testid=impostazioni-prova]')`);
  await base('impostazioni');
  await backTo('impostazioni', '/tu');
  check(await p.evaluate(`document.querySelector('[data-testid=impostazioni-prova]')?.getAttribute('aria-checked') === 'false'`), 'impostazioni: la modalità prova spenta di serie');
  const reset = await p.evaluate(`(() => { const b = document.querySelector('[data-testid=profile-reset]'); const d = document.querySelector('[data-testid=profile-danger]'); return { visibile: !!b && b.checkVisibility(), chiuso: !!d && !d.open }; })()`);
  check(!reset.visibile && reset.chiuso, 'impostazioni: «Cancella» solo dentro un blocco chiuso', JSON.stringify(reset));

  // Diario (A3): una voce della barra, Importa in testa
  await go('diario', '/history', `!!document.querySelector('[data-testid=diario]')`);
  await base('diario');
  check(await p.evaluate(`!!document.querySelector('[data-testid=diario-importa]')`), 'diario: «Importa» in testa');
  await go('carico', '/load');
  await base('carico');
  await backTo('carico', '/history');

  // Importa gli esempi: diario pieno, dettaglio di un giro con «Rifai»
  await go('importa', '/import', `!!document.querySelector('[data-testid=import-page]')`);
  await base('importa');
  await p.clickText('Carica gli esempi');
  check(await p.waitFor(`!!document.querySelector('[data-testid=import-result]')`, 15000), 'importa: gli esempi entrano nel diario');
  await sleep(600);
  await go('diario-pieno', '/history', `!!document.querySelector('[data-testid=history-list]')`);
  await base('diario con i giri');
  await ellissi('diario con i giri');
  const filtro = await p.evaluate(`!!document.querySelector('[data-testid=history-worlds]')`);
  const mondiDiario = await p.evaluate(`new Set([...document.querySelectorAll('[data-testid^=history-world-]')].map((e) => e.textContent.trim())).size`);
  check(filtro === mondiDiario >= 1, 'diario: il filtro per mondo compare solo se ci sono giri di un mondo e altri fuori', `filtro ${filtro}, mondi ${mondiDiario}`);
  const det = await p.evaluate(`document.querySelector('a[href*="/history/"]')?.getAttribute('href') ?? ''`);
  if (det) {
    const path = det.replace(/^.*?(\/history\/)/, '/history/');
    await go('dettaglio', path, `!!document.querySelector('[data-testid=ride-detail]')`, 1500);
    await base('dettaglio del giro');
    check(await p.evaluate(`!!document.querySelector('[data-testid=ride-detail-rifai]')`), 'dettaglio: «Rifai» nel giro');
    const sovrapposti = await p.evaluate(`(() => { const box = [...document.querySelectorAll('[data-testid^=chart-]')].map((s) => s.getBoundingClientRect()); let n = 0; for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) { const a = box[i], b = box[j]; if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) n++; } const kids = [...document.querySelectorAll('[data-testid^=chart-]')].filter((s) => [...s.children].some((c) => c.getBoundingClientRect().bottom > s.getBoundingClientRect().bottom + 1)).length; return n + kids; })()`);
    check(sovrapposti === 0, 'dettaglio: i grafici e le loro etichette non si sovrappongono', String(sovrapposti));
  }
}

/** La pillola del prossimo passo nella corsa (F.4, R2): il nome sulla prima riga, «fra 3,2 km · +259 m» sulla seconda, mai spezzate. */
export async function pillolaPasso(p, check, { shot = null } = {}) {
  await p.go('/ride?world=bergamo&ride=ganda&at=16100');
  check(await p.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 120000), 'passo: il mondo 3D pronto sulla Ganda, a 3 km dal passo');
  check(await p.waitFor(`!!document.querySelector('[data-testid=ride-next-pass]')`, 20000), 'passo: la pillola del Passo di Ganda');
  await sleep(800);
  const pill = await p.evaluate(`(() => {
    const e = document.querySelector('[data-testid=ride-next-pass]'); if (!e) return null;
    const linee = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.bottom / 4))).size; };
    const box = e.getBoundingClientRect();
    return { linee: linee(e), h: Math.round(box.height), righe: [...e.children].map((c) => ({ testo: c.textContent.trim(), linee: linee(c), fuori: c.scrollWidth > c.clientWidth + 1 || c.getBoundingClientRect().right > box.right + 1 })) };
  })()`);
  check(!!pill && pill.righe.length === 2 && pill.linee === 2, 'passo: la pillola su due righe per disegno', JSON.stringify(pill));
  check(!!pill && /^▲ Passo di Ganda$/.test(pill.righe[0]?.testo ?? '') && /^fra\s\d+(,\d)?\s(km|m)(\s·\s\+\d+\sm)?$/.test(pill.righe[1]?.testo ?? ''), 'passo: il nome sopra, «fra … · +… m» sotto', JSON.stringify(pill?.righe));
  check(!!pill && pill.righe.every((r) => r.linee === 1 && !r.fuori), 'passo: nessuna riga spezzata o fuori dalla pillola', JSON.stringify(pill?.righe));
  const capo = await p.evaluate(PUNTO_A_CAPO);
  check(capo.length === 0, 'passo: nessuna unità o «·» a capo', capo.join(' | '));
  if (shot) await p.shot('p1-corsa-passo');
}

/** L'onboarding della pista F: la scelta del mondo con due carte, una riga sola per il tasto pieno. */
export async function onboardingMondi(p, check) {
  await p.go('/start');
  await p.waitFor(`!!document.querySelector('[data-testid=onboarding]')`, 15000);
  await p.waitFor(`[...document.querySelectorAll('[data-testid^=onboarding-world-] img')].every((i) => i.complete)`, 8000);
  await sleep(500);
  const carte = await p.evaluate(`[...document.querySelectorAll('[data-testid^=onboarding-world-]')].map((b) => ({ id: b.dataset.testid, h: Math.round(b.getBoundingClientRect().height), checked: b.getAttribute('aria-checked'), stato: b.dataset.state, img: b.querySelector('img')?.naturalWidth ?? 0 }))`);
  check(carte.length === 2 && carte.every((c) => c.h >= 44) && carte.filter((c) => c.checked === 'true').length === 1, 'onboarding: due carte dei mondi, una scelta', JSON.stringify(carte));
  check(carte.some((c) => c.id === 'onboarding-world-bergamo' && c.img > 0), 'onboarding: la carta di Bergamo ha la schermata vera del 3D', JSON.stringify(carte));
  check(carte.every((c) => c.stato !== 'presto' || c.checked !== 'true'), 'onboarding: un mondo non ancora costruito («Presto») non è la scelta', JSON.stringify(carte));
  const pieni = await p.evaluate(PIENI);
  check(pieni.length <= 1, 'onboarding: un solo tasto pieno', pieni.join(' | '));
  const min = await p.evaluate(MINUSCOLE);
  check(min.length === 0, 'onboarding: niente testi in minuscolo', min.join(' | '));
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
  await w.waitFor(`!!document.querySelector('[data-testid=pedala]')`, 8000);
  await sleep(800);
  if (shot) await w.shot('p1-pedala-orizzontale');
  const nav = await w.evaluate(`[...document.querySelectorAll('nav a')].filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0; }).map((a) => { const r = a.getBoundingClientRect(); return { t: a.getAttribute('aria-label') || a.textContent.trim(), ok: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }; }).filter((x) => /Pedala|Diario|Tu/.test(x.t))`);
  check(nav.length === 3 && nav.every((x) => x.ok), 'orizzontale: le tre voci di navigazione dentro lo schermo', JSON.stringify(nav));
  const card = await w.evaluate(top('[data-testid=pedala-collega]'));
  check(!!card && card.top >= 0 && card.bottom <= 390, 'orizzontale: «Collega il rullo» nel primo schermo', JSON.stringify(card));
  const a = await w.audit();
  check(a.overflow <= 0, 'orizzontale: niente overflow', String(a.overflow));
  const d = await b.phone(base, { width: 1280, height: 800 });
  await d.s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await onboard(d);
  await d.go('/');
  // sotto carico la prima pittura arriva tardi: si aspetta Pedala, non un tempo fisso
  await d.waitFor(`!!document.querySelector('[data-testid=pedala]')`, 20000);
  await sleep(600);
  if (shot) await d.shot('p1-pedala-computer');
  const side = await d.evaluate(top('[data-testid=side-nav]'));
  check(!!side && side.w >= 200, 'computer: il menu laterale con le voci resta', JSON.stringify(side));
}
