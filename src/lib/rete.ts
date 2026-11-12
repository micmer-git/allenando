import { useEffect, useSyncExternalStore } from 'react';
import { downloadWorld, WORLD_CACHE } from '@/open/offline';
import { fetchManifest, lastWorld, worldBaseUrl, type WorldManifest } from '@/open/worlds';
import type { PaccoMondo, Rete } from '@/ride/contract';

/**
 * La rete e i mondi sul telefono (A15–A16 del piano U).
 *
 * Il mondo **leggero** è `manifest.json`, `graph.json`, `rides.json`, `features.json`, `far.bin`,
 * `monumenti.json`: le strade sulle loro quote, il terreno lontano, i nomi, i monumenti. Basta per
 * pedalare ogni percorso senza rete. Scende da solo dopo il primo avvio, per il mondo scelto,
 * se il telefono non chiede di risparmiare dati. Il mondo **intero** (più `dem/` e `b/`) si scarica
 * in Impostazioni. Tutto va nella cache che il service worker usa per `/world/` (CacheFirst).
 */

/** I file del mondo leggero (A15), relativi alla cartella del mondo. */
export const LEGGERO = ['manifest.json', 'graph.json', 'rides.json', 'features.json', 'far.bin', 'monumenti.json'] as const;

/** Un file del mondo fa parte del leggero? Le mattonelle del terreno fine e delle case no. */
export function fileLeggero(path: string): boolean {
  return (LEGGERO as readonly string[]).includes(path);
}

/** Byte del mondo leggero, dal manifesto (il manifesto stesso è piccolo e non è nella lista). */
export function pesoLeggero(m: Pick<WorldManifest, 'files'>): number {
  return m.files.filter(([p]) => fileLeggero(p)).reduce((a, [, b]) => a + b, 0);
}

/** Cosa c'è di un mondo sul telefono, da quello che è in cache: l'intero, il leggero, niente. */
export function paccoDa(cached: ReadonlySet<string>, m: Pick<WorldManifest, 'files'>): PaccoMondo {
  if (m.files.length === 0) return 'niente';
  const light = m.files.filter(([p]) => fileLeggero(p)).map(([p]) => p);
  if (!light.every((p) => cached.has(p))) return 'niente';
  return m.files.every(([p]) => cached.has(p)) ? 'intero' : 'leggero';
}

// ---------- la rete ----------

export function reteAdesso(): Rete {
  return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';
}

