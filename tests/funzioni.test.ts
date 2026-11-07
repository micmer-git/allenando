// La pista F del rilascio Sellaronda (07/11/2026): due mondi, scarico senza rete, passi e salite,
// traguardi e serie, segmenti per passo, cartolina, diario, meteo, formati, esportazioni.
import 'fake-indexeddb/auto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { WorldGraph, type WorldGraphFile } from '../src/open/graph';
import { WorldSession } from '../src/open/session';
import { decodeFeatures, type RideDef, type WorldData } from '../src/open/world';
import { projector } from '../src/domain/geo';
import type { Ride, RideSample } from '../src/domain/types';
import { formatAlt, formatAltText, formatGainText, formatTempText } from '../src/domain/format';
import { climbForMinutes, workoutRideLink } from '../src/domain/workouts';
import { DEFAULT_WORLD, fetchManifest, isWorldId, WORLD_CATALOG, worldFacts, worldFromParams, worldInfo, worldName, worldOfRide, type WorldManifest } from '../src/open/worlds';
import { formatBytes, storageState, worldUrls } from '../src/open/offline';
import { loopSense, nextPass, passesAlongPath, passText, rideClimbs, rideMarks, rideSense, SELLARONDA_PASSES, siblingRide } from '../src/game/passes';
import { derivePassGpm, rideProfile, worldSegments, type ProfilePoint } from '../src/game/segments';
import { ACHIEVEMENT_BY_ID, fourPasses } from '../src/game/achievements';
import { advanceSeries, SERIES, SERIES_BY_ID } from '../src/game/missions';
import { applyCareer, EMPTY_CAREER, normalize, seriesProgress, type RideFacts } from '../src/game/career';
import { availability, ITEM_BY_ID, STARTER_ITEMS } from '../src/game/kit';
import { sessionAt, sessionWorld } from '../src/game/sessions';
import { roomEntry, sessionHref } from '../src/pages/Sessions';
import { worldFilters } from '../src/pages/History';
import { PENDENZE_URL, SOURCES_LINE } from '../src/pages/World';
import { snowLine, weatherCacheKey } from '../src/open/weather';
import { encodeGpx, rideDescription } from '../src/io/gpx-export';
import { encodeActivityFit } from '../src/io/fit';
import { cardInputFromRide, cardPalette, CARD_MARGIN, CARD_W, layoutCard, type Measure } from '../src/io/share-image';
import { repeatHref } from '../src/open/lastRide';

const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as Parameters<typeof decodeFeatures>[0]);
const proj = projector(graph.origin);
const world: WorldData = { graph, rides, features, proj, toGeo: (x, z) => proj.toGeo(x, z) };
const rideDef = (id: string) => rides.find((r) => r.id === id)!;

function facts(over: Partial<RideFacts> = {}): RideFacts {
  return {
    distanceM: 30_000,
    gainM: 800,
    durationSec: 4000,
    sim: false,
    startedAt: new Date(2026, 10, 7, 10, 0),
    avgPower: 200,
    peak5s: 400,
    peak5min: 250,
    ftp: 250,
    segments: [],
    pois: [],
    landmarks: [],
    discovered: 0,
    rain: false,
    night: false,
    workoutDone: false,
    together: false,
    level: 1,
    ...over,
  };
}

function rideOn(rideId: string, sec = 1500, world_?: string): Ride {
  const session = new WorldSession(world, { ride: rideDef(rideId) }, 0);
  const len = session.path.length;
  const samples: RideSample[] = [];
  for (let t = 1; t <= sec; t++) {
    const d = (len * t) / sec;
    const p = session.path.poseAt(d);
    const g = proj.toGeo(p.x, p.z);
    samples.push({ t, power: 200, hr: 140, cadence: 88, speed: len / sec, distance: d, altitude: p.altitude, grade: p.grade, lat: g.lat, lon: g.lon });
  }
  const def = rideDef(rideId);
  return {
    id: `ride-${rideId}`,
    name: `${def.name} ${def.side}`,
    sport: 'cycling',
    source: 'indoor',
    startTime: new Date(2026, 10, 7, 9, 30).toISOString(),
    durationSec: sec,
    distanceM: len,
    elevationGainM: def.gainM,
    tssSource: 'power',
    powerZoneSec: [],
    hrZoneSec: [],
    withCamilla: false,
    ftp: 250,
    samples,
    routeId: `bergamo:${rideId}`,
    world: world_,
  };
}

