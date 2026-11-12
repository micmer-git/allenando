import type { Dove, Rete, Rullo, Tipo } from '@/ride/contract';
import { tipiAmmessi } from '@/sim/rullo';

/*
 * Cosa mostra Pedala, deciso fuori da React (piano U, § 3, prove in tests/pedala.test.ts).
 * Senza un sensore di potenza e senza la prova: un pannello del rullo e nient'altro. Con la
 * potenza (o la prova): Dove, Come, Via, e le righe di Oggi solo quando valgono.
 */

/** Il pannello del rullo quando non si può pedalare (wireframe B1–B5, C5). */
export type Pannello = 'mai' | 'cerco' | 'fallito' | 'ios' | 'manca' | 'ricordato' | 'cardio';

export type Blocco = 'rullo' | 'sessione' | 'programma' | 'dove' | 'giri' | 'come' | 'fantasma' | 'via' | 'missioni';

export interface VistaPedala {
  /** null quando si può pedalare */
  pannello: Pannello | null;
  blocchi: Blocco[];
  /** il segmento Come, nell'ordine */
  tipi: Tipo[];
  /** il chip in alto a destra: il rullo, la prova, o niente */
  chip: 'rullo' | 'prova' | 'manuale' | null;
  offline: boolean;
}

export interface Contesto {
  manuale?: boolean;
  /** una sessione aperta adesso (si entra) */
  sessione?: boolean;
  /** un allenamento del programma per oggi */
  programma?: boolean;
  dove?: Dove | null;
  tipo?: Tipo;
  /** c'è un record (o il tuo giro) per il fantasma */
  record?: boolean;
  /** il Dove si ripete a giri: un anello, o un percorso aperto (andata e ritorno) */
  giri?: boolean;
  /** il giro rifatto ha la potenza: «Watt di allora» al posto di Allenamento */
  allora?: boolean;
}

/**
 * I tipi del segmento Come (A7, A8): quelli che il rullo permette, e «Watt di allora» solo su un
 * tuo giro con la potenza, al posto di Allenamento.
 */
export function tipiDi(r: Rullo, dove?: Dove | null, allora = false, manuale = false): Tipo[] {
  const ok: Tipo[] = manuale ? ['libera', 'allenamento'] : tipiAmmessi(r);
  if (dove?.kind === 'giro') return ok.filter((t) => t !== 'allenamento' && (t !== 'allora' || allora));
  return ok.filter((t) => t !== 'allora');
}

export function pannelloDi(r: Rullo): Pannello {
  if (r.stato === 'cerco') return 'cerco';
  if (r.supporto === 'ios') return 'ios';
  if (r.supporto === 'manca') return 'manca';
  if (r.stato === 'fallito') return 'fallito';
  if (r.stato === 'collegato' && !r.sa.potenza) return 'cardio';
  if (r.ricordato && r.stato !== 'collegato') return 'ricordato';
  return 'mai';
}

export function vistaPedala(r: Rullo, rete: Rete, c: Contesto = {}): VistaPedala {
  const offline = rete === 'offline';
  if (!c.manuale && tipiAmmessi(r).length === 0) return { pannello: pannelloDi(r), blocchi: ['rullo'], tipi: [], chip: r.stato === 'collegato' ? 'rullo' : null, offline };
  const tipi = tipiDi(r, c.dove, !!c.allora, !!c.manuale);
  const tipo = c.tipo && tipi.includes(c.tipo) ? c.tipo : tipi[0];
  const blocchi: Blocco[] = [];
  // la sessione si pedala solo in rete (il gruppo è virtuale, la classifica no: A16)
  if (c.sessione && !offline && !c.manuale) blocchi.push('sessione');
  if (c.programma) blocchi.push('programma');
  blocchi.push('dove');
  // i giri: su un anello sempre, su un percorso aperto solo con un allenamento (va e torna, A12–A13)
  if (c.dove && c.giri && c.dove.kind !== 'libero' && c.dove.kind !== 'giro' && c.dove.kind !== 'salita') blocchi.push('giri');
  blocchi.push('come');
  // il fantasma: solo dove c'è un record, mai con un allenamento (A9)
  if (c.record && tipo !== 'allenamento' && tipo !== 'allora') blocchi.push('fantasma');
  blocchi.push('via', 'missioni');
  return { pannello: null, blocchi, tipi, chip: c.manuale ? 'manuale' : r.sa.potenza ? 'rullo' : 'prova', offline };
}
