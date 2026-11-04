// Collaudo visivo dei monumenti: il laboratorio (lab/monumenti.html, solo vite dev) in Chrome headless.
// Uso: node scripts/monumenti-shot.mjs <base> <outdir>   (es. http://127.0.0.1:5192/allenando %TEMP%/orobia-shots/monumenti)
// Di base: le cinque pagine da otto modelli («alta») a 1280×800, e la griglia dei quaranta «bassa».
// IDS=w30964918,w79808375  aggiunge quei modelli da soli, in scala vera; DET=bassa  le pagine da lontano;
// PAGES=0,1 solo quelle pagine (con IDS e senza PAGES, solo i modelli scelti); SIZES=phone,desk le misure. Un Chrome solo, chiuso sempre alla fine.
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

const views = [
  ...pages.map((p) => ({ name: `pagina-${p + 1}-${det}`, path: `/lab/monumenti.html?v=grid&from=${p * 8}&n=8&det=${det}&spin=0` })),
  ...(process.env.PAGES || ids.length ? [] : [{ name: 'tutti-bassa', path: '/lab/monumenti.html?v=grid&det=bassa&spin=0' }]),
  ...ids.map((id) => ({ name: `uno-${id}`, path: `/lab/monumenti.html?v=uno&id=${id}&spin=0&det=${det}` })),
];

let failures = 0;
const b = await launch({ out });
let errors = [];
try {
  const p = await b.phone(base);
  for (const size of sizes) {
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
