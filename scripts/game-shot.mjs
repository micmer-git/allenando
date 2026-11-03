// Collaudo delle pagine del gioco a 390×844: Oggi (missioni e sessione), Garage (negozio),
// Sessioni, Traguardi, Classifiche, Tu. Niente 3D del mondo: è leggero.
// Uso: node scripts/game-shot.mjs <base> <outdir>   (es. http://127.0.0.1:5183/allenando shots)
// Esce con 1 se un controllo fallisce o la pagina lancia errori.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

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

  if (process.env.RIDE) {
    // corsa: il GPM di Città Alta parte dal metro zero, l'HUD lo cronometra
    await p.go('/ride?world=bergamo&ride=citta-alta');
    check(await p.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 120000), 'corsa: mondo 3D pronto');
    await p.clickText('10×');
    check(await p.waitFor(`!!document.querySelector('[data-testid=segment-live]')`, 20000), 'corsa: il GPM è partito ed è cronometrato');
    await sleep(3000);
    await p.shot('g09-corsa-gpm');
    // sessione: la prossima, in griglia col conto alla rovescia
    const slot = Math.floor(Date.now() / 1800000) + 1;
    await p.go(`/ride?world=bergamo&ride=__RIDE__&session=ev-${slot}`.replace('__RIDE__', await p.evaluate(`(async () => (await import('/allenando/src/game/sessions.ts')).sessionAt(${slot}).rideId)()`)));
    check(await p.waitFor(`!!document.querySelector('[data-testid=session-grid]')`, 120000), 'sessione: griglia col conto alla rovescia');
    await sleep(2500);
    await p.shot('g10-sessione-griglia');
    // fine giro: il riepilogo coi premi
    await p.click('[data-testid=ride-finish]');
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
