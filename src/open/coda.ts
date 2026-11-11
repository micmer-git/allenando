import { loadKv, saveKv } from '@/db/db';
import { postResult } from './progress';

/**
 * I tempi del percorso fatti senza rete (A16 del piano U): restano in coda nel kv `coda` del
 * database `allenando` e partono per la classifica quando la rete torna, una volta sola.
 */

export const CODA_KEY = 'coda';

export interface TempoInCoda {
  nick: string;
  ride: string;
  sec: number;
  wkg: number;
  sim: boolean;
  /** quando è stato fatto (ISO) */
  at: string;
}

type Post = typeof postResult;

function valido(t: unknown): t is TempoInCoda {
  const x = t as TempoInCoda | null;
  return !!x && typeof x.nick === 'string' && typeof x.ride === 'string' && Number.isFinite(x.sec) && Number.isFinite(x.wkg);
}

export async function leggiCoda(): Promise<TempoInCoda[]> {
  const v = await loadKv<unknown>(CODA_KEY).catch(() => undefined);
  return Array.isArray(v) ? v.filter(valido) : [];
}

/** Un tempo in coda; lo stesso giro (percorso e secondi) non entra due volte. */
export async function accoda(t: Omit<TempoInCoda, 'at'> & { at?: string }): Promise<void> {
  const list = await leggiCoda();
  if (list.some((x) => x.ride === t.ride && Math.round(x.sec) === Math.round(t.sec) && x.nick === t.nick)) return;
  list.push({ ...t, at: t.at ?? new Date().toISOString() });
  await saveKv(CODA_KEY, list.slice(-50));
}

let inVolo: Promise<number> | null = null;

/**
 * Spedisce i tempi in coda. Uno spedito (o rifiutato dal server: troppo veloce, nome mancante)
 * esce dalla coda; senza rete si ferma e riprova al prossimo ritorno. Mai due giri insieme.
 */
export function svuotaCoda(post: Post = postResult): Promise<number> {
  if (inVolo) return inVolo;
  inVolo = (async () => {
    const list = await leggiCoda();
    let sent = 0;
    const left: TempoInCoda[] = [];
    let offline = false;
    for (const t of list) {
      if (offline) {
        left.push(t);
        continue;
      }
      const res = await post({ nick: t.nick, ride: t.ride, sec: t.sec, wkg: t.wkg, sim: t.sim });
      if (res.ok) sent++;
      else if (res.error === 'rete') {
        offline = true;
        left.push(t);
      }
    }
    if (list.length) await saveKv(CODA_KEY, left);
    return sent;
  })().finally(() => {
    inVolo = null;
  });
  return inVolo;
}

let avviata = false;

/** Al ritorno della rete (e subito, se c'è) la coda parte. */
export function avviaCoda(): void {
  if (avviata || typeof window === 'undefined') return;
  avviata = true;
  window.addEventListener('online', () => void svuotaCoda().catch(() => undefined));
  if (navigator.onLine !== false) void svuotaCoda().catch(() => undefined);
}
