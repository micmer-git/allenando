import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bandsWeight, LOOKS, lookContext, lookFor, seasonDate } from '../src/open/look';
import { atmosphere, CLEAR, HIGH_SKY } from '../src/open/sky';
import { farSinks, FAR_SINK } from '../src/open/farMask';
import { Mesh, SKIRT_M, terrainJob, type TileSpec } from '../src/open/tiles';
import { WALL_COURSE, wallAlong } from '../src/open/streets';
import { towerGeometry } from '../src/open/Lifts';
import { peakSub } from '../src/open/labels';
import { RILIEVO, S2_RILIEVO, sharpenRelief } from '../src/open/rilievo';
import { WorldGraph, type WorldGraphFile } from '../src/open/graph';
import { WorldPath } from '../src/open/path';
import { COVER, Terrain, type RideDef } from '../src/open/world';
import type { WorldField } from '../src/open/field';

/*
 * Pista S2, giro 2 del PM (verdetti del 09/11/2026): R1 la lastra del terreno lontano, R2 le bande
 * solo sulle pareti, R3 il muro di pietra a corsi, R4 i piloni a traliccio, R5 il cielo d'alta
 * quota dopo il tone mapping, R6 la quota delle cime col separatore. E il ritocco per il collaudo.
 */

const sella = LOOKS.sellaronda;
const lumOf = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function run<T>(job: Generator<void, T, void>): T {
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}

// ---------- R1: il terreno lontano sotto il vicino ----------

describe('R1 · il terreno lontano non sporge sopra quello vicino', () => {
  it('l’abbassamento cresce con la ruvidezza: 1,5 m in piano, al più 45 m per passo', () => {
    const nx = 5;
    const flat = farSinks(new Float32Array(nx * nx).fill(1200), nx, nx, 1);
    expect([...flat].every((v) => v === FAR_SINK.min)).toBe(true);
    // una cresta di 200 m in mezzo: 0,12 × 200 = 24 m intorno, poi niente
    const ridge = new Float32Array(nx * nx).fill(1000);
    ridge[2 * nx + 2] = 1200;
    const s = farSinks(ridge, nx, nx, 1);
    expect(s[2 * nx + 2]).toBeCloseTo(24, 5);
    expect(s[0]).toBe(FAR_SINK.min);
    // un muro di 1000 m: il tetto, raddoppiato col passo doppio
    const wall = new Float32Array(nx * nx).fill(1000);
    for (let i = 0; i < nx; i++) wall[i] = 2000;
    expect(farSinks(wall, nx, nx, 1)[nx]).toBe(FAR_SINK.max);
    expect(farSinks(wall, nx, nx, 2)[0]).toBe(FAR_SINK.max * 2);
    // la gonna delle mattonelle è più profonda dell'abbassamento massimo, con margine
    expect(SKIRT_M).toBeGreaterThan(FAR_SINK.max * 2);
  });

  const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
  const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
  const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[] | { rides: RideDef[] };
  const rideList = Array.isArray(rides) ? rides : rides.rides;
  const realFetch = globalThis.fetch;
  beforeAll(() => {
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

  // i punti standard di montagna del 04/11 (Foppolo è quello della lastra)
  it.each([
    ['foppolo', 20200],
    ['san-marco', 23000],
    ['presolana', 14500],
  ])('%s a %i m: fra 1 e 3 km il lontano abbassato sta sotto il DEM quasi ovunque, e la gonna lo raggiunge', async (id, at) => {
    const ride = rideList.find((r) => r.id === id)!;
    const [first, ...rest] = ride.legs;
    const e0 = graph.edges[first[0]];
    const path = new WorldPath(graph, { edge: first[0], dir: first[1], s: first[1] > 0 ? 0 : e0.length });
    for (const [e, d] of rest) path.append(e, d);
    const p = path.poseAt(at);
    const terrain = new Terrain(graph, '/world/bergamo/');
    const H = (await terrain.loadFar())!;
    await terrain.around(p.x, p.z, 3000);
    const f = graph.far;
    const sink = farSinks(H, f.nx, f.nz, 1);
    const sunk = (x: number, z: number) => {
      const fx = Math.min(f.nx - 1.001, Math.max(0, (x - f.x0) / f.step));
      const fz = Math.min(f.nz - 1.001, Math.max(0, (z - f.z0) / f.step));
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      const u = fx - i;
      const v = fz - j;
      const k = j * f.nx + i;
      const g = (kk: number) => H[kk] - sink[kk];
      return g(k) * (1 - u) * (1 - v) + g(k + 1) * u * (1 - v) + g(k + f.nx) * (1 - u) * v + g(k + f.nx + 1) * u * v;
    };
    let n = 0;
    let above = 0;
    let over15 = 0;
    let gap = 0;
    let worst = -Infinity;
    for (let x = p.x - 3000; x <= p.x + 3000; x += 50) {
      for (let z = p.z - 3000; z <= p.z + 3000; z += 50) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < 1000 || d > 3000) continue;
        const diff = sunk(x, z) - terrain.height(x, z);
        n++;
        if (diff > 0) above++;
        if (diff > 15) over15++;
        if (diff < -SKIRT_M) gap++;
        worst = Math.max(worst, diff);
      }
    }
    // prima (1,5 m costanti) a Foppolo il lontano stava sopra nel 50% dei punti, fino a 65 m
    expect(above / n).toBeLessThan(0.06);
    expect(over15 / n).toBeLessThan(0.01);
    expect(worst).toBeLessThan(40);
    expect(gap / n).toBeLessThan(0.002);
  }, 60000);
});

