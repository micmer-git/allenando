import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ARCH_STYLE, gradeText, type ArchSpec } from '@/game/arches';

/**
 * Gli archi sulla strada. Il contratto delle pose è in src/game/arches.ts: avanti =
 * (sin h, 0, cos h), la faccia principale guarda chi arriva.
 *
 * - traguardi dei tratti e cambi d'intervallo in ERG: un arco gonfiabile che scavalca la
 *   strada (un metro di margine per lato) col nome grande sulle due facce, nel colore del
 *   traguardo (ciclamino la volata, azzurro il GPM, oro la crono, verde il cassonetto, viola
 *   l'ERG);
 * - l'arrivo della volata del cassonetto: tre bidoni veri della differenziata a bordo strada;
 * - i chilometri: un portale leggero, numero grande e pendenza del km che viene; l'ultimo
 *   chilometro è rosso, con la fiamma appesa;
 * - i cartelli a bordo strada coi metri che mancano.
 *
 * Ogni arco si costruisce una volta sola per contenuto (testo, tipo, larghezza): se cambia
 * solo la posizione (l'arco dell'ERG che si sposta con la velocità, un percorso rifatto a
 * un incrocio) si sposta e basta.
 */

const TUBE = 0.55;

function fitText(g: CanvasRenderingContext2D, text: string, weight: number, size: number, max: number): number {
  let s = size;
  g.font = `${weight} ${s}px sans-serif`;
  while (g.measureText(text).width > max && s > 14) {
    s -= 3;
    g.font = `${weight} ${s}px sans-serif`;
  }
  return s;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** La scritta: fondo del colore del traguardo, titolo grande, nome sotto. */
function labelTexture(spec: ArchSpec, w: number, h: number): THREE.CanvasTexture {
  const st = ARCH_STYLE[spec.kind];
  return canvasTexture(w, h, (g) => {
    g.fillStyle = st.color;
    g.fillRect(0, 0, w, h);
    // bordo chiaro: si stacca dal cielo e dal bosco
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = h * 0.05;
    g.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08);
    g.fillStyle = st.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const sub = (spec.sub ?? '').toUpperCase();
    fitText(g, spec.label.toUpperCase(), 800, Math.round(h * (sub ? 0.5 : 0.66)), w * 0.9);
    g.fillText(spec.label.toUpperCase(), w / 2, sub ? h * 0.4 : h * 0.53);
    if (sub) {
      fitText(g, sub, 700, Math.round(h * 0.2), w * 0.86);
      g.globalAlpha = 0.92;
      g.fillText(sub, w / 2, h * 0.77);
      g.globalAlpha = 1;
    }
  });
}

/** Colore della pendenza: verde in piano, giallo, arancio, rosso dal 10%. */
function gradeColor(g: number): string {
  return g >= 0.1 ? '#e8322f' : g >= 0.07 ? '#ff8a1f' : g >= 0.04 ? '#ffd23a' : '#4cc35a';
}

/**
 * Il cartello del portale dei km, fatto per leggersi da lontano su un telefono: a sinistra il
 * numero grande («3 KM», «ULTIMO KM»), a destra «ALLA VETTA» e la pendenza in un riquadro
 * colorato, oppure «ALL'ARRIVO».
 */
