import * as THREE from 'three';
import type { WorldGraph } from './graph';

/** Lo stesso rettangolo fisico per tutti e tre i livelli di dettaglio (immagine con nord in alto). */
export function landscapeUniforms(f: WorldGraph['far']) {
  return {
    uLandscape: { value: null as THREE.Texture | null },
    uLandscapeBox: { value: new THREE.Vector4(f.x0, f.z0, 1 / ((f.nx - 1) * f.step), 1 / ((f.nz - 1) * f.step)) },
    uLandscapeReady: { value: 0 },
  };
}

export function patchLandscape(shader: { fragmentShader: string; uniforms: Record<string, unknown> }, uniforms: ReturnType<typeof landscapeUniforms>) {
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D uLandscape;\nuniform vec4 uLandscapeBox;\nuniform float uLandscapeReady;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      if (uLandscapeReady > 0.5) {
        vec2 st = (vRockP.xz - uLandscapeBox.xy) * uLandscapeBox.zw;
        vec4 observed = texture2D(uLandscape, vec2(st.x, 1.0 - st.y));
        // Vicino restano la grana, i colori stagionali e il terreno sotto la neve.
        float w = mix(0.46, 0.78, smoothstep(150.0, 1500.0, distance(cameraPosition, vRockP)));
        w *= 1.0 - smoothstep(0.52, 0.85, min(vColor.r, min(vColor.g, vColor.b)));
        diffuseColor.rgb = mix(diffuseColor.rgb, observed.rgb, observed.a * w);
      }`);
}
