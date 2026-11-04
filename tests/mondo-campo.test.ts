import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FLAG, WorldGraph, type WorldGraphFile } from '../src/open/graph';
import { decodeFeatures, Terrain, type FeaturesFile, type RideDef } from '../src/open/world';
import { bankLimit, createWorldField } from '../src/open/field';
import { WorldPath } from '../src/open/path';
import { pavedWeight, urbanDensity } from '../src/open/urban';
import { walkHeights } from '../src/open/tiles';

/*
 * Pista 3 (il mondo 3D): il terreno lungo le strade (niente pareti né canyon), il suolo delle
 * città, gli scivoli dei marciapiedi. Le prove sul mondo vero leggono il DEM da public/.
 */

const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as FeaturesFile);
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[] | { rides: RideDef[] };
const rideList = Array.isArray(rides) ? rides : rides.rides;

const realFetch = globalThis.fetch;
beforeAll(() => {
  // il DEM dal disco, come lo servirebbe il sito
  globalThis.fetch = (async (url: string) => {
    try {
      const b = readFileSync(join(dir, String(url).replace(/^.*\/world\/bergamo\//, '')));
      return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    } catch {
      return { ok: false };
    }
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

function pathOf(id: string): WorldPath {
  const ride = rideList.find((r) => r.id === id)!;
  const [first, ...rest] = ride.legs;
  const e0 = graph.edges[first[0]];
  const path = new WorldPath(graph, { edge: first[0], dir: first[1], s: first[1] > 0 ? 0 : e0.length });
  for (const [e, d] of rest) path.append(e, d);
  return path;
}

describe('il terreno lungo le strade', () => {
  it('la scarpata: al più 0,9:1 fino a 26 m dal bordo, poi risale', () => {
    expect(bankLimit(0)).toBe(0);
    expect(bankLimit(1.5)).toBe(0);
    for (let e = 1.5; e < 26; e += 0.5) expect(bankLimit(e + 0.5) - bankLimit(e)).toBeLessThanOrEqual(0.9 * 0.5 + 1e-9);
    expect(bankLimit(40)).toBeGreaterThan(50);
  });

  it('i fiumi hanno la loro quota (prima il Serio era a 0 m e il campo scavava un canyon di 300 m)', () => {
    let zero = 0;
    for (const r of features.rivers) for (let i = 2; i < r.pts.length; i += 3) if (Math.abs(r.pts[i]) < 1) zero++;
    expect(zero).toBe(0);
  });

  it('Val Seriana a 9 km: niente canyon accanto alla ciclabile', async () => {
    const terrain = new Terrain(graph, '/world/bergamo/');
    await terrain.loadFar();
    const field = createWorldField(graph, terrain, features);
    const path = pathOf('val-seriana');
    const p = path.poseAt(9000);
    await terrain.around(p.x, p.z, 200);
    const e = graph.edges[path.edgeAt(9000).edge];
    for (const side of [-1, 1]) {
      for (let o = 0; o <= 60; o += 4) {
        const x = p.x + Math.cos(p.heading) * side * (e.hw + o);
        const z = p.z - Math.sin(p.heading) * side * (e.hw + o);
        // il terreno resta a pochi metri dalla quota della ciclabile: il Serio scorre 4 m sotto
        expect(Math.abs(field.height(x, z, 10) - p.y)).toBeLessThan(12);
      }
    }
  });

  it('fra 6 e 20 m dal bordo della strada il terreno disegnato non supera 1:1 (Val Seriana, tutta)', async () => {
    const terrain = new Terrain(graph, '/world/bergamo/');
    await terrain.loadFar();
    const field = createWorldField(graph, terrain, features);
    const path = pathOf('val-seriana');
    const SP = 10;
    const b = graph.bounds;
    let n = 0;
    let bad = 0;
    for (let d = 50; d < path.length - 50; d += 100) {
      const p = path.poseAt(d);
      // gallerie e ponti esclusi
      if (graph.edges[path.edgeAt(d).edge].flags & (FLAG.tunnel | FLAG.bridge)) continue;
      await terrain.around(p.x, p.z, 100);
      // i triangoli della griglia del terreno (passo 10 m, come terrainJob) intorno al punto
      const i0 = Math.floor((p.x - b.x0) / SP);
      const j0 = Math.floor((p.z - b.z0) / SP);
      const X = (k: number) => b.x0 + k * SP;
      const Z = (k: number) => b.z0 + k * SP;
      for (let j = j0 - 3; j <= j0 + 3; j++) {
        for (let i = i0 - 3; i <= i0 + 3; i++) {
          const ha = field.height(X(i), Z(j), SP);
          const hb = field.height(X(i + 1), Z(j), SP);
          const hc = field.height(X(i), Z(j + 1), SP);
          const hd = field.height(X(i + 1), Z(j + 1), SP);
          const tris: [number, number, number, number][] = [
            [X(i) + SP / 3, Z(j) + SP / 3, (hb - ha) / SP, (hc - ha) / SP],
            [X(i) + (2 * SP) / 3, Z(j) + (2 * SP) / 3, (hd - hc) / SP, (hd - hb) / SP],
          ];
          for (const [cx, cz, gx, gz] of tris) {
            const r = field.roadAt(cx, cz, 30);
            if (!r || r.edgeDist < 6 || r.edgeDist > 20) continue;
            n++;
            if (Math.hypot(gx, gz) > 1) bad++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(5000);
    // il resto sono muri di sostegno fra due strade a quote diverse più vicine di 20 m
    expect(bad / n).toBeLessThan(0.005);
  }, 60000);
});

describe('il suolo delle città', () => {
  const square = (x: number, z: number, s: number) => ({ kind: 1, h: 10, minH: 0, roof: 0, ring: new Float32Array([x, z, x + s, z, x + s, z + s, x, z + s]) });

  it('la densità delle case intorno, da una tabella delle somme', () => {
    // un isolato di 4 case da 20 × 20 m in un quadrato di 100 × 100 m
    const list = [square(0, 0, 20), square(40, 0, 20), square(0, 40, 20), square(40, 40, 20)];
    const at = urbanDensity([list], -200, -200, 200, 200, 50);
    expect(at(30, 30)).toBeCloseTo(1600 / 10000, 1);
    expect(at(-150, -150)).toBe(0);
  });

  it('pavimentato dove le case sono fitte e vicino alle strade, prato altrove', () => {
    expect(pavedWeight(0.3, 10)).toBeCloseTo(1, 5);
    expect(pavedWeight(0.02, 10)).toBe(0);
    expect(pavedWeight(0.3, 80)).toBe(0);
  });
});

describe('i marciapiedi', () => {
  it('scendono alla quota della strada dove finiscono, e non al bordo della mattonella', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ d: i * 2.5 }));
    const on = pts.map((_, i) => i >= 4 && i <= 16);
    const k = walkHeights(pts, on);
    expect(k[4]).toBe(0);
    expect(k[16]).toBe(0);
    expect(k[10]).toBe(1);
    expect(k[5]).toBeGreaterThan(0);
    expect(k[5]).toBeLessThan(1);
    // tutto marciapiede fino ai bordi della corsa: nessuno scivolo
    const all = walkHeights(pts, pts.map(() => true));
    expect(all[0]).toBe(1);
    expect(all[20]).toBe(1);
  });
});
