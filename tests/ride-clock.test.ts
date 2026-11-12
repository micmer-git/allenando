import { describe, expect, it } from 'vitest';
import { STANDARD_AIR, steadyStateSpeed } from '../src/domain/physics';
import type { Track } from '../src/domain/track';
import { RideClock } from '../src/sim/clock';
import { rideFromCheckpoint, type RideCheckpoint } from '../src/sim/recovery';
import { RideEngine } from '../src/sim/engine';
import { SimulatorSource } from '../src/sim/simulator';

const physics = { ...STANDARD_AIR, massKg: 83, cda: 0.32, crr: 0.004 };

function fixture(grade = 0, watts = 200) {
  const source = new SimulatorSource();
  source.power = watts;
  source.cadence = 80;
  source.update = () => {};
  const track: Track = {
    length: 100000, closed: false, points: [], altitudeBase: 0, halfWidth: 4, hairpins: [],
    poseAt(distance) { return { x: 0, y: grade*distance, z: distance, altitude: grade*distance, grade, heading: 0, distance }; },
  };
  const engine = new RideEngine({ source, track, physics, ftp: 250, maxHr: 180, restHr: 50, lthr: 165,
    weightKg: 75, withCamilla: false, crr: physics.crr, cw: physics.cda*physics.rho });
  let now = 0;
  const clock = new RideClock(now,(dt,at) => engine.tick(dt,at),() => engine.phase !== 'riding');
  const sync = () => clock.pulse(now);
  engine.syncClock = sync;
  return { engine, source, at(ms: number) { now = ms; }, pulse(ms: number) { now = ms; sync(); } };
}

describe('orologio indipendente dalla scena', () => {
  it.each([0,0.05])('misura cinque minuti a 200 W anche con frame lenti o sospesi, pendenza %s', grade => {
    const run = (everyMs: number) => {
      const { engine, pulse } = fixture(grade);
      for (let t=everyMs; t<300000; t+=everyMs) pulse(t);
      pulse(300000);
      pulse(300000); // stesso istante per frame e timer
      return engine;
    };
    const fast = run(1000/60);
    for (const e of [fast,run(200),run(60000),run(300000)]) {
      expect(e.elapsed).toBeCloseTo(300,6);
      expect(e.samples.map(s => s.t)).toEqual(Array.from({length:300},(_,i) => i+1));
      expect(Math.abs(e.distance-fast.distance)).toBeLessThan(0.1);
      expect(e.speed*3.6).toBeCloseTo(steadyStateSpeed(200,grade,physics)*3.6,2);
    }
  });

  it('conserva la frazione di secondo al ripristino senza arrotondare il termine', () => {
    const a=fixture(); a.pulse(7260);
    const b=fixture(); b.engine.restore(a.engine.checkpoint());
    b.pulse(740); b.pulse(1120); b.engine.finish();
    expect(b.engine.samples.at(-2)?.t).toBe(8);
    expect(b.engine.samples.at(-1)?.t).toBeCloseTo(8.38,7);
    expect(b.engine.toRide('prova').durationSec).toBeCloseTo(8.38,7);
  });

  it('salva i soli metri pedalati anche quando la strada inizia al km 4', () => {
    const a = fixture();
    a.engine.startAt(4000);
    expect(a.engine.distance).toBe(4000);
    expect(a.engine.odometer).toBe(0);
    a.pulse(60000);
    const e = a.engine.checkpoint();
    const b = fixture(); b.engine.restore(e);
    expect(b.engine.distance).toBeCloseTo(4000+a.engine.odometer,7);
    expect(b.engine.odometer).toBeCloseTo(a.engine.odometer,7);
    const cp: RideCheckpoint = { v: 1, savedAt: '', search: 'at=4000', name: 'M', ftp: 250, lthr:165,
      engine:e, game:{ results:[],pois:[] }, routeId:'ganda' };
    expect(rideFromCheckpoint(cp).distanceM).toBeCloseTo(a.engine.odometer,7);
    expect(rideFromCheckpoint(cp).routeId).toBeUndefined();
    // Un checkpoint di prima della correzione aveva i campioni nella coordinata del percorso.
    const legacy = {...cp,engine:{...e,startDistance:undefined,samples:e.samples.map(p => ({...p,distance:p.distance+4000}))}};
    expect(rideFromCheckpoint(legacy).samples.at(-1)?.distance).toBeCloseTo(a.engine.odometer,7);
    expect(rideFromCheckpoint(legacy).distanceM).toBeCloseTo(a.engine.odometer,7);
  });

  it('chiude il tratto al momento esatto dei comandi e scarta la pausa', () => {
    const ride=fixture();
    ride.at(8500); ride.engine.pause();
    const distance=ride.engine.odometer;
    ride.at(130000); ride.engine.resume();
    expect(ride.engine.odometer).toBe(distance);
    ride.at(131150); ride.engine.finish();
    expect(ride.engine.elapsed).toBeCloseTo(9.65,7);
    expect(ride.engine.samples.at(-1)?.distance).toBe(ride.engine.odometer);
  });
});
