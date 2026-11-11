import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORLDS as CONFIG_WORLDS, worldConfig } from '../scripts/world/config.mjs';
import { italianName } from '../scripts/world/nomi';
import { SPECS_BY_WORLD as RIDE_SPECS } from '../scripts/world/rides';
import { SPECS_BY_WORLD as MONUMENTI_SPECS } from '../scripts/world/monumenti';
import { parseWorldJoin, parseWorldMessage } from '../src/multiplayer/world-protocol';
import { WORLD_IDS, WORLD_LIMITS, WORLD_RIDES, isWorldId, worldEdges, worldOfRide } from '../src/multiplayer/world-rides';
import { WORLDS, isWorld, worldInfo, worldOfRouteId, type RideDef } from '../src/open/world';
import type { WorldGraphFile } from '../src/open/graph';

/*
 * Pista S1 (il mondo «Sellaronda»): la tabella dei mondi. Bergamo deve uscire dalla
 * configurazione con gli stessi numeri di prima, e l'app deve sapere di avere due mondi.
 */

const pub = (id: string, name: string) => JSON.parse(readFileSync(join(__dirname, '..', 'public', 'world', id, name), 'utf8')) as unknown;

describe('S1.1 · la tabella dei mondi (scripts/world/config.mjs)', () => {
  it('Bergamo ha i numeri di sempre: la configurazione sola ricostruisce il mondo in onda', () => {
    const b = worldConfig('bergamo');
    expect(b.region).toEqual({ s: 45.66, w: 9.5, n: 46.075, e: 10.1 });
    expect(b.city).toEqual({ s: 45.664, w: 9.618, n: 45.727, e: 9.712 });
    expect(b.horizon).toEqual({ s: 45.5, w: 9.25, n: 46.25, e: 10.38 });
    expect(b.origin).toEqual({ lat: (45.66 + 46.075) / 2, lon: (9.5 + 10.1) / 2 });
    expect([b.demStep, b.tile, b.farStep]).toEqual([25, 2000, 250]);
    expect(b.alpino).toBeUndefined();
    expect(b.lang).toBeUndefined();
    // il grafo pubblicato di Bergamo porta esattamente questi numeri: origine, confini, passo, orizzonte
    const g = pub('bergamo', 'graph.json') as WorldGraphFile;
    expect(g.id).toBe('bergamo');
    expect(g.name).toBe(b.name);
    expect(g.origin).toEqual(b.origin);
    expect(g.demStep).toBe(b.demStep);
    expect(g.tile).toBe(b.tile);
    expect(g.far.step).toBe(b.farStep);
    const RAD = Math.PI / 180;
    const mLat = RAD * 6371008.8;
    const mLon = mLat * Math.cos(b.origin.lat * RAD);
    const toLocal = (lat: number, lon: number) => [(lon - b.origin.lon) * mLon, -(lat - b.origin.lat) * mLat];
    const [bx0, bz1] = toLocal(b.region.s, b.region.w);
    const [bx1, bz0] = toLocal(b.region.n, b.region.e);
    expect(g.bounds).toEqual({ x0: Math.floor(bx0), z0: Math.floor(bz0), x1: Math.ceil(bx1), z1: Math.ceil(bz1) });
    const [hx0, hz1] = toLocal(b.horizon.s, b.horizon.w);
    const [hx1, hz0] = toLocal(b.horizon.n, b.horizon.e);
    const x0 = Math.floor(hx0 / b.farStep) * b.farStep;
    const z0 = Math.floor(hz0 / b.farStep) * b.farStep;
    expect(g.far).toEqual({ step: b.farStep, x0, z0, nx: Math.floor((hx1 - x0) / b.farStep) + 1, nz: Math.floor((hz1 - z0) / b.farStep) + 1 });
  });

  it('il Sellaronda: i quattro passi con Canazei e il Fedaia, l’orizzonte fino alla Marmolada e al Puez, 120 m di passo lontano', () => {
    const s = worldConfig('sellaronda');
    expect(s.region).toEqual({ s: 46.43, w: 11.68, n: 46.6, e: 11.95 });
    expect(s.horizon).toEqual({ s: 46.3, w: 11.55, n: 46.68, e: 12.1 });
    expect(s.farStep).toBe(120);
    expect(s.demStep).toBe(25);
    expect(s.alpino).toEqual({ treeLine: 2100, rockSlope: 38 });
    expect(s.lang).toBe('it');
    expect(s.osmDir).toBe('osm-sellaronda');
    // dentro il mondo: i quattro passi, Canazei, Selva, Corvara, Arabba, il Fedaia
    const inside = (lat: number, lon: number) => lat > s.region.s && lat < s.region.n && lon > s.region.w && lon < s.region.e;
    for (const [lat, lon] of [
      [46.5081, 11.7673],
      [46.4876, 11.8122],
      [46.5498, 11.8084],
      [46.5139, 11.8724],
      [46.4769, 11.7711],
      [46.5552, 11.7601],
      [46.5496, 11.874],
      [46.4972, 11.8741],
      [46.464, 11.8626],
    ])
      expect(inside(lat, lon)).toBe(true);
    expect(() => worldConfig('stelvio')).toThrow();
    expect(Object.keys(CONFIG_WORLDS)).toEqual(['bergamo', 'sellaronda']);
  });

  it('i nomi trilingui diventano italiani; quelli di Bergamo restano', () => {
    expect(italianName({ name: 'Jouf de Sela - Passo Sella - Sellajoch', 'name:it': 'Passo Sella' })).toBe('Passo Sella');
    expect(italianName({ name: 'Ju de Frara - Grödner Joch - Passo Gardena' })).toBe('Passo Gardena');
    expect(italianName({ name: 'Saslonch - Langkofel - Sassolungo' })).toBe('Sassolungo');
    expect(italianName({ name: 'Piz Boè' })).toBe('Piz Boè');
    expect(italianName({ name: 'Bergamo' })).toBe('Bergamo');
  });
});

