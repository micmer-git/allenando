import type { SourceUpdate, TelemetrySource, TrainerSnapshot } from './source';

/** Fisiologia finta: la potenza insegue il target, FC e cadenza hanno inerzia. */
export class SimulatorSource implements TelemetrySource {
  readonly mode = 'simulator' as const;
  power = 0;
  hr = 60;
  cadence = 0;
  private t = 0;
  private listeners = new Set<() => void>();

  snapshot(): TrainerSnapshot {
    return {
      mode: 'simulator',
      deviceName: null,
      services: { ftms: false, power: false, hr: false, csc: false },
      control: 'none',
      simulation: 'none',
      status: 'idle',
      busy: false,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(input: SourceUpdate): void {
    const target = input.erg && input.targetPower != null ? input.targetPower : input.effort * input.ftp;
    const tau = input.erg ? 2.2 : 1.3;
    const wobble = input.erg
      ? Math.sin(this.t * 2.1) * 4 + Math.sin(this.t * 5.3) * 2
      : Math.sin(this.t * 0.65) * target * 0.035;
    const desired = Math.max(0, target + wobble);
    const k = 1 - Math.exp(-input.dt / tau);
    this.power += (desired - this.power) * k;
    if (this.power < 0.5) this.power = 0;

    const intensity = input.ftp > 0 ? this.power / input.ftp : 0;
    const frac = Math.min(1, Math.max(0, 0.32 + 0.53 * intensity));
    const hrTarget = input.restHr + (input.maxHr - input.restHr) * frac;
    const hk = 1 - Math.exp(-input.dt / 18);
    this.hr += (hrTarget - this.hr) * hk;

    const cadTarget = this.power < 15 ? 0 : 78 + Math.min(22, intensity * 14) + Math.sin(this.t * 0.45) * 3;
    const ck = 1 - Math.exp(-input.dt / 2.2);
    this.cadence += (cadTarget - this.cadence) * ck;
    if (this.cadence < 1) this.cadence = 0;
    this.t += input.dt;
  }

  useSimulator(): Promise<void> {
    return Promise.resolve();
  }

  connectBluetooth(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): void {
    /* il simulatore non ha una periferica */
  }
}
