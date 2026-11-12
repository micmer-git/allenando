import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fineBlender } from '../scripts/world/dtm.mjs';
import { fromUtm, toUtm } from '../scripts/world/utm.mjs';
import { CIME_SELLARONDA, peakHeights } from '../src/open/cime';
import type { WorldGraphFile } from '../src/open/graph';
import { addBuilding, roofShape, minRect, ringArea, Tris } from '../src/open/buildings';
import { decodeDemTile, BUILDING_KIND, type Building } from '../src/open/world';

/*
 * Pista S3: il rilievo vero del Sellaronda. Il terreno viene dal LiDAR dell'Alto Adige (2,5 m) e
 * del Trentino (1 m) dove le province lo danno, EU-DEM altrove; le mattonelle ripide sono a 12,5 m,
 * le altre a 25. Qui: le cime alle quote di OSM, il bordo fra una mattonella fine e una grossa
 * senza gradini, il passaggio dal LiDAR a EU-DEM senza gradini, il peso, le case ladine.
 */

const dir = join(__dirname, '..', 'public', 'world', 'sellaronda');
const read = (f: string) => new Uint8Array(readFileSync(join(dir, f)));
const file = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile;
const n0 = Math.round(file.tile / file.demStep);
const tiles = new Map<string, ReturnType<typeof decodeDemTile>>();
for (const f of readdirSync(join(dir, 'dem'))) {
  const [tx, tz] = f.replace('.bin', '').split('_').map(Number);
  tiles.set(`${tx}_${tz}`, decodeDemTile(read(`dem/${f}`), n0, tx, tz));
}

/** La quota bilineare dentro una mattonella data (anche sul suo bordo), come Terrain.height. */
function inTile(tx: number, tz: number, x: number, z: number): number {
  const t = tiles.get(`${tx}_${tz}`)!;
  const s = file.tile / t.n;
  const fx = Math.min(t.n - 1e-9, Math.max(0, (x - file.bounds.x0 - tx * file.tile) / s));
  const fz = Math.min(t.n - 1e-9, Math.max(0, (z - file.bounds.z0 - tz * file.tile) / s));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const side = t.n + 1;
  const k = j * side + i;
  return t.h[k] * (1 - u) * (1 - v) + t.h[k + 1] * u * (1 - v) + t.h[k + side] * (1 - u) * v + t.h[k + side + 1] * u * v;
}

describe('S3 · le cime alle quote vere', () => {
  const rows = peakHeights(dir, read, CIME_SELLARONDA);

  it('le cime delle 13 viste ci sono tutte', () => {
    expect(rows.map((r) => r.name).sort()).toEqual([...CIME_SELLARONDA].sort());
  });

  // la Punta Penia sta sul confine col Veneto, che non ha un servizio aperto: lì il LiDAR del
  // Trentino arriva fino alla cresta, e la cima la porta lui
  for (const name of CIME_SELLARONDA) {
    it(`${name}: entro ±10 m dalla quota di OSM`, () => {
      const r = rows.find((q) => q.name === name)!;
      expect(Math.abs(r.dem - r.ele), `${name}: OSM ${r.ele}, terreno ${r.dem.toFixed(1)}`).toBeLessThanOrEqual(10);
    });
  }

  it('le torri stanno in mattonelle fini (12,5 m)', () => {
    for (const r of rows) expect(r.step, r.name).toBe(12.5);
  });
});

describe('S3 · mattonelle a passo diverso', () => {
  it('ci sono mattonelle fini e grosse, e il lato si legge dalla lunghezza', () => {
    const steps = new Set([...tiles.values()].map((t) => file.tile / t.n));
    expect([...steps].sort()).toEqual([12.5, 25]);
  });

  it('sul bordo fra due mattonelle la quota è la stessa vista dalle due parti (entro 10 cm), qualunque sia il passo', () => {
    let pairs = 0;
    let mixed = 0;
    let worst = 0;
    for (const [key, t] of tiles) {
      const [tx, tz] = key.split('_').map(Number);
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ]) {
        const o = tiles.get(`${tx + dx}_${tz + dz}`);
        if (!o) continue;
        pairs++;
        if (o.n !== t.n) mixed++;
        // il lato in comune, un punto al metro
        for (let s = 0; s <= file.tile; s += 1) {
          const x = file.bounds.x0 + (tx + dx) * file.tile + (dx ? 0 : s);
          const z = file.bounds.z0 + (tz + dz) * file.tile + (dz ? 0 : s);
          const a = inTile(tx, tz, x, z);
          const b = inTile(tx + dx, tz + dz, x, z);
          worst = Math.max(worst, Math.abs(a - b));
        }
      }
    }
    expect(pairs).toBeGreaterThan(150);
    expect(mixed, 'confini fra una mattonella a 12,5 m e una a 25 m').toBeGreaterThan(10);
    expect(worst).toBeLessThanOrEqual(0.1);
  });

  it('niente gradini vicino al bordo di una mattonella fine: la pendenza attraverso il bordo è quella dei due lati', () => {
    // per ogni bordo fine/grosso, il salto fra il punto 1 m prima e 1 m dopo il bordo non supera
    // il salto fra due punti a 2 m di distanza poco più dentro (niente scalino sul confine)
    let checked = 0;
    let bad = 0;
    for (const [key, t] of tiles) {
      const [tx, tz] = key.split('_').map(Number);
      const o = tiles.get(`${tx + 1}_${tz}`);
      if (!o || o.n === t.n) continue;
      const xb = file.bounds.x0 + (tx + 1) * file.tile;
      for (let s = 5; s < file.tile; s += 10) {
        const z = file.bounds.z0 + tz * file.tile + s;
        const across = Math.abs(inTile(tx + 1, tz, xb + 1, z) - inTile(tx, tz, xb - 1, z));
        const inside = Math.max(Math.abs(inTile(tx, tz, xb - 1, z) - inTile(tx, tz, xb - 3, z)), Math.abs(inTile(tx + 1, tz, xb + 3, z) - inTile(tx + 1, tz, xb + 1, z)));
        checked++;
        if (across > inside * 1.6 + 0.3) bad++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(bad).toBe(0);
  });
});

