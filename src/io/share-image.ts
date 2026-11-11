import { BRAND, MARK } from '@/brand';
import { formatDuration, formatKm, formatNumber } from '@/domain/format';
import { projector } from '@/domain/geo';
import { validPosition } from '@/domain/metrics';
import type { Ride } from '@/domain/types';
import { CLS } from '@/open/graph';
import { type WorldData } from '@/open/world';
import type { Monumento } from '@/open/monumenti';
import { downloadBytes, safeFileName } from '@/lib/download';
import { worldInfo, worldOfRide } from '@/open/worlds';
import { formatAltText } from '@/domain/format';

/**
 * La cartolina del giro: un PNG 1080×1350 (il 4:5 dei social) con la traccia sulla carta di
 * Bergamo, il profilo, tempo, km e dislivello, i monumenti passati e il marchio.
 *
 * Due metà: `layoutCard` decide dove va ogni scritta (pura, misurata da fuori: la prova
 * controlla che niente esca dal riquadro), `paintCard` disegna su un canvas 2D.
 * La carta è notte e oro come l'app: rilievo scuro dal DEM a 250 m, fiumi, strade e paesi
 * appena accennati, e la traccia d'oro, l'unica cosa accesa.
 */

export const CARD_W = 1080;
export const CARD_H = 1350;
/** il margine di sicurezza: nessuna scritta più vicina di così al bordo */
export const CARD_MARGIN = 72;

const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const SANS = 'Outfit, system-ui, sans-serif';
const C = {
  night: BRAND.night,
  gold: BRAND.yellow,
  ink: '#f6f2e6',
  ink2: 'rgba(246,242,230,0.78)',
  muted: '#9d9686',
} as const;

/**
 * Lo sfondo per mondo (F.9): Bergamo è la notte calda del marchio; il Sellaronda una notte
 * fredda, blu-grigia come la dolomia al buio. `rgb` serve alle sfumature, `relief` al rilievo.
 */
export interface CardPalette {
  night: string;
  rgb: [number, number, number];
  relief: [number, number, number];
}

export function cardPalette(worldId: string | null | undefined): CardPalette {
  if (worldId === 'sellaronda') return { night: '#0a0e15', rgb: [10, 14, 21], relief: [22, 28, 40] };
  return { night: C.night, rgb: [12, 11, 9], relief: [27, 25, 20] };
}

export interface CardInput {
  /** il nome del giro: «Maresana», «Giro libero» */
  title: string;
  /** una riga sopra il titolo: «da Ponteranica», il nome dell'allenamento… (anche vuota) */
  eyebrow: string;
  when: Date;
  durationSec: number;
  distanceM: number;
  gainM: number;
  /** la traccia, metri nel riferimento del mondo (x a est, z a sud) */
  track: { x: number; z: number }[];
  /** quota lungo il giro */
  profile: { d: number; alt: number }[];
  /** i monumenti passati, in ordine */
  monuments: { name: string; x: number; z: number }[];
  /** la traccia sta nel mondo di Bergamo: sotto vanno rilievo, fiumi, strade e paesi */
  inWorld: boolean;
  /** il mondo del giro (`bergamo`, `sellaronda`), null se fuori dai mondi */
  worldId?: string | null;
  /** il punto più alto toccato: il passo o la cima se la strada ci arriva, sennò solo la quota */
  top?: { name: string | null; alt: number } | null;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TextOp {
  id: string;
  text: string;
  /** punto d'appoggio: x secondo `align`, y sulla linea di base */
  x: number;
  y: number;
  font: string;
  size: number;
  spacing: number;
  color: string;
  align: 'left' | 'right';
  box: Box;
}

/** Larghezza di una scritta in px, col carattere e la spaziatura dati. */
export type Measure = (text: string, font: string, spacing: number) => number;

export interface CardLayout {
  texts: TextOp[];
  mark: { x: number; y: number; size: number };
  /** la carta: dall'alto fino a qui (sotto sfuma nel fondo) */
  mapBottom: number;
  /** dove deve stare la traccia */
  fit: Box;
  /** la vista della carta: centro in metri e metri per pixel */
  view: { cx: number; cz: number; mpp: number; px: number; py: number };
  /** il profilo in basso (null se la traccia manca e il profilo prende il posto della carta) */
  profile: Box | null;
  /** la riga dei monumenti: il rombo sta qui */
  monumentsMark: { x: number; y: number } | null;
}

const font = (weight: number, size: number, family: string) => `${weight} ${size}px ${family}`;

function text(measure: Measure, id: string, s: string, x: number, y: number, weight: number, size: number, family: string, color: string, align: 'left' | 'right' = 'left', spacing = 0): TextOp {
  const f = font(weight, size, family);
  const w = measure(s, f, spacing);
  const x0 = align === 'left' ? x : x - w;
  // ascendenti e accenti sopra, discendenti sotto: la scatola vera della riga. Tutto
  // maiuscolo non scende sotto la linea di base (la virgola appena)
  const upper = s === s.toLocaleUpperCase('it-IT');
  return { id, text: s, x, y, font: f, size, spacing, color, align, box: { x0, y0: y - size * (upper ? 0.88 : 0.92), x1: x0 + w, y1: y + size * (upper ? 0.06 : 0.24) } };
}

/** Il titolo in maiuscolo: una riga se ci sta, altrimenti due, e il corpo scende finché entra. Mai i puntini. */
function titleLines(measure: Measure, s: string, width: number): { lines: string[]; size: number } {
  const up = s.toLocaleUpperCase('it-IT');
  const fits = (t: string, size: number) => measure(t, font(800, size, DISPLAY), 1) <= width;
  for (let size = 120; size >= 92; size -= 4) if (fits(up, size)) return { lines: [up], size };
  const words = up.split(/\s+/).filter(Boolean);
  for (let size = 100; size >= 48; size -= 4) {
    let best: string[] | null = null;
    let worst = Infinity;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' ');
      const b = words.slice(k).join(' ');
      if (!fits(a, size) || !fits(b, size)) continue;
      // la spezzatura più equilibrata
      const d = Math.abs(measure(a, font(800, size, DISPLAY), 1) - measure(b, font(800, size, DISPLAY), 1));
      if (d < worst) {
        worst = d;
        best = [a, b];
      }
    }
    if (best) return { lines: best, size };
    if (words.length === 1 && fits(up, size)) return { lines: [up], size };
  }
  return { lines: [up], size: 44 };
}

