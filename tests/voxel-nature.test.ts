import { describe, expect, it } from 'vitest';
import { voxelTrees } from '@/world/isometric';

describe('vegetazione voxel condivisa', () => {
  it('conserva una mesh per specie, con tinte e ingombri validi per lo scatter', () => {
    const geometries = voxelTrees();
    try {
      for (const [kind, geometry] of Object.entries(geometries)) {
        const position = geometry.getAttribute('position');
        const color = geometry.getAttribute('color');
        const normal = geometry.getAttribute('normal');
        expect(color.count, kind).toBe(position.count);
        expect(normal.count, kind).toBe(position.count);
        expect(geometry.groups, kind).toHaveLength(0);
        expect(geometry.index!.count / 3, kind).toBeLessThanOrEqual(320);
        expect([...position.array].every(Number.isFinite), kind).toBe(true);
        expect([...color.array].every(v => v >= 0 && v <= 1.1), kind).toBe(true);
        const bounds = geometry.boundingBox!;
        expect(bounds.max.x - bounds.min.x, kind).toBeLessThan(5.5);
        expect(bounds.max.z - bounds.min.z, kind).toBeLessThan(5.5);
        expect(bounds.min.y, kind).toBeGreaterThan(-0.3);
        expect(bounds.max.y, kind).toBeLessThan(11);
        const top: number[] = [], bottom: number[] = [];
        for (let i = 0; i < normal.count; i++) {
          if (normal.getY(i) === 1) top.push(color.getX(i));
          if (normal.getY(i) === -1) bottom.push(color.getX(i));
        }
        expect(Math.min(...top), kind).toBeGreaterThan(Math.max(...bottom));
      }
    } finally {
      Object.values(geometries).forEach(g => g.dispose());
    }
  });
});
