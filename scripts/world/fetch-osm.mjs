// Scarica da OpenStreetMap (Overpass) tutto quello che serve al mondo di Bergamo:
// strade, vie della città, fiumi, laghi, cime, paesi, luoghi notevoli, edifici, ferrovie,
// mura e uso del suolo. Scrive JSON grezzi in scripts/world/cache/osm/, che è fuori dal repo:
// i dati del mondo si costruiscono da qui con build-world.ts.
//
//   node scripts/world/fetch-osm.mjs           scarica quello che manca
//   node scripts/world/fetch-osm.mjs --force   riscarica tutto
//
// Le istanze pubbliche di Overpass reggono richieste medie: le divido per tema e, per gli
// edifici e il suolo, in quadrati da 0,1°, con una pausa fra una e l'altra.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY, HORIZON, REGION, bbox } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'cache', 'osm');
const UA = 'allenando/1.0 (https://github.com/micmer-git/allenando)';
const ENDPOINTS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const force = process.argv.includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = bbox(REGION);
const C = bbox(CITY);
const H = bbox(HORIZON);

const ROAD_CLASSES = 'trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|cycleway';
const CITY_CLASSES = 'residential|living_street|pedestrian|road';

const JOBS = [
  {
    name: 'roads-main',
    q: `[out:json][timeout:300];
way["highway"~"^(${ROAD_CLASSES})$"](${R});
out body geom qt;`,
  },
  {
    name: 'roads-city',
    q: `[out:json][timeout:300];
way["highway"~"^(${CITY_CLASSES})$"](${C});
out body geom qt;`,
  },
  {
    name: 'water',
    q: `[out:json][timeout:300];
(
  way["waterway"~"^(river|canal)$"](${H});
  way["waterway"="stream"]["name"](${R});
  way["natural"="water"](${R});
  relation["natural"="water"](${R});
);
out body geom qt;`,
  },
  {
    name: 'places',
    q: `[out:json][timeout:200];
(
  node["place"~"^(city|town|village|hamlet|suburb|quarter|neighbourhood|locality|isolated_dwelling)$"]["name"](${H});
);
out body qt;`,
  },
  {
    name: 'peaks',
    q: `[out:json][timeout:200];
(
  node["natural"~"^(peak|saddle|volcano)$"]["name"](${H});
  node["mountain_pass"="yes"]["name"](${H});
);
out body qt;`,
  },
  {
    name: 'pois',
    q: `[out:json][timeout:400];
(
  nwr["historic"]["name"](${R});
  nwr["tourism"~"^(attraction|viewpoint|museum|alpine_hut|artwork)$"]["name"](${R});
  nwr["amenity"~"^(place_of_worship|theatre|townhall|university|hospital|casino|fountain)$"]["name"](${R});
  nwr["building"~"^(church|cathedral|chapel|basilica|tower|castle)$"]["name"](${R});
  nwr["man_made"~"^(tower|bridge|campanile|lighthouse|water_tower)$"]["name"](${R});
  way["bridge"]["name"](${R});
  nwr["leisure"~"^(stadium|park)$"]["name"](${R});
  nwr["railway"~"^(station|halt)$"]["name"](${R});
  nwr["aerialway"="station"]["name"](${R});
  nwr["natural"~"^(waterfall|cave_entrance|spring|cliff|gorge)$"]["name"](${R});
  nwr["waterway"="waterfall"]["name"](${R});
);
out tags center qt;`,
  },
  {
    name: 'walls',
    q: `[out:json][timeout:200];
(
  way["barrier"="city_wall"](${R});
  way["historic"~"^(city_gate|citywalls)$"](${R});
  way["railway"~"^(rail|tram|light_rail|funicular|narrow_gauge)$"](${R});
  way["aerialway"](${R});
);
out body geom qt;`,
  },
];

// edifici e uso del suolo: troppi per una richiesta, si va a quadrati
function squares(b, step) {
  const out = [];
  for (let s = b.s; s < b.n - 1e-9; s += step) {
    for (let w = b.w; w < b.e - 1e-9; w += step) {
      out.push({ s: +s.toFixed(4), w: +w.toFixed(4), n: +Math.min(b.n, s + step).toFixed(4), e: +Math.min(b.e, w + step).toFixed(4) });
    }
  }
  return out;
}

for (const sq of squares(REGION, 0.1)) {
  const box = bbox(sq);
  const tag = `${sq.s.toFixed(2)}_${sq.w.toFixed(2)}`;
  JOBS.push({
    name: `buildings/${tag}`,
    q: `[out:json][timeout:300];
(
  way["building"](${box});
  relation["building"](${box});
);
out body geom qt;`,
  });
  JOBS.push({
    name: `landuse/${tag}`,
    q: `[out:json][timeout:300];
(
  way["landuse"~"^(forest|residential|industrial|commercial|retail|meadow|grass|farmland|orchard|vineyard|quarry|cemetery|construction|allotments|farmyard)$"](${box});
  relation["landuse"~"^(forest|residential|industrial|commercial|retail|meadow|grass|farmland|orchard|vineyard|quarry)$"](${box});
  way["natural"~"^(wood|grassland|heath|scrub|bare_rock|scree|glacier|shingle|fell|water)$"](${box});
  relation["natural"~"^(wood|grassland|heath|scrub|bare_rock|scree|glacier|fell|water)$"](${box});
  way["leisure"~"^(park|pitch|golf_course)$"](${box});
);
out body geom qt;`,
  });
}

async function overpass(q, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const url = ENDPOINTS[i % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: `data=${encodeURIComponent(q)}`,
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith('{')) {
        const json = JSON.parse(text);
        if (json.remark && /runtime error|out of memory|timed out/i.test(json.remark)) throw new Error(json.remark);
        return json;
      }
      throw new Error(`${res.status} ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
    } catch (err) {
      lastErr = err;
      process.stdout.write(` [${url.split('/')[2]}: ${String(err.message ?? err).slice(0, 90)}]`);
      await sleep(4000 * (i + 1));
    }
  }
  throw lastErr;
}

const only = process.argv.find((a) => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]);
for (const job of JOBS) {
  if (only && !job.name.startsWith(only)) continue;
  const file = join(OUT, `${job.name}.json`);
  if (!force && existsSync(file)) continue;
  mkdirSync(dirname(file), { recursive: true });
  const t0 = Date.now();
  process.stdout.write(`${job.name} …`);
  const json = await overpass(job.q);
  writeFileSync(file, JSON.stringify(json));
  console.log(` ${json.elements.length} elementi in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await sleep(1500);
}
console.log('fatto');
