// «Pronto vuol dire pronto» su un telefono lento (piano del rilascio, voce 3.3).
// Uso: node scripts/world/pronto-lento.mjs <base> <cartella> [giri]
// Con la CPU rallentata 4× (CDP Emulation.setCPUThrottlingRate) apre Ganda at=16000 e Città Alta
// at=1500, `giri` volte ciascuno (3 di base), e legge `window.__orobiaReady` (?stats=1): perché si è
// detto pronto e quante mattonelle entro 400 m c'erano. Passa se in tutti i giri nearReady == near.
// Scrive <cartella>/pronto-lento.json e una schermata nell'istante del pronto per giro.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from '../cdp.mjs';

const [base = 'http://localhost:5323/allenando', out = 'pronto-lento', giri = '3'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PUNTI = [
  ['ganda-16000', '/ride?world=bergamo&ride=ganda&at=16000&stats=1'],
  ['citta-alta-1500', '/ride?world=bergamo&ride=citta-alta&at=1500&stats=1'],
];
const rep = { base, rate: 4, giri: [] };
let ok = true;
const b = await launch({ out });
try {
  let p = await b.phone(base, { width: 390, height: 844 });
  await p.go('/start');
  await p.waitFor(`!!document.querySelector('[data-testid=onboarding-name]')`);
  await p.evaluate(`(() => { const i = document.querySelector('[data-testid=onboarding-name]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Anna'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  for (let step = 0; step < 6; step++) {
    if (await p.evaluate(`!location.pathname.includes('/start')`)) break;
    if (!(await p.click('[data-testid=onboarding-next]'))) await p.click('[data-testid=onboarding-start]');
    await sleep(600);
  }
  for (let g = 1; g <= Number(giri); g++) {
    for (const [name, path] of PUNTI) {
      try {
        await p.s('Emulation.setCPUThrottlingRate', { rate: 4 });
        const t0 = Date.now();
        await p.s('Page.navigate', { url: `${base}${path}` });
        await sleep(700);
        const done = await p.waitFor(`!!window.__orobiaReady`, 200000);
        const r = done ? await p.evaluate(`window.__orobiaReady`) : null;
        if (done) await p.shot(`pronto-${name}-${g}`);
        const pass = !!r && r.near > 0 && r.nearReady === r.near && r.reason === 'tutto';
        if (!pass) ok = false;
        rep.giri.push({ giro: g, punto: name, wallMs: Date.now() - t0, ...r, pass });
        console.log(`${pass ? 'OK  ' : 'FAIL'} giro ${g} ${name}: ${r ? `${r.reason}, ${r.nearReady}/${r.near} entro 400 m, ${(r.ms / 1000).toFixed(1)} s` : 'mai pronto in 200 s'}`);
      } catch (err) {
        // con la grafica software la scheda può morire: si segna e si riapre
        ok = false;
        rep.giri.push({ giro: g, punto: name, error: String(err?.message ?? err) });
        console.log(`FAIL giro ${g} ${name}: scheda persa (${String(err?.message ?? err)})`);
        p = await b.phone(base, { width: 390, height: 844 });
      }
    }
  }
} finally {
  rep.ok = ok;
  writeFileSync(join(out, 'pronto-lento.json'), JSON.stringify(rep, null, 1));
  await b.close();
}
console.log(ok ? '\nTutto verde' : '\nQualche giro non passa');
process.exit(ok ? 0 : 1);
