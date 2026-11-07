import type { Polyline } from './world';

/*
 * Gli impianti di risalita dai dati `cables` (aerialway di OSM): dove stanno i piloni, da dove a
 * dove corre il cavo, dove sono ferme le cabine e dove stanno le stazioni. Solo numeri: la
 * geometria la fa Lifts.tsx, le prove stanno in tests/mondo-look.test.ts.
 */

export type LiftKind = 'cabinovia' | 'seggiovia' | 'skilift';

/** Il tipo di impianto dal tag aerialway; null per quello che non si disegna (teleferiche merci, zip line). */
export function liftKind(k: string): LiftKind | null {
  if (k === 'gondola' || k === 'cable_car' || k === 'mixed_lift') return 'cabinovia';
  if (k === 'chair_lift') return 'seggiovia';
  if (k === 'drag_lift' || k === 'platter' || k === 't-bar' || k === 'j-bar' || k === 'rope_tow' || k === 'magic_carpet') return 'skilift';
  return null;
}

/** Altezza dei piloni per tipo, metri (la funivia del Sass Pordoi ne ha di più alti). */
export const PYLON_H: Record<LiftKind, number> = { cabinovia: 13, seggiovia: 9, skilift: 5.5 };
/** Quanto sta lontano al massimo un pilone dall'altro: oltre se ne aggiunge uno in mezzo. */
export const PYLON_GAP = 160;
/** Una cabina ferma ogni 150 m sulle cabinovie. */
export const CABIN_STEP = 150;

export interface Pylon {
  x: number;
  y: number;
  z: number;
  /** direzione del cavo, radianti (heading: avanti = (sin h, cos h)) */
  h: number;
  height: number;
  kind: LiftKind;
}

export interface LiftStation {
  x: number;
  y: number;
  z: number;
  h: number;
  kind: LiftKind;
  /** la stazione a monte è quella più alta */
  top: boolean;
}

export interface LiftBuild {
  pylons: Pylon[];
  /** coppie di punti x, y, z: i tratti del cavo */
  cable: number[];
  cabins: { x: number; y: number; z: number; h: number; tint: number }[];
  stations: LiftStation[];
  /** quante linee entrano nel disegno */
  lines: number;
}

/** Misure delle stazioni per tipo: larghezza (di traverso), lunghezza (lungo il cavo), altezza. */
export const STATION: Record<LiftKind, [number, number, number]> = { cabinovia: [10, 14, 6.5], seggiovia: [7, 10, 4.5], skilift: [3, 3, 3] };

/**
 * Gli impianti entro il rettangolo (`inside`), coi piloni ai vertici della linea (OSM li ha quasi
 * sempre) e uno in più ogni 160 m dove mancano; `ground` dà la quota del terreno per quelli
 * aggiunti. Il cavo ha una freccia del 2% della campata.
 */
export function buildLifts(cables: readonly Polyline[], inside: (x: number, z: number) => boolean, ground: (x: number, z: number) => number): LiftBuild {
  const out: LiftBuild = { pylons: [], cable: [], cabins: [], stations: [], lines: 0 };
  for (const line of cables) {
    const kind = liftKind(line.kind);
    if (!kind) continue;
    const p = line.pts;
    const n = p.length / 3;
    if (n < 2) continue;
    let any = false;
    for (let i = 0; i < n && !any; i++) any = inside(p[i * 3], p[i * 3 + 1]);
    if (!any) continue;
    out.lines++;
    // i sostegni: vertici, più quelli aggiunti nelle campate lunghe
    const sup: { x: number; z: number; y: number; h: number; station: boolean }[] = [];
    for (let i = 0; i < n; i++) {
      const x = p[i * 3];
      const z = p[i * 3 + 1];
      const y = p[i * 3 + 2];
      if (i > 0) {
        const px = p[(i - 1) * 3];
        const pz = p[(i - 1) * 3 + 1];
        const py = p[(i - 1) * 3 + 2];
        const span = Math.hypot(x - px, z - pz);
        const k = Math.ceil(span / PYLON_GAP);
        for (let j = 1; j < k; j++) {
          const t = j / k;
          const qx = px + (x - px) * t;
          const qz = pz + (z - pz) * t;
          const g = ground(qx, qz);
          // dove il terreno lontano non c'è ancora si interpola
          sup.push({ x: qx, z: qz, y: Number.isFinite(g) && g !== 0 ? g : py + (y - py) * t, h: 0, station: false });
        }
      }
      sup.push({ x, z, y, h: 0, station: i === 0 || i === n - 1 });
    }
    for (let i = 0; i < sup.length; i++) {
      const a = sup[Math.max(0, i - 1)];
      const b = sup[Math.min(sup.length - 1, i + 1)];
      sup[i].h = Math.atan2(b.x - a.x, b.z - a.z);
    }
    const H = PYLON_H[kind];
    const st = STATION[kind];
    const topOf = (s: (typeof sup)[number]) => s.y + (s.station ? st[2] * 0.9 : H);
    const first = sup[0];
    const last = sup[sup.length - 1];
    out.stations.push({ x: first.x, y: first.y, z: first.z, h: first.h, kind, top: first.y > last.y });
    out.stations.push({ x: last.x, y: last.y, z: last.z, h: last.h, kind, top: last.y >= first.y });
    for (const s of sup) if (!s.station) out.pylons.push({ x: s.x, y: s.y, z: s.z, h: s.h, height: H, kind });
    // il cavo, campata per campata, con la freccia; sulle cabinovie due funi
    const lateral = kind === 'cabinovia' ? [1.2, -1.2] : [0];
    let run = 0;
    let nextCabin = CABIN_STEP / 2;
    for (let i = 0; i + 1 < sup.length; i++) {
      const a = sup[i];
      const b = sup[i + 1];
      const ya = topOf(a);
      const yb = topOf(b);
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      const sag = Math.max(0.4, span * 0.02);
      const steps = Math.max(2, Math.ceil(span / 40));
      const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: ya + (yb - ya) * t - sag * 4 * t * (1 - t) });
      for (const off of lateral) {
        const lx = Math.cos(a.h) * off;
        const lz = -Math.sin(a.h) * off;
        let prev = at(0);
        for (let k = 1; k <= steps; k++) {
          const q = at(k / steps);
          out.cable.push(prev.x + lx, prev.y, prev.z + lz, q.x + lx, q.y, q.z + lz);
          prev = q;
        }
      }
      if (kind === 'cabinovia') {
        while (nextCabin < run + span) {
          const t = (nextCabin - run) / span;
          const q = at(t);
          out.cabins.push({ x: q.x + Math.cos(a.h) * 1.2, y: q.y - 2.6, z: q.z - Math.sin(a.h) * 1.2, h: a.h, tint: ((nextCabin / CABIN_STEP) * 0.618) % 1 });
          nextCabin += CABIN_STEP;
        }
      }
      run += span;
    }
  }
  return out;
}
