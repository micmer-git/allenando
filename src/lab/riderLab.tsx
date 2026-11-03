import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_LOOK, lookFromColor, type Look, type Pattern, type Rim } from '@/game/look';
import { RiderPreview } from '@/components/RiderPreview';
import { Rider } from '@/world/RiderMesh';
import { riderGeometry, triangles, type RiderDetail } from '@/world/riderBuild';
import { kitMaterial } from '@/world/riderKit';
import { RiderRig, riderMesh, type RigInput } from '@/world/riderRig';

/*
 * Laboratorio del ciclista (solo vite dev: /allenando/lab/rider.html). Serve a guardarlo
 * davvero: i dieci disegni di maglia, i tre dettagli, le pose, da vicino e da lontano.
 *   ?v=grid     dieci maglie in due file, luce del gioco
 *   ?v=lod      alta, media e bassa affiancate
 *   ?v=pose     seduto, fuori sella, aero, a ruota libera
 *   ?v=side     un ciclista grande di fianco (lato trasmissione)
 *   ?v=back     da dietro, alla distanza della camera di gioco
 *   ?v=close    mani, testa, casco e occhiali da vicino
 *   ?v=preview  l'anteprima del garage
 *   &crank=1.2  pedivelle ferme a quell'angolo (per controllare piedi e ginocchia)
 */

const q = new URLSearchParams(location.search);
const VIEW = q.get('v') ?? 'grid';
const CRANK = q.get('crank') != null ? Number(q.get('crank')) : null;

const PATTERNS: Pattern[] = ['tinta', 'fascia', 'righe', 'cerchi', 'pois', 'chevron', 'sfumato', 'spalle', 'diagonale', 'quadri'];
const KITS: Look[] = PATTERNS.map((pattern, i) => {
  const base = [
    { jersey: '#ffc814', accent: '#16130a' },
    { jersey: '#f4f1e8', accent: '#d62839' },
    { jersey: '#1b4f9c', accent: '#f4f1e8' },
    { jersey: '#16130a', accent: '#ffc814' },
    { jersey: '#f4f1e8', accent: '#d62839' },
    { jersey: '#0f7a5a', accent: '#ffc814' },
    { jersey: '#ff7a1a', accent: '#5b1f8a' },
    { jersey: '#e9e6dc', accent: '#1b2230' },
    { jersey: '#2b2f38', accent: '#ff3d7f' },
    { jersey: '#f4f1e8', accent: '#16130a' },
  ][i];
  const rims: Rim[] = ['basso', 'alto', 'lenticolare'];
  return {
    ...DEFAULT_LOOK,
    ...base,
    pattern,
    helmet: i % 3 === 0 ? '#f4f1e8' : i % 3 === 1 ? '#16130a' : base.jersey,
    frame: ['#1d1b17', '#e9e6dc', '#2a3442', '#b5121b', '#16130a'][i % 5],
    frameAccent: i % 2 ? base.accent : '#ffc814',
    socks: i % 2 ? '#f4f1e8' : '#16130a',
    shoes: i % 4 === 1 ? '#16130a' : '#f4f1e8',
    rim: rims[i % 3],
    glasses: i === 3 ? '' : ['#2b2b2b', '#c0392b', '#2a6fdb', '#d4a017'][i % 4],
    skin: ['#d9ad8c', '#c08a64', '#8d5a3b', '#f0c9a8'][i % 4],
  };
});

/** Un ciclista pilotato a mano (pose forzate), senza strada sotto. */
function LabRider({ look, detail = 'alta', position = [0, 0, 0], rotY = 0, input }: { look: Look; detail?: RiderDetail; position?: [number, number, number]; rotY?: number; input?: Partial<RigInput> }) {
  const seed = position[0] * 0.13 + 0.31;
  const { rig, mesh } = useMemo(() => {
    const r = new RiderRig(seed);
    r.glasses = !!look.glasses;
    return { rig: r, mesh: riderMesh(riderGeometry(detail, look.rim), kitMaterial(look, detail), r) };
  }, [seed, look, detail]);
  useFrame((_, dt) => {
    rig.update({ dt, cadence: 86, speed: 8, grade: 0, ...input, force: { glance: 0, ...(CRANK != null ? { crank: CRANK } : {}), ...input?.force } });
  });
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <primitive object={mesh} dispose={null} />
    </group>
  );
}

function Stats() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  (window as unknown as { __scene: THREE.Scene }).__scene = scene;
  const frames = useRef(0);
  useFrame(() => {
    frames.current++;
    if (frames.current === 30) {
      const info = gl.info.render;
      const w = window as unknown as { __lab: unknown };
      w.__lab = { ready: true, calls: info.calls, tris: info.triangles };
      const el = document.getElementById('stats');
      if (el) el.textContent = `${info.calls} chiamate · ${info.triangles.toLocaleString('it')} triangoli in scena`;
    }
  });
  return null;
}

function GameLight({ ground = true }: { ground?: boolean }) {
  return (
    <>
      <color attach="background" args={['#cfdbe5']} />
      <hemisphereLight args={['#e6f0fb', '#4f5a3c', 0.62]} />
      <directionalLight position={[-7, 7.6, 5.2]} intensity={1.85} color="#fff0d6" />
      {ground ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[60, 60]} />
          <meshLambertMaterial color="#6d6f6c" />
        </mesh>
      ) : null}
    </>
  );
}

