/**
 * Geometria delle strade vere: proiezione locale, livellamento della quota, tornanti.
 *
 * Il sistema locale è ENU appiattito su un'origine (equirettangolare con cos(lat0)):
 * x verso est, y in alto, z verso SUD, così la terna x-y-z resta destrorsa come in three.js.
 * Su 20-30 km l'errore della proiezione è sotto lo 0,1%: meno della larghezza della strada.
 * È la stessa formula di scripts/fetch-climbs.mjs, che proietta la griglia del terreno.
 */

export const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface GeoSample extends LatLon {
  /** Quota in metri, null se la sorgente non la dà. */
  ele: number | null;
}

export interface LocalPoint {
  x: number;
  z: number;
  ele: number | null;
}

export function projector(origin: LatLon) {
  const mLat = RAD * EARTH_R;
  const mLon = mLat * Math.cos(origin.lat * RAD);
  return {
    toLocal(p: LatLon): { x: number; z: number } {
      return { x: (p.lon - origin.lon) * mLon, z: -(p.lat - origin.lat) * mLat };
    },
    toGeo(x: number, z: number): LatLon {
      return { lat: origin.lat - z / mLat, lon: origin.lon + x / mLon };
    },
  };
}

export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function centerOf(points: LatLon[]): LatLon {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

/**
 * Arrotonda gli spigoli della polilinea (Chaikin), ma con il taglio limitato a `maxCut`
 * metri: un tornante resta un tornante, solo senza la piega secca tra due nodi OSM.
 */
export function roundCorners(points: LocalPoint[], maxCut = 3.5, iterations = 2): LocalPoint[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const out: LocalPoint[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const cut = Math.min(0.25, maxCut / len);
      const lerp = (u: number): LocalPoint => ({
        x: a.x + (b.x - a.x) * u,
        z: a.z + (b.z - a.z) * u,
        ele: a.ele != null && b.ele != null ? a.ele + (b.ele - a.ele) * u : (a.ele ?? b.ele),
      });
      if (i > 0) out.push(lerp(cut));
      if (i < pts.length - 2) out.push(lerp(1 - cut));
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Media mobile gaussiana su un campionamento regolare. `sigma` in campioni. */
export function gaussianSmooth(values: number[], sigma: number): number[] {
  if (sigma <= 0 || values.length < 3) return values.slice();
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let w = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const kw = kernel[k + radius];
      s += values[j] * kw;
      w += kw;
    }
    out[i] = s / w;
  }
  return out;
}

/** Media mobile a finestra (2r+1 campioni), O(n), bordi accorciati. */
function boxBlur(values: number[], r: number): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n - 1, i + r);
    while (hi < b) sum += values[++hi];
    while (lo < a) sum -= values[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

/**
 * Profilo dentro un tubo: si liscia e si riporta entro ±`tolerance` metri dalla quota
 * della sorgente, molte volte. Le gobbe false del DEM (una strada a mezza costa che
 * "pesca" il pendio) spariscono, ma la quota non si allontana mai dalla sorgente più della
 * tolleranza: la deformazione verticale è limitata per costruzione.
 */
export function tubeSmooth(values: number[], tolerance: number, radius: number, iterations = 30): number[] {
  let e = values.slice();
  for (let it = 0; it < iterations; it++) {
    e = boxBlur(boxBlur(e, radius), radius);
    for (let i = 0; i < e.length; i++) {
      const lo = values[i] - tolerance;
      const hi = values[i] + tolerance;
      if (e[i] < lo) e[i] = lo;
      else if (e[i] > hi) e[i] = hi;
    }
  }
  return e;
}

/** Riempie i buchi di quota interpolando sulla distanza; null se non c'è nessuna quota. */
export function fillElevation(dist: number[], ele: (number | null)[]): number[] | null {
  const known: number[] = [];
  for (let i = 0; i < ele.length; i++) if (ele[i] != null && Number.isFinite(ele[i])) known.push(i);
  if (known.length === 0) return null;
  const out = new Array<number>(ele.length);
  let k = 0;
  for (let i = 0; i < ele.length; i++) {
    while (k < known.length - 1 && known[k + 1] <= i) k++;
    const a = known[k];
    const b = known[Math.min(known.length - 1, k + 1)];
    if (i <= known[0]) out[i] = ele[known[0]] as number;
    else if (i >= known[known.length - 1]) out[i] = ele[known[known.length - 1]] as number;
    else {
      const span = dist[b] - dist[a] || 1;
      out[i] = (ele[a] as number) + (((ele[b] as number) - (ele[a] as number)) * (dist[i] - dist[a])) / span;
    }
  }
  return out;
}

export interface Hairpin {
  /** Distanza dall'inizio, al vertice della curva. */
  distance: number;
  /** Cambio di direzione in gradi. */
  turnDeg: number;
  /** 1 = sinistra, -1 = destra, guardando avanti. */
  side: 1 | -1;
}

/**
 * Tornanti trovati dalla geometria: un cambio di direzione di almeno `minTurn` gradi
 * dentro una finestra di `window` metri. Non è il numero dei cartelli ufficiali: è quello
 * che la traccia dice, e lo diciamo così.
 */
export function findHairpins(
  dist: number[],
  heading: number[],
  minTurn = 150,
  window = 70,
): Hairpin[] {
  const out: Hairpin[] = [];
  const n = dist.length;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && dist[j + 1] - dist[i] <= window) j++;
    let turn = 0;
    for (let k = i; k < j; k++) turn += wrap(heading[k + 1] - heading[k]);
    if (Math.abs(turn) * (180 / Math.PI) >= minTurn) {
      // vertice: dove la curvatura è massima nella finestra
      let best = i;
      let bestCurv = 0;
      for (let k = i; k < j; k++) {
        const c = Math.abs(wrap(heading[k + 1] - heading[k]));
        if (c > bestCurv) {
          bestCurv = c;
          best = k;
        }
      }
      out.push({ distance: dist[best], turnDeg: Math.round(Math.abs(turn) * (180 / Math.PI)), side: turn > 0 ? 1 : -1 });
      // salta oltre il tornante per non contarlo due volte
      const skipTo = dist[best] + window / 2;
      while (i < n && dist[i] < skipTo) i++;
      continue;
    }
    i++;
  }
  return out;
}

export function wrap(a: number): number {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
