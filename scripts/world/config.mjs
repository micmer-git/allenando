// I confini dei mondi, un file solo per gli script che scaricano e per quello che costruisce:
// se cambia un bordo, cambia per tutti. Il mondo lo sceglie la variabile d'ambiente WORLD
// (`WORLD=sellaronda node scripts/world/fetch-osm.mjs`, `WORLD=sellaronda npm run world:build`);
// senza, è Bergamo, con gli stessi numeri di sempre.

/**
 * @typedef {{ s: number, w: number, n: number, e: number }} Box
 * @typedef {{
 *   id: string,
 *   name: string,
 *   region: Box, city: Box, horizon: Box,
 *   demStep: number, tile: number, farStep: number,
 *   osmDir: string,
 *   lang?: string,
 *   alpino?: { treeLine: number, rockSlope: number },
 *   fine?: { sources: string[], step: number, margin?: number, feather: number, steep: number },
 * }} World
 */

/** @type {Record<string, World>} */
export const WORLDS = {
  bergamo: {
    id: 'bergamo',
    name: 'Bergamo e le sue valli',
    /** Il mondo pedalabile: Bergamo città, Val Brembana e Val Seriana fino ai passi. */
    region: { s: 45.66, w: 9.5, n: 46.075, e: 10.1 },
    /** Il comune di Bergamo: qui entrano tutte le vie, anche le residenziali e le pedonali di Città Alta. */
    city: { s: 45.664, w: 9.618, n: 45.727, e: 9.712 },
    /** Il terreno lontano va oltre il mondo pedalabile: le creste all'orizzonte non finiscono a un bordo. */
    horizon: { s: 45.5, w: 9.25, n: 46.25, e: 10.38 },
    demStep: 25,
    tile: 2000,
    farStep: 250,
    osmDir: 'osm',
  },
  sellaronda: {
    id: 'sellaronda',
    name: 'Sellaronda',
    /** Il mondo pedalabile: i quattro passi, con Canazei e il Fedaia. */
    region: { s: 46.43, w: 11.68, n: 46.6, e: 11.95 },
    /** I paesi (Selva, Corvara, Arabba, Canazei) stanno tutti nel mondo: le vie di paese entrano ovunque. */
    city: { s: 46.43, w: 11.68, n: 46.6, e: 11.95 },
    /** Fino alla Marmolada a sud, al Puez a nord, al Sassolungo a ovest, a Civetta e Pelmo a est. */
    horizon: { s: 46.3, w: 11.55, n: 46.68, e: 12.1 },
    demStep: 25,
    tile: 2000,
    /** Più fitto di Bergamo: qui l'orizzonte è il punto. */
    farStep: 120,
    osmDir: 'osm-sellaronda',
    /** I nomi in italiano dove OSM ne ha tre («Jouf de Sela - Passo Sella - Sellajoch»). */
    lang: 'it',
    /** Il bosco finisce a 2100 m; sopra i 38° di pendenza è parete anche senza un poligono di roccia. */
    alpino: { treeLine: 2100, rockSlope: 38 },
    /**
     * Il terreno fine delle province (scripts/world/dtm.mjs): il LiDAR dell'Alto Adige (2,5 m) e del
     * Trentino (1 m), ridotti a 5 m in cache; nelle mattonelle dove la montagna è ripida il passo
     * scende a 12,5 m (`step`), altrove resta 25. Dove il dato fine finisce si passa a EU-DEM in
     * `feather` metri, senza gradini. `steep`: la parte dei punti di una mattonella sopra i 35° oltre
     * cui la mattonella vuole il passo fine.
     */
    fine: { sources: ['bz', 'tn'], step: 12.5, margin: 1000, feather: 250, steep: 0.02 },
  },
};

export const WORLD_ID = process.env.WORLD || 'bergamo';
if (!WORLDS[WORLD_ID]) throw new Error(`mondo sconosciuto: WORLD=${WORLD_ID} (ho ${Object.keys(WORLDS).join(', ')})`);

/** Il mondo scelto, con l'origine delle coordinate locali (metri, x est, z sud): il centro del mondo pedalabile. */
export function worldConfig(id = WORLD_ID) {
  const w = WORLDS[id];
  if (!w) throw new Error(`mondo sconosciuto: ${id}`);
  return { ...w, origin: { lat: (w.region.s + w.region.n) / 2, lon: (w.region.w + w.region.e) / 2 } };
}

export const WORLD = worldConfig(WORLD_ID);

export const REGION = WORLD.region;
export const CITY = WORLD.city;
export const HORIZON = WORLD.horizon;
export const ORIGIN = WORLD.origin;
export const DEM_STEP = WORLD.demStep;
export const TILE = WORLD.tile;
export const FAR_STEP = WORLD.farStep;

export const bbox = (b) => `${b.s},${b.w},${b.n},${b.e}`;