/** Dove va ogni cosa. Dal basso: piede, monumenti, profilo, numeri, titolo; la carta prende il resto. */
export function layoutCard(input: CardInput, measure: Measure): CardLayout {
  const W = CARD_W;
  const M = CARD_MARGIN;
  const inner = W - 2 * M;
  const texts: TextOp[] = [];

  // in alto: il marchio e la data
  const mark = { x: M, y: 56, size: 60 };
  texts.push(text(measure, 'brand', BRAND.name, M + 78, 105, 800, 54, DISPLAY, C.ink, 'left', 5));
  const date = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(input.when);
  texts.push(text(measure, 'date', date, W - M, 101, 600, 27, SANS, C.ink2, 'right'));

  // il piede: il motto a sinistra, l'indirizzo a destra se ci sta
  let y = CARD_H - 58;
  const claim = text(measure, 'claim', BRAND.claim, M, y, 500, 23, SANS, C.muted);
  texts.push(claim);
  const url = text(measure, 'url', 'micmer-git.github.io/allenando', W - M, y, 500, 23, SANS, C.muted, 'right');
  if (url.box.x0 > claim.box.x1 + 32) texts.push(url);
  y -= 23 + 40;

  // il punto più alto (F.9): «Passo Pordoi · 2.239 m», una riga sopra i monumenti
  if (input.top && input.top.alt > 0) {
    const size = 27;
    const line = `${input.top.name ? `${input.top.name} · ` : 'Punto più alto · '}${formatAltText(input.top.alt)}`;
    texts.push(text(measure, 'top', line, M + 30, y, 500, size, SANS, C.ink2));
    y -= size + 18;
  }

  // i monumenti passati: quanti ne stanno, poi «e altri N»
  let monumentsMark: CardLayout['monumentsMark'] = null;
  if (input.monuments.length) {
    const size = 27;
    const x = M + 30;
    const names = input.monuments.map((m) => m.name);
    let line = '';
    for (let k = names.length; k >= 1; k--) {
      const rest = names.length - k;
      const cand = names.slice(0, k).join(' · ') + (rest ? ` e ${rest === 1 ? 'un altro' : `altri ${rest}`}` : '');
      if (measure(cand, font(500, size, SANS), 0) <= W - M - x) {
        line = cand;
        break;
      }
    }
    if (!line) line = names.length === 1 ? '1 monumento' : `${names.length} monumenti`;
    texts.push(text(measure, 'monuments', line, x, y, 500, size, SANS, C.ink2));
    monumentsMark = { x: M + 9, y: y - size * 0.36 };
    y -= size + 44;
  } else if (input.top && input.top.alt > 0) y -= 26;

  // il profilo
  const hasTrack = input.track.length >= 2;
  let profile: Box | null = null;
  if (hasTrack) {
    const h = 104;
    profile = { x0: M, y0: y - h, x1: W - M, y1: y };
    y = profile.y0 - 52;
  }

  // i tre numeri: etichetta sopra, numero grande sotto
  const col = inner / 3;
  const stats: [string, string, string][] = [
    ['Tempo', formatDuration(input.durationSec), ''],
    ['Distanza', formatKm(input.distanceM), 'km'],
    ['Dislivello', formatNumber(Math.max(0, input.gainM), 0), 'm'],
  ];
  let valueSize = 104;
  const widest = (size: number) => Math.max(...stats.map(([, v, u]) => measure(v, font(700, size, DISPLAY), 0) + (u ? 10 + measure(u, font(600, 30, SANS), 0) : 0)));
  while (valueSize > 56 && widest(valueSize) > col - 24) valueSize -= 4;
  const valueY = y;
  const labelY = valueY - valueSize * 0.86 - 22;
  stats.forEach(([label, value, unit], i) => {
    const x = M + i * col;
    texts.push(text(measure, `stat-label-${i}`, label.toLocaleUpperCase('it-IT'), x, labelY, 600, 22, SANS, C.muted, 'left', 3));
    const v = text(measure, `stat-${i}`, value, x, valueY, 700, valueSize, DISPLAY, C.ink);
    texts.push(v);
    if (unit) texts.push(text(measure, `stat-unit-${i}`, unit, v.box.x1 + 10, valueY, 600, 30, SANS, C.muted));
  });
  y = labelY - 22 - 44;

  // il titolo, e la riga sopra
  const t = titleLines(measure, input.title, inner);
  const lead = t.size * 0.95;
  for (let i = t.lines.length - 1; i >= 0; i--) {
    texts.push(text(measure, `title-${i}`, t.lines[i], M, y, 800, t.size, DISPLAY, C.ink, 'left', 1));
    y -= lead;
  }
  y += lead - t.size * 0.86 - 26;
  if (input.eyebrow) {
    let eb = input.eyebrow.toLocaleUpperCase('it-IT');
    // la riga sopra il titolo non va a capo: se è troppo lunga perde le parole in fondo
    while (measure(eb, font(600, 25, SANS), 4) > inner && eb.includes(' ')) eb = eb.slice(0, eb.lastIndexOf(' ')).replace(/[\s·,–-]+$/, '');
    texts.push(text(measure, 'eyebrow', eb, M, y, 600, 25, SANS, C.gold, 'left', 4));
    y -= 25;
  }
  const mapBottom = Math.round(y + 120);

  // la carta: la traccia sta fra la fascia del marchio e la sfumatura in basso
  const fit: Box = { x0: M, y0: 172, x1: W - M, y1: Math.max(420, y - 46) };
  const view = fitView(input.track, fit);
  return { texts, mark, mapBottom, fit, view, profile, monumentsMark };
}

