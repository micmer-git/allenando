// Collaudo delle pagine del gioco a 390×844: Oggi (missioni e sessione), Garage (negozio),
// Sessioni, Traguardi, Classifiche, Tu. Niente 3D del mondo: è leggero.
// Uso: node scripts/game-shot.mjs <base> <outdir>   (es. http://127.0.0.1:5183/allenando shots)
// GIOCO=1 aggiunge il 3D del gioco: carta → percorso, allenamenti col posto, archi in ERG (mondo e
// salita), un allenamento che va oltre il percorso, portali dei km, volata del cassonetto.
// NOVITA=1 le novità: due giri su Maresana col fantasma, la cartolina (riepilogo e dettaglio, PNG
// 1080×1350), i programmi con l'allenamento di oggi, un .zwo vero importato, esportato e in ERG.
// Esce con 1 se un controllo fallisce o la pagina lancia errori.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { giroPagine } from './pagine-check.mjs';
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

  // pista 1: tutte le pagine (minuscole, bersagli, overflow, ellissi, «XP») e i «fatto» del piano
  await giroPagine(p, check, { shot: !!process.env.P1_SHOTS });

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

  // le novità girano in una scheda nuova: dopo le corse di prima il WebGL software scendeva a un
  // fotogramma al secondo, e il primo giro su Maresana non finiva in un quarto d'ora
  if (process.env.NOVITA) await p.s('Page.navigate', { url: 'about:blank' });
  if (process.env.NOVITA) {
    // ---------- le novità (pista 4): fantasma, cartolina, programmi, .zwo ----------
    const p = await b.phone(base);
    await p.go('/');
    await p.waitFor(`!!document.querySelector('[data-testid=home-missions]')`, 15000);
    const basePath = new URL(base).pathname.replace(/\/$/, '');
    const nav = async (path) => {
      await p.evaluate(`(() => { history.pushState({}, '', ${JSON.stringify(basePath + '/')}); dispatchEvent(new PopStateEvent('popstate')); })()`);
      await p.waitFor(`!document.querySelector('[data-testid=ride-screen]')`, 15000);
      await sleep(300);
      await p.evaluate(`(() => { history.pushState({}, '', ${JSON.stringify(basePath + path)}); dispatchEvent(new PopStateEvent('popstate')); })()`);
      await sleep(600);
    };
    const ready = (ms = 180000) => p.waitFor(`document.querySelector('[data-testid=world-ready]')?.dataset.ready === 'yes'`, ms);
    const setEffort = (v) =>
      p.evaluate(`(() => { const i = document.querySelector('input[type=range]'); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '${v}'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    // le scritte che cominciano in minuscolo, nodo di testo per nodo di testo (come le conta la pista 1:
    // «12 uscite · 11 h in tutto» spezzato da React diventa «uscite ·» e «in tutto»); le unità no
    const lower = (sel) =>
      p.evaluate(`(() => { const out = []; for (const root of document.querySelectorAll(${JSON.stringify(sel)})) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const t = n.textContent.trim(); if (t.length < 4 || !/\\s/.test(t) || !n.parentElement || n.parentElement.closest('.sr-only') || getComputedStyle(n.parentElement).textTransform === 'uppercase') continue; if (/^[a-zàèéìòù]/.test(t) && !/^(km|m |min|kg|bpm|rpm|ml|h )/.test(t)) out.push(t); } } return out; })()`);
    // un PNG dalla pagina (blob: dell'anteprima) al disco
    const savePng = async (sel, name) => {
      const r = await p.evaluate(`(async () => { const img = document.querySelector(${JSON.stringify(sel)}); if (!img) return null; await img.decode().catch(() => null); const buf = new Uint8Array(await (await fetch(img.src)).arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return { w: img.naturalWidth, h: img.naturalHeight, b64: btoa(s) }; })()`);
      if (r) writeFileSync(join(out, `${name}.png`), Buffer.from(r.b64, 'base64'));
      return r;
    };

    // N2 · due giri su Maresana: il primo forte, il secondo più piano; al secondo il fantasma è in strada
    await nav('/ride?world=bergamo&ride=maresana');
    check(await ready(), 'fantasma: Maresana pronta');
    // grafica bassa e cielo sereno (la pioggia vera costa fotogrammi): il simulatore a 10× è legato
    // ai fotogrammi, e il fantasma si prova sul tempo simulato, non sulla grafica
    await p.clickText('Sempre sereno');
    await p.clickText('Bassa');
    await sleep(1500);
    await ready();
    await p.clickText('10×');
    await setEffort(160);
    check(await p.evaluate(`!document.querySelector('[data-testid=ghost-gap]')`), 'fantasma: al primo giro non c’è');
    check(await p.waitFor(`!!document.querySelector('[data-testid=ride-summary]')`, 1800000), 'fantasma: primo giro finito');
    await sleep(1500);
    await p.shot('n2-01-primo-giro-riepilogo');
    // N3 · la cartolina dal riepilogo
    check(await p.click('[data-testid=cartolina-open]'), 'cartolina: il tasto nel riepilogo');
    check(await p.waitFor(`!!document.querySelector('[data-testid=cartolina-img]')`, 60000), 'cartolina: disegnata');
    await sleep(800);
    const png = await savePng('[data-testid=cartolina-img]', 'n3-cartolina-maresana');
    check(png?.w === 1080 && png?.h === 1350, 'cartolina: PNG 1080×1350', png ? `${png.w}×${png.h}` : 'niente');
    await p.shot('n3-01-cartolina-riepilogo');
    await auditCheck(p, 'cartolina');
    const low3 = await lower('[data-testid=cartolina]');
    check(low3.length === 0, 'cartolina: niente minuscole', low3.join(' | '));
    await p.click('[data-testid=cartolina-close]');
    await sleep(300);
    await p.click('[data-testid=ride-save]');
    check(await p.waitFor(`!!document.querySelector('[data-testid=ride-open-history]')`, 10000), 'primo giro: salvato');

    await nav('/ride?world=bergamo&ride=maresana');
    check(await ready(), 'fantasma: Maresana di nuovo');
    await p.clickText('10×');
    await setEffort(115);
    check(await p.waitFor(`/^(Davanti al fantasma · \\d+ s|Dietro al fantasma · \\d+ s|Pari col fantasma)$/.test(document.querySelector('[data-testid=ghost-gap]')?.textContent ?? '')`, 60000), 'fantasma: ghost-gap dice i secondi', await p.evaluate(`document.querySelector('[data-testid=ghost-gap]')?.textContent ?? ''`));
    check(await p.waitFor(`/^Dietro al fantasma · \\d+ s$/.test(document.querySelector('[data-testid=ghost-gap]')?.textContent ?? '')`, 120000), 'fantasma: più piano del record, sei dietro', await p.evaluate(`document.querySelector('[data-testid=ghost-gap]')?.textContent ?? ''`));
    await p.clickText('1×');
    await sleep(2500);
    await p.shot('n2-02-fantasma-in-strada');
    await p.clickText('10×');
    await sleep(6000);
    await p.clickText('1×');
    await sleep(2500);
    await p.shot('n2-03-fantasma-davanti');
    // la pillola da leggere: nel layout di oggi il banner del tratto le sta sopra (la posizione si
    // sistema all'unione con la pista 2); qui il banner si nasconde solo per la fotografia
    await p.evaluate(`document.querySelector('[data-testid=ride-hud-center]')?.style.setProperty('visibility', 'hidden')`);
    await p.shot('n2-04-pillola-fantasma');
    await p.evaluate(`document.querySelector('[data-testid=ride-hud-center]')?.style.removeProperty('visibility')`);
    // contrasto del testo sulla pillola, posata sul cielo più chiaro possibile (il bianco)
    const ratio = await p.evaluate(`(() => { const el = document.querySelector('[data-testid=ghost-gap]'); if (!el) return 0; const st = getComputedStyle(el); const num = (c) => (c.match(/[\\d.]+/g) ?? []).map(Number); const [r, g, b, a = 1] = num(st.backgroundColor); const bg = [r, g, b].map((v) => v * a + 255 * (1 - a)); const fg = num(st.color).slice(0, 3); const lum = (c) => { const [x, y, z] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; }; const l1 = lum(fg), l2 = lum(bg); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); })()`);
    check(ratio >= 4.5, 'fantasma: contrasto della pillola ≥ 4,5:1 anche sul bianco', ratio.toFixed(1));
    check(!/255, 100, 100|180, 35, 35/.test(await p.evaluate(`getComputedStyle(document.querySelector('[data-testid=ghost-gap]')).color`)), 'fantasma: la pillola non è rossa');
    console.log('     ghost-gap:', await p.evaluate(`document.querySelector('[data-testid=ghost-gap]')?.textContent ?? ''`));

    // N3 · la cartolina dal dettaglio del giro salvato
    await nav('/history');
    await p.waitFor(`!!document.querySelector('a[href*="/history/ride-"]')`, 10000);
    const detail = (await p.evaluate(`document.querySelector('a[href*="/history/ride-"]')?.getAttribute('href')`)) ?? `${basePath}/history`;
    await nav(detail.replace(basePath, ''));
    check(await p.waitFor(`!!document.querySelector('[data-testid=ride-detail] [data-testid=cartolina-open]')`, 10000), 'cartolina: il tasto nel dettaglio');
    await p.click('[data-testid=cartolina-open]');
    check(await p.waitFor(`!!document.querySelector('[data-testid=cartolina-img]')`, 60000), 'cartolina: dal dettaglio');
    await sleep(800);
    const png2 = await savePng('[data-testid=cartolina-img]', 'n3-cartolina-dettaglio');
    check(png2?.w === 1080 && png2?.h === 1350, 'cartolina dal dettaglio: 1080×1350');
    await p.shot('n3-02-cartolina-dettaglio');
    await p.click('[data-testid=cartolina-close]');

    // N3 · Città Alta dalla build: un giro intero a 10×, poi la cartolina coi monumenti passati
    await nav('/ride?world=bergamo&ride=citta-alta');
    check(await ready(), 'cartolina Città Alta: pronta');
    await p.clickText('10×');
    await setEffort(160);
    check(await p.waitFor(`!!document.querySelector('[data-testid=ride-summary]')`, 1800000), 'cartolina Città Alta: giro finito');
    await p.click('[data-testid=cartolina-open]');
    check(await p.waitFor(`!!document.querySelector('[data-testid=cartolina-img]')`, 60000), 'cartolina Città Alta: disegnata');
    await sleep(800);
    const ca = await savePng('[data-testid=cartolina-img]', 'n3-cartolina-citta-alta');
    check(ca?.w === 1080 && ca?.h === 1350, 'cartolina Città Alta: PNG 1080×1350');
    const mon = await p.evaluate(`document.querySelector('[data-testid=cartolina-img]').dataset.monumenti`);
    check(/Porta Sant’Agostino/.test(mon) && !mon.includes("'") && mon.split('|').length >= 5, 'cartolina Città Alta: i monumenti, con l’apostrofo tipografico', mon);
    check(await p.evaluate(`document.fonts.check('800 100px "Barlow Condensed"') && document.fonts.check('500 24px Outfit')`), 'cartolina Città Alta: Barlow Condensed e Outfit caricati');
    await p.shot('n3-03-cartolina-citta-alta');
    await p.click('[data-testid=cartolina-close]');

    // N4 · i programmi: si comincia oggi, Oggi mostra la seduta e un tocco apre la corsa
    await nav('/programmi');
    check(await p.waitFor(`!!document.querySelector('[data-testid=plan-start-primo-selvino]')`, 10000), 'programmi: la pagina');
    await p.shot('n4-01-programmi');
    await p.shot('n4-01-programmi-tutta', true);
    await auditCheck(p, 'programmi');
    await p.click('[data-testid=plan-start-primo-selvino]');
    check(await p.waitFor(`document.querySelector('[data-testid=plan-active]')?.dataset.plan === 'primo-selvino'`, 5000), 'programmi: Primo Selvino cominciato');
    await sleep(500);
    await p.shot('n4-02-programma-attivo');
    await p.shot('n4-02-programma-attivo-tutta', true);
    await auditCheck(p, 'programma attivo');
    const low4 = await lower('[data-testid=plans-page]');
    check(low4.length === 0, 'programmi: niente minuscole', low4.join(' | '));
    await nav('/');
    check(await p.waitFor(`document.querySelector('[data-testid=today-workout]')?.dataset.day === '0'`, 8000), 'oggi: l’allenamento di oggi (giorno 0)');
    const todayText = await p.evaluate(`document.querySelector('[data-testid=today-workout]').textContent`);
    check(/L’allenamento di oggi/.test(todayText) && /Val Seriana/.test(todayText), 'oggi: la riga giusta per la data', todayText);
    await p.shot('n4-03-oggi');
    await auditCheck(p, 'oggi col programma');
    const low5 = await lower('[data-testid=today-workout]');
    check(low5.length === 0, 'oggi: niente minuscole nella carta', low5.join(' | '));
    const href = await p.evaluate(`document.querySelector('[data-testid=today-workout-go]').getAttribute('href')`);
    check(/workout=endurance/.test(href) && /ride=val-seriana/.test(href), 'oggi: il link mette insieme allenamento e percorso', href);
    await p.click('[data-testid=today-workout-go]');
    check(await ready(), 'oggi → corsa: pronta');
    check(await p.waitFor(`!!document.querySelector('[data-testid=erg-target]')`, 10000), 'oggi → corsa: in ERG');
    check(/Val Seriana/.test(await p.evaluate(`document.querySelector('[data-testid=ride-route]')?.textContent ?? ''`)), 'oggi → corsa: sul percorso Val Seriana');
    await sleep(1500);
    await p.shot('n4-04-corsa-dal-programma');
    // tre giorni dopo: il giorno 3 è riposo e l'agilità del giorno 2 è saltata, da recuperare
    await nav('/');
    await p.evaluate(`new Promise((ok, ko) => { const r = indexedDB.open('allenando'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); const st = tx.objectStore('kv'); const g = st.get('programma'); g.onsuccess = () => { const v = g.result; const d = new Date(); d.setDate(d.getDate() - 3); v.start = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); v.done = { 0: 'a-mano' }; st.put(v, 'programma'); }; tx.oncomplete = () => ok(true); tx.onerror = ko; }; r.onerror = ko; })`);
    await nav('/programmi');
    await nav('/');
    check(await p.waitFor(`document.querySelector('[data-testid=today-workout]')?.dataset.day === '2'`, 8000), 'oggi, tre giorni dopo: da recuperare il giorno 2');
    check(/Da recuperare/.test(await p.evaluate(`document.querySelector('[data-testid=today-workout]').textContent`)), 'oggi: «Da recuperare»');
    await p.shot('n4-05-oggi-da-recuperare');

    // N5 · un .zwo vero: si importa, sta fra i tuoi, va in ERG
    await nav('/workouts');
    await p.waitFor(`!!document.querySelector('[data-testid=zwo-import] input')`, 8000);
    const zwoPath = join(out, 'trenta-trenta.zwo');
    // un .zwo scritto da noi, come quelli di tests/novita.test.ts: riscaldamento, IntervalsT con la
    // cadenza, FreeRide, defaticamento
    const ZWO = `<workout_file>
    <author>OROBIA</author>
    <name>Trenta-trenta in Val Seriana</name>
    <description>Due serie di 30 secondi forte e 30 piano, con due minuti liberi in mezzo.</description>
    <sportType>bike</sportType>
    <tags/>
    <workout>
        <Warmup Duration="480" PowerLow="0.4" PowerHigh="0.7">
            <textevent timeoffset="10" message="Si parte piano"/>
        </Warmup>
        <IntervalsT Repeat="8" OnDuration="30" OffDuration="30" OnPower="1.2" OffPower="0.5" Cadence="100" CadenceResting="85"/>
        <FreeRide Duration="120" FlatRoad="1"/>
        <IntervalsT Repeat="6" OnDuration="30.000002" OffDuration="30.000002" OnPower="1.3" OffPower="0.55"/>
        <Cooldown Duration="360" PowerLow="0.65" PowerHigh="0.35"/>
    </workout>
