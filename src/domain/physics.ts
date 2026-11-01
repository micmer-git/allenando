/**
 * Modello di potenza della bicicletta (Martin et al. / equazione resistiva classica).
 *
 *  P * η = F(v) * v
 *  F = Crr·m·g·cosθ + ½·CdA·ρ·v² + m·g·sinθ
 *
 * θ = arctan(pendenza), con pendenza = dislivello / distanza orizzontale.
 * Nessun drafting. L'inerzia rotazionale entra solo nell'accelerazione.
 */

export interface PhysicsParams {
  /** Massa ciclista + bici, kg. */
  massKg: number;
  /** CdA, m². */
  cda: number;
  crr: number;
  /** Densità dell'aria, kg/m³. */
  rho: number;
  g: number;
  /** Rendimento della trasmissione, 0–1. */
  eta: number;
  /** Fattore di massa rotante, applicato solo all'accelerazione. */
  rotatingFactor: number;
}

export const STANDARD_AIR: Pick<PhysicsParams, 'rho' | 'g' | 'eta' | 'rotatingFactor'> = {
  rho: 1.225,
  g: 9.80665,
  eta: 0.975,
  rotatingFactor: 1.03,
};

export function resistiveForce(speedMs: number, grade: number, p: PhysicsParams): number {
  const theta = Math.atan(grade);
  const roll = p.crr * p.massKg * p.g * Math.cos(theta);
  const aero = 0.5 * p.cda * p.rho * speedMs * speedMs;
  const grav = p.massKg * p.g * Math.sin(theta);
  return roll + aero + grav;
}

/** Watt che il ciclista deve spingere per tenere la velocità (regime stazionario). */
export function powerForSpeed(speedMs: number, grade: number, p: PhysicsParams): number {
  if (speedMs <= 0) return 0;
  const eta = p.eta > 0 ? p.eta : 1;
  return (resistiveForce(speedMs, grade, p) * speedMs) / eta;
}

/**
 * Velocità di regime per una potenza costante. Bisezione su
 * ηP − F(v)·v = 0. Ritorna 0 se la potenza non basta a muoversi.
 */
export function steadyStateSpeed(powerW: number, grade: number, p: PhysicsParams): number {
  const power = Math.max(0, powerW);
  const eta = p.eta > 0 ? p.eta : 1;
  const net = (v: number) => eta * power - resistiveForce(v, grade, p) * v;
  if (net(0.02) <= 0) return 0;
  let lo = 0;
  let hi = 45;
  if (net(hi) > 0) return hi;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (net(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Integra la velocità per un passo dt. La forza motrice è limitata a basse
 * velocità per non esplodere quando v → 0 (P/v).
 */
export function stepSpeed(
  powerW: number,
  speedMs: number,
  grade: number,
  dt: number,
  p: PhysicsParams,
): number {
  if (dt <= 0) return Math.max(0, speedMs);
  const v = Math.max(0, speedMs);
  const theta = Math.atan(grade);
  const roll = p.crr * p.massKg * p.g * Math.cos(theta);
  const aero = 0.5 * p.cda * p.rho * v * v;
  const grav = p.massKg * p.g * Math.sin(theta);
  const vForce = Math.max(v, 0.35);
  const eta = p.eta > 0 ? p.eta : 1;
  let drive = (eta * Math.max(0, powerW)) / vForce;
  const maxDrive = p.massKg * 5;
  if (drive > maxDrive) drive = maxDrive;
  const inertia = p.massKg * (p.rotatingFactor > 0 ? p.rotatingFactor : 1);
  const a = (drive - roll - aero - grav) / inertia;
  const next = v + a * dt;
  return next > 0 ? next : 0;
}
