// Le pendenze del mondo, percorso per percorso, da confrontare con le schede online
// (piano OROBIA 07/11, M.5; la tabella sta in docs/pendenze-2026-11.md).
// Uso: node scripts/world/pendenze.mjs [public/world/bergamo]
// Per ogni percorso prende la salita più lunga del profilo (contropendenze fino a 15 m tollerate)
// e ne stampa lunghezza, dislivello, media, massima su 100 m e su 500 m, in Markdown.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? join('public', 'world', 'bergamo');
const graph = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8'));

/** Un arco del grafo come pianta e quota, dai delta in decimetri. */
function edgeOf(id) {
  const coords = graph.edges[id][7];
  const xs = [];
  const zs = [];
  const ys = [];
  let x = 0;
  let z = 0;
  let y = 0;
  for (let k = 0; k < coords.length; k += 3) {
    x += coords[k];
    z += coords[k + 1];
    y += coords[k + 2];
    xs.push(x / 10);
    zs.push(z / 10);
    ys.push(y / 10);
  }
  return { xs, zs, ys };
}

/** Il profilo di un percorso: distanza e quota a ogni vertice della pianta. */
function profile(ride) {
  const ds = [];
  const ys = [];
  let d = 0;
  for (const [id, dir] of ride.legs) {
    const e = edgeOf(id);
    const n = e.xs.length;
    for (let k = 0; k < n; k++) {
      const i = dir > 0 ? k : n - 1 - k;
      if (ds.length) {
        const j = dir > 0 ? k - 1 : n - k;
        if (k > 0) d += Math.hypot(e.xs[i] - e.xs[j], e.zs[i] - e.zs[j]);
        else if (Math.abs(ys[ys.length - 1] - e.ys[i]) < 1e-9) continue;
      }
      ds.push(d);
      ys.push(e.ys[i]);
    }
  }
  return { ds, ys };
}

/** Quota a una distanza qualunque, per interpolazione. */
function sampler({ ds, ys }) {
  return (s) => {
    let lo = 0;
    let hi = ds.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (ds[mid] <= s) lo = mid;
      else hi = mid;
    }
    const u = Math.min(1, Math.max(0, (s - ds[lo]) / (ds[lo + 1] - ds[lo] || 1)));
    return ys[lo] + (ys[lo + 1] - ys[lo]) * u;
  };
}

/** La salita più lunga (per dislivello), tollerando contropendenze di 15 m: da dove a dove. */
function longestClimb(ds, ys) {
  let best = { gain: 0, from: 0, to: 0 };
  let start = 0;
  for (let i = 1; i < ys.length; i++) {
    let top = start;
    for (let k = start; k <= i; k++) if (ys[k] > ys[top]) top = k;
    if (ys[top] - ys[i] > 15) {
      start = i;
      continue;
    }
    const gain = ys[i] - ys[start];
    if (gain > best.gain && ds[i] > ds[start]) best = { gain, from: start, to: i };
    if (ys[i] < ys[start]) start = i;
  }
  return best;
}

function maxOver(at, s0, s1, win) {
  let best = 0;
  for (let s = s0; s + win <= s1; s += 10) best = Math.max(best, (at(s + win) - at(s)) / win);
  return best;
}

const rows = [];
for (const r of rides) {
  const p = profile(r);
  const at = sampler(p);
  // il profilo a 10 m, così la salita più lunga non dipende dalla fittezza dei vertici
  const L = p.ds[p.ds.length - 1];
  const ds = [];
  const ys = [];
  for (let s = 0; s <= L; s += 10) {
    ds.push(s);
    ys.push(at(s));
  }
  const c = longestClimb(ds, ys);
  const s0 = ds[c.from];
  const s1 = ds[c.to];
  const len = s1 - s0;
  const gain = ys[c.to] - ys[c.from];
  rows.push({
    id: r.id,
    name: `${r.name}${r.side ? ` (${r.side})` : ''}`,
    from: Math.round(ys[c.from]),
    to: Math.round(ys[c.to]),
    km: len / 1000,
    gain: Math.round(gain),
    avg: (gain / len) * 100,
    max100: maxOver(at, s0, s1, 100) * 100,
    max500: maxOver(at, s0, s1, 500) * 100,
    startKm: s0 / 1000,
  });
}
console.log('| Percorso | Salita (km) | D+ (m) | Quote | Media | Max 100 m | Max 500 m | Da km |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| \`${r.id}\` ${r.name} | ${r.km.toFixed(1)} | ${r.gain} | ${r.from} → ${r.to} m | ${r.avg.toFixed(1)}% | ${r.max100.toFixed(1)}% | ${r.max500.toFixed(1)}% | ${r.startKm.toFixed(1)} |`);
}

// I tratti che le schede online misurano, quando non coincidono con la salita più lunga:
// [percorso, da km (null = inizio), a km (null = fine), etichetta]
const SEGMENTS = [
  ['selvino', -10.5, null, 'Selvino, gli ultimi 10,5 km (la scheda climbfinder)'],
  ['colle-gallo', -8.1, null, 'Colle Gallo, gli ultimi 8,1 km (climbfinder da Gramelduro)'],
  ['colle-gallo', -5.0, null, 'Colle Gallo, gli ultimi 5 km (bikeclimbs «by Piazza»)'],
  ['presolana', -10.9, null, 'Presolana, gli ultimi 10,9 km (climbfinder da Fino del Monte)'],
  ['zambla-zogno', 2.5, null, 'Zambla da Ambria (climbfinder, SP27)'],
  ['foppolo', -10.9, null, 'Foppolo, gli ultimi 10,9 km (climbfinder da Branzi)'],
  ['citta-alta', -0.75, null, 'San Vigilio, gli ultimi 750 m (climbfinder da Porta Sant’Alessandro)'],
  ['maresana', null, null, 'Maresana da Ponteranica, tutta (bikeclimbs «Crono salita Maresana» 4,16 km)'],
];
console.log('\n| Tratto | km | D+ (m) | Quote | Media | Max 100 m | Max 500 m |');
console.log('|---|---|---|---|---|---|---|');
for (const [id, fromKm, toKm, label] of SEGMENTS) {
  const r = rides.find((x) => x.id === id);
  if (!r) continue;
  const p = profile(r);
  const at = sampler(p);
  const L = p.ds[p.ds.length - 1];
  const s1 = toKm == null ? L : toKm * 1000;
  const s0 = fromKm == null ? 0 : fromKm < 0 ? s1 + fromKm * 1000 : fromKm * 1000;
  const gain = at(s1) - at(s0);
  console.log(`| ${label} | ${((s1 - s0) / 1000).toFixed(1)} | ${Math.round(gain)} | ${Math.round(at(s0))} → ${Math.round(at(s1))} m | ${((gain / (s1 - s0)) * 100).toFixed(1)}% | ${(maxOver(at, s0, s1, 100) * 100).toFixed(1)}% | ${(maxOver(at, s0, s1, 500) * 100).toFixed(1)}% |`);
}
