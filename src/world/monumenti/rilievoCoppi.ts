import * as THREE from 'three';

/** Proiezione del bronzo nello scatto frontale di Z thomas (Commons 81859236, CC BY-SA 4.0).
 * Le UV sono normalizzate sull'originale 960 × 720. Basamento, retro e spessore restano in pietra o bronzo. */
export function mapCoppiRelief(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count*2);
  let groupStart = 0, material = 0;
  for (let i=0; i<pos.count; i+=3) {
    const front = [i,i+1,i+2].every(k => pos.getZ(k) >= 0.115 && pos.getY(k) >= 0.945) &&
      Math.max(pos.getY(i),pos.getY(i+1),pos.getY(i+2)) > 0.96;
    const next = front ? 1 : 0;
    if (next !== material) {
      if (i > groupStart) g.addGroup(groupStart,i-groupStart,material);
      groupStart = i;
      material = next;
    }
    if (!front) continue;
    for (let k=i; k<i+3; k++) {
      const u = THREE.MathUtils.clamp((pos.getX(k)+1.04)/2.08,0,1);
      const v = THREE.MathUtils.clamp((pos.getY(k)-0.95)/2.28,0,1);
      // Nella foto il bordo superiore della stele è più stretto della base.
      const left = 350 + 22*v, right = 653 - 12*v;
      uv[2*k] = THREE.MathUtils.lerp(left,right,u)/960;
      uv[2*k+1] = 1-THREE.MathUtils.lerp(486+9*u,161,v)/720;
    }
  }
  g.addGroup(groupStart,pos.count-groupStart,material);
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  return g;
}
