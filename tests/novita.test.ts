// Le novità del rilascio (pista 4): il fantasma su percorsi e tratti (N2), la cartolina (N3),
// i programmi a settimane (N4), gli allenamenti .zwo (N5).
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldGraph, type WorldGraphFile } from '../src/open/graph';
import { WorldSession } from '../src/open/session';
import { decodeFeatures, type RideDef, type WorldData } from '../src/open/world';
import { decodeMonumenti, type MonumentiFile } from '../src/open/monumenti';
import { projector } from '../src/domain/geo';
import { STANDARD_AIR } from '../src/domain/physics';
import type { Ride, RideSample } from '../src/domain/types';
import { RideEngine } from '../src/sim/engine';
import type { TelemetrySource, TrainerSnapshot } from '../src/sim/source';
import { RideGame } from '../src/game/rideGame';
import { formatGap, ghostGap, ghostMetersAt, ghostTimeAt, loadGhosts, RideGhosts, saveGhostIfBetter, traceFromPoints } from '../src/game/ghosts';
import { CARD_H, CARD_MARGIN, CARD_W, cardInputFromRide, cardTitle, layoutCard, paintCard, toCard, type CardInput, type Measure } from '../src/io/share-image';
import { ALL_BUILTIN, builtinById, stepPower, workoutDuration, workoutEstimate, workoutPowerSeries } from '../src/domain/workouts';
import { addDays, daysBetween, loadPlanState, markDone, PLACE_NAMES, planDays, PLANS, progressOf, savePlanState, sessionAt, sessionLink, startPlan, syncDone, todayOf, weekLoads } from '../src/domain/plans';
import { FREE_RIDE_PCT, importZwoFiles, parseZwo, workoutToZwo, ZwoError } from '../src/io/zwo';
import { ergGates } from '../src/game/ergArches';

