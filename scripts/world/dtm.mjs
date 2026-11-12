// I modelli del terreno fini delle province, per i mondi che li hanno (oggi il Sellaronda).
//
//   WORLD=sellaronda node scripts/world/dtm.mjs   scarica (una volta) e mette in cache
//
// Il Sellaronda sta a cavallo di tre province, e ognuna ha il suo rilievo LiDAR:
//
// - Alto Adige: «DTM 2,5 m» della Provincia autonoma di Bolzano (LiDAR), CC0 1.0, dal WCS
//   https://geoservices9.civis.bz.it/geoserver/ows (coverage p_bz-Elevation__DigitalTerrainModel-2.5m).
//   Si chiede il riquadro di 2 km che serve, compresso (Deflate), alla risoluzione nativa.
// - Trentino: «LiDAR PAT 2006/2008», DTM a 1 m in tavole da 2 km, CC BY 4.0, dal portale STEM
//   della Provincia autonoma di Trento (https://siat.provincia.tn.it/stem/): l'indice delle tavole
//   dal WFS stem:inqlid2009_dtm_asc, il file dal servizio di scarico del portale. Una tavola alla
//   volta: si scarica (10 MB), si ricampiona a 5 m e il grezzo si butta subito.
// - Veneto: il DTM LiDAR a 5 m della Regione esiste (quadro d'unione r_veneto:c0101071_Lidar5m,
//   licenza IODL 2.0) ma non ha un servizio di scarico aperto (il WCS dell'IDT2 è spento, il DTM
//   si consegna su richiesta): lì resta EU-DEM. Arabba, Livinallongo e il versante sud della
//   Marmolada non hanno il rilievo fine (KNOWN_LIMITATIONS.md).
//
// In cache (scripts/world/cache/dtm-<mondo>/<fonte>/E_N.bin) ogni riquadro di 2 km in UTM 32N
// (EPSG:25832, ETRS89) diventa una griglia di 400 × 400 celle da 5 m (la media della cella, in
// decimetri, Uint16, 0 = nessun dato) più le cime (`.json`): i punti più alti entro 30 m, presi
// dal dato alla risoluzione nativa, perché la media a 5 m non mangi la punta di una torre.

import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateRawSync, inflateSync } from 'node:zlib';
import { readTiff } from './tiff.mjs';
import { toUtm } from './utm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Il riquadro di cache: 2 km in UTM, celle da 5 m. */
export const CHUNK = 2000;
export const CELL = 5;
const SIDE = CHUNK / CELL;

/** Le fonti, nell'ordine in cui si preferiscono dove si sovrappongono. */
export const FONTI = {
  bz: {
    id: 'bz',
    nome: 'Provincia autonoma di Bolzano – Alto Adige',
    dato: 'DTM 2,5 m (LiDAR)',
    licenza: 'CC0 1.0',
    attribuzione: 'DTM 2,5 m © Provincia autonoma di Bolzano – Alto Adige, CC0 1.0',
  },
  tn: {
    id: 'tn',
    nome: 'Provincia autonoma di Trento',
    dato: 'LiDAR PAT 2006/2008, DTM 1 m',
    licenza: 'CC BY 4.0',
    attribuzione: 'LiDAR PAT 2006/2008 © Provincia autonoma di Trento, CC BY 4.0',
  },
};

/** Il riquadro in UTM che copre un riquadro lat/lon, allargato di `margin` metri e allineato ai 2 km. */
export function utmBox(b, margin = 1000) {
  const pts = [
    [b.s, b.w],
    [b.s, b.e],
    [b.n, b.w],
    [b.n, b.e],
  ].map(([lat, lon]) => toUtm(lat, lon));
  const e0 = Math.floor((Math.min(...pts.map((p) => p[0])) - margin) / CHUNK) * CHUNK;
  const e1 = Math.ceil((Math.max(...pts.map((p) => p[0])) + margin) / CHUNK) * CHUNK;
  const n0 = Math.floor((Math.min(...pts.map((p) => p[1])) - margin) / CHUNK) * CHUNK;
  const n1 = Math.ceil((Math.max(...pts.map((p) => p[1])) + margin) / CHUNK) * CHUNK;
  return { e0, e1, n0, n1 };
}

