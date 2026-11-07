import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { groundLook, LARCH_PALETTE, larchSeason, LOOKS, lookContext, lookFor, seasonOf, snowLine, treeDensity, treeSpecies } from '../src/open/look';
import { buildLifts, liftKind, PYLON_GAP } from '../src/open/impianti';
import { LABEL_FULL, LABEL_GONE, labelFade, occluded, occlusionSamples } from '../src/open/labels';
import { atmosphere, CLEAR } from '../src/open/sky';
import { COVER } from '../src/open/world';
import { monumentoGeometry, TRI_CAP } from '../src/world/monumenti/archetipi';
import type { Monumento } from '../src/open/monumenti';

/*
 * Pista S2 (il paesaggio delle Dolomiti): la linea di neve per la data, la copertura per
 * pendenza, il colore per quota, gli alberi e la linea del bosco, i nomi delle cime fino a 8 km,
 * il cielo d'alta quota, gli impianti di risalita, gli archetipi dei passi.
 */

const sella = LOOKS.sellaronda;
const bergamo = LOOKS.bergamo;
const estate = seasonOf(new Date('2026-07-15T12:00:00Z'), sella);
const c = new THREE.Color();
const lum = (col: THREE.Color) => 0.299 * col.r + 0.587 * col.g + 0.114 * col.b;
const ny = (deg: number) => Math.cos((deg * Math.PI) / 180);

describe('la linea di neve per la data', () => {
  it('giugno 2600, agosto 2900, ottobre 2500, inverno 1500', () => {
    expect(snowLine(new Date('2026-06-01'), sella)).toBeCloseTo(2600, 0);
    expect(snowLine(new Date('2026-08-01'), sella)).toBeCloseTo(2900, 0);
    expect(snowLine(new Date('2026-10-01'), sella)).toBeCloseTo(2500, 0);
    expect(snowLine(new Date('2026-01-20'), sella)).toBe(1500);
    expect(snowLine(new Date('2026-02-10'), sella)).toBeLessThan(1600);
  });

  it('fra un mese e l’altro si interpola per giorno, senza salti', () => {
    const a = snowLine(new Date('2026-05-31'), sella);
    const b = snowLine(new Date('2026-06-01'), sella);
    expect(Math.abs(a - b)).toBeLessThan(20);
  });

  it('la neve sta sopra la linea, più bassa a nord, e non sulle pareti verticali', () => {
    // luglio: linea 2800. A 2700 m un pendio dolce a sud non è bianco, uno a nord sì
    const south = groundLook(c, sella, estate, 2700, 0.95, 0.3, 0.5, COVER.open).snow;
    const north = groundLook(c, sella, estate, 2700, 0.95, -0.3, 0.5, COVER.open).snow;
    expect(north).toBeGreaterThan(south);
    expect(north).toBeGreaterThan(0.5);
    // a 3100 m tutto bianco, ma una parete a 70° trattiene poca neve
    const flat = groundLook(c, sella, estate, 3100, 0.98, 0, 0.5, COVER.open).snow;
    const wall = groundLook(c, sella, estate, 3100, ny(70), 0, 0.5, COVER.open).snow;
    expect(flat).toBeGreaterThan(0.9);
    expect(wall).toBeLessThan(flat * 0.5);
  });

  it('il ghiacciaio è bianco-azzurro anche in agosto a 2700 m', () => {
    const g = groundLook(c, sella, seasonOf(new Date('2026-08-15'), sella), 2700, 0.9, 0.2, 0.5, COVER.glacier);
    expect(g.snow).toBe(1);
    expect(lum(c)).toBeGreaterThan(0.85);
    expect(c.b).toBeGreaterThanOrEqual(c.r);
  });
});

