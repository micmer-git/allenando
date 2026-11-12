// Prova il percorso dell’utente in un profilo Chrome isolato, senza Bluetooth o modalità collaudo.
import assert from 'node:assert/strict';
import { launch, sleep } from './cdp.mjs';
import { apri, naviga } from './flusso-lib.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/allenando';
const browser = await launch();
try {
  const p = await apri(browser, base, { bassa: true, init: "localStorage.setItem('allenando.world.share', '0')" });
  const selector = id => `[data-testid="${id}"]`;
  const exists = id => `Boolean(document.querySelector('${selector(id)}'))`;
  const text = id => p.evaluate(`document.querySelector('${selector(id)}')?.textContent`);
  const wait = async (condition, label) => {
    if (!await p.waitFor(condition, 60_000)) {
      assert.fail(label + ' · ' + await p.evaluate('document.visibilityState + " · " + document.body.innerText.slice(0, 450)') + ' · ' + p.errors.slice(-3));
    }
  };
  const seconds = async () => (await text('ride-time')).split(':').reduce((total, field) => total * 60 + Number(field), 0);
  const km = async () => Number((await p.evaluate(`document.querySelector('[data-testid=ride-km] [data-big]').textContent`)).replace(',', '.'));

  await p.go('/confronto?world=bergamo&ride=selvino&punto=100');
  await wait(exists('sopralluogo-pedala'), 'Partenza dal sopralluogo');
  const picked = new URL(await p.evaluate(`document.querySelector('[data-testid=sopralluogo-pedala]').href`));
  await p.click(selector('sopralluogo-pedala'));
  await wait(exists('pedala-manuale'), 'Scelta libera senza rullo');
  await p.click(selector('pedala-manuale'));
  await wait(`document.querySelector('[data-testid=pedala-via]')?.href?.includes('edge=')`, 'Percorso configurato');
  const target = new URL(await p.evaluate(`document.querySelector('[data-testid=pedala-via]').href`));
  for (const key of ['world', 'edge', 's', 'dir']) assert.equal(target.searchParams.get(key), picked.searchParams.get(key), key);
  assert.equal(target.searchParams.get('manuale'), '1');
  await p.click(selector('pedala-via'));
  await wait(`document.querySelector('[data-testid=ride-screen]')?.dataset.ready === 'yes'`, '3D pronto');
  await wait(exists('watt-manuali'), 'Regolazione in corsa');
  const watt = Number(await p.evaluate(`document.querySelector('[data-testid=watt-manuali] input').value`)) + 5;
  await p.click('[aria-label="Aumenta i watt manuali"]');
  await wait(`Number(document.querySelector('[data-testid=ride-power]')?.textContent) === ${watt}`, 'Potenza effettiva dopo +5 W');
  const before = { time: await seconds(), km: await km() };
  const origin = await p.evaluate('performance.timeOrigin');
  await p.click(selector('ride-back'));
  await wait(exists('ride-open-diary'), 'Diario durante la corsa');
  await p.click(selector('ride-open-diary'));
  await wait(exists('back-to-live-ride'), 'Ritorno alla stessa sessione');
  const bannerStart = await text('back-to-live-ride');
  const startSecond = /\b(\d+):(\d{2})\b/.exec(bannerStart);
  assert.ok(startSecond);
  const atStart = Number(startSecond[1]) * 60 + Number(startSecond[2]);
  // Confronta il tempo mostrato con lo stesso orologio monotòno del documento.
  const backgroundAt = await p.evaluate('performance.now()');
  assert.ok(!(await p.evaluate(exists('ride-recovery'))));
  await sleep(8000);
  const caughtUp = await p.waitFor(`(() => {
    const clock = document.querySelector('[data-testid=back-to-live-ride]')?.textContent.match(/(\\d+):(\\d{2})/);
    if (!clock) return false;
    const elapsed = Number(clock[1]) * 60 + Number(clock[2]) - ${atStart};
    return Math.abs(elapsed - (performance.now() - ${backgroundAt}) / 1000) < 1.6;
  })()`, 6000);
  const bannerEnd = await text('back-to-live-ride');
  assert.ok(caughtUp, JSON.stringify({ bannerStart, bannerEnd }));
  assert.equal(await p.evaluate('performance.timeOrigin'), origin, 'Nessun ricaricamento del documento');
  await p.click(selector('back-to-live-ride'));
  await wait(exists('ride-time'), 'Contachilometri dopo il ritorno');
  const after = { time: await seconds(), km: await km() };
  assert.ok(after.time >= before.time + 7, JSON.stringify({ before, after, bannerStart, bannerEnd }));
  assert.ok(after.km > before.km, JSON.stringify({ before, after }));
  assert.equal(await p.evaluate(`document.querySelector('[data-testid=watt-manuali] input').value`), String(watt));

  // Ganda dalla preparazione: scegli il piano senza perdere il giro che sta ancora correndo.
  await naviga(p, '/?dove=ganda');
  await wait(`document.querySelector('[data-testid=pedala-via]')?.href?.includes('plan=ganda-da-gazzaniga')`, 'Salita di Ganda da Gazzaniga');
  await p.click(selector('pedala-come-allenamento'));
  await wait(exists('allenamento-riga-risveglio'), 'Allenamento guidato');
  await p.click(selector('allenamento-riga-risveglio'));
  await wait(`document.querySelector('[data-testid=pedala-via]')?.href?.includes('workout=risveglio')`, 'Bersaglio dal piano');
  await p.click(selector('pedala-via'));
  await wait(`document.body.textContent.includes('Cambiare giro?')`, 'Cambio percorso');
  await p.clickText('Salva e cambia giro');
  await wait(`document.querySelector('[data-testid=ride-screen]')?.dataset.ready === 'yes'`, 'Seconda partenza pronta');
  await wait(`document.querySelector('[data-testid=erg-target]')?.textContent.includes('Blocco') && Number(document.querySelector('[data-testid=ride-power]').textContent) > 0`, 'Watt pianificati in salita');
  const preFreeze = await seconds();
  const freezeAt = await p.evaluate('performance.now()');
  await p.s('Page.setWebLifecycleState', { state: 'frozen' });
  try { await sleep(5000); }
  finally { await p.s('Page.setWebLifecycleState', { state: 'active' }); }
  const recovered = await p.waitFor(`(() => {
    const now = document.querySelector('[data-testid=ride-time]').textContent.split(':').reduce((n, f) => n * 60 + Number(f), 0);
    return now >= ${preFreeze + 4} && Math.abs(now - ${preFreeze} - (performance.now() - ${freezeAt}) / 1000) < 1.6;
  })()`, 6000);
  assert.ok(recovered, 'Il cronometro deve recuperare il tempo sospeso');
  await p.click(selector('ride-back'));
  await wait(exists('pause-finish'), 'Pausa');
  await p.click(selector('pause-finish'));
  await wait(`document.querySelector('[data-testid=ride-saved]')?.dataset.state === 'saved'`, 'Giro salvato');
  await p.click(selector('ride-done'));
  await wait(exists('pedala'), 'Uscita dal giro finito');
  assert.equal(await p.evaluate(exists('back-to-live-ride')), false);
  console.log(JSON.stringify({ punto: picked.searchParams.get('s'), watt, before, after }));
} finally {
  await browser.close();
}