// ---------- R2: le bande solo sulle pareti ----------

/** Un campo finto: il DEM `dem`, il terreno disegnato `drawn` (col taglio della strada), un uso del suolo. */
function fakeField(dem: (x: number, z: number) => number, drawn: (x: number, z: number) => number, cover: number): WorldField {
  return {
    height: (x, z) => drawn(x, z),
    lastRoadDist: () => 50,
    lastWater: () => false,
    roadAt: () => null,
    inTube: () => false,
    nearBridge: () => false,
    terrain: { height: dem, cover: () => cover, graph: { id: 'sellaronda' } } as unknown as WorldField['terrain'],
  };
}
const spec: TileSpec = { tx: 0, tz: 0, x0: 0, z0: 0, size: 100, spacing: 10, trees: 0, buildings: false, ring: 0 };
const maxRock = (g: THREE.BufferGeometry) => {
  const r = g.getAttribute('rock') as THREE.BufferAttribute;
  let m = 0;
  for (let i = 0; i < r.count; i++) m = Math.max(m, r.getX(i));
  return m;
};

describe('R2 · le bande della roccia solo dove c’è una parete', () => {
  const bergamo = lookContext('bergamo', new Date('2026-11-07'));
  it('il taglio di 5 m a 1:1 sopra una strada in un prato a 15° resta prato: niente bande, niente roccia', () => {
    const dem = (x: number) => 900 + x * Math.tan((15 * Math.PI) / 180);
    // la strada a x = 50 scava il pendio: 5 m di parete a 45° fra x = 50 e 55
    const drawn = (x: number) => (x < 50 ? dem(x) - 5 : x < 55 ? dem(x) - 5 + (x - 50) : dem(x));
    const g = run(terrainJob(fakeField(dem, drawn, COVER.open), spec, undefined, bergamo));
    expect(maxRock(g)).toBeLessThan(0.02);
  });

  it('un versante a 40° che i dati dicono bosco non è una parete (la Ganda a terrazze)', () => {
    const dem = (x: number) => 800 + x * Math.tan((40 * Math.PI) / 180);
    const g = run(terrainJob(fakeField(dem, dem, COVER.forest), spec, undefined, bergamo));
    expect(maxRock(g)).toBeLessThan(0.02);
    expect(bandsWeight(LOOKS.bergamo, COVER.forest, 800)).toBe(0);
  });

  it('una parete vera a 60° sopra il bosco ha le bande; la roccia dei dati anche nel bosco', () => {
    const ctx = lookContext('sellaronda', new Date('2026-08-15'));
    const dem = (x: number) => 2300 + x * Math.tan((60 * Math.PI) / 180);
    const g = run(terrainJob(fakeField(dem, dem, COVER.open), spec, undefined, ctx));
    expect(maxRock(g)).toBeGreaterThan(0.8);
    expect(bandsWeight(sella, COVER.rock, 1500)).toBe(1);
    expect(bandsWeight(sella, COVER.forest, 2300)).toBe(1);
  });
});

