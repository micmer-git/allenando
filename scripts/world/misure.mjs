// Le misure del mondo 3D ai punti standard (piano del rilascio, voce 3.1).
// Uso: node scripts/world/misure.mjs <base> <cartella> [etichetta]
//   base: es. http://localhost:5303/allenando (servito con `vite preview`)
//   Con due basi e due etichette separate da virgole («http://…:5313/allenando,http://…:5303/allenando»
//   «prima,dopo») misura i punti alternando le due build, punto per punto: con la grafica software
//   e altri processi sulla macchina è l'unico confronto che regge.
// RIDE=1: dopo la misura pedala 10 s a 4× e conta mattonelle e arredo comparsi entro 150 m dopo il
// «pronto» (pop-in), con i km del contachilometri prima e dopo.
// Per ogni punto: tempo fino a «pronto» (world-ready), mattonelle al momento del «pronto», poi,
// dopo SETTLE ms, una finestra di MISURA ms in cui si leggono da `window.__orobiaStats` (?stats=1)
// chiamate di disegno, triangoli, geometrie, texture, tempo per fotogramma p50/p95, e l'heap JS.
// TEMPI=1: anche tre schermate a 1,5 / 3 / 6 s dall'apertura (il «pop-in», voce 3.9).
// PUNTI="nome|/ride?...;..." sostituisce i punti standard. Scrive <cartella>/misure-<etichetta>.json.
// Il WebGL è software (swiftshader): i numeri valgono solo come confronto fra due build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from '../cdp.mjs';