const measure: Measure = (s, font, spacing) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 20);
  return s.length * size * 0.56 + spacing * s.length;
};

// ---------- F.13 formati ----------
describe('F.13 · le quote col separatore, D+, temperature', () => {
  it('«2.240 m» anche sotto le cinque cifre, dove Intl il punto non lo mette', () => {
    expect(formatAlt(2240)).toBe('2.240');
    expect(formatAlt(945)).toBe('945');
    expect(formatAltText(2240)).toBe('2.240 m');
    expect(formatAltText(12_345)).toBe('12.345 m');
    expect(formatAlt(Number.NaN)).toBe('–');
  });
  it('«D+ 2.140 m» e le temperature col meno tipografico', () => {
    expect(formatGainText(2140)).toBe('D+ 2.140 m');
    expect(formatGainText(-5)).toBe('D+ 0 m');
    expect(formatTempText(-3.4)).toBe('−3 °C');
    expect(formatTempText(12.6)).toBe('13 °C');
  });
});

// ---------- F.1 il catalogo dei mondi ----------
describe('F.1 · i due mondi e l’ultimo ricordato', () => {
  it('Bergamo e Sellaronda, con nome, centro e zone', () => {
    expect(WORLD_CATALOG.map((w) => w.id)).toEqual(['bergamo', 'sellaronda']);
    expect(DEFAULT_WORLD).toBe('bergamo');
    expect(worldName('sellaronda')).toBe('Sellaronda');
    expect(worldName('x')).toBe('Bergamo e le valli');
    expect(isWorldId('sellaronda')).toBe(true);
    expect(isWorldId('zwift')).toBe(false);
    expect(worldInfo('sellaronda').lat).toBeGreaterThan(46.4);
    expect(worldInfo('sellaronda').box[0]).toBeLessThan(worldInfo('sellaronda').lat);
    expect(Object.keys(worldInfo('bergamo').areas)).toEqual(['citta', 'seriana', 'brembana', 'valli']);
  });
  it('?world= vale solo se è un mondo nostro, sennò l’ultimo (Bergamo senza storia)', () => {
    expect(worldFromParams(new URLSearchParams('world=sellaronda'))).toBe('sellaronda');
    expect(worldFromParams(new URLSearchParams('world=marte'))).toBe('bergamo');
    expect(worldFromParams(new URLSearchParams(''))).toBe('bergamo');
  });
  it('il manifesto di Bergamo esiste, elenca file veri col loro peso, e dice km e percorsi', () => {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as WorldManifest;
    expect(m.id).toBe('bergamo');
    expect(m.rides).toBe(rides.length);
    expect(m.roadsKm).toBeGreaterThan(1000);
    expect(m.files.length).toBeGreaterThan(1000);
    for (const [path, bytes] of m.files.slice(0, 40)) {
      expect(existsSync(join(dir, path))).toBe(true);
      expect(statSync(join(dir, path)).size).toBe(bytes);
    }
    expect(m.files.some(([p]) => p === 'graph.json')).toBe(true);
    expect(m.files.some(([p]) => p === 'far.bin')).toBe(true);
    expect(m.bytes).toBe(m.files.reduce((s, f) => s + f[1], 0));
    expect(worldFacts(m)).toMatch(/^\d{1,2}\.\d{3} km di strade · 14 percorsi$/);
  });
  it('fetchManifest: un mondo non costruito dà null senza lanciare', async () => {
    const fetcher = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchManifest('sellaronda', fetcher)).toBeNull();
  });
});

