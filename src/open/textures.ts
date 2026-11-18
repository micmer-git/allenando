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
  seed = style === 'ladino' ? 23 : 19;
  const t = pixelTexture(64, 64, g => {
    const shale = style === 'ladino';
    g.fillStyle = shale ? '#8c9294' : '#a69b90';
    g.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 8; row++) {
      const offset = row % 2 * 4;
      for (let col = -1; col < 8; col++) {
        const x = col * 8 + offset;
        const y = row * 8;
        const tone = Math.floor(rnd() * 4);
        g.fillStyle = shale ? ['#c4cbca','#d0d5d0','#bbc4c3','#d5dad3'][tone]
          : ['#e2d9cd','#dbd0c3','#ede2d5','#d9d0c4'][tone];
        g.fillRect(x, y, 7, 7);
        // Il bordo inferiore copre la fila successiva; il canale del coppo prende luce di lato.
        g.fillStyle = shale ? '#e1e5dc' : '#f8eee0';
        g.fillRect(x + 1, y, shale ? 5 : 2, 1);
        if (!shale) g.fillRect(x + 1, y + 1, 2, 5);
        g.fillStyle = shale ? '#939e9c' : '#bdb0a2';
        g.fillRect(x + 6, y + 1, 1, 6);
        g.fillRect(x, y + 6, 6, 1);
        if (tone === 1) {
          g.fillStyle = shale ? '#b4beb9' : '#cec2b3';
          g.fillRect(x + 4, y + 3, 1, 2);
        }
      }
    }
  });
  t.repeat.set(0.5, 0.5);
  return t;
}

/** Dodici metri di suolo: tasselli piccoli, quasi neutri, senza trasformare il prato in una scacchiera. */
export function groundDetailTexture(): THREE.CanvasTexture {
  seed = 37;
  return pixelTexture(64, 64, g => {
    g.fillStyle = '#f2f4ec';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 420; i++) {
      const x = Math.floor(rnd() * 64), y = Math.floor(rnd() * 64);
      const w = 1 + Math.floor(rnd() * 3);
      g.fillStyle = ['#e4e9dd','#edf0e5','#fbfcf2','#dce3d7'][i % 4];
      g.fillRect(x, y, w, 1);
      if (i % 5 === 0) {
        g.fillStyle = '#f9fbf3';
        g.fillRect(x, (y + 1) % 64, 1, 1);
      }
    }
  });
}
