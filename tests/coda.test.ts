import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { accoda, leggiCoda, svuotaCoda } from '../src/open/coda';
import { saveKv } from '../src/db/db';

describe('la coda dei tempi fatti senza rete (A16)', () => {
  it('un tempo offline resta in coda, e parte una volta sola quando torna la rete', async () => {
    await saveKv('coda', []);
    await accoda({ nick: 'Michele', ride: 'ganda', sec: 4210, wkg: 3.1, sim: false });
    // lo stesso giro non entra due volte
    await accoda({ nick: 'Michele', ride: 'ganda', sec: 4210.2, wkg: 3.1, sim: false });
    expect(await leggiCoda()).toHaveLength(1);

    // ancora offline: resta
    const offline = vi.fn(async () => ({ ok: false, error: 'rete' }));
    expect(await svuotaCoda(offline)).toBe(0);
    expect(offline).toHaveBeenCalledTimes(1);
    expect(await leggiCoda()).toHaveLength(1);

    // torna la rete: due ritorni di fila (due eventi «online») spediscono una volta sola
    const online = vi.fn(async () => ({ ok: true, rank: 4 }));
    const [a, b] = await Promise.all([svuotaCoda(online), svuotaCoda(online)]);
    expect(a + (b === a ? 0 : b)).toBe(1);
    expect(online).toHaveBeenCalledTimes(1);
    expect(await leggiCoda()).toHaveLength(0);
    expect(await svuotaCoda(online)).toBe(0);
    expect(online).toHaveBeenCalledTimes(1);
  });

  it('un tempo che il server rifiuta (troppo veloce) esce dalla coda, senza ripetersi', async () => {
    await saveKv('coda', []);
    await accoda({ nick: 'Michele', ride: 'selvino', sec: 300, wkg: 9, sim: false });
    const no = vi.fn(async () => ({ ok: false, error: 'implausible' }));
    expect(await svuotaCoda(no)).toBe(0);
    expect(await leggiCoda()).toHaveLength(0);
  });
});