// ---------- la riduzione a 5 m ----------

/**
 * Da una griglia sorgente (x0, y0 angolo in alto a sinistra, passo d) alle celle da 5 m del
 * riquadro (E, N angolo in basso a sinistra): media e massimo, con la posizione del massimo.
 */
function reduce(src, E, N) {
  const sum = new Float64Array(SIDE * SIDE);
  const cnt = new Uint16Array(SIDE * SIDE);
  const mx = new Float32Array(SIDE * SIDE).fill(-Infinity);
  const mxAt = new Float64Array(SIDE * SIDE * 2);
  const { width, height, data, x0, y0, dx, dy, nodata } = src;
  for (let r = 0; r < height; r++) {
    const y = y0 - (r + 0.5) * dy;
    const j = Math.floor((N + CHUNK - y) / CELL);
    if (j < 0 || j >= SIDE) continue;
    for (let c = 0; c < width; c++) {
      const v = data[r * width + c];
      if (!(v > -500) || v === nodata || v > 9000) continue;
      const x = x0 + (c + 0.5) * dx;
      const i = Math.floor((x - E) / CELL);
      if (i < 0 || i >= SIDE) continue;
      const k = j * SIDE + i;
      sum[k] += v;
      cnt[k]++;
      if (v > mx[k]) {
        mx[k] = v;
        mxAt[k * 2] = x;
        mxAt[k * 2 + 1] = y;
      }
    }
  }
  const mean = new Uint16Array(SIDE * SIDE);
  let filled = 0;
  for (let k = 0; k < mean.length; k++) {
    if (cnt[k] === 0) continue;
    mean[k] = Math.max(1, Math.min(65535, Math.round((sum[k] / cnt[k]) * 10)));
    filled++;
  }
  return { mean, mx, mxAt, filled };
}

/**
 * Le cime del riquadro: le celle il cui massimo è il più alto entro 30 m (6 celle) e che stanno
 * almeno 12 m sopra il punto più basso di quel cerchio (una torre, un dente, una cima; non un
 * dosso del prato). Il punto preciso è quello del pixel più alto del dato nativo.
 */
function summits(red) {
  const R = 6;
  const out = [];
  const { mx, mxAt } = red;
  for (let j = 0; j < SIDE; j++) {
    for (let i = 0; i < SIDE; i++) {
      const v = mx[j * SIDE + i];
      if (!Number.isFinite(v)) continue;
      let top = true;
      let lo = v;
      for (let dj = -R; dj <= R && top; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= SIDE) continue;
        for (let di = -R; di <= R; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= SIDE || di * di + dj * dj > R * R) continue;
          const w = mx[jj * SIDE + ii];
          if (!Number.isFinite(w)) continue;
          // a pari quota vince la cella prima (niente doppioni sui pianori)
          if (w > v || (w === v && jj * SIDE + ii < j * SIDE + i)) {
            top = false;
            break;
          }
          if (w < lo) lo = w;
        }
      }
      if (top && v - lo >= 12) out.push([Math.round(mxAt[(j * SIDE + i) * 2] * 10) / 10, Math.round(mxAt[(j * SIDE + i) * 2 + 1] * 10) / 10, Math.round(v * 10) / 10]);
    }
  }
  return out;
}