/** La vista che fa stare la traccia nel riquadro, mai più vicina di 2,6 m per pixel. */
export function fitView(track: { x: number; z: number }[], fit: Box): CardLayout['view'] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of track) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  if (!Number.isFinite(x0)) {
    x0 = x1 = z0 = z1 = 0;
  }
  const w = fit.x1 - fit.x0;
  const h = fit.y1 - fit.y0;
  const mpp = Math.max(2.6, (x1 - x0) / w, (z1 - z0) / h) * 1.04;
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, mpp, px: (fit.x0 + fit.x1) / 2, py: (fit.y0 + fit.y1) / 2 };
}

/** Da metri del mondo a pixel della cartolina. */
export function toCard(view: CardLayout['view'], x: number, z: number): { x: number; y: number } {
  return { x: view.px + (x - view.cx) / view.mpp, y: view.py + (z - view.cz) / view.mpp };
}

// ---------------------------------------------------------------------------
// Dal giro ai dati della cartolina.

export interface WorldContext {
  data: WorldData;
  /** quote del terreno lontano (Terrain.loadFar), per il rilievo */
  far: Float32Array | null;
}

/** L'apostrofo tipografico: i nomi di OpenStreetMap hanno quello dritto («Sant'Agostino» → «Sant’Agostino»). */
export function typo(s: string): string {
  return s.replace(/'/g, '’');
}

/** Il nome e la riga sopra: un percorso del mondo si riconosce dal nome del giro. */
export function cardTitle(ride: Pick<Ride, 'name' | 'routeId'>, rides: readonly { id: string; name: string; side: string }[]): { title: string; eyebrow: string } {
  // «mondo:percorso»: il percorso del mondo, qualunque mondo sia
  const world = ride.routeId?.includes(':') ? ride.routeId.slice(0, ride.routeId.indexOf(':')) : '';
  const byRoute = world ? rides.find((r) => `${world}:${r.id}` === ride.routeId) : undefined;
  const cut = ride.name.lastIndexOf(' · ');
  const prefix = cut > 0 ? ride.name.slice(0, cut) : '';
  const label = cut > 0 ? ride.name.slice(cut + 3) : ride.name;
  const def = byRoute ?? rides.find((r) => `${r.name} ${r.side}` === label);
  if (def) return { title: def.name, eyebrow: [prefix, def.side].filter(Boolean).join(' · ') };
  return { title: label, eyebrow: prefix || worldInfo(world).name };
}

/** I dati della cartolina da un giro salvato (o appena finito). */
export function cardInputFromRide(ride: Ride, world: WorldData | null, monumenti: readonly Monumento[] = []): CardInput {
  const geo = ride.samples.filter((s) => validPosition(s.lat, s.lon));
  const first = geo[0];
  const origin = world?.graph.origin ?? (first ? { lat: first.lat!, lon: first.lon! } : { lat: 0, lon: 0 });
  const proj = projector(origin);
  // un punto ogni 4 m basta: sulla cartolina un pixel sono almeno 2,6 m
  const track: { x: number; z: number }[] = [];
  for (const s of geo) {
    const p = proj.toLocal({ lat: s.lat!, lon: s.lon! });
    const q = track[track.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.z - q.z) >= 4) track.push(p);
  }
  const end = geo[geo.length - 1];
  if (end && track.length > 1) track[track.length - 1] = proj.toLocal({ lat: end.lat!, lon: end.lon! });
  const b = world?.graph.bounds;
  const inWorld = !!b && track.length >= 2 && track.every((p) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1);
  const profile = ride.samples.filter((s) => Number.isFinite(s.altitude)).map((s) => ({ d: s.distance, alt: s.altitude }));
  const passed: CardInput['monuments'] = [];
  if (inWorld) {
    const firstPass = new Map<string, { i: number; m: Monumento }>();
    for (const m of monumenti) {
      const r2 = m.reach * m.reach;
      for (let i = 0; i < track.length; i++) {
        const dx = track[i].x - m.x;
        const dz = track[i].z - m.z;
        if (dx * dx + dz * dz <= r2) {
          if (!firstPass.has(m.name)) firstPass.set(m.name, { i, m });
          break;
        }
      }
    }
    for (const { m } of [...firstPass.values()].sort((a, c) => a.i - c.i)) passed.push({ name: typo(m.name), x: m.x, z: m.z });
  }
  const t = cardTitle(ride, world?.rides ?? []);
  // il mondo nella riga sopra il titolo, e il punto più alto toccato
  const worldId = worldOfRide(ride) ?? (inWorld && world ? world.graph.id : null);
  const eyebrow = worldId && !t.eyebrow.includes(worldInfo(worldId).name) ? [t.eyebrow, worldInfo(worldId).name].filter(Boolean).join(' · ') : t.eyebrow;
  let top: CardInput['top'] = null;
  const hi = ride.samples.reduce<(typeof ride.samples)[number] | null>((a, s) => (Number.isFinite(s.altitude) && (!a || s.altitude > a.altitude) ? s : a), null);
  if (hi && hi.altitude > 0) {
    let name: string | null = null;
    if (inWorld && world && validPosition(hi.lat, hi.lon)) {
      const p = proj.toLocal({ lat: hi.lat!, lon: hi.lon! });
      const near = world.features.landmarks.filter((l) => (l.kind === 'passo' || l.kind === 'cima') && Math.hypot(l.x - p.x, l.z - p.z) < (l.kind === 'passo' ? 450 : 2600)).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (near) name = typo(near.name);
    }
    top = { name, alt: hi.altitude };
  }
  return {
    title: typo(t.title),
    eyebrow: typo(eyebrow),
    worldId,
    top,
    when: new Date(ride.startTime),
    durationSec: ride.durationSec,
    distanceM: ride.distanceM,
    gainM: ride.elevationGainM,
    track,
    profile,
    monuments: passed,
    inWorld,
  };
}