const dir = join(__dirname, '..', 'public', 'world', 'bergamo');
const graph = new WorldGraph(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as WorldGraphFile);
const rides = JSON.parse(readFileSync(join(dir, 'rides.json'), 'utf8')) as RideDef[];
const features = decodeFeatures(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')) as Parameters<typeof decodeFeatures>[0]);
const proj = projector(graph.origin);
const world: WorldData = { graph, rides, features, proj, toGeo: (x, z) => proj.toGeo(x, z) };
const monumenti = decodeMonumenti(JSON.parse(readFileSync(join(dir, 'monumenti.json'), 'utf8')) as MonumentiFile);
const rideDef = (id: string) => rides.find((r) => r.id === id)!;

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

/** Una pedalata vera nel mondo, senza React: motore, sessione, gioco e fantasmi come in Ride.tsx. */
function worldRide(rideId: string, power: number) {
  const session = new WorldSession(world, { ride: rideDef(rideId) }, 0);
  const engine = new RideEngine({
    track: session.path,
    source: new FixedPower(power),
    physics: { massKg: 83, cda: 0.32, crr: 0.004, ...STANDARD_AIR },
    ftp: 250,
    maxHr: 186,
    restHr: 52,
    lthr: 166,
    weightKg: 75,
    workout: null,
    withCamilla: false,
    crr: 0.004,
    cw: 0.39,
    geoAt: (d) => {
      const p = session.path.poseAt(d);
      return proj.toGeo(p.x, p.z);
    },
  });
  const game = new RideGame({ engine, track: session.path, world: { data: world, session }, nick: '', weightKg: 75, pbs: {}, sim: () => true, scale: () => 1, ranked: false });
  const ghosts = new RideGhosts({ engine, game, session, enabled: true, sim: () => true });
  const off = engine.subscribe(ghosts.observe);
  const tick = (dt = 0.1) => {
    engine.tick(dt);
    session.step(engine, dt);
    game.tick(dt);
  };
  return { session, engine, game, ghosts, off, tick };
}

describe('N2 · il fantasma al metro', () => {
  const steady = Array.from({ length: 201 }, (_, i) => ({ d: i * 5, t: i }));

  it('a passo costante: secondi al metro e metri al secondo si rispondono', () => {
    const tr = traceFromPoints('w:prova', steady, 0, 1000, 0, 200)!;
    expect(tr.lengthM).toBe(1000);
    expect(tr.sec).toBe(200);
    expect(ghostTimeAt(tr, 0)).toBe(0);
    expect(ghostTimeAt(tr, 500)).toBeCloseTo(100, 5);
    expect(ghostTimeAt(tr, 1000)).toBeCloseTo(200, 5);
    expect(ghostTimeAt(tr, 1001)).toBeNull();
    expect(ghostMetersAt(tr, 37.5)).toBeCloseTo(187.5, 5);
    expect(ghostMetersAt(tr, 999)).toBe(1000);
    // io a 480 m in 100 s: lui c'era a 96 s, sono dietro di 4 s
    expect(ghostGap(tr, 480, 100)).toBeCloseTo(-4, 5);
    expect(formatGap(-4)).toBe('4 s dietro');
    expect(formatGap(12.4)).toBe('12 s avanti');
    expect(formatGap(75)).toBe('01:15 avanti');
    expect(formatGap(0.2)).toBe('Pari');
  });

  it('un pezzo in mezzo al giro parte da zero; in una sosta conta l’arrivo, non la ripartenza', () => {
    const tr = traceFromPoints('w:tratto', steady, 200, 700, 40, 140)!;
    expect(tr.lengthM).toBe(500);
    expect(ghostTimeAt(tr, 250)).toBeCloseTo(50, 5);
    const stop = traceFromPoints('w:sosta', [{ d: 100, t: 20 }, { d: 100, t: 50 }, { d: 200, t: 70 }], 0, 200, 0, 70)!;
    expect(ghostTimeAt(stop, 100)).toBeCloseTo(20, 1);
    // fermo a 100 m: il fantasma resta lì entro un passo (5 m), non scappa avanti
    expect(ghostMetersAt(stop, 35)).toBeGreaterThanOrEqual(100);
    expect(ghostMetersAt(stop, 35)).toBeLessThanOrEqual(105);
    expect(ghostTimeAt(stop, 150)).toBeCloseTo(60, 0);
  });

  it('passo fisso: al massimo 4000 tempi anche sul giro delle due valli', () => {
    const tr = traceFromPoints('w:due-valli', [{ d: 87837, t: 10000 }], 0, 87837, 0, 10000)!;
    expect(tr.t.length).toBeLessThanOrEqual(4001);
    expect(tr.step).toBe(22);
  });

  it('salvato in IndexedDB e letto al metro: il più lento non sostituisce il più veloce', async () => {
    const fast = traceFromPoints('w:prova-idb', steady, 0, 1000, 0, 200)!;
    const slow = traceFromPoints('w:prova-idb', steady.map((p) => ({ d: p.d, t: p.t * 1.2 })), 0, 1000, 0, 240)!;
    expect(await saveGhostIfBetter(slow)).toBe(true);
    expect(await saveGhostIfBetter(fast)).toBe(true);
    expect(await saveGhostIfBetter(slow)).toBe(false);
    const all = await loadGhosts();
    expect(all['w:prova-idb'].sec).toBe(200);
    expect(ghostTimeAt(all['w:prova-idb'], 750)).toBeCloseTo(150, 5);
  });

  it('due giri su Maresana: al secondo il fantasma è in strada e il distacco dice i secondi', async () => {
    // primo giro, 330 W: alla fine il fantasma del percorso e quelli dei tratti sono tenuti
    const a = worldRide('maresana', 330);
    let guard = 0;
    while (!a.engine.arrived && guard++ < 40000) a.tick();
    expect(a.engine.arrived).toBe(true);
    expect(a.session.rankable).toBe(true);
    expect(a.ghosts.kept).toContain('w:maresana');
    const lap1 = a.engine.elapsed;
    const t1 = a.ghosts.traces['w:maresana'];
    expect(t1.sec).toBeCloseTo(lap1, 0);
    expect(t1.lengthM).toBeCloseTo(a.engine.distance, 0);
    a.off();
    await new Promise((r) => setTimeout(r, 50));
    const saved = await loadGhosts();
    expect(saved['w:maresana'].sec).toBeCloseTo(lap1, 0);
    // a metà del primo giro: il tempo del fantasma al metro è quello del giro vero, entro un secondo
    const mid = a.engine.samples[Math.floor(a.engine.samples.length / 2)];
    expect(Math.abs(ghostTimeAt(saved['w:maresana'], mid.distance)! - mid.t)).toBeLessThan(1);

    // secondo giro, 280 W, coi fantasmi letti da IndexedDB
    const b = worldRide('maresana', 280);
    b.ghosts.traces = saved;
    for (let i = 0; i < 1200; i++) b.tick(); // due minuti
    const now = b.ghosts.now()!;
    expect(now.kind).toBe('percorso');
    expect(now.label).toBe('Fantasma');
    expect(now.distance).toBeGreaterThan(b.engine.distance + 5);
    expect(now.gap!).toBeLessThan(-1);
    expect(formatGap(now.gap!)).toMatch(/^\d+ s dietro$/);
    // in strada: la posa è sul percorso, accanto al punto dei metri del fantasma
    const pose = b.ghosts.pose()!;
    const on = b.session.path.poseAt(now.distance);
    expect(Math.hypot(pose.x - on.x, pose.z - on.z)).toBeLessThan(4);
    expect(b.ghosts.distance()).toBeCloseTo(now.distance, 3);
    b.off();
  }, 60000);

  it('sui tratti: il GPM di Maresana ha il suo fantasma, e fuori percorso quello del percorso sparisce', () => {
    const a = worldRide('maresana', 330);
    let guard = 0;
    while (!a.engine.arrived && guard++ < 40000) a.tick();
    const segIds = a.ghosts.kept.filter((id) => id !== 'w:maresana');
    expect(segIds.length).toBeGreaterThan(0);
    expect(segIds.every((id) => id.startsWith('w:maresana:'))).toBe(true);
    a.off();
    // fuori dal percorso il fantasma del percorso non c'è più, quello dei tratti resta possibile
    const b = worldRide('maresana', 280);
    b.ghosts.traces = { ...a.ghosts.traces };
    for (let i = 0; i < 50; i++) b.tick();
    expect(b.ghosts.now()?.kind).toBe('percorso');
    b.session.offRoute = true;
    expect(b.ghosts.now()?.kind ?? 'tratto').toBe('tratto');
    b.off();
  }, 60000);

  it('con un allenamento o nei replay niente fantasma, né letto né registrato', () => {
    const a = worldRide('maresana', 330);
    const off = new RideGhosts({ engine: a.engine, game: a.game, session: a.session, enabled: false, sim: () => true });
    off.traces = { 'w:maresana': traceFromPoints('w:maresana', [{ d: 3000, t: 600 }], 0, 3106, 0, 620)! };
    for (let i = 0; i < 20; i++) a.tick();
    expect(off.now()).toBeNull();
    expect(off.pose()).toBeNull();
    off.observe();
    expect(off.kept).toEqual([]);
    a.off();
  });
});

// ---------------------------------------------------------------------------

/** Una misura finta ma onesta: i condensati stretti, le scritte larghe, più la spaziatura. */
const measure: Measure = (s, f, spacing) => {
  const size = Number(/(\d+)px/.exec(f)?.[1] ?? 16);
  const k = f.includes('Barlow') ? 0.5 : 0.56;
  return s.length * size * k + spacing * s.length;
};

function rideOn(rideId: string, sec = 1500): Ride {
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
    startTime: new Date(2026, 10, 4, 18, 30).toISOString(),
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
  };
}

