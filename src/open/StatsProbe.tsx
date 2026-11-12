import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/*
 * Le misure della scena 3D, per il collaudo: con `?stats=1` nell'indirizzo la scena scrive in
 * `window.__orobiaStats` chiamate di disegno, triangoli, geometrie e texture in memoria, il tempo
 * per fotogramma (p50 e p95 sugli ultimi 600) e le mattonelle caricate e in attesa.
 * `window.__orobiaStatsReset()` svuota la finestra dei tempi, per misurare da un istante preciso.
 * Senza il parametro il componente non monta niente: nessun costo per chi pedala.
 */

/** Le mattonelle del mondo aperto, contate dalla scena (WorldScene). */
export interface TileCounts {
  /** mattonelle in scena */
  ready: number;
  /** mattonelle chieste e non ancora in scena */
  pending: number;
  /** mattonelle con l'arredo vicino già costruito */
  detail: number;
  /** mattonelle entro 400 m dal ciclista, e quante di queste sono in scena */
  near: number;
  nearReady: number;
  /** la somma degli avanzamenti delle mattonelle entro 400 m (tileStage): conta i passi a metà */
  nearPartial: number;
  /** dopo il «pronto»: mattonelle o arredo entrati in scena a meno di 150 m, e la distanza minima (-1: nessuno) */
  late: number;
  lateMin: number;
  /** alberi con le geometrie piene e con quelle povere */
  treesNear?: number;
  treesFar?: number;
  orthoSheets?: number;
}

export interface OrobiaStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  /** tempo per fotogramma, millisecondi */
  frameP50: number;
  frameP95: number;
  frameMax: number;
  frames: number;
  tiles: TileCounts | null;
  /** avanzamento del caricamento intorno al ciclista, 0…1 (WorldScene) */
  progress: number | null;
  width: number;
  height: number;
  dpr: number;
}

/** L'istante del «pronto», con le mattonelle entro 400 m in quel momento (per il collaudo). */
export interface OrobiaReady {
  reason: string;
  ms: number;
  near: number;
  nearReady: number;
}

declare global {
  interface Window {
    __orobiaReady?: OrobiaReady;
    __orobiaStats?: OrobiaStats;
    __orobiaStatsReset?: () => void;
  }
}

export function statsWanted(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('stats') === '1';
}

/** Percentile di una lista già ordinata. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

const WINDOW = 600;

export function StatsProbe({ tiles, progress }: { tiles?: () => TileCounts; progress?: () => number }) {
  const { gl, size } = useThree();
  const times = useRef(new Float64Array(WINDOW));
  const count = useRef(0);
  const last = useRef(0);
  const clock = useRef(0);
  useEffect(() => {
    window.__orobiaStatsReset = () => {
      count.current = 0;
      last.current = 0;
    };
    return () => {
      delete window.__orobiaStats;
      delete window.__orobiaStatsReset;
    };
  }, []);
  useFrame((_, dt) => {
    const now = performance.now();
    if (last.current > 0) {
      times.current[count.current % WINDOW] = now - last.current;
      count.current++;
    }
    last.current = now;
    clock.current -= dt;
    // le mattonelle a ogni fotogramma: il collaudo le legge nell'istante del «pronto»
    if (window.__orobiaStats) {
      window.__orobiaStats.tiles = tiles ? { ...tiles() } : null;
      window.__orobiaStats.progress = progress ? Math.round(progress() * 1000) / 1000 : null;
    }
    if (clock.current > 0) return;
    clock.current = 0.5;
    const n = Math.min(count.current, WINDOW);
    const sorted = Array.from(times.current.subarray(0, n)).sort((a, b) => a - b);
    // gl.info.render si azzera a ogni render: qui, prima del render, vale per il fotogramma di prima
    const info = gl.info;
    window.__orobiaStats = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      frameP50: Math.round(percentile(sorted, 0.5) * 10) / 10,
      frameP95: Math.round(percentile(sorted, 0.95) * 10) / 10,
      frameMax: Math.round((sorted[n - 1] ?? 0) * 10) / 10,
      frames: count.current,
      tiles: tiles ? { ...tiles() } : null,
      progress: progress ? Math.round(progress() * 1000) / 1000 : null,
      width: size.width,
      height: size.height,
      dpr: gl.getPixelRatio(),
    };
  });
  return null;
}
