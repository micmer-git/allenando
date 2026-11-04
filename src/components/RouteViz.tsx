import { useEffect, useMemo, useState } from 'react';
import { loadRouteFile, routeMeta, trackFromRouteFile, type LoadedRoute } from '@/domain/routes';
import type { Track } from '@/domain/track';

/** Colore della pendenza, scala usuale delle altimetrie ciclistiche. */
export function gradeColor(g: number): string {
  if (g < 0.03) return '#6fcf7a';
  if (g < 0.06) return '#e6d34a';
  if (g < 0.09) return '#f39a2d';
  if (g < 0.12) return '#e5483a';
  return '#9b2c5e';
}

export const GRADE_LEGEND = [
  { label: '< 3%', color: gradeColor(0) },
  { label: '3–6%', color: gradeColor(0.04) },
  { label: '6–9%', color: gradeColor(0.07) },
  { label: '9–12%', color: gradeColor(0.1) },
  { label: '> 12%', color: gradeColor(0.13) },
];

export function useVerifiedRoute(id: string | undefined) {
  const [state, setState] = useState<{ route: LoadedRoute | null; error: string | null }>({ route: null, error: null });
  useEffect(() => {
    if (!id) return;
    const meta = routeMeta(id);
    if (!meta) {
      setState({ route: null, error: 'Salita sconosciuta' });
      return;
    }
    let alive = true;
    setState({ route: null, error: null });
    loadRouteFile(id)
      .then((file) => {
        if (alive) setState({ route: trackFromRouteFile(file, meta.halfWidth), error: null });
      })
      .catch((err: unknown) => {
        if (alive) setState({ route: null, error: err instanceof Error ? err.message : 'errore' });
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

/** La pianta della strada, così com'è: tornanti compresi. Nord in alto. */
export function RouteMap({ track, className, position }: { track: Track; className?: string; position?: number }) {
  const { d, vb, start, end, hairpins, stroke } = useMemo(() => {
    const pts = track.points;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = Math.max(maxX - minX, maxZ - minZ) * 0.06;
    const step = Math.max(1, Math.floor(pts.length / 1400));
    let path = '';
    for (let i = 0; i < pts.length; i += step) path += `${i ? 'L' : 'M'}${pts[i].x.toFixed(1)} ${pts[i].z.toFixed(1)}`;
    const last = pts[pts.length - 1];
    path += `L${last.x.toFixed(1)} ${last.z.toFixed(1)}`;
    const size = Math.max(maxX - minX, maxZ - minZ) + pad * 2;
    return {
      d: path,
      vb: `${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`,
      start: pts[0],
      end: last,
      hairpins: track.hairpins.map((h) => track.poseAt(h.distance)),
      stroke: size / 110,
    };
  }, [track]);
  const at = position != null ? track.poseAt(position) : null;
  return (
    <svg viewBox={vb} className={className} role="img" aria-label="Pianta della strada">
      <path d={d} fill="none" stroke="var(--line)" strokeWidth={stroke * 3.2} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth={stroke * 1.2} strokeLinejoin="round" strokeLinecap="round" />
      {hairpins.map((h, i) => (
        <circle key={i} cx={h.x} cy={h.z} r={stroke * 1.1} fill="var(--accent)" />
      ))}
      <circle cx={start.x} cy={start.z} r={stroke * 2.4} fill="var(--bg)" stroke="var(--ink)" strokeWidth={stroke} />
      <rect x={end.x - stroke * 2.2} y={end.z - stroke * 2.2} width={stroke * 4.4} height={stroke * 4.4} fill="var(--accent)" />
      {at ? <circle cx={at.x} cy={at.z} r={stroke * 2.8} fill="var(--sky)" stroke="var(--bg)" strokeWidth={stroke} /> : null}
    </svg>
  );
}

/** Altimetria colorata per pendenza, a tratti di `bin` metri. */
export function ProfileChart({
  track,
  className,
  position,
  ghost,
  bin = 200,
  height = 120,
  marks,
}: {
  track: Track;
  className?: string;
  position?: number;
  ghost?: number | null;
  bin?: number;
  height?: number;
  /** tratti cronometrati: una fascia colorata in cima, da/a in metri */
  marks?: { from: number; to: number; color: string }[];
}) {
  const W = 1000;
  const H = height;
  const { bars, line, minA, maxA, y } = useMemo(() => {
    const L = track.length;
    let minA = Infinity;
    let maxA = -Infinity;
    for (const p of track.points) {
      minA = Math.min(minA, p.y);
      maxA = Math.max(maxA, p.y);
    }
    const span = Math.max(30, maxA - minA);
    const y = (alt: number) => H - 6 - ((alt - minA) / span) * (H - 18);
    const bars: { d: string; color: string }[] = [];
    const n = Math.max(1, Math.ceil(L / bin));
    for (let i = 0; i < n; i++) {
      const a = track.poseAt(i * bin);
      const b = track.poseAt(Math.min(L, (i + 1) * bin));
      const g = (b.y - a.y) / (b.distance - a.distance || 1);
      const x0 = (a.distance / L) * W;
      const x1 = (b.distance / L) * W;
      bars.push({ d: `M${x0} ${H}L${x0} ${y(a.y)}L${x1} ${y(b.y)}L${x1} ${H}Z`, color: gradeColor(g) });
    }
    let line = '';
    const steps = 300;
    for (let i = 0; i <= steps; i++) {
      const p = track.poseAt((i / steps) * L);
      line += `${i ? 'L' : 'M'}${((i / steps) * W).toFixed(1)} ${y(p.y).toFixed(1)}`;
    }
    return { bars, line, minA, maxA, y };
  }, [track, bin, H]);
  const at = position != null ? Math.max(0, Math.min(track.length, position)) : null;
  const px = at != null ? (at / track.length) * W : null;
  const py = at != null ? y(track.poseAt(at).y) : null;
  const gx = ghost != null ? (Math.min(track.length, ghost) / track.length) * W : null;
  return (
    <div className={`relative ${className ?? ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={`Altimetria, da ${Math.round(minA + track.altitudeBase)} a ${Math.round(maxA + track.altitudeBase)}\u00a0m`}>
        {bars.map((b, i) => (
          <path key={i} d={b.d} fill={b.color} opacity={0.9} />
        ))}
        <path d={line} fill="none" stroke="var(--ink)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        {marks?.map((m, i) => {
          const x0 = (Math.max(0, m.from) / track.length) * W;
          const x1 = (Math.min(track.length, m.to) / track.length) * W;
          return x1 > x0 ? <rect key={i} x={x0} y={0} width={Math.max(2, x1 - x0)} height={Math.max(3, H * 0.09)} fill={m.color} data-testid="profile-mark" /> : null;
        })}
        {gx != null ? <line x1={gx} x2={gx} y1={0} y2={H} stroke="#8fd8ff" strokeWidth={2} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /> : null}
        {px != null ? <line x1={px} x2={px} y1={0} y2={H} stroke="var(--ink)" strokeOpacity={0.4} strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      {px != null && py != null ? <PositionDot left={px / W} top={py / H} /> : null}
    </div>
  );
}

/** Il pallino di dove sei sopra un'altimetria: in HTML e non in SVG, così resta tondo anche col grafico stirato. */
export function PositionDot({ left, top }: { left: number; top: number }) {
  return (
    <span
      data-testid="profile-dot"
      aria-hidden="true"
      className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0c0b09] bg-accent shadow-[0_0_0_3px_rgba(255,200,20,0.35)]"
      style={{ left: `${(Math.min(1, Math.max(0, left)) * 100).toFixed(2)}%`, top: `${(Math.min(1, Math.max(0, top)) * 100).toFixed(2)}%` }}
    />
  );
}
