// Scarica da OpenStreetMap (Overpass) tutto quello che serve a un mondo: strade, vie dei
// paesi, fiumi, laghi, cime, paesi, luoghi notevoli, edifici, ferrovie, mura e uso del suolo;
// per i mondi di montagna anche impianti di risalita, piste da sci, pareti, rifugi, cappelle e
// memoriali. Scrive JSON in scripts/world/cache/<osmDir>/ (fuori dal repo), nello stesso
// formato dell'estratto Geofabrik (extract-pbf.py): i dati del mondo si costruiscono da lì
// con build-world.ts.
//
//   node scripts/world/fetch-osm.mjs                       scarica quello che manca (Bergamo)
//   WORLD=sellaronda node scripts/world/fetch-osm.mjs      il Sellaronda
//   node scripts/world/fetch-osm.mjs --force               riscarica tutto
//   node scripts/world/fetch-osm.mjs buildings             solo i lavori che cominciano così
//
// Le istanze pubbliche di Overpass reggono richieste medie: le divido per tema e, per gli
// edifici e il suolo, in quadrati da 0,1°, con una pausa fra una e l'altra; se una è piena si
// passa alla successiva e si riprova.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY, HORIZON, REGION, WORLD, bbox } from './config.mjs';
import { MONUMENTI_IDS } from './monumenti-ids.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'cache', WORLD.osmDir);
const UA = 'allenando/1.0 (https://github.com/micmer-git/allenando)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const force = process.argv.includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = bbox(REGION);
const C = bbox(CITY);
const H = bbox(HORIZON);
const alpino = !!WORLD.alpino;

const ROAD_CLASSES = 'trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|cycleway';
const CITY_CLASSES = 'residential|living_street|pedestrian|road';

/** @type {{ name: string, q: string, post?: (json: any) => any }[]} */
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
    post: (json) => ({ ...json, elements: [...json.elements.filter((e) => e.type === 'way' && e.tags?.waterway), ...toAreas(json.elements.filter((e) => !e.tags?.waterway))] }),
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
  nwr["tourism"~"^(attraction|viewpoint|museum|alpine_hut|wilderness_hut|artwork)$"]["name"](${R});
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
    post: withCenter,
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

if (alpino) {
  JOBS.push(
    {
      // piloni e stazioni degli impianti: S2 li disegna (le funi stanno già in walls)
      name: 'lifts',
      q: `[out:json][timeout:200];
(
  node["aerialway"~"^(pylon|station)$"](${R});
);
out body qt;`,
    },
    {
      // le piste da sci: radure nel bosco
      name: 'pistes',
      q: `[out:json][timeout:300];
(
  way["piste:type"~"^(downhill|sled)$"](${R});
  relation["piste:type"="downhill"](${R});
);
out body geom qt;`,
    },
    {
      // pareti: una linea di roccia anche dove il DEM a 25 m è morbido
      name: 'cliffs',
      q: `[out:json][timeout:200];
way["natural"="cliff"](${R});
out body geom qt;`,
    },
    {
      // nodi «punto»: semafori, strisce, precedenze, e i luoghi da passare anche senza nome
      name: 'points',
      q: `[out:json][timeout:300];
(
  node["highway"~"^(traffic_signals|crossing|give_way|stop|mini_roundabout)$"](${R});
  node["amenity"~"^(drinking_water|fountain|place_of_worship|cafe|bicycle_repair_station)$"](${R});
  node["tourism"~"^(viewpoint|alpine_hut|wilderness_hut)$"](${R});
  node["historic"~"^(wayside_shrine|wayside_cross|memorial|monument|castle|tower|chapel|church)$"](${R});
  node["man_made"~"^(campanile|tower)$"](${R});
  node["building"~"^(church|chapel|bell_tower|campanile)$"](${R});
  node["shop"="bicycle"](${R});
);
out body qt;`,
    },
    {
      // i monumenti scelti (monumenti-ids.mjs), con la loro geometria, più ossari e sacrari per nome
      name: 'monumenti-nodi',
      q: `[out:json][timeout:200];
(
  ${MONUMENTI_IDS.nodes.length ? `node(id:${MONUMENTI_IDS.nodes.join(',')});` : ''}
  ${MONUMENTI_IDS.ways.length ? `way(id:${MONUMENTI_IDS.ways.join(',')});` : ''}
  ${MONUMENTI_IDS.relations.length ? `relation(id:${MONUMENTI_IDS.relations.join(',')});` : ''}
  nwr["name"~"Soldatenfriedhof|Sacrario|Ossario",i](${R});
  nwr["historic"~"^(memorial|monument)$"]["name"](${R});
);
out body geom qt;`,
      post: (json) => ({
        ...json,
        elements: json.elements.map((e) => {
          if (e.type !== 'relation') return e;
          const a = toAreas([e])[0];
          return { type: 'relation', id: e.id, tags: e.tags, outer: a?.outer ?? [], inner: a?.inner };
        }),
      }),
    },
  );
}

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

