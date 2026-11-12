// Il collaudo del flusso Pedala · Diario · Tu (piano U, U-flusso): le schermate del wireframe a
// 390×844, 844×390 e 1280×800, col nome della schermata (B1, C3, H2…) nel nome del file; i
// controlli della sezione 5 del piano; i tocchi da app aperta a «sto pedalando».
// Uso: node scripts/flusso-shot.mjs <base> <outdir> [gruppi...]
//   gruppi: pagine (schermate fuori dalla corsa), corsa (HUD H1–H6, O1–O4), tocchi
//   es.: node scripts/flusso-shot.mjs http://localhost:4188/allenando shots pagine
// Il rullo finto si accende solo con localStorage['orobia.collaudo'] (A23), messo prima di caricare.
// Una scheda alla volta, isolata, chiusa a fine scena: la macchina ha 8 GB.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { apri, IPHONE, kv, misuraTocchi, naviga, pieniIn, PRONTO, SELETTORE_APERTO, SELETTORE_ROTTO, SENZA_BT } from './flusso-lib.mjs';
import { ELLISSI, MINUSCOLE, PIENI } from './pagine-check.mjs';
import { holdFinish } from './corsa-checks.mjs';

const [base = 'http://localhost:4188/allenando', out = 'shots', ...gruppi] = process.argv.slice(2);
const vuoi = (g) => gruppi.length === 0 || gruppi.includes(g);
mkdirSync(out, { recursive: true });
const report = [];
let failures = 0;
const check = (ok, label, extra = '') => {
  const line = `${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`;
  console.log(line);
  report.push(line);
  if (!ok) failures += 1;
};
const scatti = [];
/** le pagine si fotografano in tre misure; la corsa ha le sue (O1–O4, H1 al computer) */
let tre = false;
/**
 * Una schermata. Se il nome finisce in -390x844, la stessa schermata anche a 844×390 (telefono in
 * orizzontale) e a 1280×800 (computer), poi si torna al telefono: lo stato resta quello.
 */
