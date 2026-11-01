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