// ---------- F.2 scarico senza rete ----------
describe('F.2 · scaricato, da scaricare, a metà', () => {
  const m = { files: [['graph.json', 1000], ['dem/0_0.bin', 500], ['b/0_0.json', 250]] as [string, number][], bytes: 1750 };
  it('gli indirizzi dei file stanno sotto la cartella del mondo', () => {
    const urls = worldUrls('sellaronda', m);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toMatch(/world\/sellaronda\/graph\.json$/);
  });
  it('lo stato conta i file in cache e i loro byte', () => {
    expect(storageState(new Set(), m)).toMatchObject({ downloaded: false, cached: 0, bytes: 0, totalBytes: 1750 });
    expect(storageState(new Set(['graph.json']), m)).toMatchObject({ downloaded: false, cached: 1, bytes: 1000 });
    expect(storageState(new Set(['graph.json', 'dem/0_0.bin', 'b/0_0.json']), m)).toMatchObject({ downloaded: true, cached: 3, bytes: 1750 });
    expect(storageState(new Set(), { files: [], bytes: 0 }).downloaded).toBe(false);
  });
  it('i byte come li legge una persona', () => {
    expect(formatBytes(19_600_000)).toBe('20 MB');
    expect(formatBytes(4_250_000)).toBe('4,3 MB');
    expect(formatBytes(640_000)).toBe('640 kB');
    expect(formatBytes(0)).toBe('0 kB');
  });
});

// ---------- F.3 / F.5 le salite e i passi di un giro ----------
describe('F.3 · le salite del giro, col passo in cima e il verso', () => {
  it('il giro della Ganda ha la salita al Passo di Ganda, col nome del passo', () => {
    const climbs = rideClimbs(world, rideDef('ganda'));
    expect(climbs.length).toBeGreaterThanOrEqual(1);
    const ganda = climbs.find((c) => c.passId === 'passo-di-ganda');
    expect(ganda).toBeDefined();
    expect(ganda!.name).toBe('Passo di Ganda');
    expect(ganda!.lengthM).toBeGreaterThan(8000);
    expect(ganda!.grade).toBeGreaterThan(0.05);
    expect(ganda!.topAlt).toBeGreaterThan(1000);
  });
  it('ogni salita del mondo con un passo in cima lo nomina: Zambla, San Marco, Presolana', () => {
    for (const [ride, pass] of [
      ['zambla-nossa', 'colle-di-zambla'],
      ['san-marco', 'passo-san-marco'],
      ['presolana', 'passo-della-presolana'],
    ]) {
      expect(rideClimbs(world, rideDef(ride)).some((c) => c.passId === pass), ride).toBe(true);
    }
  });
  it('il verso di un anello dalla pianta: un quadrato orario e uno antiorario, una linea aperta no', () => {
    // x a est, z a sud: est → sud → ovest → nord visto dall'alto è orario
    expect(loopSense([0, 1000, 1000, 0, 0], [0, 0, 1000, 1000, 0])).toBe('orario');
    expect(loopSense([0, 0, 1000, 1000, 0], [0, 1000, 1000, 0, 0])).toBe('antiorario');
    expect(loopSense([0, 1000, 2000], [0, 0, 0])).toBeNull();
  });
  it('i giri di Bergamo hanno un verso; i due giri non sono l’uno il gemello dell’altro', () => {
    expect(rideSense(graph, rideDef('ganda'))).not.toBeNull();
    expect(rideSense(graph, rideDef('due-valli'))).not.toBeNull();
    expect(siblingRide(graph, rides, rideDef('ganda'))).toBeNull();
    expect(siblingRide(graph, rides, rideDef('selvino'))).toBeNull();
  });
});

