import { describe, expect, it } from 'vitest';
import type { Capacita, Rullo } from '../src/ride/contract';
import { vistaPedala, type Pannello } from '../src/pages/pedala/vista';

/*
 * Piano U, § 3 «Prove»: cosa mostra Pedala per gli 8 stati del rullo, con la prova spenta e accesa.
 * Senza potenza e senza prova: un pannello e nient'altro (nessun Dove, Come, Via).
 */

const NIENTE: Capacita = { pendenza: false, erg: false, potenza: false, cardio: false, cadenza: false };
const KICKR: Capacita = { pendenza: true, erg: true, potenza: true, cardio: false, cadenza: true };
const ASSIOMA: Capacita = { pendenza: false, erg: false, potenza: true, cardio: false, cadenza: true };
const HRM: Capacita = { ...NIENTE, cardio: true };

const base: Rullo = { stato: 'mai', supporto: 'si', nome: null, ricordato: null, sa: NIENTE, prova: false };
const STATI: Record<string, Rullo> = {
  mai: base,
  cerco: { ...base, stato: 'cerco' },
  fallito: { ...base, stato: 'fallito' },
  ios: { ...base, supporto: 'ios' },
  ricordato: { ...base, stato: 'mai', ricordato: 'Wahoo KICKR' },
  cardio: { ...base, stato: 'collegato', nome: 'HRM-Pro', sa: HRM },
  potenza: { ...base, stato: 'collegato', nome: 'Assioma DUO', sa: ASSIOMA },
  rullo: { ...base, stato: 'collegato', nome: 'Wahoo KICKR', sa: KICKR },
};
/** la prova vale solo senza potenza vera (il rullo vince: A5) */
const conProva = (r: Rullo): Rullo => ({ ...r, prova: !r.sa.potenza });

const ATTESO: Record<string, Pannello | null> = { mai: 'mai', cerco: 'cerco', fallito: 'fallito', ios: 'ios', ricordato: 'ricordato', cardio: 'cardio', potenza: null, rullo: null };

describe('Pedala, prova spenta', () => {
  for (const [nome, r] of Object.entries(STATI)) {
    it(`${nome}: ${ATTESO[nome] ? `il pannello «${ATTESO[nome]}» e nient'altro` : 'Dove, Come, Via'}`, () => {
      const v = vistaPedala(r, 'online');
      expect(v.pannello).toBe(ATTESO[nome]);
      if (ATTESO[nome]) {
        expect(v.blocchi).toEqual(['rullo']);
        expect(v.tipi).toEqual([]);
      } else {
        expect(v.blocchi).toEqual(expect.arrayContaining(['dove', 'come', 'via']));
        expect(v.blocchi).not.toContain('rullo');
        expect(v.chip).toBe('rullo');
      }
    });
  }
  it('i tipi decisi da cosa è collegato (A8)', () => {
    expect(vistaPedala(STATI.rullo, 'online').tipi).toEqual(['libera', 'fissa', 'allenamento']);
    expect(vistaPedala(STATI.potenza, 'online').tipi).toEqual(['libera', 'allenamento']);
    expect(vistaPedala(STATI.cardio, 'online').tipi).toEqual([]);
  });
});

describe('Pedala, prova accesa', () => {
  for (const [nome, r0] of Object.entries(STATI)) {
    it(`${nome}: si pedala`, () => {
      const r = conProva(r0);
      const v = vistaPedala(r, 'online');
      expect(v.pannello).toBeNull();
      expect(v.blocchi).toEqual(expect.arrayContaining(['dove', 'come', 'via']));
      // il rullo collegato vince sulla prova: il chip dice il rullo, non «Prova»
      expect(v.chip).toBe(r0.sa.potenza ? 'rullo' : 'prova');
      expect(v.tipi.length).toBeGreaterThanOrEqual(2);
    });
  }
  it('con la prova e un misuratore di potenza i tipi sono quelli del misuratore', () => {
    expect(vistaPedala(conProva(STATI.potenza), 'online').tipi).toEqual(['libera', 'allenamento']);
  });
});

describe('i blocchi di Pedala', () => {
  const r = STATI.rullo;
  const ganda = { kind: 'percorso', world: 'bergamo', ride: 'ganda' } as const;
  it('la sessione solo in rete, il programma sempre, le missioni sempre', () => {
    expect(vistaPedala(r, 'online', { sessione: true, programma: true }).blocchi.slice(0, 2)).toEqual(['sessione', 'programma']);
    const off = vistaPedala(r, 'offline', { sessione: true, programma: true });
    expect(off.blocchi).not.toContain('sessione');
    expect(off.blocchi).toContain('programma');
    expect(off.blocchi).toContain('missioni');
    expect(off.offline).toBe(true);
  });
  it('il fantasma solo dove c’è un record, mai con un allenamento (A9)', () => {
    expect(vistaPedala(r, 'online', { dove: ganda, record: true, tipo: 'libera' }).blocchi).toContain('fantasma');
    expect(vistaPedala(r, 'online', { dove: ganda, record: true, tipo: 'fissa' }).blocchi).toContain('fantasma');
    expect(vistaPedala(r, 'online', { dove: ganda, record: true, tipo: 'allenamento' }).blocchi).not.toContain('fantasma');
    expect(vistaPedala(r, 'online', { dove: ganda, record: false, tipo: 'libera' }).blocchi).not.toContain('fantasma');
  });
  it('i giri su un anello; niente giri sul giro libero, su una grande salita, su un tuo giro', () => {
    expect(vistaPedala(r, 'online', { dove: ganda, giri: true }).blocchi).toContain('giri');
    expect(vistaPedala(r, 'online', { dove: { kind: 'libero', world: 'bergamo', edge: 1, dir: 1, s: 0 }, giri: true }).blocchi).not.toContain('giri');
    expect(vistaPedala(r, 'online', { dove: { kind: 'salita', route: 'mortirolo-mazzo' }, giri: true }).blocchi).not.toContain('giri');
    expect(vistaPedala(r, 'online', { dove: { kind: 'giro', replay: 'x' }, giri: true }).blocchi).not.toContain('giri');
  });
  it('su un tuo giro con la potenza «Watt di allora» prende il posto di Allenamento (A7)', () => {
    const giro = { kind: 'giro', replay: 'x' } as const;
    expect(vistaPedala(r, 'online', { dove: giro, allora: true }).tipi).toEqual(['libera', 'fissa', 'allora']);
    expect(vistaPedala(r, 'online', { dove: giro, allora: false }).tipi).toEqual(['libera', 'fissa']);
  });
  it('l’ordine: Dove, Come, Via, poi le missioni', () => {
    const b = vistaPedala(r, 'online', { dove: ganda, giri: true, record: true }).blocchi;
    expect(b).toEqual(['dove', 'giri', 'come', 'fantasma', 'via', 'missioni']);
  });
});
