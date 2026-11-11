import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rullo } from '../src/ride/contract';
import type { TrainerSnapshot } from '../src/sim/source';
import { capacitaDa, collaudoAttivo, collaudoDa, provaDaLink, puoPedalare, rulloDa, statoDa, tipiAmmessi } from '../src/sim/rullo';
import { useApp } from '../src/store/useApp';
import { DEFAULT_SETTINGS } from '../src/domain/types';

function snap(p: Omit<Partial<TrainerSnapshot>, 'services'> & { services?: Partial<TrainerSnapshot['services']> }): TrainerSnapshot {
  return {
    mode: 'bluetooth',
    deviceName: 'Rullo',
    control: 'none',
    simulation: 'none',
    status: 'connected',
    busy: false,
    ...p,
    services: { ftms: false, power: false, hr: false, csc: false, ...p.services },
  };
}

const R = (s: TrainerSnapshot, prova = false): Rullo => rulloDa(s, { supporto: 'si', ricordato: null, prova });

/** I sette stati di A8 del piano U. */
const STATI: Record<string, TrainerSnapshot> = {
  mai: snap({ status: 'idle', deviceName: null }),
  rullo: snap({ services: { ftms: true }, control: 'granted', can: { erg: true, sim: true } }),
  'rullo senza controllo': snap({ services: { ftms: true }, control: 'unsupported', can: { erg: false, sim: false } }),
  potenza: snap({ services: { power: true } }),
  cardio: snap({ services: { hr: true } }),
  cadenza: snap({ services: { csc: true } }),
  perso: snap({ services: { ftms: true }, status: 'disconnected', can: { erg: true, sim: true } }),
};

function storage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe('tipiAmmessi: cosa sa fare quello che è collegato decide i tipi (A8)', () => {
  const tutti = ['libera', 'fissa', 'allenamento', 'allora'];
  const bersaglio = ['libera', 'allenamento', 'allora'];
  it.each([
    ['mai', []],
    ['rullo', tutti],
    ['rullo senza controllo', bersaglio],
    ['potenza', bersaglio],
    ['cardio', []],
    ['cadenza', []],
    ['perso', []],
  ] as const)('%s', (stato, atteso) => {
    const r = R(STATI[stato]);
    expect(tipiAmmessi(r)).toEqual(atteso);
    expect(puoPedalare(r)).toBe(atteso.length > 0);
  });

  it('con la prova: tutti, finché non c’è una potenza vera', () => {
    for (const s of ['mai', 'cardio', 'cadenza', 'perso']) expect(tipiAmmessi(R(STATI[s], true))).toEqual(tutti);
    expect(R(STATI.mai, true).prova).toBe(true);
  });

  it('il rullo collegato vince sempre sulla prova (A5)', () => {
    expect(R(STATI.rullo, true).prova).toBe(false);
    expect(tipiAmmessi(R(STATI.potenza, true))).toEqual(bersaglio);
  });

  it('le capacità: pendenza ed ERG solo dal rullo che le concede', () => {
    expect(capacitaDa(STATI.rullo)).toEqual({ pendenza: true, erg: true, potenza: true, cardio: false, cadenza: true });
    expect(capacitaDa(STATI.potenza)).toEqual({ pendenza: false, erg: false, potenza: true, cardio: false, cadenza: true });
    expect(capacitaDa(STATI.perso).potenza).toBe(false);
    // il simulatore non è un sensore
    expect(capacitaDa(snap({ mode: 'simulator', status: 'idle' })).potenza).toBe(false);
  });

  it('gli stati del rullo', () => {
    expect(statoDa(STATI.mai)).toBe('mai');
    expect(statoDa(snap({ status: 'connecting' }))).toBe('cerco');
    expect(statoDa(STATI.rullo)).toBe('collegato');
    expect(statoDa(STATI.perso)).toBe('perso');
    expect(statoDa(snap({ status: 'failed' }))).toBe('fallito');
    expect(statoDa(snap({ status: 'cancelled' }))).toBe('mai');
    expect(R(STATI.rullo).nome).toBe('Rullo');
    expect(R(STATI.perso).nome).toBeNull();
  });
});

