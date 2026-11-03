import * as THREE from 'three';
import { DEFAULT_LOOK, type Look, type Pattern } from '@/game/look';
import type { UvRect } from './riderGeo';

/*
 * La divisa del ciclista in una texture sola (l'«atlante»): in alto lo sviluppo della maglia e
 * delle maniche, poi il casco e la scritta sul tubo obliquo, sotto una tavolozza di tinte unite
 * (pelle, pantaloncini, telaio, gomme…). La geometria è la stessa per tutti: cambia solo questa
 * tela, quindi venti ciclisti diversi costano venti texture piccole e una geometria.
 */

// ---------- disposizione dell'atlante (coordinate della tela 0..1, y in basso) ----------

/** rettangolo in coordinate della tela (x a destra, y in BASSO) → rettangolo uv (v in alto) */
function rect(x0: number, y0: number, x1: number, y1: number): UvRect {
  return { u0: x0, v0: 1 - y1, u1: x1, v1: 1 - y0 };
}

export const ATLAS = {
  /** maglia: u intorno al busto (0 = davanti, 0,5 = schiena), v dalla vita (0) al collo (1) */
  jersey: rect(0, 0, 0.75, 0.5),
  /** maniche: u intorno al braccio, v dalla spalla (1) all'orlo (0) */
  sleeve: rect(0.75, 0, 1, 0.5),
  /** scritta sul tubo obliquo: u lungo il tubo, v intorno */
  decal: rect(0, 0.5, 0.5, 0.625),
  /** casco: u dalla fronte alla nuca, v da sinistra a destra sopra la testa */
  helmet: rect(0.75, 0.5, 1, 0.75),
} as const;

/** Le tinte unite della tavolozza, nell'ordine delle caselle (8 colonne × 4 righe). */
export const SWATCHES = [
  'skin',
  'shorts',
  'shortsHem',
  'sock',
  'sockCuff',
  'shoe',
  'sole',
  'shoeAccent',
  'glove',
  'gloveBack',
  'lens',
  'glassesFrame',
  'hair',
  'eye',
  'strap',
  'frame',
  'frameAccent',
  'carbon',
  'tape',
  'hood',
  'rim',
  'rimStripe',
  'tyre',
  'spoke',
  'hub',
  'metal',
  'rotor',
  'chainring',
  'pedal',
  'bottle',
  'saddle',
  'black',
] as const;
export type Swatch = (typeof SWATCHES)[number];

const SW_COLS = 8;
const SW_X0 = 0;
const SW_Y0 = 0.625;
const SW_W = 0.75 / SW_COLS;
const SW_H = 0.375 / 4;

/** Il centro di una casella, in uv. */
export function swatchUv(s: Swatch): [number, number] {
  const i = SWATCHES.indexOf(s);
  const cx = SW_X0 + ((i % SW_COLS) + 0.5) * SW_W;
  const cy = SW_Y0 + (Math.floor(i / SW_COLS) + 0.5) * SW_H;
  return [cx, 1 - cy];
}

// ---------- colori ----------

function lum(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function far(a: string, b: string): boolean {
  const x = new THREE.Color(a);
  const y = new THREE.Color(b);
  return Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b) > 0.45;
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  if (k < 0) c.multiplyScalar(1 + k);
  else c.lerp(new THREE.Color('#ffffff'), k);
  return `#${c.getHexString()}`;
}

