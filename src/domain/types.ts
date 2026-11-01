export type Locale = 'it';
export type ThemeMode = 'dark' | 'light';
export type Quality = 'low' | 'medium' | 'high';
export type TssSource = 'power' | 'hr' | 'file' | 'none';
export type ActivitySourceKind = 'indoor' | 'import';
export type ImportFileType = 'fit' | 'tcx' | 'gpx';

export interface Profile {
  name: string;
  ftp: number;
  weightKg: number;
  maxHr: number;
  restingHr: number;
  /** Soglia cardiaca misurata. Se assente si stima dall'89% della FC max. */
  thresholdHr?: number;
  bikeWeightKg: number;
  /** Area di resistenza aerodinamica, m². */
  cda: number;
  /** Coefficiente di resistenza al rotolamento. */
  crr: number;
  onboarded: boolean;
}

export interface Settings {
  theme: ThemeMode;
  camilla: boolean;
  quality: Quality;
  locale: Locale;
  /** ISO timestamp se un timer del sonno è aperto. */
  activeSleepStart: string | null;
}

export interface RideSample {
  /** Secondi dall'inizio del giro. */
  t: number;
  power: number;
  hr: number;
  cadence: number;
  /** m/s */
  speed: number;
  /** metri cumulati */
  distance: number;
  altitude: number;
  /** frazione (0.05 = 5%) */
  grade: number;
}

export interface Ride {
  id: string;
  name: string;
  sport: string;
  source: ActivitySourceKind;
  fileType?: ImportFileType;
  startTime: string;
  durationSec: number;
  distanceM: number;
  elevationGainM: number;
  avgPower?: number;
  maxPower?: number;
  np?: number;
  intensityFactor?: number;
  tss?: number;
  tssSource: TssSource;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  avgSpeed?: number;
  kcal?: number;
  powerZoneSec: number[];
  hrZoneSec: number[];
  withCamilla: boolean;
  workoutId?: string;
  workoutName?: string;
  ftp: number;
  samples: RideSample[];
}

export interface SleepSession {
  id: string;
  start: string;
  end: string;
  note?: string;
}

export interface WorkoutStep {
  id: string;
  name?: string;
  durationSec: number;
  /** Percentuale di FTP. Ignorata se powerWatts è definito. */
  powerPct?: number;
  powerEndPct?: number;
  powerWatts?: number;
  powerEndWatts?: number;
}

export type WorkoutKind =
  | 'endurance'
  | 'sweetspot'
  | 'vo2'
  | 'threshold'
  | 'ramp'
  | 'opener'
  | 'custom';

export interface Workout {
  id: string;
  nameKey?: string;
  descriptionKey?: string;
  name?: string;
  description?: string;
  builtin: boolean;
  kind: WorkoutKind;
  ftpTest?: boolean;
  steps: WorkoutStep[];
}

export const DEFAULT_PROFILE: Profile = {
  name: '',
  ftp: 220,
  weightKg: 78,
  maxHr: 186,
  restingHr: 52,
  bikeWeightKg: 8.5,
  cda: 0.32,
  crr: 0.004,
  onboarded: false,
};

/** Limiti dei numeri del profilo: fuori da qui è quasi sempre un errore di battitura. */
export const PROFILE_LIMITS = {
  weightKg: [35, 180],
  ftp: [50, 550],
  maxHr: [120, 230],
  restingHr: [30, 110],
  thresholdHr: [90, 220],
  bikeWeightKg: [3, 40],
  cda: [0.15, 0.7],
  crr: [0.001, 0.02],
} as const satisfies Record<string, readonly [number, number]>;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  camilla: true,
  quality: 'medium',
  locale: 'it',
  activeSleepStart: null,
};
