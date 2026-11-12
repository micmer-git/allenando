import { stepSpeed, type PhysicsParams } from './physics';
import type { Workout } from './types';
import { workoutPowerSeries } from './workouts';

/**
 * Quanto dura un giro (A14 del piano U): la stessa fisica del motore (`stepSpeed`) sul profilo,
 * a watt costanti, senza scia né vento. Serve a proporre i giri di un allenamento su un anello.
 */

/** Il tetto dei passaggi: oltre, si prosegue libero. */
export const GIRI_TETTO = 20;
/** passo d'integrazione, secondi */
const DT = 0.25;

export function stimaSecondi(profilo: { distance: number; altitude: number }[], watt: number, fisica: PhysicsParams): number {
  if (profilo.length < 2 || !(watt > 0)) return 0;
  const end = profilo[profilo.length - 1].distance;
  let d = profilo[0].distance;
  let v = 0;
  let t = 0;
  let i = 0;
  // un giorno di pedalata è il limite: una stima più lunga non serve a nessuno
  while (d < end && t < 86_400) {
    while (i < profilo.length - 2 && profilo[i + 1].distance <= d) i++;
    const a = profilo[i];
    const b = profilo[i + 1];
    const grade = (b.altitude - a.altitude) / Math.max(1, b.distance - a.distance);
    // a passo d'uomo anche sui muri: la stima non resta ferma
    v = Math.max(0.5, stepSpeed(watt, v, grade, DT, fisica));
    d += v * DT;
    t += DT;
  }
  return t;
}

/** I watt medi di un allenamento: la media pesata nel tempo dei bersagli. */
export function wattMedi(w: Workout, ftp: number): number {
  const s = workoutPowerSeries(w, ftp);
  return s.length ? s.reduce((a, p) => a + p, 0) / s.length : 0;
}

/** I giri che servono a coprire la durata: per eccesso, da 1 a 20. */
export function giriPer(durataSec: number, giroSec: number): number {
  if (!(durataSec > 0) || !(giroSec > 0)) return 1;
  return Math.min(GIRI_TETTO, Math.max(1, Math.ceil(durataSec / giroSec - 1e-9)));
}
