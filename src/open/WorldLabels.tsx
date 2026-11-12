import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { TrackPose } from '@/domain/track';
import { canvasTex } from '@/world/Scene';
import type { Terrain, WorldData } from './world';
import { LABEL_GONE, labelFade, landmarkSub, occluded, peakSub, placeLabels, volumeBlocks, type LabelCandidate, type Rect, type Volume } from './labels';
import { arteStrada } from './arteStrada';
import { lookFor } from './look';

/*
 * I nomi dei luoghi nel 3D (cime, passi, paesi, luoghi da riconoscere). Le regole stanno in
 * labels.ts: al massimo tre insieme, pieni fino a 1,5 km e poi sfumati, nascosti quando il
 * terreno sta in mezzo, mai tagliati dal bordo e mai sopra un pannello dell'HUD.
 */

const FONT = 'Outfit, system-ui, sans-serif';
/** Altezza sullo schermo di un nome con la sua seconda riga, pixel CSS: uguale in verticale e in orizzontale. */
const LABEL_PX = 46;
/** Altezza della tela di un nome con due righe, pixel. */
const TEX_H = 116;

interface LabelData {
  /** misure della tela, pixel */
  w: number;
  h: number;
  prio: number;
  range: number;
  /** quota del luogo: la linea di vista si controlla fin lì */
  ground: number;
}

/** Un nome: la tela si allarga quanto il testo, così nessun nome resta tagliato. */
function labelTex(name: string, sub: string, peak: boolean): { tex: THREE.CanvasTexture; w: number; h: number } {
  const probe = document.createElement('canvas').getContext('2d');
  let tw = name.length * 24;
  if (probe) {
    probe.font = `700 44px ${FONT}`;
    tw = probe.measureText(name).width;
    if (sub) {
      probe.font = `600 30px ${FONT}`;
      tw = Math.max(tw, probe.measureText(sub).width);
    }
  }
  const w = Math.ceil(tw + 28);
  const h = sub ? TEX_H : 66;
  const tex = canvasTex(w, h, (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.font = `700 44px ${FONT}`;
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(10,12,15,0.7)';
    g.fillStyle = peak ? '#fff7e8' : '#ffffff';
    g.strokeText(name, w / 2, 34);
    g.fillText(name, w / 2, 34);
    if (sub) {
      g.font = `600 30px ${FONT}`;
      g.lineWidth = 6;
      g.strokeText(sub, w / 2, 86);
      g.fillStyle = peak ? '#ffd27a' : '#ffc814';
      g.fillText(sub, w / 2, 86);
    }
  });
  return { tex, w, h };
}

function labelSprite(name: string, sub: string, peak: boolean, x: number, y: number, z: number, data: Omit<LabelData, 'w' | 'h'>): THREE.Sprite {
  const { tex, w, h } = labelTex(name, sub, peak);
  // sopra tutto: un nome mezzo coperto da una casa sembra un errore (il terreno lo controlla Declutter)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false }));
  s.position.set(x, y, z);
  s.center.set(0.5, 0);
  s.renderOrder = 5;
  s.userData = { ...data, w, h } satisfies LabelData;
  return s;
}

function disposeSprite(s: THREE.Sprite): void {
  s.material.map?.dispose();
  s.material.dispose();
}

interface LabelItem {
  name: string;
  sub: string;
  x: number;
  y: number;
  z: number;
  ground: number;
  range: number;
  peak: boolean;
}

