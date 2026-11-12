import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAG, WorldGraph, type Leg, type WorldGraphFile } from '../src/open/graph';
import { COVER, decodeDemTile, decodeFar, decodeFeatures, type RideDef } from '../src/open/world';
import type { MonumentiFile } from '../src/open/monumenti';

/*
 * Pista S1: il mondo «Sellaronda» costruito in public/world/sellaronda/. I percorsi contro
 * BRouter (il giro: 63,7 km, D+ 2140) e le schede delle salite (climbfinder, cols-cyclisme);
 * il terreno sotto la strada; la copertura del suolo in montagna; il peso.
 */

const dir = join(__dirname, '..', 'public', 'world', 'sellaronda');
const file = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile;
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as Parameters<typeof decodeFeatures>[0]);
const monumenti = JSON.parse(readFileSync(join(dir, 'monumenti.json'), 'utf8')) as MonumentiFile;
const graph = new WorldGraph(file);
const legsOf = (r: RideDef): Leg[] => r.legs.map(([edge, dir]) => ({ edge, dir }));
const ride = (id: string) => {
  const r = rides.find((x) => x.id === id);
  if (!r) throw new Error(`manca il percorso ${id}`);
  return r;
};

/** Tutte le mattonelle del DEM, decodificate una volta. */
const tiles = new Map<string, ReturnType<typeof decodeDemTile>>();
const n = Math.round(file.tile / file.demStep);
for (const f of readdirSync(join(dir, 'dem'))) {
  const [tx, tz] = f.replace('.bin', '').split('_').map(Number);
  tiles.set(`${tx}_${tz}`, decodeDemTile(new Uint8Array(readFileSync(join(dir, 'dem', f))), n, tx, tz));
}
function cell(x: number, z: number): { h: number; cover: number } | null {
  const b = file.bounds;
  const tx = Math.floor((x - b.x0) / file.tile);
  const tz = Math.floor((z - b.z0) / file.tile);
  const t = tiles.get(`${tx}_${tz}`);
  if (!t) return null;
  // il passo della mattonella: 25 m, o 12,5 dove il rilievo LiDAR è fine (pista S3)
  const s = file.tile / t.n;
  const i = Math.min(t.n, Math.max(0, Math.round((x - b.x0 - tx * file.tile) / s)));
  const j = Math.min(t.n, Math.max(0, Math.round((z - b.z0 - tz * file.tile) / s)));
  const k = j * (t.n + 1) + i;
  return { h: t.h[k], cover: t.cover[k] };
}
function heightAt(x: number, z: number): number {
  const b = file.bounds;
  const tx = Math.floor((x - b.x0) / file.tile);
  const tz = Math.floor((z - b.z0) / file.tile);
  const t = tiles.get(`${tx}_${tz}`);
  if (!t) return NaN;
  const s = file.tile / t.n;
  const fx = Math.min(t.n - 0.0001, Math.max(0, (x - b.x0 - tx * file.tile) / s));
  const fz = Math.min(t.n - 0.0001, Math.max(0, (z - b.z0 - tz * file.tile) / s));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const side = t.n + 1;
  const k = j * side + i;
  return t.h[k] * (1 - u) * (1 - v) + t.h[k + 1] * u * (1 - v) + t.h[k + side] * (1 - u) * v + t.h[k + side + 1] * u * v;
}