describe('F.4 · il prossimo passo nell’HUD, F.5 · i segni sul profilo', () => {
  const marks = rideMarks(features.landmarks, rideDef('ganda'));
  it('la Ganda segna il Passo di Ganda al km 19,3 e il Monte Misma come cima', () => {
    expect(marks.find((m) => m.id === 'passo-di-ganda')).toMatchObject({ kind: 'passo', alt: 1051 });
    expect(Math.round(marks.find((m) => m.id === 'passo-di-ganda')!.at / 100)).toBe(193);
    expect(marks.some((m) => m.kind === 'cima' && m.id === 'monte-misma')).toBe(true);
  });
  it('«Passo di Ganda fra 3,2 km · +210 m» a 3,2 km dal passo, e niente oltre i 5 km', () => {
    const at = marks.find((m) => m.id === 'passo-di-ganda')!.at;
    const np = nextPass(marks, at - 3200, 841);
    expect(np).toEqual({ name: 'Passo di Ganda', inM: 3200, upM: 210 });
    expect(passText(np!)).toBe('Passo di Ganda fra 3,2 km · +210 m');
    expect(nextPass(marks, at - 5600, 700)).toBeNull();
    expect(nextPass(marks, at + 10, 1051)).toBeNull();
    expect(passText({ name: 'Passo Sella', inM: 400, upM: 2 })).toBe('Passo Sella fra 400 m');
  });
  it('nel giro libero i passi si trovano lungo la strada viva', () => {
    const session = new WorldSession(world, { ride: rideDef('ganda') }, 0);
    const found = passesAlongPath(session.path, features.landmarks, 15_000, 22_000);
    expect(found.map((p) => p.id)).toContain('passo-di-ganda');
    expect(Math.abs(found.find((p) => p.id === 'passo-di-ganda')!.at - marks.find((m) => m.id === 'passo-di-ganda')!.at)).toBeLessThan(120);
    expect(passesAlongPath(session.path, features.landmarks, 0, 5000)).toEqual([]);
  });
});

// ---------- F.8 un GPM per ogni passo ----------
describe('F.8 · un GPM per ogni passo, non solo i due più grossi', () => {
  function profile(spec: [number, number][]): ProfilePoint[] {
    // tratti [lunghezza m, dislivello m] in fila, un punto ogni 25 m, in pianta lungo x
    const out: ProfilePoint[] = [];
    let d = 0;
    let alt = 500;
    out.push({ d, alt, x: 0, z: 0 });
    for (const [len, gain] of spec) {
      const n = Math.round(len / 25);
      for (let i = 1; i <= n; i++) {
        d += 25;
        out.push({ d, alt: alt + (gain * i) / n, x: d, z: 0 });
      }
      alt += gain;
    }
    return out;
  }
  it('tre salite che finiscono su tre passi: tre GPM, dopo quelli già presi', () => {
    const p = profile([
      [3000, 250],
      [2000, -200],
      [3000, 250],
      [2000, -200],
      [3000, 250],
      [1000, -50],
    ]);
    const passes = [
      { name: 'Passo Uno', x: 3000, z: 0 },
      { name: 'Passo Due', x: 8000, z: 0 },
      { name: 'Passo Tre', x: 13_000, z: 0 },
    ];
    const taken = [{ id: 'w:x:gpm1', kind: 'gpm' as const, name: 'Passo Uno', from: 0, to: 3000 }];
    const extra = derivePassGpm('w:x', p, passes, taken);
    expect(extra.map((s) => s.id)).toEqual(['w:x:gpm2', 'w:x:gpm3']);
    expect(extra.map((s) => s.name)).toEqual(['Passo Due', 'Passo Tre']);
    expect(extra[0].from).toBe(5000);
    expect(extra[0].to).toBe(8000);
  });
  it('senza un passo in cima niente GPM in più; un passo lontano dalla cima neppure', () => {
    const p = profile([
      [3000, 250],
      [3000, -250],
    ]);
    expect(derivePassGpm('w:x', p, [], [])).toEqual([]);
    expect(derivePassGpm('w:x', p, [{ name: 'Passo Lontano', x: 3000, z: 2000 }], [])).toEqual([]);
  });
  it('a Bergamo i tratti di prima restano con gli stessi id, e ogni percorso con un passo ha il suo GPM', () => {
    const segs = worldSegments(world);
    const ganda = segs.byRide.get('ganda')!;
    expect(ganda.find((s) => s.id === 'w:ganda:gpm1')?.name).toBe('Passo di Ganda');
    for (const id of ['presolana', 'zambla-nossa', 'san-marco', 'colle-gallo']) {
      const list = segs.byRide.get(id)!;
      expect(list.filter((s) => s.kind === 'gpm').length, id).toBeGreaterThanOrEqual(1);
      for (const s of list) expect(s.id).toMatch(/^w:[a-z0-9-]+:(gpm|volata|crono|cassonetto)\d$/);
    }
    // il giro delle due valli passa dal Colle di Zambla: il suo GPM c'è
    expect(segs.byRide.get('due-valli')!.some((s) => s.kind === 'gpm' && /Zambla/.test(s.name))).toBe(true);
  });
});