/** Cime, passi e paesi: si creano solo i nomi abbastanza vicini da poter essere accesi. */
export function Labels({ data, playerPose, names }: { data: WorldData; playerPose: () => TrackPose; names: Set<THREE.Sprite> }) {
  const items = useMemo<LabelItem[]>(() => {
    const out: LabelItem[] = [];
    // le cime con la quota si leggono da più lontano degli altri nomi (look.peakRange, 8 km):
    // il nome sta 25 m sopra la vetta e si spegne dietro il terreno (Declutter, occluded)
    const peakRange = lookFor(data.graph.id).peakRange;
    for (const p of data.features.peaks) {
      // la quota col separatore («2.112 m»), come le altre quote dell'app (F.13); il cartello del passo no
      const ele = peakSub(p.ele);
      if (p.pass) out.push({ name: p.name, sub: ele, x: p.x, y: p.ele + 12, z: p.z, ground: p.ele, range: 7000, peak: false });
      else if (p.ele >= 1400) out.push({ name: p.name, sub: ele, x: p.x, y: p.ele + 25, z: p.z, ground: p.ele, range: peakRange, peak: true });
    }
    for (const p of data.features.places) {
      const range = p.kind === 'city' ? 30000 : p.kind === 'town' ? 9000 : p.kind === 'village' ? 4500 : p.kind === 'suburb' || p.kind === 'quarter' ? 1500 : 1200;
      out.push({ name: p.name, sub: '', x: p.x, y: p.y + (p.kind === 'city' ? 120 : 45), z: p.z, ground: p.y, range, peak: false });
    }
    for (const a of arteStrada(data)) out.push({name:a.name,sub:a.place,x:a.x,z:a.z,y:a.y+9,ground:a.y,range:320,peak:false});
    return out;
  }, [data]);
  const group = useRef<THREE.Group>(null);
  const live = useRef(new Map<number, THREE.Sprite>());
  const clock = useRef(0);
  useEffect(() => {
    const map = live.current;
    return () => {
      for (const s of map.values()) {
        names.delete(s);
        disposeSprite(s);
      }
      map.clear();
    };
  }, [names]);
  useFrame((_, dt) => {
    clock.current -= dt;
    const g = group.current;
    if (!g || clock.current > 0) return;
    clock.current = 0.6;
    const p = playerPose();
    // oltre la sua portata un nome non si accende comunque: non serve la sua tela (le cime
    // arrivano a look.peakRange, gli altri a LABEL_GONE)
    const near: { i: number; k: number }[] = [];
    items.forEach((it, i) => {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      const range = it.peak ? it.range : Math.min(it.range, LABEL_GONE);
      if (d < range && d > 60) near.push({ i, k: d / range });
    });
    near.sort((a, b) => a.k - b.k);
    const want = new Set(near.slice(0, 16).map((n) => n.i));
    for (const [i, s] of live.current) {
      if (want.has(i)) continue;
      names.delete(s);
      g.remove(s);
      disposeSprite(s);
      live.current.delete(i);
    }
    for (const i of want) {
      if (live.current.has(i)) continue;
      const it = items[i];
      const s = labelSprite(it.name, it.sub, it.peak, it.x, it.y, it.z, { prio: it.peak ? 2 : 1, range: it.peak ? it.range : Math.min(it.range, LABEL_GONE), ground: it.ground });
      live.current.set(i, s);
      names.add(s);
      g.add(s);
    }
  });
  return <group ref={group} />;
}

/** I luoghi da riconoscere: chiese, porte, torri, ponti. Il nome, e sotto il tipo quando dice qualcosa. */
export function Landmarks({ data, playerPose, names }: { data: WorldData; playerPose: () => TrackPose; names: Set<THREE.Sprite> }) {
  const group = useRef<THREE.Group>(null);
  const built = useRef(false);
  useEffect(() => {
    const g = group.current;
    if (!g || built.current) return;
    built.current = true;
    const pole = new THREE.CylinderGeometry(0.12, 0.12, 9, 6);
    pole.translate(0, 4.5, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: '#20242b' });
    for (const l of data.features.landmarks) {
      const tall = l.kind === 'cima' || l.kind === 'passo' || l.kind === 'fiume' || l.kind === 'paese' || l.kind === 'citta';
      const s = labelSprite(l.name, landmarkSub(l.kind), l.kind === 'cima' || l.kind === 'passo', l.x, l.y + (tall ? 30 : 16), l.z, { prio: 0, range: Math.min(tall ? 6000 : 1600, LABEL_GONE), ground: l.y });
      s.visible = false;
      names.add(s);
      g.add(s);
      if (!tall) {
        const m = new THREE.Mesh(pole, poleMat);
        m.position.set(l.x, l.y - 1, l.z);
        g.add(m);
      }
    }
    return () => {
      g.traverse((o) => {
        if (o instanceof THREE.Sprite) {
          names.delete(o);
          disposeSprite(o);
        }
      });
      pole.dispose();
      poleMat.dispose();
      g.clear();
      built.current = false;
    };
  }, [data, names]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const p = playerPose();
    for (const o of g.children) {
      if (o instanceof THREE.Sprite) o.visible = Math.hypot(o.position.x - p.x, o.position.z - p.z) < (o.userData as LabelData).range;
    }
  });
  return <group ref={group} />;
}

// ---------- quali nomi accendere ----------

/** Un elemento dell'HUD che copre la scena: un pannello, un tasto, un testo, un disegno. */
function isPanel(el: Element): boolean {
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'svg' || tag === 'canvas' || tag === 'img' || tag === 'input') return true;
  if (st.backgroundImage !== 'none') return true;
  const m = /rgba?\(([^)]+)\)/.exec(st.backgroundColor);
  if (m) {
    const a = m[1].split(/[\s,/]+/).filter(Boolean)[3];
    if ((a == null ? 1 : Number(a)) > 0.15) return true;
  }
  for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent?.trim()) return true;
  return false;
}

/**
 * I rettangoli dell'HUD sopra la tela, in pixel della tela. Si leggono dalla pagina, così valgono
 * anche quando l'HUD cambia (verticale, orizzontale, computer). Un velo grande quanto la scena
 * (caricamento, pausa) non conta: sotto un velo i nomi non si leggono comunque.
 */
