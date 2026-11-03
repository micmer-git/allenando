// Confini del mondo «Bergamo e le sue valli». Un file solo per gli script che scaricano
// e per quello che costruisce: se cambia un bordo, cambia per tutti.

/** Il mondo pedalabile: Bergamo città, Val Brembana e Val Seriana fino ai passi. [S, W, N, E] */
export const REGION = { s: 45.66, w: 9.5, n: 46.075, e: 10.1 };

/** Il comune di Bergamo: qui entrano tutte le vie, anche le residenziali e le pedonali di Città Alta. */
export const CITY = { s: 45.664, w: 9.618, n: 45.727, e: 9.712 };

/** Il terreno lontano va oltre il mondo pedalabile: le creste all'orizzonte non finiscono a un bordo. */
export const HORIZON = { s: 45.5, w: 9.25, n: 46.25, e: 10.38 };

/** Origine delle coordinate locali (metri, x est, z sud): il centro del mondo pedalabile. */
export const ORIGIN = { lat: (REGION.s + REGION.n) / 2, lon: (REGION.w + REGION.e) / 2 };

/** Passo della griglia DEM vicina e lato delle mattonelle in cui è divisa, metri. */
export const DEM_STEP = 25;
export const TILE = 2000;
/** Passo del terreno lontano, metri. */
export const FAR_STEP = 250;

export const bbox = (b) => `${b.s},${b.w},${b.n},${b.e}`;