function kmTexture(spec: ArchSpec): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const st = ARCH_STYLE[spec.kind];
  return canvasTexture(w, h, (g) => {
    g.fillStyle = st.color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = spec.kind === 'ultimo' ? '#ffffff' : '#ffc814';
    g.fillRect(0, h - 8, w, 8);
    g.textBaseline = 'middle';
    const label = spec.label.toUpperCase();
    const sub = (spec.sub ?? '').toUpperCase();
    const right = spec.grade != null ? 190 : sub ? 170 : 0;
    g.fillStyle = st.ink;
    g.textAlign = 'left';
    fitText(g, label, 800, 84, w - right - 36);
    g.fillText(label, 20, h * 0.5);
    if (spec.grade != null) {
      const x0 = w - right;
      g.font = '700 24px sans-serif';
      g.textAlign = 'center';
      g.globalAlpha = 0.9;
      g.fillText(sub, x0 + right / 2 - 8, 26);
      g.globalAlpha = 1;
      g.fillStyle = gradeColor(spec.grade);
      g.beginPath();
      g.roundRect(x0, 44, right - 16, 72, 12);
      g.fill();
      g.fillStyle = spec.grade >= 0.04 && spec.grade < 0.07 ? '#16130a' : '#ffffff';
      fitText(g, gradeText(spec.grade), 800, 52, right - 32);
      g.fillText(gradeText(spec.grade), x0 + (right - 16) / 2, 82);
    } else if (sub) {
      g.textAlign = 'right';
      g.globalAlpha = 0.92;
      fitText(g, sub, 700, 34, right);
      g.fillText(sub, w - 18, h * 0.5);
      g.globalAlpha = 1;
    }
  });
}

interface Built {
  root: THREE.Group;
  dispose: () => void;
}

/** Il contenuto di un arco: se non cambia, l'arco non si rifà. */
function contentKey(s: ArchSpec): string {
  return `${s.id}|${s.kind}|${s.role}|${s.label}|${s.sub ?? ''}|${s.grade?.toFixed(3) ?? ''}|${s.halfWidth.toFixed(1)}`;
}

