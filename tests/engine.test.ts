import { describe, expect, it } from 'vitest';
import { parseNumberInput } from '../src/domain/format';
import { STANDARD_AIR } from '../src/domain/physics';
import { getTrack } from '../src/domain/track';
import { builtinById } from '../src/domain/workouts';
import { RideEngine } from '../src/sim/engine';
import { SimulatorSource } from '../src/sim/simulator';

function engine(workoutId?: string) {
  return new RideEngine({
    track: getTrack(),
    source: new SimulatorSource(),
    physics: { massKg: 80, cda: 0.32, crr: 0.004, ...STANDARD_AIR },
    ftp: 250,
    maxHr: 186,
    restHr: 52,
    lthr: 166,
    weightKg: 72,
    workout: workoutId ? builtinById(workoutId) : null,
    withCamilla: true,
    crr: 0.004,
    cw: 0.39,
  });
}

describe('motore del giro', () => {
  it('in ERG il bersaglio è giusto già al secondo zero', () => {
    // risveglio: primo blocco al 50% della FTP
    expect(engine('risveglio').targetPower).toBe(125);
  });

  it('«Continua a pedalare» riprende il giro senza campioni in più', () => {
    const ride = engine();
    for (let i = 0; i < 200; i++) ride.tick(0.05); // 10 s
    const before = ride.samples.length;
    ride.tick(0.03);
    ride.finish();
    expect(ride.phase).toBe('finished');
    ride.reopen();
    expect(ride.phase).toBe('riding');
    expect(ride.samples.length).toBe(before);
    for (let i = 0; i < 100; i++) ride.tick(0.05);
    ride.finish();
    const ts = ride.samples.map((s) => s.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(new Set(ts).size).toBe(ts.length);
    expect(ride.toRide('prova').durationSec).toBeGreaterThanOrEqual(15);
  });
});

describe('i tipi di attività (M1)', () => {
  function con(opts: Partial<ConstructorParameters<typeof RideEngine>[0]>) {
    const source = new SimulatorSource();
    const calls: { erg: boolean; targetPower: number | null }[] = [];
    const orig = source.update.bind(source);
    source.update = (input) => {
      calls.push({ erg: input.erg, targetPower: input.targetPower });
      orig(input);
    };
    const e = new RideEngine({
      track: getTrack(),
      source,
      physics: { massKg: 80, cda: 0.32, crr: 0.004, ...STANDARD_AIR },
      ftp: 250,
      maxHr: 186,
      restHr: 52,
      lthr: 166,
      weightKg: 72,
      withCamilla: false,
      crr: 0.004,
      cw: 0.39,
      ...opts,
    });
    return { e, calls };
  }

  it('Potenza fissa: ERG costante, − + di 5 W, nei limiti', () => {
    const { e, calls } = con({ tipo: 'fissa', watt: 165 });
    expect(e.tipo).toBe('fissa');
    expect(e.mode).toBe('erg');
    expect(e.targetPower).toBe(165);
    e.tick(0.05);
    expect(calls.at(-1)).toEqual({ erg: true, targetPower: 165 });
    e.setWattFissi(170);
    expect(e.wattFissi).toBe(170);
    expect(e.targetPower).toBe(170);
    e.tick(0.05);
    expect(calls.at(-1)).toEqual({ erg: true, targetPower: 170 });
    e.setWattFissi(2000);
    expect(e.wattFissi).toBe(1000);
    e.setWattFissi(3);
    expect(e.wattFissi).toBe(50);
  });

  it('Potenza fissa la prima volta: il 75 % dell’FTP, a passi di 5', () => {
    expect(con({ tipo: 'fissa' }).e.wattFissi).toBe(190);
  });

  it('Libera e Allenamento non cambiano coi − +', () => {
    const { e } = con({});
    expect(e.tipo).toBe('libera');
    e.setWattFissi(200);
    expect(e.mode).toBe('free');
    expect(e.wattFissi).toBeNull();
    expect(con({ workout: builtinById('risveglio') }).e.tipo).toBe('allenamento');
    // un allenamento senza allenamento è una pedalata libera
    expect(con({ tipo: 'allenamento' }).e.tipo).toBe('libera');
  });

  it('a bersaglio: il blocco si mostra, al rullo non va nessun ERG', () => {
    const { e, calls } = con({ workout: builtinById('risveglio'), ergAlRullo: false });
    expect(e.aBersaglio).toBe(true);
    expect(e.mode).toBe('erg');
    expect(e.targetPower).toBe(125);
    for (let i = 0; i < 20; i++) e.tick(0.05);
    expect(calls.every((c) => !c.erg && c.targetPower == null)).toBe(true);
    expect(e.targetPower).toBe(125);
  });

  it('il punto di ripresa tiene tipo, watt di adesso, passaggi e prova', () => {
    const { e } = con({ tipo: 'fissa', watt: 200 });
    e.giri = 3;
    e.prova = true;
    for (let i = 0; i < 40; i++) e.tick(0.05);
    e.setWattFissi(240);
    const cp = e.checkpoint();
    expect(cp).toMatchObject({ tipo: 'fissa', wattFissi: 240, giri: 3, prova: true });
    const { e: back } = con({ tipo: 'fissa', watt: 200 });
    back.restore(cp);
    expect(back.wattFissi).toBe(240);
    expect(back.targetPower).toBe(240);
    const ride = e.toRide('Prova');
    expect(ride).toMatchObject({ tipo: 'fissa', giri: 3, prova: true });
  });
});

describe('numeri scritti a mano', () => {
  it('accetta la virgola decimale', () => {
    expect(parseNumberInput('68,5', 35, 180, 78)).toBe(68.5);
    expect(parseNumberInput(' 72.4 ', 35, 180, 78)).toBe(72.4);
  });

  it('vuoto o illeggibile torna al valore di prima', () => {
    expect(parseNumberInput('', 35, 180, 78)).toBe(78);
    expect(parseNumberInput('settanta', 35, 180, 78)).toBe(78);
  });

  it('tiene il numero nei limiti', () => {
    expect(parseNumberInput('2500', 50, 550, 220)).toBe(550);
    expect(parseNumberInput('0', 50, 550, 220)).toBe(50);
  });
});
