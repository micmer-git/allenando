import type { Dove, Intento, Tipo } from './contract';

/**
 * L'intento della corsa (dove, come, quanti giri) e il link di `/ride`, nei due versi.
 *
 * I link vecchi restano validi (§ 2.2 del piano U): `?world=W&ride=R`, `?route=R`, `&workout=X`,
 * `?replay=R&mode=power|ghost|grade`, `?route=R&ghost=ID`. Quelli nuovi aggiungono `tipo`, `watt`,
 * `giri` e `fantasma`. `resume`, `at` e `ghost` non stanno nell'intento: restano nel link e li
 * legge chi li usa.
 */

const TIPI: readonly Tipo[] = ['libera', 'fissa', 'allenamento', 'allora'];

export const WATT_MIN = 50;
export const WATT_MAX = 1000;
export const WATT_PASSO = 5;
/** tetto dei passaggi: oltre, si prosegue libero */
export const GIRI_MAX = 20;

/** 50–1000 W, a passi di 5. */
export function wattFissi(w: number): number {
  const r = Math.round(w / WATT_PASSO) * WATT_PASSO;
  return Math.min(WATT_MAX, Math.max(WATT_MIN, r));
}

/** Anche a 0 W si può proseguire per inerzia o in discesa. */
export function wattManuali(w: number): number {
  return Number.isFinite(w) ? Math.min(WATT_MAX, Math.max(0, Math.round(w / WATT_PASSO) * WATT_PASSO)) : 0;
}