describe('S1.3 · il mondo Sellaronda', () => {
  it('è il grafo del Sellaronda, con origine fra i quattro passi e il terreno lontano a 120 m', () => {
    expect(file.id).toBe('sellaronda');
    expect(file.name).toBe('Sellaronda');
    expect(file.origin.lat).toBeCloseTo(46.515, 3);
    expect(file.origin.lon).toBeCloseTo(11.815, 3);
    expect(file.far.step).toBe(120);
    expect(file.demStep).toBe(25);
    expect(file.edges.length).toBeGreaterThan(300);
    expect(file.attribution).toMatch(/OpenStreetMap/);
    const far = decodeFar(new Uint8Array(readFileSync(join(dir, 'far.bin'))), file.far.nx, file.far.nz);
    // la Marmolada all'orizzonte: la quota più alta del terreno lontano è quella di un tremila
    let max = 0;
    for (const v of far) if (v > max) max = v;
    expect(max).toBeGreaterThan(3100);
  });

  it('i quattro passi, le cime e i paesi ci sono, in italiano', () => {
    const passes = features.peaks.filter((p) => p.pass).map((p) => p.name);
    for (const p of ['Passo Sella', 'Passo Pordoi', 'Passo Gardena', 'Passo Campolongo', 'Passo Fedaia']) expect(passes, p).toContain(p);
    const peaks = features.peaks.filter((p) => !p.pass);
    for (const p of ['Sassolungo', 'Piz Boè', 'Punta Penia', 'Piz Ciavazes', 'Sassongher']) expect(peaks.some((q) => q.name === p), p).toBe(true);
    const marmolada = peaks.find((q) => q.name === 'Punta Penia')!;
    expect(marmolada.ele).toBe(3343);
    const places = features.places.map((p) => p.name);
    for (const p of ['Selva di Val Gardena', 'Corvara in Badia', 'Arabba', 'Canazei', 'Colfosco', 'Plan de Gralba']) expect(places, p).toContain(p);
    // niente nomi trilingui con i trattini
    for (const p of features.places) expect(p.name, p.name).not.toMatch(/ - /);
    for (const p of features.peaks) expect(p.name, p.name).not.toMatch(/ - /);
  });

  it('copertura del suolo: roccia, ghiacciaio, niente bosco sopra i 2100 m', () => {
    const count = new Map<number, number>();
    let forestHigh = 0;
    let forestCells = 0;
    for (const t of tiles.values()) {
      for (let k = 0; k < t.cover.length; k++) {
        count.set(t.cover[k], (count.get(t.cover[k]) ?? 0) + 1);
        if (t.cover[k] === COVER.forest) {
          forestCells++;
          if (t.h[k] > 2110) forestHigh++;
        }
      }
    }
    expect(count.get(COVER.rock) ?? 0).toBeGreaterThan(5000);
    // le piste da sci hanno il loro valore (COVER.piste, contratto S2): radure, non bosco
    expect(count.get(COVER.piste) ?? 0).toBeGreaterThan(500);
    expect(count.get(COVER.glacier) ?? 0).toBeGreaterThan(100);
    expect(forestCells).toBeGreaterThan(5000);
    expect(forestHigh).toBe(0);
    // il ghiacciaio della Marmolada sta sotto Punta Penia, sul versante nord
    const penia = features.peaks.find((q) => q.name === 'Punta Penia')!;
    let glacier = 0;
    for (let dz = -1500; dz <= 0; dz += 25) for (let dx = -600; dx <= 600; dx += 25) if (cell(penia.x + dx, penia.z + dz)?.cover === COVER.glacier) glacier++;
    expect(glacier).toBeGreaterThan(50);
    // la parete del Sass Pordoi è roccia
    const sass = features.peaks.find((q) => q.name === 'Sass Pordoi' || q.name === 'Sasso Pordoi')!;
    let rock = 0;
    let all = 0;
    for (let dz = 100; dz <= 600; dz += 25) for (let dx = -300; dx <= 300; dx += 25) {
      const c = cell(sass.x + dx, sass.z + dz);
      if (!c) continue;
      all++;
      if (c.cover === COVER.rock) rock++;
    }
    expect(rock / all).toBeGreaterThan(0.3);
  });

  it('impianti di risalita, piste da sci e funi arrivano nelle features', () => {
    expect(features.lifts.filter((l) => l.kind === 'pylon').length).toBeGreaterThan(200);
    expect(features.lifts.filter((l) => l.kind === 'station').length).toBeGreaterThan(40);
    expect(features.lifts.some((l) => l.name === 'Sass Pordoi')).toBe(true);
    expect(features.pistes.length).toBeGreaterThan(100);
    expect(features.cables.length).toBeGreaterThan(30);
    for (const p of features.pistes) expect(p.hw).toBeGreaterThan(3);
  });

  it('i monumenti del Sellaronda, in italiano, con l’impronta', () => {
    expect(monumenti.monumenti.length).toBeGreaterThanOrEqual(18);
    const byName = new Map(monumenti.monumenti.map((m) => [m.name, m]));
    for (const want of ['Rifugio Carlo Valentini', 'Cappella del Passo Sella', 'Cappella del Passo Pordoi', 'Monumento a Fausto Coppi', 'Campanile di Selva', 'Rifugio Bec de Roces', 'Cappella di San Maurizio']) expect(byName.has(want), want).toBe(true);
    for (const m of monumenti.monumenti) {
      expect(m.name).toMatch(/^[A-ZÀ-Ý]/);
      // una statua è un nodo OSM senza impronta: il modello la mette sul suo piedistallo
      if (m.kind !== 'statua') expect(m.rings.length, m.name).toBeGreaterThan(0);
      expect(m.h).toBeGreaterThan(2);
      expect(Number.isFinite(m.y)).toBe(true);
    }
    expect(byName.get('Campanile di Selva')!.h).toBeGreaterThan(30);
  });
});

