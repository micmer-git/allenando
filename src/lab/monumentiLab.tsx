import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ARCHETIPO_LABEL, loadMonumenti, type Monumento } from '@/open/monumenti';
import { monumentoGeometry, TRI_CAP, type Dettaglio } from '@/world/monumenti/archetipi';

/*
 * Laboratorio dei monumenti (solo vite dev: /allenando/lab/monumenti.html). I quaranta modelli
 * di public/world/bergamo/monumenti.json in griglia, che girano piano, per guardarli senza
 * pedalare fino a Clusone.
 *   ?v=grid            tutti, ognuno scalato alla sua casella
 *   &from=0&n=8        solo una pagina (per le schermate)
 *   &det=bassa         il modello da lontano
 *   ?v=uno&id=w...     uno solo, in scala vera, da vicino
 *   &spin=0            fermi (le schermate escono uguali)
 *   &yaw=0.8           girati tutti di tanto (radianti)
 */

const q = new URLSearchParams(location.search);
const VIEW = q.get('v') ?? 'grid';
const DET = (q.get('det') ?? 'alta') as Dettaglio;
const FROM = Number(q.get('from') ?? 0);
const N = Number(q.get('n') ?? 999);
const SPIN = q.get('spin') !== '0';
const YAW = Number(q.get('yaw') ?? 0.6);

interface Item {
  m: Monumento;
  geo: THREE.BufferGeometry;
  tris: { alta: number; bassa: number };
}

function labelTexture(text: string, sub: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(22,19,10,0.82)';
  g.beginPath();
  g.roundRect(4, 8, 504, 112, 22);
  g.fill();
  g.fillStyle = '#ffc814';
  g.font = '700 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(text.length > 26 ? `${text.slice(0, 25)}…` : text, 256, 56);
  g.fillStyle = '#f4f1e8';
  g.font = '500 30px system-ui, sans-serif';
  g.fillText(sub, 256, 98);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Model({ item, at, scale, label }: { item: Item; at: [number, number, number]; scale: number; label: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  const tex = useMemo(() => labelTexture(item.m.name, `${ARCHETIPO_LABEL[item.m.kind]} · ${item.tris[DET].toLocaleString('it')} tr.`), [item]);
  useEffect(() => () => {
    mat.dispose();
    tex.dispose();
  }, [mat, tex]);
  useFrame((_, dt) => {
    if (SPIN && ref.current) ref.current.rotation.y += dt * 0.35;
  });
  return (
    <group position={at}>
      <group ref={ref} scale={scale} rotation={[0, YAW, 0]}>
        <mesh geometry={item.geo} material={mat} />
      </group>
      {label ? (
        <sprite position={[0, 0.2, 8]} scale={[10, 2.5, 1]}>
          <spriteMaterial map={tex} depthTest={false} />
        </sprite>
      ) : null}
    </group>
  );
}

function Stats({ items }: { items: Item[] }) {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  useFrame(() => {
    frames.current++;
    if (frames.current === 20) {
      const over = items.filter((i) => i.tris.alta > TRI_CAP.alta || i.tris.bassa > TRI_CAP.bassa).map((i) => i.m.id);
      (window as unknown as { __lab: unknown }).__lab = {
        ready: true,
        count: items.length,
        calls: gl.info.render.calls,
        scene: gl.info.render.triangles,
        maxAlta: Math.max(...items.map((i) => i.tris.alta)),
        maxBassa: Math.max(...items.map((i) => i.tris.bassa)),
        over,
      };
    }
  });
  return null;
}

function Cam({ pos, at, fov }: { pos: [number, number, number]; at: [number, number, number]; fov: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    camera.position.set(...pos);
    camera.fov = fov;
    camera.near = 0.5;
    camera.far = 4000;
    camera.updateProjectionMatrix();
    camera.lookAt(...at);
  }, [camera, pos, at, fov]);
  return null;
}

function Light() {
  return (
    <>
      <color attach="background" args={['#cfdbe5']} />
      <hemisphereLight args={['#e6f0fb', '#5b6146', 0.7]} />
      <directionalLight position={[-60, 90, 50]} intensity={1.9} color="#fff0d6" />
    </>
  );
}

function Scene({ items }: { items: Item[] }) {
  const narrow = window.innerWidth < 700;
  if (VIEW === 'uno') {
    const it = items[0];
    if (!it) return null;
    const r = Math.max(it.m.w, it.m.d, it.m.h);
    return (
      <>
        <Light />
        <Model item={it} at={[0, 0, 0]} scale={1} label={false} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
          <circleGeometry args={[r * 1.6, 48]} />
          <meshLambertMaterial color="#7d7f72" />
        </mesh>
        <Cam pos={[r * 1.25, r * 0.75, r * 1.55]} at={[0, it.m.h * 0.4, 0]} fov={narrow ? 60 : 42} />
      </>
    );
  }
  // griglia: ogni modello nella sua casella, scalato sulla misura più grande, il nome davanti
  const cols = narrow ? 2 : items.length <= 8 ? 4 : 8;
  const rows = Math.ceil(items.length / cols);
  const cell = 16;
  const rowStep = 22;
  const W = cols * cell;
  const D = rows * rowStep;
  return (
    <>
      <Light />
      {items.map((it, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const s = 10 / Math.max(it.m.w, it.m.d, it.m.h);
        return <Model key={it.m.id} item={it} at={[(c - (cols - 1) / 2) * cell, 0, (r - (rows - 1) / 2) * rowStep]} scale={s} label />;
      })}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[W + 20, D + 20]} />
        <meshLambertMaterial color="#7d7f72" />
      </mesh>
      <Cam pos={[0, Math.max(W, D) * (narrow ? 0.9 : 0.62), D * 0.5 + Math.max(W, D) * (narrow ? 0.55 : 0.68)]} at={[0, 0, D * 0.08]} fov={narrow ? 58 : 44} />
    </>
  );
}

function Lab() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void loadMonumenti().then((list) => {
      if (!list.length) {
        setErr('Manca public/world/bergamo/monumenti.json: npm run world:build.');
        return;
      }
      let pick = list;
      if (VIEW === 'uno') pick = list.filter((m) => m.id === q.get('id')).slice(0, 1);
      else pick = list.slice(FROM, FROM + N);
      setItems(
        pick.map((m) => {
          const geo = monumentoGeometry(m, DET);
          const tris = { alta: DET === 'alta' ? geo.attributes.position.count / 3 : monumentoGeometry(m, 'alta').attributes.position.count / 3, bassa: DET === 'bassa' ? geo.attributes.position.count / 3 : monumentoGeometry(m, 'bassa').attributes.position.count / 3 };
          return { m, geo, tris };
        }),
      );
    });
  }, []);
  const total = items ? items.reduce((s, i) => s + i.tris[DET], 0) : 0;
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {items ? (
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: true }}
          camera={{ fov: 45, near: 0.5, far: 4000, position: [0, 60, 80] }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
          }}
        >
          <Scene items={items} />
          <Stats items={items} />
        </Canvas>
      ) : null}
      <div style={{ position: 'absolute', left: 10, top: 8, padding: '6px 10px', borderRadius: 10, background: 'rgba(22,19,10,0.78)', fontSize: 12 }}>
        <b style={{ color: '#ffc814' }}>Monumenti · {VIEW} · {DET}</b>
        {err ? <div>{err}</div> : null}
        {items ? (
          <div>
            {items.length} modelli · {total.toLocaleString('it')} triangoli · tetto {TRI_CAP[DET].toLocaleString('it')} a modello
          </div>
        ) : null}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  );