describe('S3 · dal LiDAR a EU-DEM senza gradini', () => {
  // un disco di dato fine di 3 km di raggio, 35 m sopra EU-DEM (un pendio a 15°), con una cima
  // di 120 m a 100 m dal bordo, come la Punta Penia sul confine col Veneto
  const slope = Math.tan((15 * Math.PI) / 180);
  const coarse = (x: number, z: number) => 1500 + x * slope + z * 0.01;
  const peak = (x: number, z: number) => Math.max(0, 120 - Math.hypot(x - 2900, z) * 2);
  const fineF = (x: number, z: number) => (Math.hypot(x, z) < 3000 ? coarse(x, z) + 35 + peak(x, z) : NaN);
  const b = fineBlender(fineF, coarse, { x0: -5000, z0: -5000, x1: 5000, z1: 5000 }, 25, 60, 250);

  it('dentro vale il LiDAR, fuori EU-DEM, e la cima sul bordo resta alla sua quota', () => {
    expect(b.height(0, 0)).toBeCloseTo(fineF(0, 0), 3);
    expect(b.height(-3600, 0)).toBeCloseTo(coarse(-3600, 0), 3);
    expect(Math.abs(b.height(2900, 0) - fineF(2900, 0))).toBeLessThan(10);
  });

  it('attraverso il bordo il terreno non salta: mai più di 1,5 m in un metro fuori dalla cima', () => {
    let worst = 0;
    for (const zz of [0, 700, -1500]) {
      let prev = b.height(-3999, zz);
      for (let x = -3998; x <= 0; x++) {
        const h = b.height(x, zz);
        // il pendio stesso fa 0,27 m al metro
        worst = Math.max(worst, Math.abs(h - prev) - slope);
        prev = h;
      }
    }
    expect(worst).toBeLessThanOrEqual(1.5);
  });

  it('UTM 32N: andata e ritorno al centimetro, e la tavola LiDAR del Trentino dov’è', () => {
    const [E, N] = toUtm(46.52494, 11.73531);
    const g = fromUtm(E, N);
    expect(Math.abs(g.lat - 46.52494) * 111_000).toBeLessThan(0.01);
    expect(Math.abs(g.lon - 11.73531) * 76_000).toBeLessThan(0.01);
    // l'angolo della tavola dtm000036 (709990, 5149990) sta sopra Canazei
    const c = fromUtm(709990, 5149990);
    expect(c.lat).toBeCloseTo(46.4708, 3);
    expect(c.lon).toBeCloseTo(11.7353, 3);
  });
});

describe('S3 · il peso', () => {
  it('public/world/sellaronda pesa al massimo 12 MB', () => {
    const size = (p: string): number => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, f) => s + size(join(p, f)), 0) : statSync(p).size);
    expect(size(dir) / 1e6).toBeLessThanOrEqual(12);
  });
});