function save(dir, E, N, red) {
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${E}_${N}`);
  writeFileSync(`${base}.bin`, deflateSync(Buffer.from(red.mean.buffer), { level: 9 }));
  writeFileSync(`${base}.json`, JSON.stringify({ filled: red.filled / (SIDE * SIDE), summits: red.filled ? summits(red) : [] }));
}

// ---------- lo spazio sul disco ----------

/** Il disco ha 2 GB scarsi: sotto 1,5 GB liberi ci si ferma (regola della pista S3). */
function checkDisk(dir) {
  const s = statfsSync(dir);
  const free = (s.bavail * s.bsize) / 1e9;
  if (free < 1.5) throw new Error(`disco quasi pieno: ${free.toFixed(2)} GB liberi, mi fermo`);
  return free;
}

async function fetchRetry(url, init, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': 'allenando/1.0 (OROBIA, rilievo del Sellaronda)', ...(init?.headers ?? {}) } });
      if (res.status === 429) {
        // il portale del Trentino rallenta chi chiede troppo: si aspetta, e non conta come guasto
        last = new Error('429 Too Many Requests');
        await sleep(45000 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res;
    } catch (err) {
      last = err;
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error(`${url.slice(0, 120)}…: ${last}`);
}

// ---------- Alto Adige: WCS ----------

const BZ_WCS = 'https://geoservices9.civis.bz.it/geoserver/ows';

async function fetchBz(dir, E, N) {
  const url = `${BZ_WCS}?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=p_bz-Elevation__DigitalTerrainModel-2.5m&subset=E(${E},${E + CHUNK})&subset=N(${N},${N + CHUNK})&format=image/tiff;application=geotiff&geotiff:compression=Deflate`;
  const res = await fetchRetry(url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] !== 0x4d && buf[0] !== 0x49) throw new Error(`il WCS non ha risposto con un TIFF: ${buf.toString('latin1', 0, 200)}`);
  const red = reduce(readTiff(buf), E, N);
  save(dir, E, N, red);
  return { bytes: buf.length, filled: red.filled / (SIDE * SIDE) };
}

// ---------- Trentino: le tavole del portale STEM ----------

const TN_WFS = 'https://siat.provincia.tn.it/geoserver/stem/wfs';
const TN_STEM = 'https://siat.provincia.tn.it/stem/services';

async function tnIndex(box) {
  const url = `${TN_WFS}?service=WFS&version=1.1.0&request=GetFeature&typeName=stem:inqlid2009_dtm_asc&outputFormat=application/json&srsName=EPSG:25832&bbox=${box.e0},${box.n0},${box.e1},${box.n1},EPSG:25832`;
  const res = await fetchRetry(url);
  const fc = await res.json();
  return fc.features.map((f) => {
    const ring = f.geometry.coordinates.flat(2);
    const xs = [];
    const ys = [];
    for (let i = 0; i < ring.length; i += 2) {
      xs.push(ring[i]);
      ys.push(ring[i + 1]);
    }
    return { E: Math.round(Math.min(...xs) / 10) * 10, N: Math.round(Math.min(...ys) / 10) * 10, location: f.properties.location };
  });
}

/** Le voci di uno zip (solo quello che serve: stored o deflate, niente zip64). */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip senza indice');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lName = buf.readUInt16LE(local + 26);
    const lExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + lName + lExtra;
    const raw = buf.subarray(start, start + size);
    out.push({ name, data: () => (method === 0 ? raw : inflateRawSync(raw)) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

/** Una griglia ASCII di ESRI (ncols, nrows, xllcorner…, poi i valori dal nord). */
export function readAsc(buf) {
  let p = 0;
  const head = {};
  for (let line = 0; line < 6; line++) {
    const end = buf.indexOf(10, p);
    const [k, v] = buf.toString('latin1', p, end).trim().split(/\s+/);
    head[k.toLowerCase()] = Number(v);
    p = end + 1;
  }
  const w = head.ncols;
  const h = head.nrows;
  const d = head.cellsize;
  const data = new Float32Array(w * h);
  let k = 0;
  const len = buf.length;
  while (k < w * h && p < len) {
    let c = buf[p];
    while (c === 32 || c === 10 || c === 13 || c === 9) c = buf[++p];
    if (p >= len) break;
    let neg = false;
    if (c === 45) {
      neg = true;
      c = buf[++p];
    }
    let v = 0;
    while (c >= 48 && c <= 57) {
      v = v * 10 + (c - 48);
      c = buf[++p];
    }
    if (c === 46) {
      c = buf[++p];
      let f = 0.1;
      while (c >= 48 && c <= 57) {
        v += (c - 48) * f;
        f *= 0.1;
        c = buf[++p];
      }
    }
    data[k++] = neg ? -v : v;
  }
  const x0 = head.xllcorner ?? head.xllcenter - d / 2;
  const yll = head.yllcorner ?? head.yllcenter - d / 2;
  return { width: w, height: h, data, x0, y0: yll + h * d, dx: d, dy: d, nodata: head.nodata_value ?? -9999 };
}

async function fetchTn(dir, E, N, location) {
  const res = await fetchRetry(`${TN_STEM}/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [location] }) });
  const job = await res.json();
  if (!job.success) throw new Error(`STEM: ${JSON.stringify(job).slice(0, 200)}`);
  for (let i = 0; i < 60; i++) {
    const info = await (await fetchRetry(`${TN_STEM}/file/info?id=${job.id}&token=${job.token}`)).json();
    if (info.state) break;
    await sleep(3000);
  }
  const buf = Buffer.from(await (await fetchRetry(`${TN_STEM}/file?id=${job.id}&token=${job.token}`)).arrayBuffer());
  // lo zip del portale contiene lo zip della tavola, che contiene la griglia ASCII
  const inner = unzip(buf).find((e) => /\.zip$/i.test(e.name));
  const asc = inner ? unzip(inner.data()).find((e) => /\.asc$/i.test(e.name)) : unzip(buf).find((e) => /\.asc$/i.test(e.name));
  if (!asc) throw new Error('nella tavola non c’è la griglia');
  const red = reduce(readAsc(asc.data()), E, N);
  save(dir, E, N, red);
  return { bytes: buf.length, filled: red.filled / (SIDE * SIDE) };
}

