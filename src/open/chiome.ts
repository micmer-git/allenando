import * as THREE from 'three';

export type Canopy = 'broadleaf' | 'bare' | 'spruce' | 'dense' | 'larch' | 'cypress';
type Crown = [number, number, number, number, number, number];
// Rettangolo dell'atlante (u, v, larghezza, altezza), larghezza e altezza dell'albero in metri.
const crowns: Record<Canopy, Crown> = {
  broadleaf: [0, .5, .5, .5, 7.1, 8.5],
  bare: [.5, .5, .5, .5, 5.8, 8.1],
  spruce: [0, 0, .25, .5, 4.1, 11.2],
  dense: [.25, 0, .25, .5, 4.9, 10.5],
  larch: [.5, 0, .25, .5, 4.8, 10.2],
  cypress: [.75, 0, .25, .5, 2.1, 11],
};

export const canopyNames = Object.keys(crowns) as Canopy[];

/** Tre superfici piegate, radicate nello stesso punto. Il profilo dei rami resta leggibile anche
 * di traverso. Le normali arrotondate danno continuità alla luce quando il ciclista gira. */
export function photoCrown(kind: Canopy): THREE.BufferGeometry {
  const [u,v,du,dv,width,height] = crowns[kind];
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let plane = 0; plane < 3; plane++) {
    const a = plane * Math.PI / 3;
    const c = Math.cos(a), s = Math.sin(a);
    for (const back of [false, true]) {
      const start = positions.length / 3;
      const front = back ? -1 : 1;
      for (const top of [false,true]) {
        for (const col of [-1,0,1]) {
          const across = col * width * .5;
          const bend = top ? Math.abs(col) * width * .075 : 0;
          positions.push(c * across - s * bend, top ? height : -.07, s * across + c * bend);
          const normal = new THREE.Vector3(col*c-.45*s*front, top ? 1.6 : .65, col*s+.45*c*front).normalize();
          normals.push(normal.x,normal.y,normal.z);
          uvs.push(u+du*(col+1)/2,v+(top ? dv : 0));
        }
      }
      for (let col = 0; col < 2; col++) {
        const k = start+col;
        if (back) indices.push(k,k+3,k+1, k+1,k+3,k+4);
        else indices.push(k,k+1,k+3, k+1,k+4,k+3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  g.setIndex(indices);
  return g;
}
