export type TrainerMode = 'simulator' | 'bluetooth';

export interface SourceUpdate {
  dt: number;
  grade: number;
  /** Watt obiettivo ERG, oppure null in pedalata libera. */
  targetPower: number | null;
  effort: number;
  ftp: number;
  maxHr: number;
  restHr: number;
  erg: boolean;
  crr: number;
  cw: number;
}

export interface TrainerServices {
  ftms: boolean;
  power: boolean;
  hr: boolean;
  csc: boolean;
}

export interface TrainerSnapshot {
  mode: TrainerMode;
  deviceName: string | null;
  services: TrainerServices;
  control: 'none' | 'granted' | 'denied' | 'unsupported';
  simulation: 'none' | 'active' | 'unsupported';
  status: 'idle' | 'connecting' | 'connected' | 'cancelled' | 'failed' | 'disconnected';
  busy: boolean;
}

/**
 * Sorgente di potenza, FC e cadenza. Il simulatore e il Web Bluetooth
 * implementano la stessa interfaccia, così il motore di gioco non distingue.
 */
export interface TelemetrySource {
  readonly mode: TrainerMode;
  power: number;
  hr: number;
  cadence: number;
  snapshot(): TrainerSnapshot;
  subscribe(listener: () => void): () => void;
  update(input: SourceUpdate): void;
  /** Sforzo del ciclista virtuale, 0–1.6 della FTP. Solo simulatore. */
  setEffort?(effort: number): void;
  useSimulator(): Promise<void>;
  connectBluetooth(acceptAll: boolean): Promise<void>;
  disconnect(): void;
}
