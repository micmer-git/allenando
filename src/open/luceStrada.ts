import * as THREE from 'three';

/** Light travels in the real sun direction. Only the square around the rider needs shadows.
 * Static buildings/trees need a new depth pass on movement or after streaming, not at 60 Hz. */
export function localShadow() {
  const anchor = new THREE.Vector3(Infinity,Infinity,Infinity);
  const offset = new THREE.Vector3();
  let geometry = -1, lastUpdate = -Infinity;
  return (sun: THREE.DirectionalLight, position: THREE.Vector3, direction: THREE.Vector3,
          revision: number, now: number, force = false) => {
    offset.set(Math.round(position.x / 8)*8,Math.round(position.y / 8)*8,Math.round(position.z / 8)*8);
    const moved = !anchor.equals(offset);
    if (!force && !moved && (geometry === revision || now-lastUpdate < 650)) return;
    anchor.copy(offset);
    sun.target.position.copy(anchor);
    sun.target.updateMatrixWorld();
    sun.position.copy(anchor).addScaledVector(direction,200);
    sun.shadow.needsUpdate = true;
    lastUpdate = now;
    geometry = revision;
  };
}

/** Continuous sky in direction space: the solar disk doesn't get stretched between dome vertices. */
export function makeSkyDome() {
  return new THREE.ShaderMaterial({
    side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms: {
      skyZenith:{value:new THREE.Color()}, skyMid:{value:new THREE.Color()},
      skyHorizon:{value:new THREE.Color()}, skyGlow:{value:new THREE.Color()},
      solarDirection:{value:new THREE.Vector3(0,1,0)}, solarVisibility:{value:1},
    },
    vertexShader:`varying vec3 vSkyDir;
    void main() { vSkyDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform vec3 skyZenith,skyMid,skyHorizon,skyGlow,solarDirection;
    uniform float solarVisibility; varying vec3 vSkyDir;
    void main() {
      vec3 d=normalize(vSkyDir);
      float elev=clamp(d.y,0.0,1.0);
      vec3 sky=mix(skyHorizon,skyMid,smoothstep(-0.035,0.16,d.y));
      sky=mix(sky,skyZenith,smoothstep(0.11,0.97,elev));
      // Angular distance expressed as a chord. Diameter of the solar disk ~0.53 degrees.
      float r=length(d-solarDirection);
      float forwardGlow=exp(-4.8*r)*0.26+exp(-32.0*r)*0.60;
      sky=mix(sky,skyGlow,solarVisibility*forwardGlow);
      float aa=clamp(fwidth(r),0.0003,0.0030);
      float disk=1.0-smoothstep(0.00465-aa,0.00465+aa,r);
      sky+=skyGlow*(4.0*disk+exp(-140.0*r)*0.65)*solarVisibility;
      gl_FragColor=vec4(sky,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
}
