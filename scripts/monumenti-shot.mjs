// Collaudo visivo dei monumenti: il laboratorio (lab/monumenti.html, solo vite dev) in Chrome headless.
// Uso: node scripts/monumenti-shot.mjs <base> <outdir>   (es. http://127.0.0.1:5192/allenando %TEMP%/orobia-shots/monumenti)
// Di base: le cinque pagine da otto modelli («alta») a 1280×800, e la griglia dei quaranta «bassa».
// IDS=w30964918,w79808375  aggiunge quei modelli da soli, in scala vera; DET=bassa  le pagine da lontano;
// PAGES=0,1 solo quelle pagine (con IDS e senza PAGES, solo i modelli scelti); SIZES=phone,desk le misure. Un Chrome solo, chiuso sempre alla fine.
// SPOTS="nome|/ride?world=bergamo&edge=..&dir=..&s=..;…" invece del laboratorio: il gioco vero (accesso,
// poi un punto del mondo), luce di mezzodì, solo il 3D, una schermata per punto quando il mondo è pronto.
// Esce con 1 se una vista non parte, se la pagina lancia errori o se un modello sfora il tetto di triangoli.
import { mkdirSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';

const [base = 'http://127.0.0.1:5192/allenando', out = 'shots-monumenti'] = process.argv.slice(2);
const sizes = (process.env.SIZES ?? 'desk').split(',');
const ids = (process.env.IDS ?? '').split(',').filter(Boolean);
// con IDS e senza PAGES: solo quei modelli
const pages = (process.env.PAGES ?? (ids.length ? '' : '0,1,2,3,4')).split(',').filter(Boolean).map(Number);
const det = process.env.DET ?? 'alta';
mkdirSync(out, { recursive: true });

const spots = (process.env.SPOTS ?? '').split(';').filter(Boolean).map((x) => x.split('|'));
const views = spots.length ? [] : [
  ...pages.map((p) => ({ name: `pagina-${p + 1}-${det}`, path: `/lab/monumenti.html?v=grid&from=${p * 8}&n=8&det=${det}&spin=0` })),
  ...(process.env.PAGES || ids.length ? [] : [{ name: 'tutti-bassa', path: '/lab/monumenti.html?v=grid&det=bassa&spin=0' }]),
  ...ids.map((id) => ({ name: `uno-${id}`, path: `/lab/monumenti.html?v=uno&id=${id}&spin=0&det=${det}` })),
];

let failures = 0;
const b = await launch({ out });
let errors = [];
try {
  const p = await b.phone(base);
  if (spots.length) {
    // l'accesso, come in rider-shot.mjs: nome, avanti, via
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
    for (const [name, path] of spots) {
      await p.go(path);
      const t0 = Date.now();
      const ok = await p.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, 150000);
      await p.evaluate(`(() => { const d = [...document.querySelectorAll('details')].find((x) => x.textContent.includes('Impostazioni')); if (d) d.open = true;
        [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Mezzodì')?.click(); return true; })()`);
      await sleep(Number(process.env.SETTLE ?? 9000));
      await p.evaluate(`(() => { const st = document.createElement('style'); st.id = 'solo3d'; st.textContent = '* { visibility: hidden !important } canvas { visibility: visible !important }'; document.head.appendChild(st); return true; })()`);
      await sleep(300);
      await p.shot(`spot-${name}`);
      console.log(`${ok ? 'OK  ' : 'FAIL'} spot-${name} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      if (!ok) failures++;
    }
  }
  for (const size of spots.length ? [] : sizes) {
    if (size === 'desk') await p.s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const v of views) {
      await p.go(v.path);
      const ok = await p.waitFor('!!(window.__lab && window.__lab.ready)', 120000);
      await sleep(800);
      await p.shot(`${v.name}-${size}`);
      const lab = await p.evaluate('JSON.stringify(window.__lab ?? null)').catch(() => 'null');
      const over = ok && JSON.parse(lab)?.over?.length > 0;
      console.log(`${ok && !over ? 'OK  ' : 'FAIL'} ${v.name}-${size} ${lab}`);
      if (!ok || over) failures++;
    }
  }
  errors = p.errors;
} finally {
  await b.close();
}
if (errors.length) console.log(`errori nella pagina:\n${errors.join('\n')}`);
process.exit(failures || errors.length ? 1 : 0);