// ---------- F.6 traguardi, F.7 serie ----------
describe('F.6 · i traguardi del Sellaronda', () => {
  it('«I quattro passi» vuole Sella, Pordoi, Gardena e Campolongo nello stesso giro', () => {
    expect(fourPasses([...SELLARONDA_PASSES])).toBe(true);
    expect(fourPasses(['passo-sella', 'passo-pordoi', 'passo-gardena'])).toBe(false);
    const a = ACHIEVEMENT_BY_ID.get('quattro-passi')!;
    expect(a.check(normalize(EMPTY_CAREER), facts({ landmarks: [...SELLARONDA_PASSES, 'corvara'] }))).toBe(true);
    expect(a.check(normalize(EMPTY_CAREER), facts({ landmarks: ['passo-sella'] }))).toBe(false);
  });
  it('Sellaronda, Marmolada e Berghem MolaMia si prendono col percorso finito', () => {
    const c = normalize(EMPTY_CAREER);
    for (const [ach, ride] of [
      ['mondo-sellaronda', 'sellaronda-orario'],
      ['mondo-marmolada', 'fedaia-canazei'],
      ['mondo-berghem', 'berghem-molamia'],
    ]) {
      expect(ACHIEVEMENT_BY_ID.get(ach)!.check(c, facts())).toBe(false);
      const out = applyCareer(c, facts({ worldRideDone: ride }));
      expect(out.unlocked.map((u) => u.id), ach).toContain(ach);
    }
  });
  it('ogni traguardo nuovo ha il suo segno e una frase con la maiuscola', () => {
    for (const id of ['quattro-passi', 'mondo-sellaronda', 'mondo-marmolada', 'mondo-berghem']) {
      const a = ACHIEVEMENT_BY_ID.get(id)!;
      expect(a.glyph).toBeTruthy();
      expect(a.desc).toMatch(/^[A-ZÀ-Ý]/);
      expect(a.group).toBe('mondo');
    }
  });
});

