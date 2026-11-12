// Un lettore GeoTIFF minimo per i modelli del terreno che danno i servizi WCS (GeoServer): una
// banda, float32 (o int16/uint16), a strisce o a mattonelle, senza compressione o con Deflate,
// big- o little-endian. Legge anche la georeferenziazione (ModelTiepoint, ModelPixelScale) e il
// valore «nessun dato» di GDAL. Niente dipendenze: un formato fisso, sessanta righe.

import { inflateSync } from 'node:zlib';

/**
 * @returns {{ width: number, height: number, data: Float32Array, x0: number, y0: number, dx: number, dy: number, nodata: number | null }}
 *   x0, y0: l'angolo in alto a sinistra del primo pixel (coordinate del sistema del file), dx, dy: il passo
 */
export function readTiff(buf) {
  const le = buf[0] === 0x49;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error('non è un TIFF');
  const ifd = u32(4);
  const count = u16(ifd);
  /** @type {Record<number, number[] | string>} */
  const tags = {};
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    const tag = u16(e);
    const type = u16(e + 2);
    const n = u32(e + 4);
    const size = (SIZE[type] ?? 1) * n;
    const at = size <= 4 ? e + 8 : u32(e + 8);
    if (type === 2) tags[tag] = buf.toString('latin1', at, at + n).replace(/\0+$/, '');
    else {
      const v = [];
      for (let i = 0; i < n; i++) {
        if (type === 3) v.push(u16(at + i * 2));
        else if (type === 4) v.push(u32(at + i * 4));
        else if (type === 12) v.push(f64(at + i * 8));
        else if (type === 1) v.push(buf[at + i]);
      }
      tags[tag] = v;
    }
  }
  const width = tags[256][0];
  const height = tags[257][0];
  const bps = tags[258][0];
  const comp = tags[259]?.[0] ?? 1;
  const fmt = tags[339]?.[0] ?? 1;
  const pred = tags[317]?.[0] ?? 1;
  if (pred !== 1) throw new Error(`predittore TIFF non gestito: ${pred}`);
  if (comp !== 1 && comp !== 8 && comp !== 32946) throw new Error(`compressione TIFF non gestita: ${comp}`);
  const bytes = bps / 8;
  const read = (b, o) => {
    if (fmt === 3 && bps === 32) return le ? b.readFloatLE(o) : b.readFloatBE(o);
    if (fmt === 3 && bps === 64) return le ? b.readDoubleLE(o) : b.readDoubleBE(o);
    if (fmt === 2 && bps === 16) return le ? b.readInt16LE(o) : b.readInt16BE(o);
    if (bps === 16) return le ? b.readUInt16LE(o) : b.readUInt16BE(o);
    if (fmt === 2 && bps === 32) return le ? b.readInt32LE(o) : b.readInt32BE(o);
    throw new Error(`campioni TIFF non gestiti: ${bps} bit, formato ${fmt}`);
  };
  const block = (off, len) => {
    const raw = buf.subarray(off, off + len);
    return comp === 1 ? raw : inflateSync(raw);
  };
  const data = new Float32Array(width * height);
  if (tags[322]) {
    const tw = tags[322][0];
    const th = tags[323][0];
    const offs = tags[324];
    const lens = tags[325];
    const across = Math.ceil(width / tw);
    offs.forEach((off, t) => {
      const b = block(off, lens[t]);
      const ox = (t % across) * tw;
      const oy = Math.floor(t / across) * th;
      for (let y = 0; y < th && oy + y < height; y++) for (let x = 0; x < tw && ox + x < width; x++) data[(oy + y) * width + ox + x] = read(b, (y * tw + x) * bytes);
    });
  } else {
    const rps = tags[278]?.[0] ?? height;
    const offs = tags[273];
    const lens = tags[279];
    offs.forEach((off, s) => {
      const b = block(off, lens[s]);
      const rows = Math.min(rps, height - s * rps);
      for (let i = 0; i < rows * width; i++) data[s * rps * width + i] = read(b, i * bytes);
    });
  }
  const scale = tags[33550];
  const tie = tags[33922];
  // GeoServer scrive la matrice (ModelTransformation) invece di punto d'aggancio e passo
  const mt = tags[34264];
  const nd = tags[42113];
  const geo = mt
    ? { dx: mt[0], dy: -mt[5], x0: mt[3], y0: mt[7] }
    : { dx: scale ? scale[0] : 1, dy: scale ? scale[1] : 1, x0: tie ? tie[3] - tie[0] * (scale ? scale[0] : 1) : 0, y0: tie ? tie[4] + tie[1] * (scale ? scale[1] : 1) : 0 };
  return { width, height, data, ...geo, nodata: typeof nd === 'string' && nd.trim() !== '' ? Number(nd) : null };
}
