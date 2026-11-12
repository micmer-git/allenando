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
  t.anisotropy = 4;
  return t;
}

/** Coppi lombardi: canali che scendono la falda, file sovrapposte, qualche coppo piÃ¹ scuro. 2 m Ã— 2 m. */
export function roofTilesTexture(style: 'lombardo' | 'ladino' = 'lombardo'): THREE.CanvasTexture {
  seed = 23;
  const S = 256;
  const cols = 13;
  const rows = 6;
  const t = canvasTex(S, S, (g) => {
    g.fillStyle = '#c9c4bd';
    g.fillRect(0, 0, S, S);
    if (style === 'ladino') {
      // Scandole e lastre a giunti sfalsati. Il colore misurato o scelto per l'edificio resta nei vertici.
      const w = 32, h = 32;
      for (let row = 0; row < S / h; row++) {
        const offset = (row % 2) * w / 2;
        for (let c = 0; c < S / w; c++) {
          const light = Math.round(205 + rnd() * 40);
          const x = c * w + offset;
          for (const at of [x, x - S]) {
            g.fillStyle = `rgb(${light},${light - 2},${light - 4})`;
            g.fillRect(at, row*h, w-1, h-2);
            g.fillStyle = 'rgba(56,50,42,.25)';
            g.fillRect(at, row*h, w, 3);
          }
        }
      }
      return;
    }
    const cw = S / cols;
    const rh = S / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw;
        const y = r * rh + (c % 2) * rh * 0.5;
        const l = 0.82 + rnd() * 0.2 - (rnd() < 0.08 ? 0.18 : 0);
        // coppo: cilindro, piÃ¹ chiaro al centro
        const grd = g.createLinearGradient(x, 0, x + cw, 0);
        grd.addColorStop(0, `rgba(${Math.round(150 * l)},${Math.round(145 * l)},${Math.round(140 * l)},1)`);
        grd.addColorStop(0.5, `rgba(${Math.round(255 * l)},${Math.round(250 * l)},${Math.round(244 * l)},1)`);
        grd.addColorStop(1, `rgba(${Math.round(135 * l)},${Math.round(130 * l)},${Math.round(125 * l)},1)`);
        g.fillStyle = grd;
        for (const dy of [0, S]) g.fillRect(x + 1, y - dy, cw - 2, rh - 2);
        // ombra della fila sopra
        g.fillStyle = 'rgba(30,20,10,0.32)';
        for (const dy of [0, S]) g.fillRect(x + 1, y - dy, cw - 2, 4);
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.5, 0.5);
  t.anisotropy = 4;
  return t;
}

/** Dettaglio del suolo: grana di erba e terra, ripetuta ogni 12 m. Quasi bianca. */
export function groundDetailTexture(): THREE.CanvasTexture {
  seed = 37;
  const S = 256;
  const t = canvasTex(S, S, (g) => {
    g.fillStyle = '#f4f4f4';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const dark = rnd() < 0.6;
      g.fillStyle = dark ? `rgba(40,45,20,${0.05 + rnd() * 0.12})` : `rgba(255,255,230,${0.05 + rnd() * 0.1})`;
      const w = 1 + rnd() * 3;
      const h = 2 + rnd() * 7;
      // anche sui bordi opposti, cosÃ¬ la ripetizione non si vede
      for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) g.fillRect(x + dx, y + dy, w, h);
    }
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 10 + rnd() * 30;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(60,50,30,${0.06 + rnd() * 0.06})`);
      grd.addColorStop(1, 'rgba(60,50,30,0)');
      g.fillStyle = grd;
      for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) g.fillRect(x - r + dx, y - r + dy, r * 2, r * 2);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
