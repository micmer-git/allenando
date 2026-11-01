import { describe, expect, it } from 'vitest';
import { powerForSpeed, steadyStateSpeed, stepSpeed, type PhysicsParams } from '../src/domain/physics';

const params: PhysicsParams = {
  massKg: 83,
  cda: 0.32,
  crr: 0.004,
  rho: 1.225,
  g: 9.80665,
  eta: 0.975,
  rotatingFactor: 1,
};

describe('fisica della bicicletta', () => {
  it('inverte potenza e velocità in piano', () => {
    const speed = 9;
    const power = powerForSpeed(speed, 0, params);
    expect(steadyStateSpeed(power, 0, params)).toBeCloseTo(speed, 2);
  });

  it('a 200 W in piano sta intorno ai 34 km/h', () => {
    const speed = steadyStateSpeed(200, 0, params);
    expect(speed).toBeCloseTo(9.429, 2);
    expect(speed * 3.6).toBeGreaterThan(33);
    expect(speed * 3.6).toBeLessThan(35);
  });

  it('in salita è più lenta, in discesa più veloce', () => {
    const flat = steadyStateSpeed(200, 0, params);
    const up = steadyStateSpeed(200, 0.05, params);
    const down = steadyStateSpeed(200, -0.03, params);
    expect(up).toBeLessThan(flat * 0.6);
    expect(down).toBeGreaterThan(flat * 1.3);
  });

  it('un ciclista più pesante o con più CdA va più piano', () => {
    const base = steadyStateSpeed(200, 0, params);
    const heavy = steadyStateSpeed(200, 0, { ...params, massKg: 100 });
    const draggy = steadyStateSpeed(200, 0, { ...params, cda: 0.45 });
    expect(heavy).toBeLessThan(base);
    expect(draggy).toBeLessThan(base);
  });

  it('senza watt in piano resta ferma, in discesa prende velocità', () => {
    expect(steadyStateSpeed(0, 0, params)).toBe(0);
    expect(steadyStateSpeed(0, -0.08, params)).toBeGreaterThan(10);
  });

  it('l’integrazione converge verso il regime', () => {
    const target = steadyStateSpeed(200, 0, params);
    let speed = 0;
    for (let i = 0; i < 90 / 0.05; i++) {
      speed = stepSpeed(200, speed, 0, 0.05, params);
    }
    expect(speed).toBeGreaterThan(target * 0.95);
    expect(speed).toBeLessThan(target * 1.05);
  });
});
