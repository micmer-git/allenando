import type { Workout, WorkoutStep } from '@/domain/types';
import { stepPower } from '@/domain/workouts';

/**
 * Gli archi dell'ERG: in un allenamento, un arco sulla strada all'inizio e alla fine di ogni
 * intervallo di lavoro. L'allenamento va a tempo, la strada a metri: il tempo che manca al
 * cambio diventa distanza con la velocità di adesso. L'arco si ricalcola mentre ci si
 * avvicina e si ferma negli ultimi 50 m, così si vede arrivare e non scappa più.
 */

export interface ErgGate {
  id: string;
  /** secondi dall'inizio dell'allenamento */
  at: number;
  role: 'start' | 'finish';
  label: string;
  sub?: string;
}

const REST = /^(warm|cool|rec|rest|easy|spin|z2)/;

/** Un passo è di lavoro se non è riscaldamento, fondo o recupero e chiede almeno il 75% della FTP. */
export function isWorkStep(step: WorkoutStep, ftp: number): boolean {
  if (REST.test(step.name ?? '')) return false;
  const a = stepPower(step, 0, ftp);
  const b = stepPower(step, step.durationSec, ftp);
  return ftp > 0 && (a + b) / 2 >= 0.75 * ftp;
}

/** «5′», «30″», «1′30″»: la durata scritta come sui cartelli degli allenamenti. */
export function shortDuration(sec: number): string {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}″`;
  return r ? `${m}′${String(r).padStart(2, '0')}″` : `${m}′`;
}

/** Le porte dell'allenamento: inizio e fine di ogni blocco di lavoro (passi di lavoro di fila = un blocco). */
export function ergGates(workout: Workout, ftp: number): ErgGate[] {
  const out: ErgGate[] = [];
  let t = 0;
  let i = 0;
  const steps = workout.steps;
  while (i < steps.length) {
    if (!isWorkStep(steps[i], ftp)) {
      t += steps[i].durationSec;
      i++;
      continue;
    }
    const t0 = t;
    let lo = Infinity;
    let hi = 0;
    let j = i;
    while (j < steps.length && isWorkStep(steps[j], ftp)) {
      const a = stepPower(steps[j], 0, ftp);
      const b = stepPower(steps[j], steps[j].durationSec, ftp);
      lo = Math.min(lo, a, b);
      hi = Math.max(hi, a, b);
      t += steps[j].durationSec;
      j++;
    }
    const watts = Math.round(hi) - Math.round(lo) < 5 ? `${Math.round(lo)} W` : `${Math.round(lo)}–${Math.round(hi)} W`;
    out.push({ id: `${i}:start`, at: t0, role: 'start', label: `${shortDuration(t - t0)} · ${watts}`, sub: 'Intervallo' });
    const next = steps[j];
    out.push({ id: `${i}:finish`, at: t, role: 'finish', label: 'Fine', sub: next ? `Poi ${Math.round(stepPower(next, 0, ftp))} W` : 'Allenamento finito' });
    i = j;
  }
  return out;
}

/** Dove sta l'arco dell'ERG che viene: lo tiene aggiornato fotogramma per fotogramma. */
export class ErgArchPlanner {
  private i = 0;
  private d: number | null = null;
  private frozen = false;
  private v = 0;

  constructor(
    readonly gates: ErgGate[],
    /** oltre questa distanza l'arco non si mette: non si vedrebbe, e balla con la velocità */
    private readonly horizon = 2000,
    /** negli ultimi metri l'arco si ferma */
    private readonly freezeAt = 50,
  ) {}

  /** La porta che viene e i suoi metri sul percorso, o null. */
  update(elapsed: number, distance: number, speed: number, dt: number): { gate: ErgGate; d: number } | null {
    // velocità lisciata su qualche secondo, mai sotto 3 m/s: da fermi l'arco non viene addosso
    this.v = this.v === 0 ? speed : this.v + (speed - this.v) * Math.min(1, dt / 4);
    const v = Math.max(3, this.v);
    for (;;) {
      const g = this.gates[this.i];
      if (!g) return null;
      // passata sotto l'arco, o il cambio è passato da un pezzo: la porta dopo
      const passed = this.d != null && distance >= this.d;
      if (passed || elapsed > g.at + 15) {
        this.i++;
        this.d = null;
        this.frozen = false;
        continue;
      }
      break;
    }
    const gate = this.gates[this.i];
    if (!this.frozen) {
      const ahead = Math.max(0, gate.at - elapsed) * v;
      if (ahead > this.horizon) {
        this.d = null;
        return null;
      }
      this.d = distance + ahead;
      if (ahead <= this.freezeAt) this.frozen = true;
    }
    return this.d == null ? null : { gate, d: this.d };
  }
}