/** La tinta di ogni casella per un aspetto. */
export function palette(look: Look): Record<Swatch, string> {
  const light = lum(look.frame) > 0.55;
  const contact = light ? '#efece3' : '#1d1c1a';
  return {
    skin: look.skin ?? DEFAULT_LOOK.skin ?? '#d9ad8c',
    shorts: look.shorts,
    shortsHem: far(look.jersey, look.shorts) ? look.jersey : look.accent,
    sock: look.socks,
    sockCuff: far(look.jersey, look.socks) ? look.jersey : look.accent,
    shoe: look.shoes,
    sole: '#232428',
    shoeAccent: far(look.accent, look.shoes) ? look.accent : '#26272b',
    glove: '#1d1e22',
    gloveBack: look.jersey,
    lens: look.glasses || '#2b2b2b',
    glassesFrame: far(look.helmet, look.glasses || '#2b2b2b') ? look.helmet : '#16171a',
    hair: '#3b2a1d',
    eye: '#1d1712',
    strap: '#1d1e21',
    frame: look.frame,
    frameAccent: look.frameAccent,
    carbon: '#1c1d20',
    tape: contact,
    hood: '#17181a',
    rim: '#1a1b1e',
    rimStripe: look.frameAccent,
    tyre: '#1b1c1e',
    spoke: '#303237',
    hub: '#2e3035',
    metal: '#9ea4ab',
    rotor: '#b9bec4',
    chainring: '#24262b',
    pedal: '#18191c',
    bottle: look.frameAccent,
    saddle: contact,
    black: '#202226',
  };
}

/** [ruvidità, metallicità] di ogni casella: il telaio lucido, la stoffa opaca, la catena d'acciaio. */
const FINISH: Record<Swatch, [number, number]> = {
  skin: [0.6, 0],
  shorts: [0.62, 0],
  shortsHem: [0.5, 0],
  sock: [0.85, 0],
  sockCuff: [0.8, 0],
  shoe: [0.32, 0],
  sole: [0.45, 0],
  shoeAccent: [0.35, 0],
  glove: [0.8, 0],
  gloveBack: [0.6, 0],
  lens: [0.08, 0.35],
  glassesFrame: [0.3, 0],
  hair: [0.9, 0],
  eye: [0.2, 0],
  strap: [0.7, 0],
  frame: [0.22, 0],
  frameAccent: [0.22, 0],
  carbon: [0.32, 0],
  tape: [0.75, 0],
  hood: [0.78, 0],
  rim: [0.3, 0],
  rimStripe: [0.3, 0],
  tyre: [0.85, 0],
  spoke: [0.4, 0.4],
  hub: [0.35, 0.4],
  metal: [0.35, 0.55],
  rotor: [0.3, 0.55],
  chainring: [0.35, 0.3],
  pedal: [0.5, 0],
  bottle: [0.4, 0],
  saddle: [0.5, 0],
  black: [0.45, 0],
};

// ---------- la tela ----------

/** Lato della texture per livello di dettaglio. */
export const KIT_SIZE = { alta: 512, media: 256, bassa: 128 } as const;

/** Quello che si scrive sulla schiena e sul telaio. */
export const WORDMARK = 'OROBIA';

/** Chiave stabile di un aspetto: due oggetti uguali danno la stessa texture. */
export function lookKey(l: Look): string {
  return [l.jersey, l.accent, l.pattern, l.shorts, l.helmet, l.socks, l.shoes, l.frame, l.frameAccent, l.rim, l.glasses, l.skin ?? ''].join('|');
}

/** Disegna l'atlante di un aspetto su una tela quadrata di lato `N`. */
export function drawKit(g: CanvasRenderingContext2D, N: number, look: Look): void {
  const pal = palette(look);
  g.save();
  g.clearRect(0, 0, N, N);
  // caselle
  SWATCHES.forEach((s, i) => {
    g.fillStyle = pal[s];
    const x = (SW_X0 + (i % SW_COLS) * SW_W) * N;
    const y = (SW_Y0 + Math.floor(i / SW_COLS) * SW_H) * N;
    g.fillRect(Math.floor(x), Math.floor(y), Math.ceil(SW_W * N) + 1, Math.ceil(SW_H * N) + 1);
  });
  drawJersey(g, 0, 0, 0.75 * N, 0.5 * N, look, N >= 512);
  drawSleeve(g, 0.75 * N, 0, 0.25 * N, 0.5 * N, look);
  drawHelmet(g, 0.75 * N, 0.5 * N, 0.25 * N, 0.25 * N, look);
  drawDecal(g, 0, 0.5 * N, 0.5 * N, 0.125 * N, look);
  // angolo libero: la tinta della maglia (per le mipmap, niente buchi neri ai bordi)
  g.fillStyle = look.jersey;
  g.fillRect(0.5 * N, 0.5 * N, 0.25 * N, 0.125 * N);
  g.fillRect(0.75 * N, 0.75 * N, 0.25 * N, 0.25 * N);
  g.restore();
}

