// Collaudo visivo del ciclista: il laboratorio (lab/rider.html, solo vite dev) a 390×844 e a 1280×800.
// Uso: node scripts/rider-shot.mjs <base> <outdir>   (es. http://127.0.0.1:5181/allenando shots-rider)
// VIEWS=grid,side&crank=1.2  sceglie le viste (vedi src/lab/riderLab.tsx), SIZES=phone,desk le misure.
// GAME=1 aggiunge il ciclista nel gioco vero: onboarding e giro libero nel mondo di Bergamo (pesante:
// solo con la memoria libera). Un Chrome solo, chiuso sempre alla fine. Esce con 1 se una vista non
// parte o la pagina lancia errori.
import { mkdirSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';

const [base = 'http://127.0.0.1:5181/allenando', out = 'shots-rider'] = process.argv.slice(2);
const views = (process.env.VIEWS ?? 'grid,lod,pose,side,back,close,preview').split(',');
const sizes = (process.env.SIZES ?? 'phone,desk').split(',');
mkdirSync(out, { recursive: true });

let failures = 0;
const b = await launch({ out });
let errors = [];
try {
  const p = await b.phone(base);
  for (const size of sizes) {
    if (size === 'desk') await p.s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const v of views) {
      await p.go(`/lab/rider.html?v=${v}`);
      const ok = await p.waitFor('!!(window.__lab && window.__lab.ready)', 90000);
      await sleep(1200);
      const name = `rider-${v.replace(/[^a-z0-9.=]+/gi, '-')}-${size}`;
      await p.shot(name);
      const lab = await p.evaluate('JSON.stringify(window.__lab ?? null)').catch(() => 'null');
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${lab}`);
      if (!ok) failures++;
    }
  }
  if (process.env.GAME) {
    await p.s('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.go('/start');
    if (await p.waitFor(`!!document.querySelector('[data-testid=onboarding]')`, 20000)) {
      await p.evaluate(`(() => { const i = document.querySelector('[data-testid=onboarding-name]'); if (!i) return false;
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Anna');
        i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      for (let step = 0; step < 5; step++) {
        if (await p.evaluate(`!location.pathname.includes('/start')`)) break;
        if (await p.click('[data-testid=onboarding-next]')) {
          await sleep(400);
          continue;
        }
        await p.click('[data-testid=onboarding-start]');
        await sleep(700);
      }
    }
    await p.go('/ride?world=bergamo&edge=0&s=0&dir=1');
    const ok = await p.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 90000);
    await sleep(6000);
    await p.shot('rider-gioco-phone');
    console.log(`${ok ? 'OK  ' : 'FAIL'} rider-gioco-phone`);
    if (!ok) failures++;
  }
  errors = p.errors;
} finally {
  await b.close();
}
if (errors.length) console.log(`errori nella pagina:\n${errors.join('\n')}`);
process.exit(failures || errors.length ? 1 : 0);