function boxesInside(input: CardInput) {
  const layout = layoutCard(input, measure);
  for (const t of layout.texts) {
    expect(t.box.x0, `${t.id} «${t.text}» a sinistra`).toBeGreaterThanOrEqual(CARD_MARGIN - 0.5);
    expect(t.box.x1, `${t.id} «${t.text}» a destra`).toBeLessThanOrEqual(CARD_W - CARD_MARGIN + 0.5);
    expect(t.box.y0, `${t.id} «${t.text}» in alto`).toBeGreaterThanOrEqual(40);
    expect(t.box.y1, `${t.id} «${t.text}» in basso`).toBeLessThanOrEqual(CARD_H - 40);
    expect(t.text).not.toMatch(/…|\.\.\./);
    // la maiuscola sempre; fanno eccezione le unità (km, m) e l'indirizzo
    if (!t.id.startsWith('stat-unit-') && t.id !== 'url') expect(t.text.charAt(0), t.id).toBe(t.text.charAt(0).toLocaleUpperCase('it-IT'));
  }
  // nessuna scritta sopra un'altra
  for (let i = 0; i < layout.texts.length; i++)
    for (let j = i + 1; j < layout.texts.length; j++) {
      const a = layout.texts[i].box;
      const b = layout.texts[j].box;
      const overlap = a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5;
      expect(overlap, `${layout.texts[i].id} su ${layout.texts[j].id}`).toBe(false);
    }
  return layout;
}