/** La maglia sviluppata: x = u (0 davanti, ½ schiena), y = 1 − v (in alto il collo). */
function drawJersey(g: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, look: Look, fine: boolean): void {
  const { jersey: base, accent, pattern } = look;
  const yv = (v: number) => Y + (1 - v) * H;
  const HEM = 0.17;
  g.save();
  g.beginPath();
  g.rect(X, Y, W, H);
  g.clip();
  g.fillStyle = base;
  g.fillRect(X, Y, W, H);
  // il disegno, ripetuto a cavallo della cucitura davanti (u = 0 = 1)
  for (const dx of [-W, 0, W]) {
    g.save();
    g.translate(X + dx, 0);
    drawPattern(g, W, H, Y, pattern, base, accent, yv);
    g.restore();
  }
  // fianchi in tessuto diverso: un'ombra leggera sui lati dà la forma al busto
  for (const u of [0.25, 0.75]) {
    const grd = g.createLinearGradient(X + (u - 0.07) * W, 0, X + (u + 0.07) * W, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.16)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(X + (u - 0.07) * W, Y, 0.14 * W, H);
  }
  // tasche sulla schiena: tre, sopra l'orlo
  const dark = lum(base) > 0.5 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.2)';
  g.strokeStyle = dark;
  g.lineWidth = Math.max(1, H * 0.012);
  g.beginPath();
  g.moveTo(X + 0.405 * W, yv(0.33));
  g.lineTo(X + 0.595 * W, yv(0.33));
  for (const u of [0.468, 0.532]) {
    g.moveTo(X + u * W, yv(0.33));
    g.lineTo(X + u * W, yv(HEM + 0.02));
  }
  g.stroke();
  // cerniera davanti
  g.fillStyle = lum(base) > 0.5 ? 'rgba(20,20,22,0.55)' : 'rgba(240,240,236,0.5)';
  const zw = Math.max(1, W * 0.006);
  g.fillRect(X, yv(1), zw, yv(HEM) - yv(1));
  g.fillRect(X + W - zw, yv(1), zw, yv(HEM) - yv(1));
  // scritta sulla schiena, sopra le tasche
  if (fine) {
    g.fillStyle = far(accent, base) ? accent : lum(base) > 0.5 ? '#16130a' : '#f4f1e8';
    g.font = `800 ${Math.round(H * 0.075)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // vista da dietro la u cresce verso sinistra: la scritta si disegna specchiata
    g.save();
    g.translate(X + 0.5 * W, yv(0.41));
    g.scale(-1, 1);
    g.fillText(WORDMARK, 0, 0);
    g.restore();
  }
  // colletto e orlo
  g.fillStyle = pattern === 'spalle' ? base : accent;
  g.fillRect(X, yv(1), W, yv(0.955) - yv(1));
  g.fillStyle = shade(base, -0.28);
  g.fillRect(X, yv(HEM + 0.03), W, yv(HEM) - yv(HEM + 0.03));
  // sotto l'orlo, i pantaloncini (la salopette)
  g.fillStyle = look.shorts;
  g.fillRect(X, yv(HEM), W, Y + H - yv(HEM));
  g.restore();
}

function drawPattern(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  Y: number,
  pattern: Pattern,
  base: string,
  accent: string,
  yv: (v: number) => number,
) {
  g.fillStyle = accent;
  g.strokeStyle = accent;
  switch (pattern) {
    case 'tinta':
      return;
    case 'fascia': {
      g.fillRect(0, yv(0.74), W, yv(0.56) - yv(0.74));
      // due filetti chiari ai bordi della fascia
      g.fillStyle = shade(base, 0.55);
      g.fillRect(0, yv(0.755), W, H * 0.008);
      g.fillRect(0, yv(0.56), W, H * 0.008);
      return;
    }
    case 'righe':
      for (let v = 0.22; v < 0.97; v += 0.085) g.fillRect(0, yv(v + 0.034), W, yv(v) - yv(v + 0.034));
      return;
    case 'cerchi':
      for (let v = 0.2; v < 1; v += 0.26) g.fillRect(0, yv(v + 0.13), W, yv(v) - yv(v + 0.13));
      return;
    case 'pois': {
      const s = W / 13;
      const r = s * 0.27;
      for (let row = 0, y = Y + s * 0.4; y < Y + H + s; y += s * 0.87, row++) {
        for (let x = (row % 2) * s * 0.5; x < W + s; x += s) {
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      return;
    }
    case 'chevron': {
      g.lineJoin = 'miter';
      for (const cx of [0, W / 2, W]) {
        g.lineWidth = H * 0.11;
        g.beginPath();
        g.moveTo(cx - 0.21 * W, yv(1.02));
        g.lineTo(cx, yv(0.5));
        g.lineTo(cx + 0.21 * W, yv(1.02));
        g.stroke();
        g.lineWidth = H * 0.035;
        g.beginPath();
        g.moveTo(cx - 0.21 * W, yv(0.82));
        g.lineTo(cx, yv(0.33));
        g.lineTo(cx + 0.21 * W, yv(0.82));
        g.stroke();
      }
      return;
    }
    case 'sfumato': {
      const grd = g.createLinearGradient(0, yv(0.15), 0, yv(0.85));
      grd.addColorStop(0, accent);
      grd.addColorStop(1, base);
      g.fillStyle = grd;
      g.fillRect(0, Y, W, H);
      return;
    }
    case 'spalle':
      g.fillRect(0, Y, W, yv(0.74) - Y);
      g.fillStyle = shade(base, 0.6);
      g.fillRect(0, yv(0.74), W, H * 0.012);
      return;
    case 'diagonale': {
      g.lineWidth = H * 0.17;
      g.lineCap = 'butt';
      for (const [cx, k] of [
        [0, 1],
        [W / 2, -1],
        [W, 1],
      ] as const) {
        g.beginPath();
        g.moveTo(cx - k * 0.24 * W, yv(1.05));
        g.lineTo(cx + k * 0.24 * W, yv(0.12));
        g.stroke();
      }
      return;
    }
    case 'quadri': {
      const s = W / 14;
      for (let j = 0; j * s < H; j++)
        for (let i = 0; i * s < W; i++) if ((i + j) % 2 === 0) g.fillRect(i * s, Y + j * s, Math.ceil(s), Math.ceil(s));
      return;
    }
  }
}

/** Manica: x intorno al braccio, y dalla spalla (in alto) all'orlo (in basso). */
function drawSleeve(g: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, look: Look): void {
  const { jersey: base, accent, pattern } = look;
  const yv = (v: number) => Y + (1 - v) * H;
  g.save();
  g.beginPath();
  g.rect(X, Y, W, H);
  g.clip();
  const sleeveBase = pattern === 'spalle' ? accent : base;
  g.fillStyle = sleeveBase;
  g.fillRect(X, Y, W, H);
  g.fillStyle = accent;
  switch (pattern) {
    case 'righe':
      for (let v = 0.2; v < 1; v += 0.2) g.fillRect(X, yv(v + 0.08), W, yv(v) - yv(v + 0.08));
      break;
    case 'cerchi':
      g.fillRect(X, yv(0.75), W, yv(0.42) - yv(0.75));
      break;
    case 'fascia':
      g.fillRect(X, yv(0.62), W, yv(0.4) - yv(0.62));
      break;
    case 'pois': {
      const s = W / 3.2;
      for (let row = 0, y = Y + s * 0.4; y < Y + H + s; y += s * 0.8, row++)
        for (let x = X + (row % 2) * s * 0.5; x < X + W + s; x += s) {
          g.beginPath();
          g.ellipse(x, y, s * 0.26, s * 0.21, 0, 0, Math.PI * 2);
          g.fill();
        }
      break;
    }
    case 'quadri': {
      const s = W / 4;
      for (let j = 0; j * s < H; j++) for (let i = 0; i * s < W; i++) if ((i + j) % 2 === 0) g.fillRect(X + i * s, Y + j * s, Math.ceil(s), Math.ceil(s));
      break;
    }
    case 'sfumato': {
      const grd = g.createLinearGradient(0, yv(0), 0, yv(1));
      grd.addColorStop(0, shade(base, 0));
      grd.addColorStop(1, base);
      g.fillStyle = grd;
      g.fillRect(X, Y, W, H);
      break;
    }
    default:
      break;
  }
  // polsino dell'altro colore
  g.fillStyle = pattern === 'spalle' ? base : accent;
  g.fillRect(X, yv(0.13), W, Y + H - yv(0.13));
  g.restore();
}

/** Casco: x = dalla fronte alla nuca, y = da un lato all'altro. Prese d'aria e una riga. */
function drawHelmet(g: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, look: Look): void {
  g.save();
  g.beginPath();
  g.rect(X, Y, W, H);
  g.clip();
  g.fillStyle = look.helmet;
  g.fillRect(X, Y, W, H);
  // la riga centrale col colore della maglia (o dell'accento, se il casco è già di quel colore)
  const stripe = far(look.helmet, look.jersey) ? look.jersey : look.accent;
  g.fillStyle = stripe;
  g.fillRect(X, Y + H * 0.44, W, H * 0.12);
  // coda e bordo
  g.fillRect(X + W * 0.86, Y, W * 0.14, H);
  g.fillStyle = shade(look.helmet, -0.35);
  g.fillRect(X, Y, W, H * 0.06);
  g.fillRect(X, Y + H * 0.94, W, H * 0.06);
  // prese d'aria: fessure scure dalla fronte verso la nuca
  g.fillStyle = '#121315';
  const vents = [0.2, 0.33, 0.5, 0.67, 0.8];
  for (const v of vents) {
    const len = v === 0.5 ? 0.5 : 0.42;
    const x0 = X + W * (v === 0.5 ? 0.14 : 0.2);
    const h = H * (v === 0.5 ? 0.055 : 0.07);
    const y = Y + H * v - h / 2;
    g.beginPath();
    g.roundRect(x0, y, W * len, h, h / 2);
    g.fill();
  }
  g.restore();
}

/** Il tubo obliquo: tinta del telaio e la scritta nell'accento, leggibile dai due lati. */
function drawDecal(g: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, look: Look): void {
  g.save();
  g.beginPath();
  g.rect(X, Y, W, H);
  g.clip();
  g.fillStyle = look.frame;
  g.fillRect(X, Y, W, H);
  g.fillStyle = look.frameAccent;
  g.font = `900 ${Math.round(H * 0.27)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // v = 0,25 è il fianco sinistro (+x), 0,75 il destro: la scritta va letta dritta da tutti e due
  for (const [v, sx, sy] of [
    [0.25, -1, 1],
    [0.75, 1, -1],
  ] as const) {
    g.save();
    g.translate(X + W * 0.55, Y + (1 - v) * H);
    g.scale(sx * 1.4, sy);
    g.fillText(WORDMARK, 0, 0);
    g.restore();
  }
  // filetto vicino al movimento centrale
  g.fillRect(X + W * 0.06, Y, W * 0.025, H);
  g.restore();
}

/** Ruvidità (verde) e metallicità (blu) con la stessa disposizione dell'atlante: una per tutti. */
function drawFinish(g: CanvasRenderingContext2D, N: number): void {
  const col = (r: number, m: number) => `rgb(255,${Math.round(r * 255)},${Math.round(m * 255)})`;
  g.fillStyle = col(0.72, 0);
  g.fillRect(0, 0, N, N);
  // casco e scritta lucidi
  g.fillStyle = col(0.3, 0);
  g.fillRect(0.75 * N, 0.5 * N, 0.25 * N, 0.25 * N);
  g.fillStyle = col(0.24, 0);
  g.fillRect(0, 0.5 * N, 0.5 * N, 0.125 * N);
  SWATCHES.forEach((s, i) => {
    const [r, m] = FINISH[s];
    g.fillStyle = col(r, m);
    g.fillRect(Math.floor((SW_X0 + (i % SW_COLS) * SW_W) * N), Math.floor((SW_Y0 + Math.floor(i / SW_COLS) * SW_H) * N), Math.ceil(SW_W * N) + 1, Math.ceil(SW_H * N) + 1);
  });
}

// ---------- texture e materiali, con una piccola cache ----------

export type KitDetail = keyof typeof KIT_SIZE;

interface Entry<T> {
  value: T;
  used: number;
}

const MAX = 40;
let tick = 0;
const textures = new Map<string, Entry<THREE.CanvasTexture>>();
const materials = new Map<string, Entry<THREE.Material>>();
let finishTex: THREE.CanvasTexture | null = null;

function evict<T extends { dispose(): void }>(map: Map<string, Entry<T>>) {
  if (map.size <= MAX) return;
  // la meno usata di recente: se un ciclista la mostra ancora, three la ricarica da sola
  let oldest: string | null = null;
  let t = Infinity;
  for (const [k, e] of map)
    if (e.used < t) {
      t = e.used;
      oldest = k;
    }
  if (oldest) {
    map.get(oldest)?.value.dispose();
    map.delete(oldest);
  }
}

export function kitTexture(look: Look, detail: KitDetail): THREE.CanvasTexture {
  const key = `${lookKey(look)}#${detail}`;
  const hit = textures.get(key);
  if (hit) {
    hit.used = ++tick;
    return hit.value;
  }
  const N = KIT_SIZE[detail];
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d');
  if (g) drawKit(g, N, look);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = detail === 'alta' ? 4 : 1;
  textures.set(key, { value: t, used: ++tick });
  evict(textures);
  return t;
}

function finishTexture(): THREE.CanvasTexture {
  if (finishTex) return finishTex;
  const N = 128;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d');
  if (g) drawFinish(g, N);
  finishTex = new THREE.CanvasTexture(c);
  // dati, non colore: niente conversione sRGB
  finishTex.colorSpace = THREE.NoColorSpace;
  return finishTex;
}

/**
 * Il materiale di un aspetto: fisico (lucidi e opachi veri) per chi è vicino, Lambert per la
 * folla. Condiviso fra tutti i ciclisti con lo stesso aspetto e dettaglio.
 */
export function kitMaterial(look: Look, detail: KitDetail): THREE.Material {
  const key = `${lookKey(look)}#${detail}`;
  const hit = materials.get(key);
  if (hit) {
    hit.used = ++tick;
    return hit.value;
  }
  const map = kitTexture(look, detail);
  const m =
    detail === 'alta'
      ? new THREE.MeshStandardMaterial({ map, roughnessMap: finishTexture(), metalnessMap: finishTexture(), roughness: 1, metalness: 1, envMapIntensity: 0.8 })
      : new THREE.MeshLambertMaterial({ map });
  materials.set(key, { value: m, used: ++tick });
  evict(materials);
  return m;
}
