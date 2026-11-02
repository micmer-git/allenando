import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { haversine } from '../src/domain/geo';
import { routeStats, trackFromRouteFile, VERIFIED_ROUTES, type RouteFile } from '../src/domain/routes';
import { createHeightField } from '../src/world/heightfield';

const dir = join(__dirname, '..', 'public', 'routes');

function load(id: string): RouteFile {
  return JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as RouteFile;
}

describe('salite vere nel pacchetto', () => {
  for (const meta of VERIFIED_ROUTES) {
    const file = join(dir, `${meta.id}.json`);
    it(`${meta.id}: il file c'è ed è una traccia OSM con quota DEM`, () => {
      expect(existsSync(file)).toBe(true);
      const data = load(meta.id);
      expect(data.verified).toBe(true);
      expect(data.sources.attribution).toMatch(/OpenStreetMap/);
      expect(data.track.length).toBeGreaterThan(200);
      // nessun salto: i nodi consecutivi di una strada sono vicini
      for (let i = 1; i < data.track.length; i++) {
        const a = { lat: data.track[i - 1][0], lon: data.track[i - 1][1] };
        const b = { lat: data.track[i][0], lon: data.track[i][1] };
        expect(haversine(a, b)).toBeLessThan(400);
      }
      // partenza e arrivo vicini ai punti dichiarati
      const [lon0, lat0] = data.waypoints[0];
      const [lon1, lat1] = data.waypoints[data.waypoints.length - 1];
      expect(haversine({ lat: lat0, lon: lon0 }, { lat: data.track[0][0], lon: data.track[0][1] })).toBeLessThan(150);
      const last = data.track[data.track.length - 1];
      expect(haversine({ lat: lat1, lon: lon1 }, { lat: last[0], lon: last[1] })).toBeLessThan(150);
    });

    it(`${meta.id}: è una salita, con pendenze plausibili e la quota livellata vicina al DEM`, () => {
      const route = trackFromRouteFile(load(meta.id), meta.halfWidth);
      const stats = routeStats(route.track);
      expect(stats.endAlt - stats.startAlt).toBeGreaterThan(400);
      expect(stats.avgGrade).toBeGreaterThan(0.04);
      expect(stats.avgGrade).toBeLessThan(0.16);
      expect(stats.max100Grade).toBeLessThan(0.3);
      // il livellamento non sposta la strada di più di qualche metro dalla quota del DEM
      expect(route.track.maxElevationDelta).toBeLessThan(15);
      expect(stats.hairpins).toBeGreaterThan(3);
    });

    it(`${meta.id}: il terreno copre tutta la strada e le sta sempre sotto`, () => {
      const data = load(meta.id);
      const route = trackFromRouteFile(data, meta.halfWidth);
      const t = data.terrain;
      const field = createHeightField(route.track, data.terrain);
      for (let i = 0; i < route.track.points.length; i += 3) {
        const p = route.track.points[i];
        // dentro la griglia DEM, con margine
        expect(p.x).toBeGreaterThan(t.x0 + 500);
        expect(p.x).toBeLessThan(t.x0 + (t.nx - 1) * t.step - 500);
        expect(p.z).toBeGreaterThan(t.z0 + 500);
        expect(p.z).toBeLessThan(t.z0 + (t.nz - 1) * t.step - 500);
        // al centro e ai bordi della carreggiata il terreno è sotto, ma non troppo
        for (const off of [0, route.track.halfWidth, -route.track.halfWidth]) {
          const x = p.x + Math.cos(p.heading) * off;
          const z = p.z - Math.sin(p.heading) * off;
          const h = field.height(x, z, 8);
          expect(h).toBeLessThan(p.y - 0.2);
          expect(p.y - h).toBeLessThan(8);
        }
      }
    });
  }
});