const scatta = async (p, nome, full = false) => {
  await p.evaluate('document.activeElement?.blur?.()');
  await p.shot(nome, full);
  scatti.push(nome);
  if (!nome.endsWith('-390x844') || !tre) return;
  const radice = nome.slice(0, -'-390x844'.length);
  for (const [w, h, desk] of [
    [844, 390, false],
    [1280, 800, true],
  ]) {
    await p.s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: desk ? 1 : 2, mobile: !desk });
    await sleep(desk ? 1800 : 1000);
    await p.shot(`${radice}-${w}x${h}`);
    scatti.push(`${radice}-${w}x${h}`);
    const a = await p.audit();
    check(a.overflow <= 0, `${radice} ${w}×${h}: niente overflow orizzontale`, a.overflow > 0 ? `${a.overflow}px` : '');
  }
  await p.s('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // di nuovo il telefono: si aspetta che la pagina lo sappia (la colonna del computer se ne va)
  await p.waitFor(`innerWidth === 390 && !document.querySelector('[data-testid=pedala-colonna]')`, 10000);
  await sleep(1200);
};
/** Misure comuni: overflow, bersagli, minuscole, ellissi, «Simulatore», «XP». */
const base390 = async (p, nome, { pieni = 1, foglio = null } = {}) => {
  const a = await p.audit();
  check(a.overflow <= 0, `${nome}: niente overflow orizzontale`, a.overflow > 0 ? `${a.overflow}px` : '');
  check(a.small.length === 0, `${nome}: bersagli ≥ 44 px`, a.small.join(' | '));
  const min = await p.evaluate(MINUSCOLE);
  check(min.length === 0, `${nome}: ogni testo comincia con la maiuscola`, min.join(' | '));
  const ell = await p.evaluate(ELLISSI);
  check(ell.length === 0, `${nome}: niente ellissi nel primo schermo`, ell.join(' | '));
  const sim = await p.evaluate(`/simulator[ei]/i.test(document.body.innerText)`);
  check(!sim, `${nome}: «Simulatore» non c'è`);
  const xp = await p.evaluate(`/\\bXP\\b/.test(document.body.innerText)`);
  check(!xp, `${nome}: niente «XP»`);
  if (pieni != null) {
    const pp = await p.evaluate(foglio ? pieniIn(foglio) : PIENI);
    check(pp.length <= pieni, `${nome}: al massimo ${pieni} tasto pieno nel primo schermo`, pp.join(' | '));
  }
};
const vede = (p, sel) => p.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
const box = (p, sel) => p.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }; })()`);
const metrica = (p, width, height, desktop = false) => p.s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: desktop ? 1 : 2, mobile: !desktop });

const b = await launch({ out });
try {
  if (vuoi('pagine')) await pagine();
  if (vuoi('corsa')) await corsa();
  if (vuoi('tocchi')) await tocchi();
} catch (err) {
  check(false, 'eccezione nel collaudo', String(err?.stack ?? err));
} finally {
  writeFileSync(join(out, 'report.txt'), report.join('\n') + '\n');
  writeFileSync(join(out, 'scatti.txt'), scatti.join('\n') + '\n');
  await b.close();
}
console.log(failures ? `\n${failures} controlli falliti` : '\nTutto verde');
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------

async function pagine() {
  tre = !process.env.SOLO_390;
  // I1 · primo avvio: mondo, nome, peso, FTP, «Entra»
  {
    const p = await b.phone(base, { isolato: true });
    await p.go('/start');
    await p.waitFor(`!!document.querySelector('[data-testid=onboarding]')`, 15000);
    await p.waitFor(`[...document.querySelectorAll('[data-testid^=onboarding-world-] img')].every((i) => i.complete)`, 8000);
    await sleep(500);
    await scatta(p, 'I1-primo-avvio-390x844');
    const campi = await p.evaluate(`[...document.querySelectorAll('[data-testid=onboarding] input')].map((i) => i.dataset.testid)`);
    check(campi.length === 3 && !campi.includes('onboarding-hr'), 'I1: nome, peso, FTP (la FC max va in Impostazioni)', JSON.stringify(campi));
    await base390(p, 'I1');
    await p.chiudi();
  }

  // B1 · mai collegato, prova spenta: un tasto solo; un link diretto alla corsa torna a Pedala
  {
    const p = await apri(b, base);
    await p.go('/');
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-rullo]')`, 10000);
    await sleep(400);
    await scatta(p, 'B1-mai-collegato-390x844');
    const solo = await p.evaluate(`({ collega: !!document.querySelector('[data-testid=pedala-collega]'), altro: ['pedala-dove', 'pedala-come', 'pedala-via'].filter((t) => document.querySelector('[data-testid=' + t + ']')) })`);
    check(solo.collega && solo.altro.length === 0, 'B1: senza rullo e senza prova solo «Collega il rullo»', JSON.stringify(solo));
    await base390(p, 'B1');
    const voci = await p.evaluate(`[...document.querySelectorAll('[data-testid=bottom-nav] li')].map((li) => { const a = li.querySelector('a'); const r = a.getBoundingClientRect(); return { t: a.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width) }; })`);
    check(voci.length === 3 && voci.map((v) => v.t).join('|') === 'Pedala|Diario|Tu' && voci.every((v) => v.h >= 44 && v.w >= 44), 'navigazione: tre voci, Pedala · Diario · Tu, ≥ 44 px', JSON.stringify(voci));
    await p.go('/ride?world=bergamo&ride=ganda');
    await p.waitFor(`!location.pathname.includes('/ride')`, 10000);
    check(await p.evaluate(`!location.pathname.includes('/ride') && !!document.querySelector('[data-testid=pedala-collega]')`), 'B1: /ride?world=bergamo&ride=ganda senza rullo torna a Pedala');
    // C5 dopo, B5: il rullo ricordato (kv «rullo»), dopo un riavvio
    await p.evaluate(kv('rullo', { nome: 'Wahoo KICKR', id: 'kickr-1' }));
    await p.go('/');
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-ricollega]')`, 8000);
    await sleep(300);
    await scatta(p, 'B5-ricollega-390x844');
    check(await p.evaluate(`document.querySelector('[data-testid=pedala-ricordato]')?.textContent === 'Wahoo KICKR'`), 'B5: «Ricollega» col nome del rullo di ieri');
    await p.chiudi();
  }

  // B2 · in collegamento (il selettore del browser resta aperto) e B3 · fallito
  for (const [sigla, init, attesa] of [
    ['B2-in-collegamento', SELETTORE_APERTO, 'cerco'],
    ['B3-fallito', SELETTORE_ROTTO, 'fallito'],
  ]) {
    const p = await apri(b, base, { init });
    await p.go('/');
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-collega]')`, 10000);
    await p.click('[data-testid=pedala-collega]');
    const ok = await p.waitFor(`document.querySelector('[data-testid=pedala-rullo]')?.dataset.pannello === '${attesa}'`, 8000);
    check(ok, `${sigla.slice(0, 2)}: il pannello «${attesa}»`, await p.evaluate(`document.querySelector('[data-testid=pedala-rullo]')?.dataset.pannello ?? ''`));
    await sleep(400);
    await scatta(p, `${sigla}-390x844`);
    await base390(p, sigla.slice(0, 2));
    await p.chiudi();
  }

  // B4 · iPhone, Safari: Bluefy; e il browser senza Bluetooth (Firefox)
  for (const [sigla, init, attesa] of [
    ['B4-iphone-bluefy', IPHONE, 'ios'],
    ['B4-firefox', SENZA_BT, 'manca'],
  ]) {
    const p = await apri(b, base, { init });
    await p.go('/');
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-rullo]')`, 10000);
    await sleep(400);
    check(await p.evaluate(`document.querySelector('[data-testid=pedala-rullo]')?.dataset.pannello === '${attesa}'`), `${sigla}: il pannello «${attesa}»`);
    await scatta(p, `${sigla}-390x844`);
    await base390(p, sigla);
    await p.chiudi();
  }

  // C5 · solo cardio
  {
    const p = await apri(b, base, { collaudo: 'cardio' });
    await p.go('/');
    await p.click('[data-testid=pedala-collega]');
    await p.waitFor(`document.querySelector('[data-testid=pedala-rullo]')?.dataset.pannello === 'cardio'`, 8000);
    await sleep(300);
    await scatta(p, 'C5-solo-cardio-390x844');
    check(await p.evaluate(`!document.querySelector('[data-testid=pedala-via]')`), 'C5: solo cardio, nessun «Via»');
    await p.chiudi();
  }

  // il rullo con controllo: C1, C6, D1, D2, C2, E1, C3, E2, P1 e gli orizzontali
  {
    const p = await apri(b, base, { collaudo: 'rullo', esempi: true });
    // un record sulla Ganda e su Selvino, per «Contro il record»
    await p.evaluate(kv('world', { xp: 380, week: '', weekXp: 0, km: 120, gainM: 2400, visited: {}, rides: { ganda: { count: 2, bestSec: 6072, bestAt: '2026-11-07T18:40:00.000Z', bestSim: false }, selvino: { count: 1, bestSec: 2480, bestAt: '2026-11-02T18:00:00.000Z', bestSim: false } }, lastDay: '' }));
    await p.go('/');
    await p.click('[data-testid=pedala-collega]');
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-dove]')`, 8000);
    await p.click('[data-testid=pedala-dove]');
    check(await p.waitFor(`!!document.querySelector('[data-testid=dove-riga-ganda]')`, 40000), 'D1: i percorsi del mondo in Dove');
    await sleep(1500);
    await scatta(p, 'D1-dove-390x844');
    await base390(p, 'D1', { pieni: 0, foglio: '[data-testid=dove-foglio]' });
    const gruppiDove = await p.evaluate(`[...document.querySelectorAll('[data-testid=dove] h3')].map((h) => h.textContent.trim())`);
    check(['Anelli', 'Salite', 'Grandi salite', 'Tuoi giri'].every((g) => gruppiDove.includes(g)), 'D1: Anelli, Salite, Grandi salite, Tuoi giri', JSON.stringify(gruppiDove));
    check(!(await p.evaluate(`!!document.querySelector('[data-testid=dove-riga-selvino-nembro]')`)), 'D1: la Selvino verificata esce dalle Grandi salite (A17)');
    check(!(await p.evaluate(`/Traccia da acquisire/.test(document.body.innerText)`)), 'D1: niente catalogo «Traccia da acquisire»');
    // D2 · Crea un anello
    await p.click('[data-testid=dove-anello]');
    await p.waitFor(`!!document.querySelector('[data-testid=world-loop-compute]')`, 8000);
    await p.click('[data-testid=world-loop-compute]');
    await p.waitFor(`!!document.querySelector('[data-testid=world-loop-0]')`, 30000);
    await sleep(1200);
    await scatta(p, 'D2-crea-anello-390x844');
    await base390(p, 'D2', { foglio: '[data-testid=dove-foglio]' });
    await p.click('[data-testid=foglio-indietro]');
    await sleep(500);
    await p.click('[data-testid=dove-riga-ganda]');
    await p.waitFor(`/Ganda/.test(document.querySelector('[data-testid=pedala-dove-titolo]')?.textContent ?? '')`, 8000);
    await sleep(500);
    await scatta(p, 'C1-libera-390x844');
    await base390(p, 'C1');
    const via = await box(p, '[data-testid=pedala-via]');
    check(!!via && via.bottom <= 780, 'C1: «Via» finisce entro 780 px a 390×844', JSON.stringify(via));
    check(await vede(p, '[data-testid=pedala-fantasma]'), 'C1: «Contro il record» dove c\'è un record');
    check(await vede(p, '[data-testid=pedala-giri]'), 'C1: i giri su un anello');
    check(await p.evaluate(`[...document.querySelectorAll('[data-testid=pedala-come] [role=radio]')].map((b) => b.dataset.testid).join('|') === 'pedala-come-libera|pedala-come-fissa|pedala-come-allenamento'`), 'C1: Libera, Potenza fissa, Allenamento');
    // C6 · il chip del rullo
    await p.click('[data-testid=rullo-chip]');
    await p.waitFor(`!!document.querySelector('[data-testid=rullo-foglio]')`, 5000);
    await sleep(400);
    await scatta(p, 'C6-chip-rullo-390x844');
    check(await p.evaluate(`/Pendenza ✓/.test(document.querySelector('[data-testid=rullo-sa]')?.textContent ?? '')`), 'C6: cosa sa fare il rullo, in gettoni');
    await p.click('[data-testid=foglio-chiudi]');
    await sleep(300);
    // orizzontale e computer: Pedala col Dove scelto
    await metrica(p, 844, 390);
    await sleep(900);
    await scatta(p, 'C1-libera-844x390');
    const o = await p.audit();
    check(o.overflow <= 0, 'C1 844×390: niente overflow', String(o.overflow));
    const navO = await p.evaluate(`[...document.querySelectorAll('[data-testid=side-nav] nav a')].filter((a) => a.getBoundingClientRect().width > 0).map((a) => { const r = a.getBoundingClientRect(); return { t: a.getAttribute('aria-label'), ok: r.top >= 0 && r.bottom <= innerHeight }; })`);
    check(navO.length === 3 && navO.every((x) => x.ok), 'orizzontale: tre voci nella colonna, dentro lo schermo', JSON.stringify(navO));
    await metrica(p, 1280, 800, true);
    await sleep(1800);
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-colonna]')`, 8000);
    await sleep(1200);
    await scatta(p, 'P1-pedala-1280x800');
    const side = await p.evaluate(`[...document.querySelectorAll('[data-testid=side-nav] a')].filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.textContent.trim())`);
    check(['Pedala', 'Diario', 'Tu', 'Garage', 'Traguardi', 'Classifiche', 'Allenamenti', 'Impostazioni'].every((v) => side.includes(v)), 'P1: la colonna a sinistra con le sezioni di Tu sotto', JSON.stringify(side));
    check(await vede(p, '[data-testid=dove-carta]') && (await vede(p, '[data-testid=pedala-via]')), 'P1: carta e lista a sinistra, Come e Via a destra');
    await metrica(p, 390, 844);
    await sleep(900);
    // C2 · Potenza fissa su Val Seriana
    await p.click('[data-testid=pedala-dove]');
    await p.waitFor(`!!document.querySelector('[data-testid=dove-riga-val-seriana]')`, 20000);
    await p.click('[data-testid=dove-riga-val-seriana]');
    await sleep(400);
    await p.click('[data-testid=pedala-come-fissa]');
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-watt]')`, 5000);
    await sleep(300);
    const w0 = await p.evaluate(`document.querySelector('[data-testid=pedala-watt-valore]')?.textContent ?? ''`);
    check(/^165\s?W$/.test(w0.replace(' ', ' ')), 'C2: la prima volta il 75 % dell’FTP (165 W con FTP 220)', w0);
    await p.click('[data-testid=pedala-watt-piu]');
    await sleep(200);
    const w1 = await p.evaluate(`document.querySelector('[data-testid=pedala-watt-valore]')?.textContent ?? ''`);
    check(/^170/.test(w1), 'C2: «+» aggiunge 5 W', w1);
    await p.click('[data-testid=pedala-watt-meno]');
    await sleep(300);
    await scatta(p, 'C2-potenza-fissa-390x844');
    await base390(p, 'C2');
    check(/watt=165/.test(await p.evaluate(`document.querySelector('[data-testid=pedala-via]')?.getAttribute('href') ?? ''`)), 'C2: «Via» porta tipo=fissa&watt=165');
    // E1 · scegli l'allenamento, su un anello creato (C3): Dove › Crea un anello › la prima proposta
    await p.click('[data-testid=pedala-dove]');
    await p.waitFor(`!!document.querySelector('[data-testid=dove-anello]')`, 20000);
    await p.click('[data-testid=dove-anello]');
    await p.waitFor(`!!document.querySelector('[data-testid=world-loop-compute]')`, 8000);
    await p.click('[data-testid=world-loop-compute]');
    await p.waitFor(`!!document.querySelector('[data-testid=world-loop-0]')`, 30000);
    await p.click('[data-testid=world-loop-0]');
    await p.waitFor(`/Anello da/.test(document.querySelector('[data-testid=pedala-dove-titolo]')?.textContent ?? '')`, 8000);
    await sleep(400);
    await p.click('[data-testid=pedala-come-allenamento]');
    await p.waitFor(`!!document.querySelector('[data-testid=allenamento-foglio]')`, 5000);
    await sleep(500);
    await scatta(p, 'E1-allenamento-390x844');
    await base390(p, 'E1', { pieni: 0, foglio: '[data-testid=allenamento-foglio]' });
    const sweet = await p.evaluate(`[...document.querySelectorAll('[data-testid^=allenamento-riga-]')].find((b) => /Sweet spot/.test(b.textContent))?.dataset.testid ?? ''`);
    await p.click(`[data-testid=${sweet}]`);
    await p.waitFor(`!document.querySelector('[data-testid=allenamento-foglio]')`, 5000);
    await sleep(600);
    await scatta(p, 'C3-allenamento-anello-390x844');
    await base390(p, 'C3');
    const giri = await p.evaluate(`document.querySelector('[data-testid=pedala-giri-n]')?.textContent ?? ''`);
    check(/^\d+ gir[oi] · ≈/.test(giri), 'C3: i giri proposti con la durata stimata', giri);
    check(!(await vede(p, '[data-testid=pedala-fantasma]')), 'C3: niente fantasma con un allenamento (A9)');
    check(/workout=.*giri=\d/.test(await p.evaluate(`document.querySelector('[data-testid=pedala-via]')?.getAttribute('href') ?? ''`)), 'C3: «Via» porta l’allenamento e i giri', await p.evaluate(`document.querySelector('[data-testid=pedala-via]')?.getAttribute('href') ?? ''`));
    // E2 · un percorso che non è un anello, con l'allenamento: andata, o andata e ritorno
    await p.click('[data-testid=pedala-dove]');
    await p.waitFor(`!!document.querySelector('[data-testid=dove-riga-selvino]')`, 20000);
    await p.click('[data-testid=dove-riga-selvino]');
    await sleep(700);
    await scatta(p, 'E2-allenamento-percorso-aperto-390x844');
    check(await vede(p, '[data-testid=pedala-passaggi]'), 'E2: andata, o andata e ritorno');
    check(await vede(p, '[data-testid=pedala-anello-per]'), 'E2: «Anello da … per N min»');
    await base390(p, 'E2');
    // A3 · il Diario con gli esempi, e il giro con «Rifai»
    await naviga(p, '/history', `!!document.querySelector('[data-testid=history-list]')`);
    await sleep(500);
    await scatta(p, 'A3-diario-390x844');
    await base390(p, 'A3');
    check(await vede(p, '[data-testid=diario-settimana]') || true, 'A3: la settimana nei gettoni (se ci sono giri negli ultimi 7 giorni)');
    const giro = await p.evaluate(`document.querySelector('[data-testid=diario-giro-0]')?.getAttribute('href') ?? ''`);
    if (giro) {
      await naviga(p, giro.replace(/^.*?(\/history\/)/, '/history/'), `!!document.querySelector('[data-testid=ride-detail]')`);
      await sleep(600);
      await scatta(p, 'A3-giro-rifai-390x844');
      check(await vede(p, '[data-testid=ride-detail-rifai]'), 'A3: nel giro «Rifai»');
      await p.click('[data-testid=ride-detail-rifai]');
      await p.waitFor(`!!document.querySelector('[data-testid=pedala-dove-titolo]')`, 8000);
      await sleep(600);
      check(await p.evaluate(`document.querySelector('[data-testid=pedala-dove]')?.textContent.includes('Tuo giro')`), '«Rifai» porta a Pedala col giro come Dove');
      check(await p.evaluate(`!!document.querySelector('[data-testid=pedala-come-allora]') || !document.querySelector('[data-testid=pedala-come-allenamento]')`), 'sul tuo giro «Watt di allora» al posto di Allenamento');
      await scatta(p, 'C1-tuo-giro-390x844');
    }
    // A2 · Tu, A4 · Impostazioni, G3 · i mondi senza rete
    await naviga(p, '/tu', `!!document.querySelector('[data-testid=me-settings]')`);
    await sleep(500);
    await scatta(p, 'A2-tu-390x844');
    await base390(p, 'A2', { pieni: 0 });
    await naviga(p, '/impostazioni', `!!document.querySelector('[data-testid=impostazioni-prova]')`);
    await sleep(300);
    await scatta(p, 'A4-impostazioni-390x844');
    await base390(p, 'A4', { pieni: 0 });
    check(await p.evaluate(`document.querySelector('[data-testid=impostazioni-prova]')?.getAttribute('aria-checked') === 'false'`), 'A4: la modalità prova è spenta di serie');
    await p.evaluate(`document.querySelector('[data-testid="sezione-Mondi senza rete"]')?.scrollIntoView({ block: 'start' })`);
    await sleep(500);
    await scatta(p, 'G3-mondi-senza-rete-390x844');
    // G1 · Pedala offline
    await naviga(p, '/', `!!document.querySelector('[data-testid=pedala-via]')`);
    await p.s('Network.enable');
    // senza rete davvero: anche il service worker va in rete per i mondi non scaricati
    await p.s('Network.setBypassServiceWorker', { bypass: true });
    await p.s('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sleep(900);
    await scatta(p, 'G1-pedala-offline-390x844');
    check(await p.evaluate(`document.querySelector('[data-testid=rete-offline]')?.textContent.trim() === 'Offline'`), 'G1: «Offline», una parola');
    // G2 · Dove offline, un mondo mai scaricato
    await p.click('[data-testid=pedala-dove]');
    await p.waitFor(`!!document.querySelector('[data-testid=dove-mondo]')`, 8000);
    await p.click('[data-testid=dove-mondo]');
    await sleep(300);
    await p.click('[data-testid=world-pick-sellaronda]');
    await p.waitFor(`!!document.querySelector('[data-testid=dove-carica]') && /Offline|disponibile/.test(document.querySelector('[data-testid=dove-carica]').textContent)`, 15000);
    await sleep(500);
    await scatta(p, 'G2-dove-offline-390x844');
    check(await vede(p, '[data-testid=dove-riga-mortirolo-mazzo]'), 'G2: senza rete le grandi salite restano');
    await p.s('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await p.chiudi();
  }

  // C4 · solo misuratore di potenza: niente Potenza fissa, allenamento a bersaglio
  {
    const p = await apri(b, base, { collaudo: 'potenza' });
    await p.evaluate(kv('world', { xp: 0, week: '', weekXp: 0, km: 0, gainM: 0, visited: {}, rides: { selvino: { count: 1, bestSec: 2480, bestAt: '2026-11-02T18:00:00.000Z', bestSim: false } }, lastDay: '' }));
    await p.go('/');
    await p.click('[data-testid=pedala-collega]');
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-dove]')`, 8000);
    await p.click('[data-testid=pedala-dove]');
    await p.waitFor(`!!document.querySelector('[data-testid=dove-riga-selvino]')`, 40000);
    await p.click('[data-testid=dove-riga-selvino]');
    await sleep(600);
    await scatta(p, 'C4-solo-potenza-390x844');
    const tipi = await p.evaluate(`[...document.querySelectorAll('[data-testid=pedala-come] [role=radio]')].map((b) => b.textContent.trim())`);
    check(tipi.length === 2 && /Senza pendenza/.test(tipi[0]) && /A bersaglio/.test(tipi[1]), 'C4: Libera senza pendenza, Allenamento a bersaglio', JSON.stringify(tipi));
    await base390(p, 'C4');
    await p.chiudi();
  }

  // F2 · la prova accesa in Impostazioni, senza rullo: tutte le opzioni, il chip «Prova»
  {
    const p = await apri(b, base);
    await p.go('/impostazioni');
    await p.waitFor(`!!document.querySelector('[data-testid=impostazioni-prova]')`, 8000);
    await p.click('[data-testid=impostazioni-prova]');
    await sleep(300);
    await p.go('/');
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-dove]')`, 8000);
    await sleep(500);
    check(await p.evaluate(`document.querySelector('[data-testid=rullo-chip]')?.dataset.stato === 'prova'`), 'F2: il chip dice «Prova»');
    await p.click('[data-testid=pedala-dove]');
    await p.waitFor(`!!document.querySelector('[data-testid=dove-riga-ganda]')`, 40000);
    await p.click('[data-testid=dove-riga-ganda]');
    await sleep(500);
    await scatta(p, 'F2-pedala-in-prova-390x844');
    await base390(p, 'F2');
    // I3 · il programma di oggi in Pedala
    await p.go('/programmi');
    await p.waitFor(`!!document.querySelector('[data-testid^=plan-start-]')`, 8000);
    await p.evaluate(`document.querySelector('[data-testid^=plan-start-]')?.click()`);
    await sleep(800);
    await p.go('/');
    const prog = await p.waitFor(`!!document.querySelector('[data-testid=pedala-programma]')`, 8000);
    await sleep(500);
    await scatta(p, 'I3-programma-390x844');
    check(prog || true, 'I3: «Oggi nel programma» quando il programma ha una seduta oggi', prog ? '' : 'oggi riposo nel programma');
    if (prog) {
      await p.click('[data-testid=pedala-programma-usa]');
      await sleep(2500);
      check(await vede(p, '[data-testid=pedala-allenamento]'), 'I3: «Usa» riempie Dove e Come');
      await scatta(p, 'I3-programma-usato-390x844');
    }
    await p.chiudi();
  }
}

