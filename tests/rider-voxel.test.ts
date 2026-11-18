import { describe, expect, it } from 'vitest';
import { BONE_COUNT } from '@/world/rider';
import { triangles, type RiderDetail } from '@/world/riderBuild';
import { voxelRiderGeometry } from '@/world/riderVoxel';

describe('ciclista voxel in corsa', () => {
  it.each<RiderDetail>(['alta', 'media', 'bassa'])('%s tiene tutte le parti animabili in una mesh condivisa', detail => {
    const g = voxelRiderGeometry(detail, 'alto');
    expect(voxelRiderGeometry(detail, 'alto')).toBe(g);
    expect(g.groups).toHaveLength(0);
    const indices = g.getAttribute('skinIndex');
    const weights = g.getAttribute('skinWeight');
    const bones = new Set<number>();
    for (let i = 0; i < indices.count; i++) {
      bones.add(indices.getX(i));
      if (weights.getX(i) !== 1) throw new Error('Pezzo voxel sganciato dal suo osso');
    }
    expect(bones.size).toBe(BONE_COUNT);
    expect(triangles(g)).toBeLessThan(detail === 'bassa' ? 1500 : 2400);
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 2);
    expect(g.boundingBox!.max.y).toBeLessThan(1.8);
    expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeLessThan(2);
  });
  it('distingue raggi e ruota lenticolare anche sulla bici pixel', () => {
    const low = voxelRiderGeometry('alta', 'basso');
    const disc = voxelRiderGeometry('alta', 'lenticolare');
    expect(triangles(disc)).not.toBe(triangles(low));
    expect(triangles(voxelRiderGeometry('bassa', 'basso'))).toBeLessThan(triangles(low));
  });
});
