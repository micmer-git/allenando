// Statistiche calcolate dalle tracce in public/routes: npx vite-node scripts/route-stats.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeStats, trackFromRouteFile, VERIFIED_ROUTES, type RouteFile } from '../src/domain/routes';

for (const meta of VERIFIED_ROUTES) {
  const file = join(process.cwd(), 'public', 'routes', `${meta.id}.json`);
  if (!existsSync(file)) {
    console.log(`${meta.id}: manca`);
    continue;
  }
  const data = JSON.parse(readFileSync(file, 'utf8')) as RouteFile;
  const route = trackFromRouteFile(data, meta.halfWidth);
  const s = routeStats(route.track);
  console.log(
    `${meta.id}: ${(s.lengthM / 1000).toFixed(2)} km, ${Math.round(s.startAlt)} → ${Math.round(s.endAlt)} m, D+ ${Math.round(s.gainM)} m, ` +
      `media ${(s.avgGrade * 100).toFixed(1)}%, km più duro ${(s.maxKmGrade * 100).toFixed(1)}%, max 100 m ${(s.max100Grade * 100).toFixed(1)}%, ` +
      `tornanti ${s.hairpins}, scarto quota ${route.track.maxElevationDelta.toFixed(1)} m, terreno ${data.terrain.nx}×${data.terrain.nz}@${data.terrain.step} m`,
  );
  console.log(`   strade: ${data.roads.map((r) => r.label).join(' › ')}`);
}
