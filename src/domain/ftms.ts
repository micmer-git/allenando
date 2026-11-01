/** Fitness Machine Service — parsing e comandi, senza dipendere dal Web Bluetooth. */

export interface IndoorBikeData {
  speedKmh?: number;
  avgSpeedKmh?: number;
  cadenceRpm?: number;
  avgCadenceRpm?: number;
  distanceM?: number;
  resistance?: number;
  powerW?: number;
  avgPowerW?: number;
  energyKcal?: number;
  heartRate?: number;
  met?: number;
  elapsedSec?: number;
  remainingSec?: number;
}

export interface FtmsFeatures {
  targetPower: boolean;
  simulation: boolean;
}

export interface ControlPointResponse {
  opcode: number;
  result: number;
}

export const FTMS_OP = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetPower: 0x05,
  setSimulation: 0x11,
  response: 0x80,
} as const;

export const FTMS_RESULT_SUCCESS = 0x01;
export const FTMS_RESULT_CONTROL_NOT_PERMITTED = 0x05;

/**
 * Indoor Bike Data (0x2AD2).
 * Il bit 0 dei flag è "More Data": se vale 0 la velocità istantanea è presente.
 */
export function parseIndoorBikeData(view: DataView): IndoorBikeData {
  const out: IndoorBikeData = {};
  if (view.byteLength < 2) return out;
  const flags = view.getUint16(0, true);
  let o = 2;
  const take = (n: number) => {
    if (o + n > view.byteLength) return false;
    return true;
  };
  if ((flags & 0x0001) === 0) {
    if (!take(2)) return out;
    out.speedKmh = view.getUint16(o, true) * 0.01;
    o += 2;
  }
  if (flags & 0x0002) {
    if (!take(2)) return out;
    out.avgSpeedKmh = view.getUint16(o, true) * 0.01;
    o += 2;
  }
  if (flags & 0x0004) {
    if (!take(2)) return out;
    out.cadenceRpm = view.getUint16(o, true) * 0.5;
    o += 2;
  }
  if (flags & 0x0008) {
    if (!take(2)) return out;
    out.avgCadenceRpm = view.getUint16(o, true) * 0.5;
    o += 2;
  }
  if (flags & 0x0010) {
    if (!take(3)) return out;
    out.distanceM = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
    o += 3;
  }
  if (flags & 0x0020) {
    if (!take(2)) return out;
    out.resistance = view.getInt16(o, true) * 0.1;
    o += 2;
  }
  if (flags & 0x0040) {
    if (!take(2)) return out;
    out.powerW = view.getInt16(o, true);
    o += 2;
  }
  if (flags & 0x0080) {
    if (!take(2)) return out;
    out.avgPowerW = view.getInt16(o, true);
    o += 2;
  }
  if (flags & 0x0100) {
    if (!take(5)) return out;
    out.energyKcal = view.getUint16(o, true);
    o += 5;
  }
  if (flags & 0x0200) {
    if (!take(1)) return out;
    out.heartRate = view.getUint8(o);
    o += 1;
  }
  if (flags & 0x0400) {
    if (!take(1)) return out;
    out.met = view.getUint8(o) * 0.1;
    o += 1;
  }
  if (flags & 0x0800) {
    if (!take(2)) return out;
    out.elapsedSec = view.getUint16(o, true);
    o += 2;
  }
  if (flags & 0x1000) {
    if (!take(2)) return out;
    out.remainingSec = view.getUint16(o, true);
  }
  return out;
}

/** Fitness Machine Feature: 4 byte di feature + 4 byte di target setting. */
export function parseFtmsFeatures(view: DataView): FtmsFeatures {
  if (view.byteLength < 8) return { targetPower: false, simulation: false };
  const target = view.getUint32(4, true);
  return {
    targetPower: (target & (1 << 3)) !== 0,
    simulation: (target & (1 << 13)) !== 0,
  };
}

export function encodeRequestControl(): Uint8Array {
  return Uint8Array.of(FTMS_OP.requestControl);
}

export function encodeSetTargetPower(watts: number): Uint8Array {
  const w = clampInt(Math.round(watts), 0, 4000);
  return Uint8Array.of(FTMS_OP.setTargetPower, w & 0xff, (w >> 8) & 0xff);
}

/**
 * Set Indoor Bike Simulation Parameters (opcode 0x11).
 * grade è una frazione (0.05 = 5%). Cw è il coefficiente di resistenza
 * aerodinamica in kg/m (tipicamente CdA · ρ).
 */
export function encodeIndoorBikeSimulation(opts: {
  windSpeedMs?: number;
  grade: number;
  crr: number;
  cw: number;
}): Uint8Array {
  const wind = clampInt(Math.round((opts.windSpeedMs ?? 0) / 0.001), -32768, 32767);
  const grade = clampInt(Math.round((opts.grade * 100) / 0.01), -32768, 32767);
  const crr = clampInt(Math.round(opts.crr / 0.0001), 0, 255);
  const cw = clampInt(Math.round(opts.cw / 0.01), 0, 255);
  const buf = new Uint8Array(7);
  const view = new DataView(buf.buffer);
  buf[0] = FTMS_OP.setSimulation;
  view.setInt16(1, wind, true);
  view.setInt16(3, grade, true);
  buf[5] = crr;
  buf[6] = cw;
  return buf;
}

export function parseControlPointResponse(view: DataView): ControlPointResponse | null {
  if (view.byteLength < 3) return null;
  if (view.getUint8(0) !== FTMS_OP.response) return null;
  return { opcode: view.getUint8(1), result: view.getUint8(2) };
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
