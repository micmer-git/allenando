import { describe, expect, it } from 'vitest';
import { addBuilding, earcut, minRect, ringArea, roofShape, Tris, type BuildingColors } from '../src/open/buildings';
import { BUILDING_KIND, type Building } from '../src/open/world';

const C: BuildingColors = { wall: { r: 1, g: 0.9, b: 0.8 }, base: { r: 0.8, g: 0.7, b: 0.6 }, roof: { r: 0.5, g: 0.5, b: 0.5 }, tiles: { r: 0.7, g: 0.3, b: 0.2 }, blind: false };

/** Rettangolo l × w ruotato di `a` radianti attorno a (cx, cz). */
function rect(l: number, w: number, a: number, cx = 100, cz = -50, cw = true): Float32Array {
  const pts = [
    [-l / 2, -w / 2],
    [l / 2, -w / 2],
    [l / 2, w / 2],
    [-l / 2, w / 2],
  ];
  if (cw) pts.reverse();
  const out: number[] = [];
  for (const [x, z] of pts) out.push(cx + x * Math.cos(a) - z * Math.sin(a), cz + x * Math.sin(a) + z * Math.cos(a));
  return new Float32Array(out);
}

function normals(t: Tris): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < t.pos.length; i += 9) {
    const p = t.pos;
    const ux = p[i + 3] - p[i];
    const uy = p[i + 4] - p[i + 1];
    const uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i];
    const vy = p[i + 7] - p[i + 1];
    const vz = p[i + 8] - p[i + 2];
    out.push([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
  }
  return out;
}

const house = (ring: Float32Array, h = 9, kind: number = BUILDING_KIND.house): Building => ({ kind, h, minH: 0, roof: 0, ring });

describe('edifici', () => {
  it('il rettangolo minimo ritrova lati e orientamento di una casa ruotata', () => {
    const o = minRect(rect(16, 9, 0.6));
    expect(o.hl).toBeCloseTo(8, 4);
    expect(o.hs).toBeCloseTo(4.5, 4);
    expect(o.cx).toBeCloseTo(100, 4);
    expect(o.cz).toBeCloseTo(-50, 4);
    expect(Math.abs(o.ax * Math.cos(0.6) + o.az * Math.sin(0.6))).toBeCloseTo(1, 4);
  });

  it('la triangolazione di una pianta a L copre tutta l’area, in tutti e due i versi', () => {
    const L = [0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20];
    for (const ring of [L, (() => { const r: number[] = []; for (let i = L.length - 2; i >= 0; i -= 2) r.push(L[i], L[i + 1]); return r; })()]) {
      const idx = earcut(ring);
      expect(idx.length).toBe(12);
      let a = 0;
      for (let i = 0; i < idx.length; i += 3) {
        const [p, q, r] = [idx[i], idx[i + 1], idx[i + 2]];
        a += Math.abs((ring[q * 2] - ring[p * 2]) * (ring[r * 2 + 1] - ring[p * 2 + 1]) - (ring[q * 2 + 1] - ring[p * 2 + 1]) * (ring[r * 2] - ring[p * 2])) / 2;
      }
      expect(a).toBeCloseTo(Math.abs(ringArea(ring)), 6);
    }
  });

  it('case lunghe a due falde, tozze a padiglione, capannoni e piante strane piatte', () => {
    const shape = (b: Building) => roofShape(b, minRect(b.ring), Math.abs(ringArea(b.ring)));
    expect(shape(house(rect(18, 8, 0.3)))).toBe('gable');
    expect(shape(house(rect(11, 9, 0.3)))).toBe('hip');
    expect(shape(house(rect(18, 8, 0.3), 9, BUILDING_KIND.industrial))).toBe('flat');
    expect(shape(house(new Float32Array([0, 0, 30, 0, 30, 6, 6, 6, 6, 30, 0, 30])))).toBe('flat');
    expect(shape(house(rect(60, 40, 0)))).toBe('flat');
  });

  for (const cw of [true, false]) {
    it(`pareti verso fuori e falde verso il cielo (anello ${cw ? 'orario' : 'antiorario'})`, () => {
      const walls = new Tris();
      const roofs = new Tris();
      const ring = rect(18, 8, 0.9, 100, -50, cw);
      const { top, shape } = addBuilding(walls, roofs, house(ring, 10), 300, C);
      expect(shape).toBe('gable');
      // colmo: muro sotto i 10 m dichiarati, il colmo più o meno lì
      expect(top).toBeGreaterThan(306);
      expect(top).toBeLessThan(312);
      const n = normals(walls);
      for (let i = 0; i < n.length; i++) {
        const p = walls.pos;
        const mx = (p[i * 9] + p[i * 9 + 3] + p[i * 9 + 6]) / 3 - 100;
        const mz = (p[i * 9 + 2] + p[i * 9 + 5] + p[i * 9 + 8]) / 3 + 50;
        // muri e timpani guardano lontano dal centro della casa
        expect(n[i][0] * mx + n[i][2] * mz).toBeGreaterThan(0);
      }
      // metà falde guardano su, metà (il sotto della gronda) giù
      const up = normals(roofs).filter((v) => v[1] > 0).length;
      expect(up).toBe(roofs.count / 2);
      // i muri hanno le finestre: uv oltre la prima campata
      expect(Math.max(...walls.uv)).toBeGreaterThan(0.5);
    });
  }

  it('i capannoni hanno il muro cieco e il tetto piano che guarda su', () => {
    const walls = new Tris();
    const roofs = new Tris();
    addBuilding(walls, roofs, house(rect(40, 25, 0.2), 8, BUILDING_KIND.industrial), 250, { ...C, blind: true });
    expect(roofs.count).toBe(0);
    expect(new Set(walls.uv).size).toBe(1);
    const flat = normals(walls).filter((v) => Math.abs(v[0]) < 1e-6 && Math.abs(v[2]) < 1e-6);
    expect(flat.length).toBeGreaterThan(0);
    for (const v of flat) expect(v[1]).toBeGreaterThan(0);
  });
});
