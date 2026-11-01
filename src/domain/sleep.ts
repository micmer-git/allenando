import { addDays, localDateKey } from './load';

export interface SleepSpan {
  start: string;
  end: string;
}

/** Secondi di sonno che cadono nel giorno locale `day` (YYYY-MM-DD), anche a cavallo della mezzanotte. */
export function sleepSecondsOnDay(sessions: SleepSpan[], day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const from = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
  const to = from + 24 * 3600 * 1000;
  let total = 0;
  for (const s of sessions) {
    const a = new Date(s.start).getTime();
    const b = new Date(s.end).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const lo = Math.max(a, from);
    const hi = Math.min(b, to);
    if (hi > lo) total += (hi - lo) / 1000;
  }
  return total;
}

export interface SleepDay {
  date: string;
  seconds: number;
}

export function sleepWeek(sessions: SleepSpan[], today = new Date()): SleepDay[] {
  const end = localDateKey(today);
  const start = addDays(end, -6);
  const days: SleepDay[] = [];
  let cursor = start;
  for (let i = 0; i < 7; i++) {
    days.push({ date: cursor, seconds: sleepSecondsOnDay(sessions, cursor) });
    cursor = addDays(cursor, 1);
  }
  return days;
}
