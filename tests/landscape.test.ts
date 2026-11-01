import { describe, expect, it } from 'vitest';
import { getTrack } from '../src/domain/track';
import { terrainSizeForTrack } from '../src/world/landscape';

describe('3D landscape coverage', () => {
  it('includes every point of the entire 4.8 km circuit with scenery margins', () => {
    const track = getTrack();
    const half = terrainSizeForTrack(track) / 2;
    expect(half).toBeGreaterThan(900);
    for (const p of track.points) {
      expect(half - Math.max(Math.abs(p.x), Math.abs(p.z))).toBeGreaterThanOrEqual(400);
    }
  });
  it('covers the starting point that previously fell outside a 1500 m ground plane', () => {
    const track = getTrack();
    expect(Math.abs(track.poseAt(0).x)).toBeGreaterThan(750);
    expect(Math.abs(track.poseAt(0).x)).toBeLessThan(terrainSizeForTrack(track) / 2);
  });
});