describe('S1.5 · l’app sa di avere due mondi', () => {
  it('WORLDS: Bergamo e il Sellaronda, con nomi che cominciano con la maiuscola', () => {
    expect(WORLDS.map((w) => w.id)).toEqual(['bergamo', 'sellaronda']);
    expect(WORLDS.map((w) => w.name)).toEqual(['Bergamo e le valli', 'Sellaronda']);
    for (const w of WORLDS) {
      expect(w.tagline).toMatch(/^[A-ZÀ-Ý]/);
      for (const a of w.areas) expect(a.label).toMatch(/^[A-ZÀ-Ý]/);
      expect(w.starts.length).toBeGreaterThanOrEqual(5);
      expect(w.starts).toContain(w.home);
      expect(w.starts).toContain(w.away);
    }
    expect(isWorld('sellaronda')).toBe(true);
    expect(isWorld('stelvio')).toBe(false);
    expect(worldInfo('nessuno').id).toBe('bergamo');
    expect(worldOfRouteId('sellaronda:pordoi-arabba')).toBe('sellaronda');
    expect(worldOfRouteId('bergamo:selvino')).toBe('bergamo');
    expect(worldOfRouteId('selvino-nembro')).toBeNull();
  });

  it('le zone dei percorsi di ogni mondo sono quelle della sua tabella, e i luoghi di partenza esistono nei dati', () => {
    for (const w of WORLDS) {
      const rides = pub(w.id, 'rides.json') as RideDef[];
      const features = pub(w.id, 'features.json') as { places: [string, string, number, number, number][]; landmarks: { name: string }[] };
      const areas = new Set(w.areas.map((a) => a.id));
      for (const r of rides) expect(areas.has(r.area), `${w.id}/${r.id}: zona ${r.area}`).toBe(true);
      const names = new Set(features.places.map((p) => p[0].replace(/[’']/g, "'")));
      for (const s of w.starts) {
        if (s === 'Città Alta') continue;
        expect(names.has(s.replace(/[’']/g, "'")), `${w.id}: manca il paese ${s}`).toBe(true);
      }
    }
  });

  it('Dove ha la scelta del mondo e nessun «bergamo» cablato nei link', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'pages', 'pedala', 'Dove.tsx'), 'utf8');
    expect(src).toMatch(/WorldChooser/);
    expect(src).toMatch(/world-tagline/);
    expect(readFileSync(join(__dirname, '..', 'src', 'open', 'worlds.ts'), 'utf8')).toMatch(/WORLDS/);
    expect(src).not.toMatch(/world=bergamo/);
    for (const f of ['pages/Ride.tsx', 'multiplayer/world-client.ts', 'multiplayer/world-protocol.ts', 'domain/workouts.ts', 'domain/plans.ts', 'pages/Sessions.tsx', 'open/starts.ts', 'io/share-image.ts']) {
      const t = readFileSync(join(__dirname, '..', 'src', f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(t, f).not.toMatch(/['"`]bergamo['"`:]/);
      expect(t, f).not.toMatch(/world=bergamo/);
    }
  });
});

describe('S1.6 · il server della classifica e del mondo condiviso', () => {
  it('accetta bergamo e sellaronda, rifiuta il resto', () => {
    expect(WORLD_IDS).toEqual(['bergamo', 'sellaronda']);
    expect(isWorldId('sellaronda')).toBe(true);
    expect(isWorldId('stelvio')).toBe(false);
    expect(parseWorldJoin(new URL('https://x/world/sellaronda/ws?nick=Anna&pid=abcdefghij')).ok).toBe(true);
    expect(parseWorldJoin(new URL('https://x/world/bergamo/ws?nick=Anna&pid=abcdefghij')).ok).toBe(true);
    const no = parseWorldJoin(new URL('https://x/world/stelvio/ws?nick=Anna&pid=abcdefghij'));
    expect(no.ok).toBe(false);
    if (!no.ok) expect(no.error).toBe('world');
  });

  it('ogni mondo ha i suoi archi e i suoi percorsi, con id unici fra i mondi', () => {
    for (const w of WORLD_LIMITS) {
      const g = pub(w.id, 'graph.json') as WorldGraphFile;
      const rides = pub(w.id, 'rides.json') as RideDef[];
      expect(w.edges, w.id).toBe(g.edges.length);
      expect(Object.keys(w.rides).sort(), w.id).toEqual(rides.map((r) => r.id).sort());
      for (const r of rides) expect(worldOfRide(r.id), r.id).toBe(w.id);
    }
    const total = WORLD_LIMITS.reduce((s, w) => s + Object.keys(w.rides).length, 0);
    expect(Object.keys(WORLD_RIDES).length).toBe(total);
    expect(worldOfRide('pordoi-arabba')).toBe('sellaronda');
    expect(worldOfRide('selvino')).toBe('bergamo');
    expect(worldOfRide('stelvio')).toBeUndefined();
  });

  it('un arco vale solo nel grafo del suo mondo', () => {
    const edges = worldEdges('sellaronda');
    expect(edges).toBeGreaterThan(100);
    expect(edges).toBeLessThan(worldEdges('bergamo'));
    const pos = (e: number) => JSON.stringify({ t: 'pos', e, s: 10, r: 1, w: 200, v: 8 });
    expect(parseWorldMessage(pos(edges - 1), 'sellaronda')).not.toBeNull();
    expect(parseWorldMessage(pos(edges), 'sellaronda')).toBeNull();
    expect(parseWorldMessage(pos(edges), 'bergamo')).not.toBeNull();
    expect(parseWorldMessage(pos(worldEdges('bergamo')))).toBeNull();
    // un percorso del Sellaronda è un percorso che il server conosce
    const withRide = JSON.stringify({ t: 'pos', e: 1, s: 10, r: 1, w: 200, v: 8, ride: 'pordoi-arabba' });
    const m = parseWorldMessage(withRide, 'sellaronda');
    expect(m && m.t === 'pos' ? m.ride : null).toBe('pordoi-arabba');
  });
});

describe('S1.4 · le schede dei percorsi e dei monumenti', () => {
  it('nove percorsi del Sellaronda con gli id del piano, testi con la maiuscola e nessuna coordinata a mano', () => {
    const ids = RIDE_SPECS.sellaronda.map((s) => s.id);
    expect(ids).toEqual(['sellaronda', 'sellaronda-orario', 'sella-canazei', 'pordoi-arabba', 'pordoi-canazei', 'gardena-corvara', 'gardena-selva', 'campolongo-corvara', 'fedaia-canazei']);
    const bergamoIds = new Set(RIDE_SPECS.bergamo.map((s) => s.id));
    for (const s of RIDE_SPECS.sellaronda) {
      expect(bergamoIds.has(s.id)).toBe(false);
      expect(s.name).toMatch(/^[A-ZÀ-Ý]/);
      expect(s.blurb).toMatch(/^[A-ZÀ-Ý]/);
      expect(s.landmarks.length).toBeGreaterThanOrEqual(5);
      for (const l of s.landmarks) {
        expect(l.note).toMatch(/^[A-ZÀ-Ý]/);
        expect(l.note.length).toBeLessThan(160);
      }
      // le tappe: nomi, non numeri
      expect(JSON.stringify(s.via, (_, v) => (v instanceof RegExp ? String(v) : v))).not.toMatch(/\d{2}\.\d{3,}/);
    }
  });

  it('i monumenti del Sellaronda: rifugi dei passi, cappelle, Coppi, la funivia del Sass Pordoi, Selva, Corvara, Arabba', () => {
    const refs = MONUMENTI_SPECS.sellaronda.map((m) => m.ref);
    expect(refs.length).toBeGreaterThanOrEqual(18);
    expect(new Set(refs).size).toBe(refs.length);
    const names = MONUMENTI_SPECS.sellaronda.map((m) => m.name ?? m.osm);
    for (const want of [/Valentini/, /Cappella del Passo Sella/, /Cappella del Passo Pordoi/, /Coppi/, /Sass Pordoi/, /Campanile di Selva/, /Corvara/, /Arabba/, /Bec de Roces/, /San Maurizio/]) expect(names.some((n) => want.test(n)), String(want)).toBe(true);
    for (const n of names) expect(n).toMatch(/^[A-ZÀ-Ý]/);
    const bergamoRefs = new Set(MONUMENTI_SPECS.bergamo.map((m) => m.ref));
    for (const r of refs) expect(bergamoRefs.has(r)).toBe(false);
  });
});
