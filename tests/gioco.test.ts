import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldGraph, type Leg, type WorldGraphFile } from '../src/open/graph';
import { WorldPath } from '../src/open/path';
import { WorldSession } from '../src/open/session';
import { decodeFeatures, type RideDef, type WorldData } from '../src/open/world';
import { projector } from '../src/domain/geo';
import { createRouteTrack } from '../src/domain/track';
import { STANDARD_AIR } from '../src/domain/physics';
import type { Workout } from '../src/domain/types';
import { ALL_BUILTIN, BUILTIN_WORKOUTS, builtinById, filterWorkouts, LIBRARY_WORKOUTS, workoutDuration, workoutRideLink } from '../src/domain/workouts';
import { RideEngine } from '../src/sim/engine';
import type { TelemetrySource, TrainerSnapshot } from '../src/sim/source';
import { applyCareer, EMPTY_CAREER, normalize, ORO_RULES, type RideFacts } from '../src/game/career';
import { ACHIEVEMENT_BY_ID } from '../src/game/achievements';
import { ITEM_BY_ID } from '../src/game/kit';
import { archSpecs, kmClimbs, kmMarks } from '../src/game/arches';
import { ErgArchPlanner, ergGates } from '../src/game/ergArches';
import { findClimbs, rideProfile, windowsOnPath, worldSegments } from '../src/game/segments';
import { RideGame } from '../src/game/rideGame';
import { pickRoute } from '../src/open/pick';
import { boardLimit, parseResult } from '../src/multiplayer/world-protocol';

const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as Parameters<typeof decodeFeatures>[0]);
const proj = projector(graph.origin);
const world: WorldData = { graph, rides, features, proj, toGeo: (x, z) => proj.toGeo(x, z) };

const legsOf = (r: RideDef): Leg[] => r.legs.map(([edge, d]) => ({ edge, dir: d }));
function pathOf(legs: Leg[]): WorldPath {
  const path = new WorldPath(graph, { edge: legs[0].edge, dir: legs[0].dir, s: legs[0].dir > 0 ? 0 : graph.edges[legs[0].edge].length });
  for (let i = 1; i < legs.length; i++) path.append(legs[i].edge, legs[i].dir);
  return path;
}

class FixedPower implements TelemetrySource {
  readonly mode = 'simulator' as const;
  hr = 140;
  cadence = 90;
  constructor(public power: number) {}
  snapshot(): TrainerSnapshot {
    return { mode: 'simulator', deviceName: null, services: { ftms: false, power: false, hr: false, csc: false }, control: 'none', simulation: 'none', status: 'idle', busy: false };
  }
  subscribe(): () => void {
    return () => undefined;
  }
  update(): void {}
  useSimulator(): Promise<void> {
    return Promise.resolve();
  }
  connectBluetooth(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): void {}
}

function engineOn(track: RideEngine['track'], workout: Workout | null, power = 250): RideEngine {
  return new RideEngine({
    track,
    source: new FixedPower(power),
    physics: { massKg: 83, cda: 0.32, crr: 0.004, ...STANDARD_AIR, rotatingFactor: 1 },
    ftp: 250,
    maxHr: 186,
    restHr: 52,
    lthr: 166,
    weightKg: 75,
    workout,
    withCamilla: false,
    crr: 0.004,
    cw: 0.39,
  });
}

function gameOn(engine: RideEngine, opts: Partial<ConstructorParameters<typeof RideGame>[0]> = {}): RideGame {
  return new RideGame({ engine, track: engine.track, nick: '', weightKg: 75, pbs: {}, sim: () => true, scale: () => 1, ranked: false, ...opts });
}

