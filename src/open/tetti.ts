/** Campioni AGEA, sRGB RGB565. L'ordine delle impronte è indipendente dall'ordine dei file. */
const sources = new Map<string, Promise<Map<number, number>>>();

export function readRoofColours(buffer: ArrayBuffer): Map<number, number> {
  const view = new DataView(buffer);
  const result = new Map<number, number>();
  if (view.byteLength < 4 || view.getUint32(0) !== 0x54455431 || (view.byteLength - 4) % 6 !== 0) return result;
  for (let i = 4; i < view.byteLength; i += 6) {
    const rgb = view.getUint16(i + 4, true);
    const r = Math.round((rgb >>> 11) * 255 / 31);
    const g = Math.round(((rgb >>> 5) & 63) * 255 / 63);
    const b = Math.round((rgb & 31) * 255 / 31);
    result.set(view.getUint32(i, true), (r << 16) | (g << 8) | b);
  }
  return result;
}

export function loadRoofColours(base: string): Promise<Map<number, number>> {
  const existing = sources.get(base);
  if (existing) return existing;
  const load = fetch(base + 'tetti-v1.bin')
    .then(async r => r.ok ? readRoofColours(await r.arrayBuffer()) : new Map<number, number>())
    .catch(() => {
      sources.delete(base);
      return new Map<number, number>();
    });
  sources.set(base, load);
  return load;
}