// ---------- R3: il muro di sostegno a corsi ----------

describe('R3 · il muro di sostegno è pietra grigia a corsi', () => {
  it('corsi di 50 cm, pietre sfalsate col loro grigio, scure; la testa più chiara', () => {
    const m = new Mesh();
    const pts = [0, 4, 8].map((x) => ({ x, y: 100, z: 0, lx: 0, lz: 1, h: 2 }));
    wallAlong(m, pts);
    const shades = new Set<string>();
    let darkest = 1;
    let lightest = 0;
    for (let q = 0; q < m.pos.length / 3; q += 4) {
      // ogni pietra ha i suoi quattro vertici, tutti dello stesso grigio: i corsi non sfumano
      const c = m.col.slice(q * 3, q * 3 + 3).map((v) => v.toFixed(4)).join();
      for (let k = 1; k < 4; k++) expect(m.col.slice((q + k) * 3, (q + k) * 3 + 3).map((v) => v.toFixed(4)).join()).toBe(c);
      const y0 = m.pos[q * 3 + 1];
      const y1 = m.pos[(q + 2) * 3 + 1];
      const l = lumOf({ r: m.col[q * 3], g: m.col[q * 3 + 1], b: m.col[q * 3 + 2] });
      if (y1 - y0 > 0.01 && y0 < 102) {
        expect(y1 - y0).toBeLessThanOrEqual(WALL_COURSE + 1e-6);
        shades.add(c);
        darkest = Math.min(darkest, l);
        lightest = Math.max(lightest, l);
      }
    }
    expect(shades.size).toBeGreaterThan(6);
    // grigio scuro (lineare), non la fascia beige di prima (#9d978c ≈ 0,31)
    expect(lightest).toBeLessThan(0.26);
    expect(lightest - darkest).toBeGreaterThan(0.03);
    // la testa: l'ultimo quadrilatero di ogni tratto, più chiaro delle pietre
    const n = m.pos.length / 3;
    expect(lumOf({ r: m.col[(n - 1) * 3], g: m.col[(n - 1) * 3 + 1], b: m.col[(n - 1) * 3 + 2] })).toBeGreaterThan(lightest);
  });
});

// ---------- R4: i piloni a traliccio ----------

describe('R4 · i piloni sono tralicci che lasciano vedere il cielo', () => {
  it('di fronte meno di metà della sagoma è ferro; pochi triangoli per un’istanza', () => {
    const g = towerGeometry();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const index = g.getIndex()!;
    expect(index.count / 3).toBeLessThan(400);
    const tri: THREE.Triangle[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, index.getX(i + k)));
      tri.push(new THREE.Triangle(v[0], v[1], v[2]));
    }
    // raggi orizzontali lungo z dentro la sagoma del tronco di piramide (base 1,4, cima 0,8)
    const ray = new THREE.Ray();
    const hit = new THREE.Vector3();
    let n = 0;
    let solid = 0;
    for (let y = 0.02; y < 1; y += 0.04) {
      const half = 0.7 + (0.4 - 0.7) * y;
      for (let x = -half * 0.95; x <= half * 0.95; x += half / 10) {
        n++;
        ray.set(new THREE.Vector3(x, y, -5), new THREE.Vector3(0, 0, 1));
        if (tri.some((t) => ray.intersectTriangle(t.a, t.b, t.c, false, hit))) solid++;
      }
    }
    // il tronco di piramide pieno di prima era 100%
    expect(solid / n).toBeLessThan(0.5);
    expect(solid / n).toBeGreaterThan(0.05);
  });
});