function Cam({ pos, at, fov }: { pos: [number, number, number]; at: [number, number, number]; fov?: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    camera.position.set(...pos);
    if (fov) camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(...at);
  }, [camera, pos, at, fov]);
  return null;
}

function Scene3D() {
  const narrow = window.innerWidth < 700;
  if (VIEW === 'grid') {
    // dieci maglie con il vero componente Rider (posa ferma, pedala)
    const cols = narrow ? 2 : 5;
    return (
      <>
        <GameLight />
        {KITS.map((look, i) => {
          const r = Math.floor(i / cols);
          const c = i % cols;
          const x = (c - (cols - 1) / 2) * 1.25;
          const z = -r * 2.3;
          return (
            <Rider
              key={i}
              look={look}
              side={0}
              detail="alta"
              label={i === 0 ? 'Laboratorio' : undefined}
              getPose={() => ({ x, y: 0, z, heading: 0, grade: 0, altitude: 0, distance: 0 })}
              getCadence={() => 84}
              getSpeed={() => 8}
            />
          );
        })}
        <Cam pos={narrow ? [-4.2, 4.6, -6.5] : [-5.5, 4.4, -6.2]} at={[0, 0.6, narrow ? -4.6 : -1.6]} fov={narrow ? 50 : 42} />
      </>
    );
  }
  if (VIEW === 'lod') {
    const d: RiderDetail[] = ['alta', 'media', 'bassa'];
    return (
      <>
        <GameLight />
        {d.map((detail, i) => (
          <LabRider key={detail} look={KITS[1]} detail={detail} position={[0, 0, (1 - i) * 2.1]} rotY={0} />
        ))}
        <Cam pos={[-5.8, 1.6, 0]} at={[0, 0.85, 0]} fov={narrow ? 62 : 40} />
      </>
    );
  }
  if (VIEW === 'pose') {
    const poses: Partial<RigInput>[] = [
      { force: { stand: 0, tuck: 0 } },
      { cadence: 70, force: { stand: 1, tuck: 0 } },
      { cadence: 95, speed: 13, force: { stand: 0, tuck: 1 } },
      { cadence: 0, speed: 12, grade: -0.06, force: { stand: 0, tuck: 1 } },
    ];
    return (
      <>
        <GameLight />
        {poses.map((input, i) => (
          <LabRider key={i} look={KITS[(i * 3) % 10]} position={[0, 0, (1.5 - i) * 2.05]} input={input} />
        ))}
        <Cam pos={[-7.4, 1.7, 0]} at={[0, 0.8, 0]} fov={narrow ? 66 : 42} />
      </>
    );
  }
  if (VIEW === 'side')
    return (
      <>
        <GameLight />
        <LabRider look={KITS[Number(q.get('k') ?? 0)]} />
        <Cam pos={[-3.3, 0.95, 0.1]} at={[0, 0.82, 0.1]} fov={narrow ? 46 : 32} />
      </>
    );
  if (VIEW === 'back')
    return (
      <>
        <GameLight />
        <LabRider look={KITS[Number(q.get('k') ?? 1)]} />
        <LabRider look={KITS[4]} detail="media" position={[1.4, 0, 6]} />
        <LabRider look={KITS[7]} detail="media" position={[-1.2, 0, 11]} />
        <LabRider look={KITS[2]} detail="bassa" position={[0.6, 0, 22]} />
        <Cam pos={[0, 3.1, -8.5]} at={[0, 1.2, 7]} fov={55} />
      </>
    );
  if (VIEW === 'close')
    return (
      <>
        <GameLight ground={false} />
        <LabRider look={KITS[Number(q.get('k') ?? 0)]} />
        <Cam pos={[-0.95, 1.55, 1.55]} at={[0, 1.15, 0.45]} fov={narrow ? 48 : 36} />
      </>
    );
  return null;
}

function Lab() {
  const [tris] = useState(() =>
    (['alta', 'media', 'bassa'] as const).map((d) => `${d}: ${(['basso', 'alto', 'lenticolare'] as const).map((r) => triangles(riderGeometry(d, r)).toLocaleString('it')).join(' / ')}`),
  );
  if (VIEW === 'preview') {
    const looks = [KITS[1], KITS[3], lookFromColor('#e94f37', 2), KITS[8]];
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, padding: 16 }}>
        {looks.map((l, i) => (
          <RiderPreview key={i} look={l} className="prev" spin={i !== 1} pedaling={i !== 2} />
        ))}
        <style>{'.prev{height:260px;border-radius:14px}'}</style>
        <PreviewReady />
      </div>
    );
  }
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true }}
        camera={{ fov: 45, near: 0.1, far: 300, position: [-4, 2, -4] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Scene3D />
        <Stats />
      </Canvas>
      <div style={{ position: 'absolute', left: 10, top: 8, padding: '6px 10px', borderRadius: 10, background: 'rgba(22,19,10,0.78)', fontSize: 12 }}>
        <b style={{ color: '#ffc814' }}>Ciclista · {VIEW}</b>
        <div>triangoli (basso / alto / lenticolare)</div>
        {tris.map((t) => (
          <div key={t}>{t}</div>
        ))}
        <div id="stats" />
      </div>
    </div>
  );
}

function PreviewReady() {
  useEffect(() => {
    const t = setTimeout(() => ((window as unknown as { __lab: unknown }).__lab = { ready: true }), 1500);
    return () => clearTimeout(t);
  }, []);
  return null;
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  );
