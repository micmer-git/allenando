// Il collaudo del flusso Pedala · Diario · Tu (piano U, U-flusso): le schermate del wireframe a
// 390×844, 844×390 e 1280×800, col nome della schermata (B1, C3, H2…) nel nome del file.
// Uso: node scripts/flusso-shot.mjs <base> <outdir> [sigle...]   (es. http://localhost:4188/allenando shots B1 C1)
// Il rullo finto si accende solo con localStorage['orobia.collaudo'] (A23), messo prima di caricare.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const [base = 'http://localhost:4188/allenando', out = 'shots', ...sole] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const report = [];
let failures = 0;
const check = (ok, label, extra = '') => {
  const line = `${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`;
  console.log(line);
  report.push(line);
  if (!ok) failures += 1;
};
const vuoi = (sigla) => sole.length === 0 || sole.includes(sigla);

/** Un telefono nuovo, col profilo fatto e (se detto) il rullo finto e la prova. */
export async function prepara(b, { width = 390, height = 844, collaudo = null, prova = false, desktop = false, init = '' } = {}) {
  const p = await b.phone(base, { width, height });
  if (desktop) await p.s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (init) await p.s('Page.addScriptToEvaluateOnNewDocument', { source: init });
  await p.go('/start');
  await p.evaluate(`(() => { ${collaudo ? `localStorage.setItem('orobia.collaudo', '${collaudo}');` : `localStorage.removeItem('orobia.collaudo');`} localStorage.setItem('allenando.install.dismissed', '1'); return true; })()`);
  await p.go('/start');
  await p.waitFor(`!!document.querySelector('[data-testid=onboarding]')`, 15000);
  await p.evaluate(`(() => { const i = document.querySelector('[data-testid=onboarding-name]'); if (!i) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Anna'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await p.click('[data-testid=onboarding-start]');
  await p.waitFor(`!location.pathname.includes('/start')`, 8000);
  if (prova) {
    await p.go('/?prova=1');
    await sleep(300);
  }
  return p;
}

const b = await launch({ out });
try {
  if (vuoi('B1')) {
    const p = await prepara(b);
    await p.go('/');
    await p.waitFor(`!!document.querySelector('[data-testid=pedala-rullo]')`, 10000);
    await sleep(500);
    await p.shot('B1-mai-collegato-390');
    const solo = await p.evaluate(`({ collega: !!document.querySelector('[data-testid=pedala-collega]'), altro: ['pedala-dove','pedala-come','pedala-via'].filter((t) => document.querySelector('[data-testid=' + t + ']')) })`);
    check(solo.collega && solo.altro.length === 0, 'B1: solo «Collega il rullo»', JSON.stringify(solo));
  }
  if (vuoi('C1')) {
    const p = await prepara(b, { collaudo: 'rullo' });
    await p.go('/');
    await p.waitFor(`!!document.querySelector('[data-testid=rullo-chip]')`, 10000);
    await p.click('[data-testid=pedala-collega]');
    await sleep(600);
    await p.shot('C1-pre-390');
    await p.click('[data-testid=pedala-dove]');
    await p.waitFor(`!!document.querySelector('[data-testid=dove-riga-ganda]')`, 30000);
    await sleep(1200);
    await p.shot('D1-dove-390');
    await p.click('[data-testid=dove-riga-ganda]');
    await sleep(800);
    await p.shot('C1-libera-390');
  }
} catch (err) {
  check(false, 'eccezione nel collaudo', String(err?.stack ?? err));
} finally {
  writeFileSync(join(out, 'report.txt'), report.join('\n') + '\n');
  await b.close();
}
console.log(failures ? `\n${failures} controlli falliti` : '\nTutto verde');
process.exit(failures ? 1 : 0);
