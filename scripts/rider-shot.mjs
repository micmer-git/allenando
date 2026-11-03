// Collaudo visivo del ciclista: il laboratorio (lab/rider.html, solo vite dev) a 390×844 e a 1280×800.
// Uso: node scripts/rider-shot.mjs <base> <outdir>   (es. http://127.0.0.1:5181/allenando shots-rider)
// VIEWS=grid,side&crank=1.2  sceglie le viste (vedi src/lab/riderLab.tsx), SIZES=phone,desk le misure.
// Un Chrome solo, chiuso sempre alla fine. Esce con 1 se una vista non parte o la pagina lancia errori.
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
  errors = p.errors;
} finally {
  await b.close();
}
if (errors.length) console.log(`errori nella pagina:\n${errors.join('\n')}`);
process.exit(failures || errors.length ? 1 : 0);
