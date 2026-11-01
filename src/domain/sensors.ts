/** Cycling Power, Heart Rate e CSC: parsing dei pacchetti BLE. */

export interface CyclingPowerReading {
  power: number;
  crankRevs?: number;
  crankTime?: number;
  wheelRevs?: number;
  wheelTime?: number;
}

export interface CrankPoint {
  revs: number;
  /** Tempo dell'ultimo evento, in unità di 1/1024 s (uint16). */
  time: number;
}

export function parseCyclingPower(view: DataView): CyclingPowerReading | null {
  if (view.byteLength < 4) return null;
  const flags = view.getUint16(0, true);
  let o = 2;
  const power = view.getInt16(o, true);
  o += 2;
  const reading: CyclingPowerReading = { power };
  if (flags & 0x0001) o += 1;
  if (flags & 0x0004) o += 2;
  if (flags & 0x0010) {
    if (o + 6 > view.byteLength) return reading;
    reading.wheelRevs = view.getUint32(o, true);
    reading.wheelTime = view.getUint16(o + 4, true);
    o += 6;
  }
  if (flags & 0x0020) {
    if (o + 4 > view.byteLength) return reading;
    reading.crankRevs = view.getUint16(o, true);
    reading.crankTime = view.getUint16(o + 2, true);
  }
  return reading;
}

export function parseHeartRate(view: DataView): number | null {
  if (view.byteLength < 2) return null;
  const flags = view.getUint8(0);
  if (flags & 0x01) {
    if (view.byteLength < 3) return null;
    return view.getUint16(1, true);
  }
  return view.getUint8(1);
}

export interface CscReading {
  wheelRevs?: number;
  wheelTime?: number;
  crankRevs?: number;
  crankTime?: number;
}

export function parseCsc(view: DataView): CscReading | null {
  if (view.byteLength < 1) return null;
  const flags = view.getUint8(0);
  let o = 1;
  const out: CscReading = {};
  if (flags & 0x01) {
    if (o + 6 > view.byteLength) return out;
    out.wheelRevs = view.getUint32(o, true);
    out.wheelTime = view.getUint16(o + 4, true);
    o += 6;
  }
  if (flags & 0x02) {
    if (o + 4 > view.byteLength) return out;
    out.crankRevs = view.getUint16(o, true);
    out.crankTime = view.getUint16(o + 2, true);
  }
  return out;
}

/** Cadenza (rpm) fra due campioni di pedivella. Gestisce l'overflow a 16 bit. */
export function cadenceFromCrank(prev: CrankPoint | undefined, next: CrankPoint): number | undefined {
  if (!prev) return undefined;
  let dRevs = next.revs - prev.revs;
  if (dRevs < 0) dRevs += 65536;
  let dTime = next.time - prev.time;
  if (dTime < 0) dTime += 65536;
  if (dTime === 0 || dRevs <= 0) return undefined;
  const rpm = (dRevs / (dTime / 1024)) * 60;
  if (rpm < 0 || rpm > 250) return undefined;
  return rpm;
}