function buildOne(s: ArchSpec): Built {
  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const colorMat = new Map<string, THREE.MeshLambertMaterial>();
  const matOf = (color: string) => {
    let m = colorMat.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      colorMat.set(color, m);
      mats.push(m);
    }
    return m;
  };
  const geo = <G extends THREE.BufferGeometry>(g: G): G => {
    geos.push(g);
    return g;
  };
  const white = matOf('#f4f4ef');
  const dark = matOf('#24272c');
  const st = ARCH_STYLE[s.kind];
  const plane = (w: number, h: number, tex: THREE.Texture, y: number, z: number, back: boolean) => {
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.18 });
    mats.push(mat);
    const m = new THREE.Mesh(geo(new THREE.PlaneGeometry(w, h)), mat);
    m.position.set(0, y, z);
    // PlaneGeometry guarda +z: la faccia davanti guarda chi arriva (−z), quella dietro chi l'ha passato
    if (!back) m.rotation.y = Math.PI;
    return m;
  };
  const roadLine = (depth: number, mat: THREE.Material) => {
    const g = geo(new THREE.PlaneGeometry(s.halfWidth * 2, depth));
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.07, 0);
    root.add(new THREE.Mesh(g, mat));
  };
  /** cartello a destra di chi arriva: due paletti e un pannello scritto sulle due facce */
  const sideBoard = (x: number, y: number, bw: number, bh: number) => {
    const side = new THREE.Group();
    side.position.x = x;
    root.add(side);
    const tex = labelTexture(s, 512, 192);
    texs.push(tex);
    const pole = geo(new THREE.CylinderGeometry(0.04, 0.04, y + bh / 2 - 0.1, 6));
    pole.translate(0, (y + bh / 2 - 0.1) / 2, 0);
    for (const dx of [-bw * 0.39, bw * 0.39]) {
      const p = new THREE.Mesh(pole, dark);
      p.position.x = dx;
      side.add(p);
    }
    const board = new THREE.Mesh(geo(new THREE.BoxGeometry(bw, bh, 0.05)), matOf(st.color));
    board.position.y = y;
    side.add(board);
    side.add(plane(bw * 0.96, bh * 0.91, tex, y, -0.03, false));
    side.add(plane(bw * 0.96, bh * 0.91, tex, y, 0.03, true));
    return side;
  };

  if (s.role === 'banner') {
    sideBoard(-(s.halfWidth + 1.4), 1.75, 2.3, 0.9);
  } else if (s.role === 'km') {
    // portale leggero: due pali sottili e il cartello in alto, sopra la strada
    const half = s.halfWidth + 0.9;
    const H = 5.4;
    const bw = half * 2 + 0.4;
    const bh = Math.min(2.3, Math.max(1.5, bw / 4));
    const poleMat = s.kind === 'ultimo' ? white : matOf('#3a3e46');
    const pole = geo(new THREE.CylinderGeometry(0.1, 0.12, H, 10));
    pole.translate(0, H / 2, 0);
    for (const x of [-half, half]) {
      const p = new THREE.Mesh(pole, poleMat);
      p.position.x = x;
      root.add(p);
    }
    const board = new THREE.Mesh(geo(new THREE.BoxGeometry(bw, bh, 0.14)), matOf(st.color));
    board.position.y = H - bh / 2;
    root.add(board);
    const tex = kmTexture(s);
    texs.push(tex);
    root.add(plane(bw - 0.08, bh - 0.08, tex, H - bh / 2, -0.08, false));
    root.add(plane(bw - 0.08, bh - 0.08, tex, H - bh / 2, 0.08, true));
    if (s.kind === 'ultimo') {
      // la fiamma rossa: un triangolo appeso sotto il cartello, a punta in giù
      const flame = new THREE.Shape();
      flame.moveTo(-0.85, 0);
      flame.lineTo(0.85, 0);
      flame.lineTo(0, -1.25);
      flame.closePath();
      const fm = new THREE.MeshLambertMaterial({ color: '#e0141b', side: THREE.DoubleSide, emissive: '#5a0000' });
      mats.push(fm);
      const f = new THREE.Mesh(geo(new THREE.ShapeGeometry(flame)), fm);
      f.position.y = H - bh - 0.05;
      root.add(f);
      roadLine(0.3, matOf('#e0141b'));
    }
  } else if (s.kind === 'cassonetto' && s.role === 'finish') {
    // l'arrivo del cassonetto: la riga bianca per terra e tre bidoni della differenziata a destra
    roadLine(0.6, white);
    const bins = new THREE.Group();
    bins.position.x = -(s.halfWidth + 1.05);
    root.add(bins);
    const W = 1.35; // lungo la strada
    const D = 1.0; // di profondità
    const Hb = 1.05;
    const body = geo(new THREE.BoxGeometry(D, Hb, W));
    body.translate(0, 0.2 + Hb / 2, 0);
    // il coperchio tondo: mezzo cilindro coricato lungo la strada
    const lid = geo(new THREE.CylinderGeometry(D / 2 + 0.03, D / 2 + 0.03, W + 0.04, 16, 1, false, 0, Math.PI));
    // l'asse da y a z (lungo la strada), poi la metà piena in su
    lid.rotateX(Math.PI / 2);
    lid.rotateZ(Math.PI / 2);
    lid.scale(1, 0.55, 1);
    lid.translate(0, 0.2 + Hb, 0);
    const wheel = geo(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 10));
    wheel.rotateZ(Math.PI / 2);
    const handle = geo(new THREE.BoxGeometry(0.06, 0.06, W * 0.8));
    const COLORS: [string, string][] = [
      ['#2f8a3a', '#226b2c'],
      ['#767b82', '#5a5e64'],
      ['#f2c200', '#d1a400'],
    ];
    COLORS.forEach(([c, l], i) => {
      const bin = new THREE.Group();
      bin.position.z = (i - 1) * (W + 0.18);
      bin.add(new THREE.Mesh(body, matOf(c)));
      bin.add(new THREE.Mesh(lid, matOf(l)));
      const hd = new THREE.Mesh(handle, dark);
      hd.position.set(D / 2 + 0.05, 0.2 + Hb * 0.82, 0);
      bin.add(hd);
      for (const [wx, wz] of [
        [-D / 2 + 0.15, -W / 2 + 0.15],
        [-D / 2 + 0.15, W / 2 - 0.15],
        [D / 2 - 0.15, -W / 2 + 0.15],
        [D / 2 - 0.15, W / 2 - 0.15],
      ]) {
        const wh = new THREE.Mesh(wheel, dark);
        wh.position.set(wx, 0.1, wz);
        bin.add(wh);
      }
      bins.add(bin);
    });
    // la bandiera a scacchi sul bidone di mezzo, e il cartello col paese dietro
    const flagTex = canvasTexture(64, 48, (g) => {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) {
        g.fillStyle = (x + y) % 2 ? '#111111' : '#ffffff';
        g.fillRect(x * 11, y * 12, 11, 12);
      }
    });
    texs.push(flagTex);
    const stick = geo(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6));
    stick.translate(0, 0.55, 0);
    const st0 = new THREE.Mesh(stick, dark);
    st0.position.set(0.2, 0.2 + Hb + 0.25, 0);
    bins.add(st0);
    const flagMat = new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide });
    mats.push(flagMat);
    const flag = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.7, 0.5)), flagMat);
    flag.rotation.y = Math.PI / 2;
    flag.position.set(0.2, 0.2 + Hb + 1.1, 0.36);
    bins.add(flag);
    sideBoard(-(s.halfWidth + 3.1), 2.65, 3.2, 1.05);
  } else {
    // arco gonfiabile: mezzo toro che scavalca la carreggiata con un metro di margine per lato
    const R = s.halfWidth + 1 + TUBE;
    root.add(new THREE.Mesh(geo(new THREE.TorusGeometry(R, TUBE, 12, 40, Math.PI)), matOf(st.color)));
    // fasce bianche ai piedi, come le cuciture dei gonfiabili
    const band = geo(new THREE.CylinderGeometry(TUBE * 1.04, TUBE * 1.08, 0.5, 12));
    band.translate(0, 0.25, 0);
    const foot = geo(new THREE.CylinderGeometry(TUBE * 1.25, TUBE * 1.35, 0.22, 12));
    foot.translate(0, 0.11, 0);
    for (const x of [-R, R]) {
      const b = new THREE.Mesh(band, white);
      b.position.set(x, 0.6, 0);
      const f = new THREE.Mesh(foot, dark);
      f.position.x = x;
      root.add(b, f);
    }
    // la scritta sopra l'arco, sulle due facce: titolo e nome del tratto
    const w = Math.min(R * 1.65, 8.5);
    const h = w / 4;
    const tex = labelTexture(s, 1024, 256);
    texs.push(tex);
    const y = R + TUBE * 0.15;
    root.add(plane(w, h, tex, y, -(TUBE + 0.04), false));
    root.add(plane(w, h, tex, y, TUBE + 0.04, true));
    // la linea per terra: bianca all'arrivo, nel colore del tratto alla partenza
    roadLine(s.role === 'finish' ? 0.6 : 0.35, s.role === 'finish' ? white : matOf(st.color));
  }
  return {
    root,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}

export function Arches({ specs }: { specs: ArchSpec[] }) {
  const group = useMemo(() => new THREE.Group(), []);
  const built = useRef(new Map<string, Built>());
  // a ogni giro di React: si costruisce quello che manca, si sposta quello che c'è, si butta il resto
  useEffect(() => {
    const seen = new Set<string>();
    for (const s of specs) {
      const k = contentKey(s);
      if (seen.has(k)) continue;
      seen.add(k);
      let b = built.current.get(k);
      if (!b) {
        b = buildOne(s);
        built.current.set(k, b);
        group.add(b.root);
      }
      b.root.position.set(s.x, s.y, s.z);
      b.root.rotation.y = s.heading;
    }
    for (const [k, b] of built.current) {
      if (seen.has(k)) continue;
      group.remove(b.root);
      b.dispose();
      built.current.delete(k);
    }
  }, [specs, group]);
  useEffect(
    () => () => {
      for (const b of built.current.values()) b.dispose();
      built.current.clear();
    },
    [],
  );
  return <primitive object={group} />;
}