const [base = 'http://localhost:5303/allenando', out = 'misure', label = 'misura'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SETTLE = Number(process.env.SETTLE ?? 8000);
const MISURA = Number(process.env.MISURA ?? 6000);
const STANDARD = [
  ['citta-alta-0', '/ride?world=bergamo&ride=citta-alta'],
  ['citta-alta-1500', '/ride?world=bergamo&ride=citta-alta&at=1500'],
  ['libero', '/ride?world=bergamo&edge=0&s=0&dir=1'],
  ['selvino-5200', '/ride?route=selvino-nembro&at=5200'],
  ['val-seriana-9000', '/ride?world=bergamo&ride=val-seriana&at=9000'],
  ['ganda-16000', '/ride?world=bergamo&ride=ganda&at=16000'],
];
const punti = process.env.PUNTI ? process.env.PUNTI.split(';').filter(Boolean).map((p) => p.split('|')) : STANDARD;

const bases = base.split(',');
const labels = label.split(',');
const b = await launch({ out });
const reps = labels.map((l, i) => ({ label: l, base: bases[i], settle: SETTLE, misura: MISURA, punti: {} }));
try {
  let p = await b.phone(bases[0], { width: 390, height: 844 });
  for (const base of bases) {
    await p.s('Page.navigate', { url: `${base}/start` });
    await sleep(700);
    await p.waitFor(`!!document.querySelector('[data-testid=onboarding-name]')`);
    await p.evaluate(`(() => { const i = document.querySelector('[data-testid=onboarding-name]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Anna'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    for (let step = 0; step < 6; step++) {
      if (await p.evaluate(`!location.pathname.includes('/start')`)) break;
      if (!(await p.click('[data-testid=onboarding-next]'))) await p.click('[data-testid=onboarding-start]');
      await sleep(600);
    }
  }
  for (const [name, path] of punti) for (let bi = 0; bi < bases.length; bi++) try {
    const base = bases[bi];
    const rep = reps[bi];
    const dirOut = bases.length > 1 ? join(out, rep.label) : out;
    mkdirSync(dirOut, { recursive: true });
    const url = `${path}${path.includes('?') ? '&' : '?'}stats=1`;
    const t0 = Date.now();
    await p.s('Page.navigate', { url: `${base}${url}` });
    const shots = process.env.TEMPI ? [1500, 3000, 6000] : [];
    let readyMs = null;
    let atReady = null;
    // il mondo intorno davvero pronto: tutte le mattonelle entro 400 m in scena (lo dice ?stats=1
    // anche nella build di prima, dove «pronto» arrivava con la prima mattonella qualunque)
    let realMs = null;
    while (Date.now() - t0 < 120000) {
      const el = Date.now() - t0;
      if (shots.length && el >= shots[0]) {
        const at = shots.shift();
        await p.shot(`${bases.length > 1 ? rep.label + '/' : ''}tempi-${name}-${(at / 1000).toFixed(1).replace('.', ',')}s`);
      }
      if (readyMs == null) {
        const r = await p.evaluate(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes' ? (window.__orobiaStats ?? {}) : null`).catch(() => null);
        if (r) {
          readyMs = Date.now() - t0;
          atReady = r;
        }
      }
      if (realMs == null) {
        const t = await p.evaluate(`window.__orobiaStats?.tiles ?? null`).catch(() => null);
        if (t && t.near > 0 && t.nearReady >= t.near) realMs = Date.now() - t0;
        // la salita (RideScene) non ha mattonelle: lì pronto è pronto
        if (readyMs != null && !t) realMs = readyMs;
      }
      if (readyMs != null && realMs != null && shots.length === 0) break;
      await sleep(100);
    }
    await sleep(Math.max(0, SETTLE - (Date.now() - t0 - (readyMs ?? 0))));
    // FULL=1: si misura a mondo intorno completo (nessuna mattonella in attesa), fino a 120 s
    let fullMs = null;
    if (process.env.FULL) {
      const ok = await p.waitFor(`(() => { const t = window.__orobiaStats?.tiles; return !t || t.pending === 0; })()`, 120000);
      if (ok) fullMs = Date.now() - t0;
      await sleep(2000);
    }
    await p.evaluate(`window.__orobiaStatsReset?.(), true`);
    await sleep(MISURA);
    const st = await p.evaluate(`window.__orobiaStats ?? null`);
    const heap = await p.evaluate(`performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null`);
    await p.shot(`${bases.length > 1 ? rep.label + '/' : ''}misura-${name}`);
    let pop = null;
    if (process.env.RIDE && st?.tiles) {
      // 4×: sul piano il simulatore va a 25-30 km/h, cioè oltre 100 km/h di mondo che scorre
      const km0 = await p.evaluate(`document.querySelector('[data-testid=ride-km]')?.textContent ?? ''`).catch(() => '');
      await p.clickText('4×');
      await sleep(10000);
      const t = await p.evaluate(`window.__orobiaStats?.tiles ?? null`);
      const km = await p.evaluate(`document.querySelector('[data-testid=ride-km]')?.textContent ?? ''`).catch(() => '');
      pop = t ? { late: t.late, lateMin: t.lateMin, km0, km } : null;
    }
    rep.punti[name] = { path, readyMs, realMs, fullMs, tilesAtReady: atReady?.tiles ?? null, progressAtReady: atReady?.progress ?? null, ...st, heapMB: heap, pop };
    const r = rep.punti[name];
    console.log(
      `${(bases.length > 1 ? rep.label + ' ' : '') + name.padEnd(18)} pronto ${readyMs == null ? 'NO' : (readyMs / 1000).toFixed(1) + ' s'} · 400 m intorno ${realMs == null ? 'NO' : (realMs / 1000).toFixed(1) + ' s'}${fullMs ? ` (tutto ${(fullMs / 1000).toFixed(0)} s)` : ''} · chiamate ${r.calls} · triangoli ${r.triangles} · geo ${r.geometries} · tex ${r.textures} · p50 ${r.frameP50} ms · p95 ${r.frameP95} ms · mattonelle ${r.tiles ? `${r.tiles.ready}/${r.tiles.ready + r.tiles.pending} (entro 400 m al pronto ${r.tilesAtReady?.nearReady}/${r.tilesAtReady?.near})` : '–'} · heap ${heap} MB${pop ? ` · pop-in entro 150 m: ${pop.late} (il più vicino ${pop.lateMin} m; km ${pop.km0} → ${pop.km})` : ''}`,
    );
  } catch (err) {
    // con la grafica software e la macchina carica la scheda può morire: si segna e si va avanti
    // con una scheda nuova (stesso profilo: l'accesso fatto resta)
    console.log(`${labels[bi]} ${name}: scheda persa (${String(err?.message ?? err)}), si riprende`);
    reps[bi].punti[name] = { path, error: String(err?.message ?? err) };
    p = await b.phone(bases[0], { width: 390, height: 844 });
  }
  for (const rep of reps) rep.errors = p.errors;
} catch (e) {
  for (const rep of reps) rep.exc = String(e?.stack ?? e);
  console.error(String(e?.stack ?? e));
} finally {
  for (const rep of reps) writeFileSync(join(out, `misure-${rep.label}.json`), JSON.stringify(rep, null, 1));
  await b.close();
}