describe('N3 · la cartolina', () => {
  it('è 1080×1350, il 4:5 dei social', () => {
    expect([CARD_W, CARD_H]).toEqual([1080, 1350]);
  });

  it('Città Alta: titolo, riga sopra, monumenti passati in ordine, traccia sulla carta di Bergamo', () => {
    const ride = rideOn('citta-alta');
    const input = cardInputFromRide(ride, world, monumenti);
    expect(input.inWorld).toBe(true);
    expect(input.title).toBe('Città Alta e San Vigilio');
    expect(input.eyebrow).toBe('dalla stazione al castello');
    expect(input.monuments.length).toBeGreaterThanOrEqual(3);
    // dalla stazione al castello, nell'ordine in cui si passano
    const names = input.monuments.map((m) => m.name);
    expect(names[0]).toBe('Stazione di Bergamo');
    expect(names[names.length - 1]).toBe('Castello di San Vigilio');
    expect(names).toContain("Porta Sant'Agostino");
    expect(names.indexOf("Porta Sant'Agostino")).toBeLessThan(names.indexOf('Duomo di Bergamo'));
    const layout = boxesInside(input);
    // il titolo lungo va su due righe, non si tronca
    expect(layout.texts.filter((t) => t.id.startsWith('title-')).length).toBe(2);
    // la traccia intera sta nel suo riquadro, sotto la fascia del marchio e sopra il testo
    for (const p of input.track) {
      const q = toCard(layout.view, p.x, p.z);
      expect(q.x).toBeGreaterThanOrEqual(layout.fit.x0 - 1);
      expect(q.x).toBeLessThanOrEqual(layout.fit.x1 + 1);
      expect(q.y).toBeGreaterThanOrEqual(layout.fit.y0 - 1);
      expect(q.y).toBeLessThanOrEqual(layout.fit.y1 + 1);
    }
    const eyebrow = layout.texts.find((t) => t.id === 'eyebrow')!;
    const top = Math.min(...layout.texts.filter((t) => t.id.startsWith('title-')).map((t) => t.box.y0));
    expect(eyebrow.box.y1).toBeLessThanOrEqual(top);
    expect(layout.fit.y1).toBeLessThan(eyebrow.box.y0);
  });

  it('i casi lunghi restano nel riquadro: il giro delle due valli, cinque ore, dieci monumenti', () => {
    const input = cardInputFromRide(rideOn('due-valli', 18_752), world, monumenti);
    boxesInside(input);
    const many: CardInput = {
      ...input,
      title: 'Precisissimamentesuperlunghissimo',
      eyebrow: 'Soglia lunga 2×30′ · Il giro delle due valli, Bergamo, Val Seriana, Zambla, Val Brembana',
      durationSec: 36_000,
      distanceM: 187_400,
      gainM: 4560,
      monuments: monumenti.slice(0, 12).map((m) => ({ name: m.name, x: m.x, z: m.z })),
    };
    const layout = boxesInside(many);
    expect(layout.texts.find((t) => t.id === 'monuments')!.text).toMatch(/e altri \d+$/);
  });

  it('un giro senza GPS: niente carta, il profilo prende il suo posto', () => {
    const ride = rideOn('maresana');
    ride.samples = ride.samples.map(({ lat: _lat, lon: _lon, ...s }) => s);
    ride.routeId = undefined;
    const input = cardInputFromRide(ride, null, monumenti);
    expect(input.track.length).toBe(0);
    expect(input.inWorld).toBe(false);
    expect(input.title).toBe('Maresana da Ponteranica');
    const layout = boxesInside(input);
    expect(layout.profile).toBeNull();
  });

  it('il nome si riconosce anche con l’allenamento davanti', () => {
    expect(cardTitle({ name: 'Soglia 3×12′ · Maresana da Ponteranica' }, rides)).toEqual({ title: 'Maresana', eyebrow: 'Soglia 3×12′ · da Ponteranica' });
    expect(cardTitle({ name: 'Giro libero' }, rides)).toEqual({ title: 'Giro libero', eyebrow: 'Bergamo e le valli' });
  });

  it.each(['maresana', 'citta-alta', 'ganda'])('il disegno di %s: ogni scritta, anche i nomi sulla carta, cade dentro il margine, coi caratteri dell’app', (id) => {
    const input = cardInputFromRide(rideOn(id), world, monumenti);
    const layout = layoutCard(input, measure);
    const calls: { text: string; x: number; y: number; w: number; font: string }[] = [];
    let font = '';
    let spacing = 0;
    const grad = { addColorStop: () => undefined };
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(target, key) {
        if (key === 'fillText') return (text: string, x: number, y: number) => calls.push({ text, x, y, w: measure(text, font, spacing), font });
        if (key === 'createLinearGradient') return () => grad;
        if (key === 'measureText') return (s: string) => ({ width: measure(s, font, 0) });
        if (key in target) return target[key as string];
        return () => undefined;
      },
      set(target, key, value) {
        if (key === 'font') font = value as string;
        if (key === 'letterSpacing') spacing = parseFloat(String(value)) || 0;
        target[key as string] = value;
        return true;
      },
    });
    (globalThis as Record<string, unknown>).Path2D ??= class {
      moveTo() {}
      lineTo() {}
      closePath() {}
    };
    paintCard(ctx as unknown as CanvasRenderingContext2D, input, layout, { data: world, far: null });
    // le scritte del riquadro, più i nomi sulla carta (paesi, monumenti)
    expect(calls.length).toBeGreaterThanOrEqual(layout.texts.length);
    for (const c of calls) {
      expect(c.x, c.text).toBeGreaterThanOrEqual(CARD_MARGIN - 6.5);
      expect(c.x + c.w, c.text).toBeLessThanOrEqual(CARD_W - CARD_MARGIN + 6.5);
      expect(c.y, c.text).toBeGreaterThan(40);
      expect(c.y, c.text).toBeLessThan(CARD_H - 40);
      expect(c.font).toMatch(/Barlow Condensed|Outfit/);
    }
    // i nomi sulla carta stanno sopra la riga del titolo
    const titleTop = Math.min(...layout.texts.filter((t) => t.id === 'eyebrow' || t.id.startsWith('title-')).map((t) => t.box.y0));
    for (const c of calls.filter((x) => !layout.texts.some((t) => t.text === x.text && t.y === x.y))) expect(c.y, c.text).toBeLessThan(titleTop);
    expect(calls.map((c) => c.text)).toContain('OROBIA');
    if (id === 'citta-alta') expect(calls.map((c) => c.text)).toContain('Stazione di Bergamo');
  });
});

// ---------------------------------------------------------------------------

