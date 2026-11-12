import * as THREE from 'three';
import { smoothNoise } from '@/world/builders';
import { groundLook, type LookCtx } from './look';
import { COVER, type Terrain } from './world';

/*
 * La fascia di mezzo: le pareti a 3-9 km. Il terreno vicino (mattonelle da 500 m, con strade,
 * case e alberi) arriva a 2-3 km; oltre c'era solo il lontano (far.bin, un punto ogni 120 m), e
 * le pareti del Sella viste dal Gardena o la Marmolada vista dal Pordoi diventavano gobbe. Qui le
 * stesse mattonelle del DEM (2 km, a 12,5 o 25 m) si disegnano senza niente sopra: a 25 m fino a
 * 4 km, a 50 m più in là. Il lontano si scarta sotto ogni mattonella di mezzo pronta (la maschera
 * qui sotto), e la fascia di mezzo sotto ogni mattonella vicina pronta (farMask.ts).
 *
 * Solo per i mondi che lo chiedono (look.midRange: il Sellaronda); a Bergamo non cambia niente.
 */

/** Quanto scende la gonna di una mattonella di mezzo: chiude la fessura fra due passi diversi. */
export const MID_SKIRT_M = 60;
/** Fin qui il passo di 25 m, oltre 50. */
export const MID_FINE_M = 4000;

/** Il passo della mattonella di mezzo per la sua distanza dal ciclista (dal bordo più vicino). */
export function midSpacing(dist: number): number {
  return dist <= MID_FINE_M ? 25 : 50;
}

/** Distanza da (x, z) al rettangolo della mattonella del DEM (0 se ci si sta sopra). */
export function tileRectDist(x: number, z: number, x0: number, z0: number, size: number): number {
  const dx = Math.max(x0 - x, 0, x - (x0 + size));
  const dz = Math.max(z0 - z, 0, z - (z0 + size));
  return Math.hypot(dx, dz);
}

/**
 * Di quanto si abbassa un vertice della fascia di mezzo: fra due punti a 25-50 m la retta passa
 * sopra le valli strette che le mattonelle vicine vedono a 8-12 m. Come farSinks (farMask.ts), con
 * un tetto più basso: 8% del dislivello fra i vicini, da 0,5 a 12 m.
 */
export const MID_SINK = { k: 0.08, min: 0.5, max: 12 };

const FOREST = new THREE.Color('#355f2e');

/**
 * La geometria di una mattonella di mezzo: la griglia al passo `spacing` sulle quote del DEM
 * (Terrain.height, che legge la mattonella fine se c'è), colore e roccia da look.ts come il lontano,
 * normali dalle differenze centrali (attraverso il bordo: niente cuciture d'ombra fra due
 * mattonelle), gonna di MID_SKIRT_M sui quattro lati.
 */
