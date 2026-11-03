import * as THREE from 'three';
import type { DemGrid } from '@/domain/routes';
import type { Track, TrackPoint, TrackPose } from '@/domain/track';
import type { HeightField } from './heightfield';
import { RAIL_POST_STEP, RAIL_SPACER, railFrames, sweepBeam, type Tri } from './roadside';

/*
 * Geometrie del mondo, tutte generate dalla traccia vera e dal DEM.
 * Convenzione: per una direzione h, avanti = (sin h, 0, cos h) e il vettore laterale
 * L = (cos h, 0, −sin h) punta a SINISTRA di chi pedala (z è verso sud).
 */

// ---------- colori del terreno, per fascia di quota ----------

const C = {
  valley: new THREE.Color('#5d8a3c'),
  valley2: new THREE.Color('#77a04a'),
  forest: new THREE.Color('#3f6a33'),
  meadow: new THREE.Color('#8c9a52'),
  alpine: new THREE.Color('#9b9566'),
  rock: new THREE.Color('#8a857c'),
  rockDark: new THREE.Color('#6c6862'),
  scree: new THREE.Color('#a29d93'),
  snow: new THREE.Color('#eef2f6'),
  dirt: new THREE.Color('#9c8b6c'),
};

const tmp = new THREE.Color();

/** Colore del suolo da quota vera, pendenza (ny della normale) ed esposizione. */
export function groundColor(out: THREE.Color, alt: number, ny: number, nzSouth: number, noise: number, roadDist: number): THREE.Color {
  if (alt < 1100) out.copy(C.valley).lerp(C.valley2, noise);
  else if (alt < 1850) out.copy(C.forest).lerp(C.valley, noise * 0.5);
  else if (alt < 2250) out.copy(C.meadow).lerp(C.forest, Math.max(0, (1950 - alt) / 300) * 0.6);
  else if (alt < 2650) out.copy(C.alpine).lerp(C.scree, noise * 0.5);
  else out.copy(C.scree).lerp(C.rock, noise);
  // pareti ripide: roccia, qualunque sia la quota
  const steep = THREE.MathUtils.smoothstep(1 - ny, 0.22, 0.42);
  if (steep > 0) out.lerp(tmp.copy(C.rock).lerp(C.rockDark, noise), steep);
  // neve sopra i 2700 m sui versanti a nord, poco ripidi
  if (alt > 2700 && ny > 0.7 && nzSouth < 0.15) out.lerp(C.snow, THREE.MathUtils.smoothstep(alt, 2700, 2950) * 0.85);
  // terra battuta ai bordi della carreggiata
  if (roadDist < 7) out.lerp(C.dirt, 1 - roadDist / 7);
  return out;
}