describe('F.7 · la serie Sellaronda e la maglia Sella', () => {
  const s = SERIES_BY_ID.get('sellaronda')!;
  it('quattro tappe, nell’ordine; il passo vale anche in un giro qualunque', () => {
    expect(SERIES).toHaveLength(1);
    expect(s.steps.map((x) => x.id)).toEqual(['sella', 'pordoi', 'gardena', 'giro']);
    expect(advanceSeries(s, [], facts({ landmarks: ['passo-sella'] }))).toMatchObject({ done: ['sella'], completed: false });
    // il Pordoi prima del Sella non conta: le tappe si prendono in fila
    expect(advanceSeries(s, [], facts({ worldRideDone: 'pordoi-arabba' })).done).toEqual([]);
    expect(advanceSeries(s, ['sella'], facts({ worldRideDone: 'pordoi-arabba' })).done).toEqual(['sella', 'pordoi']);
  });
  it('il giro intero passa da tutti i passi: prende le tappe che mancano e chiude la serie', () => {
    const adv = advanceSeries(s, ['sella'], facts({ worldRideDone: 'sellaronda', landmarks: [...SELLARONDA_PASSES] }));
    expect(adv.done).toEqual(['sella', 'pordoi', 'gardena', 'giro']);
    expect(adv.completed).toBe(true);
  });
  it('la carriera dà l’oro delle tappe, e la maglia Sella alla fine; la maglia non si compra', () => {
    let c = normalize(EMPTY_CAREER);
    let out = applyCareer(c, facts({ landmarks: ['passo-sella'] }));
    expect(out.steps.map((x) => x.step.id)).toEqual(['sella']);
    expect(out.lines.some((l) => l.label === 'Sellaronda: Passo Sella' && l.oro === 60)).toBe(true);
    expect(seriesProgress(out.next, 'sellaronda')).toEqual({ done: 1, total: 4, finished: false });
    c = out.next;
    out = applyCareer(c, facts({ worldRideDone: 'sellaronda-orario', landmarks: [...SELLARONDA_PASSES] }));
    expect(out.items).toContain('m-sella');
    expect(out.next.owned).toContain('m-sella');
    expect(out.lines.some((l) => l.label === 'Serie Sellaronda finita' && l.oro === 300)).toBe(true);
    expect(seriesProgress(out.next, 'sellaronda').finished).toBe(true);
    const item = ITEM_BY_ID.get('m-sella')!;
    expect(item.series).toBe('sellaronda');
    expect(STARTER_ITEMS).not.toContain('m-sella');
    expect(availability(item, new Set(), 10_000, 30)).toEqual({ state: 'series', series: 'sellaronda' });
  });
  it('una carriera vecchia senza `series` si normalizza', () => {
    const old = { ...EMPTY_CAREER } as Partial<typeof EMPTY_CAREER>;
    delete (old as { series?: unknown }).series;
    expect(normalize(old).series).toEqual({});
  });
});

// ---------- F.9 cartolina ----------
describe('F.9 · la cartolina dice il mondo e il punto più alto', () => {
  it('la Ganda: «Bergamo e le valli» nella riga sopra, il Passo di Ganda come punto più alto, dentro il riquadro', () => {
    const input = cardInputFromRide(rideOn('ganda'), world);
    expect(input.worldId).toBe('bergamo');
    expect(input.eyebrow).toMatch(/Bergamo e le valli$/);
    expect(input.top?.name).toBe('Passo di Ganda');
    expect(Math.round(input.top!.alt)).toBeGreaterThan(1000);
    const layout = layoutCard(input, measure);
    const top = layout.texts.find((t) => t.id === 'top')!;
    expect(top.text).toMatch(/^Passo di Ganda · 1\.0\d\d m$/);
    expect(top.box.x0).toBeGreaterThanOrEqual(CARD_MARGIN);
    expect(top.box.x1).toBeLessThanOrEqual(CARD_W - CARD_MARGIN);
    const mons = layout.texts.find((t) => t.id === 'monuments');
    if (mons) expect(top.box.y1).toBeLessThanOrEqual(mons.box.y0);
  });
  it('lo sfondo cambia col mondo: Bergamo notte calda, Sellaronda notte fredda', () => {
    expect(cardPalette('bergamo').night).not.toBe(cardPalette('sellaronda').night);
    expect(cardPalette(null)).toEqual(cardPalette('bergamo'));
    const [r, , b] = cardPalette('sellaronda').rgb;
    expect(b).toBeGreaterThan(r);
  });
});

