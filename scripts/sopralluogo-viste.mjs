// Isolated visual inspection. Never starts a ride, logs into Google or touches a leaderboard.
import { launch, sleep } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const [base, out, ...args] = process.argv.slice(2);
if (!base || !out || !args.length) throw Error('node scripts/sopralluogo-viste.mjs <base> <cartella> mondo/percorso/indice ...');
mkdirSync(out,{recursive:true});
const b = await launch({out});
try {
  for (const arg of args) {
    const [world,ride,index] = arg.split('/');
    const p = await b.phone(base,{width:800,height:550,isolato:true});
    try {
      await p.s('Page.addScriptToEvaluateOnNewDocument', {source:`window.__orobiaIssues=[]; const c=console.error; console.error=(...a)=>{window.__orobiaIssues.push(a.map(String).join(' '));c.apply(console,a)}`});
      const t = Date.now();
      await p.go('/confronto?world='+world+'&ride='+ride+'&punto='+index+'&stats=1');
      const ok = await p.waitFor("window.__orobiaStats?.tiles?.near>0 && window.__orobiaStats.tiles.nearReady===window.__orobiaStats.tiles.near",120000);
      assert.ok(ok,'caricamento '+arg);
      const readyMs=Date.now()-t;
      await p.evaluate("window.__orobiaStatsReset?.()");
      await sleep(3000);
      const measurements=await p.evaluate("({stats:window.__orobiaStats, errors:window.__orobiaIssues, resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/ortofoto-v1/')||r.name.includes('/ganda-')).map(r=>new URL(r.name).pathname)})");
      assert.deepEqual([...p.errors,...measurements.errors],[]);
      const name = world+'-'+ride+'-'+index;
      await p.shot(name);
      writeFileSync(join(out,name+'.json'),JSON.stringify({readyMs,...measurements},null,2));
      console.log(name,readyMs+' ms',measurements.stats?.frameP50+' ms/frame',measurements.stats?.tiles,measurements.resources.length+' assets');
    } finally { await p.chiudi(); }
  }
} finally { await b.close(); }
