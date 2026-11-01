const numberLocale = 'it-IT';

export function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '–';
  return new Intl.NumberFormat(numberLocale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function formatKm(meters: number): string {
  const km = meters / 1000;
  return formatNumber(km, km < 10 ? 2 : 1);
}

export function formatKmValue(km: number): string {
  return formatNumber(km, Math.abs(km) < 10 ? 2 : 1);
}

export function msToKmh(ms: number): number {
  return ms * 3.6;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(numberLocale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return new Intl.DateTimeFormat(numberLocale, { weekday: 'short', day: 'numeric' }).format(date);
}

export function formatGrade(fraction: number): string {
  const pct = fraction * 100;
  const body = formatNumber(Math.abs(pct), 1);
  if (pct > 0.05) return `+${body}%`;
  if (pct < -0.05) return `−${body}%`;
  return `${body}%`;
}

export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