describe('N4 · i programmi a settimane', () => {
  const plan = (id: string) => PLANS.find((p) => p.id === id)!;
  const hard = (d: { workout: string | null } | null) => !!d && (d.workout == null || workoutEstimate(builtinById(d.workout)!, 250).if >= 0.8);

  it('tre programmi: Primo Selvino 4 settimane, Base d’inverno 6, Sotto l’ora alla Ganda 4', () => {
    expect(PLANS.map((p) => [p.name, p.weeks.length])).toEqual([
      ['Primo Selvino', 4],
      ['Base d’inverno', 6],
      ['Sotto l’ora alla Ganda', 4],
    ]);
  });

  it('solo i 33 allenamenti che ci sono, e posti veri del mondo coi loro nomi', () => {
    expect(ALL_BUILTIN.length).toBe(33);
    for (const p of PLANS)
      for (const w of p.weeks) {
        expect(w.days.length, `${p.id} ${w.title}`).toBe(7);
        for (const d of w.days) {
          if (!d) continue;
          if (d.workout) expect(builtinById(d.workout), d.workout).toBeDefined();
          expect(d.place.kind).toBe('percorso');
          if (d.place.kind === 'percorso') {
            const ride = d.place.ride;
            expect(rides.some((r) => r.id === ride && r.name === PLACE_NAMES[ride]), ride).toBe(true);
          }
        }
      }
  });

  it('il recupero: almeno due giorni di riposo a settimana, mai due giorni duri di fila, lo scarico pesa meno', () => {
    for (const p of PLANS) {
      for (const w of p.weeks) expect(w.days.filter((d) => !d).length, `${p.id} ${w.title}`).toBeGreaterThanOrEqual(2);
      const all = p.weeks.flatMap((w) => w.days);
      for (let i = 1; i < all.length; i++) expect(hard(all[i - 1]) && hard(all[i]), `${p.id} giorno ${i}`).toBe(false);
    }
    const base = plan('base-inverno');
    const loads = weekLoads(base);
    const k = base.weeks.findIndex((w) => w.recovery);
    expect(k).toBe(3);
    expect(loads[k]).toBeLessThan(loads[k - 1] * 0.6);
    // i due programmi con un traguardo finiscono con la prova sul loro percorso
    expect(plan('primo-selvino').weeks[3].days.find((d) => d && !d.workout)?.place).toEqual({ kind: 'percorso', ride: 'selvino' });
    expect(plan('ganda-sotto-ora').weeks[3].days.find((d) => d && !d.workout)?.place).toEqual({ kind: 'percorso', ride: 'ganda' });
  });

  it('il calendario: giorno 0 oggi, settimane di sette giorni, anche col cambio dell’ora', () => {
    const st = startPlan('primo-selvino', '2026-11-04');
    const days = planDays(plan('primo-selvino'), st, '2026-11-04');
    expect(days.length).toBe(28);
    expect(days[0]).toMatchObject({ date: '2026-11-04', status: 'oggi', week: 0 });
    expect(days[7].date).toBe('2026-11-11');
    expect(days[27].date).toBe('2026-12-01');
    expect(days[1].status).toBe('riposo');
    expect(days[2].status).toBe('futuro');
    expect(daysBetween('2027-03-25', '2027-04-01')).toBe(7);
    expect(addDays('2027-03-27', 2)).toBe('2027-03-29');
  });

  it('Oggi: la seduta del giorno, il riposo col prossimo, quella saltata da recuperare entro due giorni', () => {
    const p = plan('primo-selvino');
    const st = startPlan(p.id, '2026-11-04');
    const t0 = todayOf(p, st, '2026-11-04');
    expect(t0.kind === 'sessione' && t0.day.index === 0 && !t0.catchUp).toBe(true);
    if (t0.kind === 'sessione') expect(sessionLink(t0.day.session!)).toBe('/ride?workout=endurance&world=bergamo&ride=val-seriana');
    // giorno 1, riposo: la seduta di ieri è saltata, si recupera
    const t1 = todayOf(p, st, '2026-11-05');
    expect(t1.kind === 'sessione' && t1.day.index === 0 && t1.catchUp).toBe(true);
    // fatta ieri: oggi riposo, e dopodomani l'agilità
    const done0 = markDone(st, 0);
    const t1b = todayOf(p, done0, '2026-11-05');
    expect(t1b.kind).toBe('riposo');
    if (t1b.kind === 'riposo') expect(t1b.next?.index).toBe(2);
    // giorno 4: il 2 è saltato da due giorni, si recupera ancora; il giorno 5 ha la sua
    const t4 = todayOf(p, done0, '2026-11-08');
    expect(t4.kind === 'sessione' && t4.day.index === 2 && t4.catchUp).toBe(true);
    const t5 = todayOf(p, done0, '2026-11-09');
    expect(t5.kind === 'sessione' && t5.day.index === 5).toBe(true);
    // la prova finale apre il percorso senza schema; dopo l'ultimo giorno, «finito»
    expect(sessionLink(sessionAt(p, 26)!)).toBe('/ride?world=bergamo&ride=selvino');
    expect(todayOf(p, st, '2026-12-02').kind).toBe('finito');
  });

  it('l’avanzamento: i giri lo segnano da soli (anche il recupero) e resta salvato in IndexedDB', async () => {
    const p = plan('primo-selvino');
    const st = startPlan(p.id, '2026-11-04');
    const ride = (id: string, day: string, workoutId?: string, routeId?: string): Ride => ({ ...rideOn('maresana', 10), id, startTime: new Date(`${day}T18:30:00`).toISOString(), workoutId, routeId });
    const list = [
      ride('r0', '2026-11-04', 'endurance'),
      ride('r-altro', '2026-11-06', 'vo2-6x3'),
      ride('r2', '2026-11-08', 'agilita'), // l'agilità del giorno 2, recuperata il giorno 4
      ride('r26', '2026-11-30', undefined, 'bergamo:selvino'), // la prova
    ];
    const synced = syncDone(p, st, list);
    expect(synced.done).toEqual({ 0: 'r0', 2: 'r2', 26: 'r26' });
    expect(syncDone(p, synced, list)).toBe(synced);
    expect(progressOf(p, synced)).toEqual({ done: 3, total: 12 });
    await savePlanState(synced);
    const back = await loadPlanState();
    expect(back).toEqual(synced);
    expect(planDays(p, back!, '2026-11-08').map((d) => d.status).slice(0, 7)).toEqual(['fatto', 'riposo', 'fatto', 'riposo', 'riposo', 'futuro', 'riposo']);
    await savePlanState(null);
    expect(await loadPlanState()).toBeNull();
  });
});