const SQUARES = squares(REGION, 0.1);
for (const sq of SQUARES) {
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
    post: (json) => ({ ...json, elements: toAreas(json.elements) }),
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
    post: (json) => ({ ...json, elements: toAreas(json.elements) }),
  });
}

/** Un nodo di Overpass ha lat/lon, una via o relazione `center`: qui tutti hanno `center`, come nell'estratto. */
function withCenter(json) {
  return { ...json, elements: json.elements.map((e) => (e.type === 'node' ? { ...e, center: { lat: e.lat, lon: e.lon } } : e)) };
}

/**
 * Da vie chiuse e relazioni multipoligono (con `out geom`) alle aree dell'estratto:
 * { type: 'area', id, way, tags, outer: [[lon, lat]…][], inner? }. Gli anelli di una relazione
 * si cuciono capo-coda dai suoi membri.
 */
export function toAreas(elements) {
  const out = [];
  for (const e of elements) {
    if (e.type === 'way') {
      const g = e.geometry;
      if (!g || g.length < 4) continue;
      const closed = g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
      if (!closed) continue;
      out.push({ type: 'area', id: e.id, way: true, tags: e.tags ?? {}, outer: [g.map((p) => [p.lon, p.lat])] });
    } else if (e.type === 'relation') {
      const t = e.tags ?? {};
      if (t.type && t.type !== 'multipolygon' && t.type !== 'boundary') continue;
      const pieces = { outer: [], inner: [] };
      for (const m of e.members ?? []) {
        if (m.type !== 'way' || !m.geometry) continue;
        const role = m.role === 'inner' ? 'inner' : 'outer';
        pieces[role].push(m.geometry.map((p) => [p.lon, p.lat]));
      }
      const outer = stitch(pieces.outer);
      if (!outer.length) continue;
      const inner = stitch(pieces.inner);
      out.push({ type: 'area', id: e.id, way: false, tags: t, outer, ...(inner.length ? { inner } : {}) });
    }
  }
  return out;
}

/** Cuce pezzi di linea in anelli chiusi, per gli estremi che coincidono. */
function stitch(parts) {
  const rings = [];
  const left = parts.map((p) => p.slice());
  const key = (p) => `${p[0]},${p[1]}`;
  while (left.length) {
    let ring = left.pop();
    let grew = true;
    while (grew && key(ring[0]) !== key(ring[ring.length - 1])) {
      grew = false;
      const end = key(ring[ring.length - 1]);
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        if (key(p[0]) === end) ring = ring.concat(p.slice(1));
        else if (key(p[p.length - 1]) === end) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

async function overpass(q, tries = 9) {
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

const only = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
{
  for (const job of JOBS) {
    if (only && !job.name.startsWith(only)) continue;
    const file = join(OUT, `${job.name}.json`);
    if (!force && existsSync(file)) continue;
    mkdirSync(dirname(file), { recursive: true });
    const t0 = Date.now();
    process.stdout.write(`${WORLD.id} · ${job.name} …`);
    let json = await overpass(job.q);
    if (job.post) json = job.post(json);
    json.source = `Overpass ${new Date().toISOString().slice(0, 10)}`;
    writeFileSync(file, JSON.stringify(json));
    console.log(` ${json.elements.length} elementi in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await sleep(1500);
  }
  // edifici e suolo in un file solo, come li legge build-world.ts
  for (const name of ['buildings', 'landuse']) {
    if (only && !name.startsWith(only) && !only.startsWith(name)) continue;
    const all = [];
    const seen = new Set();
    for (const sq of SQUARES) {
      const f = join(OUT, name, `${sq.s.toFixed(2)}_${sq.w.toFixed(2)}.json`);
      if (!existsSync(f)) continue;
      for (const e of JSON.parse(readFileSync(f, 'utf8')).elements) {
        const k = `${e.way ? 'w' : 'r'}${e.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(e);
      }
    }
    if (all.length) {
      writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ source: `Overpass ${new Date().toISOString().slice(0, 10)}`, elements: all }));
      console.log(`${name}.json: ${all.length} aree`);
    }
  }
  console.log('fatto');
}
