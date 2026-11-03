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

/**
 * Facciate: 4 campate × 2 piani (256 px per casella). Finestre con le persiane verdi o marroni,
 * aperte, accostate o chiuse, qualche balcone con la ringhiera. L'angolo in basso a sinistra di ogni
 * casella resta intonaco: lì cadono le uv dei muri ciechi.
 */
export function facadeTexture(): THREE.CanvasTexture {
  seed = 11;
  const C = 256;
  const t = canvasTex(C * 4, C * 2, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, C * 4, C * 2);
    // intonaco: macchie leggere e una fascia più scura in basso (umidità)
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(90,80,60,${0.015 + rnd() * 0.03})`;
      g.fillRect(rnd() * C * 4, rnd() * C * 2, 6 + rnd() * 30, 4 + rnd() * 18);
    }
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        const x0 = col * C;
        const y0 = row * C;
        const kind = rnd();
        const shutter = rnd() < 0.62 ? '#58744b' : '#7a5636';
        const wx = x0 + C * 0.34;
        const ww = C * 0.32;
        const wy = y0 + C * 0.2;
        const wh = C * 0.52;
        // davanzale e cornice in pietra chiara
        g.fillStyle = '#f2ede2';
        g.fillRect(wx - 10, wy - 8, ww + 20, wh + 20);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(wx - 12, wy + wh + 10, ww + 24, 5);
        // vetro: scuro con un riflesso del cielo in alto
        const grd = g.createLinearGradient(0, wy, 0, wy + wh);
        grd.addColorStop(0, '#76889a');
        grd.addColorStop(0.45, '#39434d');
        grd.addColorStop(1, '#262c33');
        g.fillStyle = grd;
        g.fillRect(wx, wy, ww, wh);
        g.fillStyle = '#e9e4da';
        g.fillRect(wx + ww / 2 - 3, wy, 6, wh);
        g.fillRect(wx, wy + wh * 0.38, ww, 5);
        const slats = (x: number, w: number) => {
          g.fillStyle = shutter;
          g.fillRect(x, wy - 2, w, wh + 4);
          g.fillStyle = 'rgba(0,0,0,0.22)';
          for (let y = wy + 4; y < wy + wh; y += 9) g.fillRect(x + 3, y, w - 6, 3);
        };
        if (kind < 0.18) {
          // persiane chiuse
          slats(wx, ww / 2 - 1);
          slats(wx + ww / 2 + 1, ww / 2 - 1);
        } else if (kind < 0.32) {
          // accostate: metà
          slats(wx, ww / 2 - 1);
          slats(wx + ww + 4, ww / 2 - 2);
        } else {
          slats(wx - ww / 2 - 6, ww / 2);
          slats(wx + ww + 6, ww / 2);
        }
        if (row === 1 && rnd() < 0.4) {
          // balcone: soletta e ringhiera
          g.fillStyle = '#d9d3c6';
          g.fillRect(wx - 26, wy + wh + 2, ww + 52, 12);
          g.fillStyle = '#2a2b2c';
          g.fillRect(wx - 26, wy + wh * 0.62, ww + 52, 4);
          for (let x = wx - 24; x < wx + ww + 26; x += 9) g.fillRect(x, wy + wh * 0.62, 3, wh * 0.38 + 4);
        }
        // marcapiano sottile fra i piani
        g.fillStyle = 'rgba(0,0,0,0.07)';
        g.fillRect(x0, y0 + C - 6, C, 6);
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Coppi lombardi: canali che scendono la falda, file sovrapposte, qualche coppo più scuro. 2 m × 2 m. */
export function roofTilesTexture(): THREE.CanvasTexture {
  seed = 23;
  const S = 256;
  const cols = 13;
  const rows = 6;
  const t = canvasTex(S, S, (g) => {
    g.fillStyle = '#c9c4bd';
    g.fillRect(0, 0, S, S);
    const cw = S / cols;
    const rh = S / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw;
        const y = r * rh + (c % 2) * rh * 0.5;
        const l = 0.82 + rnd() * 0.2 - (rnd() < 0.08 ? 0.18 : 0);
        // coppo: cilindro, più chiaro al centro
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
      // anche sui bordi opposti, così la ripetizione non si vede
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