describe('il rullo finto dei collaudi (A23): solo da localStorage, mai da un link', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('si legge solo da orobia.collaudo', () => {
    expect(collaudoDa(storage({ 'orobia.collaudo': 'rullo' }))).toBe('rullo');
    expect(collaudoDa(storage({ 'orobia.collaudo': 'potenza' }))).toBe('potenza');
    expect(collaudoDa(storage({ 'orobia.collaudo': 'simulatore' }))).toBeNull();
    expect(collaudoDa(storage())).toBeNull();
    expect(collaudoDa(null)).toBeNull();
  });

  it('un link con ?collaudo=rullo non accende niente', () => {
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('window', { location: { search: '?collaudo=rullo&orobia.collaudo=rullo' } });
    vi.stubGlobal('location', { search: '?collaudo=rullo&orobia.collaudo=rullo' });
    expect(collaudoAttivo()).toBeNull();
    vi.stubGlobal('localStorage', storage({ 'orobia.collaudo': 'rullo' }));
    expect(collaudoAttivo()).toBe('rullo');
  });

  it('?prova=1 accende la prova per la scheda, ?prova=0 la spegne', () => {
    const s = storage();
    provaDaLink('?world=bergamo&prova=1', s);
    expect(s.getItem('orobia.prova')).toBe('1');
    provaDaLink('?prova=0', s);
    expect(s.getItem('orobia.prova')).toBeNull();
  });
});

describe('il rullo dell’app', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('sessionStorage', storage());
    useApp.setState({ settings: { ...DEFAULT_SETTINGS, prova: false } });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function fresh() {
    const m = await import('../src/sim/rullo');
    const { useApp: app } = await import('../src/store/useApp');
    app.setState({ settings: { ...DEFAULT_SETTINGS, prova: false } });
    return { ...m, app };
  }

  it('con la prova spenta la sorgente non è mai il simulatore', async () => {
    const { rullo } = await fresh();
    const t = rullo.sorgente();
    expect(t.mode).toBe('bluetooth');
    await t.useSimulator();
    expect(t.mode).toBe('bluetooth');
    expect(rullo.sorgente().mode).toBe('bluetooth');
  });

  it('con la prova accesa e niente rullo: il simulatore; spenta, si torna al rullo', async () => {
    const { rullo, app, rulloAdesso } = await fresh();
    app.setState({ settings: { ...DEFAULT_SETTINGS, prova: true } });
    expect(rulloAdesso().prova).toBe(true);
    expect(rullo.sorgente().mode).toBe('simulator');
    app.setState({ settings: { ...DEFAULT_SETTINGS, prova: false } });
    expect(rullo.sorgente().mode).toBe('bluetooth');
    expect(puoPedalare(rulloAdesso())).toBe(false);
  });

  it('un solo rullo per l’app: collegato una volta, resta per la corsa dopo', async () => {
    localStorage.setItem('orobia.collaudo', 'rullo');
    const { rullo, rulloAdesso, app } = await fresh();
    app.setState({ settings: { ...DEFAULT_SETTINGS, prova: true } });
    await rullo.collega();
    const r = rulloAdesso();
    expect(r.stato).toBe('collegato');
    expect(r.nome).toBe('Rullo di collaudo');
    expect(r.ricordato).toBe('Rullo di collaudo');
    expect(r.prova).toBe(false);
    expect(tipiAmmessi(r)).toEqual(['libera', 'fissa', 'allenamento', 'allora']);
    const prima = rullo.sorgente();
    expect(prima.mode).toBe('bluetooth');
    rullo.riposa();
    const dopo = rullo.sorgente();
    expect(dopo).toBe(prima);
    expect(rulloAdesso().stato).toBe('collegato');
    rullo.scollega();
    expect(rulloAdesso().stato).toBe('mai');
    expect(rulloAdesso().ricordato).toBe('Rullo di collaudo');
  });

  it('il rullo finto pedala: la potenza segue il bersaglio ERG e il comando parte', async () => {
    localStorage.setItem('orobia.collaudo', 'rullo');
    const { rullo } = await fresh();
    await rullo.collega();
    const t = rullo.sorgente();
    for (let i = 0; i < 200; i++) t.update({ dt: 0.05, grade: 0.03, targetPower: 200, effort: 0.6, ftp: 250, maxHr: 186, restHr: 52, erg: true, crr: 0.004, cw: 0.39 });
    expect(Math.abs(t.power - 200)).toBeLessThan(15);
    expect(t.sent.some((b) => b[0] === 0x05 && b[1] === 200)).toBe(true);
    // in ERG nessun comando di pendenza
    expect(t.sent.some((b) => b[0] === 0x11)).toBe(false);
  });

  it('col solo misuratore di potenza nessun comando al rullo', async () => {
    localStorage.setItem('orobia.collaudo', 'potenza');
    const { rullo, rulloAdesso } = await fresh();
    await rullo.collega();
    expect(tipiAmmessi(rulloAdesso())).toEqual(['libera', 'allenamento', 'allora']);
    const t = rullo.sorgente();
    for (let i = 0; i < 40; i++) t.update({ dt: 0.05, grade: 0.03, targetPower: 200, effort: 0.6, ftp: 250, maxHr: 186, restHr: 52, erg: true, crr: 0.004, cw: 0.39 });
    expect(t.sent).toHaveLength(0);
    expect(t.power).toBeGreaterThan(0);
  });
});
