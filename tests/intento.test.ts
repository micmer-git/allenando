import { describe, expect, it } from 'vitest';
import type { Intento } from '../src/ride/contract';
import { giriDi, intentoDaSearch, intentoInSearch, wattFissi } from '../src/ride/intento';

const q = (s: string) => new URLSearchParams(s);

describe('intento: il link della corsa nei due versi', () => {
  const casi: Intento[] = [
    { dove: { kind: 'percorso', world: 'bergamo', ride: 'ganda' }, tipo: 'libera' },
    { dove: { kind: 'percorso', world: 'bergamo', ride: 'ganda' }, tipo: 'fissa', watt: 165, giri: 2, fantasma: false },
    { dove: { kind: 'piano', world: 'bergamo', plan: 'p-123' }, tipo: 'allenamento', workout: 'sweet-spot-3x8', giri: 3 },
    { dove: { kind: 'libero', world: 'sellaronda', edge: 412, dir: -1, s: 37 }, tipo: 'libera' },
    { dove: { kind: 'salita', route: 'mortirolo-mazzo' }, tipo: 'allenamento', workout: 'vo2-5x3', fantasma: true },
    { dove: { kind: 'giro', replay: 'ride-1', sec: 'km:2-5' }, tipo: 'allora' },
    { dove: { kind: 'giro', replay: 'ride-1' }, tipo: 'allora', fantasma: false },
    { dove: { kind: 'giro', replay: 'ride-2' }, tipo: 'libera', fantasma: true },
    { dove: { kind: 'giro', replay: 'ride-2' }, tipo: 'libera', fantasma: false },
    { dove: { kind: 'percorso', world: 'bergamo', ride: 'ganda' }, tipo: 'libera', session: 'volate-ganda', room: 'ABCD', giri: 1 },
  ];
  it.each(casi.map((c) => [intentoInSearch(c), c] as const))('andata e ritorno: %s', (search, c) => {
    expect(intentoDaSearch(q(search))).toEqual(c);
  });

  it('un link che non dice dove: null', () => {
    expect(intentoDaSearch(q(''))).toBeNull();
    expect(intentoDaSearch(q('tipo=fissa&watt=200'))).toBeNull();
    expect(intentoDaSearch(q('world=bergamo'))).toBeNull();
  });

  it('i watt fissi stanno fra 50 e 1000, a passi di 5', () => {
    expect(wattFissi(163)).toBe(165);
    expect(wattFissi(12)).toBe(50);
    expect(wattFissi(4000)).toBe(1000);
    expect(intentoDaSearch(q('route=x&tipo=fissa&watt=162'))?.watt).toBe(160);
  });

  it('i giri stanno fra 1 e 20', () => {
    expect(intentoDaSearch(q('route=x&giri=0'))?.giri).toBe(1);
    expect(intentoDaSearch(q('route=x&giri=99'))?.giri).toBe(20);
    expect(giriDi({})).toBe(1);
    expect(giriDi({ giri: 3 })).toBe(3);
  });

  it('«allora» fuori da un tuo giro è una pedalata libera', () => {
    expect(intentoDaSearch(q('world=bergamo&ride=ganda&tipo=allora'))?.tipo).toBe('libera');
    expect(intentoInSearch({ dove: { kind: 'salita', route: 'x' }, tipo: 'allora' })).toBe('route=x');
  });
});

describe('intento: i link di oggi restano validi (§ 2.2)', () => {
  const righe: [string, Partial<Intento>][] = [
    ['world=bergamo&ride=ganda', { dove: { kind: 'percorso', world: 'bergamo', ride: 'ganda' }, tipo: 'libera' }],
    ['world=bergamo&plan=k1', { dove: { kind: 'piano', world: 'bergamo', plan: 'k1' }, tipo: 'libera' }],
    ['world=bergamo&edge=12&dir=-1&s=40', { dove: { kind: 'libero', world: 'bergamo', edge: 12, dir: -1, s: 40 }, tipo: 'libera' }],
    ['route=selvino-nembro', { dove: { kind: 'salita', route: 'selvino-nembro' }, tipo: 'libera' }],
    ['route=selvino-nembro&workout=sst', { dove: { kind: 'salita', route: 'selvino-nembro' }, tipo: 'allenamento', workout: 'sst' }],
    ['replay=r1&mode=grade', { dove: { kind: 'giro', replay: 'r1' }, tipo: 'libera', fantasma: false }],
    ['replay=r1&mode=ghost', { dove: { kind: 'giro', replay: 'r1' }, tipo: 'libera', fantasma: true }],
    ['replay=r1&mode=power', { dove: { kind: 'giro', replay: 'r1' }, tipo: 'allora' }],
    ['route=selvino-nembro&ghost=r9', { dove: { kind: 'salita', route: 'selvino-nembro' }, tipo: 'libera', fantasma: true }],
  ];
  it.each(righe)('%s', (search, atteso) => {
    expect(intentoDaSearch(q(search))).toEqual(atteso);
  });

  it('sessione, stanza e tratto passano invariati; resume e at restano nel link', () => {
    const i = intentoDaSearch(q('world=bergamo&ride=ganda&session=s1&room=R2&resume=1&at=300'))!;
    expect(i.session).toBe('s1');
    expect(i.room).toBe('R2');
    expect(intentoDaSearch(q('replay=r1&mode=ghost&sec=t:60-600'))?.dove).toEqual({ kind: 'giro', replay: 'r1', sec: 't:60-600' });
  });

  it('un allenamento sul percorso diventa il tipo «allenamento»', () => {
    const i = intentoDaSearch(q('world=bergamo&ride=ganda&workout=w1'))!;
    expect(i.tipo).toBe('allenamento');
    expect(i.workout).toBe('w1');
    // e torna come workout=, che le pagine di oggi leggono
    expect(q(intentoInSearch(i)).get('workout')).toBe('w1');
  });
});