// ---------------------------------------------------------------------------
// Il disegno.

type Ctx = CanvasRenderingContext2D;

export function canvasMeasure(g: Ctx): Measure {
  return (s, f, spacing) => {
    g.font = f;
    return g.measureText(s).width + spacing * s.length;
  };
}

function setSpacing(g: Ctx, px: number): void {
  // letterSpacing c'è in Chrome e Safari recenti; dove manca la scritta è solo più stretta
  (g as Ctx & { letterSpacing?: string }).letterSpacing = `${px}px`;
}

/** Disegna la cartolina intera su un contesto 1080×1350. */
export function paintCard(g: Ctx, input: CardInput, layout: CardLayout, world: WorldContext | null): void {
  const W = CARD_W;
  const pal = cardPalette(input.worldId);
  const rgb = pal.rgb.join(',');
  g.save();
  g.fillStyle = pal.night;
  g.fillRect(0, 0, W, CARD_H);
  const hasTrack = input.track.length >= 2;
  if (hasTrack) paintMap(g, input, layout, input.inWorld ? world : null, pal);
  else if (input.profile.length > 1) paintProfile(g, input.profile, { x0: CARD_MARGIN, y0: 220, x1: W - CARD_MARGIN, y1: layout.mapBottom - 160 }, true);

  // sfumature: sopra per il marchio, sotto nel fondo dove comincia il testo
  const top = g.createLinearGradient(0, 0, 0, 230);
  top.addColorStop(0, `rgba(${rgb},0.92)`);
  top.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = top;
  g.fillRect(0, 0, W, 230);
  // la sfumatura comincia sotto la traccia: il via e l'arrivo restano accesi
  const fade0 = Math.min(layout.fit.y1 + 12, layout.mapBottom - 120);
  const bottom = g.createLinearGradient(0, fade0, 0, layout.mapBottom);
  bottom.addColorStop(0, `rgba(${rgb},0)`);
  bottom.addColorStop(1, `rgba(${rgb},1)`);
  g.fillStyle = bottom;
  g.fillRect(0, fade0, W, layout.mapBottom - fade0);
  g.fillStyle = pal.night;
  g.fillRect(0, layout.mapBottom, W, CARD_H - layout.mapBottom);

  if (layout.profile) paintProfile(g, input.profile, layout.profile, false);
  paintMark(g, layout.mark.x, layout.mark.y, layout.mark.size);
  if (layout.monumentsMark) diamond(g, layout.monumentsMark.x, layout.monumentsMark.y, 9);
  g.textBaseline = 'alphabetic';
  for (const t of layout.texts) {
    g.font = t.font;
    g.fillStyle = t.color;
    setSpacing(g, t.spacing);
    g.textAlign = 'left';
    g.fillText(t.text, t.box.x0, t.y);
  }
  setSpacing(g, 0);
  g.restore();
}

