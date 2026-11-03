import { useEffect, useMemo, useRef, useState } from 'react';
import { CLS, type Leg } from '@/open/graph';
import type { WorldData } from '@/open/world';

/**
 * La carta del mondo: rilievo ombreggiato dal DEM a 250 m, fiumi, laghi, strade per classe,
 * paesi e cime, e sopra i percorsi. Nord in alto. Si trascina col dito o col mouse, si
 * ingrandisce con la rotella, i due pulsanti o due dita. Un tocco senza trascinare sceglie
 * un punto (per partire da lì).
 */

export interface MapOverlay {
  legs: Leg[];
  color: string;
  width?: number;
  dashed?: boolean;
}

export interface MapMarker {
  x: number;
  z: number;
  color: string;
  label?: string;
  ring?: boolean;
  /** pallino piccolo, senza nome (i ciclisti virtuali) */
  small?: boolean;
  /** freccia nel verso di marcia invece del pallino, radianti (0 = sud, come la pedalata) */
  heading?: number;
}

interface View {
  cx: number;
  cz: number;
  /** metri per pixel CSS */
  mpp: number;
}

const ROAD_STYLE: Record<number, [string, number, number]> = {
  // colore, larghezza in px, metri per pixel oltre cui non si disegna
  [CLS.trunk]: ['#f2c14e', 2.2, 400],
  [CLS.primary]: ['#f6d77d', 2, 400],
  [CLS.secondary]: ['#fbfaf4', 1.7, 200],
  [CLS.tertiary]: ['#fbfaf4', 1.3, 90],
  [CLS.unclassified]: ['#f1eee4', 1, 45],
  [CLS.residential]: ['#ffffff', 0.9, 12],
  [CLS.pedestrian]: ['#e8dcc8', 1, 8],
  [CLS.cycleway]: ['#d36a5a', 1, 30],
};

