import { STANDARD_AIR, stepSpeed, type PhysicsParams } from '@/domain/physics';
import type { Track } from '@/domain/track';

/**
 * Il gruppo di una sessione: ciclisti virtuali che pedalano lo stesso percorso a passo
 * costante (W/kg dichiarati), con la fisica vera di ognuno. In salita rallentano, in discesa
 * smettono di spingere oltre i 55 km/h, in pianura stanno compatti. Il capogruppo tiene il
 * passo; gli altri gli stanno in scia a qualche metro, su due file.
 */

export interface Pacer {
  id: string;
  name: string;
  color: string;
  /** metri sul percorso */
  d: number;
  v: number;
  power: number;
  /** scostamento laterale (metri a sinistra) e ritardo sul capogruppo */
  lane: number;
  gap: number;
}

const NAMES = ['Capogruppo', 'Bepi', 'Gigi', 'Marta', 'Ste', 'Chiara', 'Lollo', 'Fede', 'Giò', 'Ale'];
const COLORS = ['#3ce0b0', '#ffc814', '#ff6b4a', '#4ab8ff', '#f4f4f0', '#c77dff', '#ff9f1c', '#2a7fd4', '#d6267a', '#8fd1c4'];

export class PacerPack {
  pacers: Pacer[] = [];
  /** il gruppo è partito */
  started = false;
  private readonly params: PhysicsParams;
  private leaderV = 0;

  constructor(
    readonly track: Track,
    readonly wkg: number,
    size = 7,
    readonly massKg = 72,
  ) {
    this.params = { massKg: massKg + 8.5, cda: 0.3, crr: 0.0042, ...STANDARD_AIR };
    for (let i = 0; i < size; i++) {
      // due file: dispari a sinistra, pari a destra; ogni coppia un metro e mezzo più indietro
      const row = Math.floor((i + 1) / 2);
      this.pacers.push({
        id: `pacer-${i}`,
        name: i === 0 ? `${NAMES[0]} · ${wkg.toFixed(1).replace('.', ',')} W/kg` : NAMES[i % NAMES.length],
        color: COLORS[i % COLORS.length],
        d: -row * 1.9,
        v: 0,
        power: 0,
        lane: i === 0 ? 0 : i % 2 ? 0.55 : -0.55,
        gap: row * 1.9,
      });
    }
  }

  /** Il centro del gruppo, in metri sul percorso. */
  get center(): number {
    if (!this.pacers.length) return 0;
    let s = 0;
    for (const p of this.pacers) s += p.d;
    return s / this.pacers.length;
  }

  get leader(): Pacer {
    return this.pacers[0];
  }

  /** Avanza di dt secondi. Prima del via resta fermo in griglia. */
  step(dt: number): void {
    if (!this.started || dt <= 0) return;
    const L = this.pacers[0];
    const end = this.track.length;
    const pose = this.track.poseAt(Math.max(0, Math.min(end, L.d)));
    // in discesa ripida si smette di spingere; in salita un 8% in più (come fa chiunque)
    const target = this.wkg * this.massKg * (pose.grade > 0.05 ? 1.08 : pose.grade < -0.04 ? 0.25 : 1);
    L.power += (target - L.power) * Math.min(1, dt * 1.5);
    this.leaderV = Math.min(15.3, stepSpeed(L.power, this.leaderV, pose.grade, dt, this.params));
    L.v = this.leaderV;
    L.d = Math.min(end, L.d + L.v * dt);
    for (let i = 1; i < this.pacers.length; i++) {
      const p = this.pacers[i];
      // ognuno insegue il suo posto dietro al capogruppo, con un po' di elastico
      const want = L.d - p.gap;
      const err = want - p.d;
      p.v = Math.max(0, L.v + Math.max(-2, Math.min(2, err * 0.6)));
      p.d = Math.min(end, p.d + p.v * dt);
      p.power = L.power * 0.72;
    }
  }

  /** Posa di un ciclista del gruppo, con la sua fila. */
  pose(p: Pacer): { x: number; y: number; z: number; heading: number; grade: number; v: number; idle: boolean } {
    const d = Math.max(0, Math.min(this.track.length, p.d));
    const q = this.track.poseAt(d);
    // si tiene la destra come il giocatore: a destra dell'asse di poco più di un metro
    const lane = -1.1 + p.lane;
    return { x: q.x + Math.cos(q.heading) * lane, y: q.y, z: q.z - Math.sin(q.heading) * lane, heading: q.heading, grade: q.grade, v: p.v, idle: !this.started };
  }

  /** Distanza dal centro del gruppo (positiva: sei davanti). */
  gapTo(distance: number): number {
    return distance - this.center;
  }

  /** Scia del gruppo: CdA ridotto fino al 35% se sei dentro o subito dietro. */
  draft(distance: number): number {
    let best = 1;
    for (const p of this.pacers) {
      const behind = p.d - distance;
      if (behind > 0.5 && behind < 12) {
        const f = 1 - 0.35 * Math.max(0, 1 - (behind - 0.5) / 11.5);
        best = Math.min(best, f);
      }
    }
    // in mezzo al gruppo si sta meglio che dietro a uno solo
    const inside = this.pacers.filter((p) => Math.abs(p.d - distance) < 6).length;
    return inside >= 3 ? Math.min(best, 0.62) : best;
  }
}