describe('S1.4 · i percorsi del Sellaronda', () => {
  it('nove percorsi, con gli id del piano', () => {
    expect(rides.map((r) => r.id)).toEqual(['sellaronda', 'sellaronda-orario', 'sella-canazei', 'pordoi-arabba', 'pordoi-canazei', 'gardena-corvara', 'gardena-selva', 'campolongo-corvara', 'fedaia-canazei']);
  });

  it('il giro antiorario da Selva: 60–66 km (BRouter 63,7), D+ 1900–2300 (BRouter 2140), i quattro passi in ordine', () => {
    const r = ride('sellaronda');
    expect(r.lengthM / 1000).toBeGreaterThan(60);
    expect(r.lengthM / 1000).toBeLessThan(66);
    expect(r.gainM).toBeGreaterThan(1900);
    expect(r.gainM).toBeLessThan(2300);
    expect(r.maxAlt).toBeGreaterThan(2225);
    expect(r.maxAlt).toBeLessThan(2255);
    const lm = (id: string) => r.landmarks.find((l) => l.id === id)?.at;
    const order = [lm('passo-gardena'), lm('corvara'), lm('passo-campolongo'), lm('arabba'), lm('passo-pordoi'), lm('passo-sella'), lm('plan-de-gralba')];
    for (const at of order) expect(at).toBeDefined();
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
    // torna dove è partito
    const legs = legsOf(r);
    expect(graph.startNode(legs[0].edge, legs[0].dir)).toBe(graph.endNode(legs[legs.length - 1].edge, legs[legs.length - 1].dir));
  });

  it('il giro orario da Corvara: la stessa strada nell’altro verso', () => {
    const r = ride('sellaronda-orario');
    expect(Math.abs(r.lengthM - ride('sellaronda').lengthM)).toBeLessThan(1500);
    expect(r.gainM).toBeGreaterThan(1900);
    expect(r.gainM).toBeLessThan(2300);
  });

  const climbs: [string, number, number, number, number][] = [
    // id, km min, km max, media min, media max (climbfinder / cols-cyclisme)
    // partenza e arrivo sono i nodi OSM del paese e del passo: la scheda parte dal cartello del paese,
    // qui si parte dal centro, e i primi tre-quattrocento metri di fondovalle restano fuori
    ['pordoi-arabba', 8.8, 9.6, 0.065, 0.075],
    ['sella-canazei', 10.8, 12.5, 0.06, 0.075],
    ['gardena-corvara', 9.0, 10.0, 0.05, 0.068],
    ['campolongo-corvara', 5.5, 6.5, 0.045, 0.07],
    ['pordoi-canazei', 11.5, 13.0, 0.055, 0.072],
    ['gardena-selva', 9.5, 11.5, 0.045, 0.065],
    ['fedaia-canazei', 11.0, 14.5, 0.04, 0.062],
  ];
  for (const [id, kmMin, kmMax, gMin, gMax] of climbs) {
    it(`${id}: ${kmMin}–${kmMax} km, media fra ${(gMin * 100).toFixed(1)} e ${(gMax * 100).toFixed(1)}%`, () => {
      const r = ride(id);
      expect(r.kind).toBe('salita');
      expect(r.lengthM / 1000).toBeGreaterThan(kmMin);
      expect(r.lengthM / 1000).toBeLessThan(kmMax);
      const avg = (r.endAlt - r.startAlt) / r.lengthM;
      expect(avg).toBeGreaterThan(gMin);
      expect(avg).toBeLessThan(gMax);
      expect(r.maxGrade).toBeLessThan(0.16);
    });
  }

  it('i passi finiscono alla quota giusta (±20 m dal cartello)', () => {
    expect(Math.abs(ride('pordoi-arabba').endAlt - 2239)).toBeLessThan(20);
    expect(Math.abs(ride('sella-canazei').endAlt - 2240)).toBeLessThan(20);
    expect(Math.abs(ride('gardena-corvara').endAlt - 2121)).toBeLessThan(20);
    expect(Math.abs(ride('campolongo-corvara').endAlt - 1875)).toBeLessThan(20);
    expect(Math.abs(ride('fedaia-canazei').endAlt - 2057)).toBeLessThan(25);
  });

  for (const r of rides) {
    describe(r.id, () => {
      const legs = legsOf(r);
      it('è una strada sola, nel verso ammesso, con i numeri della strada', () => {
        for (let i = 0; i < legs.length; i++) {
          expect(graph.allowed(legs[i].edge, legs[i].dir), `tratto ${i} contromano`).toBe(true);
          if (i > 0) expect(graph.startNode(legs[i].edge, legs[i].dir), `buco al tratto ${i}`).toBe(graph.endNode(legs[i - 1].edge, legs[i - 1].dir));
        }
        expect(Math.abs(graph.legsLength(legs) - r.lengthM) / r.lengthM).toBeLessThan(0.02);
        expect(r.maxGrade).toBeLessThan(0.25);
      });

      it('almeno cinque luoghi, in ordine, con le note in italiano con la maiuscola', () => {
        expect(r.landmarks.length).toBeGreaterThanOrEqual(5);
        for (let i = 0; i < r.landmarks.length; i++) {
          const lm = features.landmarks.find((x) => x.id === r.landmarks[i].id)!;
          expect(lm, r.landmarks[i].id).toBeDefined();
          expect(lm.note).toMatch(/^[A-ZÀ-Ý]/);
          expect(lm.name).toMatch(/^[A-ZÀ-Ý]/);
          if (i > 0) expect(r.landmarks[i].at).toBeGreaterThanOrEqual(r.landmarks[i - 1].at);
        }
      });

      it('la strada sta sul terreno: entro 15 m dal DEM a 25 m nel 92% dei punti, mai oltre 40 fuori da ponti e gallerie', () => {
        // il livellamento (build-world.ts) tiene la strada dentro un tubo dal DEM; nel browser il
        // terreno si raccorda alla carreggiata (src/open/field.ts). Qui si prova il dato, non il raccordo.
        let off = 0;
        let far = 0;
        let total = 0;
        for (const l of legs) {
          const e = graph.edges[l.edge];
          if (e.flags & (FLAG.bridge | FLAG.tunnel)) continue;
          for (let s = 0; s < e.length; s += 25) {
            const p = graph.pose(l.edge, s, l.dir);
            const h = heightAt(p.x, p.z);
            if (!Number.isFinite(h)) continue;
            total++;
            const d = Math.abs(h - p.y);
            if (d > 15) off++;
            if (d > 40) far++;
          }
        }
        expect(total).toBeGreaterThan(100);
        expect(off / total).toBeLessThan(0.08);
        expect(far).toBe(0);
      });
    });
  }
});

describe('S1.8 · il peso', () => {
  it('public/world/sellaronda pesa al massimo 15 MB', () => {
    let bytes = 0;
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else bytes += statSync(p).size;
      }
    };
    walk(dir);
    expect(bytes / 1e6).toBeLessThan(15);
    expect(existsSync(join(dir, 'far.bin'))).toBe(true);
    expect(readdirSync(join(dir, 'b')).length).toBeGreaterThan(20);
  });
});
