import { pixelTexture } from '@/world/isometric';
import { paintFacade } from './facadePaint';
import * as THREE from 'three';
import { canvasTex } from '@/world/Scene';

/*
 * Trame disegnate a canvas per il mondo aperto. Sono quasi bianche: il colore vero (intonaco,
 * coppi, prato) arriva dai colori dei vertici e la trama ci mette solo luce e ombra.
 */

let seed = 1;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

/** Intonaco, finestre e materiali di finitura condividono una sola trama per mondo. */
export function facadeTexture(style: 'lombardo' | 'ladino' = 'lombardo'): THREE.CanvasTexture {
  seed = style === 'ladino' ? 13 : 11;
  const t = canvasTex(1024, 512, (g) => paintFacade(g, style === 'ladino', rnd));
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 2;
  return t;
}

/** Coppi lombardi: canali che scendono la falda, file sovrapposte, qualche coppo più scuro. 2 m × 2 m. */
export function roofTilesTexture(style: 'lombardo' | 'ladino' = 'lombardo'): THREE.CanvasTexture {
  const t = pixelTexture(24, 24, g => {
    const shale = style === 'ladino';
    g.fillStyle = shale ? '#968f88' : '#ab9284';
    g.fillRect(0, 0, 24, 24);
    for (let row = 0; row < 6; row++) {
      const offset = row % 2 * 3;
      for (let col = -1; col < 4; col++) {
        const x = col * 6 + offset;
        const value = ['#dbd0bd','#dbccc0','#e6d9cf'][(row * 7 + col + 1) % 3];
        g.fillStyle = shale ? '#c9c9be' : value;
        g.fillRect(x, row * 4, 5, 3);
        g.fillStyle = shale ? '#dce2dc' : '#eee1d4';
        g.fillRect(x, row * 4, 2, 1);
      }
    }
  });
  t.repeat.set(0.5, 0.5);
  return t;
}

/** Tasselli di erba e ghiaia ripetuti sulla superficie, con variazioni di un solo tono. */
export function groundDetailTexture(): THREE.CanvasTexture {
  seed = 37;
  return pixelTexture(32, 32, g => {
    g.fillStyle = '#f3f3e8';
    g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 95; i++) {
      g.fillStyle = ['#d7dcd1','#e6e4d7','#fffff2'][i % 3];
      g.fillRect(Math.floor(rnd()*32), Math.floor(rnd()*32), 1 + Math.floor(rnd()*3), 1);
    }
  });
}