// ---------------------------------------------------------------------------

/** Tre file veri, così come li danno Zwift (GC Coaching) e il suo editor. */
const ZWO = {
  // https://github.com/vincent290587/WeePlanner/blob/master/db/GC%20Coaching/Chamois_Abuse.zwo
  chamois: `<workout_file>
    <author>S.Gaffney (GC Coaching)</author>
    <name>Chamois Abuse</name>
    <description>WARM-UP
-Start with 10 minutes gradually increasing your power and cadence, then 3x 30 seconds @110+ RPM @115% FTP with 3 minutes active recovery to ready the legs, and finally 2 minutes free ride to ready the mind. </description>
    <sportType>bike</sportType>
    <tags>
        <tag name="Warm-up"/>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.37261483" PowerHigh="0.75449997" pace="1125572608"/>
        <IntervalsT Repeat="3" OnDuration="30.000002" OffDuration="30.000002" OnPower="1.1544999" OffPower="0.50449997" pace="1125572608"/>
        <FreeRide Duration="120.00001" FlatRoad="1"/>
        <SteadyState Duration="300" Power="1.0044999" pace="1125572608"/>
        <Ramp Duration="30" PowerLow="1.0044999" PowerHigh="1.5044999" pace="1125572608"/>
        <SteadyState Duration="120" Power="0.50449997" pace="1125572608"/>
        <SteadyState Duration="300" Power="1.0044999" pace="1125572608"/>
        <Ramp Duration="30" PowerLow="1.0044999" PowerHigh="1.5044999" pace="1125572608"/>
        <SteadyState Duration="120" Power="0.50449997" pace="1125572608"/>
        <SteadyState Duration="300" Power="1.0044999" pace="1125572608"/>
        <Ramp Duration="30" PowerLow="1.0044999" PowerHigh="1.5044999" pace="1125572608"/>
        <SteadyState Duration="120" Power="0.50449997" pace="1125572608"/>
        <SteadyState Duration="300" Power="1.0044999" pace="1125572608"/>
        <Ramp Duration="30" PowerLow="1.0044999" PowerHigh="1.5044999" pace="1125572608"/>
        <SteadyState Duration="120" Power="0.5" pace="1125572608"/>
        <SteadyState Duration="300" Power="1.0044999" pace="1125572608"/>
        <Ramp Duration="30" PowerLow="1.0044999" PowerHigh="1.5044999" pace="1125572608"/>
        <SteadyState Duration="240" Power="0.50449997" pace="1125572608"/>
        <IntervalsT Repeat="10" OnDuration="30" OffDuration="30" OnPower="1.2544999" OffPower="0.75449997" pace="1125572608"/>
        <SteadyState Duration="300" Power="0.50449997" pace="1125572608"/>
        <IntervalsT Repeat="10" OnDuration="30" OffDuration="30" OnPower="1.3544999" OffPower="0.65449995" pace="1125572608"/>
        <Cooldown Duration="330" PowerLow="0.81431097" PowerHigh="0.31961131" pace="1125572608"/>
    </workout>
</workout_file>
`,
  // https://github.com/vincent290587/WeePlanner/blob/master/db/GC%20Coaching/NOT_SO_SWEET_SPOT.zwo
  sweet: `<workout_file>
    <author>S.Gaffney (GC Coaching)</author>
    <name>Not So Sweet Spot</name>
    <description>WARM-UP
-Start with 10 minutes gradually increasing your power and cadence, then 3x 30 seconds @110+ RPM @115% FTP with 3 minutes active recovery to ready the legs, and finally 2 minutes free ride to ready the mind. 

NOT SO SWEET SPOT
-2x 12 minutes @SST w/ a 3 minute gradual ramp-up in both power and cadence to finish.  Rest for 3 minutes between.
-Finish with a gradual "cool-down" :-) then stretch!</description>
    <sportType>bike</sportType>
    <tags>
        <tag name="SweetSpot"/>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.41679245" PowerHigh="0.7526415" pace="1125572608"/>
        <IntervalsT Repeat="3" OnDuration="30.000002" OffDuration="30.000002" OnPower="1.1544999" OffPower="0.50449997" pace="1125572608"/>
        <FreeRide Duration="120.00001" FlatRoad="1"/>
        <SteadyState Duration="720" Power="0.88449997" pace="1125572608"/>
        <Ramp Duration="180" PowerLow="0.88449997" PowerHigh="1.1044999" pace="1125572608"/>
        <SteadyState Duration="180" Power="0.5" pace="1125572608"/>
        <SteadyState Duration="720" Power="0.88449997" pace="1125572608"/>
        <Ramp Duration="180" PowerLow="0.88449997" PowerHigh="1.1044999" pace="1125572608"/>
        <SteadyState Duration="180" Power="0.50449997" pace="1125572608"/>
        <Cooldown Duration="540" PowerLow="0.86805052" PowerHigh="0.25433213" pace="1125572608"/>
    </workout>
</workout_file>
`,
  // https://github.com/eljefewappo/ZwiftWorkouts/blob/master/14367/examples/All_The_BuildingBlocks.zwo
  blocks: `<workout_file>
  <author/>
  <name>All_The_BuildingBlocks</name>
  <description/>
  <sportType>bike</sportType>
  <durationType>time</durationType>
  <tags/>
  <workout>
    <SteadyState Duration="300" Power="0.5" pace="0">
      <textevent timeoffset="48" message="Zone 1"/>
    </SteadyState>
    <SteadyState Duration="300" Power="0.605" pace="0">
      <textevent timeoffset="48" message="Zone 2"/>
    </SteadyState>
    <SteadyState Duration="300" Power="0.763" pace="0">
      <textevent timeoffset="63" message="Zone 3"/>
    </SteadyState>
    <SteadyState Duration="300" Power="0.901" pace="0">
      <textevent timeoffset="75" message="Zone 4"/>
    </SteadyState>
    <SteadyState Duration="300" Power="1.053" pace="0">
      <textevent timeoffset="57" message="Zone 5"/>
    </SteadyState>
    <SteadyState Duration="300" Power="1.194" pace="0">
      <textevent timeoffset="27" message="Zone 6"/>
    </SteadyState>
    <Ramp Duration="300" PowerLow="0.25" PowerHigh="0.75" pace="0">
      <textevent timeoffset="87" message="Ramp Up"/>
    </Ramp>
    <Ramp Duration="300" PowerLow="0.75" PowerHigh="0.25" pace="0">
      <textevent timeoffset="90" message="Ramp Down"/>
    </Ramp>
    <IntervalsT Repeat="3" OnDuration="30" OffDuration="120" OnPower="1" OffPower="0.5" pace="0">
      <textevent timeoffset="69" message="Intervals"/>
    </IntervalsT>
    <FreeRide Duration="600" FlatRoad="0">
      <textevent timeoffset="75" message="Free ride"/>
    </FreeRide>
    <Ramp Duration="295" PowerLow="0.75" PowerHigh="0.85" pace="0"/>
    <Ramp Duration="295" PowerLow="0.75" PowerHigh="0.85" pace="0"/>
    <Cooldown Duration="295" PowerLow="0.85" PowerHigh="0.75" pace="0"/>
  </workout>
</workout_file>
`,
};

