import { describe, expect, it } from 'vitest';
import { addBuilding, Tris } from '../src/open/buildings';
import { canopyNames, photoCrown } from '../src/open/chiome';
import { readRoofColours } from '../src/open/tetti';
import { BUILDING_KIND, type Building } from '../src/open/world';

const wall = { r: .7, g: .6, b: .5 };
const col = { wall, base: wall, tiles: wall, roof: wall, blind: false };
const house: Building = { kind: BUILDING_KIND.house, minH: 0, h: 7, roof: 0, ring: new Float32Array([0,0,12,0,12,8,0,8]) };

describe('dettagli da rilievo', () => {
  it('posiziona il portone sul lato mappato alla quota del terreno', () => {
    const walls = new Tris();
    addBuilding(walls, new Tris(), { ...house, architecture: { kind:'garage', roof:'flat', entrances:[[0,500,1]] } },
      102, { ...col, entranceGround: () => 100.5 }, 99);
    const points = [];
    for (let p=0; p<walls.pos.length; p+=3) if (walls.pos[p+2] < 0) points.push(walls.pos.slice(p,p+3));
    expect(points.length).toBeGreaterThan(0);
    expect(Math.min(...points.map(p => p[1]))).toBe(100.5);
    expect(Math.min(...points.map(p => p[0]))).toBeGreaterThan(4.5);
    expect(Math.max(...points.map(p => p[0]))).toBeLessThan(7.5);
  });

  it('mantiene la forma di tetto OSM esplicita', () => {
    const walls = new Tris(), roofs = new Tris();
    const { shape } = addBuilding(walls,roofs,{ ...house, architecture:{ roof:'flat' } }, 100,col);
    expect(shape).toBe('flat');
    expect(roofs.count).toBe(0);
  });

  it('decodifica le tinte AGEA e tollera un file parziale', () => {
    const file = new Uint8Array([84,69,84,49,1,0,0,0,0,248]);
    expect(readRoofColours(file.buffer).get(1)).toBe(0xff0000);
    expect(readRoofColours(file.slice(0,-1).buffer).size).toBe(0);
  });

  it('contiene tutte le chiome nella texture e rispetta il costo geometrico per istanza', () => {
    for (const name of canopyNames) {
      const g = photoCrown(name);
      expect(g.index!.count / 3).toBe(24);
      const uv = Array.from(g.getAttribute('uv').array);
      expect(Math.min(...uv)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...uv)).toBeLessThanOrEqual(1);
      g.dispose();
    }
  });
});
