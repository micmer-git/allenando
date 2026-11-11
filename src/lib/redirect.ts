/**
 * Le rotte di prima del riordino Pedala · Diario · Tu (piano U, § 2.6). Ogni link vecchio — un
 * segnalibro, un'icona sulla schermata Home, un invito — arriva dove la cosa sta adesso, senza
 * pagina bianca. Pura: la usano App.tsx e tests/rotte.test.ts.
 */

const STRUMENTI = new Set(['libero', 'anello', 'ab']);

/** Dove porta una rotta vecchia; null se la rotta resta com'è. */
export function redirectFor(pathname: string, search = ''): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  const q = new URLSearchParams(search);
  if (path === '/mondo') {
    const tab = q.get('tab');
    if (tab === 'classifiche') return '/classifiche';
    const out = new URLSearchParams();
    const world = q.get('world');
    const ride = q.get('ride');
    if (ride) {
      // il link di un percorso: Pedala con quel percorso già scelto
      out.set('dove', 'percorso');
      if (world) out.set('world', world);
      out.set('ride', ride);
      return `/?${out.toString()}`;
    }
    out.set('dove', tab && STRUMENTI.has(tab) ? tab : '1');
    if (world) out.set('world', world);
    return `/?${out.toString()}`;
  }
  if (path === '/salite') return '/?dove=salite';
  if (path === '/giri') return '/history';
  const giro = /^\/giri\/([^/]+)$/.exec(path);
  if (giro) return `/?dove=giro&replay=${encodeURIComponent(decodeURIComponent(giro[1]))}`;
  if (path === '/profile') return '/impostazioni';
  return null;
}

export type Sezione = 'pedala' | 'diario' | 'tu';

/** La voce della barra accesa per una pagina: le pagine dentro Tu accendono Tu, Carico e Importa il Diario. */
export function sezioneDi(pathname: string): Sezione | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path.startsWith('/sessioni') || path.startsWith('/salite') || path.startsWith('/mondo')) return 'pedala';
  if (path.startsWith('/history') || path === '/load' || path === '/import' || path.startsWith('/giri')) return 'diario';
  if (['/tu', '/garage', '/traguardi', '/classifiche', '/workouts', '/programmi', '/impostazioni', '/profile'].some((p) => path === p || path.startsWith(`${p}/`))) return 'tu';
  return null;
}
