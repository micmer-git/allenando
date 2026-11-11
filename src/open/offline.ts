import { worldBaseUrl, type WorldManifest } from './worlds';

/**
 * «Scarica per usarlo senza rete»: un mondo intero (grafo, percorsi, luoghi, monumenti, terreno
 * lontano, tutte le mattonelle del terreno e delle case) messo nella stessa cache che usa il
 * service worker per il mondo (`allenando-world-v1`, CacheFirst in vite.config.ts). Così quello
 * che si scarica qui è quello che la corsa trova dopo, in aereo o in cantina.
 *
 * Senza Cache API (un browser vecchio, una finestra privata su iPhone) la funzione non c'è, e la
 * pagina lo dice invece di fingere.
 */

export const WORLD_CACHE = 'allenando-world-v1';

export interface WorldStorage {
  /** la cache c'è su questo browser */
  available: boolean;
  /** tutti i file del manifesto sono in cache */
  downloaded: boolean;
  /** file in cache / file del manifesto */
  cached: number;
  total: number;
  /** byte dei file del manifesto già in cache (dal manifesto, non misurati) */
  bytes: number;
  /** byte dell'intero mondo (dal manifesto) */
  totalBytes: number;
}

/** Gli indirizzi dei file di un mondo, dal manifesto. */
export function worldUrls(id: string, m: Pick<WorldManifest, 'files'>): string[] {
  const base = worldBaseUrl(id);
  return m.files.map(([path]) => `${base}${path}`);
}

/** «12 MB», «640 kB»: i byte come li legge una persona. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 kB';
  if (n < 1_000_000) return `${Math.max(1, Math.round(n / 1000))} kB`;
  const mb = n / 1_000_000;
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb)} MB`;
}

/** Lo stato dello scarico da quello che c'è in cache: tutto, niente, o a metà. */
export function storageState(cachedPaths: ReadonlySet<string>, m: Pick<WorldManifest, 'files' | 'bytes'>, available = true): WorldStorage {
  let cached = 0;
  let bytes = 0;
  for (const [path, size] of m.files) {
    if (cachedPaths.has(path)) {
      cached += 1;
      bytes += size;
    }
  }
  return { available, downloaded: m.files.length > 0 && cached === m.files.length, cached, total: m.files.length, bytes, totalBytes: m.bytes };
}

function cacheApi(): CacheStorage | null {
  try {
    return typeof caches !== 'undefined' && caches ? caches : null;
  } catch {
    return null;
  }
}

/** Cosa c'è già in cache di questo mondo. */
export async function worldStorage(id: string, m: WorldManifest | null): Promise<WorldStorage> {
  const empty = { available: false, downloaded: false, cached: 0, total: m?.files.length ?? 0, bytes: 0, totalBytes: m?.bytes ?? 0 };
  const api = cacheApi();
  if (!api || !m) return { ...empty, available: !!api };
  try {
    const cache = await api.open(WORLD_CACHE);
    const keys = await cache.keys();
    const base = new URL(worldBaseUrl(id), location.href).href;
    const have = new Set<string>();
    for (const req of keys) if (req.url.startsWith(base)) have.add(req.url.slice(base.length).split('?')[0]);
    return storageState(have, m, true);
  } catch {
    return { ...empty, available: true };
  }
}

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
}

/**
 * Scarica tutto il mondo nella cache, quattro file alla volta, saltando quelli che ci sono già.
 * Chiama `onProgress` a ogni file; con `signal` si ferma (quello che è arrivato resta).
 */
export async function downloadWorld(id: string, m: WorldManifest, onProgress: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<WorldStorage> {
  const api = cacheApi();
  if (!api) throw new Error('Questo browser non tiene i file senza rete.');
  const cache = await api.open(WORLD_CACHE);
  const base = worldBaseUrl(id);
  const sizes = new Map(m.files);
  const queue = m.files.map(([path]) => path);
  let done = 0;
  let bytes = 0;
  let failed = 0;
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const path = queue.shift()!;
      const url = `${base}${path}`;
      const have = await cache.match(url);
      if (!have) {
        try {
          const res = await fetch(url, { signal });
          if (res.ok) await cache.put(url, res);
          else failed += 1;
        } catch {
          if (signal?.aborted) return;
          failed += 1;
        }
      }
      done += 1;
      bytes += sizes.get(path) ?? 0;
      onProgress({ done, total: m.files.length, bytes });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (failed && !signal?.aborted) throw new Error(failed === 1 ? 'Un file non è arrivato: riprova.' : `${failed} file non sono arrivati: riprova.`);
  return worldStorage(id, m);
}

/** «Togli»: via dalla cache tutti i file di questo mondo. */
export async function removeWorld(id: string): Promise<void> {
  const api = cacheApi();
  if (!api) return;
  const cache = await api.open(WORLD_CACHE);
  const base = new URL(worldBaseUrl(id), location.href).href;
  for (const req of await cache.keys()) if (req.url.startsWith(base)) await cache.delete(req);
}
