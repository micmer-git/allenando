/*
 * Le bande orizzontali della roccia. Il terreno ha un vertice ogni 8-16 m (il lontano ogni
 * 120-250): strati di 3,5 m non si possono scrivere nei colori dei vertici. Li disegna lo shader
 * dalla quota del pixel, dove l'attributo `rock` (groundLook: 0 prato, 1 parete) dice che c'è
 * roccia: uno strato su sei più spesso e ocra, un filo d'ombra alla giuntura di ogni strato.
 * Senza l'attributo (geometrie vecchie) `rock` vale 0 e non cambia niente.
 */

export const ROCK_LAYER_M = 3.5;

export function patchRockShader(shader: { vertexShader: string; fragmentShader: string }, bands: number): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float rock;\nvarying float vRock;\nvarying float vRockY;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = rock;\nvRockY = (modelMatrix * vec4(transformed, 1.0)).y;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vRock;\nvarying float vRockY;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  if (vRock > 0.02) {
    float ly = vRockY / ${ROCK_LAYER_M.toFixed(2)};
    float k = floor(ly);
    float t = fract(ly);
    float jit = fract(sin(k * 12.9898) * 43758.5453);
    // lo strato: pieno al centro, in ombra alla giuntura
    float mid = smoothstep(0.0, 0.22, t) * (1.0 - smoothstep(0.78, 1.0, t));
    float joint = 1.0 - smoothstep(0.0, 0.08, t);
    float shade = 1.0 - 0.13 * (1.0 - mid) * (0.4 + 0.6 * jit) - 0.16 * joint;
    // uno strato su sei, a caso, è più spesso e ocra
    float big = step(0.82, fract(sin(floor(ly / 6.0) * 7.13 + 1.7) * 1234.5));
    vec3 ochre = vec3(0.80, 0.70, 0.52);
    vec3 banded = diffuseColor.rgb * shade;
    banded = mix(banded, ochre * shade * 1.05, (0.18 * jit + 0.38 * big) * mid);
    diffuseColor.rgb = mix(diffuseColor.rgb, banded, vRock * ${bands.toFixed(2)});
  }`,
    );
}