// ---------- lo scarico ----------

export async function download(world) {
  const dir = join(HERE, 'cache', `dtm-${world.id}`);
  mkdirSync(dir, { recursive: true });
  const box = utmBox(world.fine.box ?? world.region, world.fine.margin ?? 1000);
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  log(`riquadro UTM ${box.e0}-${box.e1} E, ${box.n0}-${box.n1} N, ${((box.e1 - box.e0) / CHUNK) * ((box.n1 - box.n0) / CHUNK)} riquadri da 2 km; ${checkDisk(dir).toFixed(2)} GB liberi`);
  const bzCover = new Map();
  if (world.fine.sources.includes('bz')) {
    let bytes = 0;
    let fails = 0;
    for (let N = box.n0; N < box.n1; N += CHUNK) {
      for (let E = box.e0; E < box.e1; E += CHUNK) {
        const meta = join(dir, 'bz', `${E}_${N}.json`);
        if (existsSync(meta)) {
          bzCover.set(`${E}_${N}`, JSON.parse(readFileSync(meta, 'utf8')).filled);
          continue;
        }
        checkDisk(dir);
        try {
          const r = await fetchBz(join(dir, 'bz'), E, N);
          bytes += r.bytes;
          bzCover.set(`${E}_${N}`, r.filled);
          log(`bz ${E}_${N}: ${(r.bytes / 1e6).toFixed(1)} MB, ${(r.filled * 100).toFixed(0)}% coperto`);
        } catch (err) {
          fails++;
          log(`bz ${E}_${N}: NON RISPONDE (${err.message})`);
          if (fails >= 3) throw new Error('il WCS dell’Alto Adige non risponde: tre riquadri falliti di fila');
        }
      }
    }
    log(`Alto Adige: ${(bytes / 1e6).toFixed(0)} MB scaricati`);
  }
  if (world.fine.sources.includes('tn')) {
    const index = await tnIndex(box);
    log(`Trentino: ${index.length} tavole LiDAR 2006/2008 nel riquadro`);
    let fails = 0;
    for (const t of index) {
      // la tavola ha il nucleo di 2 km allineato alla griglia: E, N è l'angolo in basso a sinistra
      const E = Math.round(t.E / CHUNK) * CHUNK;
      const N = Math.round(t.N / CHUNK) * CHUNK;
      if (E < box.e0 || E >= box.e1 || N < box.n0 || N >= box.n1) continue;
      if ((bzCover.get(`${E}_${N}`) ?? 0) > 0.995) continue;
      if (existsSync(join(dir, 'tn', `${E}_${N}.json`))) continue;
      checkDisk(dir);
      try {
        const r = await fetchTn(join(dir, 'tn'), E, N, t.location);
        log(`tn ${E}_${N}: ${(r.bytes / 1e6).toFixed(1)} MB, ${(r.filled * 100).toFixed(0)}% coperto`);
        fails = 0;
        // una tavola ogni 15 s: oltre, il portale risponde 429
        await sleep(15000);
      } catch (err) {
        fails++;
        log(`tn ${E}_${N}: NON RISPONDE (${err.message})`);
        if (fails >= 3) throw new Error('il portale STEM del Trentino non risponde: tre tavole fallite');
      }
    }
  }
}

