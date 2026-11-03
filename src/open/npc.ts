import { STANDARD_AIR, stepSpeed, type PhysicsParams } from '@/domain/physics';
import { CLS, FLAG, type Dir, type WorldGraph } from './graph';

/**
 * I ciclisti virtuali della valle: non sono persone, e l'app lo dice (nell'elenco «intorno a
 * te» sono «virtuali», senza nome sopra la testa). Servono a non pedalare in un mondo vuoto:
 * pedalano sulle stesse strade con la stessa fisica del giocatore, a 1,8-3,9 W/kg, scelgono
 * agli incroci come farebbe un ciclista (dritto se si può, le strade buone più delle altre) e
 * vivono entro un paio di chilometri da chi guarda.
 */

export interface Npc {
  slot: number;
  active: boolean;
  edge: number;
  dir: Dir;
  /** distanza lungo l'arco da a */
  s: number;
  v: number;
  wkg: number;
  mass: number;
  cadence: number;
  /** metri a destra della mezzeria, nel proprio verso */
  lane: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  grade: number;
}

export const NPC_JERSEYS = ['#e94f37', '#3b8ea5', '#f5b700', '#7a5cff', '#00a878', '#ff7aa2', '#f4f4f0', '#2e3a87', '#ff9f1c', '#5c946e', '#c2185b', '#9ccc65'];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Viewer {
  x: number;
  z: number;
  /** dove si trova il giocatore sul grafo: per far nascere qualcuno sulla sua strada */
  edge: number;
  dir: Dir;
  s: number;
}

export class NpcCrowd {
  readonly npcs: Npc[];
  private readonly rand: () => number;
  private readonly physics: PhysicsParams = { massKg: 78, cda: 0.36, crr: 0.0045, ...STANDARD_AIR };
  private spawnClock = 0;

  constructor(
    readonly graph: WorldGraph,
    count: number,
    seed = 20261102,
  ) {
    this.rand = rng(seed);
    this.npcs = Array.from({ length: count }, (_, slot) => ({
      slot,
      active: false,
      edge: 0,
      dir: 1 as Dir,
      s: 0,
      v: 0,
      wkg: 2.5,
      mass: 75,
      cadence: 85,
      lane: 1,
      x: 0,
      y: -9999,
      z: 0,
      heading: 0,
      grade: 0,
    }));
  }

  /** Avanza tutti di dt secondi; fa nascere e sparire i ciclisti intorno a chi guarda. */
  update(dt: number, viewer: Viewer): void {
    this.spawnClock -= dt;
    for (const n of this.npcs) {
      if (!n.active) continue;
      this.advance(n, dt);
      if (Math.hypot(n.x - viewer.x, n.z - viewer.z) > 2600) n.active = false;
    }
    if (this.spawnClock <= 0) {
      this.spawnClock = 0.5;
      const free = this.npcs.find((n) => !n.active);
      if (free) this.spawn(free, viewer);
    }
  }

  private spawn(n: Npc, viewer: Viewer): void {
    const r = this.rand;
    const g = this.graph;
    // metà nasce sulla strada del giocatore, avanti o dietro; l'altra metà sulle strade intorno
    let edge = viewer.edge;
    let s = viewer.s + (r() < 0.6 ? 1 : -1) * (120 + r() * 900) * viewer.dir;
    let dir: Dir = r() < 0.72 ? viewer.dir : ((-viewer.dir) as Dir);
    if (r() < 0.5 || s < 0 || s > g.edges[edge].length) {
      const a = r() * Math.PI * 2;
      const d = 300 + r() * 1500;
      const near = [...g.edgesNear(viewer.x + Math.cos(a) * d, viewer.z + Math.sin(a) * d, 150)].filter((id) => g.edges[id].cls <= CLS.residential && !(g.edges[id].flags & FLAG.tunnel));
      if (near.length === 0) return;
      edge = near[Math.floor(r() * near.length)];
      s = r() * g.edges[edge].length;
      dir = r() < 0.5 ? 1 : -1;
    }
    if (!g.allowed(edge, dir)) dir = (-dir) as Dir;
    if (!g.allowed(edge, dir)) return;
    const e = g.edges[edge];
    n.edge = edge;
    n.dir = dir;
    n.s = Math.min(e.length, Math.max(0, s));
    n.wkg = 1.8 + r() * 2.1;
    n.mass = 62 + r() * 24;
    n.v = 6 + r() * 3;
    n.cadence = 78 + r() * 18;
    n.lane = 0.6 + r() * 0.9;
    n.active = true;
    this.place(n);
    if (Math.hypot(n.x - viewer.x, n.z - viewer.z) < 60) n.active = false;
  }

