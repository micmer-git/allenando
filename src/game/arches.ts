import type { TrackPose } from '@/domain/track';

/**
 * Gli archi sulla strada: i traguardi dei tratti (volata, gran premio della montagna,
 * cronometro, volata del cassonetto), i chilometri alla Zwift e i cambi d'intervallo in ERG.
 * È il contratto fra il gioco (src/game/segments.ts e rideGame.ts, che decidono DOVE sono) e
 * il 3D (src/world/Arches.tsx), che li disegna in quelle pose. Le pose sono nel sistema locale
 * del mondo (x est, z sud, y quota) come TrackPose: avanti = (sin h, 0, cos h).
 */

export type SegmentKind = 'volata' | 'gpm' | 'crono' | 'cassonetto';

/** Che arco è: un traguardo, un chilometro, l'ultimo chilometro, un cambio d'intervallo. */
export type ArchKind = SegmentKind | 'km' | 'ultimo' | 'erg';

interface Style {
  color: string;
  ink: string;
  name: string;
  short: string;
}

/**
 * Colori dei traguardi, all'italiana: ciclamino per la volata, azzurro per il GPM, oro per la
 * crono; verde differenziata per la volata del cassonetto.
 */
export const SEGMENT_STYLE: Record<SegmentKind, Style> = {
  volata: { color: '#d6267a', ink: '#ffffff', name: 'Volata', short: 'VOLATA' },
  gpm: { color: '#1f7fe0', ink: '#ffffff', name: 'Gran premio della montagna', short: 'GPM' },
  crono: { color: '#ffc814', ink: '#16130a', name: 'Cronometro', short: 'CRONO' },
  cassonetto: { color: '#2f8a3a', ink: '#ffffff', name: 'Volata del cassonetto', short: 'CASSONETTO' },
};