describe('S3 · le case ladine', () => {
  const ring = (w: number, d: number): Float32Array => new Float32Array([0, 0, w, 0, w, d, 0, d]);
  // un hotel di 46 × 24 m (1104 m²), 16 m alla gronda: oltre i 950 m² del tetto a falde lombardo
  const hotel = { ring: ring(46, 24), h: 16, minH: 0, kind: BUILDING_KIND.house, roof: 0 } as unknown as Building;
  const colors = { wall: { r: 0.95, g: 0.94, b: 0.9 }, base: { r: 0.85, g: 0.84, b: 0.8 }, roof: { r: 0.3, g: 0.28, b: 0.26 }, tiles: { r: 0.3, g: 0.28, b: 0.26 }, blind: false };
  const wood = { r: 0.54, g: 0.35, b: 0.2 };

  it('un hotel di 1104 m² e 5 piani ha il tetto a due falde, non piatto', () => {
    const obb = minRect(hotel.ring);
    expect(roofShape(hotel, obb, Math.abs(ringArea(hotel.ring)))).toBe('flat');
    expect(roofShape(hotel, obb, Math.abs(ringArea(hotel.ring)), true, true)).toBe('gable');
  });

  it('i balconi di legno in rilievo a ogni piano sopra il terreno, solo se chiesti', () => {
    const count = (balconies: boolean) => {
      const walls = new Tris();
      const roofs = new Tris();
      addBuilding(walls, roofs, hotel, 1500, { ...colors, pitch: Math.tan((24 * Math.PI) / 180), eaves: 1.3, wide: true, alpine: { wood, balconies } });
      return walls.count;
    };
    const plain = count(false);
    const rich = count(true);
    // quattro lati di almeno 5 m, tre piani sopra il terreno (la gronda a 12,8 m), 10 triangoli per
    // balcone: soletta sotto e sopra, ringhiera, i due capi
    expect(rich - plain).toBe(4 * 3 * 10);
  });
});

describe('S3 · le fonti nell’app', () => {
  it('la pagina Mondo del Sellaronda cita il LiDAR delle due province con la licenza; Bergamo resta EU-DEM', async () => {
    const { worldInfo } = await import('../src/open/world-table');
    const s = worldInfo('sellaronda').quoteCredits;
    expect(s).toMatch(/Provincia autonoma di Bolzano – Alto Adige \(CC0 1\.0\)/);
    expect(s).toMatch(/Provincia autonoma di Trento \(CC BY 4\.0\)/);
    expect(s).toMatch(/EU-DEM © Copernicus/);
    expect(worldInfo('sellaronda').quote).toBe('Quote LiDAR Alto Adige e Trentino, EU-DEM');
    expect(worldInfo('bergamo').quote).toBe('Quote EU-DEM');
    expect(worldInfo('bergamo').quoteCredits).toContain('Quote EU-DEM © Copernicus.');
    expect(worldInfo('bergamo').quoteCredits).toContain('DBGT rielaborati © Regione Lombardia (CC BY 4.0)');
  });

  it('il grafo del Sellaronda porta l’attribuzione delle province', () => {
    expect(file.attribution).toMatch(/OpenStreetMap/);
    expect(file.attribution).toMatch(/DTM 2,5 m © Provincia autonoma di Bolzano – Alto Adige, CC0 1\.0/);
    expect(file.attribution).toMatch(/LiDAR PAT 2006\/2008 © Provincia autonoma di Trento, CC BY 4\.0/);
  });
});

describe('S3 · la fascia di mezzo', () => {
  it('due mattonelle di mezzo vicine hanno lo stesso bordo, e la gonna scende 60 m', { timeout: 30000 }, async () => {
    const { WorldGraph } = await import('../src/open/graph');
    const { Terrain } = await import('../src/open/world');
    const { midGeometry, midSpacing, MID_SKIRT_M } = await import('../src/open/midTerrain');
    const { lookContext } = await import('../src/open/look');
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      try {
        const b = readFileSync(join(dir, String(url).replace(/^.*\/world\/sellaronda\//, '')));
        return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
      } catch {
        return { ok: false };
      }
    }) as unknown as typeof fetch;
    try {
      const terrain = new Terrain(new WorldGraph(file), '/world/sellaronda/');
      await terrain.loadFar();
      await terrain.around(file.bounds.x0 + 5 * file.tile, file.bounds.z0 + 4.5 * file.tile, 2500);
      const ctx = lookContext('sellaronda', new Date('2026-11-11T12:00:00'));
      expect(midSpacing(3000)).toBe(25);
      expect(midSpacing(6000)).toBe(50);
      for (const s of [25, 50]) {
        const a = midGeometry(terrain, 4, 4, s, ctx);
        const b = midGeometry(terrain, 5, 4, s, ctx);
        const n = Math.round(file.tile / s);
        const side = n + 1;
        const pa = a.getAttribute('position');
        const pb = b.getAttribute('position');
        let worst = 0;
        for (let j = 0; j < side; j++) {
          // il lato est di a (i = n) è il lato ovest di b (i = 0)
          const ka = j * side + n;
          const kb = j * side;
          expect(pa.getX(ka)).toBeCloseTo(pb.getX(kb), 3);
          worst = Math.max(worst, Math.abs(pa.getY(ka) - pb.getY(kb)));
        }
        expect(worst).toBeLessThan(0.01);
        // la gonna: gli ultimi 4 × side vertici, MID_SKIRT_M sotto il bordo
        expect(pa.getY(side * side)).toBeCloseTo(pa.getY(0) - MID_SKIRT_M, 3);
        expect(a.getIndex()!.count / 3).toBe(n * n * 2 + 4 * n * 4);
      }
    } finally {
      globalThis.fetch = real;
    }
  });
});
