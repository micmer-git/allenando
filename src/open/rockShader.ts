/*
 * Le bande orizzontali della roccia. Il terreno ha un vertice ogni 8-16 m (il lontano ogni
 * 120-250): strati di 3,5 m non si possono scrivere nei colori dei vertici. Li disegna lo shader
 * dalla quota del pixel, dove l'attributo `rock` (groundLook: 0 prato, 1 parete) dice che c'è
 * roccia: uno strato su sei più spesso e ocra, un filo d'ombra alla giuntura di ogni strato, e
 * i colatoi verticali (un rumore in pianta, uguale a ogni quota: sulle pareti fa strisce in piedi).
 * Gli strati si spengono quando sono più stretti di due pixel (fwidth): da lontano facevano moiré.
 * Senza l'attributo (geometrie vecchie) `rock` vale 0 e non cambia niente.
 */

export const ROCK_LAYER_M = 3.5;

export function patchRockShader(shader: { vertexShader: string; fragmentShader: string }, bands: number): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float rock;\nvarying float vRock;\nvarying vec3 vRockP;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = rock;\nvRockP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vRock;\nvarying vec3 vRockP;\nfloat rockHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\nfloat rockNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(rockHash(i), rockHash(i + vec2(1.0, 0.0)), u.x), mix(rockHash(i + vec2(0.0, 1.0)), rockHash(i + vec2(1.0, 1.0)), u.x), u.y); }')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  if (vRock > 0.02) {
    float ly = vRockP.y / ${ROCK_LAYER_M.toFixed(2)};
    float k = floor(ly);
    float t = fract(ly);
    float jit = fract(sin(k * 12.9898) * 43758.5453);
    // lo strato: pieno al centro, in ombra alla giuntura
    float mid = smoothstep(0.0, 0.22, t) * (1.0 - smoothstep(0.78, 1.0, t));
    float joint = 1.0 - smoothstep(0.0, 0.08, t);
    // da lontano gli strati di 3,5 m stanno sotto il pixel e fanno righe a moiré: si spengono
    // quando uno strato è più stretto di due pixel (le pareti a 1-2 km restano ai colatoi)
    float near = 1.0 - smoothstep(0.25, 0.6, fwidth(ly));
    float shade = 1.0 - near * (0.13 * (1.0 - mid) * (0.4 + 0.6 * jit) + 0.16 * joint);
    // uno strato su sei, a caso, è più spesso e ocra
    float big = step(0.82, fract(sin(floor(ly / 6.0) * 7.13 + 1.7) * 1234.5));
    vec3 ochre = vec3(0.80, 0.70, 0.52);
    // i colatoi: strisce verticali più scure (il rumore in pianta non dipende dalla quota), come
    // le pareti del Sassolungo e del Sella nelle foto; a due scale, 12 m e 45 m. Sono quello che
    // dice «parete» da lontano, dove gli strati non si vedono più
    float streak = rockNoise(vRockP.xz / 12.0) * 0.55 + rockNoise(vRockP.xz / 45.0 + 7.3) * 0.45;
    shade *= 0.6 + 0.5 * smoothstep(0.2, 0.8, streak);
    vec3 banded = diffuseColor.rgb * shade;
    banded = mix(banded, ochre * shade * 1.05, (0.18 * jit + 0.38 * big) * mid * (0.35 + 0.65 * near));
    diffuseColor.rgb = mix(diffuseColor.rgb, banded, vRock * ${bands.toFixed(2)});
  }`,
    );
}
