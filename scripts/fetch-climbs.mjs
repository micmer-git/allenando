// Scarica la geometria vera delle salite e il terreno intorno.
//
// Strada: percorso su dati OpenStreetMap calcolato da OSRM (routing.openstreetmap.de,
// profilo auto) tra due punti di partenza/arrivo presi dai nodi OSM dei paesi e dei passi.
// Quota: EU-DEM v1.1 a 25 m via l'API pubblica di OpenTopoData (max 100 punti a richiesta,
// 1 richiesta al secondo). Niente Street View, niente tracce di terzi.
//
//   node scripts/fetch-climbs.mjs            tutte le salite
//   node scripts/fetch-climbs.mjs mortirolo-mazzo
//
// Scrive public/routes/<id>.json. I file sono dati, non codice: si rigenerano da qui.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'routes');
const UA = { 'User-Agent': 'allenando/1.0 (https://github.com/micmer-git/allenando)' };
const DEM = 'eudem25m';

// Coordinate [lon, lat] dei nodi OSM (place=* per i paesi, mountain_pass=* per i passi).
const CLIMBS = [
  {
    id: 'selvino-nembro',
    name: 'Selvino',
    side: 'da Nembro',
    region: 'Val Seriana · Bergamo',
    waypoints: [
      [9.7592752, 45.7439737], // Nembro, node place=town
      [9.7516751, 45.7811435], // Selvino, node place=village
    ],
  },
  {
    id: 'mortirolo-mazzo',
    name: 'Mortirolo',
    side: 'da Mazzo di Valtellina',
    region: 'Valtellina · Sondrio',
    waypoints: [
      [10.2553936, 46.2582438], // Mazzo di Valtellina, node place=village
      [10.2983094, 46.2478567], // Passo del Mortirolo, node mountain_pass
    ],
  },
  {
    id: 'stelvio-prato',
    name: 'Stelvio',
    side: 'da Prato allo Stelvio',
    region: 'Val Venosta · Bolzano',
    waypoints: [
      [10.5919, 46.6186], // Prato allo Stelvio, centro paese su SS38
      [10.4532056, 46.5286176], // Passo dello Stelvio, node mountain_pass
    ],
  },
  {
    id: 'stelvio-bormio',
    name: 'Stelvio',
    side: 'da Bormio',
    region: 'Alta Valtellina · Sondrio',
    waypoints: [
      [10.3774659, 46.4676705], // Bormio, node place=town
      [10.4532056, 46.5286176], // Passo dello Stelvio, node mountain_pass
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (err) {
      if (i === tries - 1) throw err;
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`fallito ${url}`);
}

async function route(waypoints) {
  const coords = waypoints.map((p) => p.join(',')).join(';');
  const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
  const json = await getJson(url);
  const r = json.routes?.[0];
  if (!r) throw new Error('nessun percorso');
  const roads = [];
  for (const leg of r.legs) {
    for (const step of leg.steps) {
      const label = [step.name, step.ref].filter(Boolean).join(' · ');
      if (!label || step.distance < 1) continue;
      const last = roads[roads.length - 1];
      if (last && last.label === label) last.m += step.distance;
      else roads.push({ label, m: step.distance });
    }
  }
  const coordsOut = [];
  for (const c of r.geometry.coordinates) {
    const last = coordsOut[coordsOut.length - 1];
    if (last && haversine(last, c) < 0.5) continue;
    coordsOut.push(c);
  }
  return { coords: coordsOut, roads: roads.map((x) => ({ label: x.label, m: Math.round(x.m) })) };
}

async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const loc = chunk.map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join('|');
    const json = await getJson(`https://api.opentopodata.org/v1/${DEM}?locations=${loc}&interpolation=bilinear`);
    for (const r of json.results) out.push(r.elevation);
    process.stdout.write('.');
    await sleep(1100);
  }
  return out;
}