// ---------- il passaggio dal fine al grosso ----------

/**
 * Il terreno unito, dal LiDAR delle province a EU-DEM senza gradini (fra i due modelli, su una cresta,
 * ci sono anche 100-150 m: la Punta Penia è 3343 nel LiDAR, 3200 in EU-DEM). Il dato fine vale fino
 * al suo bordo, così una cima sul confine provinciale (Punta Penia, Piz Boè) resta alla sua quota:
 *
 * - su una griglia a passo `S` (il riquadro `box` in metri locali) si misura lo scarto fine − grosso
 *   dove c'è il dato fine, e lo si allunga fuori per diffusione (la media dei vicini noti, un passo
 *   alla volta); poi lo si liscia (due medie mobili di 5 nodi per verso): è lo scarto «di fondo»;
 * - dentro, a più di `inner` metri dal bordo, vale il fine; verso il bordo il fine passa allo scarto
 *   di fondo sopra EU-DEM;
 * - fuori, EU-DEM più lo scarto di fondo, che si spegne in `outer` metri.
 *
 * Al bordo i due lati danno la stessa quota (EU-DEM più lo scarto di fondo): niente gradino.
 * `fineAt(x, z)` e `coarseAt(x, z)`: le due quote nel punto (NaN dove il fine manca).
 * Ritorna `height(x, z)` e `inner(x, z)` (quanto conta il fine, 0-1: per le cime e le mattonelle).
 */
