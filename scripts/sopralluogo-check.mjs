// Collaudo su build servita in locale: render WebGL vero e cambio punto, senza rullo/profilo.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
const [base = 'http://127.0.0.1:4199/allenando', out = 'shots'] = process.argv.slice(2);
mkdirSync(out, {recursive: true});
const browser = await launch({out});
try {
  for (const [world, ride, i] of [['sellaronda','pordoi-arabba',78], ['bergamo','citta-alta',14]]) {
    const p = await browser.phone(base, {width:880,height:580});
    await p.s('Page.addScriptToEvaluateOnNewDocument',{source:`window.__glErrors=[];const orig=console.error;console.error=(...args)=>{window.__glErrors.push(args.join(' '));orig.apply(console,args)}`});
    await p.go('/confronto?world='+world+'&ride='+ride+'&punto='+i+'&stats=1');
    assert.ok(await p.waitFor("document.querySelector('canvas') && window.__orobiaStats?.tiles?.nearReady >= 1",90000),'geometria vicina caricata');
    const link = () => p.evaluate("document.querySelector('a[href*=map_action]').href");
    const a = await link();
    assert.ok(a.includes('heading='));
    await p.clickText('+100 m');
    assert.ok(await p.waitFor("new URL(location.href).searchParams.get('punto') === '"+(i+1)+"'"));
    assert.notEqual(await link(),a);
    await p.clickText('−100 m');
    assert.ok(await p.waitFor("new URL(location.href).searchParams.get('punto') === '"+i+"'"));
    assert.equal(await link(),a);
    const near = await p.waitFor("window.__orobiaStats?.tiles?.nearReady >= window.__orobiaStats?.tiles?.near && window.__orobiaStats?.tiles?.detail > 0",90000);
    assert.ok(near, 'strada e arredi vicini pronti');
    assert.ok(await p.evaluate("performance.getEntriesByType('resource').some(r=>r.name.endsWith('paesaggio-2021.webp') && r.responseEnd>0)"));
    await sleep(500);
    const errors = await p.evaluate("window.__glErrors");
    assert.deepEqual([...errors,...p.errors],[]);
    await p.shot(world);
    console.log(world,ride,i*100,await link(),await p.evaluate("window.__orobiaStats?.tiles"));
    await p.chiudi();
  }
} finally { await browser.close(); }