function intero(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function doveDa(p: URLSearchParams): Dove | null {
  const world = p.get('world');
  if (world) {
    const ride = p.get('ride');
    if (ride) return { kind: 'percorso', world, ride };
    const plan = p.get('plan');
    if (plan) return { kind: 'piano', world, plan };
    const edge = intero(p.get('edge'));
    if (edge == null || edge < 0) return null;
    const s = intero(p.get('s'));
    return { kind: 'libero', world, edge: Math.floor(edge), dir: p.get('dir') === '-1' ? -1 : 1, s: s != null && s > 0 ? s : 0 };
  }
  const replay = p.get('replay');
  if (replay) {
    const sec = p.get('sec');
    return sec ? { kind: 'giro', replay, sec } : { kind: 'giro', replay };
  }
  const route = p.get('route');
  if (route) return { kind: 'salita', route };
  return null;
}

/** Dal link di `/ride` all'intento; null se il link non dice dove. */
export function intentoDaSearch(p: URLSearchParams): Intento | null {
  const dove = doveDa(p);
  if (!dove) return null;
  const mode = dove.kind === 'giro' ? p.get('mode') : null;
  const workout = p.get('workout') || undefined;
  const rawTipo = p.get('tipo');
  let tipo: Tipo;
  if (rawTipo && (TIPI as readonly string[]).includes(rawTipo)) tipo = rawTipo as Tipo;
  else if (mode === 'power') tipo = 'allora';
  else if (workout) tipo = 'allenamento';
  else tipo = 'libera';
  // «allora» vale solo su un tuo giro; altrove è una pedalata libera
  if (tipo === 'allora' && dove.kind !== 'giro') tipo = 'libera';

  const out: Intento = { dove, tipo };
  if (p.get('manuale') === '1') {
    out.manuale = true;
    if (tipo !== 'allenamento') out.tipo = 'libera';
    const w = intero(p.get('watt'));
    if (w != null) out.watt = wattManuali(w);
  } else if (tipo === 'fissa') {
    const w = intero(p.get('watt'));
    if (w != null) out.watt = wattFissi(w);
  }
  if (tipo === 'allenamento' && workout) out.workout = workout;
  const giri = intero(p.get('giri'));
  if (giri != null) out.giri = Math.min(GIRI_MAX, Math.max(1, Math.round(giri)));
  const f = p.get('fantasma');
  if (f === '0' || f === '1') out.fantasma = f === '1';
  else if (mode === 'ghost') out.fantasma = true;
  else if (mode === 'grade') out.fantasma = false;
  else if (dove.kind === 'salita' && p.get('ghost')) out.fantasma = true;
  const session = p.get('session');
  if (session) out.session = session;
  const room = p.get('room');
  if (room) out.room = room;
  return out;
}

/**
 * Dall'intento al link di `/ride`, senza «?». Scrive i parametri che le pagine e il punto di
 * ripresa sanno già leggere (`workout`, `mode` sui tuoi giri), nello stesso ordine dei link di
 * prima: `tipo` solo quando non si capisce da sé (Potenza fissa, o Libera dove il link direbbe altro).
 */
export function intentoInSearch(i: Intento): string {
  const q = new URLSearchParams();
  const d = i.dove;
  const tipo: Tipo = (i.manuale && i.tipo !== 'allenamento') || (i.tipo === 'allora' && d.kind !== 'giro') ? 'libera' : i.tipo;
  if (tipo === 'allenamento' && i.workout) q.set('workout', i.workout);
  switch (d.kind) {
    case 'percorso':
      q.set('world', d.world);
      q.set('ride', d.ride);
      break;
    case 'piano':
      q.set('world', d.world);
      q.set('plan', d.plan);
      break;
    case 'libero':
      q.set('world', d.world);
      q.set('edge', String(d.edge));
      q.set('s', String(Math.round(d.s * 10) / 10));
      q.set('dir', String(d.dir));
      break;
    case 'salita':
      q.set('route', d.route);
      break;
    case 'giro':
      q.set('replay', d.replay);
      break;
  }
  // il tipo si scrive solo se il resto del link non lo dice già
  const implicito = tipo === 'libera' || (tipo === 'allenamento' && !!i.workout) || (tipo === 'allora' && d.kind === 'giro');
  if (!implicito) q.set('tipo', tipo);
  if (i.manuale) {
    q.set('manuale', '1');
    if (i.watt != null) q.set('watt', String(wattManuali(i.watt)));
  } else if (tipo === 'fissa' && i.watt != null) q.set('watt', String(wattFissi(i.watt)));
  if (d.kind === 'giro') {
    // il modo di oggi: i watt, il fantasma o la sola pendenza del giro di allora
    if (tipo === 'allora') {
      q.set('mode', 'power');
      if (i.fantasma != null) q.set('fantasma', i.fantasma ? '1' : '0');
    } else if (i.fantasma != null) q.set('mode', i.fantasma ? 'ghost' : 'grade');
    if (d.sec) q.set('sec', d.sec);
  } else if (i.fantasma != null) q.set('fantasma', i.fantasma ? '1' : '0');
  if (i.giri != null) q.set('giri', String(Math.min(GIRI_MAX, Math.max(1, Math.round(i.giri)))));
  if (i.session) q.set('session', i.session);
  if (i.room) q.set('room', i.room);
  return q.toString();
}

/** I parametri del link che non stanno nell'intento e vanno tenuti: il fantasma di un giro, il punto, la ripresa. */
export const FUORI_INTENTO = ['ghost', 'at', 'resume'] as const;

/** Il link rifatto dall'intento, coi parametri fuori intento che c'erano (o null se il link non dice dove). */
export function normalizzaSearch(search: string, drop: readonly string[] = []): string | null {
  const p = new URLSearchParams(search);
  const i = intentoDaSearch(p);
  if (!i) return null;
  if (drop.includes('session')) delete i.session;
  if (drop.includes('room')) delete i.room;
  const q = new URLSearchParams(intentoInSearch(i));
  for (const k of FUORI_INTENTO) {
    const v = p.get(k);
    if (v != null && !drop.includes(k)) q.set(k, v);
  }
  return q.toString();
}

/** I passaggi dell'intento: 1 se non detto. */
export function giriDi(i: Pick<Intento, 'giri'>): number {
  return Math.min(GIRI_MAX, Math.max(1, Math.round(i.giri ?? 1)));
}
