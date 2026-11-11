// Il manifesto di un mondo: public/world/<id>/manifest.json con i file e il loro peso, i km di
// strade e quanti percorsi ha. Lo leggono la scelta del mondo (pagina Mondo, Oggi, onboarding) e
// «Scarica per usarlo senza rete» (src/open/offline.ts). Si rilancia dopo ogni build-world.
// Uso: node scripts/world-manifest.mjs [id…]   (senza argomenti: tutte le cartelle di public/world)
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(process.cwd(), 'public', 'world');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory());

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name !== 'manifest.json') out.push(p);
  }
  return out;
}

for (const id of ids) {
  const dir = join(root, id);
  if (!existsSync(join(dir, 'graph.json'))) {
    console.log(`${id}: niente graph.json, salto`);
    continue;
  }
  const graph = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
  const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8'));
  // la lunghezza di ogni arco: la somma delle distanze fra i vertici (x, z in decimetri delta)
  let roadsM = 0;
  for (const e of graph.edges) {
    const pts = e[7];
    let x = 0;
    let z = 0;
    let px = null;
    let pz = null;
    for (let i = 0; i + 1 < pts.length; i += 3) {
      x += pts[i];
      z += pts[i + 1];
      if (px != null) roadsM += Math.hypot(x - px, z - pz) / 10;
      px = x;
      pz = z;
    }
  }
  const files = walk(dir)
    .map((p) => [relative(dir, p).replace(/\\/g, '/'), statSync(p).size])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const manifest = { id, builtAt: graph.builtAt, files, bytes: files.reduce((s, f) => s + f[1], 0), roadsKm: Math.round(roadsM / 1000), rides: rides.length };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  console.log(`${id}: ${files.length} file, ${(manifest.bytes / 1e6).toFixed(1)} MB, ${manifest.roadsKm} km di strade, ${manifest.rides} percorsi`);
}
