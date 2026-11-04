import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorldGraphFile } from '../src/open/graph';
import { decodeMonumenti, type MonumentiFile, type Monumento } from '../src/open/monumenti';
import { decodeDemTile } from '../src/open/world';
import { monumentoGeometry, TRI_CAP } from '../src/world/monumenti/archetipi';

// I monumenti come li scarica la pagina (scripts/world/monumenti.ts dentro npm run world:build).
const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const graph = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile;
const file = JSON.parse(readFileSync(join(dir, 'monumenti.json'), 'utf8')) as MonumentiFile;
const list = decodeMonumenti(file);

/** Dal riferimento del modello al mondo: come Object3D con rotation.y = yaw. */
const toWorld = (m: Monumento, [x, z]: [number, number]): [number, number] => [m.x + x * Math.cos(m.yaw) + z * Math.sin(m.yaw), m.z - x * Math.sin(m.yaw) + z * Math.cos(m.yaw)];

// il DEM delle mattonelle, letto come Terrain.height (bilineare a 25 m)
const n = Math.round(graph.tile / graph.demStep);
const tiles = new Map<string, ReturnType<typeof decodeDemTile>>();
function dem(x: number, z: number): number {
  const b = graph.bounds;
  const tx = Math.floor((x - b.x0) / graph.tile);
  const tz = Math.floor((z - b.z0) / graph.tile);
  const key = `${tx}_${tz}`;
  let t = tiles.get(key);
  if (!t) {
    t = decodeDemTile(new Uint8Array(readFileSync(join(dir, 'dem', `${key}.bin`))), n, tx, tz);
    tiles.set(key, t);
  }
  const fx = Math.min(n - 0.0001, Math.max(0, (x - b.x0 - tx * graph.tile) / graph.demStep));
  const fz = Math.min(n - 0.0001, Math.max(0, (z - b.z0 - tz * graph.tile) / graph.demStep));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const s = n + 1;
  const k = j * s + i;
  return t.h[k] * (1 - u) * (1 - v) + t.h[k + 1] * u * (1 - v) + t.h[k + s] * (1 - u) * v + t.h[k + s + 1] * u * v;
}

