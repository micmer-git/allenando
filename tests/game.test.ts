import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldGraph, type Leg, type WorldGraphFile } from '../src/open/graph';
import { WorldPath } from '../src/open/path';
import { decodeFeatures, type RideDef } from '../src/open/world';
import { createRouteTrack } from '../src/domain/track';
import { ITEMS, ITEM_BY_ID, availability, lookOf, STARTER_ITEMS } from '../src/game/kit';
import { applyCareer, buy, equip, EMPTY_CAREER, normalize, type RideFacts } from '../src/game/career';
import { ACHIEVEMENTS } from '../src/game/achievements';
import { missionsFor } from '../src/game/missions';
import { phaseOf, sessionAt, sessionById, slotOf, SLOT_MS, upcoming } from '../src/game/sessions';
import { PacerPack } from '../src/game/pacers';
import { climbSegments, deriveSegments, findClimbs, SegmentTracker, windowsOnPath, worldSegments, type ProfilePoint } from '../src/game/segments';
import { archSpecs } from '../src/game/arches';

const facts = (over: Partial<RideFacts> = {}): RideFacts => ({
  distanceM: 12_000,
  gainM: 180,
  durationSec: 1800,
  sim: true,
  startedAt: new Date(2026, 10, 3, 18, 0),
  avgPower: 180,
  peak5s: 400,
  peak5min: 230,
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
});

describe('guardaroba', () => {
  it('ogni pezzo ha un id unico e i traguardi citati esistono', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    const ach = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const i of ITEMS) if (i.achievement) expect(ach.has(i.achievement), i.id).toBe(true);
  });

  it('l’aspetto di partenza è la maglia gialla', () => {
    expect(lookOf({}).jersey).toBe('#ffc814');
    expect(lookOf({ maglia: 'm-pois' }).pattern).toBe('pois');
    expect(lookOf({ ruote: 'r-lenticolare' }).rim).toBe('lenticolare');
  });

  it('si compra con l’oro, dopo il livello; i pezzi dei traguardi non si comprano', () => {
    const c = { ...normalize(EMPTY_CAREER), oro: 700 };
    expect(buy(c, 'm-pois', 3).ok).toBe(false); // livello 4
    const r = buy(c, 'm-pois', 4);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next.oro).toBe(100);
      expect(equip(r.next, 'm-pois').equipped.maglia).toBe('m-pois');
    }
    expect(buy(c, 'm-azzurra', 50).ok).toBe(false);
    expect(availability(ITEM_BY_ID.get('m-notte')!, new Set(), 100, 1)).toEqual({ state: 'poor', price: 180, missing: 80 });
    expect(STARTER_ITEMS).toContain('m-orobia');
    // non si indossa quello che non si ha
    expect(equip(c, 'm-leggenda').equipped.maglia).toBe('m-orobia');
  });
});

describe('carriera', () => {
  it('un giro dà oro, conta i km e prende il primo traguardo', () => {
    const out = applyCareer(EMPTY_CAREER, facts(), new Date(2026, 10, 3, 18, 30));
    expect(out.total).toBeGreaterThan(0);
    expect(out.next.oro).toBe(out.total);
    expect(out.next.counts.rides).toBe(1);
    expect(out.unlocked.map((a) => a.id)).toContain('primo-giro');
  });

  it('un tratto più veloce è record personale, uno più lento no', () => {
    const seg = { id: 'w:x:volata1', kind: 'volata' as const, name: 'Prova', sec: 30, wkg: 6, lengthM: 300, gainM: 0 };
    const a = applyCareer(EMPTY_CAREER, facts({ segments: [seg] }), new Date(2026, 10, 3, 9));
    expect(a.pbs).toEqual([]);
    const b = applyCareer(a.next, facts({ segments: [{ ...seg, sec: 28 }] }), new Date(2026, 10, 3, 10));
    expect(b.pbs).toEqual(['w:x:volata1']);
    expect(b.next.pbs['w:x:volata1'].sec).toBe(28);
    const c = applyCareer(b.next, facts({ segments: [{ ...seg, sec: 35 }] }), new Date(2026, 10, 3, 11));
    expect(c.pbs).toEqual([]);
    expect(c.next.pbs['w:x:volata1'].count).toBe(3);
  });

  it('cinque volate sbloccano la maglia ciclamino', () => {
    let c = normalize(EMPTY_CAREER);
    for (let i = 0; i < 5; i++) {
      c = applyCareer(c, facts({ segments: [{ id: `v${i}`, kind: 'volata', name: 'v', sec: 30, wkg: 5, lengthM: 300, gainM: 0 }] }), new Date(2026, 10, 3, 9 + i)).next;
    }
    expect(c.achievements['volata-5']).toBeTruthy();
    expect(c.owned).toContain('m-ciclamino');
  });

  it('la serie di giorni cresce solo con giorni consecutivi', () => {
    let c = normalize(EMPTY_CAREER);
    c = applyCareer(c, facts(), new Date(2026, 10, 1, 9)).next;
    c = applyCareer(c, facts(), new Date(2026, 10, 2, 9)).next;
    c = applyCareer(c, facts(), new Date(2026, 10, 2, 19)).next;
    expect(c.streak.days).toBe(2);
    c = applyCareer(c, facts(), new Date(2026, 10, 5, 9)).next;
    expect(c.streak.days).toBe(1);
    expect(c.streak.best).toBe(2);
  });

  it('le missioni del giorno sono tre, diverse, e le stesse per tutti', () => {
    const a = missionsFor('2026-11-03');
    expect(a.length).toBe(3);
    expect(new Set(a.map((m) => m.id.split('-')[0])).size).toBe(3);
    expect(missionsFor('2026-11-03').map((m) => m.id)).toEqual(a.map((m) => m.id));
  });
});

