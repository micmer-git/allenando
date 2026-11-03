import type { TrackPose } from '@/domain/track';

/**
 * Gli archi dei traguardi sulla strada: volata, gran premio della montagna, cronometro.
 * È il contratto fra il gioco (src/game/segments.ts, che decide DOVE sono i tratti) e il 3D,
 * che disegna archi e cartelli in quelle pose. Le pose sono nel sistema locale del mondo
 * (x est, z sud, y quota) come TrackPose: avanti = (sin h, 0, cos h).
 */

export type SegmentKind = 'volata' | 'gpm' | 'crono';

/** Colori dei traguardi, all'italiana: ciclamino per la volata, azzurro per il GPM, oro per la crono. */
export const SEGMENT_STYLE: Record<SegmentKind, { color: string; ink: string; name: string; short: string }> = {
  volata: { color: '#d6267a', ink: '#ffffff', name: 'Volata', short: 'VOLATA' },
  gpm: { color: '#1f7fe0', ink: '#ffffff', name: 'Gran premio della montagna', short: 'GPM' },
  crono: { color: '#ffc814', ink: '#16130a', name: 'Cronometro', short: 'CRONO' },
};

export interface Segment {
  id: string;
  kind: SegmentKind;
  name: string;
  /** metri lungo il percorso */
  from: number;
  to: number;
}

/**
 * - `start`: arco di partenza del tratto (scritta del tipo + nome)
 * - `finish`: arco d'arrivo del tratto (scritta «ARRIVO» o «GPM»)
 * - `banner`: cartello a bordo strada prima dell'arrivo («500 m», «200 m», «1 km»)
 */
export type ArchRole = 'start' | 'finish' | 'banner';

export interface ArchSpec {
  id: string;
  kind: SegmentKind;
  role: ArchRole;
  /** testo grande dell'arco o del cartello */
  label: string;
  /** testo piccolo (nome del tratto), facoltativo */
  sub?: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** semilarghezza della strada in quel punto, metri: l'arco la scavalca con un metro di margine */
  halfWidth: number;
}

/** Le pose degli archi e dei cartelli per una lista di tratti lungo un percorso. */
export function archSpecs(segments: Segment[], poseAt: (d: number) => TrackPose, halfWidthAt: (d: number) => number = () => 3.2): ArchSpec[] {
  const out: ArchSpec[] = [];
  const put = (s: Segment, role: ArchRole, d: number, label: string, sub?: string) => {
    const p = poseAt(d);
    out.push({ id: `${s.id}:${role}:${Math.round(d)}`, kind: s.kind, role, label, sub, x: p.x, y: p.y, z: p.z, heading: p.heading, halfWidth: halfWidthAt(d) });
  };
  for (const s of segments) {
    const st = SEGMENT_STYLE[s.kind];
    put(s, 'start', s.from, st.short, s.name);
    put(s, 'finish', s.to, s.kind === 'gpm' ? 'GPM' : 'ARRIVO', s.name);
    const len = s.to - s.from;
    const marks = s.kind === 'volata' ? [200, 100] : s.kind === 'gpm' ? [1000, 500] : [1000, 500, 200];
    for (const m of marks) if (len > m + 50) put(s, 'banner', s.to - m, m >= 1000 ? `${m / 1000} km` : `${m} m`, st.short);
  }
  return out;
}