export function WorldMap({
  data,
  far,
  overlays = [],
  markers = [],
  focus,
  onPick,
  className,
  height = 360,
}: {
  data: WorldData;
  far: Float32Array | null;
  overlays?: MapOverlay[];
  markers?: MapMarker[];
  /** rettangolo da inquadrare all'inizio e quando cambia */
  focus?: { x0: number; z0: number; x1: number; z1: number } | null;
  onPick?: (x: number, z: number) => void;
  className?: string;
  height?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const b = data.graph.bounds;
  const [view, setView] = useState<View>({ cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, mpp: 120 });
  const [width, setWidth] = useState(360);

  // rilievo: un'immagine sola dalla griglia lontana, calcolata una volta
  const relief = useMemo(() => (far ? hillshade(data, far) : null), [data, far]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 360));
    ro.observe(el);
    setWidth(el.clientWidth || 360);
    return () => ro.disconnect();
  }, []);

  const focusKey = focus ? `${Math.round(focus.x0)}:${Math.round(focus.z0)}:${Math.round(focus.x1)}:${Math.round(focus.z1)}` : '';
  useEffect(() => {
    const f = focus ?? b;
    const w = Math.max(1, f.x1 - f.x0);
    const h = Math.max(1, f.z1 - f.z0);
    setView({ cx: (f.x0 + f.x1) / 2, cz: (f.z0 + f.z1) / 2, mpp: Math.max(2, Math.max(w / (width - 24), h / (height - 24))) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, width, height]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(g, data, relief, view, width, height, overlays, markers);
  }, [data, relief, view, width, height, overlays, markers]);

  // trascinare, rotella, pizzico
  const drag = useRef<{ x: number; y: number; moved: boolean; pts: Map<number, { x: number; y: number }>; dist0: number; mpp0: number } | null>(null);
  const toWorld = (px: number, py: number, v = view) => ({ x: v.cx + (px - width / 2) * v.mpp, z: v.cz + (py - height / 2) * v.mpp });

  return (
    <div ref={wrap} className={`relative overflow-hidden rounded-2xl bg-[#dfe4d7] ${className ?? ''}`} style={{ height }}>
      <canvas
        ref={canvas}
        style={{ width, height, touchAction: 'none' }}
        className="block cursor-grab active:cursor-grabbing"
        aria-label="Carta del mondo: Bergamo, Val Brembana e Val Seriana"
        role="img"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const d = drag.current ?? { x: e.clientX, y: e.clientY, moved: false, pts: new Map(), dist0: 0, mpp0: view.mpp };
          d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (d.pts.size === 2) {
            const [p, q] = [...d.pts.values()];
            d.dist0 = Math.hypot(p.x - q.x, p.y - q.y);
            d.mpp0 = view.mpp;
          }
          d.x = e.clientX;
          d.y = e.clientY;
          drag.current = d;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !d.pts.has(e.pointerId)) return;
          d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (d.pts.size === 2) {
            const [p, q] = [...d.pts.values()];
            const dist = Math.hypot(p.x - q.x, p.y - q.y);
            if (d.dist0 > 0) setView((v) => ({ ...v, mpp: clampMpp((d.mpp0 * d.dist0) / dist) }));
            d.moved = true;
            return;
          }
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          d.x = e.clientX;
          d.y = e.clientY;
          setView((v) => ({ ...v, cx: v.cx - dx * v.mpp, cz: v.cz - dy * v.mpp }));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d) return;
          d.pts.delete(e.pointerId);
          if (d.pts.size === 0) {
            if (!d.moved && onPick) {
              const r = (e.target as HTMLElement).getBoundingClientRect();
              const w = toWorld(e.clientX - r.left, e.clientY - r.top);
              onPick(w.x, w.z);
            }
            drag.current = null;
          }
        }}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => {
          const r = (e.target as HTMLElement).getBoundingClientRect();
          const px = e.clientX - r.left;
          const py = e.clientY - r.top;
          setView((v) => {
            const mpp = clampMpp(v.mpp * Math.exp(e.deltaY * 0.0015));
            const before = toWorld(px, py, v);
            return { mpp, cx: before.x - (px - width / 2) * mpp, cz: before.z - (py - height / 2) * mpp };
          });
        }}
      />
      <div className="absolute right-2 top-2 flex flex-col gap-1.5">
        <button type="button" aria-label="Ingrandisci" className="grid h-11 w-11 place-items-center rounded-full bg-bg/80 text-xl font-bold text-ink shadow backdrop-blur" onClick={() => setView((v) => ({ ...v, mpp: clampMpp(v.mpp / 1.6) }))}>
          +
        </button>
        <button type="button" aria-label="Rimpicciolisci" className="grid h-11 w-11 place-items-center rounded-full bg-bg/80 text-xl font-bold text-ink shadow backdrop-blur" onClick={() => setView((v) => ({ ...v, mpp: clampMpp(v.mpp * 1.6) }))}>
          −
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-black/55">© OpenStreetMap · EU-DEM Copernicus</p>
    </div>
  );
}

function clampMpp(m: number): number {
  return Math.min(260, Math.max(1.2, m));
}

