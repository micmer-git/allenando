/** Come si pedala. 'allora' = i watt di un giro rifatto (ERG dal file). */
export type Tipo = 'libera' | 'fissa' | 'allenamento' | 'allora';

/** Dove si pedala: uno solo. */
export type Dove =
  | { kind: 'percorso'; world: string; ride: string }
  | { kind: 'piano'; world: string; plan: string }        // anello suggerito o A → B (savePlan)
  | { kind: 'libero'; world: string; edge: number; dir: 1 | -1; s: number }
  | { kind: 'salita'; route: string }                      // grande salita fuori dal mondo
  | { kind: 'giro'; replay: string; sec?: string };       // un tuo giro

export interface Intento {
  dove: Dove;
  tipo: Tipo;
  /** Potenza immessa a mano, sempre una pedalata virtuale. */
  manuale?: boolean;
  /** ERG: 50–1000 W. Manuale: 0–1000 W. */
  watt?: number;
  /** 'allenamento': id */
  workout?: string;
  /** passaggi: giri su un anello, tratte su un percorso aperto (2 = andata e ritorno). Default 1. */
  giri?: number;
  /** default: true dove c'è un fantasma */
  fantasma?: boolean;
  session?: string;
  room?: string;
}

/** Cosa sa fare quello che è collegato. */
export interface Capacita { pendenza: boolean; erg: boolean; potenza: boolean; cardio: boolean; cadenza: boolean }

export type StatoRullo = 'mai' | 'cerco' | 'collegato' | 'perso' | 'fallito';
export type Supporto = 'si' | 'ios' | 'manca';

export interface Rullo {
  stato: StatoRullo;
  supporto: Supporto;
  /** «Wahoo KICKR», «KICKR + HRM-Pro» */
  nome: string | null;
  /** l'ultimo collegato, per «Ricollega» */
  ricordato: string | null;
  sa: Capacita;
  /** prova accesa e nessuna potenza vera collegata */
  prova: boolean;
}

export type PaccoMondo = 'intero' | 'leggero' | 'scarico' | 'niente';
export type Rete = 'online' | 'offline';