/** La durata che il file dichiara, contata a parte (IntervalsT = Repeat × (on + off)). */
function declared(xml: string): number {
  let sec = 0;
  for (const m of xml.matchAll(/<(\w+)\s([^>]*?)\/?>/g)) {
    const a = (k: string) => Number(new RegExp(`\\b${k}="([^"]+)"`).exec(m[2])?.[1] ?? 0);
    if (m[1] === 'IntervalsT') sec += a('Repeat') * (Math.round(a('OnDuration')) + Math.round(a('OffDuration')));
    else if (/^(Warmup|Cooldown|Ramp|SteadyState|FreeRide|MaxEffort)$/.test(m[1])) sec += Math.round(a('Duration'));
  }
  return sec;
}

describe('N5 · gli allenamenti .zwo', () => {
  it('Chamois Abuse: riscaldamento, IntervalsT, FreeRide, SteadyState, Ramp e defaticamento, al secondo', () => {
    const w = parseZwo(ZWO.chamois, 'zwo-a');
    expect(w).toMatchObject({ id: 'zwo-a', name: 'Chamois Abuse', builtin: false, kind: 'custom', description: 'Da Zwift · S.Gaffney (GC Coaching)' });
    expect(workoutDuration(w)).toBe(declared(ZWO.chamois));
    expect(w.steps[0]).toMatchObject({ name: 'warmup', durationSec: 600, powerPct: 37.3, powerEndPct: 75.4 });
    // IntervalsT 3 × (30″ al 115%, 30″ al 50%)
    expect(w.steps.slice(1, 7).map((s) => [s.durationSec, s.powerPct])).toEqual([
      [30, 115.4],
      [30, 50.4],
      [30, 115.4],
      [30, 50.4],
      [30, 115.4],
      [30, 50.4],
    ]);
    expect(w.steps[7]).toMatchObject({ name: 'rec-libero', durationSec: 120, powerPct: FREE_RIDE_PCT });
    expect(w.steps[8]).toMatchObject({ durationSec: 300, powerPct: 100.4 });
    expect(w.steps[9]).toMatchObject({ name: 'ramp', durationSec: 30, powerPct: 100.4, powerEndPct: 150.4 });
    const last = w.steps[w.steps.length - 1];
    expect(last).toMatchObject({ name: 'cooldown', durationSec: 330, powerPct: 81.4, powerEndPct: 32 });
    expect(new Set(w.steps.map((s) => s.id)).size).toBe(w.steps.length);
  });

  it('Not So Sweet Spot e All The Building Blocks: la durata torna, le rampe anche in discesa, le scritte a tempo fuori', () => {
    const a = parseZwo(ZWO.sweet);
    expect(workoutDuration(a)).toBe(declared(ZWO.sweet));
    expect(a.steps.filter((s) => s.durationSec === 720).every((s) => s.powerPct === 88.4)).toBe(true);
    const b = parseZwo(ZWO.blocks);
    expect(workoutDuration(b)).toBe(declared(ZWO.blocks));
    expect(b.description).toBe('Da Zwift');
    const down = b.steps.find((s) => s.name?.startsWith('ramp') && s.powerPct === 75 && s.powerEndPct === 25);
    expect(down?.durationSec).toBe(300);
    expect(b.steps.find((s) => s.name === 'rec-libero')?.durationSec).toBe(600);
  });

  it('non tutto è un allenamento per la bici', () => {
    expect(() => parseZwo('<workout_file><sportType>run</sportType><workout><SteadyState Duration="60" Power="1"/></workout></workout_file>')).toThrow(ZwoError);
    expect(() => parseZwo('<gpx></gpx>')).toThrow(ZwoError);
    expect(() => parseZwo('<workout_file><workout></workout></workout_file>')).toThrow(ZwoError);
  });

  it('esportato e reimportato: la stessa potenza a ogni secondo, gli intervalli come IntervalsT', () => {
    for (const id of ['vo2-30-30', 'over-under-3x9', 'agilita', 'risveglio']) {
      const w = builtinById(id)!;
      const xml = workoutToZwo(w, id, 250);
      const back = parseZwo(xml);
      const a = workoutPowerSeries(w, 250);
      const b = workoutPowerSeries(back, 250);
      expect(b.length, id).toBe(a.length);
      for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i]), `${id} al secondo ${i}`).toBeLessThan(0.6);
    }
    expect(workoutToZwo(builtinById('vo2-30-30')!, 'VO2max 30/30', 250)).toMatch(/<IntervalsT Repeat="10" OnDuration="30" OffDuration="30" OnPower="1.25" OffPower="0.5"\/>/);
  });

  it('l’allenamento importato va in ERG, con gli archi degli intervalli', async () => {
    const saved: string[] = [];
    const note = await importZwoFiles([new File([ZWO.chamois], 'Chamois_Abuse.zwo'), new File(['<gpx/>'], 'giro.gpx')], async (w) => {
      saved.push(w.name!);
    });
    expect(saved).toEqual(['Chamois Abuse']);
    expect(note).toBe('Importato «Chamois Abuse»: è fra i tuoi. «giro.gpx» non è un allenamento .zwo per la bici.');
    const w = parseZwo(ZWO.chamois);
    expect(ergGates(w, 250).length).toBeGreaterThanOrEqual(5);
    const session = new WorldSession(world, { ride: rideDef('val-seriana') }, 0);
    const engine = new RideEngine({
      track: session.path,
      source: new FixedPower(200),
      physics: { massKg: 83, cda: 0.32, crr: 0.004, ...STANDARD_AIR },
      ftp: 250,
      maxHr: 186,
      restHr: 52,
      lthr: 166,
      weightKg: 75,
      workout: w,
      withCamilla: false,
      crr: 0.004,
      cw: 0.39,
    });
    const game = new RideGame({ engine, track: session.path, world: { data: world, session }, nick: '', weightKg: 75, pbs: {}, sim: () => true, scale: () => 1, ranked: false });
    for (let i = 0; i < 6100; i++) {
      engine.tick(0.1); // 610 s: dentro il primo intervallo
      session.step(engine, 0.1);
      game.tick(0.1);
    }
    expect(engine.mode).toBe('erg');
    expect(engine.targetPower).toBeCloseTo(stepPower(w.steps[1], 10, 250), 0);
    expect(game.arches.some((a) => a.kind === 'erg')).toBe(true);
  });
});