describe('la copertura per pendenza e il colore per quota', () => {
  it('sopra 38° è parete di roccia, sotto 29° no, in mezzo una transizione continua', () => {
    expect(groundLook(c, sella, estate, 1800, ny(45), 0, 0.5, COVER.open).rock).toBeGreaterThan(0.95);
    expect(groundLook(c, sella, estate, 1800, ny(20), 0, 0.5, COVER.open).rock).toBe(0);
    let prev = 0;
    for (let deg = 25; deg <= 45; deg += 2) {
      const r = groundLook(c, sella, estate, 1800, ny(deg), 0, 0.5, COVER.open).rock;
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(r - prev).toBeLessThan(0.35);
      prev = r;
    }
  });

  it('la dolomia è chiara (0,78/0,76/0,72 al sole), il calcare delle Orobie più scuro', () => {
    groundLook(c, sella, estate, 2500, ny(60), 0, 0.3, COVER.open);
    // i colori di three.js sono lineari: si legge in sRGB, come li vede l'occhio
    const srgb = new THREE.Color().copyLinearToSRGB(c);
    expect(srgb.r).toBeGreaterThan(0.66);
    expect(srgb.g).toBeGreaterThan(0.64);
    expect(srgb.b).toBeGreaterThan(0.58);
    expect(srgb.r).toBeGreaterThan(srgb.b);
    const dolomia = lum(c);
    groundLook(c, bergamo, seasonOf(new Date('2026-07-15'), bergamo), 2500, ny(60), 0, 0.3, COVER.open);
    expect(lum(c)).toBeLessThan(dolomia);
  });

  it('prato alpino fino a 2200 m, poi ghiaia; il ghiaione ai piedi delle pareti', () => {
    groundLook(c, sella, estate, 2000, 0.98, 0, 0.5, COVER.open);
    expect(c.g).toBeGreaterThan(c.r);
    expect(c.g).toBeGreaterThan(c.b);
    groundLook(c, sella, estate, 2500, 0.98, 0, 0.5, COVER.open);
    const gravel = c.clone();
    expect(Math.abs(gravel.r - gravel.g)).toBeLessThan(0.08);
    // il ghiaione (28°) è più chiaro della ghiaia piana
    groundLook(c, sella, estate, 2500, ny(28), 0, 0.5, COVER.open);
    expect(lum(c)).toBeGreaterThan(lum(gravel) - 0.02);
  });

  it('in autunno il prato alpino è ocra, d’estate verde', () => {
    const autunno = seasonOf(new Date('2026-10-20'), sella);
    groundLook(c, sella, autunno, 2000, 0.98, 0, 0.5, COVER.open);
    const ocra = c.clone();
    groundLook(c, sella, estate, 2000, 0.98, 0, 0.5, COVER.open);
    expect(ocra.r).toBeGreaterThan(c.r);
    expect(ocra.g - ocra.b).toBeLessThan(c.g - c.b + 0.05);
  });

  it('la pista da sci è una radura chiara, e la roccia dei dati è ghiaia', () => {
    groundLook(c, sella, estate, 1700, 0.98, 0, 0.5, COVER.piste);
    const piste = lum(c);
    groundLook(c, sella, estate, 1700, 0.98, 0, 0.5, COVER.forest);
    expect(piste).toBeGreaterThan(lum(c));
    groundLook(c, sella, estate, 1700, 0.98, 0, 0.5, COVER.rock);
    expect(Math.abs(c.r - c.g)).toBeLessThan(0.08);
  });
});

