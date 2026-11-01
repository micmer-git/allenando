export interface DayLoad {
  /** YYYY-MM-DD nel fuso locale. */
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  /** Equilibrio all'inizio della giornata: CTL di ieri − ATL di ieri. */
  tsb: number;
}

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return localDateKey(dt);
}

export function compareDateKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * CTL (42 giorni), ATL (7 giorni) e TSB.
 * Il seme è zero il giorno prima della prima attività.
 */
export function trainingLoad(
  activities: { date: string; tss: number }[],
  today = new Date(),
): DayLoad[] {
  const byDay = new Map<string, number>();
  for (const a of activities) {
    if (!a.date || !(a.tss > 0)) continue;
    byDay.set(a.date, (byDay.get(a.date) ?? 0) + a.tss);
  }
  const todayKey = localDateKey(today);
  let start = todayKey;
  for (const key of byDay.keys()) {
    if (key < start) start = key;
  }
  if (byDay.size === 0) {
    return [{ date: todayKey, tss: 0, ctl: 0, atl: 0, tsb: 0 }];
  }
  const out: DayLoad[] = [];
  let ctl = 0;
  let atl = 0;
  let cursor = start;
  while (cursor <= todayKey) {
    const tss = byDay.get(cursor) ?? 0;
    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    out.push({ date: cursor, tss, ctl, atl, tsb });
    if (cursor === todayKey) break;
    cursor = addDays(cursor, 1);
  }
  return out;
}