function hillshade(data: WorldData, h: Float32Array): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const f = data.graph.far;
  const c = document.createElement('canvas');
  c.width = f.nx;
  c.height = f.nz;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(f.nx, f.nz);
  // luce da nord-ovest, come nelle carte topografiche
  const lx = -0.6;
  const lz = -0.6;
  const ly = 0.55;
  for (let j = 0; j < f.nz; j++) {
    for (let i = 0; i < f.nx; i++) {
      const k = j * f.nx + i;
      const e = h[k];
      const dx = (h[j * f.nx + Math.min(f.nx - 1, i + 1)] - h[j * f.nx + Math.max(0, i - 1)]) / (2 * f.step);
      const dz = (h[Math.min(f.nz - 1, j + 1) * f.nx + i] - h[Math.max(0, j - 1) * f.nx + i]) / (2 * f.step);
      const nl = Math.hypot(dx, 1, dz);
      const shade = Math.max(0, (-dx * lx + ly - dz * lz) / nl / Math.hypot(lx, ly, lz));
      // tinta ipsometrica: pianura verde chiaro, mezza montagna verde, sopra i 1800 m grigio roccia
      const t = Math.min(1, Math.max(0, (e - 150) / 2600));
      const r = 200 + t * 30 - (t > 0.6 ? 0 : 0);
      const gg = 214 - t * 10;
      const bb = 186 + t * 30;
      const s = 0.55 + shade * 0.6;
      img.data[k * 4] = Math.min(255, r * s);
      img.data[k * 4 + 1] = Math.min(255, gg * s);
      img.data[k * 4 + 2] = Math.min(255, bb * s);
      img.data[k * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function draw(g: CanvasRenderingContext2D, data: WorldData, relief: HTMLCanvasElement | null, v: View, W: number, H: number, overlays: MapOverlay[], markers: MapMarker[]) {
  const sx = (x: number) => (x - v.cx) / v.mpp + W / 2;
  const sz = (z: number) => (z - v.cz) / v.mpp + H / 2;
  g.fillStyle = '#dfe4d7';
  g.fillRect(0, 0, W, H);
  const f = data.graph.far;
  if (relief) {
    g.imageSmoothingEnabled = true;
    g.drawImage(relief, sx(f.x0 - f.step / 2), sz(f.z0 - f.step / 2), (f.nx * f.step) / v.mpp, (f.nz * f.step) / v.mpp);
  }
  const x0 = v.cx - (W / 2) * v.mpp;
  const x1 = v.cx + (W / 2) * v.mpp;
  const z0 = v.cz - (H / 2) * v.mpp;
  const z1 = v.cz + (H / 2) * v.mpp;
  const inView = (x: number, z: number, pad = 0) => x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad;

  // laghi e fiumi
  g.fillStyle = '#7fb1cc';
  for (const l of data.features.lakes) {
    g.beginPath();
    for (let i = 0; i < l.ring.length; i += 2) {
      if (i === 0) g.moveTo(sx(l.ring[i]), sz(l.ring[i + 1]));
      else g.lineTo(sx(l.ring[i]), sz(l.ring[i + 1]));
    }
    g.fill();
  }
  g.strokeStyle = '#6aa6c6';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const r of data.features.rivers) {
    if (r.kind === 'stream' && v.mpp > 40) continue;
    g.lineWidth = Math.max(r.kind === 'river' ? 1.6 : 0.8, (r.hw * 2) / v.mpp);
    g.beginPath();
    const p = r.pts;
    for (let i = 0; i < p.length; i += 3) {
      if (i === 0) g.moveTo(sx(p[i]), sz(p[i + 1]));
      else g.lineTo(sx(p[i]), sz(p[i + 1]));
    }
    g.stroke();
  }

  // strade per classe: prima le minori, sopra le principali
  const edges = data.graph.edges;
  for (const cls of [CLS.pedestrian, CLS.residential, CLS.cycleway, CLS.unclassified, CLS.tertiary, CLS.secondary, CLS.primary, CLS.trunk]) {
    const [color, width, maxMpp] = ROAD_STYLE[cls];
    if (v.mpp > maxMpp) continue;
    g.strokeStyle = color;
    g.lineWidth = Math.max(width, Math.min(8, ((edges[0]?.hw ?? 3) * 2) / v.mpp));
    g.beginPath();
    const stride = v.mpp > 60 ? 3 : 1;
    for (const e of edges) {
      if (e.cls !== cls) continue;
      const m = e.xs.length;
      if (!inView(e.xs[0], e.zs[0], 3000) && !inView(e.xs[m - 1], e.zs[m - 1], 3000)) continue;
      g.moveTo(sx(e.xs[0]), sz(e.zs[0]));
      for (let k = stride; k < m; k += stride) g.lineTo(sx(e.xs[k]), sz(e.zs[k]));
      g.lineTo(sx(e.xs[m - 1]), sz(e.zs[m - 1]));
    }
    g.stroke();
  }

  // percorsi
  for (const o of overlays) {
    g.strokeStyle = 'rgba(10,12,15,0.55)';
    g.lineWidth = (o.width ?? 4) + 2.5;
    g.setLineDash([]);
    strokeLegs(g, data, o.legs, sx, sz);
    g.strokeStyle = o.color;
    g.lineWidth = o.width ?? 4;
    g.setLineDash(o.dashed ? [7, 6] : []);
    strokeLegs(g, data, o.legs, sx, sz);
    g.setLineDash([]);
  }

  // segnaposti, poi città, paesi e cime: un nome che si accavalla a uno già scritto non si scrive
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const room = (x: number, y: number, w: number, h: number) => {
    const r = { x0: x - w / 2 - 2, y0: y - h - 1, x1: x + w / 2 + 2, y1: y + 1 };
    for (const t of taken) if (r.x0 < t.x1 && r.x1 > t.x0 && r.y0 < t.y1 && r.y1 > t.y0) return false;
    taken.push(r);
    return true;
  };
  const halo = (text: string, x: number, y: number, font: string, fill: string, edge = 'rgba(255,255,255,0.88)') => {
    g.font = font;
    const w = g.measureText(text).width;
    const h = parseInt(font.split(' ')[1], 10) || 11;
    if (!room(x, y, w, h)) return false;
    g.lineWidth = 3;
    g.strokeStyle = edge;
    g.strokeText(text, x, y);
    g.fillStyle = fill;
    g.fillText(text, x, y);
    return true;
  };
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  // i segnaposti si disegnano sopra tutto, ma i loro nomi passano per primi
  const order = [...markers].sort((a, b) => Number(b.heading != null) - Number(a.heading != null) || Number(!!b.ring) - Number(!!a.ring));
  for (const m of order) {
    if (!m.label || m.small) continue;
    const x = sx(m.x);
    const y = sz(m.z);
    // prima il posto del segno stesso, poi il nome sopra, staccato quanto basta da non toccarlo
    if (m.heading != null) room(x, y + 13, 26, 26);
    else room(x, y + 6, 14, 12);
    halo(m.label, x, y - (m.heading != null ? 15 : 9), '700 11px sans-serif', '#0a0c0f', 'rgba(255,255,255,0.92)');
  }
  const places = data.features.places
    .filter((p) => p.kind === 'city' || (p.kind === 'town' && v.mpp < 90) || (p.kind === 'village' && v.mpp < 32) || ((p.kind === 'suburb' || p.kind === 'quarter') && v.mpp < 6))
    .sort((a, b) => placeRank(a.kind) - placeRank(b.kind));
  for (const p of places) {
    if (!inView(p.x, p.z)) continue;
    halo(p.name, sx(p.x), sz(p.z), p.kind === 'city' ? '800 14px sans-serif' : p.kind === 'town' ? '700 12px sans-serif' : '600 11px sans-serif', '#1d2026');
  }
  for (const p of data.features.peaks) {
    if (p.pass || p.ele < (v.mpp > 60 ? 2200 : v.mpp > 25 ? 1700 : 1100) || !inView(p.x, p.z)) continue;
    const x = sx(p.x);
    const y = sz(p.z);
    g.fillStyle = '#5b4a3a';
    g.beginPath();
    g.moveTo(x, y - 5);
    g.lineTo(x + 4, y + 2);
    g.lineTo(x - 4, y + 2);
    g.fill();
    if (v.mpp < 45) halo(`${p.name} ${p.ele}`, x, y - 6, '600 10px sans-serif', '#4a3c2f', 'rgba(255,255,255,0.7)');
  }
  for (const m of markers) {
    const x = sx(m.x);
    const y = sz(m.z);
    g.fillStyle = m.color;
    g.strokeStyle = '#0a0c0f';
    g.lineWidth = m.small ? 1 : 2;
    g.beginPath();
    if (m.heading != null) {
      // un alone, perché «sei qui» si trovi al primo sguardo
      g.save();
      g.fillStyle = 'rgba(200,240,49,0.28)';
      g.beginPath();
      g.arc(x, y, 17, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.beginPath();
      // freccia nel verso di marcia: avanti è (sin h, cos h) in x/z, e sullo schermo z scende
      const fx = Math.sin(m.heading);
      const fz = Math.cos(m.heading);
      const tip = 12;
      const back = 8;
      const side = 8;
      g.moveTo(x + fx * tip, y + fz * tip);
      g.lineTo(x - fx * back + fz * side, y - fz * back - fx * side);
      g.lineTo(x - fx * 3, y - fz * 3);
      g.lineTo(x - fx * back - fz * side, y - fz * back + fx * side);
      g.closePath();
      g.lineWidth = 1.6;
    } else g.arc(x, y, m.small ? 3 : m.ring ? 7 : 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}

function placeRank(kind: string): number {
  return kind === 'city' ? 0 : kind === 'town' ? 1 : kind === 'village' ? 2 : 3;
}

function strokeLegs(g: CanvasRenderingContext2D, data: WorldData, legs: Leg[], sx: (x: number) => number, sz: (z: number) => number) {
  g.beginPath();
  let first = true;
  for (const l of legs) {
    const e = data.graph.edges[l.edge];
    const m = e.xs.length;
    for (let k = 0; k < m; k++) {
      const i = l.dir > 0 ? k : m - 1 - k;
      if (first) {
        g.moveTo(sx(e.xs[i]), sz(e.zs[i]));
        first = false;
      } else g.lineTo(sx(e.xs[i]), sz(e.zs[i]));
    }
  }
  g.stroke();
}

/** Il rettangolo che contiene una fila di archi, con un margine. */
export function legsBounds(data: WorldData, legs: Leg[], pad = 400): { x0: number; z0: number; x1: number; z1: number } | null {
  if (legs.length === 0) return null;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const l of legs) {
    const e = data.graph.edges[l.edge];
    for (let k = 0; k < e.xs.length; k++) {
      x0 = Math.min(x0, e.xs[k]);
      x1 = Math.max(x1, e.xs[k]);
      z0 = Math.min(z0, e.zs[k]);
      z1 = Math.max(z1, e.zs[k]);
    }
  }
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
}

/**
 * La cartina in pedalata: le strade intorno nel verso di marcia (in alto è avanti), il
 * percorso, i ciclisti. Si ridisegna dieci volte al secondo.
 */
export function MiniMap({
  data,
  pose,
  legs,
  riders,
  className,
  size = 132,
}: {
  data: WorldData;
  pose: () => { x: number; z: number; heading: number };
  legs: () => Leg[];
  riders: () => { x: number; z: number; color: string; real: boolean }[];
  className?: string;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    let timer = 0;
    const R = 420;
    const tick = () => {
      const p = pose();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = 'rgba(14,17,21,0.78)';
      g.fillRect(0, 0, size, size);
      const k = size / 2 / R;
      // ruotato: la direzione di marcia in alto
      g.translate(size / 2, size / 2);
      g.rotate(p.heading + Math.PI);
      g.scale(k, k);
      g.translate(-p.x, -p.z);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const ids = data.graph.edgesNear(p.x, p.z, R * 1.2);
      for (const id of ids) {
        const e = data.graph.edges[id];
        g.strokeStyle = e.cls <= CLS.secondary ? '#c9c4b2' : e.cls === CLS.cycleway ? '#b0604f' : '#7d808a';
        g.lineWidth = (e.cls <= CLS.secondary ? 3 : 2) / k;
        g.beginPath();
        g.moveTo(e.xs[0], e.zs[0]);
        for (let i = 1; i < e.xs.length; i++) g.lineTo(e.xs[i], e.zs[i]);
        g.stroke();
      }
      const route = legs();
      if (route.length) {
        g.strokeStyle = '#c8f031';
        g.lineWidth = 3.4 / k;
        g.beginPath();
        let first = true;
        for (const l of route) {
          const e = data.graph.edges[l.edge];
          if (Math.hypot(e.xs[0] - p.x, e.zs[0] - p.z) > R * 3 && Math.hypot(e.xs[e.xs.length - 1] - p.x, e.zs[e.zs.length - 1] - p.z) > R * 3) {
            first = true;
            continue;
          }
          const m = e.xs.length;
          for (let i = 0; i < m; i++) {
            const j = l.dir > 0 ? i : m - 1 - i;
            if (first) {
              g.moveTo(e.xs[j], e.zs[j]);
              first = false;
            } else g.lineTo(e.xs[j], e.zs[j]);
          }
        }
        g.stroke();
      }
      for (const r of riders()) {
        g.fillStyle = r.real ? r.color : '#9aa0a8';
        g.beginPath();
        g.arc(r.x, r.z, (r.real ? 4.5 : 3) / k, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      // il giocatore: una freccia al centro, sempre in su
      g.fillStyle = '#c8f031';
      g.strokeStyle = '#0a0c0f';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(size / 2, size / 2 - 8);
      g.lineTo(size / 2 + 6, size / 2 + 6);
      g.lineTo(size / 2, size / 2 + 3);
      g.lineTo(size / 2 - 6, size / 2 + 6);
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      g.stroke();
      timer = window.setTimeout(tick, 100);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [data, pose, legs, riders, size]);
  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />;
}