describe('gli alberi e la linea del bosco', () => {
  it('nessun albero sopra 2150 m, il larice fra 1750 e 2150, l’abete sotto', () => {
    for (let r = 0; r < 1; r += 0.05) {
      const k = treeSpecies(sella, 2200, r);
      expect(k === null || k === 'rock').toBe(true);
    }
    const alti = new Set(Array.from({ length: 20 }, (_, i) => treeSpecies(sella, 1900, i / 20)));
    expect(alti.has('larch')).toBe(true);
    expect(alti.has('broadleaf')).toBe(false);
    const bassi = Array.from({ length: 20 }, (_, i) => treeSpecies(sella, 1300, i / 20));
    expect(bassi.filter((k) => k === 'spruce').length).toBeGreaterThan(14);
    expect(treeDensity(sella, 1600)).toBe(1);
    expect(treeDensity(sella, 2000)).toBeLessThan(0.8);
    expect(treeDensity(sella, 2000)).toBeGreaterThan(0.5);
    expect(treeDensity(sella, 2150)).toBe(0);
    // vale anche per Bergamo: niente alberi a 2250 come prima
    expect(treeDensity(bergamo, 2250)).toBe(0);
  });

  it('il larice è d’oro in ottobre e novembre, verde chiaro in primavera, spoglio d’inverno', () => {
    expect(larchSeason(new Date('2026-10-20'))).toBe('oro');
    expect(larchSeason(new Date('2026-11-07'))).toBe('oro');
    expect(larchSeason(new Date('2026-04-20'))).toBe('chiaro');
    expect(larchSeason(new Date('2026-01-20'))).toBe('spoglio');
    expect(larchSeason(new Date('2026-07-20'))).toBe('verde');
    const oro = new THREE.Color(LARCH_PALETTE.oro[0]);
    expect(oro.r).toBeGreaterThan(oro.g);
    expect(oro.g).toBeGreaterThan(oro.b * 2);
  });

  it('un id sconosciuto ha l’aspetto di Bergamo; il contesto porta la stagione', () => {
    expect(lookFor('marte')).toBe(bergamo);
    const ctx = lookContext('sellaronda', new Date('2026-11-07'));
    expect(ctx.look.case).toBe('ladino');
    expect(ctx.season.larch).toBe('oro');
    expect(ctx.season.snowLine).toBeLessThan(2000);
  });
});

describe('i nomi delle cime', () => {
  it('con la portata di 8 km un nome è pieno a 4 km e sfuma fino a 8; gli altri come prima', () => {
    expect(labelFade(4000, 8000)).toBe(1);
    expect(labelFade(6400, 8000)).toBeCloseTo(0.5, 5);
    expect(labelFade(8000, 8000)).toBe(0);
    expect(labelFade(LABEL_FULL)).toBe(1);
    expect(labelFade(LABEL_GONE)).toBe(0);
    expect(sella.peakRange).toBe(8000);
  });

  it('a 8 km la linea di vista si campiona ogni 60 m: una cresta in mezzo la spegne', () => {
    expect(occlusionSamples(8000)).toBeGreaterThanOrEqual(130);
    expect(occlusionSamples(500)).toBe(24);
    // una cresta larga 100 m a metà strada, alta più della linea di vista
    const ridge = (x: number) => (Math.abs(x - 4000) < 50 ? 2600 : 1500);
    expect(occluded(ridge, 0, 1600, 0, 8000, 2300, 0)).toBe(true);
    expect(occluded(() => 1500, 0, 1600, 0, 8000, 2300, 0)).toBe(false);
  });
});

describe('il cielo d’alta quota', () => {
  it('a 2200 m lo zenit è più scuro e saturo che a 300, e la foschia comincia più lontano', () => {
    const sun = { azimuth: Math.PI, elevation: (45 * Math.PI) / 180 };
    const valle = atmosphere(sun, CLEAR, 300);
    const passo = atmosphere(sun, CLEAR, 2200);
    expect(lum(passo.zenith)).toBeLessThan(lum(valle.zenith));
    const sat = (col: THREE.Color) => {
      const h = { h: 0, s: 0, l: 0 };
      col.getHSL(h);
      return h.s;
    };
    expect(sat(passo.zenith)).toBeGreaterThan(sat(valle.zenith));
    expect(passo.fogNear).toBeGreaterThan(valle.fogNear);
    expect(passo.fogFar).toBeGreaterThanOrEqual(valle.fogFar);
    // senza quota: come prima
    expect(atmosphere(sun, CLEAR).zenith.getHex()).toBe(valle.zenith.getHex());
  });
});