export function fineBlender(fineAt, coarseAt, box, S, inner = 60, outer = 250) {
  const W = Math.ceil((box.x1 - box.x0) / S) + 1;
  const H = Math.ceil((box.z1 - box.z0) / S) + 1;
  const N = W * H;
  const valid = new Uint8Array(N);
  const delta = new Float32Array(N);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = box.x0 + i * S;
      const z = box.z0 + j * S;
      const f = fineAt(x, z);
      if (!Number.isFinite(f)) continue;
      const c = coarseAt(x, z);
      if (!Number.isFinite(c)) continue;
      valid[j * W + i] = 1;
      delta[j * W + i] = f - c;
    }
  // le due distanze (dentro: dal primo buco; fuori: dal primo dato), chamfer in due passate
  const chamfer = (seed) => {
    const d = new Float32Array(N);
    for (let k = 0; k < N; k++) d[k] = seed(k) ? 0 : 1e9;
    const D2 = S * Math.SQRT2;
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (i > 0) d[k] = Math.min(d[k], d[k - 1] + S);
        if (j > 0) d[k] = Math.min(d[k], d[k - W] + S, i > 0 ? d[k - W - 1] + D2 : 1e9, i < W - 1 ? d[k - W + 1] + D2 : 1e9);
      }
    for (let j = H - 1; j >= 0; j--)
      for (let i = W - 1; i >= 0; i--) {
        const k = j * W + i;
        if (i < W - 1) d[k] = Math.min(d[k], d[k + 1] + S);
        if (j < H - 1) d[k] = Math.min(d[k], d[k + W] + S, i < W - 1 ? d[k + W + 1] + D2 : 1e9, i > 0 ? d[k + W - 1] + D2 : 1e9);
      }
    return d;
  };
  const dIn = chamfer((k) => !valid[k]);
  const dOut = chamfer((k) => valid[k] === 1);
  // lo scarto allungato fuori: si diffonde nei nodi senza dato, fin dove serve (outer più un margine)
  const reach = Math.ceil((outer + 3 * S) / S);
  const ext = delta.slice();
  const known = valid.slice();
  for (let it = 0; it < reach; it++) {
    const next = [];
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (known[k]) continue;
        let sum = 0;
        let cnt = 0;
        if (i > 0 && known[k - 1]) {
          sum += ext[k - 1];
          cnt++;
        }
        if (i < W - 1 && known[k + 1]) {
          sum += ext[k + 1];
          cnt++;
        }
        if (j > 0 && known[k - W]) {
          sum += ext[k - W];
          cnt++;
        }
        if (j < H - 1 && known[k + W]) {
          sum += ext[k + W];
          cnt++;
        }
        if (cnt) next.push(k, sum / cnt);
      }
    if (!next.length) break;
    for (let q = 0; q < next.length; q += 2) {
      ext[next[q]] = next[q + 1];
      known[next[q]] = 1;
    }
  }
  // lo scarto di fondo: medie mobili di 5 nodi, solo fra nodi noti
  const blur = (src, along) => {
    const out = new Float32Array(N);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (!known[k]) continue;
        let sum = 0;
        let cnt = 0;
        for (let d = -2; d <= 2; d++) {
          const ii = along ? i + d : i;
          const jj = along ? j : j + d;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const kk = jj * W + ii;
          if (!known[kk]) continue;
          sum += src[kk];
          cnt++;
        }
        out[k] = sum / cnt;
      }
    return out;
  };
  const low = blur(blur(blur(blur(ext, true), false), true), false);
  const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const bil = (arr, x, z) => {
    const fx = (x - box.x0) / S;
    const fz = (z - box.z0) / S;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= W - 1 || j >= H - 1) return NaN;
    const u = fx - i;
    const v = fz - j;
    const k = j * W + i;
    return arr[k] * (1 - u) * (1 - v) + arr[k + 1] * u * (1 - v) + arr[k + W] * (1 - u) * v + arr[k + W + 1] * u * v;
  };
  const innerAt = (x, z) => {
    const d = bil(dIn, x, z);
    // il primo passo dal buco è ancora di fondo: il bilineare della griglia lì pesca il buco
    return Number.isFinite(d) ? sm((d - S) / inner) : 0;
  };
  return {
    inner: innerAt,
    height(x, z) {
      const c = coarseAt(x, z);
      const dOutHere = bil(dOut, x, z);
      if (!Number.isFinite(dOutHere) || dOutHere > outer + S) return c;
      const base = bil(low, x, z);
      const lowHere = Number.isFinite(base) ? base : 0;
      const f = fineAt(x, z);
      const w = Number.isFinite(f) ? innerAt(x, z) : 0;
      if (w > 0) return c + lowHere + w * (f - c - lowHere);
      // fuori (o sul filo): EU-DEM più lo scarto di fondo, che si spegne in `outer` metri
      return c + lowHere * (1 - sm(dOutHere / outer));
    },
  };
}