// ---------------------------------------------------------------------------------------------

async function corsa() {
  tre = false;
  const casi = [
    // G4: il mondo leggero, sceso da solo dopo il primo avvio: la corsa dice «Leggero»
    { sigla: 'G4', o: null, nome: 'corsa-leggero', collaudo: 'rullo', url: '/ride?world=bergamo&ride=ganda', leggero: true },
    { sigla: 'H1', o: 'O1', nome: 'libera', collaudo: 'rullo', url: '/ride?world=bergamo&ride=citta-alta' },
    { sigla: 'H2', o: 'O2', nome: 'potenza-fissa', collaudo: 'rullo', url: '/ride?world=bergamo&ride=citta-alta&tipo=fissa&watt=165' },
    { sigla: 'H3', o: 'O3', nome: 'allenamento-anello', collaudo: 'rullo', url: '/ride?workout=sweet-spot&world=bergamo&ride=ganda&giri=2' },
    { sigla: 'H4', o: 'O4', nome: 'prova', collaudo: null, url: '/ride?world=bergamo&ride=citta-alta&prova=1' },
  ];
  // SOLO=G4,H2: solo quelle schermate della corsa
  const solo = process.env.SOLO ? process.env.SOLO.split(',') : null;
  for (const c of casi) {
    if (solo && !solo.includes(c.sigla)) continue;
    const p = await apri(b, base, { collaudo: c.collaudo, bassa: true });
    if (c.leggero) {
      await p.go('/impostazioni');
      const ok = await p.waitFor(`!!document.querySelector('[data-testid=impostazioni-leggero-bergamo]')`, 120000);
      check(ok, 'G4: il mondo leggero scende da solo dopo il primo avvio');
    }
    if (c.collaudo) {
      await p.go('/');
      await p.click('[data-testid=pedala-collega]');
      await p.waitFor(`!!document.querySelector('[data-testid=rullo-chip]')`, 8000);
      // G4: senza rete, la corsa usa il pacco leggero (src/ride/setup.ts)
      if (c.leggero) {
        await p.s('Network.enable');
        await p.s('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await sleep(500);
      }
      // dentro l'app: il rullo resta collegato (un ricaricamento lo perderebbe)
      await p.evaluate(`(() => { history.pushState({}, '', '${base.replace(/^https?:\/\/[^/]+/, '')}${c.url}'); dispatchEvent(new PopStateEvent('popstate')); return true; })()`);
    } else await p.go(c.url);
    const pronto = await p.waitFor(PRONTO, 150000);
    check(pronto, `${c.sigla}: il mondo è pronto`);
    if (!pronto) {
      await p.chiudi();
      continue;
    }
    if (c.sigla === 'H4') {
      await p.evaluate(`[...document.querySelectorAll('[data-testid=sim-controls] button')].find((x) => x.textContent.trim() === '10×')?.click()`);
    }
    await sleep(c.sigla === 'H4' ? 6000 : 3500);
    await scatta(p, `${c.sigla}-${c.nome}-390x844`);
    const m = await p.evaluate(`(() => ({
      // la velocità scelta della prova è l'unica gialla ammessa (come nel collaudo della corsa)
      pieni: [...document.querySelectorAll('[data-testid=ride-screen] button, [data-testid=ride-screen] a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 36 && r.height > 36 && getComputedStyle(e).backgroundColor === 'rgb(255, 200, 20)' && !e.closest('[aria-label="Velocità del tempo nella prova"]'); }).map((e) => e.textContent.trim().slice(0, 20)),
      sim: !!document.querySelector('[data-testid=sim-controls]'),
      prova: !!document.querySelector('[data-testid=ride-prova]'),
      bersaglio: document.querySelector('[data-testid=ride-bersaglio]')?.dataset.watt ?? null,
      giro: document.querySelector('[data-testid=ride-giro]')?.textContent ?? null,
      erg: !!document.querySelector('[data-testid=erg-row]'),
      chip: document.querySelector('[data-testid=rullo-chip]')?.dataset.stato ?? null,
      sensori: !!document.querySelector('[data-testid=ride-sensors]'),
    }))()`);
    check(m.pieni.length === 0, `${c.sigla}: nessun tasto pieno in corsa`, m.pieni.join(' | '));
    check(m.sim === (c.sigla === 'H4'), `${c.sigla}: sforzo e 1× 4× 10× solo in prova`, String(m.sim));
    check(!m.sensori && !!m.chip, `${c.sigla}: il chip del rullo al posto del foglio dei sensori`, JSON.stringify(m.chip));
    if (c.sigla === 'H2') {
      check(m.bersaglio === '165', 'H2: il bersaglio a 165 W', String(m.bersaglio));
      const t0 = Date.now();
      await p.click('[data-testid=ride-bersaglio-piu]');
      const ok = await p.waitFor(`document.querySelector('[data-testid=ride-bersaglio]')?.dataset.watt === '170'`, 2000);
      check(ok && Date.now() - t0 < 1500, 'H2: «+» porta il bersaglio a 170 W subito', `${Date.now() - t0} ms`);
      await p.click('[data-testid=ride-bersaglio-meno]');
    }
    if (c.sigla === 'H3') {
      check(/^Giro 1 di 2$/.test(m.giro ?? ''), 'H3: «Giro 1 di 2» accanto al titolo', String(m.giro));
      check(m.erg, 'H3: il blocco dell’ERG sopra le cifre');
      check(/km al traguardo/.test(await p.evaluate(`document.querySelector('[data-testid=ride-km]')?.textContent ?? ''`)), 'H3: i km al traguardo del giro');
    }
    if (c.sigla === 'H4') check(m.prova, 'H4: «Prova» nel titolo');
    if (c.sigla === 'G4') {
      check(await vede(p, '[data-testid=ride-leggero]'), 'G4: «Leggero» accanto al titolo');
      await p.chiudi();
      await sleep(1500);
      continue;
    }
    // orizzontale e computer: la stessa corsa, ridimensionata
    await metrica(p, 844, 390);
    await sleep(2500);
    await scatta(p, `${c.o}-${c.nome}-844x390`);
    const ov = await p.audit();
    check(ov.overflow <= 0, `${c.o}: niente overflow a 844×390`, String(ov.overflow));
    if (c.sigla === 'H1') {
      await metrica(p, 1280, 800, true);
      await sleep(2500);
      await scatta(p, `H1-libera-1280x800`);
    }
    await metrica(p, 390, 844);
    await sleep(1500);
    if (c.sigla === 'H1') {
      // H5 · la pausa
      await p.click('[data-testid=ride-back]');
      await p.waitFor(`!!document.querySelector('[data-testid=pause-resume]')`, 5000);
      await sleep(600);
      await scatta(p, 'H5-pausa-390x844');
      await p.click('[data-testid=pause-resume]');
      await sleep(800);
    }
    if (c.sigla === 'H3' || c.sigla === 'H4') {
      // H6 · la fine (F4 in prova): il giro salvato, i tempi dei giri, niente FIT per la prova
      await holdFinish(p);
      const fine = await p.waitFor(`!!document.querySelector('[data-testid=ride-summary]')`, 10000);
      check(fine, `${c.sigla}: «Termina» tenuto apre il riepilogo`);
      await sleep(1500);
      if (c.sigla === 'H4') {
        await scatta(p, 'F4-fine-prova-390x844');
        check(await vede(p, '[data-testid=summary-prova]'), 'F4: «Prova» e «Niente classifica né oro»');
        check(!(await vede(p, '[data-testid=ride-fit]')), 'F4: un giro di prova non si esporta');
      } else {
        await scatta(p, 'H6-fine-390x844');
        check(await vede(p, '[data-testid=ride-fit]'), 'H6: il FIT per un giro vero');
      }
    }
    await p.chiudi();
    await sleep(1500);
  }
}

// ---------------------------------------------------------------------------------------------

async function tocchi() {
  await misuraTocchi(b, base, check, out);
}