describe('gli impianti di risalita', () => {
  const line = (kind: string, pts: number[]) => ({ kind, pts: new Float32Array(pts) });
  it('cabinovia, seggiovia e skilift si disegnano; le teleferiche merci no', () => {
    expect(liftKind('gondola')).toBe('cabinovia');
    expect(liftKind('cable_car')).toBe('cabinovia');
    expect(liftKind('chair_lift')).toBe('seggiovia');
    expect(liftKind('platter')).toBe('skilift');
    expect(liftKind('t-bar')).toBe('skilift');
    expect(liftKind('goods')).toBeNull();
    expect(liftKind('zip_line')).toBeNull();
  });

  it('piloni ai vertici e uno in più ogni 160 m, stazioni ai capi, cabine ferme ogni 150 m, il cavo con la freccia', () => {
    // una cabinovia da 0 a 900 m, con un vertice a metà, che sale di 300 m
    const l = line('gondola', [0, 0, 1500, 0, 450, 1650, 0, 900, 1800]);
    const b = buildLifts([l], () => true, (_x, z) => 1500 + z / 3);
    expect(b.lines).toBe(1);
    expect(b.stations).toHaveLength(2);
    expect(b.stations[1].top).toBe(true);
    expect(b.stations[0].top).toBe(false);
    // 450 m per campata → 2 piloni aggiunti per campata, più quello del vertice di mezzo
    const added = Math.ceil(450 / PYLON_GAP) - 1;
    expect(b.pylons).toHaveLength(added * 2 + 1);
    for (const p of b.pylons) expect(p.height).toBe(13);
    expect(b.cabins.length).toBe(Math.floor((900 - 75) / 150) + 1);
    for (const cb of b.cabins) expect(cb.y).toBeLessThan(1500 + cb.z / 3 + 13);
    // il cavo: due funi, ogni tratto sta sotto la corda fra i sostegni e sopra il terreno
    expect(b.cable.length % 6).toBe(0);
    for (let i = 0; i < b.cable.length; i += 3) expect(b.cable[i + 1]).toBeGreaterThan(1500 + b.cable[i + 2] / 3 + 2);
  });

  it('fuori dal rettangolo non si costruisce niente', () => {
    const l = line('chair_lift', [5000, 5000, 1500, 5000, 5300, 1600]);
    expect(buildLifts([l], (x) => x < 1000, () => 1500).lines).toBe(0);
    const b = buildLifts([l], () => true, () => 1500);
    expect(b.cabins).toHaveLength(0);
    expect(b.pylons.length).toBeGreaterThan(0);
  });
});

describe('gli archetipi dei passi', () => {
  const mon = (kind: Monumento['kind'], w: number, d: number, h: number): Monumento => {
    const ring: [number, number][] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ];
    return { id: 'w1', name: kind, kind, x: 0, z: 0, y: 2200, yMin: 2198.5, yaw: 0, w, d, h, rings: [ring], p: {}, reach: 30 };
  };
  it('chiesetta, rifugio e ossario stanno sotto il tetto di triangoli e sono alti quanto dicono', () => {
    for (const [kind, w, d, h] of [
      ['chiesetta', 6, 10, 7],
      ['rifugio', 14, 10, 11],
      ['ossario', 12, 12, 11],
    ] as const) {
      for (const det of ['alta', 'bassa'] as const) {
        const g = monumentoGeometry(mon(kind, w, d, h), det);
        const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
        expect(tris, `${kind} (${det})`).toBeGreaterThan(10);
        expect(tris, `${kind} (${det})`).toBeLessThanOrEqual(TRI_CAP[det]);
        g.computeBoundingBox();
        const top = g.boundingBox!.max.y;
        expect(top, `${kind} ${det}: cima`).toBeGreaterThan(h * 0.95);
        expect(top, `${kind} ${det}: cima`).toBeLessThan(h + 4);
      }
    }
  });
});
