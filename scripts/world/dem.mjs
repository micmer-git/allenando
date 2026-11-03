// Quote del terreno dalle mattonelle «Terrarium» delle Terrain Tiles di AWS Open Data
// (s3://elevation-tiles-prod, licenza aperta; in Europa la sorgente è EU-DEM, Copernicus).
// Ogni pixel PNG codifica la quota: (R·256 + G + B/256) − 32768 metri.
//
// Le mattonelle si scaricano una volta in scripts/world/cache/dem/ e si leggono da lì. Il
// decodificatore PNG è qui sotto, cinquanta righe: niente dipendenze per un formato fisso.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache', 'dem');
const URL_T = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function lonToX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}
export function latToY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z;
}

/** PNG a 8 bit, RGB o RGBA, non interlacciato: quello che servono le Terrain Tiles. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('non è un PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      if (depth !== 8 || (color !== 2 && color !== 6) || data[12] !== 0) throw new Error(`PNG non gestito (${depth} bit, tipo ${color})`);
      channels = color === 2 ? 3 : 4;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= channels ? out[dst + i - channels] : 0;
      const b = y > 0 ? out[dst - stride + i] : 0;
      const c = y > 0 && i >= channels ? out[dst - stride + i - channels] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[dst + i] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

async function fetchTile(z, x, y) {
  const file = join(CACHE, String(z), String(x), `${y}.png`);
  if (existsSync(file)) return readFileSync(file);
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(URL_T(z, x, y), { headers: { 'User-Agent': 'allenando/1.0' } });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, buf);
      return buf;
    } catch (err) {
      if (i === 4) throw err;
      await sleep(1000 * (i + 1));
    }
  }
  throw new Error('irraggiungibile');
}

/**
 * Carica le mattonelle che coprono `b` al livello `z` e restituisce un campionatore bilineare
 * di quota (metri) per lat/lon.
 */
export async function loadDem(z, b) {
  const x0 = Math.floor(lonToX(b.w, z));
  const x1 = Math.floor(lonToX(b.e, z));
  const y0 = Math.floor(latToY(b.n, z));
  const y1 = Math.floor(latToY(b.s, z));
  const tiles = new Map();
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
  let done = 0;
  // sei alla volta: le mattonelle sono piccole e il bucket regge
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(
      jobs.slice(i, i + 6).map(async ([x, y]) => {
        const png = decodePng(await fetchTile(z, x, y));
        const h = new Float32Array(256 * 256);
        for (let k = 0; k < 256 * 256; k++) {
          const p = k * png.channels;
          h[k] = png.data[p] * 256 + png.data[p + 1] + png.data[p + 2] / 256 - 32768;
        }
        tiles.set(`${x}/${y}`, h);
        done++;
      }),
    );
  }
  const px = (x, y) => {
    const tx = Math.floor(x / 256);
    const ty = Math.floor(y / 256);
    const t = tiles.get(`${tx}/${ty}`);
    if (!t) return NaN;
    return t[(y - ty * 256) * 256 + (x - tx * 256)];
  };
  return {
    tiles: done,
    sample(lat, lon) {
      const fx = lonToX(lon, z) * 256 - 0.5;
      const fy = latToY(lat, z) * 256 - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const u = fx - ix;
      const v = fy - iy;
      const a = px(ix, iy);
      const bb = px(ix + 1, iy);
      const c = px(ix, iy + 1);
      const d = px(ix + 1, iy + 1);
      return a * (1 - u) * (1 - v) + bb * u * (1 - v) + c * (1 - u) * v + d * u * v;
    },
  };
}
