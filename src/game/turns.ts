/**
 * La scelta all'incrocio, ridotta a quello che si legge in otto secondi a 30 km/h: al massimo
 * tre frecce, un nome solo per freccia, mai due nomi uguali. Sul percorso la sua freccia dice
 * «Percorso». La logica è qui, senza React, così le prove la misurano.
 */

export interface TurnOptionLike {
  /** gradi, positivo = sinistra */
  turn: number;
  uTurn: boolean;
  /** il nome della strada */
  label: string;
  /** il primo paese a cui porta */
  toward: string;
  onRoute: boolean;
  /** in una rotatoria: il numero dell'uscita */
  exit?: number;
}

export interface TurnChoice {
  /** l'indice fra le uscite dell'incrocio, quello da passare a `session.choose` */
  index: number;
  name: string;
  turn: number;
  uTurn: boolean;
  exit?: number;
  onRoute: boolean;
  selected: boolean;
}

export const MAX_TURNS = 3;

/** La parola della direzione, con la maiuscola. */
export function turnWord(deg: number, uTurn = false): string {
  if (uTurn) return 'Inversione';
  if (Math.abs(deg) < 25) return 'Dritto';
  if (deg > 0) return deg > 120 ? 'Tutta a sinistra' : 'Sinistra';
  return deg < -120 ? 'Tutta a destra' : 'Destra';
}

function side(o: TurnOptionLike): 'l' | 's' | 'r' | 'u' {
  if (o.uTurn) return 'u';
  if (Math.abs(o.turn) < 25) return 's';
  return o.turn > 0 ? 'l' : 'r';
}

/**
 * Quali uscite mostrare, da sinistra a destra come sono sulla strada: quella del percorso e
 * quella scelta sempre; poi una per lato (sinistra, dritto, destra), la più vicina all'angolo
 * pulito; l'inversione solo se non c'è altro.
 */
export function pickTurns(options: TurnOptionLike[], selected: number, max = MAX_TURNS): number[] {
  const keep = new Set<number>();
  const route = options.findIndex((o) => o.onRoute);
  if (route >= 0) keep.add(route);
  if (options[selected]) keep.add(selected);
  const ideal = { l: 90, s: 0, r: -90, u: 180 };
  for (const s of ['s', 'l', 'r'] as const) {
    if (keep.size >= max) break;
    if ([...keep].some((i) => side(options[i]) === s)) continue;
    let best = -1;
    options.forEach((o, i) => {
      if (side(o) !== s || keep.has(i)) return;
      if (best < 0 || Math.abs(o.turn - ideal[s]) < Math.abs(options[best].turn - ideal[s])) best = i;
    });
    if (best >= 0) keep.add(best);
  }
  // ancora posto: le altre uscite, l'inversione per ultima
  const rest = options.map((_, i) => i).filter((i) => !keep.has(i)).sort((a, b) => Number(options[a].uTurn) - Number(options[b].uTurn));
  for (const i of rest) {
    if (keep.size >= max) break;
    keep.add(i);
  }
  return [...keep].sort((a, b) => a - b).slice(0, Math.max(max, 2));
}

/** I nomi possibili di un'uscita, dal più utile al più generico. */
function candidates(o: TurnOptionLike): string[] {
  const out: string[] = [];
  const add = (s: string | undefined) => {
    // l'apostrofo tipografico, come nella cartolina: OSM scrive «de' Calvi» con quello dritto
    const raw = (s ?? '').trim().replace(/'/g, '’');
    const t = raw.charAt(0).toUpperCase() + raw.slice(1);
    if (t && !out.includes(t)) out.push(t);
  };
  if (o.onRoute) add('Percorso');
  add(o.toward);
  add(o.label);
  add(turnWord(o.turn, o.uTurn));
  return out;
}

/** Le frecce da disegnare: al massimo tre, con un nome ciascuna e tutti diversi. */
export function turnChoices(options: TurnOptionLike[], selected: number, max = MAX_TURNS): TurnChoice[] {
  const shown = pickTurns(options, selected, max);
  const cands = shown.map((i) => candidates(options[i]));
  const pick = shown.map(() => 0);
  const names = () => shown.map((_, k) => cands[k][Math.min(pick[k], cands[k].length - 1)]);
  // due frecce con lo stesso nome: tutte e due passano al nome dopo (paese → strada → direzione)
  for (let guard = 0; guard < 6; guard++) {
    const now = names();
    let moved = false;
    now.forEach((n, k) => {
      if (options[shown[k]].onRoute) return;
      const dup = now.some((m, j) => j !== k && m === n);
      if (dup && pick[k] < cands[k].length - 1) {
        pick[k]++;
        moved = true;
      }
    });
    if (!moved) break;
  }
  const final = names();
  // ultima rete: se due nomi restano uguali, il secondo dice anche il lato
  final.forEach((n, k) => {
    for (let j = 0; j < k; j++) {
      if (final[j] !== n) continue;
      const o = options[shown[k]];
      const word = o.exit ? `${o.exit}ª uscita` : turnWord(o.turn, o.uTurn);
      final[k] = word !== n ? `${n}, ${word.charAt(0).toLowerCase()}${word.slice(1)}` : `${n} ${k + 1}`;
    }
  });
  return shown.map((i, k) => ({
    index: i,
    name: final[k],
    turn: options[i].turn,
    uTurn: options[i].uTurn,
    exit: options[i].exit,
    onRoute: options[i].onRoute,
    selected: i === selected,
  }));
}
