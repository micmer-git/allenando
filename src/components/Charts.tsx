import type { DayLoad } from '@/domain/load';
import { formatDayLabel, formatNumber } from '@/domain/format';
import type { ZoneBand } from '@/domain/zones';

export function LineChart({
  values,
  color,
  height = 112,
  fill = true,
}: {
  values: number[];
  color: string;
  height?: number;
  fill?: boolean;
}) {
  if (values.length < 2) return null;
  const width = 320;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const coords = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 8) - 4;
    return [x, y] as const;
  });
  const d = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img">
      {fill ? <path d={area} fill={color} opacity="0.18" /> : null}
      <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ZoneBar({ seconds, zones }: { seconds: number[]; zones: ZoneBand[] }) {
  const total = seconds.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-elev2">
      {zones.map((zone, index) => {
        const value = seconds[index] ?? 0;
        if (value <= 0) return null;
        return (
          <div
            key={zone.zone}
            style={{ width: `${(value / total) * 100}%`, background: zone.color }}
            title={zone.nameKey}
          />
        );
      })}
    </div>
  );
}

export function Columns({
  values,
  labels,
  color,
}: {
  values: number[];
  labels: string[];
  color: string;
}) {
  const max = Math.max(...values, 1);
  return (
    <div className="grid grid-cols-7 items-end gap-2" data-testid="sleep-chart">
      {values.map((value, index) => (
        <div key={labels[index] ?? index} className="flex flex-col items-center gap-2">
          <div className="flex h-28 w-full items-end">
            <div
              className="w-full rounded-t-xl"
              style={{
                height: `${Math.max(6, (value / max) * 100)}%`,
                background: value > 0 ? color : 'var(--elev2)',
                opacity: value > 0 ? 1 : 0.7,
              }}
            />
          </div>
          <span className="text-[11px] uppercase tracking-wide text-muted">{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}

export function LoadChart({ days }: { days: DayLoad[] }) {
  const slice = days.slice(-42);
  const width = 360;
  const height = 180;
  const max = Math.max(...slice.flatMap((day) => [day.ctl, day.atl, Math.abs(day.tsb), day.tss]), 1);
  const x = (index: number) => (slice.length <= 1 ? width / 2 : (index / (slice.length - 1)) * width);
  const y = (value: number) => height - 16 - (value / max) * (height - 32);
  const path = (pick: (day: DayLoad) => number) =>
    slice.map((day, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(pick(day)).toFixed(1)}`).join(' ');
  const zero = y(0);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full" data-testid="load-chart" role="img">
      {slice.map((day, index) => (
        <rect
          key={day.date}
          x={x(index) - 3}
          y={y(day.tss)}
          width={6}
          height={Math.max(0, zero - y(day.tss))}
          fill="var(--accent)"
          opacity="0.35"
          rx="1.5"
        />
      ))}
      <path d={path((day) => day.ctl)} fill="none" stroke="#7eb6ff" strokeWidth="2.4" />
      <path d={path((day) => day.atl)} fill="none" stroke="#f0943a" strokeWidth="2.4" />
      <path d={path((day) => day.tsb)} fill="none" stroke="#3dbe8a" strokeWidth="2.2" strokeDasharray="4 3" />
      <text x="0" y="12" fill="currentColor" fontSize="11" opacity="0.7">
        {formatNumber(max, 0)}
      </text>
      <text x="8" y={height - 2} fill="currentColor" fontSize="11" opacity="0.7">
        {formatDayLabel(slice[0]?.date ?? '')}
      </text>
      <text x={width - 8} y={height - 2} fill="currentColor" fontSize="11" opacity="0.7" textAnchor="end">
        {formatDayLabel(slice[slice.length - 1]?.date ?? '')}
      </text>
    </svg>
  );
}
