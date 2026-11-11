import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLAG, WorldGraph, type WorldGraphFile } from '../src/open/graph';
import { createWorldField } from '../src/open/field';
import { LIGHT_CAP, readyReason } from '../src/open/pronto';
import { decodeFeatures, Terrain, type RideDef } from '../src/open/world';
import type { WorldManifest } from '../src/open/worlds';
import { fileLeggero, LEGGERO, paccoDa, pesoLeggero } from '../src/lib/rete';

const root = join(__dirname, '..', 'public', 'world');
const manifest = (id: string) => JSON.parse(readFileSync(join(root, id, 'manifest.json'), 'utf8')) as WorldManifest;

describe('il mondo leggero (A15)', () => {
  it('sono i sei file del piano, senza case né terreno fine', () => {
    expect([...LEGGERO].sort()).toEqual(['far.bin', 'features.json', 'graph.json', 'manifest.json', 'monumenti.json', 'rides.json']);
    expect(fileLeggero('b/0_12.json')).toBe(false);
    expect(fileLeggero('dem/3_4.bin')).toBe(false);
  });

  it('lo stato del pacco dai file in cache: leggero coi soli file di A15, intero con tutti, niente senza il grafo', () => {
    const m = manifest('bergamo');
    const light = new Set(m.files.map(([p]) => p).filter(fileLeggero));
    expect(paccoDa(light, m)).toBe('leggero');
    expect(paccoDa(new Set([...light, 'b/0_12.json', 'dem/3_4.bin']), m)).toBe('leggero');
    expect(paccoDa(new Set(m.files.map(([p]) => p)), m)).toBe('intero');
    light.delete('graph.json');
    expect(paccoDa(light, m)).toBe('niente');
    expect(paccoDa(new Set(), m)).toBe('niente');
  });

  it('il pacco di Bergamo sta sotto i 7 MB in cache (dal manifesto); il Sellaronda sotto 1,2', () => {
    const b = pesoLeggero(manifest('bergamo'));
    expect(b).toBeGreaterThan(5_000_000);
    expect(b).toBeLessThanOrEqual(7_000_000);
    expect(pesoLeggero(manifest('sellaronda'))).toBeLessThanOrEqual(1_200_000);
  });

  it('il «pronto» nel mondo leggero dice leggero, subito: mai tutto, mai tetto', () => {
    expect(readyReason(1, false, 300, 60_000, true)).toBe('leggero');
    expect(readyReason(0.4, false, LIGHT_CAP + 1, 60_000, true)).toBe('leggero');
    expect(readyReason(0.4, false, 500, 60_000, true)).toBeNull();
    expect(readyReason(0.2, true, 500, 60_000, true)).toBe('errore');
    // il mondo intero come prima
    expect(readyReason(1, false, 300, 60_000)).toBe('tutto');
    expect(readyReason(0.5, false, 61_000, 60_000)).toBe('tetto');
  });
});

describe('il terreno nel mondo leggero', () => {
  afterEach(() => vi.unstubAllGlobals());

  const dir = join(root, 'bergamo');
  const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
  const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as Parameters<typeof decodeFeatures>[0]);
  const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
  const far = readFileSync(join(dir, 'far.bin'));

  async function lightTerrain() {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(String(url));
      if (String(url).endsWith('far.bin')) return new Response(new Uint8Array(far));
      return new Response('', { status: 404 });
    });
    const terrain = new Terrain(graph, '/world/bergamo/');
    terrain.light = true;
    await terrain.loadFar();
    return { terrain, asked };
  }

  it('nessuna richiesta a dem/: le mattonelle non si chiedono, la quota è quella lontana', async () => {
    const { terrain, asked } = await lightTerrain();
    expect(await terrain.load(10, 10)).toBeNull();
    await terrain.around(0, 0, 3000);
    expect(asked.filter((u) => u.includes('/dem/'))).toHaveLength(0);
    expect(terrain.failedAround(0, 0, 3000)).toBe(false);
    expect(terrain.height(1200, -800)).toBeCloseTo(terrain.farHeight(1200, -800), 5);
  });

  /** Quanto sotto (o sopra) la strada sta il terreno, sulla mezzeria e a un metro fuori dal bordo. */
  function scarti(terrain: Terrain, id: string) {
    const field = createWorldField(graph, terrain, features);
    const spacing = 6;
    const r = rides.find((x) => x.id === id)!;
    let sotto = 0;
    let sopra = -Infinity;
    let bordo = 0;
    for (const [edge] of r.legs) {
      const e = graph.edges[edge];
      if (e.flags & (FLAG.bridge | FLAG.tunnel)) continue;
      for (let k = 0; k + 1 < e.xs.length; k += 3) {
        const road = e.ys[k];
        const h = field.height(e.xs[k], e.zs[k], spacing);
        sotto = Math.max(sotto, road - h);
        sopra = Math.max(sopra, h - road);
        // un metro fuori dal bordo, di lato
        const dx = e.xs[k + 1] - e.xs[k];
        const dz = e.zs[k + 1] - e.zs[k];
        const l = Math.hypot(dx, dz) || 1;
        const off = e.hw + 1;
        const hb = field.height(e.xs[k] - (dz / l) * off, e.zs[k] + (dx / l) * off, spacing);
        bordo = Math.max(bordo, Math.abs(hb - road));
      }
    }
    return { sotto, sopra, bordo };
  }

  it('la strada spiana il terreno lontano nel suo corridoio: non galleggia, non entra nel pendio', async () => {
    const { terrain } = await lightTerrain();
    // lo stesso col terreno fine (dem/ dal disco): il leggero non deve fare peggio
    const fine = new Terrain(graph, '/world/bergamo/');
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      try {
        return new Response(new Uint8Array(readFileSync(join(dir, u.slice(u.indexOf('/world/bergamo/') + '/world/bergamo/'.length)))));
      } catch {
        return new Response('', { status: 404 });
      }
    });
    await fine.loadFar();
    for (const id of ['ganda', 'citta-alta']) {
      const r = rides.find((x) => x.id === id)!;
      for (const [edge] of r.legs) {
        const e = graph.edges[edge];
        await fine.around(e.xs[0], e.zs[0], 200);
      }
      const leggero = scarti(terrain, id);
      const intero = scarti(fine, id);
      // mai sopra l'asfalto: la strada non entra nel pendio
      expect(leggero.sopra, id).toBeLessThanOrEqual(0);
      // sotto la mezzeria e accanto al bordo, come nel mondo intero (mezzo metro di tolleranza)
      expect(leggero.sotto, id).toBeLessThanOrEqual(intero.sotto + 0.5);
      expect(leggero.bordo, id).toBeLessThanOrEqual(Math.max(3, intero.bordo + 0.5));
    }
  }, 60_000);
});