  private advance(n: Npc, dt: number): void {
    const g = this.graph;
    const watts = n.wkg * n.mass;
    this.physics.massKg = n.mass + 8.5;
    // in discesa non si pedala e si frena prima delle curve: tetto a 55 km/h
    const power = n.grade < -0.04 ? 0 : watts;
    n.v = Math.min(15.3, stepSpeed(power, n.v, n.grade, dt, this.physics));
    let left = n.v * dt;
    for (let guard = 0; guard < 4 && left > 0; guard++) {
      const e = g.edges[n.edge];
      const room = n.dir > 0 ? e.length - n.s : n.s;
      if (left < room) {
        n.s += left * n.dir;
        left = 0;
        break;
      }
      left -= room;
      const next = this.choose(n.edge, n.dir);
      n.edge = next.edge;
      n.dir = next.dir;
      n.s = next.dir > 0 ? 0 : g.edges[next.edge].length;
    }
    this.place(n);
  }

  private choose(edge: number, dir: Dir): { edge: number; dir: Dir } {
    const g = this.graph;
    const opts = g.options(edge, dir);
    if (opts.length === 1) return opts[0];
    let total = 0;
    const w = opts.map((o) => {
      const e = g.edges[o.edge];
      const k = (o.uTurn ? 0.02 : Math.exp(-Math.abs(o.turn) / 50)) * (e.cls <= CLS.tertiary ? 1.6 : e.cls === CLS.cycleway ? 1.3 : e.cls === CLS.pedestrian ? 0.3 : 1);
      total += k;
      return k;
    });
    let pick = this.rand() * total;
    for (let i = 0; i < opts.length; i++) {
      pick -= w[i];
      if (pick <= 0) return opts[i];
    }
    return opts[opts.length - 1];
  }

  private place(n: Npc): void {
    const p = this.graph.pose(n.edge, n.s, n.dir);
    const hw = this.graph.edges[n.edge].hw;
    const lane = -Math.max(0.2, Math.min(hw - 0.5, hw - n.lane));
    n.x = p.x + Math.cos(p.heading) * lane;
    n.z = p.z - Math.sin(p.heading) * lane;
    n.y = p.y;
    n.heading = p.heading;
    n.grade = p.grade;
  }
}

/**
 * Scia: chi sta da 1,5 a 8 m dietro un altro ciclista, nella stessa direzione e quasi sulla
 * stessa linea, risparmia fino al 30% di resistenza dell'aria. Ritorna il fattore sul CdA.
 */
export function draftFactor(me: { x: number; z: number; heading: number }, others: Iterable<{ x: number; z: number; heading: number }>): number {
  const fx = Math.sin(me.heading);
  const fz = Math.cos(me.heading);
  let best = 1;
  for (const o of others) {
    const dx = o.x - me.x;
    const dz = o.z - me.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < 1.2 || ahead > 9) continue;
    const side = Math.abs(dx * fz - dz * fx);
    if (side > 1.4) continue;
    if (Math.cos(o.heading - me.heading) < 0.85) continue;
    const k = 0.7 + 0.3 * Math.max(0, (ahead - 1.5) / 7.5);
    best = Math.min(best, k);
  }
  return best;
}