// ---------- R5: il cielo d'alta quota, dopo il tone mapping ----------

/** Il tone mapping ACES di three.js (ACESFilmicToneMapping) e la codifica sRGB, come in WebGL. */
function aces(c: THREE.Color, exposure: number): THREE.Color {
  const v = [c.r, c.g, c.b].map((x) => (x * exposure) / 0.6);
  const fit = (x: number) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);
  const i = [0.59719 * v[0] + 0.35458 * v[1] + 0.04823 * v[2], 0.076 * v[0] + 0.90834 * v[1] + 0.01566 * v[2], 0.0284 * v[0] + 0.13383 * v[1] + 0.83777 * v[2]].map(fit);
  const o = [1.60475 * i[0] - 0.53108 * i[1] - 0.07367 * i[2], -0.10208 * i[0] + 1.10813 * i[1] - 0.00605 * i[2], -0.00327 * i[0] - 0.07276 * i[1] + 1.07602 * i[2]];
  const srgb = (x: number) => {
    const y = Math.min(1, Math.max(0, x));
    return y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055;
  };
  return new THREE.Color().setRGB(srgb(o[0]), srgb(o[1]), srgb(o[2]), THREE.NoColorSpace);
}

describe('R5 · il cielo d’alta quota è blu pieno anche a 15° sull’orizzonte', () => {
  // mezzogiorno di novembre al Sella: il sole a 25°
  const sun = { azimuth: Math.PI, elevation: (25 * Math.PI) / 180 };
  /** il colore della cupola (WorldScene, Atmosphere) a quell'altezza sull'orizzonte, sullo schermo */
  const dome = (alt: number, deg: number) => {
    const a = atmosphere(sun, CLEAR, alt);
    const y = Math.sin((deg * Math.PI) / 180);
    const c = a.mid.clone().lerp(a.zenith, Math.min(1, (y - 0.08) / 0.7));
    return aces(c, a.exposure);
  };
  const hsl = (c: THREE.Color) => {
    const h = { h: 0, s: 0, l: 0 };
    c.getHSL(h, THREE.NoColorSpace);
    return h;
  };
  it('a 1 900 m (San Marco) e a 2 240 m (il Sella): luminanza sotto 0,45 e saturazione sopra 0,45', () => {
    for (const alt of [1900, 2240]) {
      for (const deg of [12, 15, 25]) {
        const c = dome(alt, deg);
        expect(lumOf(c)).toBeLessThan(0.45);
        expect(hsl(c).s).toBeGreaterThan(0.45);
        expect(c.b).toBeGreaterThan(c.r * 2);
      }
    }
  });
  it('a Bergamo (300 m) il cielo non cambia; a 1 000 m appena', () => {
    expect(atmosphere(sun, CLEAR, 300).mid.getHex()).toBe(atmosphere(sun, CLEAR).mid.getHex());
    expect(lumOf(dome(300, 15))).toBeGreaterThan(0.6);
    expect(lumOf(dome(1000, 15))).toBeGreaterThan(lumOf(dome(1900, 15)) + 0.15);
    expect(new THREE.Color(HIGH_SKY.mid).b).toBeGreaterThan(new THREE.Color(HIGH_SKY.mid).r * 3);
  });
});

// ---------- R6: la quota col separatore ----------

