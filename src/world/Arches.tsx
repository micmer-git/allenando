import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SEGMENT_STYLE, type ArchSpec } from '@/game/arches';

/**
 * Gli archi dei traguardi: un arco gonfiabile che scavalca la strada (un metro di margine per
 * lato) col nome grande sulle due facce, nel colore del traguardo (ciclamino la volata, azzurro il
 * GPM, oro la crono); i cartelli a bordo strada coi metri che mancano. Il contratto delle pose è in
 * src/game/arches.ts: avanti = (sin h, 0, cos h), la faccia principale guarda chi arriva.
 */

const TUBE = 0.55;

function fitText(g: CanvasRenderingContext2D, text: string, weight: number, size: number, max: number): number {
  let s = size;
  g.font = `${weight} ${s}px sans-serif`;
  while (g.measureText(text).width > max && s > 18) {
    s -= 4;
    g.font = `${weight} ${s}px sans-serif`;
  }
  return s;
}

/** La scritta: fondo del colore del traguardo, titolo grande, nome sotto. */
function labelTexture(spec: ArchSpec, w: number, h: number): THREE.CanvasTexture {
  const st = SEGMENT_STYLE[spec.kind];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = st.color;
  g.fillRect(0, 0, w, h);
  // bordo chiaro e fascia scura in basso: si stacca dal cielo e dal bosco
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface Built {
  group: THREE.Group;
  dispose: () => void;
}

function buildArches(specs: ArchSpec[]): Built {
  const group = new THREE.Group();
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
  const white = matOf('#f4f4ef');
  const dark = matOf('#24272c');
  const plane = (w: number, h: number, tex: THREE.Texture, y: number, z: number, back: boolean) => {
    const geo = new THREE.PlaneGeometry(w, h);
    geos.push(geo);
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.18 });
    mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, y, z);
    // PlaneGeometry guarda +z: la faccia davanti guarda chi arriva (−z), quella dietro chi l'ha passato
    if (!back) m.rotation.y = Math.PI;
    return m;
  };
  for (const s of specs) {
    const st = SEGMENT_STYLE[s.kind];
    const root = new THREE.Group();
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.heading;
    group.add(root);
    if (s.role === 'banner') {
      // cartello a destra di chi arriva: due paletti e un pannello scritto sulle due facce
      const side = new THREE.Group();
      side.position.x = -(s.halfWidth + 1.4);
      root.add(side);
      const tex = labelTexture(s, 512, 192);
      texs.push(tex);
      const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.1, 6);
      pole.translate(0, 1.05, 0);
      geos.push(pole);
      for (const dx of [-0.9, 0.9]) {
        const p = new THREE.Mesh(pole, dark);
        p.position.x = dx;
        side.add(p);
      }
      const boardGeo = new THREE.BoxGeometry(2.3, 0.9, 0.05);
      geos.push(boardGeo);
      const board = new THREE.Mesh(boardGeo, matOf(st.color));
      board.position.y = 1.75;
      side.add(board);
      side.add(plane(2.2, 0.82, tex, 1.75, -0.03, false));
      side.add(plane(2.2, 0.82, tex, 1.75, 0.03, true));
      continue;
    }
    // arco gonfiabile: mezzo toro che scavalca la carreggiata con un metro di margine per lato
    const R = s.halfWidth + 1 + TUBE;
    const torus = new THREE.TorusGeometry(R, TUBE, 12, 40, Math.PI);
    geos.push(torus);
    root.add(new THREE.Mesh(torus, matOf(st.color)));
    // fasce bianche ai piedi, come le cuciture dei gonfiabili
    const band = new THREE.CylinderGeometry(TUBE * 1.04, TUBE * 1.08, 0.5, 12);
    band.translate(0, 0.25, 0);
    const foot = new THREE.CylinderGeometry(TUBE * 1.25, TUBE * 1.35, 0.22, 12);
    foot.translate(0, 0.11, 0);
    geos.push(band, foot);
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
    // la linea per terra: bianca all'arrivo, a scacchi nel colore del tratto alla partenza
    const lineGeo = new THREE.PlaneGeometry(s.halfWidth * 2, s.role === 'finish' ? 0.6 : 0.35);
    lineGeo.rotateX(-Math.PI / 2);
    lineGeo.translate(0, 0.07, 0);
    geos.push(lineGeo);
    const line = new THREE.Mesh(lineGeo, s.role === 'finish' ? white : matOf(st.color));
    root.add(line);
  }
  return {
    group,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}

export function Arches({ specs }: { specs: ArchSpec[] }) {
  // si ricostruisce solo se cambiano davvero gli archi, non a ogni nuovo array con gli stessi id
  const key = specs.map((s) => `${s.id}|${s.label}|${s.sub ?? ''}|${s.x.toFixed(1)}|${s.z.toFixed(1)}|${s.halfWidth.toFixed(1)}`).join(';');
  const built = useMemo(
    () => buildArches(specs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(() => () => built.dispose(), [built]);
  return <primitive object={built.group} />;
}
