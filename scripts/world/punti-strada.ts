// vite-node scripts/world/punti-strada.ts <mondo> <estratto di punti-osm.py>
import { readFileSync, writeFileSync } from 'node:fs';
import { WorldGraph, FLAG } from '../../src/open/graph';
const [id, path] = process.argv.slice(-2);
if (!['bergamo', 'sellaronda'].includes(id) || !path) throw Error('mondo ed estratto richiesti');
const base = 'public/world/' + id + '/';
const graph = new WorldGraph(JSON.parse(readFileSync(base + 'graph.json', 'utf8')));
type Row = [number, number, 'lamp' | 'spruce' | 'broadleaf', number];
const input: Row[] = JSON.parse(readFileSync(path, 'utf8'));
const result: Row[] = [];
for (const row of input) {
  const [x, z, kind] = row;
  const hit = graph.nearest(x, z, kind === 'lamp' ? 22 : 65, e => !(e.flags & FLAG.tunnel));
  if (hit && hit.d >= graph.edges[hit.edge].hw + 0.2) result.push(row);
}
if (!result.length) throw Error('Nessun punto vicino alle strade');
result.sort((a,b) => a[1]-b[1] || a[0]-b[0]);
writeFileSync(base + 'punti-strada-v1.json', JSON.stringify(result));
console.log(id, result.filter(p => p[2] === 'lamp').length, 'lampioni;', result.filter(p => p[2] !== 'lamp').length, 'alberi');