function subscribeRete(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** «Offline», detto con una parola: la rete adesso, viva. */
export function useRete(): Rete {
  return useSyncExternalStore(subscribeRete, reteAdesso, () => 'online' as Rete);
}

/** Il telefono chiede di risparmiare dati (Risparmio dati di Chrome, Android). */
export function risparmioDati(): boolean {
  try {
    return !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  } catch {
    return false;
  }
}

// ---------- i mondi sul telefono ----------

function cacheApi(): CacheStorage | null {
  try {
    return typeof caches !== 'undefined' && caches ? caches : null;
  } catch {
    return null;
  }
}

/** I file di un mondo già in cache, relativi alla sua cartella. */
async function inCache(world: string): Promise<Set<string>> {
  const api = cacheApi();
  const have = new Set<string>();
  if (!api) return have;
  try {
    const cache = await api.open(WORLD_CACHE);
    const base = new URL(worldBaseUrl(world), location.href).href;
    for (const req of await cache.keys()) if (req.url.startsWith(base)) have.add(req.url.slice(base.length).split('?')[0]);
  } catch {
    /* niente cache */
  }
  return have;
}

export interface Pacco {
  stato: PaccoMondo;
  /** durante lo scarico, da 0 a 1 */
  progresso?: number;
  /** byte del mondo già sul telefono (dal manifesto) */
  bytes: number;
  /** byte del mondo intero */
  totale: number;
}

/** Lo stato di un mondo sul telefono, letto adesso dalla cache. */
export async function statoPacco(world: string): Promise<Pacco> {
  const m = await fetchManifest(world);
  if (!m) return { stato: 'niente', bytes: 0, totale: 0 };
  const have = await inCache(world);
  let bytes = 0;
  for (const [p, b] of m.files) if (have.has(p)) bytes += b;
  const stato = paccoDa(have, m);
  // il manifesto non sta nella sua lista, ma senza di lui offline non si saprebbe cosa c'è
  return { stato: stato === 'leggero' && !have.has('manifest.json') ? 'niente' : stato, bytes, totale: m.bytes };
}

const pacchi = new Map<string, Pacco>();
const ascolti = new Set<() => void>();
const scarichi = new Map<string, Promise<void>>();

function avvisa(): void {
  for (const l of ascolti) l();
}

function metti(world: string, p: Pacco): void {
  const old = pacchi.get(world);
  if (old && old.stato === p.stato && old.progresso === p.progresso && old.bytes === p.bytes && old.totale === p.totale) return;
  pacchi.set(world, p);
  avvisa();
}

async function rileggi(world: string): Promise<void> {
  if (scarichi.has(world)) return;
  metti(world, await statoPacco(world));
}

const VUOTO: Pacco = { stato: 'niente', bytes: 0, totale: 0 };

/** Il mondo sul telefono: intero, leggero, in scarico (con il progresso), niente. */
export function usePacco(world: string): Pacco {
  const p = useSyncExternalStore(
    (cb) => {
      ascolti.add(cb);
      return () => ascolti.delete(cb);
    },
    () => pacchi.get(world) ?? VUOTO,
    () => VUOTO,
  );
  useEffect(() => {
    void rileggi(world);
  }, [world]);
  return p;
}

/** Scarica nella cache del service worker i file che mancano, con l'avanzamento. */
async function scarica(world: string, files: [string, number][], signal?: AbortSignal): Promise<void> {
  // uno scarico alla volta per mondo: il secondo parte dopo, e salta quello che c'è già
  const prev = scarichi.get(world);
  if (prev) await prev.catch(() => undefined);
  const job = (async () => {
    const m = await fetchManifest(world);
    if (!m) throw new Error('Mondo non disponibile.');
    const base = pacchi.get(world) ?? (await statoPacco(world));
    const sub = { ...m, files, bytes: files.reduce((a, [, b]) => a + b, 0) };
    metti(world, { ...base, stato: 'scarico', progresso: 0 });
    try {
      await downloadWorld(world, sub, (p) => metti(world, { ...base, stato: 'scarico', progresso: p.total ? p.done / p.total : 1 }), signal);
    } finally {
      scarichi.delete(world);
      metti(world, await statoPacco(world));
    }
  })();
  scarichi.set(world, job);
  return job;
}

/** Il mondo leggero nella cache: il manifesto, il grafo, i percorsi, i luoghi, il terreno lontano, i monumenti. */
export async function scaricaLeggero(world: string, signal?: AbortSignal): Promise<void> {
  const m = await fetchManifest(world);
  if (!m) return;
  // il manifesto va in cache anche lui: offline dice cosa c'è
  const files: [string, number][] = [['manifest.json', 0], ...m.files.filter(([p]) => fileLeggero(p))];
  await scarica(world, files, signal);
}

/** Il mondo intero (leggero più terreno fine e case); si ferma con `signal`, e riparte da dov'era. */
export async function scaricaIntero(world: string, signal?: AbortSignal): Promise<void> {
  const m = await fetchManifest(world);
  if (!m) throw new Error('Mondo non disponibile.');
  await scarica(world, [['manifest.json', 0], ...m.files], signal);
}

/** «Togli»: via il terreno fine e le case; il leggero resta, per pedalare senza rete. */
export async function togliIntero(world: string): Promise<void> {
  const api = cacheApi();
  if (api) {
    const cache = await api.open(WORLD_CACHE);
    const base = new URL(worldBaseUrl(world), location.href).href;
    for (const req of await cache.keys()) {
      if (!req.url.startsWith(base)) continue;
      const path = req.url.slice(base.length).split('?')[0];
      if (!fileLeggero(path)) await cache.delete(req);
    }
  }
  metti(world, await statoPacco(world));
}

let avviato = false;

/**
 * Dopo il primo avvio: il mondo leggero del mondo scelto scende da solo, senza chiedere, se c'è
 * rete e il telefono non chiede di risparmiare dati. E i tempi rimasti in coda partono.
 */
export function avvioLeggero(world = lastWorld()): void {
  if (avviato) return;
  avviato = true;
  void import('@/open/coda').then((c) => c.avviaCoda());
  if (reteAdesso() === 'offline' || risparmioDati()) return;
  void statoPacco(world)
    .then((p) => (p.stato === 'niente' ? scaricaLeggero(world) : undefined))
    .catch(() => undefined);
}
