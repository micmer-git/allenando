import * as THREE from 'three';

/*
 * Il terreno lontano (far.bin, un punto ogni 250 m) è troppo grossolano per stare insieme a
 * quello vicino: fra due punti su due versanti passa una retta che nel fondovalle sta decine di
 * metri SOPRA il paese vero. Dove una mattonella vicina è pronta, il lontano si scarta pixel per
 * pixel, mattonella per mattonella: prima si scartava solo dentro il quadrato di mattonelle tutte
 * pronte, e nelle altre (l'anello esterno, sempre in costruzione mentre si pedala) le montagne
 * lontane coprivano case e strade.
 *
 * La maschera è una trama N×N (un texel per mattonella, 255 = pronta) più l'angolo e il passo
 * della griglia. Vicino a un bordo con una mattonella non pronta il lontano resta per 3 m, così
 * fra i due terreni non si apre una fessura.
 */

export interface FarMask {
  uReady: { value: THREE.DataTexture };
  /** x0, z0 dell'angolo della griglia, lato della mattonella, numero di mattonelle per lato */
  uGrid: { value: THREE.Vector4 };
  data: Uint8Array;
  n: number;
}

/** n: mattonelle per lato della maschera (al massimo, quelle che possono esistere insieme). */
export function createFarMask(n: number): FarMask {
  const data = new Uint8Array(n * n);
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  // righe da n byte (9, 11…): senza questo WebGL le vuole allineate a 4 e la trama non si carica
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return { uReady: { value: tex }, uGrid: { value: new THREE.Vector4(0, 0, 1, 0) }, data, n };
}

/** Le mattonelle pronte intorno a (cx, cz): `ready(ix, iz)` dice se quella è pronta. */
export function updateFarMask(mask: FarMask, x0: number, z0: number, tile: number, cx: number, cz: number, ready: (ix: number, iz: number) => boolean): void {
  const n = mask.n;
  const h = (n - 1) >> 1;
  let changed = false;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = ready(cx - h + i, cz - h + j) ? 255 : 0;
      if (mask.data[j * n + i] !== v) {
        mask.data[j * n + i] = v;
        changed = true;
      }
    }
  }
  const gx = x0 + (cx - h) * tile;
  const gz = z0 + (cz - h) * tile;
  const g = mask.uGrid.value;
  if (g.x !== gx || g.y !== gz || g.z !== tile || g.w !== n) {
    g.set(gx, gz, tile, n);
    changed = true;
  }
  if (changed) mask.uReady.value.needsUpdate = true;
}

/** Il pezzo di shader del terreno lontano: scarta i pixel che cadono su una mattonella pronta. */
export function patchFarShader(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, mask: FarMask): void {
  shader.uniforms.uReady = mask.uReady;
  shader.uniforms.uGrid = mask.uGrid;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vWPos;
uniform sampler2D uReady;
uniform vec4 uGrid;
bool farReady(ivec2 c) {
  int n = int(uGrid.w);
  if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) return false;
  return texelFetch(uReady, c, 0).r > 0.5;
}`,
    )
    .replace(
      'void main() {',
      `void main() {
  {
    vec2 g = (vWPos.xz - uGrid.xy) / uGrid.z;
    ivec2 c = ivec2(floor(g));
    if (farReady(c)) {
      vec2 f = (g - vec2(c)) * uGrid.z;
      float e = uGrid.z - 3.0;
      bool keep = (f.x < 3.0 && !farReady(c + ivec2(-1, 0))) || (f.x > e && !farReady(c + ivec2(1, 0))) || (f.y < 3.0 && !farReady(c + ivec2(0, -1))) || (f.y > e && !farReady(c + ivec2(0, 1)));
      if (!keep) discard;
    }
  }`,
    );
}
