import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Look } from '@/game/look';
import { riderGeometry } from '@/world/riderBuild';
import { kitMaterial, lookKey } from '@/world/riderKit';
import { RiderRig, riderMesh } from '@/world/riderRig';

/*
 * Il ciclista nel garage: una tela piccola e da sola, con luci da studio, un disco a terra con
 * l'ombra vera e lo sfondo caldo e scuro del marchio. Gira piano su sé stesso e si gira col dito.
 * Basta l'aspetto (`look`): niente motore, niente mondo.
 */

interface Drag {
  active: boolean;
  x: number;
  angle: number;
  /** velocità lasciata dal dito, che si spegne piano */
  vel: number;
  /** quando si è smesso di toccare (secondi della tela) */
  idle: number;
}

export function RiderPreview({ look, className, spin = true, pedaling = true }: { look: Look; className?: string; spin?: boolean; pedaling?: boolean }) {
  const drag = useRef<Drag>({ active: false, x: 0, angle: -0.55, vel: 0, idle: -10 });
  const kick = useRef<() => void>(() => {});
  const animated = spin || pedaling;
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        touchAction: 'pan-y',
        cursor: 'grab',
        background: 'radial-gradient(120% 95% at 50% 36%, #3b3014 0%, #211b0b 52%, #0f0d07 100%)',
      }}
      onPointerDown={(e) => {
        drag.current.active = true;
        drag.current.x = e.clientX;
        drag.current.vel = 0;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d.active) return;
        const dx = e.clientX - d.x;
        d.x = e.clientX;
        d.angle += dx * 0.012;
        d.vel = dx * 0.012 * 60;
        kick.current();
      }}
      onPointerUp={() => {
        drag.current.active = false;
        drag.current.idle = performance.now() / 1000;
      }}
      onPointerCancel={() => {
        drag.current.active = false;
      }}
    >
      <Canvas
        dpr={[1, 1.75]}
        frameloop={animated ? 'always' : 'demand'}
        shadows="percentage"
        camera={{ fov: 26, near: 0.1, far: 40, position: [0.3, 1.25, 4.2] }}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.08;
          gl.setClearColor(0x000000, 0);
        }}
        style={{ position: 'absolute', inset: 0 }}
        aria-label="Anteprima del ciclista"
      >
        <Framing />
        <Studio />
        <PreviewRider look={look} spin={spin} pedaling={pedaling} drag={drag} kick={kick} />
      </Canvas>
    </div>
  );
}

/** La camera si allontana quanto basta perché bici e ciclista stiano nella tela, larga o stretta. */
function Framing() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useEffect(() => {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // 1,75 m d'altezza (casco e ombra), 2 m di larghezza (la bici di traverso mentre gira)
    const d = Math.max(0.875 / t, 1 / (t * aspect)) + 0.15;
    camera.position.set(0.3 * (d / 4.2), 0.78 + 0.47 * (d / 4.2), d);
    camera.lookAt(0, 0.8, 0);
    camera.updateProjectionMatrix();
  }, [camera, aspect]);
  return null;
}

/** Luci da studio, un riflesso di stanza sui materiali lucidi e il disco a terra. */
function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);
  const glow = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,200,20,0.22)');
      grd.addColorStop(0.55, 'rgba(255,200,20,0.07)');
      grd.addColorStop(1, 'rgba(255,200,20,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => glow.dispose(), [glow]);
  return (
    <>
      <hemisphereLight args={['#fff4dc', '#3a2c10', 0.55]} />
      <directionalLight
        position={[2.2, 3.6, 2.4]}
        intensity={2.3}
        color="#fff0d8"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={4}
        shadow-camera-left={-1.4}
        shadow-camera-right={1.4}
        shadow-camera-top={1.6}
        shadow-camera-bottom={-1.2}
        shadow-camera-near={1}
        shadow-camera-far={9}
      />
      {/* controluce fredda: stacca la sagoma dallo sfondo scuro */}
      <directionalLight position={[-2.5, 2.2, -3]} intensity={1.4} color="#c9dcff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[1.55, 48]} />
        <meshBasicMaterial map={glow} transparent depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
        <circleGeometry args={[1.3, 48]} />
        <shadowMaterial transparent opacity={0.5} color="#000000" />
      </mesh>
    </>
  );
}

function PreviewRider({
  look,
  spin,
  pedaling,
  drag,
  kick,
}: {
  look: Look;
  spin: boolean;
  pedaling: boolean;
  drag: React.RefObject<Drag>;
  kick: React.RefObject<() => void>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  // scheletro e maglia insieme: vedi RiderMesh.tsx (StrictMode chiama due volte)
  const { rig, mesh } = useMemo(() => {
    const r = new RiderRig(0.37);
    const m = riderMesh(riderGeometry('alta', look.rim), kitMaterial(look, 'alta'), r);
    m.castShadow = true;
    m.receiveShadow = true;
    return { rig: r, mesh: m };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const key = lookKey(look);
  useEffect(() => {
    mesh.geometry = riderGeometry('alta', look.rim);
    mesh.material = kitMaterial(look, 'alta');
    rig.glasses = !!look.glasses;
    rig.update({ dt: 0, cadence: 0, speed: 0, grade: 0 });
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    kick.current = invalidate;
  }, [invalidate, kick]);
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const d = drag.current;
    const now = performance.now() / 1000;
    if (!d.active) {
      // l'inerzia del dito, poi dopo un attimo riprende a girare da solo
      d.angle += d.vel * dt;
      d.vel *= Math.exp(-dt * 3);
      if (spin && now - d.idle > 1.6) d.angle += dt * 0.32;
    }
    if (group.current) group.current.rotation.y = d.angle;
    rig.update({ dt, cadence: pedaling ? 84 : 0, speed: pedaling ? 7.5 : 0, grade: 0, force: { glance: 0 } });
  });
  // il ciclista è lungo 1,8 m: lo si centra sul movimento centrale, un po' indietro
  return (
    <group ref={group} position={[0, 0, 0]}>
      <primitive object={mesh} dispose={null} position={[0, 0, -0.08]} />
    </group>
  );
}