/** Punti equidistanti lungo la polilinea, con la distanza cumulata. */
function resample(coords, step) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let d = 0; d <= total; d += step) {
    while (j < coords.length - 2 && cum[j + 1] < d) j++;
    const u = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const a = coords[j];
    const b = coords[j + 1];
    out.push({ d, p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u] });
  }
  if (out[out.length - 1].d < total - 1) out.push({ d: total, p: coords[coords.length - 1] });
  return { cum, total, out };
}

async function build(climb) {
  console.log(`\n${climb.id}`);
  const { coords, roads } = await route(climb.waypoints);
  await sleep(1100);
  const { cum, total, out } = resample(coords, 20);
  process.stdout.write(`  strada ${(total / 1000).toFixed(2)} km, ${coords.length} nodi, quota su ${out.length} punti `);
  const ele = await elevations(out.map((o) => o.p));
  // quota interpolata sui vertici originali di OSM, per tenere esatti i tornanti
  const track = coords.map((c, i) => {
    const d = cum[i];
    let k = Math.min(out.length - 2, Math.floor(d / 20));
    while (k > 0 && out[k].d > d) k--;
    while (k < out.length - 2 && out[k + 1].d < d) k++;
    const u = Math.min(1, Math.max(0, (d - out[k].d) / (out[k + 1].d - out[k].d || 1)));
    const e = ele[k] + (ele[k + 1] - ele[k]) * u;
    return [+c[1].toFixed(6), +c[0].toFixed(6), +e.toFixed(1)];
  });

  // terreno: griglia regolare in metri locali intorno al percorso
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lon, lat] of coords) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  const lat0 = (minLat + maxLat) / 2;
  const lon0 = (minLon + maxLon) / 2;
  const mLat = (Math.PI / 180) * R;
  const mLon = mLat * Math.cos(rad(lat0));
  const margin = 3000;
  const halfX = ((maxLon - minLon) / 2) * mLon + margin;
  const halfZ = ((maxLat - minLat) / 2) * mLat + margin;
  const area = 4 * halfX * halfZ;
  const step = Math.max(100, Math.ceil(Math.sqrt(area / 9000) / 10) * 10);
  const nx = Math.ceil((2 * halfX) / step) + 1;
  const nz = Math.ceil((2 * halfZ) / step) + 1;
  const x0 = -((nx - 1) * step) / 2;
  const z0 = -((nz - 1) * step) / 2;
  const grid = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step; // z verso sud
      grid.push([lon0 + x / mLon, lat0 - z / mLat]);
    }
  }
  process.stdout.write(`\n  terreno ${nx}×${nz} a ${step} m `);
  const gridEle = await elevations(grid);
  const heights = gridEle.map((e) => (e == null ? null : Math.round(e)));

  const gain = track.reduce((s, p, i) => (i && p[2] > track[i - 1][2] ? s + p[2] - track[i - 1][2] : s), 0);
  console.log(`\n  ${track[0][2]} → ${track[track.length - 1][2]} m, D+ grezzo ${Math.round(gain)} m`);

  const data = {
    id: climb.id,
    name: climb.name,
    side: climb.side,
    region: climb.region,
    verified: true,
    fetchedAt: new Date().toISOString().slice(0, 10),
    sources: {
      road: 'OpenStreetMap, percorso calcolato con OSRM (routing.openstreetmap.de, profilo auto)',
      elevation: 'EU-DEM v1.1 25 m (Copernicus) via OpenTopoData, interpolazione bilineare',
      attribution: '© OpenStreetMap contributors, ODbL 1.0 · EU-DEM © Copernicus Land Monitoring Service',
    },
    waypoints: climb.waypoints,
    roads,
    origin: { lat: lat0, lon: lon0 },
    track,
    terrain: { step, nx, nz, x0, z0, heights },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${climb.id}.json`), JSON.stringify(data));
}

const only = process.argv[2];
for (const climb of CLIMBS) {
  if (only && climb.id !== only) continue;
  await build(climb);
}
