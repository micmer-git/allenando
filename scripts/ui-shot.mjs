// Collaudo visivo delle schermate principali a 390×844: onboarding, Oggi, Mondo, pedalata nel
// mondo (cartina toccabile e pallino sull'altimetria), giro libero.
// Uso: node scripts/ui-shot.mjs <base> <outdir>   (es. http://127.0.0.1:4199/allenando shots)
// ONLY_RIDE=1 salta Oggi e Mondo (per una macchina con poca memoria: il 3D è la parte pesante)
// Esce con 1 se un controllo fallisce o la pagina lancia errori.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { collaudoCorsa, collaudoLargo } from './corsa-checks.mjs';

const [base = 'http://127.0.0.1:4199/allenando', out = 'shots'] = process.argv.slice(2);
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

  // onboarding: il primo schermo, poi i passi fino a «Oggi»
  await p.go('/start');
  check(await p.waitFor(`!!document.querySelector('[data-testid=onboarding]')`), 'onboarding: si apre');
  await sleep(500);
  await p.shot('01-onboarding');
  await auditCheck(p, 'onboarding');
  await p.evaluate(`(() => { const i = document.querySelector('[data-testid=onboarding-name]'); if (!i) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Anna');
    i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  for (let step = 0; step < 4; step++) {
    if (await p.evaluate(`!location.pathname.includes('/start')`)) break;
    if (await p.click('[data-testid=onboarding-next]')) {
      await sleep(500);
      await p.shot(`01-onboarding-${step + 2}`);
      continue;
    }
    await p.click('[data-testid=onboarding-start]');
    await sleep(800);
  }
  check(await p.waitFor(`!location.pathname.includes('/start')`, 6000), 'onboarding: si arriva dentro');

  if (!process.env.ONLY_RIDE) {
  // Oggi
  await p.go('/');
  await sleep(800);
  await p.shot('02-oggi');
  await p.shot('02-oggi-tutta', true);
  await auditCheck(p, 'oggi');

  // Mondo
  await p.go('/mondo');
  check(await p.waitFor(`!!document.querySelector('[data-testid=world-ride-citta-alta]')`, 30000), 'mondo: percorsi caricati');
  await sleep(1500);
  await p.shot('03-mondo');
  await auditCheck(p, 'mondo');
  const tabsRow = await p.evaluate(`(() => { const g = document.querySelector('[data-testid=world-tabs]'); if (!g) return -1; const ys = new Set([...g.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top))); return ys.size; })()`);
  check(tabsRow === 1, 'mondo: le sezioni stanno in una riga', String(tabsRow));
  await p.click('[data-testid=world-ride-citta-alta]');
  await sleep(1500);
  await p.shot('03-mondo-citta-alta');
  }

  // pedalata su Città Alta
  await p.go('/ride?world=bergamo&ride=citta-alta');
  check(await p.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 120000), 'città alta: mondo 3D pronto');
  await p.clickText('10×');
  await sleep(9000);
  await p.shot('04-corsa');
  await auditCheck(p, 'corsa');
  const dot = await p.evaluate(`(() => { const d = document.querySelector('[data-testid=profile-dot]'); if (!d) return null; const r = d.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) }; })()`);
  check(!!dot && dot.w >= 6, 'altimetria: c’è il pallino di dove sei', JSON.stringify(dot));
  const view3d = await p.evaluate(`(() => { const c = document.querySelector('[data-testid=ride-screen] canvas'); return c ? Math.round(c.getBoundingClientRect().height) : 0; })()`);
  check(view3d >= 470, 'corsa: il 3D ha almeno 470 px di altezza su 844', String(view3d));

  // la cartina: un tocco apre la carta grande con la posizione
  check(await p.click('[data-testid=world-mini]'), 'cartina: si tocca');
  const sheet = await p.waitFor(`!!document.querySelector('[data-testid=map-sheet]')`, 5000);
  check(sheet, 'cartina: si apre la carta grande');
  await sleep(1500);
  await p.shot('05-carta');
  if (sheet) {
    await auditCheck(p, 'carta');
    const where = await p.evaluate(`document.querySelector('[data-testid=map-where]')?.textContent ?? ''`);
    check(where.length > 3, 'carta: dice dove sei', where);
    const sheetDot = await p.evaluate(`!!document.querySelector('[data-testid=map-sheet] [data-testid=profile-dot]')`);
    check(sheetDot, 'carta: altimetria con il pallino');
    await p.click('[data-testid=map-close]');
    check(await p.waitFor(`!document.querySelector('[data-testid=map-sheet]')`, 3000), 'carta: si chiude');
  }
  await sleep(3000);
  await p.shot('06-corsa-dopo');

  // giro libero: l'altimetria dei prossimi km col pallino
  await p.go('/ride?world=bergamo&edge=0&s=0&dir=1');
  if (await p.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 60000)) {
    await sleep(4000);
    await p.shot('07-libero');
    check(await p.evaluate(`!!document.querySelector('[data-testid=profile-dot]')`), 'giro libero: pallino sull’altimetria');
  } else check(false, 'giro libero: mondo 3D pronto');

  // pista 2, la corsa: velo prima del mondo, numeri grandi, pausa, «Termina» tenuto, giro salvato da solo,
  // ripresa dopo la scheda chiusa, incrocio a tre frecce, orizzontale e computer. NO_CORSA=1 lo salta.
  if (!process.env.NO_CORSA) {
    // la pedalata di prima si chiude: un'altra scheda viva scriverebbe il suo punto di ripresa sopra quello della prova
    await p.s('Page.navigate', { url: 'about:blank' });
    await sleep(800);
    const tabs = await collaudoCorsa({ b, base, check });
    for (const t of tabs) check(t.errors.length === 0, 'corsa: nessun errore di pagina', t.errors.slice(0, 5).join(' | '));
    await collaudoLargo({ b, base, check });
  }
  check(p.errors.length === 0, 'nessun errore di pagina', p.errors.slice(0, 5).join(' | '));
} catch (err) {
  check(false, 'eccezione nel collaudo', String(err?.stack ?? err));
} finally {
  writeFileSync(join(out, 'report.txt'), report.join('\n') + '\n');
  await b.close();
}
console.log(failures ? `\n${failures} controlli falliti` : '\nTutto verde');
process.exit(failures ? 1 : 0);
