import { normalizzaSearch } from '@/ride/intento';

/**
 * L'ultimo giro cominciato: il link della pedalata, il nome e il mondo. Serve a «Ripeti l'ultimo
 * giro» in Oggi (F.11): una riga sola, e si riparte dallo stesso percorso, anello o salita.
 * Sta in localStorage (è una comodità del dispositivo, non un dato del diario).
 */

export interface LastRide {
  /** la query della pedalata, senza «?» (come RideCheckpoint.search) */
  search: string;
  title: string;
  /** il mondo, se nel mondo aperto */
  world?: string;
  at: string;
}

const KEY = 'orobia.ultimo-giro';

export function rememberRide(r: Omit<LastRide, 'at'>): void {
  if (!r.search || !r.title) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...r, at: new Date().toISOString() } satisfies LastRide));
  } catch {
    // niente storage, niente «ripeti»
  }
}

export function loadLastRide(): LastRide | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<LastRide>;
    return typeof r.search === 'string' && typeof r.title === 'string' && r.search.length > 0 ? { search: r.search, title: r.title, world: r.world, at: r.at ?? '' } : null;
  } catch {
    return null;
  }
}

/** Il link per rifare quel giro: lo stesso intento, ma niente «resume», niente stanza né sessione. */
export function repeatHref(r: Pick<LastRide, 'search'>): string {
  const norm = normalizzaSearch(r.search, ['resume', 'room', 'session', 'at']);
  if (norm != null) return `/ride?${norm}`;
  const q = new URLSearchParams(r.search);
  for (const k of ['resume', 'room', 'session', 'at']) q.delete(k);
  return `/ride?${q.toString()}`;
}
