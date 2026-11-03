import { describe, expect, it } from 'vitest';
import { atmosphere, CLEAR, sunFor, sunPosition, sunVector } from '../src/open/sky';
import { headwind, parseWeather, weatherLabel, weatherUrl } from '../src/open/weather';
import { powerForSpeed, STANDARD_AIR, steadyStateSpeed, type PhysicsParams } from '../src/domain/physics';

const BG = { lat: 45.695, lon: 9.67 };
const deg = (r: number) => (r * 180) / Math.PI;

describe('sole su Bergamo', () => {
  it('mezzogiorno solare del solstizio d’estate: alto 67-68° a sud', () => {
    const s = sunPosition(new Date('2026-06-21T11:24:00Z'), BG.lat, BG.lon);
    expect(deg(s.elevation)).toBeGreaterThan(67);
    expect(deg(s.elevation)).toBeLessThan(68.5);
    expect(deg(s.azimuth)).toBeGreaterThan(175);
    expect(deg(s.azimuth)).toBeLessThan(185);
  });

  it('solstizio d’inverno: a mezzogiorno appena 21° sull’orizzonte', () => {
    const s = sunPosition(new Date('2026-12-21T11:19:00Z'), BG.lat, BG.lon);
    expect(deg(s.elevation)).toBeGreaterThan(20);
    expect(deg(s.elevation)).toBeLessThan(22);
  });

  it('di mattina sta a est, di sera a ovest, di notte sotto', () => {
    expect(deg(sunPosition(new Date('2026-03-20T06:30:00Z'), BG.lat, BG.lon).azimuth)).toBeLessThan(110);
    expect(deg(sunPosition(new Date('2026-03-20T16:30:00Z'), BG.lat, BG.lon).azimuth)).toBeGreaterThan(250);
    expect(sunPosition(new Date('2026-03-20T23:00:00Z'), BG.lat, BG.lon).elevation).toBeLessThan(0);
  });

  it('l’ora scelta: tramonto basso a ovest, mattina a est, la notte vera resta all’ora blu', () => {
    const now = new Date('2026-11-03T21:00:00Z');
    const sera = sunFor('sera', now, BG.lat, BG.lon);
    expect(deg(sera.elevation)).toBeGreaterThan(2);
    expect(deg(sera.elevation)).toBeLessThan(6);
    expect(deg(sera.azimuth)).toBeGreaterThan(200);
    const mattina = sunFor('mattina', now, BG.lat, BG.lon);
    expect(deg(mattina.azimuth)).toBeLessThan(180);
    const notte = sunFor('vera', now, BG.lat, BG.lon);
    expect(notte.night).toBe(true);
    expect(deg(notte.elevation)).toBeCloseTo(-3, 5);
  });

  it('il vettore del sole: est è +x, sud è +z', () => {
    const v = sunVector({ azimuth: Math.PI / 2, elevation: 0 });
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.z).toBeCloseTo(0, 6);
    expect(sunVector({ azimuth: Math.PI, elevation: 0 }).z).toBeCloseTo(1, 6);
  });
});

describe('cielo e luce', () => {
  it('le nuvole spengono il sole, chiudono la vista e ingrigiscono il cielo', () => {
    const sun = { azimuth: Math.PI, elevation: (40 * Math.PI) / 180 };
    const clear = atmosphere(sun, CLEAR);
    const grey = atmosphere(sun, { cloud: 1, rain: 3, visibility: 6000 });
    expect(grey.sunIntensity).toBeLessThan(clear.sunIntensity * 0.4);
    expect(grey.fogFar).toBeLessThan(clear.fogFar);
    const sat = (c: { r: number; g: number; b: number }) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    expect(sat(grey.zenith)).toBeLessThan(sat(clear.zenith));
  });

  it('al tramonto la luce è calda: più rosso che blu', () => {
    const a = atmosphere({ azimuth: 4.5, elevation: (2 * Math.PI) / 180 }, CLEAR);
    expect(a.sunColor.r).toBeGreaterThan(a.sunColor.b * 1.3);
    expect(a.horizon.r).toBeGreaterThan(a.horizon.b);
  });
});

describe('meteo vero e vento', () => {
  it('legge la risposta di Open-Meteo', () => {
    const w = parseWeather({
      current: { time: '2026-11-03T04:00', temperature_2m: 7.4, precipitation: 0.6, weather_code: 61, cloud_cover: 96, wind_speed_10m: 4.2, wind_direction_10m: 45, visibility: 9000 },
    });
    expect(w).not.toBeNull();
    expect(w!.cloud).toBeCloseTo(0.96, 6);
    expect(w!.rain).toBeCloseTo(0.6, 6);
    expect(w!.windMs).toBeCloseTo(4.2, 6);
    expect(deg(w!.windFrom)).toBeCloseTo(45, 6);
    expect(weatherLabel(w!.code)).toBe('pioggia');
    expect(parseWeather({ nope: 1 })).toBeNull();
    expect(weatherUrl(BG.lat, BG.lon)).toContain('wind_speed_unit=ms');
  });

  it('vento da nord: contro andando a nord, a favore andando a sud, quasi nullo andando a est', () => {
    const w = { windMs: 5, windFrom: 0 };
    // avanti = (sin h, cos h), z a sud: nord è h = π, sud h = 0, est h = π/2
    expect(headwind(w, Math.PI, 1)).toBeCloseTo(5, 6);
    expect(headwind(w, 0, 1)).toBeCloseTo(-5, 6);
    expect(Math.abs(headwind(w, Math.PI / 2, 1))).toBeLessThan(1e-9);
    expect(headwind({ windMs: 5, windFrom: Math.PI / 2 }, Math.PI / 2, 1)).toBeCloseTo(5, 6);
  });

  it('nella fisica il vento contro rallenta e quello a favore spinge', () => {
    const base: PhysicsParams = { ...STANDARD_AIR, massKg: 80, cda: 0.32, crr: 0.004 };
    const still = steadyStateSpeed(200, 0, base);
    const against = steadyStateSpeed(200, 0, { ...base, wind: 4 });
    const behind = steadyStateSpeed(200, 0, { ...base, wind: -4 });
    expect(against).toBeLessThan(still - 1);
    expect(behind).toBeGreaterThan(still + 1);
    // senza vento il modello è quello di prima
    expect(powerForSpeed(10, 0.03, { ...base, wind: 0 })).toBeCloseTo(powerForSpeed(10, 0.03, base), 9);
  });
});
