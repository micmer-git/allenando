import * as THREE from 'three';
import { canvasTex } from '@/world/Scene';

/** Aggregato chiaro e terra battuta. Il disegno occupa la larghezza della pista per 5 metri. */
export function gravelTexture(): THREE.CanvasTexture {
  let seed = 3289;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const size = 256;
  const texture = canvasTex(size, size, (g) => {
    const pixels = g.createImageData(size, size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = z / size;
        const rut = Math.cos(4 * Math.PI * u + .16 * Math.sin(2 * Math.PI * v));
        const grade = 153 + 6 * Math.sin(2 * Math.PI * (u + v)) + 4 * rut + (random() - .5) * 24;
        const k = (z * size + x) * 4;
        pixels.data[k] = grade + 13;
        pixels.data[k + 1] = grade + 4;
        pixels.data[k + 2] = grade - 9;
        pixels.data[k + 3] = 255;
      }
    }
    g.putImageData(pixels, 0, 0);
    for (let i = 0; i < 3800; i++) {
      const tone = Math.round(89 + 125 * random());
      g.fillStyle = 'rgba(' + (tone + 8) + ',' + (tone + 4) + ',' + (tone - 3) + ',.64)';
      const x = random() * size, z = random() * size;
      const w = .6 + random() * 1.65;
      g.fillRect(x, z, w, w * .72);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}
