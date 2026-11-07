/**
 * Le sessioni: ogni mezz'ora, a :00 e :30, parte qualcosa nel mondo di Bergamo. Il calendario
 * dipende solo dall'orologio, quindi è lo stesso su tutti i telefoni senza un server: chi
 * entra alla stessa sessione si ritrova sullo stesso percorso, alla stessa ora.
 *
 * - gruppo: un gruppo virtuale a passo costante (W/kg dichiarati); stai in scia e arrivi con loro
 * - crono: partenza col conto alla rovescia, solo contro il tempo, classifica della sessione
 * - volate: un percorso con le volate, che in sessione valgono doppio
 * - salita: si va su, il GPM in cima vale doppio
 */

export type SessionKind = 'gruppo' | 'crono' | 'volate' | 'salita';

export const SESSION_STYLE: Record<SessionKind, { name: string; color: string; blurb: string }> = {
  gruppo: { name: 'Uscita di gruppo', color: '#3ce0b0', blurb: 'Un gruppo a passo costante. Stai in scia fino all’arrivo.' },
  crono: { name: 'Cronometro', color: '#ffc814', blurb: 'Conto alla rovescia, poi solo tu e il tempo.' },
  volate: { name: 'Volate', color: '#d6267a', blurb: 'Le volate del percorso valgono doppio.' },
  salita: { name: 'Salita', color: '#1f7fe0', blurb: 'Si va su: il GPM in cima vale doppio.' },
};

/** I nomi dei percorsi, per mostrare una sessione senza caricare il mondo (sono in rides.json). */
export const WORLD_RIDE_NAMES: Record<string, string> = {
  'citta-alta': 'Città Alta e San Vigilio',
  maresana: 'Maresana',
  selvino: 'Selvino',
  'val-seriana': 'Val Seriana',
  'colle-gallo': 'Colle Gallo',
  presolana: 'Passo della Presolana',
  'zambla-nossa': 'Colle di Zambla da Ponte Nossa',
  'zambla-zogno': 'Colle di Zambla da Zogno',
  'val-brembana': 'Val Brembana',
  'ciclovia-brembana': 'Ciclovia della Val Brembana',
  foppolo: 'Foppolo',
  'san-marco': 'Passo San Marco',
  'due-valli': 'Il giro delle due valli',
  'berghem-corto': 'Berghem MolaMia · corto',
  'berghem-medio': 'Berghem MolaMia · medio',
};

export const SLOT_MS = 30 * 60 * 1000;
/** ci si iscrive da 15 minuti prima; si entra in corsa fino a 5 minuti dopo il via */
export const OPEN_BEFORE_MS = 15 * 60 * 1000;
export const LATE_MS = 5 * 60 * 1000;

const ROTATION: SessionKind[] = ['gruppo', 'crono', 'salita', 'gruppo', 'volate', 'crono', 'gruppo', 'salita'];

/** percorsi adatti a mezz'ora-un'ora, per tipo */
const ROUTES: Record<SessionKind, string[]> = {
  gruppo: ['ciclovia-brembana', 'val-brembana', 'colle-gallo', 'val-seriana'],
  crono: ['citta-alta', 'maresana', 'colle-gallo', 'ciclovia-brembana'],
  volate: ['citta-alta', 'val-brembana', 'ciclovia-brembana'],
  salita: ['selvino', 'presolana', 'zambla-nossa', 'foppolo', 'maresana'],
};

/** passo del gruppo, W/kg: C tranquillo, B medio, A svelto */
const PACES: { label: string; wkg: number }[] = [
  { label: 'C', wkg: 1.9 },
  { label: 'B', wkg: 2.4 },
  { label: 'A', wkg: 2.9 },
];

export interface SessionDef {
  id: string;
  slot: number;
  /** ms epoch del via */
  start: number;
  kind: SessionKind;
  rideId: string;
  /** solo per il gruppo */
  pace?: { label: string; wkg: number };
  title: string;
}

export function sessionAt(slot: number): SessionDef {
  const kind = ROTATION[((slot % ROTATION.length) + ROTATION.length) % ROTATION.length];
  const list = ROUTES[kind];
  const rideId = list[Math.floor(slot / ROTATION.length) % list.length];
  const pace = kind === 'gruppo' ? PACES[Math.floor(slot / 3) % PACES.length] : undefined;
  const title = kind === 'gruppo' ? `${SESSION_STYLE.gruppo.name} ${pace!.label} · ${pace!.wkg.toFixed(1).replace('.', ',')} W/kg` : SESSION_STYLE[kind].name;
  return { id: `ev-${slot}`, slot, start: slot * SLOT_MS, kind, rideId, pace, title };
}

export function slotOf(ms: number): number {
  return Math.floor(ms / SLOT_MS);
}

/** Le prossime n sessioni: quella in corso (se si può ancora entrare) e le seguenti. */
export function upcoming(now: number, n = 6): SessionDef[] {
  const out: SessionDef[] = [];
  let slot = slotOf(now);
  if (now - slot * SLOT_MS > LATE_MS) slot += 1;
  for (let i = 0; i < n; i++) out.push(sessionAt(slot + i));
  return out;
}

export type SessionPhase = 'presto' | 'aperta' | 'via' | 'chiusa';

export function phaseOf(s: SessionDef, now: number): SessionPhase {
  if (now < s.start - OPEN_BEFORE_MS) return 'presto';
  if (now < s.start) return 'aperta';
  if (now <= s.start + LATE_MS) return 'via';
  return 'chiusa';
}

export function sessionById(id: string): SessionDef | null {
  const m = /^ev-(\d{5,9})$/.exec(id);
  return m ? sessionAt(Number(m[1])) : null;
}

/** id della classifica della sessione, per il server */
export function sessionBoardId(s: SessionDef): string {
  return `ev:${s.slot}:${s.rideId}`;
}