// ---------- F.10 diario ----------
describe('F.10 · il mondo di un giro e il filtro del diario', () => {
  it('dal campo, dal routeId o dal GPS', () => {
    expect(worldOfRide({ world: 'sellaronda' })).toBe('sellaronda');
    expect(worldOfRide({ routeId: 'bergamo:ganda' })).toBe('bergamo');
    expect(worldOfRide({ routeId: 'selvino-nembro' })).toBeNull();
    expect(worldOfRide({ samples: [{ lat: 46.51, lon: 11.76 }] })).toBe('sellaronda');
    expect(worldOfRide({ samples: [{ lat: 45.7, lon: 9.67 }] })).toBe('bergamo');
    expect(worldOfRide({ samples: [{ lat: 46.52, lon: 10.45 }] })).toBeNull();
    expect(worldOfRide({ samples: [{}] })).toBeNull();
    expect(worldOfRide(rideOn('selvino'))).toBe('bergamo');
  });
  it('il filtro compare solo con almeno due mondi diversi, «Altro» per i giri fuori', () => {
    expect(worldFilters(['bergamo', 'bergamo'])).toEqual([]);
    expect(worldFilters(['bergamo', null]).map((f) => f.value)).toEqual(['tutti', 'bergamo', 'altro']);
    expect(worldFilters(['bergamo', 'sellaronda']).map((f) => f.label)).toEqual(['Tutti', 'Bergamo', 'Sellaronda']);
    expect(worldFilters([null])).toEqual([]);
  });
});

// ---------- F.11 ripeti ----------
describe('F.11 · ripeti l’ultimo giro', () => {
  it('lo stesso link, senza ripresa, stanza e sessione', () => {
    expect(repeatHref({ search: 'world=bergamo&ride=ganda&resume=1&room=abc&session=ev-1' })).toBe('/ride?world=bergamo&ride=ganda');
    expect(repeatHref({ search: 'route=selvino-nembro' })).toBe('/ride?route=selvino-nembro');
  });
});

// ---------- F.12 meteo ----------
describe('F.12 · il meteo per mondo e la neve di oggi', () => {
  it('una cache per punto: il Sella non legge il meteo di Bergamo', () => {
    expect(weatherCacheKey(45.8675, 9.8)).not.toBe(weatherCacheKey(46.51, 11.81));
    expect(weatherCacheKey(45.8675, 9.8)).toBe(weatherCacheKey(45.869, 9.801));
  });
  it('la linea della neve scende con la temperatura; se nevica è già qui', () => {
    const base = 1500;
    expect(snowLine({ tempC: 14, code: 0 }, base)).toBe(3500);
    expect(snowLine({ tempC: 1, code: 0 }, base)).toBe(1500);
    expect(snowLine({ tempC: 8, code: 71 }, base)).toBe(1500);
    expect(snowLine({ tempC: -6, code: 0 }, base)).toBe(400);
    expect(snowLine(null, base)).toBeNull();
  });
});

// ---------- F.14 fonti ----------
describe('F.14 · la riga delle fonti', () => {
  it('OSM, EU-DEM, climbfinder, e il confronto delle pendenze della pista M', () => {
    expect(SOURCES_LINE).toBe('Strade OSM · Quote EU-DEM · Confronto climbfinder');
    expect(PENDENZE_URL).toMatch(/docs\/pendenze-2026-11\.md$/);
  });
});

// ---------- F.15 allenamento del giorno ----------
describe('F.15 · una salita lunga quanto l’allenamento, dal mondo attivo', () => {
  it('30 minuti → una salita corta; 90 → una lunga; 5 → niente', () => {
    const short = climbForMinutes(rides, 30);
    const long = climbForMinutes(rides, 90);
    expect(short).not.toBeNull();
    expect(long).not.toBeNull();
    expect(rideDef(short!).lengthM).toBeLessThan(rideDef(long!).lengthM);
    expect(rideDef(short!).kind).toBe('salita');
    expect(climbForMinutes(rides, 5)).toBeNull();
    expect(climbForMinutes([], 30)).toBeNull();
  });
  it('il link della pedalata porta il mondo del percorso', () => {
    expect(workoutRideLink('w1', { kind: 'percorso', ride: 'pordoi-arabba', world: 'sellaronda' })).toBe('/ride?workout=w1&world=sellaronda&ride=pordoi-arabba');
    expect(workoutRideLink('w1', { kind: 'percorso', ride: 'selvino' })).toBe('/ride?workout=w1&world=bergamo&ride=selvino');
  });
});