function paintMark(g: Ctx, x: number, y: number, size: number): void {
  g.save();
  g.translate(x, y);
  g.scale(size / 48, size / 48);
  g.translate(-8, -8);
  g.beginPath();
  g.arc(MARK.disc.cx, MARK.disc.cy, MARK.disc.r, 0, Math.PI * 2);
  g.fillStyle = C.gold;
  g.fill();
  g.clip();
  g.fillStyle = '#16130a';
  g.fill(new Path2D(MARK.ridge));
  g.strokeStyle = C.gold;
  g.lineWidth = 2.8;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke(new Path2D(MARK.road));
  g.restore();
}

/** Il segno dei monumenti, sulla carta e nella riga in basso: un rombo chiaro, distinto dall'oro della traccia. */
function diamond(g: Ctx, x: number, y: number, r: number): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fillStyle = C.ink;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = C.night;
  g.stroke();
}

function paintMap(g: Ctx, input: CardInput, layout: CardLayout, world: WorldContext | null, pal: CardPalette = cardPalette(input.worldId)): void {
  const W = CARD_W;
  const H = layout.mapBottom;
  const v = layout.view;
  const P = (x: number, z: number) => toCard(v, x, z);
  // i metri visibili, con un po' di margine
  const wx0 = v.cx + (0 - v.px) * v.mpp;
  const wx1 = v.cx + (W - v.px) * v.mpp;
  const wz0 = v.cz + (0 - v.py) * v.mpp;
  const wz1 = v.cz + (H - v.py) * v.mpp;
  const inView = (x: number, z: number, pad: number) => x > wx0 - pad && x < wx1 + pad && z > wz0 - pad && z < wz1 + pad;
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.clip();
  if (world) {
    if (world.far) paintRelief(g, world, layout, H, pal);
    const f = world.data.features;
    g.fillStyle = '#16252b';
    for (const l of f.lakes) {
      g.beginPath();
      for (let i = 0; i < l.ring.length; i += 2) {
        const p = P(l.ring[i], l.ring[i + 1]);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.fill();
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#27434e';
    for (const r of f.rivers) {
      if (r.kind === 'stream' && v.mpp > 14) continue;
      const pts = r.pts;
      if (!inView(pts[0], pts[1], 20000) && !inView(pts[pts.length - 3], pts[pts.length - 2], 20000)) continue;
      g.lineWidth = Math.max(r.kind === 'river' ? 3 : 1.6, (r.hw * 2) / v.mpp);
      g.beginPath();
      for (let i = 0; i < pts.length; i += 3) {
        const p = P(pts[i], pts[i + 1]);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.stroke();
    }
    // le strade, appena accennate: prima le minori
    const styles: [number[], string, number, number][] = [
      [[CLS.residential, CLS.pedestrian, CLS.cycleway], 'rgba(246,242,230,0.07)', 1.3, 9],
      [[CLS.unclassified], 'rgba(246,242,230,0.11)', 1.8, 30],
      [[CLS.tertiary], 'rgba(246,242,230,0.15)', 2.3, 80],
      [[CLS.secondary, CLS.primary, CLS.trunk], 'rgba(246,242,230,0.22)', 3, 1e9],
    ];
    for (const [classes, color, width, maxMpp] of styles) {
      if (v.mpp > maxMpp) continue;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (const e of world.data.graph.edges) {
        if (!classes.includes(e.cls)) continue;
        const m = e.xs.length;
        if (!inView(e.xs[0], e.zs[0], 600) && !inView(e.xs[m - 1], e.zs[m - 1], 600)) continue;
        const a = P(e.xs[0], e.zs[0]);
        g.moveTo(a.x, a.y);
        for (let k = 1; k < m; k++) {
          const p = P(e.xs[k], e.zs[k]);
          g.lineTo(p.x, p.y);
        }
      }
      g.stroke();
    }
  }

  // la traccia: pochi punti, un'ombra, l'oro con un alone
  const pts: { x: number; y: number }[] = [];
  for (const q of input.track) {
    const p = P(q.x, q.z);
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) pts.push(p);
  }
  const last = P(input.track[input.track.length - 1].x, input.track[input.track.length - 1].z);
  pts.push(last);
  const path = new Path2D();
  pts.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 19;
  g.stroke(path);
  g.save();
  g.shadowColor = 'rgba(255,200,20,0.55)';
  g.shadowBlur = 30;
  g.strokeStyle = C.gold;
  g.lineWidth = 7;
  g.stroke(path);
  g.restore();
  g.strokeStyle = C.gold;
  g.lineWidth = 6.5;
  g.stroke(path);
  for (const m of input.monuments) {
    const p = P(m.x, m.z);
    diamond(g, p.x, p.y, 8);
  }
  placeLabels(g, world, input, layout, pts, H);
  // il via: un pallino chiaro; l'arrivo: il disco d'oro
  const start = pts[0];
  g.lineWidth = 5;
  g.strokeStyle = C.night;
  g.fillStyle = C.ink;
  g.beginPath();
  g.arc(start.x, start.y, 11, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = C.gold;
  g.beginPath();
  g.arc(last.x, last.y, 15, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = C.night;
  g.beginPath();
  g.arc(last.x, last.y, 5, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Il rilievo ombreggiato, a un terzo della risoluzione: quote bilineari, luce da nord-ovest. */
function paintRelief(g: Ctx, world: WorldContext, layout: CardLayout, H: number, pal: CardPalette): void {
  const [r0, g0, b0] = pal.relief;
  const far = world.far;
  if (!far || typeof document === 'undefined') return;
  const f = world.data.graph.far;
  const v = layout.view;
  const k = 3;
  const w = Math.ceil(CARD_W / k);
  const h = Math.ceil(H / k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cg = c.getContext('2d');
  if (!cg) return;
  const img = cg.createImageData(w, h);
  const height = (x: number, z: number) => {
    const fx = Math.min(f.nx - 1.001, Math.max(0, (x - f.x0) / f.step));
    const fz = Math.min(f.nz - 1.001, Math.max(0, (z - f.z0) / f.step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const t = fz - j;
    const a = far[j * f.nx + i];
    const b = far[j * f.nx + i + 1];
    const cc = far[(j + 1) * f.nx + i];
    const d = far[(j + 1) * f.nx + i + 1];
    return a * (1 - u) * (1 - t) + b * u * (1 - t) + cc * (1 - u) * t + d * u * t;
  };
  const e = f.step / 2;
  const L = Math.hypot(-0.6, 0.55, -0.6);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = v.cx + (px * k - v.px) * v.mpp;
      const z = v.cz + (py * k - v.py) * v.mpp;
      const hz = height(x, z);
      const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
      const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
      const n = Math.hypot(dx, 1, dz);
      const shade = Math.max(0, (dx * 0.6 + 0.55 + dz * 0.6) / n / L);
      const tt = Math.min(1, Math.max(0, (hz - 200) / 1800));
      const s = 0.5 + shade * 1.1;
      const o = (py * w + px) * 4;
      img.data[o] = Math.min(255, (r0 + tt * 26) * s);
      img.data[o + 1] = Math.min(255, (g0 + tt * 22) * s);
      img.data[o + 2] = Math.min(255, (b0 + tt * 15) * s);
      img.data[o + 3] = 255;
    }
  }
  cg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, w * k, h * k);
}

/**
 * I nomi sulla carta: prima alcuni monumenti passati (il primo, l'ultimo e quelli in mezzo più
 * distanti), accanto al loro rombo; poi i paesi e i quartieri intorno, in maiuscoletto tenue.
 * Mai sopra la traccia, il marchio, il testo in basso o un altro nome.
 */
function placeLabels(g: Ctx, world: WorldContext | null, input: CardInput, layout: CardLayout, track: { x: number; y: number }[], H: number): void {
  const v = layout.view;
  const measure = canvasMeasure(g);
  const taken: Box[] = [{ x0: 0, y0: 0, x1: CARD_W, y1: 150 }];
  const bottom = layout.fit.y1 + 30;
  const free = (b: Box, pad: number) =>
    b.x0 >= CARD_MARGIN - 6 &&
    b.x1 <= CARD_W - CARD_MARGIN + 6 &&
    b.y0 >= 150 &&
    b.y1 <= Math.min(bottom, H) &&
    !taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0) &&
    !track.some((q) => q.x > b.x0 - pad && q.x < b.x1 + pad && q.y > b.y0 - pad && q.y < b.y1 + pad);
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';

  // i monumenti: fino a quattro, il primo e l'ultimo prima degli altri; chi non trova posto lascia il turno
  const mons = input.monuments;
  const order = mons.length > 1 ? [mons[0], mons[mons.length - 1], ...mons.slice(1, -1).sort((a, b) => Math.abs(mons.indexOf(a) - mons.length / 2) - Math.abs(mons.indexOf(b) - mons.length / 2))] : mons;
  const mf = font(600, 22, SANS);
  let placed = 0;
  for (const m of order) {
    if (placed >= 4) break;
    const c = toCard(v, m.x, m.z);
    const w = measure(m.name, mf, 0);
    // a destra, a sinistra, sopra o sotto il rombo: il primo posto libero
    const spots = [
      [c.x + 16, c.y + 7],
      [c.x - 16 - w, c.y + 7],
      [c.x - w / 2, c.y - 18],
      [c.x - w / 2, c.y + 34],
    ];
    for (const [x0, base] of spots) {
      const box = { x0: x0 - 4, y0: base - 20, x1: x0 + w + 4, y1: base + 5 };
      if (!free(box, 3)) continue;
      taken.push(box);
      g.font = mf;
      setSpacing(g, 0);
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(12,11,9,0.85)';
      g.strokeText(m.name, x0, base);
      g.fillStyle = 'rgba(246,242,230,0.92)';
      g.fillText(m.name, x0, base);
      placed++;
      break;
    }
  }

  // i paesi: città e paesi sempre, i villaggi da vicino, i quartieri e le frazioni da molto vicino
  if (!world) return;
  const rank = (k: string) => (k === 'city' ? 0 : k === 'town' ? 1 : k === 'village' ? 2 : k === 'suburb' || k === 'quarter' ? 3 : 4);
  const deepest = v.mpp < 4 ? 4 : v.mpp < 8 ? 3 : v.mpp < 25 ? 2 : 1;
  const size = 20;
  const f = font(600, size, SANS);
  let n = 0;
  const list = world.data.features.places.filter((p) => rank(p.kind) <= deepest).sort((a, b) => rank(a.kind) - rank(b.kind));
  for (const p of list) {
    if (n >= 7) break;
    const c = toCard(v, p.x, p.z);
    if (c.x < 0 || c.x > CARD_W || c.y < 150 || c.y > bottom) continue;
    const s = typo(p.name).toLocaleUpperCase('it-IT');
    const w = measure(s, f, 3);
    // al suo posto, o appena sopra o sotto se lì passa la strada
    for (const dy of [0, -28, 28]) {
      const box = { x0: c.x - w / 2 - 6, y0: c.y + dy - size - 6, x1: c.x + w / 2 + 6, y1: c.y + dy + 8 };
      if (!free(box, 8)) continue;
      taken.push(box);
      g.font = f;
      setSpacing(g, 3);
      g.fillStyle = 'rgba(246,242,230,0.5)';
      g.fillText(s, box.x0 + 6, c.y + dy);
      n++;
      break;
    }
  }
  setSpacing(g, 0);
}

function paintProfile(g: Ctx, profile: CardInput['profile'], box: Box, big: boolean): void {
  if (profile.length < 2) return;
  const d0 = profile[0].d;
  const d1 = profile[profile.length - 1].d;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of profile) {
    lo = Math.min(lo, p.alt);
    hi = Math.max(hi, p.alt);
  }
  const span = Math.max(30, hi - lo);
  const x = (d: number) => box.x0 + ((d - d0) / Math.max(1, d1 - d0)) * (box.x1 - box.x0);
  const y = (a: number) => box.y1 - ((a - lo) / span) * (box.y1 - box.y0);
  const step = Math.max(1, Math.floor(profile.length / 400));
  const line = new Path2D();
  for (let i = 0; i < profile.length; i += step) {
    const p = profile[i];
    if (i === 0) line.moveTo(x(p.d), y(p.alt));
    else line.lineTo(x(p.d), y(p.alt));
  }
  line.lineTo(x(d1), y(profile[profile.length - 1].alt));
  const area = new Path2D(line);
  area.lineTo(box.x1, box.y1);
  area.lineTo(box.x0, box.y1);
  area.closePath();
  const fill = g.createLinearGradient(0, box.y0, 0, box.y1);
  fill.addColorStop(0, 'rgba(255,200,20,0.34)');
  fill.addColorStop(1, 'rgba(255,200,20,0.02)');
  g.fillStyle = fill;
  g.fill(area);
  g.strokeStyle = C.gold;
  g.lineWidth = big ? 6 : 4;
  g.lineJoin = 'round';
  g.stroke(line);
  g.strokeStyle = 'rgba(246,242,230,0.14)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(box.x0, box.y1 + 1);
  g.lineTo(box.x1, box.y1 + 1);
  g.stroke();
}

// ---------------------------------------------------------------------------
// Il PNG, e come esce dal telefono.

async function fontsReady(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  await Promise.all([fonts.load(font(800, 100, DISPLAY)), fonts.load(font(700, 100, DISPLAY)), fonts.load(font(500, 24, SANS)), fonts.load(font(600, 24, SANS))]).catch(() => undefined);
}

/** La cartolina come PNG 1080×1350. */
export async function renderCard(input: CardInput, world: WorldContext | null): Promise<Blob> {
  await fontsReady();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas non disponibile.');
  const layout = layoutCard(input, canvasMeasure(g));
  paintCard(g, input, layout, world);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG non riuscito.'))), 'image/png'));
}

export type ShareOutcome = 'condivisa' | 'scaricata' | 'annullata';

/** Col pannello del telefono se sa condividere un file; altrimenti si scarica il PNG. */
export async function shareCard(blob: Blob, title: string): Promise<ShareOutcome> {
  const name = safeFileName(`orobia ${title}`, 'png');
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `${title} · ${BRAND.name}` });
      return 'condivisa';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'annullata';
    }
  }
  downloadCard(blob, title);
  return 'scaricata';
}

export function downloadCard(blob: Blob, title: string): void {
  void blob.arrayBuffer().then((buf) => downloadBytes(safeFileName(`orobia ${title}`, 'png'), new Uint8Array(buf), 'image/png'));
}