export function hash2(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- terreno vicino, ricostruito a pezzi intorno al ciclista ----------

export interface TileSpec {
  cx: number;
  cz: number;
  size: number;
  spacing: number;
}

/** Calcola un riquadro di terreno a fette, così non blocca un fotogramma. */
export function* tileJob(field: HeightField, spec: TileSpec): Generator<number, THREE.BufferGeometry, void> {
  const n = Math.round(spec.size / spec.spacing);
  const verts = n + 1;
  const pos = new Float32Array(verts * verts * 3);
  const col = new Float32Array(verts * verts * 3);
  const dist = new Float32Array(verts * verts);
  const half = (n * spec.spacing) / 2;
  for (let j = 0; j < verts; j++) {
    const z = spec.cz - half + j * spec.spacing;
    for (let i = 0; i < verts; i++) {
      const x = spec.cx - half + i * spec.spacing;
      const k = j * verts + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = field.height(x, z, spec.spacing);
      pos[k * 3 + 2] = z;
      dist[k] = field.lastRoadDist();
    }
    if (j % 8 === 7) yield j / verts;
  }
  const idx = new Uint32Array(n * n * 6);
  let t = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * verts + i;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      idx[t++] = a;
      idx[t++] = c;
      idx[t++] = b;
      idx[t++] = b;
      idx[t++] = c;
      idx[t++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let k = 0; k < verts * verts; k++) {
    const x = pos[k * 3];
    const z = pos[k * 3 + 2];
    groundColor(c, pos[k * 3 + 1] + field.altitudeBase, nrm.getY(k), nrm.getZ(k), hash2(Math.floor(x / 23), Math.floor(z / 23)), dist[k]);
    col[k * 3] = c.r;
    col[k * 3 + 1] = c.g;
    col[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

export function runToEnd<T>(gen: Generator<number, T, void>): T {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

// ---------- terreno lontano, direttamente dal DEM ----------

export function buildFarTerrain(dem: DemGrid, altitudeBase: number, sink: number): THREE.BufferGeometry {
  const { nx, nz, step, x0, z0, heights } = dem;
  const geo = new THREE.PlaneGeometry((nx - 1) * step, (nz - 1) * step, nx - 1, nz - 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x0 + ((nx - 1) * step) / 2, 0, z0 + ((nz - 1) * step) / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // PlaneGeometry ruotata: le righe vanno da z0 a z0+..., una riga ogni nx vertici
  let fallback = altitudeBase;
  for (let k = 0; k < pos.count; k++) {
    const v = heights[k];
    if (v != null) fallback = v;
    pos.setY(k, (v ?? fallback) - altitudeBase - sink);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    groundColor(c, pos.getY(k) + altitudeBase + sink, nrm.getY(k), nrm.getZ(k), hash2(Math.floor(pos.getX(k) / 120), Math.floor(pos.getZ(k) / 120)), 99);
    c.toArray(col, k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Materiale del terreno lontano: scarta i frammenti dentro il riquadro vicino. */
export function farTerrainMaterial(tile: { value: THREE.Vector3 }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = tile;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform vec3 uTile;')
      .replace('void main() {', 'void main() {\n  if (abs(vWPos.x - uTile.x) < uTile.z && abs(vWPos.z - uTile.y) < uTile.z) discard;');
  };
  return mat;
}

// ---------- strada ----------

/** Striscia tra due scostamenti laterali (a sinistra positivi), con sollevamenti propri. */
export function strip(
  points: TrackPoint[],
  a: number,
  liftA: number,
  b: number,
  liftB: number,
  opts: { uvLength?: number; filter?: (p: TrackPoint, i: number) => boolean } = {},
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const uvLength = opts.uvLength ?? 8;
  let prevKept = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const keep = opts.filter ? opts.filter(p, i) : true;
    if (!keep) {
      prevKept = false;
      continue;
    }
    const lx = Math.cos(p.heading);
    const lz = -Math.sin(p.heading);
    const base = pos.length / 3;
    pos.push(p.x + lx * a, p.y + liftA, p.z + lz * a, p.x + lx * b, p.y + liftB, p.z + lz * b);
    uv.push(0, p.distance / uvLength, 1, p.distance / uvLength);
    if (prevKept) {
      const pa = base - 2;
      const pb = base - 1;
      // L × avanti punta in basso: con b < a (da sinistra a destra) la faccia deve girare così
      if (b < a) idx.push(pa, pb, base, pb, base + 1, base);
      else idx.push(pa, base, pb, pb, base, base + 1);
    }
    prevKept = true;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** L'asfalto si ripete ogni tanti metri lungo la strada: la trama copre tutta la larghezza. */
export const ASPHALT_REPEAT_M = 20;

/**
 * Asfalto disegnato a canvas, tutta la carreggiata × 20 m: grana dell'inerte a due scale, sassolini
 * chiari, le quattro tracce delle ruote più lisce e scure (due corsie), la riga d'olio in mezzo alla
 * corsia, rattoppi più neri coi bordi netti, crepe e sigillature di catrame. Quasi grigio: il
 * colore vero lo dà il materiale (asciutto o bagnato).
 */
export function asphaltTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (g) {
    let seed = 11;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // macchie larghe (stesure diverse, umidità) su una griglia di 32 px, interpolate
    const GX = W / 32 + 1;
    const GY = H / 32 + 1;
    const blot = Array.from({ length: GX * GY }, () => (rnd() - 0.5) * 12);
    const tracks = [0.17, 0.33, 0.67, 0.83];
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const gy = y / 32;
      const j = Math.floor(gy);
      const v = gy - j;
      for (let x = 0; x < W; x++) {
        const gx = x / 32;
        const i = Math.floor(gx);
        const u = gx - i;
        const k = j * GX + i;
        const big = blot[k] * (1 - u) * (1 - v) + blot[k + 1] * u * (1 - v) + blot[k + GX] * (1 - u) * v + blot[k + GX + 1] * u * v;
        // tracce delle ruote: lisce (meno grana) e un filo più scure
        const ux = x / W;
        let wear = 0;
        for (const t of tracks) wear = Math.max(wear, Math.max(0, 1 - Math.abs(ux - t) / 0.055));
        const oil = Math.max(0, 1 - Math.abs(Math.abs(ux - 0.5) - 0.25) / 0.03) * 0.5;
        const grain = (rnd() - 0.5) * (34 - wear * 16);
        let l = 78 + big + grain - wear * 7 - oil * 6;
        // sassolini dell'inerte, più radi nelle tracce consumate
        if (rnd() < 0.035 * (1 - wear * 0.6)) l += 26 + rnd() * 22;
        const o = (y * W + x) * 4;
        d[o] = l;
        d[o + 1] = l + 1;
        d[o + 2] = l + 4;
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // rattoppi: rettangoli di asfalto più nuovo, appena più scuri, col giunto sigillato attorno
    for (let p = 0; p < 3; p++) {
      const w = 26 + rnd() * 50;
      const h = 50 + rnd() * 120;
      const x = rnd() * (W - w);
      const y = rnd() * (H - h);
      g.fillStyle = `rgba(30,32,35,${0.12 + rnd() * 0.08})`;
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(18,19,21,0.35)';
      g.lineWidth = 2;
      g.strokeRect(x, y, w, h);
    }
    // crepe: spezzate sottili, e qualche sigillatura di catrame lucido (più larga)
    for (let c = 0; c < 12; c++) {
      const seal = c < 3;
      g.strokeStyle = seal ? 'rgba(16,17,19,0.32)' : 'rgba(20,21,24,0.4)';
      g.lineWidth = seal ? 2.2 : 1;
      g.beginPath();
      let x = rnd() * W;
      let y = rnd() * H;
      g.moveTo(x, y);
      const along = rnd() < 0.6;
      for (let s = 0; s < 14; s++) {
        x += along ? (rnd() - 0.5) * 10 : 6 + rnd() * 10;
        y += along ? 6 + rnd() * 14 : (rnd() - 0.5) * 8;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // la mezzeria vecchia cancellata col fresatore: una banda appena più scura al centro
    g.fillStyle = 'rgba(30,32,36,0.08)';
    g.fillRect(W * 0.485, 0, W * 0.03, H);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Mezzeria tratteggiata (4,5 m pieno, 7,5 m vuoto), solo dove la strada è larga. */
export function centerDashes(track: Track): THREE.BufferGeometry {
  return strip(track.points, 0.06, 0.015, -0.06, 0.015, {
    filter: (p) => p.distance % 12 < 4.5,
  });
}

export interface RoadsidePost {
  x: number;
  y: number;
  z: number;
  /** direzione della strada */
  h: number;
  /** +1 a sinistra di chi va avanti, −1 a destra */
  side: 1 | -1;
}

export interface RailRun {
  /** la lama a doppia onda, terminali interrati compresi */
  geometry: THREE.BufferGeometry;
  /** paletti a C ogni 4 m */
  posts: RoadsidePost[];
  /** delineatori bianchi dove non c'è guardrail */
  delineators: RoadsidePost[];
}

/**
 * Guardrail dove il terreno scende: si confronta la quota del terreno a 7 m dal bordo con quella
 * della strada. È il DEM a dire dov'è il vuoto, non un disegno. Le file più corte di tre paletti
 * non si mettono, un buco di un paletto si chiude. Dove non c'è guardrail, i delineatori di
 * margine ogni 40 m (ogni 20 nelle curve).
 */
export function buildGuardrails(track: Track, field: HeightField): RailRun {
  const hw = track.halfWidth;
  const m: Tri = { pos: [], idx: [] };
  const posts: RoadsidePost[] = [];
  const delineators: RoadsidePost[] = [];
  const step = RAIL_POST_STEP;
  const n = Math.floor(track.length / step);
  for (const side of [1, -1] as const) {
    const want: boolean[] = [];
    const at: TrackPose[] = [];
    for (let i = 0; i <= n; i++) {
      const p = track.poseAt(i * step);
      at.push(p);
      const lx = Math.cos(p.heading) * side;
      const lz = -Math.sin(p.heading) * side;
      const probe = field.height(p.x + lx * (hw + 7), p.z + lz * (hw + 7), 4);
      const nearOther = field.road.nearest(p.x + lx * (hw + 7), p.z + lz * (hw + 7));
      want.push(p.y - probe > 3 && (!nearOther || nearOther.dist > hw + 1));
    }
    // un buco di un paletto si chiude, una fila corta si toglie
    for (let i = 1; i < n; i++) if (!want[i] && want[i - 1] && want[i + 1]) want[i] = true;
    let run: RoadsidePost[] = [];
    const flush = () => {
      if (run.length >= 3) {
        sweepBeam(m, railFrames(run, side));
        posts.push(...run);
      }
      run = [];
    };
    const o = hw + 0.7 + RAIL_SPACER;
    for (let i = 0; i <= n; i++) {
      if (!want[i]) {
        flush();
        continue;
      }
      const p = at[i];
      run.push({ x: p.x + Math.cos(p.heading) * side * o, y: p.y, z: p.z - Math.sin(p.heading) * side * o, h: p.heading, side });
    }
    flush();
    // delineatori: lontano da ogni guardrail di questo lato, più fitti dove la strada gira
    let last = -Infinity;
    for (let i = 2; i <= n - 2; i++) {
      const p = at[i];
      const bend = Math.abs(wrap(at[Math.min(n, i + 4)].heading - at[Math.max(0, i - 4)].heading));
      const gap = bend > 0.35 ? 20 : 40;
      if (i * step - last < gap) continue;
      let railNear = false;
      for (let k = Math.max(0, i - 3); k <= Math.min(n, i + 3); k++) if (want[k]) railNear = true;
      if (railNear) continue;
      last = i * step;
      const off = hw + 0.75;
      delineators.push({ x: p.x + Math.cos(p.heading) * side * off, y: p.y, z: p.z - Math.sin(p.heading) * side * off, h: p.heading, side });
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  geo.setIndex(m.idx);
  geo.computeVertexNormals();
  return { geometry: geo, posts, delineators };
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// ---------- vegetazione e rocce ----------

export type Species = 'spruce' | 'larch' | 'broadleaf' | 'rock';

export interface Prop {
  kind: Species;
  x: number;
  y: number;
  z: number;
  s: number;
  r: number;
  tint: number;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Specie plausibile per la quota (fasce alpine: latifoglie, abete rosso, larice, rocce). */
function pick(alt: number, r: number): Species | null {
  if (alt < 900) return r < 0.7 ? 'broadleaf' : r < 0.9 ? 'spruce' : null;
  if (alt < 1350) return r < 0.35 ? 'broadleaf' : r < 0.92 ? 'spruce' : 'larch';
  if (alt < 1850) return r < 0.72 ? 'spruce' : 'larch';
  if (alt < 2150) return r < 0.25 ? 'spruce' : r < 0.6 ? 'larch' : r < 0.75 ? 'rock' : null;
  if (alt < 2350) return r < 0.12 ? 'larch' : r < 0.4 ? 'rock' : null;
  return r < 0.35 ? 'rock' : null;
}

export function scatterProps(track: Track, field: HeightField, density: number): Prop[] {
  const rand = mulberry32(1234);
  const out: Prop[] = [];
  const hw = track.halfWidth;
  const gap = 10 / density;
  for (let d = 0; d < track.length; d += gap) {
    for (let k = 0; k < 2; k++) {
      const p = track.poseAt(d + rand() * gap);
      const side = rand() < 0.5 ? -1 : 1;
      const far = rand() < 0.3;
      const off = hw + (far ? 60 + rand() * 260 : 5 + Math.pow(rand(), 1.6) * 60);
      const x = p.x + Math.cos(p.heading) * off * side;
      const z = p.z - Math.sin(p.heading) * off * side;
      const y = field.height(x, z, 6);
      if (field.lastRoadDist() < hw + 3.5) continue;
      const alt = y + field.altitudeBase;
      // pendenza stimata dal terreno: sulle pareti non cresce un bosco
      const sx = field.height(x + 4, z, 6) - y;
      const sz = field.height(x, z + 4, 6) - y;
      const slope = Math.hypot(sx, sz) / 4;
      const kind = pick(alt, rand());
      if (!kind) continue;
      if (kind !== 'rock' && slope > 1.1) continue;
      out.push({
        kind,
        x,
        y: y - (kind === 'rock' ? 0.3 : 0.15),
        z,
        s: kind === 'rock' ? 0.5 + rand() * 1.8 : 0.75 + rand() * 0.8,
        r: rand() * Math.PI * 2,
        tint: rand(),
      });
    }
  }
  return out;
}
