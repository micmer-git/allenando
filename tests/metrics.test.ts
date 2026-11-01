import { describe, expect, it } from 'vitest';
import {
  estimateFtpFromRamp,
  intensityFactor,
  normalizedPower,
  trainingStressScore,
} from '../src/domain/metrics';
import { buildRide } from '../src/domain/metrics';

describe('NP, IF e TSS', () => {
  it('a potenza costante NP coincide con la media', () => {
    const powers = Array.from({ length: 60 }, () => 200);
    expect(normalizedPower(powers)).toBeCloseTo(200, 5);
    expect(average(powers)).toBe(200);
  });

  it('con potenza variabile la NP è più alta della media', () => {
    const powers = [...Array(30).fill(100), ...Array(30).fill(300)];
    expect(normalizedPower(powers)).toBeCloseTo(223.069, 2);
    expect(normalizedPower(powers)).toBeGreaterThan(200);
  });

  it('un’ora alla FTP vale 100 TSS', () => {
    const ftp = 250;
    const np = 250;
    expect(intensityFactor(np, ftp)).toBe(1);
    expect(trainingStressScore(3600, np, ftp)).toBeCloseTo(100, 5);
  });

  it('il riepilogo di un’ora piatta usa la potenza', () => {
    const samples = Array.from({ length: 3600 }, (_, i) => ({
      t: i,
      power: 250,
      hr: 160,
      cadence: 90,
      speed: 9,
      distance: i * 9,
      altitude: 10,
      grade: 0,
    }));
    const ride = buildRide({
      id: 'ora',
      name: 'Test',
      source: 'indoor',
      startTime: new Date('2026-10-01T08:00:00Z'),
      durationSec: 3600,
      samples,
      ftp: 250,
      lthr: 165,
      withCamilla: false,
    });
    expect(ride.np).toBeCloseTo(250, 0);
    expect(ride.tss).toBeCloseTo(100, 0);
    expect(ride.tssSource).toBe('power');
    expect(ride.intensityFactor).toBeCloseTo(1, 2);
    expect(ride.kcal).toBe(900);
  });

  it('stima la FTP al 75% del miglior minuto', () => {
    const powers = [...Array(180).fill(80), ...Array(60).fill(200), ...Array(60).fill(280), ...Array(60).fill(300)];
    expect(estimateFtpFromRamp(powers)).toBe(Math.round(300 * 0.75));
  });
});

function average(values: number[]): number {
  return values.reduce((s, n) => s + n, 0) / values.length;
}