export function midGeometry(terrain: Terrain, tx: number, tz: number, spacing: number, ctx: LookCtx): THREE.BufferGeometry {
  const b = terrain.graph.bounds;
  const T = terrain.graph.tile;
  const x0 = b.x0 + tx * T;
  const z0 = b.z0 + tz * T;
  const n = Math.round(T / spacing);
  const side = n + 1;
  // una fila in più per lato, per le normali e l'abbassamento
  const ext = side + 2;
  const H = new Float32Array(ext * ext);
  for (let j = 0; j < ext; j++) for (let i = 0; i < ext; i++) H[j * ext + i] = terrain.height(x0 + (i - 1) * spacing, z0 + (j - 1) * spacing);
  const count = side * side + side * 4;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const rock = new Float32Array(count);
  const c = new THREE.Color();
  const noiseStep = Math.max(60, spacing * 2.4);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const e = (j + 1) * ext + (i + 1);
      const h = H[e];
      let lo = h;
      let hi = h;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const v = H[e + dj * ext + di];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      const sink = Math.min(MID_SINK.max, Math.max(MID_SINK.min, MID_SINK.k * (hi - lo)));
      const k = j * side + i;
      const x = x0 + i * spacing;
      const z = z0 + j * spacing;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h - sink;
      pos[k * 3 + 2] = z;
      const gx = (H[e + 1] - H[e - 1]) / (2 * spacing);
      const gz = (H[e + ext] - H[e - ext]) / (2 * spacing);
      const gl = Math.sqrt(1 + gx * gx + gz * gz);
      nrm[k * 3] = -gx / gl;
      nrm[k * 3 + 1] = 1 / gl;
      nrm[k * 3 + 2] = -gz / gl;
      const cov = terrain.cover(x, z);
      const g = groundLook(c, ctx.look, ctx.season, h, 1 / gl, -gz / gl, smoothNoise(x / noiseStep, z / noiseStep), cov === COVER.forest && h > ctx.look.treeLine - 40 ? COVER.open : cov);
      // il bosco da lontano è una macchia scura: gli alberi della fascia di mezzo non ci sono
      if (cov === COVER.forest && h < ctx.look.treeLine) c.lerp(FOREST, 0.55 * (1 - g.snow) * (1 - g.rock));
      rock[k] = g.rock;
      c.toArray(col, k * 3);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const bq = a + 1;
      const cq = a + side;
      const d = cq + 1;
      idx.push(a, cq, bq, bq, cq, d);
    }
  }
  // la gonna: stessi vertici del bordo, MID_SKIRT_M più giù, più scuri
  const border = [Array.from({ length: side }, (_, i) => i), Array.from({ length: side }, (_, i) => (side - 1) * side + i), Array.from({ length: side }, (_, j) => j * side), Array.from({ length: side }, (_, j) => j * side + side - 1)];
  let v = side * side;
  for (const line of border) {
    const base = v;
    for (const k of line) {
      pos[v * 3] = pos[k * 3];
      pos[v * 3 + 1] = pos[k * 3 + 1] - MID_SKIRT_M;
      pos[v * 3 + 2] = pos[k * 3 + 2];
      for (let q = 0; q < 3; q++) {
        nrm[v * 3 + q] = nrm[k * 3 + q];
        col[v * 3 + q] = col[k * 3 + q] * 0.8;
      }
      v++;
    }
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const bq = line[i + 1];
      const cq = base + i;
      const d = base + i + 1;
      idx.push(a, bq, cq, bq, d, cq, a, cq, bq, bq, cq, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('rock', new THREE.BufferAttribute(rock, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// ---------- la maschera: il lontano si scarta sotto la fascia di mezzo ----------

export interface MidMask {
  uMid: { value: THREE.DataTexture };
  /** x0, z0 del mondo, lato della mattonella del DEM, mattonelle per lato della trama */
  uMidGrid: { value: THREE.Vector4 };
  data: Uint8Array;
  n: number;
}

/** Una trama n × n, un texel per mattonella del DEM (255 = la sua mattonella di mezzo è in scena). */
export function createMidMask(n: number, x0: number, z0: number, tile: number): MidMask {
  const data = new Uint8Array(n * n);
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return { uMid: { value: tex }, uMidGrid: { value: new THREE.Vector4(x0, z0, tile, n) }, data, n };
}

export function setMidMask(mask: MidMask, ready: (tx: number, tz: number) => boolean): void {
  let changed = false;
  for (let j = 0; j < mask.n; j++) {
    for (let i = 0; i < mask.n; i++) {
      const v = ready(i, j) ? 255 : 0;
      if (mask.data[j * mask.n + i] !== v) {
        mask.data[j * mask.n + i] = v;
        changed = true;
      }
    }
  }
  if (changed) mask.uMid.value.needsUpdate = true;
}

/**
 * Il pezzo di shader del lontano: scarta i pixel sopra una mattonella di mezzo pronta, tranne una
 * striscia di 3 m lungo il bordo con una vicina che non lo è (niente fessure). Va applicato dopo
 * patchFarShader, di cui usa `vWPos`.
 */
export function patchMidShader(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, mask: MidMask): void {
  shader.uniforms.uMid = mask.uMid;
  shader.uniforms.uMidGrid = mask.uMidGrid;
  if (!shader.vertexShader.includes('varying vec3 vWPos;')) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  }
  const decl = shader.fragmentShader.includes('varying vec3 vWPos;') ? '' : 'varying vec3 vWPos;\n';
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
${decl}uniform sampler2D uMid;
uniform vec4 uMidGrid;
bool midReady(ivec2 c) {
  int n = int(uMidGrid.w);
  if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) return false;
  return texelFetch(uMid, c, 0).r > 0.5;
}`,
    )
    .replace(
      'void main() {',
      `void main() {
  {
    vec2 g = (vWPos.xz - uMidGrid.xy) / uMidGrid.z;
    ivec2 c = ivec2(floor(g));
    if (midReady(c)) {
      vec2 f = (g - vec2(c)) * uMidGrid.z;
      float e = uMidGrid.z - 3.0;
      bool keep = (f.x < 3.0 && !midReady(c + ivec2(-1, 0))) || (f.x > e && !midReady(c + ivec2(1, 0))) || (f.y < 3.0 && !midReady(c + ivec2(0, -1))) || (f.y > e && !midReady(c + ivec2(0, 1)));
      if (!keep) discard;
    }
  }`,
    );
}