function hudRects(canvas: HTMLCanvasElement): Rect[] | null {
  const wrap = canvas.parentElement?.parentElement ?? null;
  const root = canvas.closest('[data-testid=ride-screen]') ?? wrap?.parentElement ?? null;
  if (!root) return null;
  const cb = canvas.getBoundingClientRect();
  const big = cb.width * cb.height * 0.45;
  const out: Rect[] = [];
  for (const el of root.querySelectorAll('*')) {
    if (wrap && wrap.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.width * r.height > big) continue;
    if (r.right <= cb.left || r.left >= cb.right || r.bottom <= cb.top || r.top >= cb.bottom) continue;
    if (!isPanel(el)) continue;
    out.push([r.left - cb.left, r.top - cb.top, r.right - cb.left, r.bottom - cb.top]);
  }
  return out;
}

/**
 * Cinque volte al secondo: chi è abbastanza vicino, chi non sta dietro una montagna, e fra questi
 * i tre più importanti che stanno tutti dentro la tela e fuori dall'HUD. Si accendono e si spengono
 * sfumando; la dimensione sullo schermo è fissa, in pixel.
 */
/** Le case e i monumenti intorno al ciclista che possono coprire un nome (li aggiorna WorldScene). */
export interface Occluders {
  list: Volume[];
}

export function Declutter({ names, terrain, playerPose, occluders }: { names: Set<THREE.Sprite>; terrain: Terrain; playerPose: () => TrackPose; occluders: Occluders }) {
  const { camera, gl, size } = useThree();
  const clock = useRef(0);
  const hudClock = useRef(0);
  const hud = useRef<Rect[] | null>(null);
  const want = useRef(new WeakMap<THREE.Sprite, number>());
  const v = useMemo(() => new THREE.Vector3(), []);
  const height = useMemo(() => (x: number, z: number) => terrain.height(x, z), [terrain]);
  useFrame((_, dt) => {
    const P = camera.projectionMatrix.elements;
    // un pixel della tela del nome, in unità dello sprite (sizeAttenuation: false)
    const unit = LABEL_PX / ((P[5] * size.height) / 2) / TEX_H;
    hudClock.current -= dt;
    if (hudClock.current <= 0) {
      hudClock.current = 0.5;
      hud.current = hudRects(gl.domElement);
    }
    clock.current -= dt;
    if (clock.current <= 0) {
      clock.current = 0.2;
      const cands: LabelCandidate<THREE.Sprite>[] = [];
      const fade = new Map<THREE.Sprite, number>();
      for (const s of names) {
        if (!s.visible) continue;
        const d = camera.position.distanceTo(s.position);
        const f = labelFade(d, (s.userData as LabelData).range);
        if (f <= 0) continue;
        v.copy(s.position).project(camera);
        if (v.z <= -1 || v.z >= 1) continue;
        const u = s.userData as LabelData;
        const w = (u.w * unit * P[0] * size.width) / 2;
        const h = (u.h * unit * P[5] * size.height) / 2;
        const x = ((v.x + 1) / 2) * size.width;
        const y = ((1 - v.y) / 2) * size.height;
        cands.push({ key: s, rect: [x - w / 2, y - h, x + w / 2, y], prio: u.prio, d });
        fade.set(s, f);
      }
      // il ciclista non si copre
      const pose = playerPose();
      const blocked: Rect[] = [...(hud.current ?? [])];
      const foot = v.set(pose.x, pose.y, pose.z).project(camera).clone();
      const head = v.set(pose.x, pose.y + 1.9, pose.z).project(camera);
      if (foot.z < 1 && head.z < 1) {
        const yb = ((1 - foot.y) / 2) * size.height;
        const yt = ((1 - head.y) / 2) * size.height;
        const xc = ((foot.x + 1) / 2) * size.width;
        const hw = Math.max(20, (yb - yt) * 0.45);
        blocked.push([xc - hw, yt, xc + hw, yb]);
      }
      // senza HUD trovato nella pagina, la fascia alta resta comunque libera
      const top = hud.current ? size.height * 0.06 : size.height * 0.25;
      const cam = camera.position;
      const visible = cands.filter((c) => {
        const u = c.key.userData as LabelData;
        const s = c.key.position;
        // dietro una montagna (il DEM: un campione ogni 60 m fino a 8 km, così una cresta in mezzo
        // non scappa), o dietro una casa o un monumento vicini (il punto del nome)
        if (occluded(height, cam.x, cam.y, cam.z, s.x, u.ground + 8, s.z)) return false;
        for (const v of occluders.list) if (volumeBlocks(cam.x, cam.y, cam.z, s.x, s.y, s.z, v)) return false;
        return true;
      });
      const on = placeLabels(visible, { width: size.width, height: size.height, top }, blocked);
      for (const s of names) want.current.set(s, on.has(s) ? (fade.get(s) ?? 0) : 0);
    }
    const k = Math.min(1, dt * 6);
    for (const s of names) {
      const u = s.userData as LabelData;
      s.scale.set(u.w * unit, u.h * unit, 1);
      const t = want.current.get(s) ?? 0;
      s.material.opacity += (t - s.material.opacity) * k;
    }
  });
  return null;
}