/** Gli altri archi: il chilometro nero, l'ultimo rosso con la fiamma, l'intervallo viola. */
export const ARCH_STYLE: Record<ArchKind, Style> = {
  ...SEGMENT_STYLE,
  km: { color: '#16181d', ink: '#ffffff', name: 'Chilometro', short: 'KM' },
  ultimo: { color: '#d4151c', ink: '#ffffff', name: 'Ultimo chilometro', short: 'ULTIMO KM' },
  erg: { color: '#6f3ff5', ink: '#ffffff', name: 'Intervallo', short: 'ERG' },
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
 * - `start`: arco di partenza (scritta del tipo + nome; in ERG l'inizio dell'intervallo)
 * - `finish`: arco d'arrivo («ARRIVO», «GPM», i bidoni del cassonetto; in ERG «Fine»)
 * - `banner`: cartello a bordo strada prima dell'arrivo («500 m», «200 m», «1 km»)
 * - `km`: portale leggero dei chilometri, col numero grande e la pendenza del km che viene
 */
export type ArchRole = 'start' | 'finish' | 'banner' | 'km';

export interface ArchSpec {
  id: string;
  kind: ArchKind;
  role: ArchRole;
  /** testo grande dell'arco o del cartello */
  label: string;
  /** testo piccolo (nome del tratto), facoltativo */
  sub?: string;
  /** pendenza del chilometro che viene (frazione), sui portali dei km in salita */
  grade?: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** semilarghezza della strada in quel punto, metri: l'arco la scavalca con un metro di margine */
  halfWidth: number;
  /** metri lungo il percorso in cui sta (per l'HUD e il collaudo) */
  d?: number;
}

/** Il nome corto del tratto sull'arco: per il cassonetto basta il paese. */
function archName(s: Segment): string {
  if (s.kind === 'cassonetto') return s.name.split(' · ').pop() ?? s.name;
  return s.name;
}

/** Le pose degli archi e dei cartelli per una lista di tratti lungo un percorso. */
export function archSpecs(segments: Segment[], poseAt: (d: number) => TrackPose, halfWidthAt: (d: number) => number = () => 3.2): ArchSpec[] {
  const out: ArchSpec[] = [];
  const put = (s: Segment, role: ArchRole, d: number, label: string, sub?: string) => {
    const p = poseAt(d);
    out.push({ id: `${s.id}:${role}:${Math.round(d)}`, kind: s.kind, role, label, sub, x: p.x, y: p.y, z: p.z, heading: p.heading, halfWidth: halfWidthAt(d), d });
  };
  for (const s of segments) {
    const st = SEGMENT_STYLE[s.kind];
    const name = archName(s);
    put(s, 'start', s.from, st.short, name);
    put(s, 'finish', s.to, s.kind === 'gpm' ? 'GPM' : s.kind === 'cassonetto' ? 'CASSONETTO' : 'ARRIVO', name);
    const len = s.to - s.from;
    const marks = s.kind === 'cassonetto' ? [100] : s.kind === 'volata' ? [200, 100] : s.kind === 'gpm' ? [1000, 500] : [1000, 500, 200];
    for (const m of marks) if (len > m + 50) put(s, 'banner', s.to - m, m >= 1000 ? `${m / 1000} km` : `${m} m`, st.short);
  }
  return out;
}

// ---------- i chilometri, alla Zwift ----------

export interface KmMark {
  d: number;
  kind: 'km' | 'ultimo';
  label: string;
  sub: string;
  /** pendenza del chilometro che viene, frazione (solo in salita) */
  grade?: number;
}

/** La pendenza scritta all'italiana: «8,4%». */
export function gradeText(g: number): string {
  return `${(g * 100).toFixed(1).replace('.', ',')}%`;
}

/**
 * Dove vanno i portali dei chilometri. In salita uno a ogni km, contato alla vetta, con la
 * pendenza del km che viene («3 km · alla vetta · 8,4%»); fuori dalle salite uno ogni 5 km,
 * contato all'arrivo; e l'«Ultimo km» con la fiamma rossa a un chilometro dall'arrivo (se
 * l'arrivo è in vetta, è l'ultimo km della salita).
 */
export function kmMarks(length: number, altAt: (d: number) => number, climbs: { from: number; to: number }[]): KmMark[] {
  const out: KmMark[] = [];
  if (!(length > 1200)) return out;
  const atEnd = climbs.find((c) => c.to >= length - 150);
  for (const c of climbs) {
    for (let k = 1; ; k++) {
      const d = c.to - k * 1000;
      if (d < c.from + 150 || d < 100) break;
      const e = Math.min(c.to, d + 1000);
      const grade = (altAt(e) - altAt(d)) / Math.max(1, e - d);
      const last = k === 1 && c === atEnd;
      out.push({ d, kind: last ? 'ultimo' : 'km', label: last ? 'Ultimo km' : `${k} km`, sub: 'alla vetta', grade });
    }
  }
  const inClimb = (d: number) => climbs.some((c) => d > c.from - 300 && d < c.to + 300);
  const free = (d: number) => !out.some((m) => Math.abs(m.d - d) < 400);
  if (!atEnd) {
    // l'ultimo km vince su un km di salita che gli cade addosso
    const d = length - 1000;
    for (let i = out.length - 1; i >= 0; i--) if (Math.abs(out[i].d - d) < 400) out.splice(i, 1);
    out.push({ d, kind: 'ultimo', label: 'Ultimo km', sub: 'all’arrivo' });
  }
  for (let k = 1; length - 5000 * k > 300; k++) {
    const d = length - 5000 * k;
    if (!inClimb(d) && free(d)) out.push({ d, kind: 'km', label: `${5 * k} km`, sub: 'all’arrivo' });
  }
  return out.sort((a, b) => a.d - b.d);
}

/**
 * Le salite che meritano i portali dei km: almeno 120 m di dislivello e un chilometro e
 * mezzo. Due salite separate da una breve discesa diventano una sola, se la seconda arriva
 * più in alto: i km si contano fino alla vetta vera.
 */
export function kmClimbs(climbs: { from: number; to: number; gain: number }[], altAt: (d: number) => number): { from: number; to: number }[] {
  const merged: { from: number; to: number }[] = [];
  for (const c of [...climbs].sort((a, b) => a.from - b.from)) {
    const prev = merged[merged.length - 1];
    if (prev && c.from - prev.to < 1500 && altAt(c.to) > altAt(prev.to)) prev.to = c.to;
    else merged.push({ from: c.from, to: c.to });
  }
  return merged.filter((c) => c.to - c.from >= 1500 && altAt(c.to) - altAt(c.from) >= 120);
}

/** I portali dei km nelle loro pose. */
export function kmArchSpecs(marks: KmMark[], poseAt: (d: number) => TrackPose, halfWidthAt: (d: number) => number = () => 3.2): ArchSpec[] {
  return marks.map((m) => {
    const p = poseAt(m.d);
    return { id: `km:${Math.round(m.d)}`, kind: m.kind, role: 'km', label: m.label, sub: m.sub, grade: m.grade, x: p.x, y: p.y, z: p.z, heading: p.heading, halfWidth: halfWidthAt(m.d), d: m.d };
  });
}
