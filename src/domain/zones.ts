export interface ZoneBand {
  zone: number;
  minPct: number;
  maxPct: number;
  color: string;
  nameKey: string;
}

/** Zone di potenza di Coggan, in frazione di FTP. L'estremo superiore è escluso, tranne la zona 6 che include il 150%. */
export const POWER_ZONES: ZoneBand[] = [
  { zone: 1, minPct: 0, maxPct: 0.55, color: '#7eb6ff', nameKey: 'zones.p1' },
  { zone: 2, minPct: 0.55, maxPct: 0.76, color: '#3dbe8a', nameKey: 'zones.p2' },
  { zone: 3, minPct: 0.76, maxPct: 0.91, color: '#e6c84a', nameKey: 'zones.p3' },
  { zone: 4, minPct: 0.91, maxPct: 1.06, color: '#f0943a', nameKey: 'zones.p4' },
  { zone: 5, minPct: 1.06, maxPct: 1.21, color: '#ef5d3a', nameKey: 'zones.p5' },
  { zone: 6, minPct: 1.21, maxPct: 1.5, color: '#e23b78', nameKey: 'zones.p6' },
  { zone: 7, minPct: 1.5, maxPct: Number.POSITIVE_INFINITY, color: '#b45cff', nameKey: 'zones.p7' },
];

/**
 * Zone di frequenza di Friel, abbinate alle 7 zone di Coggan.
 * Percentuale della soglia cardiaca (LTHR), non della FC max.
 */
export const HR_ZONES: ZoneBand[] = [
  { zone: 1, minPct: 0, maxPct: 0.81, color: '#7eb6ff', nameKey: 'zones.h1' },
  { zone: 2, minPct: 0.81, maxPct: 0.9, color: '#3dbe8a', nameKey: 'zones.h2' },
  { zone: 3, minPct: 0.9, maxPct: 0.94, color: '#e6c84a', nameKey: 'zones.h3' },
  { zone: 4, minPct: 0.94, maxPct: 1, color: '#f0b429', nameKey: 'zones.h4' },
  { zone: 5, minPct: 1, maxPct: 1.03, color: '#f0943a', nameKey: 'zones.h5' },
  { zone: 6, minPct: 1.03, maxPct: 1.07, color: '#ef5d3a', nameKey: 'zones.h6' },
  { zone: 7, minPct: 1.07, maxPct: Number.POSITIVE_INFINITY, color: '#e23b78', nameKey: 'zones.h7' },
];

export function powerZoneIndex(watts: number, ftp: number): number {
  if (!(ftp > 0)) return 1;
  const pct = Math.max(0, watts) / ftp;
  if (pct < 0.55) return 1;
  if (pct < 0.76) return 2;
  if (pct < 0.91) return 3;
  if (pct < 1.06) return 4;
  if (pct < 1.21) return 5;
  if (pct <= 1.5) return 6;
  return 7;
}

export function hrZoneIndex(hr: number, lthr: number): number {
  if (!(lthr > 0) || !(hr > 0)) return 1;
  const pct = hr / lthr;
  if (pct < 0.81) return 1;
  if (pct < 0.9) return 2;
  if (pct < 0.94) return 3;
  if (pct < 1) return 4;
  if (pct < 1.03) return 5;
  if (pct < 1.07) return 6;
  return 7;
}

export function powerZone(watts: number, ftp: number): ZoneBand {
  return POWER_ZONES[powerZoneIndex(watts, ftp) - 1];
}

export function hrZone(hr: number, lthr: number): ZoneBand {
  return HR_ZONES[hrZoneIndex(hr, lthr) - 1];
}

/** Stima della soglia cardiaca quando non è stata misurata. */
export function estimateLthr(maxHr: number, explicit?: number): number {
  if (explicit != null && explicit > 0) return explicit;
  if (!(maxHr > 0)) return 160;
  return Math.round(maxHr * 0.89);
}

export function zoneRangeLabel(zone: ZoneBand, anchor: number): string {
  if (!Number.isFinite(zone.maxPct)) return `> ${Math.round(zone.minPct * anchor)}`;
  const lo = Math.round(zone.minPct * anchor);
  const hi = Math.round(zone.maxPct * anchor);
  return `${lo}–${hi}`;
}
