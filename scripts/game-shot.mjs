// Collaudo delle pagine del gioco a 390×844: Oggi (missioni e sessione), Garage (negozio),
// Sessioni, Traguardi, Classifiche, Tu. Niente 3D del mondo: è leggero.
// Uso: node scripts/game-shot.mjs <base> <outdir>   (es. http://127.0.0.1:5183/allenando shots)
// GIOCO=1 aggiunge il 3D del gioco: carta → percorso, allenamenti col posto, archi in ERG (mondo e
// salita), un allenamento che va oltre il percorso, portali dei km, volata del cassonetto.
// Esce con 1 se un controllo fallisce o la pagina lancia errori.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { holdFinish } from './corsa-checks.mjs';

const [base = 'http://127.0.0.1:5183/allenando', out = 'shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const report = [];
let failures = 0;
const check = (ok, label, extra = '') => {
  const line = `${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`;
  console.log(line);
  report.push(line);
  if (!ok) failures += 1;
};
const auditCheck = async (p, name) => {
  const r = await p.audit();
  check(r.overflow <= 0, `${name}: niente overflow a 390 px`, r.overflow > 0 ? `${r.overflow}px` : '');
  check(r.small.length === 0, `${name}: bersagli ≥ 44 px`, r.small.join(' | '));
};

const b = await launch({ out });
try {
  const p = await b.phone(base);
  await p.go('/start');
  check(await p.waitFor(`!!document.querySelector('[data-testid=onboarding]')`), 'onboarding: si apre');
  await p.evaluate(`(() => { const i = document.querySelector('[data-testid=onboarding-name]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Anna'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await p.shot('g01-onboarding');
  for (let step = 0; step < 4; step++) {
    if (await p.evaluate(`!location.pathname.includes('/start')`)) break;
    if (!(await p.click('[data-testid=onboarding-next]'))) await p.click('[data-testid=onboarding-start]');
    await sleep(700);
  }
  check(await p.waitFor(`!location.pathname.includes('/start')`, 6000), 'onboarding: si entra');

  await p.go('/');
  check(await p.waitFor(`!!document.querySelector('[data-testid=home-missions]')`, 8000), 'oggi: missioni del giorno');
  check(await p.evaluate(`document.querySelectorAll('[data-testid=home-missions] li').length === 3`), 'oggi: tre missioni');
  check(await p.evaluate(`!!document.querySelector('[data-testid=home-session]')`), 'oggi: prossima sessione');
  await sleep(500);
  await p.shot('g02-oggi');
  await p.shot('g02-oggi-tutta', true);
  await auditCheck(p, 'oggi');

  await p.go('/garage');
  check(await p.waitFor(`!!document.querySelector('[data-testid=item-m-orobia]')`, 8000), 'garage: il guardaroba');
  await sleep(800);
  await p.shot('g03-garage');
  await p.shot('g03-garage-tutta', true);
  await auditCheck(p, 'garage');
  check(await p.evaluate(`/Indossato/.test(document.querySelector('[data-testid=item-m-orobia]').textContent)`), 'garage: la maglia gialla è indossata');
  await p.clickText('Caschi');
  await sleep(400);
  check(await p.evaluate(`!!document.querySelector('[data-testid=item-c-oro]')`), 'garage: reparto caschi');
  await p.shot('g03-garage-caschi');
  await p.clickText('Bici');
  await sleep(400);
  await p.shot('g03-garage-bici');

  await p.go('/sessioni');
  check(await p.waitFor(`document.querySelectorAll('[data-testid^=session-]').length >= 6`, 8000), 'sessioni: il calendario');
  await sleep(600);
  await p.shot('g04-sessioni');
  await auditCheck(p, 'sessioni');

  await p.go('/traguardi');
  check(await p.waitFor(`document.querySelectorAll('[data-testid^=ach-]').length > 30`, 8000), 'traguardi: la lista');
  await p.shot('g05-traguardi');
  await auditCheck(p, 'traguardi');

  await p.go('/classifiche');
  check(await p.waitFor(`!!document.querySelector('[data-testid="lb-salita:stelvio-prato"]')`, 8000), 'classifiche: le salite');
  await sleep(1500);
  await p.shot('g06-classifiche');
  await auditCheck(p, 'classifiche');
  await p.go('/classifiche?tab=tratti');
  check(await p.waitFor(`document.querySelectorAll('[data-testid^="lb-w:"]').length > 10`, 60000), 'classifiche: i tratti del mondo');
  await sleep(1500);
  await p.shot('g06-classifiche-tratti');

  await p.go('/tu');
  check(await p.waitFor(`!!document.querySelector('[data-testid=me-achievements]')`, 8000), 'tu: la pagina');
  await p.shot('g07-tu');
  await auditCheck(p, 'tu');

  await p.go('/salite/stelvio-prato');
  check(await p.waitFor(`!!document.querySelector('[data-testid=climb-board]')`, 15000), 'salita: classifica dentro la pagina');
  await sleep(1200);
  await p.shot('g08-salita', true);

  if (process.env.GIOCO) {
    // ---------- il gioco nuovo: carta → percorso, km alla Zwift, cassonetti, archi in ERG, allenamenti ----------
    const basePath = new URL(base).pathname.replace(/\/$/, '');
    // si passa da Oggi e poi alla pedalata senza ricaricare la pagina: il mondo resta in memoria
    const spa = async (path) => {
      await p.evaluate(`(() => { history.pushState({}, '', ${JSON.stringify(basePath + '/')}); dispatchEvent(new PopStateEvent('popstate')); })()`);
      // la pedalata di prima deve essere smontata davvero, prima della prossima
      await p.waitFor(`!document.querySelector('[data-testid=ride-screen]')`, 15000);
      await sleep(300);
      await p.evaluate(`(() => { history.pushState({}, '', ${JSON.stringify(basePath + path)}); dispatchEvent(new PopStateEvent('popstate')); })()`);
      await sleep(600);
    };
    const ergNear = `(() => { const m = /Fra ([0-9]+) m/.exec(document.querySelector('[data-testid=erg-ahead]')?.textContent ?? ''); return !!m && +m[1] <= 38; })()`;
    const ready = (ms = 180000) => p.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, ms);
    const arches = async () =>
      (await p.evaluate(`document.querySelector('[data-testid=ride-arches]')?.dataset.list ?? ''`))
        .split('|')
        .filter(Boolean)
        .map((s) => {
          const [head, d] = s.split('@');
          const [kind, role, ...label] = head.split(':');
          return { kind, role, label: label.join(':'), d: Number(d) };
        });
    // un tocco vero col dito (eventi touch di Chrome), non un click finto
    const tap = async (x, y) => {
      await p.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(60);
      await p.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    // 1. carta → percorso
    await p.go('/mondo');
    check(await p.waitFor(`!!document.querySelector('[data-testid=world-page] canvas')`, 60000), 'carta: la carta dei percorsi');
    await sleep(2500);
    const pt = await p.evaluate(`(() => {
      const c = document.querySelector('[data-testid=world-page] canvas');
      const g = c.getContext('2d');
      const W = c.width, H = c.height;
      const px = g.getImageData(0, 0, W, H).data;
      const r = c.getBoundingClientRect();
      const k = W / r.width;
      const want = [[255, 107, 74], [74, 184, 255], [200, 240, 49], [199, 125, 255]];
      for (let y = Math.round(H * 0.3); y < H - 40; y += 2) for (let x = 40; x < W - 140; x += 2) {
        const i = (y * W + x) * 4;
        for (const [R, G, B] of want) if (Math.abs(px[i] - R) < 10 && Math.abs(px[i + 1] - G) < 10 && Math.abs(px[i + 2] - B) < 10) return { x: r.left + x / k, y: r.top + y / k };
      }
      return null;
    })()`);
    check(!!pt, 'carta: trovata una linea di percorso da toccare');
    if (pt) {
      await tap(pt.x, pt.y);
      check(await p.waitFor(`!!document.querySelector('[data-testid=world-ride-card]')`, 8000), 'carta: il tocco sulla linea apre la scheda del percorso');
      check(await p.evaluate(`/Pedala/.test(document.querySelector('[data-testid=world-ride-start]')?.textContent ?? '')`), 'carta: la scheda ha «Pedala»');
      check(await p.evaluate(`!!document.querySelector('[data-testid^=world-ride-].border-accent')`), 'carta: il percorso scelto è evidenziato anche nella lista');
      await sleep(1800);
      await p.evaluate('scrollTo(0, 0)');
      await sleep(400);
      await p.shot('g12-carta-percorso');
      await auditCheck(p, 'mondo, percorso scelto');
    }

    // 2. allenamenti: filtri, dove pedalare, il link
    await p.go('/workouts');
    check(await p.waitFor(`document.querySelectorAll('[data-testid=workout-list] > li').length >= 30`, 8000), 'allenamenti: la libreria lunga (30+)');
    await p.shot('g13-allenamenti');
    await auditCheck(p, 'allenamenti');
    await p.click('[data-testid=workout-type-soglia]');
    await sleep(300);
    const soglia = await p.evaluate(`[...document.querySelectorAll('[data-testid=workout-list] > li')].map((li) => li.textContent)`);
    check(soglia.length >= 5 && soglia.every((t) => /Soglia/.test(t)), 'allenamenti: il filtro per tipo', `${soglia.length}`);
    await p.clickText('Oltre 75′');
    await sleep(300);
    check(await p.evaluate(`document.querySelectorAll('[data-testid=workout-list] > li').length`) < soglia.length, 'allenamenti: il filtro per durata');
    await p.shot('g13-allenamenti-filtri');
    await p.click('[data-testid=workout-type-tutti]');
    await p.clickText('Tutte');
    await p.clickText('Percorso');
    check(await p.waitFor(`document.querySelectorAll('[data-testid=workout-where-ride] option').length >= 13`, 60000), 'allenamenti: i percorsi del mondo da loadWorld');
    await p.evaluate(`(() => { const s = document.querySelector('[data-testid=workout-where-ride]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'citta-alta'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(300);
    const href = await p.evaluate(`document.querySelector('[data-testid=workout-risveglio]')?.getAttribute('href') ?? ''`);
    check(/workout=risveglio/.test(href) && /world=bergamo/.test(href) && /ride=citta-alta/.test(href), 'allenamenti: il link mette insieme allenamento e percorso', href);
    await p.shot('g13-allenamenti-dove');
    await auditCheck(p, 'allenamenti, dove');
    await p.clickText('Libero');
    await sleep(500);
    check(/edge=\d+/.test(await p.evaluate(`document.querySelector('[data-testid=workout-risveglio]')?.getAttribute('href') ?? ''`)), 'allenamenti: il giro libero da un paese');
    await p.clickText('Percorso');
    await sleep(300);

    // 3. allenamento nel mondo: l'arco dell'ERG davanti, col bersaglio
    await p.click('[data-testid=workout-risveglio]');
    check(await ready(), 'erg nel mondo: pronto');
    check(await p.waitFor(`!!document.querySelector('[data-testid=erg-target]')`, 10000), 'erg nel mondo: il bersaglio ERG');
    check(await p.waitFor(`(document.querySelector('[data-testid=ride-arches]')?.dataset.list ?? '').includes('erg:start')`, 30000), 'erg nel mondo: l’arco d’inizio intervallo');
    // a 4× fino a quando l'arco è a una settantina di metri: lì si vede bene
    await p.clickText('4×');
    check(await p.waitFor(ergNear, 120000), 'erg nel mondo: l’HUD conta i metri all’arco');
    await p.clickText('1×');
    await sleep(1500);
    await p.shot('g14-erg-mondo');

    // 4. un allenamento più lungo del percorso: si prosegue libero
    await spa('/ride?world=bergamo&ride=citta-alta&workout=endurance&at=4800');
    check(await ready(), 'oltre il percorso: pronto');
    await p.clickText('10×');
    await sleep(9000);
    check(await p.evaluate(`!document.querySelector('[data-testid=ride-summary]')`), 'oltre il percorso: il giro non si ferma');
    check(await p.evaluate(`/km fatti/.test(document.querySelector('[data-testid=ride-km]')?.textContent ?? '')`), 'oltre il percorso: si prosegue libero (km fatti)');
    await p.shot('g15-prosegue-libero');

    // 5. archi in ERG sulla salita, e i km alla Zwift
    await spa('/ride?route=selvino-nembro&workout=risveglio');
    check(await ready(60000), 'salita: pronta');
    check(await p.waitFor(`(document.querySelector('[data-testid=ride-arches]')?.dataset.list ?? '').includes('erg:start')`, 30000), 'erg in salita: l’arco d’inizio intervallo');
    await p.clickText('4×');
    await p.waitFor(ergNear, 120000);
    await p.clickText('1×');
    await sleep(1500);
    await p.shot('g16-erg-salita');
    const climb = await arches();
    // il «3 km» coincide con il via della crono degli ultimi 3 km: lì c'è l'arco della crono
    const km3 = climb.find((a) => a.kind === 'km' && a.label === '4 km');
    const last = climb.find((a) => a.kind === 'ultimo');
    check(climb.filter((a) => a.role === 'km').length >= 8 && !!km3 && !!last, 'km in salita: un portale a ogni km e l’ultimo km', `${climb.filter((a) => a.role === 'km').length}`);
    if (km3) {
      await spa(`/ride?route=selvino-nembro&at=${km3.d - 32}`);
      await ready(60000);
      await sleep(5000);
      await p.shot('g17-km-salita');
    }
    if (last) {
      await spa(`/ride?route=selvino-nembro&at=${last.d - 32}`);
      await ready(60000);
      await sleep(5000);
      await p.shot('g17-ultimo-km');
    }

    // 6. volata del cassonetto in Val Seriana, e i km ogni 5 km
    await spa('/ride?world=bergamo&ride=val-seriana');
    check(await ready(), 'val seriana: pronta');
    const vs = await arches();
    const cs = vs.find((a) => a.kind === 'cassonetto' && a.role === 'start');
    const cf = vs.find((a) => a.kind === 'cassonetto' && a.role === 'finish');
    check(!!cs && !!cf, 'cassonetto: via e arrivo sul percorso', vs.filter((a) => a.kind === 'cassonetto').map((a) => `${a.role}@${a.d}`).join(' '));
    check(vs.some((a) => a.kind === 'km' && a.label === '5 km') && vs.some((a) => a.kind === 'ultimo'), 'km in valle: ogni 5 km e l’ultimo km');
    if (cs && cf) {
      await spa(`/ride?world=bergamo&ride=val-seriana&at=${cs.d - 45}`);
      await ready();
      check(await p.waitFor(`/Volata del cassonetto/.test(document.querySelector('[data-testid=segment-ahead]')?.textContent ?? '')`, 20000), 'cassonetto: l’HUD lo annuncia');
      await sleep(5000);
      await p.shot('g18-cassonetto-via');
      await p.clickText('10×');
      check(await p.waitFor(`!!document.querySelector('[data-testid=segment-live]')`, 60000), 'cassonetto: cronometrata');
      check(await p.waitFor(`/cassonetto/i.test(document.querySelector('[data-testid=segment-banner]')?.textContent ?? '')`, 120000), 'cassonetto: tempo al traguardo');
      await p.shot('g18-cassonetto-tempo');
      await spa(`/ride?world=bergamo&ride=val-seriana&at=${cf.d - 28}`);
      await ready();
      await sleep(5000);
      await p.shot('g18-cassonetto-bidoni');
    }
    const ul = vs.find((a) => a.kind === 'ultimo');
    if (ul) {
      await spa(`/ride?world=bergamo&ride=val-seriana&at=${ul.d - 40}`);
      await ready();
      await sleep(5000);
      await p.shot('g19-ultimo-km-valle');
    }
  }

  if (process.env.RIDE) {
    // corsa: il GPM di Città Alta parte dal metro zero, l'HUD lo cronometra
    await p.go('/ride?world=bergamo&ride=citta-alta');
    check(await p.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 120000), 'corsa: mondo 3D pronto');
    await p.clickText('10×');
    check(await p.waitFor(`!!document.querySelector('[data-testid=segment-live]')`, 20000), 'corsa: il GPM è partito ed è cronometrato');
    await sleep(3000);
    await p.shot('g09-corsa-gpm');
    // sessione: la prossima, in griglia col conto alla rovescia
    // il link della sessione dopo quella in corso: la pagina Sessioni lo scrive sulla carta
    await p.go('/sessioni');
    await p.waitFor(`!!document.querySelector('[data-testid=session-1]')`, 8000);
    const href = await p.evaluate(`document.querySelector('[data-testid=session-1]').dataset.href`);
    await p.go(href);
    check(await p.waitFor(`!!document.querySelector('[data-testid=session-grid]')`, 120000), 'sessione: griglia col conto alla rovescia');
    await sleep(2500);
    await p.shot('g10-sessione-griglia');
    // fine giro: il riepilogo coi premi
    // «Termina» si tiene premuto (pista 2): col dito, 1,1 s
    await holdFinish(p);
    check(await p.waitFor(`!!document.querySelector('[data-testid=rewards]')`, 15000), 'fine: riepilogo con oro e traguardi');
    await sleep(800);
    await p.shot('g11-premi', true);
  }

  check(p.errors.length === 0, 'nessun errore di pagina', p.errors.slice(0, 5).join(' | '));
} catch (err) {
  check(false, 'eccezione nel collaudo', String(err?.stack ?? err));
} finally {
  writeFileSync(join(out, 'report-game.txt'), report.join('\n') + '\n');
  await b.close();
}
console.log(failures ? `\n${failures} controlli falliti` : '\nTutto verde');
process.exit(failures ? 1 : 0);
