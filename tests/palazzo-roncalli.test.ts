import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fitRoncalliRoof, roncalliGeometry } from '@/open/palazzoRoncalli';
import type { Building } from '@/open/world';
import type { TileSpec } from '@/open/tiles';

it('appoggia il fronte fotografato alla parete esportata del palazzo, con la normale rivolta alla piazza', () => {
  const tile = JSON.parse(readFileSync('public/world/bergamo/b/6_20.json', 'utf8')) as {o: [number, number]; b: number[][]};
  const buildings: Building[] = tile.b.map(([kind, h, minH, roof, ...deltas]) => {
    let [x, z] = tile.o;
    const ring = [];
    for (let i = 0; i < deltas.length; i += 2) {
      x += deltas[i] / 10; z += deltas[i + 1] / 10;
      ring.push(x, z);
    }
    return {kind, h: h / 10, minH: minH / 10, roof, ring: new Float32Array(ring)};
  });
  const fitted = fitRoncalliRoof('bergamo', 6, 20, buildings);
  expect(fitted.filter((b, i) => b !== buildings[i])).toHaveLength(1);
  const spec: TileSpec = {tx: 0, tz: 0, x0: -11000, z0: 18000, size: 400, spacing: 8, trees: 0, buildings: true, ring: 0};
  const ground = {height: () => 345};
  const geo = roncalliGeometry(ground, spec, fitted)!;
  const front = geo.getAttribute('position');
  expect(Math.hypot(front.getX(0) - front.getX(1), front.getZ(0) - front.getZ(1))).toBeCloseTo(24.06, 1);
  expect(front.getY(0)).toBeCloseTo(344.85, 2);
  expect(front.getY(2)).toBeCloseTo(358.96, 2);
  const normal = geo.getAttribute('normal');
  expect(normal.getX(0)).toBeGreaterThan(0);
  expect(normal.getZ(0)).toBeLessThan(-0.8);
  expect(roncalliGeometry(ground, {...spec, x0: -10400}, fitted)).toBeNull();
  expect(fitRoncalliRoof('sellaronda', 6, 20, buildings)).toBe(buildings);
  geo.dispose();
});