const facts = (over: Partial<RideFacts> = {}): RideFacts => ({
  distanceM: 10_000,
  gainM: 100,
  durationSec: 1800,
  sim: true,
  startedAt: new Date(2026, 10, 4, 18, 0),
  avgPower: 180,
  peak5s: 300,
  peak5min: 220,
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

describe('volate del cassonetto, dal mondo vero', () => {
  const { byRide, anchors } = worldSegments(world);
  const all = rides.flatMap((r) => (byRide.get(r.id) ?? []).filter((s) => s.kind === 'cassonetto').map((s) => ({ r, s })));

  it('una o due per percorso, brevi, in piano o in leggera discesa, all’ingresso di un paese', () => {
    expect(new Set(all.map((x) => x.r.id)).size).toBeGreaterThanOrEqual(6);
    for (const r of rides) expect((byRide.get(r.id) ?? []).filter((s) => s.kind === 'cassonetto').length, r.id).toBeLessThanOrEqual(2);
    for (const { r, s } of all) {
      const len = s.to - s.from;
      expect(len, s.id).toBeGreaterThanOrEqual(149);
      expect(len, s.id).toBeLessThanOrEqual(301);
      expect(s.id).toMatch(/^w:[a-z0-9-]+:cassonetto[12]$/);
      expect(s.name).toMatch(/^Volata del cassonetto · \S/);
      const prof = rideProfile(graph, legsOf(r));
      const at = (d: number) => prof[Math.round(d / 25)];
      const rise = at(s.to).alt - at(s.from).alt;
      expect(rise, s.id).toBeLessThanOrEqual(len * 0.02 + 0.01);
      expect(rise, s.id).toBeGreaterThanOrEqual(-len * 0.04 - 0.01);
      // il traguardo è all'ingresso del paese che dà il nome: dentro il suo raggio, il via ancora fuori
      const town = features.places
        .filter((p) => p.name === s.name.split(' · ')[1] && (p.kind === 'village' || p.kind === 'town'))
        .sort((u, v) => Math.hypot(u.x - at(s.to).x, u.z - at(s.to).z) - Math.hypot(v.x - at(s.to).x, v.z - at(s.to).z))[0];
      expect(town, s.name).toBeTruthy();
      const R = town.kind === 'town' ? 700 : 450;
      expect(Math.hypot(at(s.to).x - town.x, at(s.to).z - town.z), s.id).toBeLessThan(R + 30);
      expect(Math.hypot(at(s.from).x - town.x, at(s.from).z - town.z), s.id).toBeGreaterThan(R - 30);
    }
  });

  it('ancorate al grafo: valgono sul percorso e nel giro libero che passa di lì', () => {
    for (const { r, s } of all.slice(0, 6)) {
      const wins = windowsOnPath(pathOf(legsOf(r)), anchors);
      expect(wins.find((w) => w.seg.id === s.id && Math.abs(w.from - s.from) < 2), s.id).toBeTruthy();
      // un giro libero che comincia all'inizio del primo arco del tratto e ne segue gli archi
      const a = anchors.find((x) => x.seg.id === s.id)!;
      const free = windowsOnPath(pathOf(a.legs), anchors);
      expect(free.some((w) => w.seg.id === s.id), `${s.id} libero`).toBe(true);
    }
  });

  it('il server accetta il nuovo id con un tempo credibile', () => {
    const base = { pid: 'abcdefgh12345678', nick: 'Anna', wkg: 9, sim: false };
    const id = all[0].s.id;
    expect(boardLimit(id, 250, 0)).toBeGreaterThan(5);
    expect(parseResult({ ...base, ride: id, sec: 24, len: 250, gain: 0 }).ok).toBe(true);
    expect(parseResult({ ...base, ride: id, sec: 6, len: 250, gain: 0 }).ok).toBe(false);
    expect(parseResult({ ...base, ride: 'w:val-seriana:cassonetto7x', sec: 24, len: 250, gain: 0 }).ok).toBe(false);
  });

  it('danno l’oro, contano, e dieci fanno il Re del cassonetto con la sua maglia', () => {
    const seg = { id: 'w:x:cassonetto1', kind: 'cassonetto' as const, name: 'Volata del cassonetto · Cene', sec: 22, wkg: 9, lengthM: 250, gainM: 0 };
    const one = applyCareer(EMPTY_CAREER, facts({ segments: [seg] }), new Date(2026, 10, 4, 9));
    expect(one.lines.some((l) => l.label === seg.name && l.oro === ORO_RULES.cassonetto)).toBe(true);
    expect(one.next.counts.cassonetto).toBe(1);
    expect(one.unlocked.map((a) => a.id)).toContain('cassonetto-1');
    let c = normalize(one.next);
    for (let i = 0; i < 9; i++) c = applyCareer(c, facts({ segments: [{ ...seg, id: `w:x:cassonetto${i}` }] }), new Date(2026, 10, 4, 10 + i)).next;
    expect(c.achievements['cassonetto-10']).toBeTruthy();
    expect(ACHIEVEMENT_BY_ID.get('cassonetto-10')!.name).toBe('Re del cassonetto');
    expect(c.owned).toContain('m-differenziata');
    expect(ITEM_BY_ID.get('m-differenziata')?.achievement).toBe('cassonetto-10');
  });

  it('il traguardo è il cassonetto: arco verde al via, bidoni all’arrivo, cartello dei 100 m', () => {
    const s = all[0].s;
    const specs = archSpecs([s], () => ({ x: 0, y: 0, z: 0, heading: 0, grade: 0, altitude: 0, distance: 0 }));
    expect(specs.map((a) => `${a.role}:${a.label}`)).toEqual(['start:CASSONETTO', 'finish:CASSONETTO', 'banner:100 m']);
    expect(specs[0].sub).toBe(s.name.split(' · ')[1]);
  });
});

describe('archi dei km alla Zwift', () => {
  it('in salita uno a ogni km con la pendenza, e l’ultimo km in vetta con la fiamma', () => {
    const alt = (d: number) => 300 + d * 0.08;
    const m = kmMarks(5200, alt, [{ from: 0, to: 5200 }]);
    expect(m.map((x) => x.label)).toEqual(['5 km', '4 km', '3 km', '2 km', 'Ultimo km']);
    expect(m[m.length - 1].kind).toBe('ultimo');
    expect(m[m.length - 1].d).toBeCloseTo(4200, 5);
    expect(m.every((x) => x.sub === 'alla vetta')).toBe(true);
    expect(m[0].grade).toBeCloseTo(0.08, 5);
  });

  it('in piano ogni 5 km all’arrivo, e l’ultimo km prima dell’arrivo', () => {
    const m = kmMarks(23_000, () => 250, []);
    expect(m.map((x) => `${Math.round(x.d)}:${x.label}`)).toEqual(['3000:20 km', '8000:15 km', '13000:10 km', '18000:5 km', '22000:Ultimo km']);
    expect(m.find((x) => x.kind === 'ultimo')!.sub).toBe('all’arrivo');
  });

  it('due salite separate da una discesa breve si contano fino alla vetta vera', () => {
    const alt = (d: number) => (d < 3000 ? 300 + d * 0.06 : d < 3500 ? 480 - (d - 3000) * 0.04 : 460 + (d - 3500) * 0.07);
    const merged = kmClimbs([{ from: 0, to: 3000, gain: 180 }, { from: 3500, to: 6000, gain: 175 }], alt);
    expect(merged).toEqual([{ from: 0, to: 6000 }]);
  });

  it('su una salita verificata il gioco mette i portali dei km negli archi, al posto dei cartelli', () => {
    const pts = [];
    for (let d = 0; d <= 6000; d += 10) pts.push({ x: 0, z: -d, ele: 400 + d * 0.07 });
    const track = createRouteTrack(pts, { halfWidth: 3 });
    const game = gameOn(engineOn(track, null), { climb: { routeId: 'selvino-nembro', name: 'Prova' } });
    const km = game.arches.filter((a) => a.role === 'km');
    expect(km.map((a) => a.label)).toEqual(['5 km', '4 km', '3 km', '2 km', 'Ultimo km']);
    expect(km[0].grade).toBeCloseTo(0.07, 2);
    expect(km[4].kind).toBe('ultimo');
  });

  it('si parte sotto il via di un tratto: quel cartello non si mette, il tempo parte lo stesso (collaudo U, H3)', () => {
    const pts = [];
    for (let d = 0; d <= 6000; d += 10) pts.push({ x: 0, z: -d, ele: 400 + d * 0.07 });
    const track = createRouteTrack(pts, { halfWidth: 3 });
    const engine = engineOn(track, null);
    const game = gameOn(engine, { climb: { routeId: 'selvino-nembro', name: 'Prova' } });
    expect(game.arches.filter((a) => a.role === 'start' && Math.abs(a.d ?? -99) < 15)).toEqual([]);
    expect(game.arches.some((a) => a.role === 'finish')).toBe(true);
    for (let i = 0; i < 40; i++) {
      engine.tick(0.05);
      game.tick(0.05);
    }
    expect(game.live.length).toBeGreaterThan(0);
    // ripreso a metà di una salita lunga: il via degli ultimi 3 km, 200 m più avanti, c'è
    const lpts = [];
    for (let d = 0; d <= 8000; d += 10) lpts.push({ x: 0, z: -d, ele: 400 + d * 0.07 });
    const long = createRouteTrack(lpts, { halfWidth: 3 });
    const later = engineOn(long, null);
    later.distance = long.length - 3200;
    const g2 = gameOn(later, { climb: { routeId: 'selvino-nembro', name: 'Prova' } });
    expect(g2.arches.some((a) => a.role === 'start' && Math.abs((a.d ?? 0) - (long.length - 3000)) < 1)).toBe(true);
  });

  it('con un allenamento niente tratti: né archi né tempi; restano i km e l’arco dell’ERG', () => {
    const pts = [];
    for (let d = 0; d <= 6000; d += 10) pts.push({ x: 0, z: -d, ele: 400 + d * 0.07 });
    const track = createRouteTrack(pts, { halfWidth: 3 });
    const w: Workout = { id: 'w', builtin: false, kind: 'custom', steps: [{ id: 'a', name: 'a', durationSec: 60, powerPct: 50 }, { id: 'b', name: 'b', durationSec: 60, powerPct: 110 }] };
    const engine = engineOn(track, w);
    const game = gameOn(engine, { climb: { routeId: 'selvino-nembro', name: 'Prova' }, tratti: false });
    expect(game.tracker.windows).toEqual([]);
    for (let i = 0; i < 20 * 20; i++) {
      engine.tick(0.05);
      game.tick(0.05);
    }
    expect(game.live).toEqual([]);
    expect(game.arches.some((a) => a.role === 'km')).toBe(true);
    expect(game.arches.every((a) => a.kind === 'km' || a.kind === 'ultimo' || a.kind === 'erg')).toBe(true);
  });

  it('su un percorso del mondo in salita (Selvino) ci sono i km alla vetta e l’ultimo km', () => {
    const r = rides.find((x) => x.id === 'selvino')!;
    const path = pathOf(legsOf(r));
    const prof = rideProfile(graph, legsOf(r));
    const alt = (d: number) => path.poseAt(d).altitude;
    const m = kmMarks(path.length, alt, kmClimbs(findClimbs(prof, 60, 0.03), alt));
    expect(m.filter((x) => x.sub === 'alla vetta').length).toBeGreaterThanOrEqual(6);
    expect(m.some((x) => x.kind === 'ultimo')).toBe(true);
  });
});

describe('archi in ERG', () => {
  const vo2 = builtinById('vo2-4x5')!;

  it('un arco all’inizio e alla fine di ogni intervallo, col bersaglio', () => {
    const g = ergGates(vo2, 250);
    expect(g.length).toBe(8);
    expect(g[0]).toMatchObject({ role: 'start', at: 15 * 60, label: '5′ · 280 W' });
    expect(g[1]).toMatchObject({ role: 'finish', at: 20 * 60, label: 'Fine' });
    // gli over-under sono un blocco solo, coi due bersagli
    expect(ergGates(builtinById('over-under-3x9')!, 250)[0].label).toBe('9′ · 238–263 W');
    // il fondo non è lavoro: niente archi
    expect(ergGates(builtinById('fondo-90')!, 250)).toEqual([]);
  });

  it('il tempo diventa distanza con la velocità, e negli ultimi 50 m l’arco si ferma', () => {
    // 300 s a 10 m/s sono 3 km: oltre l'orizzonte, l'arco non c'è ancora
    const p = new ErgArchPlanner([{ id: 'a', at: 300, role: 'start', label: 'x' }]);
    expect(p.update(0, 0, 10, 0.1)).toBeNull();
    const p2 = new ErgArchPlanner([{ id: 'a', at: 100, role: 'start', label: 'x' }]);
    expect(p2.update(40, 500, 10, 0.1)!.d).toBeCloseTo(1100, 0);
    // si rallenta: l'arco si avvicina
    let r = p2.update(50, 600, 10, 0.1)!;
    expect(r.d).toBeCloseTo(1100, 0);
    for (let t = 50, d = 600; t <= 95; t += 0.5, d += 5) r = p2.update(t, d, 10, 0.5)!;
    // a 5 s dal cambio e 50 m: fermo
    const frozen = r.d;
    expect(frozen - 1050).toBeLessThan(60);
    r = p2.update(95.5, 1055, 2, 0.5)!;
    expect(r.d).toBe(frozen);
    // passato sotto l'arco: sparisce
    expect(p2.update(97, frozen + 1, 10, 0.5)).toBeNull();
  });

  it('nel gioco l’arco sta davanti alla ruota e si ferma, sulla salita', () => {
    const pts = [];
    for (let d = 0; d <= 20_000; d += 10) pts.push({ x: 0, z: -d, ele: 300 + d * 0.03 });
    const track = createRouteTrack(pts, { halfWidth: 3 });
    const w: Workout = { id: 'w', builtin: false, kind: 'custom', steps: [{ id: 'warmup', name: 'warmup', durationSec: 60, powerPct: 50 }, { id: 'work', name: 'work', durationSec: 60, powerPct: 110 }, { id: 'rec', name: 'rec', durationSec: 60, powerPct: 50 }] };
    const engine = engineOn(track, w);
    const game = gameOn(engine, { climb: { routeId: 'selvino-nembro', name: 'Prova' } });
    for (let i = 0; i < 20 * 30; i++) {
      engine.tick(0.05);
      game.tick(0.05);
    }
    const a = game.arches.find((x) => x.kind === 'erg')!;
    expect(a).toBeTruthy();
    expect(a.role).toBe('start');
    expect(a.label).toBe('1′ · 275 W');
    const ahead = game.ergArch!.d - engine.distance;
    expect(ahead).toBeGreaterThan(30);
    expect(ahead).toBeLessThan(30 * Math.max(3, engine.speed) + 60);
    for (let i = 0; i < 20 * 35; i++) {
      engine.tick(0.05);
      game.tick(0.05);
    }
    // passato l'inizio: ora c'è l'arco della fine
    expect(game.ergArch?.role).toBe('finish');
  });
});

describe('un allenamento più lungo del percorso', () => {
  it('a fine percorso si prosegue libero: la strada si allunga e il percorso conta come fatto', () => {
    const r = rides.find((x) => x.id === 'citta-alta')!;
    const session = new WorldSession(world, { ride: r }, 0);
    const end = session.path.length;
    const engine = engineOn(session.path, builtinById('fondo-90')!);
    const game = gameOn(engine, { world: { data: world, session } });
    engine.distance = end - 300;
    engine.tick(0.05);
    session.step(engine, 0.05);
    game.tick(0.05);
    expect(session.routeEnd).toBeCloseTo(end, 3);
    expect(session.planned).toBe(false);
    expect(session.path.length).toBeGreaterThan(end + 1000);
    expect(session.rankable).toBe(true);
  });
});

describe('allenamenti nuovi', () => {
  it('almeno venti, da mezz’ora a due ore, con passi validi e nomi italiani', () => {
    expect(LIBRARY_WORKOUTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ALL_BUILTIN.map((w) => w.id)).size).toBe(ALL_BUILTIN.length);
    expect(ALL_BUILTIN.length).toBe(BUILTIN_WORKOUTS.length + LIBRARY_WORKOUTS.length);
    const mins = LIBRARY_WORKOUTS.map((w) => workoutDuration(w) / 60);
    expect(Math.min(...mins)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...mins)).toBeLessThanOrEqual(120);
    expect(mins.some((m) => m <= 45)).toBe(true);
    expect(mins.some((m) => m >= 110)).toBe(true);
    for (const w of LIBRARY_WORKOUTS) {
      expect(w.name, w.id).toMatch(/^[A-ZÀ-Ý]/);
      expect((w.description ?? '').length, w.id).toBeGreaterThan(15);
      expect(w.description, w.id).toMatch(/^[A-ZÀ-Ý0-9]/);
      expect(new Set(w.steps.map((s) => s.id)).size, w.id).toBe(w.steps.length);
      for (const s of w.steps) {
        expect(s.durationSec, `${w.id} ${s.id}`).toBeGreaterThanOrEqual(10);
        expect(s.powerPct ?? 0, `${w.id} ${s.id}`).toBeGreaterThan(0);
        expect(s.powerPct ?? 0, `${w.id} ${s.id}`).toBeLessThanOrEqual(250);
      }
      expect(builtinById(w.id)).toBe(w);
    }
    const kinds = new Set(LIBRARY_WORKOUTS.map((w) => w.kind));
    for (const k of ['endurance', 'tempo', 'sweetspot', 'threshold', 'vo2', 'sprint', 'cadence', 'race', 'recovery'] as const) expect(kinds.has(k), k).toBe(true);
  });

  it('i filtri per durata e tipo', () => {
    const corti = filterWorkouts(ALL_BUILTIN, 'tutti', 'corti');
    expect(corti.length).toBeGreaterThan(2);
    expect(corti.every((w) => workoutDuration(w) <= 45 * 60 + 59)).toBe(true);
    const soglia = filterWorkouts(ALL_BUILTIN, 'soglia', 'tutte');
    expect(soglia.every((w) => w.kind === 'threshold')).toBe(true);
    expect(soglia.map((w) => w.id)).toEqual(expect.arrayContaining(['threshold-2x20', 'soglia-3x12', 'over-under-3x9']));
  });

  it('il link mette insieme allenamento e posto', () => {
    expect(workoutRideLink('vo2-4x5', { kind: 'percorso', ride: 'selvino' })).toBe('/ride?workout=vo2-4x5&world=bergamo&ride=selvino');
    expect(workoutRideLink('vo2-4x5', { kind: 'salita', route: 'stelvio-prato' })).toBe('/ride?workout=vo2-4x5&route=stelvio-prato');
    expect(workoutRideLink('agilita', { kind: 'libero', query: 'world=bergamo&edge=12&s=40&dir=1' })).toBe('/ride?workout=agilita&world=bergamo&edge=12&s=40&dir=1');
    expect(workoutRideLink('agilita', { kind: 'anello', query: 'world=bergamo&plan=abc' })).toBe('/ride?workout=agilita&world=bergamo&plan=abc');
  });
});

describe('carta → percorso', () => {
  it('un tocco vicino alla linea sceglie il percorso, lontano niente', () => {
    const r = rides.find((x) => x.id === 'presolana')!;
    const [edge] = r.legs[Math.floor(r.legs.length * 0.85)];
    const e = graph.edges[edge];
    const k = Math.floor(e.xs.length / 2);
    const mpp = 20;
    // 15 pixel accanto alla linea: è lui
    expect(pickRoute(graph, rides, e.xs[k] + 15 * mpp, e.zs[k], mpp)?.id).toBe('presolana');
    // 200 pixel più in là: niente (se non c'è un altro percorso)
    const far = pickRoute(graph, rides, e.xs[k] + 200 * mpp, e.zs[k] + 200 * mpp, mpp);
    expect(far?.id ?? null).not.toBe('presolana');
  });
});