// ---------- la lettura, per il build ----------

/**
 * Il terreno fine di un mondo, dalla cache: `sample(lat, lon)` (metri, NaN dove nessuna provincia
 * ha il dato), `summits` (le cime in UTM) e `sources` (quali fonti hanno dato qualcosa).
 */
export function loadFine(world) {
  if (!world.fine) return null;
  const dir = join(HERE, 'cache', `dtm-${world.id}`);
  if (!existsSync(dir)) return null;
  const box = utmBox(world.fine.box ?? world.region, world.fine.margin ?? 1000);
  const cols = (box.e1 - box.e0) / CHUNK;
  const rows = (box.n1 - box.n0) / CHUNK;
  /** la griglia unita a 5 m, righe dal sud: Float32, NaN dove non c'è niente */
  const W = cols * SIDE;
  const H = rows * SIDE;
  const grid = new Float32Array(W * H).fill(NaN);
  const src = new Uint8Array(W * H);
  const summitsAll = [];
  const used = new Set();
  // prima la fonte che si preferisce: le altre riempiono solo i buchi
  for (const [si, id] of world.fine.sources.entries()) {
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const E = box.e0 + cx * CHUNK;
        const N = box.n0 + cy * CHUNK;
        const f = join(dir, id, `${E}_${N}.bin`);
        if (!existsSync(f)) continue;
        const mean = new Uint16Array(new Uint8Array(inflateSync(readFileSync(f))).buffer);
        const meta = JSON.parse(readFileSync(join(dir, id, `${E}_${N}.json`), 'utf8'));
        if (meta.filled > 0) used.add(id);
        for (const s of meta.summits) summitsAll.push({ E: s[0], N: s[1], h: s[2], src: id });
        for (let j = 0; j < SIDE; j++) {
          // nel file le righe vanno dal nord
          const gy = cy * SIDE + (SIDE - 1 - j);
          for (let i = 0; i < SIDE; i++) {
            const v = mean[j * SIDE + i];
            if (!v) continue;
            const k = gy * W + cx * SIDE + i;
            if (Number.isFinite(grid[k])) continue;
            grid[k] = v / 10;
            src[k] = si + 1;
          }
        }
      }
    }
  }
  if (!used.size) return null;
  // centro della cella (0, 0): l'angolo in basso a sinistra più mezza cella
  const ex = box.e0 + CELL / 2;
  const ny = box.n0 + CELL / 2;
  const cell = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? NaN : grid[j * W + i]);
  return {
    box,
    sources: [...used],
    summits: summitsAll,
    /** quota a (E, N), bilineare; NaN se manca anche uno dei quattro vertici */
    sampleUtm(E, N) {
      const fx = (E - ex) / CELL;
      const fy = (N - ny) / CELL;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const u = fx - i;
      const v = fy - j;
      return cell(i, j) * (1 - u) * (1 - v) + cell(i + 1, j) * u * (1 - v) + cell(i, j + 1) * (1 - u) * v + cell(i + 1, j + 1) * u * v;
    },
    sample(lat, lon) {
      const [E, N] = toUtm(lat, lon);
      return this.sampleUtm(E, N);
    },
    /** la fonte del punto (indice in world.fine.sources, -1 se nessuna) */
    sourceAt(lat, lon) {
      const [E, N] = toUtm(lat, lon);
      const i = Math.round((E - ex) / CELL);
      const j = Math.round((N - ny) / CELL);
      return i < 0 || j < 0 || i >= W || j >= H ? -1 : src[j * W + i] - 1;
    },
  };
}

// ---------- da riga di comando ----------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { WORLD } = await import('./config.mjs');
  if (!WORLD.fine) {
    console.log(`il mondo ${WORLD.id} non ha un terreno fine`);
  } else {
    await download(WORLD);
  }
}