describe('sessioni', () => {
  it('il calendario dipende solo dall’orologio', () => {
    const now = Date.UTC(2026, 10, 3, 17, 3);
    const list = upcoming(now, 6);
    expect(list.length).toBe(6);
    expect(list[0].start).toBe(slotOf(now) * SLOT_MS); // via alle 17:00, si entra fino alle 17:05
    expect(list[1].start - list[0].start).toBe(SLOT_MS);
    expect(sessionById(list[2].id)).toEqual(list[2]);
    expect(phaseOf(list[0], now)).toBe('via');
    expect(phaseOf(list[1], now)).toBe('presto');
    expect(upcoming(now + 4 * 60_000, 1)[0].start).toBe(list[1].start);
    expect(phaseOf(list[1], list[1].start - 60_000)).toBe('aperta');
    const kinds = new Set(Array.from({ length: 8 }, (_, i) => sessionAt(1000 + i).kind));
    expect(kinds.size).toBe(4);
  });
});

describe('gruppo virtuale', () => {
  it('parte al via, sta compatto e fa scia', () => {
    const pts = [];
    for (let d = 0; d <= 5000; d += 10) pts.push({ x: 0, z: -d, ele: 300 });
    const track = createRouteTrack(pts, { halfWidth: 3 });
    const pack = new PacerPack(track, 2.4, 7);
    pack.step(1);
    expect(Math.abs(pack.leader.d)).toBe(0);
    pack.started = true;
    for (let i = 0; i < 20 * 120; i++) pack.step(0.05);
    // 2,4 W/kg in piano: fra 28 e 40 km/h
    expect(pack.leader.v * 3.6).toBeGreaterThan(28);
    expect(pack.leader.v * 3.6).toBeLessThan(40);
    const spread = Math.max(...pack.pacers.map((p) => p.d)) - Math.min(...pack.pacers.map((p) => p.d));
    expect(spread).toBeLessThan(12);
    expect(pack.draft(pack.center - 6)).toBeLessThan(0.9);
    expect(pack.draft(pack.center + 200)).toBe(1);
  });
});