describe('R6 · la quota delle cime col separatore delle migliaia', () => {
  it('«2.112 m» nel cielo come nelle pagine; sotto mille senza punto', () => {
    expect(peakSub(2112).replace(/\s/g, ' ')).toBe('2.112 m');
    expect(peakSub(3343).replace(/\s/g, ' ')).toBe('3.343 m');
    expect(peakSub(945).replace(/\s/g, ' ')).toBe('945 m');
    // l'italiano di Intl non raggruppa le quattro cifre: per questo non basta toLocaleString
    expect((2112).toLocaleString('it-IT')).toBe('2112');
  });
});

// ---------- il ritocco del collaudo ----------

describe('il ritocco dell’aspetto e della data per il collaudo', () => {
  const g = globalThis as { __orobiaLook?: unknown; __orobiaDate?: unknown };
  afterEach(() => {
    delete g.__orobiaLook;
    delete g.__orobiaDate;
  });
  it('__orobiaLook cambia solo i campi dati, e solo per quel mondo', () => {
    g.__orobiaLook = { sellaronda: { meadowTop: 2600, rock: { light: '#ffffff' } } };
    const t = lookFor('sellaronda');
    expect(t.meadowTop).toBe(2600);
    expect(t.rock.light).toBe('#ffffff');
    expect(t.rock.dark).toBe(sella.rock.dark);
    expect(t.case).toBe('ladino');
    expect(lookFor('sellaronda')).toBe(t);
    expect(lookFor('bergamo')).toBe(LOOKS.bergamo);
    delete g.__orobiaLook;
    expect(lookFor('sellaronda')).toBe(sella);
  });
  it('__orobiaDate sposta la stagione; senza, è adesso', () => {
    const now = new Date('2026-11-11T10:00:00');
    expect(seasonDate(now)).toBe(now);
    g.__orobiaDate = '2026-08-15';
    expect(seasonDate(now).getMonth()).toBe(7);
    expect(lookContext('sellaronda').season.larch).toBe('verde');
    g.__orobiaDate = 'non una data';
    expect(seasonDate(now)).toBe(now);
  });
});

// ---------- il rilievo delle pareti (S2.13) ----------

describe('il rilievo delle pareti: il contrasto che il DEM a 25 m ha perso', () => {
  const side = 41;
  const step = 25;
  const grid = (f: (i: number, j: number) => number) => {
    const h = new Float32Array(side * side);
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) h[j * side + i] = f(i, j);
    return h;
  };
  it('un prato a 15° e una strada restano come sono', () => {
    const h = grid((i) => 2000 + i * step * Math.tan((15 * Math.PI) / 180));
    const before = h.slice();
    expect(sharpenRelief(h, side, step, S2_RILIEVO)).toBe(0);
    expect([...h]).toEqual([...before]);
  });
  it('una torre sale, la forcella accanto scende, il bordo della mattonella non si muove', () => {
    // due torri a cono (60°) separate da una forcella, sopra un piano a 2200 m
    const cone = (i: number, j: number, ci: number, cj: number) => Math.max(0, 500 - Math.hypot(i - ci, j - cj) * step * Math.tan((60 * Math.PI) / 180));
    const h = grid((i, j) => 2200 + Math.max(cone(i, j, 16, 20), cone(i, j, 24, 20)));
    const before = h.slice();
    sharpenRelief(h, side, step, S2_RILIEVO);
    const at = (i: number, j: number) => j * side + i;
    expect(h[at(16, 20)]).toBeGreaterThan(before[at(16, 20)] + 20);
    expect(h[at(20, 20)]).toBeLessThan(before[at(20, 20)]);
    for (let i = 0; i < side; i++) {
      expect(h[at(i, 0)]).toBe(before[at(i, 0)]);
      expect(h[at(0, i)]).toBe(before[at(0, i)]);
      expect(h[at(side - 1, i)]).toBe(before[at(side - 1, i)]);
    }
    // Bergamo non si tocca, e il Sellaronda col LiDAR non ne ha più bisogno (pista S3)
    expect(RILIEVO.bergamo).toBeUndefined();
    expect(RILIEVO.sellaronda).toBeUndefined();
  });
});
