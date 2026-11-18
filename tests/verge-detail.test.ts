import { describe, expect, it } from 'vitest';
import { classicVergeSurface, createVergeWindow, triangleGround, VERGE_BUDGET, worldVergeSurface } from '@/world/vergePlacement';
import type { HeightField } from '@/world/heightfield';
import type { WorldField } from '@/open/field';
import { COVER } from '@/open/world';
import { lookContext } from '@/open/look';
import { boxVolume } from '@/open/labels';

describe('dettagli minuti ai bordi della strada', () => {
  it('ha un budget fisso anche su una superficie tutta valida e conserva la zolla tornando indietro', () => {
    const window = createVergeWindow(() => ({ y: 0, slope: 0 }), 10000);
    window.update(0, 0);
    expect(window.items).toHaveLength(VERGE_BUDGET);
    const before = window.items;
    window.update(2000, -2000);
    expect(window.items.every(p => p.x > 1900 && p.z < -1900)).toBe(true);
    window.update(0, 0);
    expect(window.items).toEqual(before);
  });

  it('non ricampiona per fotogramma e rilegge il terreno quando arriva una revisione', () => {
    let samples = 0, height = 0;
    const window = createVergeWindow(() => { samples++; return { y: height, slope: 0 }; });
    window.update(1, 1, 1);
    const count = samples;
    expect(window.update(15, 15, 1)).toBe(false);
    expect(samples).toBe(count);
    height = 4;
    expect(window.update(15, 15, 2)).toBe(true);
    expect(window.items.every(p => p.y === 3.975)).toBe(true);
    expect(window.update(16, 15, 2)).toBe(true);
  });

  it('non disegna su posizioni escluse, pendii ripidi o quote corrotte', () => {
    const window = createVergeWindow((x, z) => x < 0 ? null : z < 0 ? { y: NaN, slope: 0 } : { y: 0, slope: 1 });
    window.update(0, 0);
    expect(window.items).toEqual([]);
    const rocks = createVergeWindow(() => ({ y: 1, slope: .3, rockOnly: true }));
    rocks.update(0, 0);
    expect(rocks.items.length).toBeGreaterThan(0);
    expect(rocks.items.every(p => p.kind === 'rock')).toBe(true);
  });

  it('posa sul triangolo disegnato anche dove il campionamento continuo sarebbe diverso', () => {
    const sample = (x: number, z: number) => x * z;
    expect(triangleGround(sample, 2, 2, 8)).toMatchObject({ y: 0, slope: 0 });
    expect(triangleGround(sample, 6, 6, 8)).toMatchObject({ y: 32, slope: Math.hypot(64, 64) / 8 });
    expect(triangleGround((x, z) => .2 * x + .3 * z + 10, -12, 15, 8, 3, -5).y).toBeCloseTo(12.1);
  });

  it('sulle salite lascia libera la carreggiata e non fa spuntare erba sulla neve', () => {
    const field = {
      road: { nearest: (x: number) => ({ dist: Math.abs(x), y: 0, grade: 0, along: 0 }) },
      halfWidth: 3, altitudeBase: 1000, height: () => 0,
    } as unknown as HeightField;
    const sample = classicVergeSurface(field, 8);
    expect(sample(3.7, 0)).toBeNull();
    expect(sample(30, 0)).toBeNull();
    expect(sample(6, 0)).toMatchObject({ y: 0, slope: 0 });
    field.altitudeBase = 2800;
    expect(sample(6, 0)).toBeNull();
  });

  it('nei mondi esclude DEM assente, acqua, case, ponti e gallerie', () => {
    let cover: number = COVER.open, has = true, wet = false, bridge = false, tunnel = false;
    let buildings: ReturnType<typeof boxVolume>[] = [];
    const field = {
      terrain: {
        graph: { bounds: { x0: 0, z0: 0 } }, tileOf: () => [0, 0], has: () => has,
        cover: () => cover, surveyedCover: () => 0,
      },
      roadAt: () => ({ edgeDist: 4 }), nearBridge: () => bridge, inTube: () => tunnel,
      height: () => 600, lastWater: () => wet,
    } as unknown as WorldField;
    const sample = worldVergeSurface(field, lookContext('bergamo', new Date(2026, 6, 1)), 10, 200, () => buildings);
    expect(sample(10, 10)).toMatchObject({ y: 600, slope: 0 });
    has = false; expect(sample(10, 10)).toBeNull(); has = true;
    cover = COVER.water; expect(sample(10, 10)).toBeNull(); cover = COVER.open;
    cover = COVER.residential; expect(sample(10, 10)).toBeNull(); cover = COVER.open;
    wet = true; expect(sample(10, 10)).toBeNull(); wet = false;
    bridge = true; expect(sample(10, 10)).toBeNull(); bridge = false;
    tunnel = true; expect(sample(10, 10)).toBeNull(); tunnel = false;
    buildings = [boxVolume(10, 10, 6, 6, 0, 590, 620)];
    expect(sample(10, 10)).toBeNull();
  });
});