describe('tratti', () => {
  const prof: ProfilePoint[] = [];
  // 2 km piatti, 3 km al 6%, 1 km di discesa, 4 km piatti
  for (let d = 0, alt = 300; d <= 10_000; d += 25) {
    prof.push({ d, alt, x: 0, z: -d });
    alt += d < 2000 ? 0 : d < 5000 ? 25 * 0.06 : d < 6000 ? -25 * 0.05 : 0;
  }

  it('trova la salita e la volata prima dell’arrivo', () => {
    const climbs = findClimbs(prof);
    expect(climbs.length).toBe(1);
    expect(climbs[0].from).toBeCloseTo(2000, -2);
    expect(climbs[0].gain).toBeGreaterThan(170);
    const segs = deriveSegments('t', prof, (k) => k);
    const kinds = segs.map((s) => s.kind);
    expect(kinds).toContain('gpm');
    expect(kinds).toContain('volata');
    expect(kinds).toContain('crono');
    const v = segs.find((s) => s.kind === 'volata')!;
    expect(v.to).toBeGreaterThan(9000);
    expect(v.to - v.from).toBeCloseTo(300, -1);
  });

  it('il cronometro interpola il passaggio sotto l’arco e annulla chi esce', () => {
    const w = [{ seg: { id: 's', kind: 'volata' as const, name: 's', from: 100, to: 400 }, from: 100, to: 400 }];
    const t = new SegmentTracker(w);
    let ev = t.update(90, 9, 300, 0);
    ev = t.update(110, 11, 300, 0); // sotto l'arco a 100 m: t = 10 s
    expect(ev[0]?.type).toBe('start');
    expect(t.live[0].t0).toBeCloseTo(10, 5);
    t.update(390, 39, 300, 0);
    ev = t.update(410, 41, 300, 0); // arrivo a 400 m: t = 40 s
    const fin = ev.find((e) => e.type === 'finish');
    expect(fin && fin.type === 'finish' ? fin.sec : 0).toBeCloseTo(30, 5);
    const t2 = new SegmentTracker(w);
    t2.update(90, 9, 300, 0);
    t2.update(110, 11, 300, 0);
    t2.windows = [];
    expect(t2.update(150, 15, 300, 0)[0]?.type).toBe('abort');
  });

  it('un tratto che parte al metro zero si cronometra dal primo fotogramma', () => {
    const t = new SegmentTracker([{ seg: { id: 'z', kind: 'gpm', name: 'z', from: 0, to: 100 }, from: 0, to: 100 }]);
    t.prime(0, 0);
    expect(t.update(2, 0.5, 200, 0)[0]?.type).toBe('start');
    expect(t.live[0].t0).toBeCloseTo(0, 1);
    const fin = t.update(101, 25, 200, 0).find((e) => e.type === 'finish');
    expect(fin).toBeTruthy();
  });

  it('le salite verificate sono un GPM intero e gli ultimi 3 km', () => {
    const s = climbSegments('stelvio-prato', 'Stelvio', 25_200);
    expect(s.map((x) => x.kind)).toEqual(['gpm', 'crono']);
    expect(s[1].to - s[1].from).toBe(3000);
    expect(archSpecs(s, () => ({ x: 0, y: 0, z: 0, heading: 0, grade: 0, altitude: 0, distance: 0 })).filter((a) => a.role !== 'banner').length).toBe(4);
  });
});

describe('classifiche nuove sul server', () => {
  it('accetta salite, tratti e sessioni con tempi credibili, rifiuta il resto', async () => {
    const { parseResult, boardLimit } = await import('../src/multiplayer/world-protocol');
    const base = { pid: 'abcdefgh12345678', nick: 'Anna', wkg: 3, sim: true };
    expect(parseResult({ ...base, ride: 'salita:stelvio-prato', sec: 5400 }).ok).toBe(true);
    expect(parseResult({ ...base, ride: 'salita:stelvio-prato', sec: 900 }).ok).toBe(false); // 25 km in 15 minuti
    expect(parseResult({ ...base, ride: 'salita:inventata', sec: 5400 }).ok).toBe(false);
    expect(parseResult({ ...base, ride: 'w:citta-alta:gpm1', sec: 900, len: 4900, gain: 230 }).ok).toBe(true);
    expect(parseResult({ ...base, ride: 'w:citta-alta:volata1', sec: 8, len: 300, gain: 0 }).ok).toBe(false);
    expect(parseResult({ ...base, ride: 'w:citta-alta:gpm1', sec: 900 }).ok).toBe(false); // senza lunghezza
    expect(parseResult({ ...base, ride: 'ev:984000:citta-alta', sec: 900 }).ok).toBe(true);
    expect(parseResult({ ...base, ride: 'ev:984000:nessuno', sec: 900 }).ok).toBe(false);
    expect(boardLimit('citta-alta')).toBeGreaterThan(0);
  });
});

describe('tratti nel mondo vero', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
  const file = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile;
  const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
  const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as Parameters<typeof decodeFeatures>[0]);
  const graph = new WorldGraph(file);
  const data = { graph, rides, features };

  it('ogni percorso ha almeno un tratto, con un nome', () => {
    const { byRide, anchors } = worldSegments(data);
    for (const r of rides) {
      const segs = byRide.get(r.id) ?? [];
      expect(segs.length, r.id).toBeGreaterThan(0);
      for (const s of segs) expect(s.name.length, s.id).toBeGreaterThan(1);
    }
    expect(anchors.length).toBeGreaterThan(rides.length);
  });

  it('sul percorso pedalato i tratti ancorati cadono dove li ha messi il profilo', () => {
    const { byRide, anchors } = worldSegments(data);
    for (const r of rides.slice(0, 5)) {
      const legs: Leg[] = r.legs.map(([edge, d]) => ({ edge, dir: d }));
      const path = new WorldPath(graph, { edge: legs[0].edge, dir: legs[0].dir, s: legs[0].dir > 0 ? 0 : graph.edges[legs[0].edge].length });
      for (let i = 1; i < legs.length; i++) path.append(legs[i].edge, legs[i].dir);
      const wins = windowsOnPath(path, anchors);
      for (const s of byRide.get(r.id) ?? []) {
        const w = wins.find((x) => Math.abs(x.from - s.from) < 2 && Math.abs(x.to - s.to) < 2);
        expect(w, `${r.id} ${s.id}`).toBeTruthy();
      }
    }
  });
});