</workout_file>
`;
    writeFileSync(zwoPath, ZWO);
    await p.s('DOM.enable');
    const { result } = await p.s('Runtime.evaluate', { expression: `document.querySelector('[data-testid=zwo-import] input')` });
    await p.s('DOM.setFileInputFiles', { files: [zwoPath], objectId: result.objectId });
    check(await p.waitFor(`/Importato «Trenta-trenta in Val Seriana»/.test(document.querySelector('[data-testid=zwo-note]')?.textContent ?? '')`, 8000), 'zwo: importato', await p.evaluate(`document.querySelector('[data-testid=zwo-note]')?.textContent ?? ''`));
    await sleep(500);
    await p.evaluate(`document.querySelector('[data-testid=zwo-note]').scrollIntoView({ block: 'start' })`);
    await p.shot('n5-01-zwo-importato');
    await p.evaluate(`[...document.querySelectorAll('h2')].find((h) => h.textContent === 'Trenta-trenta in Val Seriana')?.scrollIntoView({ block: 'center' })`);
    await sleep(400);
    await p.shot('n5-02-zwo-fra-i-tuoi');
    await auditCheck(p, 'allenamenti col .zwo');
    const zid = await p.evaluate(`(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Trenta-trenta in Val Seriana'); return h?.closest('li')?.querySelector('[data-testid^=zwo-export-]')?.getAttribute('data-testid')?.replace('zwo-export-', '') ?? null; })()`);
    check(!!zid, 'zwo: l’allenamento importato ha «Inizia»', zid ?? '');
    // l'esportazione: Chrome headless non scrive i download dei blob, si legge il file dal blob stesso
    await p.evaluate(`(() => { window.__zwo = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then((t) => (window.__zwo = t)); return orig.call(URL, b); }; })()`);
    await p.click(`[data-testid="zwo-export-${zid}"]`);
    const exported = (await p.waitFor(`(window.__zwo ?? '').includes('</workout_file>')`, 8000)) ? await p.evaluate('window.__zwo') : '';
    if (exported) writeFileSync(join(out, 'n5-trenta-trenta-esportato.zwo'), exported);
    check(/<name>Trenta-trenta in Val Seriana<\/name>/.test(exported) && /<IntervalsT Repeat="\d+" OnDuration="30" OffDuration="30"/.test(exported), 'zwo: esportato di nuovo, con gli IntervalsT', exported ? `${exported.length} caratteri` : 'niente');
    await p.click(`[data-testid="workout-${zid}"]`);
    check(await ready(), 'zwo → corsa: pronta');
    check(await p.waitFor(`!!document.querySelector('[data-testid=erg-target]')`, 10000), 'zwo → corsa: in ERG');
    check(await p.waitFor(`(document.querySelector('[data-testid=ride-arches]')?.dataset.list ?? '').includes('erg:')`, 30000), 'zwo → corsa: gli archi dell’ERG');
    await sleep(1500);
    await p.shot('n5-03-zwo-in-erg');
    check(p.errors.length === 0, 'novità: nessun errore di pagina', p.errors.slice(0, 5).join(' | '));
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