// ---------- F.16 sessioni ----------
describe('F.16 · il mondo della sessione è esplicito', () => {
  it('ogni sessione ha il mondo, e il link lo porta', () => {
    for (let slot = 996_000; slot < 996_016; slot++) {
      const s = sessionAt(slot);
      expect(isWorldId(s.world)).toBe(true);
      expect(sessionHref(s)).toBe(`/ride?world=${s.world}&ride=${s.rideId}&session=${s.id}`);
    }
    expect(sessionWorld('citta-alta')).toBe('bergamo');
  });
  it('senza rete si entra solo in un mondo scaricato', () => {
    expect(roomEntry(true, null).ok).toBe(true);
    expect(roomEntry(false, true).ok).toBe(true);
    expect(roomEntry(false, false)).toEqual({ ok: false, why: 'Senza rete: scarica il mondo da Mondo' });
    expect(roomEntry(false, null).why).toMatch(/^Senza rete/);
  });
});

// ---------- F.17 esportazioni ----------
describe('F.17 · FIT e GPX col nome del percorso e del mondo', () => {
  it('la descrizione: «nome · mondo», vuota fuori dal mondo', () => {
    expect(rideDescription({ name: 'Il giro della Ganda Nembro, Gazzaniga, Orezzo, Selvino', world: 'bergamo' })).toBe('Il giro della Ganda Nembro, Gazzaniga, Orezzo, Selvino · Bergamo e le valli');
    expect(rideDescription({ name: 'Pordoi', world: 'sellaronda' })).toBe('Pordoi · Sellaronda');
    expect(rideDescription({ name: 'Ganda', routeId: 'bergamo:ganda' })).toBe('Ganda · Bergamo e le valli');
    expect(rideDescription({ name: 'Selvino da Nembro', routeId: 'selvino-nembro' })).toBe('');
  });
  it('il GPX ha <desc> nel metadata e nella traccia; il FIT un messaggio WORKOUT col nome', () => {
    const ride = rideOn('maresana', 300, 'bergamo');
    const gpx = encodeGpx(ride)!;
    expect(gpx).toContain('<desc>Maresana da Ponteranica · Bergamo e le valli</desc>');
    expect(gpx.split('<desc>').length - 1).toBe(2);
    const fit = encodeActivityFit(ride);
    const { messages, errors } = new Decoder(Stream.fromByteArray(Array.from(fit))).read();
    expect(errors).toEqual([]);
    const wk = (messages as { workoutMesgs?: { wktName?: string }[] }).workoutMesgs?.[0];
    expect(wk?.wktName).toBe('Maresana da Ponteranica · Bergamo e le valli');
    expect((messages as { sessionMesgs: { subSport?: string }[] }).sessionMesgs[0].subSport).toBe('virtualActivity');
  });
  it('un giro fuori dal mondo non inventa niente', () => {
    const ride = { ...rideOn('maresana', 60), routeId: undefined, world: undefined, samples: rideOn('maresana', 60).samples.map((s) => ({ ...s, lat: 44.1, lon: 8.2 })) };
    const fit = encodeActivityFit(ride);
    const { messages } = new Decoder(Stream.fromByteArray(Array.from(fit))).read();
    expect((messages as { workoutMesgs?: unknown[] }).workoutMesgs ?? []).toEqual([]);
  });
});

// ---------- il profilo del percorso resta coerente (F.3 usa findClimbs sul profilo del grafo) ----------
describe('il profilo del grafo per le salite', () => {
  it('la Ganda ha un punto ogni 25 m e sale fino al passo', () => {
    const prof = rideProfile(
      graph,
      rideDef('ganda').legs.map(([edge, dir]) => ({ edge, dir })),
    );
    expect(prof.length).toBeGreaterThan(1000);
    expect(Math.max(...prof.map((p) => p.alt))).toBeGreaterThan(1040);
  });
});