describe('i monumenti del mondo', () => {
  it('sono quaranta, ognuno un elemento OSM diverso, col nome e l’archetipo', () => {
    expect(list.length).toBe(40);
    expect(new Set(list.map((m) => m.id)).size).toBe(40);
    for (const m of list) {
      expect(m.id).toMatch(/^[wrn]\d+$/);
      expect(m.name.length).toBeGreaterThan(3);
      expect(m.name[0]).toBe(m.name[0].toUpperCase());
    }
    // le porte delle Mura, il Campanone, il mausoleo di Gazzaniga: quelli chiesti per nome
    const names = list.map((m) => m.name);
    for (const want of ["Porta Sant'Agostino", "Porta Sant'Alessandro", 'Porta San Giacomo', 'Porta San Lorenzo', 'Campanone', 'Cappella Colleoni', 'Torre dei Caduti', 'Mausoleo Briolini']) expect(names).toContain(want);
  });

  it('stanno tutti dentro il mondo pedalabile', () => {
    const b = graph.bounds;
    for (const m of list) {
      expect(m.x, m.name).toBeGreaterThan(b.x0);
      expect(m.x, m.name).toBeLessThan(b.x1);
      expect(m.z, m.name).toBeGreaterThan(b.z0);
      expect(m.z, m.name).toBeLessThan(b.z1);
    }
  });

  it('le impronte sono anelli veri, dentro le misure del rettangolo', () => {
    for (const m of list) {
      for (const r of m.rings) {
        expect(r.length, m.name).toBeGreaterThanOrEqual(3);
        let a = 0;
        for (let i = 0; i < r.length; i++) a += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1];
        expect(Math.abs(a / 2), m.name).toBeGreaterThan(1);
        for (const [x, z] of r) {
          expect(Math.abs(x), m.name).toBeLessThanOrEqual(m.w / 2 + 0.2);
          expect(Math.abs(z), m.name).toBeLessThanOrEqual(m.d / 2 + 0.2);
        }
      }
      // solo le statue e le stele su un nodo OSM possono stare senza impronta
      if (!m.rings.length) expect(['statua', 'caduti']).toContain(m.kind);
      expect(m.h, m.name).toBeGreaterThan(2);
      expect(m.reach, m.name).toBeGreaterThanOrEqual(35);
    }
  });

  it('poggiano sul terreno: lo zoccolo arriva sotto il punto più basso dell’impronta', () => {
    for (const m of list) {
      expect(m.y, m.name).toBeGreaterThanOrEqual(m.yMin);
      const pts = m.rings.length ? m.rings.flat() : ([[0, 0]] as [number, number][]);
      for (const p of pts) {
        const [x, z] = toWorld(m, p);
        // il terreno di chi pedala scende al più alla strada: yMin sta sotto il DEM di ogni vertice
        expect(m.yMin, `${m.name} in ${x.toFixed(0)},${z.toFixed(0)}`).toBeLessThanOrEqual(dem(x, z) + 0.05);
      }
      const g = monumentoGeometry(m, 'bassa');
      expect(g.boundingBox!.min.y, m.name).toBeLessThanOrEqual(m.yMin - m.y + 0.05);
      g.dispose();
    }
  });

  it('ogni modello sta nel suo tetto di triangoli, ai due livelli di dettaglio', () => {
    const report: string[] = [];
    for (const m of list) {
      for (const det of ['alta', 'bassa'] as const) {
        const g = monumentoGeometry(m, det);
        const pos = g.attributes.position.array as Float32Array;
        const tris = pos.length / 9;
        report.push(`${det} ${String(tris).padStart(5)} ${m.name}`);
        expect(tris, `${m.name} (${det})`).toBeLessThanOrEqual(TRI_CAP[det]);
        expect(tris, `${m.name} (${det})`).toBeGreaterThan(det === 'alta' ? 60 : 8);
        for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new Error(`${m.name}: coordinata non finita`);
        // il modello alto non è più basso del basso: il dettaglio si aggiunge, non si toglie
        g.dispose();
      }
    }
    if (process.env.MONUMENTI_TRIS) console.log(report.join('\n'));
  });

  it('l’edificio generico che occupava l’impronta non c’è più (niente compenetrazioni)', () => {
    const bdir = join(dir, 'b');
    if (!existsSync(bdir)) return;
    const big = list.filter((m) => m.rings.length && m.kind !== 'statua' && m.kind !== 'caduti');
    const inside = (r: [number, number][], x: number, z: number) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > z !== r[j][1] > z && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      return c;
    };
    const hits: string[] = [];
    for (const f of readdirSync(bdir)) {
      const t = JSON.parse(readFileSync(join(bdir, f), 'utf8')) as { o: [number, number]; b: number[][] };
      for (const rec of t.b) {
        let x = 0;
        let z = 0;
        let cx = 0;
        let cz = 0;
        const k = (rec.length - 4) / 2;
        for (let i = 4; i < rec.length; i += 2) {
          x += rec[i];
          z += rec[i + 1];
          cx += t.o[0] + x / 10;
          cz += t.o[1] + z / 10;
        }
        cx /= k;
        cz /= k;
        for (const m of big) {
          if (Math.abs(cx - m.x) > m.w + m.d || Math.abs(cz - m.z) > m.w + m.d) continue;
          // nel riferimento del modello
          const dx = cx - m.x;
          const dz = cz - m.z;
          const lx = dx * Math.cos(m.yaw) - dz * Math.sin(m.yaw);
          const lz = dx * Math.sin(m.yaw) + dz * Math.cos(m.yaw);
          if (m.rings.some((r) => inside(r, lx, lz))) hits.push(`${m.name}: edificio in ${cx.toFixed(0)},${cz.toFixed(0)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
