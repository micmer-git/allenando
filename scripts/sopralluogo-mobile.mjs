// Guest flow at a phone's width: open a Ganda reference, step 100 m, then visit a mural.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch} from './cdp.mjs';
const [base,out]=process.argv.slice(2);
mkdirSync(out,{recursive:true});
const browser=await launch({out});
try {
  const page=await browser.phone(base,{width:390,height:844,isolato:true});
  try {
    await page.go('/confronto/?world=bergamo&ride=ganda&punto=193');
    const ready=await page.waitFor("!!document.querySelector('button[aria-expanded]')",35000);
    if (!ready) console.log(await page.evaluate("({url:location.href,body:document.body.innerText.slice(-1250), buttons:[...document.querySelectorAll('button')].map(b=>b.textContent),imgs:[...document.images].map(i=>i.src),files:performance.getEntriesByType('resource').filter(e=>e.name.includes('atlante')).map(e=>e.name)})"),page.errors);
    assert.ok(ready,'foto al passo di Ganda');
    await page.evaluate("document.querySelector('button[aria-expanded]').click()");
    assert.ok(await page.waitFor("Array.from(document.querySelectorAll('figure img')).some(img=>img.complete && img.naturalWidth>0)",35000));
    assert.ok(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"));
    const first=await page.evaluate("document.querySelector('a[href*=map_action]').href");
    await page.clickText('+100 m');
    assert.ok(await page.waitFor("new URL(location.href).searchParams.get('punto')==='194'"));
    assert.notEqual(await page.evaluate("document.querySelector('a[href*=map_action]').href"),first);
    await page.evaluate(`const sel=document.querySelector('select[aria-label="Luogo lungo il percorso"]'); sel.value='lonno-murales'; sel.dispatchEvent(new Event('change',{bubbles:true}));`);
    assert.ok(await page.waitFor("new URL(location.href).searchParams.get('luogo')==='lonno-murales' && document.body.innerText.includes('sedici soggetti')"));
    assert.ok(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"));
    assert.deepEqual(page.errors,[]);
    console.log('390px · foto Ganda, controlli 100 m, direzione Street View, murale di Lonno: OK');
  } finally { await page.chiudi(); }
} finally { await browser.close(); }

