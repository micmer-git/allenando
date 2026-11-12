import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { insideRing } from '@/open/labels';
import { WorldGraph } from '@/open/graph';
import { WorldPath } from '@/open/path';
import type { RideDef } from '@/open/world';
import { fitRoncalliRoof, roncalliGeometry } from '@/open/palazzoRoncalli';
import type { Building } from '@/open/world';
import type { TileSpec } from '@/open/tiles';

function readBuildingTile(): Building[] {
  const tile = JSON.parse(readFileSync('public/world/bergamo/b/6_20.json', 'utf8')) as {o: [number, number]; b: number[][]};
  return tile.b.map(([kind, h, minH, roof, ...deltas]) => {
    let [x, z] = tile.o;
    const ring = [];
    for (let i = 0; i < deltas.length; i += 2) {
      x += deltas[i] / 10; z += deltas[i + 1] / 10;
      ring.push(x, z);
    }
    return {kind, h: h / 10, minH: minH / 10, roof, ring: new Float32Array(ring)};
  });
}

it('appoggia il fronte fotografato alla parete esportata del palazzo, con la normale rivolta alla piazza', () => {
  const buildings = readBuildingTile();
  const spec: TileSpec = {tx: 0, tz: 0, x0: -11000, z0: 18000, size: 400, spacing: 8, trees: 0, buildings: true, ring: 0};
  const ground = {height: () => 345};
  const fitted = fitRoncalliRoof('bergamo', ground, spec, buildings);
  expect(fitted.filter((b, i) => b !== buildings[i])).toHaveLength(1);
  const geo = roncalliGeometry(ground, spec, fitted)!;
  const front = geo.getAttribute('position');
  expect(Math.hypot(front.getX(0) - front.getX(1), front.getZ(0) - front.getZ(1))).toBeCloseTo(24.06, 1);
  expect(front.getY(0)).toBeCloseTo(344.85, 2);
  expect(front.getY(2)).toBeCloseTo(359.56, 2);
  const normal = geo.getAttribute('normal');
  expect(normal.getX(0)).toBeGreaterThan(0);
  expect(normal.getZ(0)).toBeLessThan(-0.8);
  expect(roncalliGeometry(ground, {...spec, x0: -10400}, fitted)).toBeNull();
  expect(fitRoncalliRoof('sellaronda', ground, spec, buildings)).toBe(buildings);
  geo.dispose();
});


it('lascia il cortile e i veri attraversamenti liberi e appoggia le case della piazza al suolo', () => {
  const buildings = readBuildingTile();
  const at = (x: number, z: number) => buildings.filter(b => insideRing(b.ring, x, z));
  expect(at(-10887.59, 17987.13)).toEqual([]); // cortile interno OSM 32785740
  for (const [x, z] of [
    [-10865.12, 18010.70], [-10901.11, 17948.84], [-10830.63, 17934.01],
    [-10897.78, 17949.56], [-10878.49, 17961.03], [-10907.90, 17957.35], [-10907.23, 17952.18],
  ]) {
    const underpass = at(x, z);
    expect(underpass.length).toBeGreaterThan(0);
    expect(underpass.every(b => b.minH >= 4.3)).toBe(true);
  }
  for (const [x, z] of [[-10874.6, 18055.2], [-10838.8, 18057.1], [-10817.4, 18020.7]]) {
    expect(at(x, z).map(b => b.minH)).toEqual([0]);
  }
});

it('il percorso Città Alta conserva la sezione pedalabile nella piazza', () => {
  const base = 'public/world/bergamo/';
  const graph = new WorldGraph(JSON.parse(readFileSync(base + 'graph.json', 'utf8')));
  const rides: RideDef[] = JSON.parse(readFileSync(base + 'rides.json', 'utf8'));
  const [[edge, dir], ...rest] = rides.find(r => r.id === 'citta-alta')!.legs;
  const path = new WorldPath(graph, {edge, dir, s: dir === 1 ? 0 : graph.edges[edge].length});
  for (const [e, direction] of rest) path.append(e, direction);
  const solid = readBuildingTile().filter(b => b.minH === 0 && b.ring.some((v, i) => i % 2 === 0 && v > -10935 && v < -10775));
  for (let distance = 3380; distance <= 3470; distance++) {
    const p = path.poseAt(distance);
    expect(solid.some(b => insideRing(b.ring, p.x, p.z)), String(distance)).toBe(false);
  }
});
