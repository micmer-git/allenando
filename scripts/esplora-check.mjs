// Collaudo della preparazione senza un sensore. Con QAOUT salva anche i due viewport.
import assert from 'node:assert/strict';
import { launch } from './cdp.mjs';
import { apri, SENZA_BT } from './flusso-lib.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/allenando';
const browser = await launch({ out: process.env.QAOUT });
try {
  for (const width of [390, 1280, 320]) {
    const mobile = width < 1024;
    const p = await apri(browser, base, {
      width, height: mobile ? 844 : 840, desktop: !mobile, init: width === 320 ? SENZA_BT : '',
    });
    const wait = async expr => assert.ok(await p.waitFor(expr, 45000), expr);
    const pick = id => p.click(`[data-testid="${id}"]`);
    const exists = id => `!!document.querySelector('[data-testid="${id}"]')`;
    await wait(exists('dove-carta'));
    assert.equal(await p.evaluate(exists('pedala-via')), false);
    assert.ok(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'));
    if (process.env.QAOUT) await p.shot('dopo-' + width);
    if (mobile) await pick('esplora-percorsi');
    await wait(exists('dove-riga-foppolo'));
    await pick('dove-riga-foppolo');
    await wait(`document.querySelector('[data-testid=esplora-3d]')?.href.includes('ride=foppolo')`);
    assert.ok(await p.evaluate(`document.querySelector('[data-testid=pedala-destinazione]')?.textContent.includes('Foppolo')`));
    await p.go('/');
    await wait(`document.querySelector('[data-testid=esplora-3d]')?.href.includes('ride=foppolo')`);
    if (width === 390) {
      await pick('esplora-3d');
      await wait(exists('sopralluogo-pedala'));
      await p.clickText('+100 m');
      await wait("new URLSearchParams(location.search).get('punto') === '1'");
      await p.go('/confronto?world=bergamo&ride=foppolo&punto=111');
      await wait(exists('sopralluogo-pedala'));
      const spot = await p.evaluate("document.querySelector('[data-testid=sopralluogo-pedala]').search");
      if (process.env.QAOUT) await p.shot('dopo-foppolo');
      await pick('sopralluogo-pedala');
      await wait(`document.querySelector('[data-testid=pedala-destinazione]')?.textContent.includes('Giro libero')`);
      assert.equal(await p.evaluate(exists('ride-screen')), false);
      await pick('esplora-3d');
      await wait(exists('sopralluogo-pedala'));
      const returned = await p.evaluate("document.querySelector('[data-testid=sopralluogo-pedala]').search");
      for (const field of ['world', 'edge', 'dir', 's']) assert.equal(new URLSearchParams(returned).get(field), new URLSearchParams(spot).get(field));
      await pick('sopralluogo-pedala');
      await wait(exists('dove-libero-mappa'));
      await pick('dove-libero-mappa');
      await wait("!!document.querySelector('[data-testid^=dove-paese-]')");
      await p.click('[data-testid^=dove-paese-]');
      await wait(`!${exists('dove-foglio')}`);
      assert.equal(await p.evaluate(exists('pedala-via')), false);
      await pick('pedala-manuale');
      await wait(`document.querySelector('[data-testid=pedala-via]')?.href.includes('manuale=1')`);
      assert.equal(await p.evaluate(exists('ride-screen')), false);
    }
    console.log(width, 'px · esplorazione e scelta del percorso verificate');
    await p.chiudi();
  }
} finally {
  await browser.close();
}
