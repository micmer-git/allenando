import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Quality } from '@/domain/types';
import type { Track, TrackPoint } from '@/domain/track';
import type { RideEngine } from '@/sim/engine';

export function RideScene({
  engine,
  quality,
  camilla,
  onReady,
}: {
  engine: RideEngine;
  quality: Quality;
  camilla: boolean;
  onReady: () => void;
}) {
  return (
    <Canvas
      dpr={quality === 'low' ? 1 : quality === 'high' ? [1, 1.6] : [1, 1.25]}
      shadows={quality === 'high'}
      gl={{
        antialias: quality !== 'low',
        alpha: false,
        stencil: false,
        powerPreference: 'high-performance',
      }}
      camera={{ fov: 46, near: 0.1, far: 1800, position: [0, 5, -10] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
      }}
    >
      <color attach="background" args={['#c5dff2']} />
      <fog attach="fog" args={['#cfe4f2', 28, quality === 'low' ? 260 : 460]} />
      <hemisphereLight args={['#e7f4ff', '#7da86a', 0.72]} />
      <ambientLight intensity={0.28} />
      <directionalLight
        position={[80, 140, 40]}
        intensity={1.45}
        color="#fff1d6"
        castShadow={quality === 'high'}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <World engine={engine} quality={quality} camilla={camilla} />
      <FollowCam engine={engine} />
      <Ready onReady={onReady} />
    </Canvas>
  );
}

function Ready({ onReady }: { onReady: () => void }) {
  const sent = useRef(false);
  useFrame(() => {
    if (!sent.current) {
      sent.current = true;
      onReady();
    }
  });
  return null;
}

function FollowCam({ engine }: { engine: RideEngine }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3());
  const place = (dt: number) => {
    const pose = engine.pose();
    const fx = Math.sin(pose.heading);
    const fz = Math.cos(pose.heading);
    const rx = Math.cos(pose.heading);
    const rz = -Math.sin(pose.heading);
    desired.current.set(pose.x - fx * 5.4 + rx * 1.25, pose.y + 2.05, pose.z - fz * 5.4 + rz * 1.25);
    const k = 1 - Math.exp(-Math.min(1, dt) * 3.4);
    camera.position.lerp(desired.current, k);
    look.current.set(pose.x - fx * 0.35, pose.y + 0.85, pose.z - fz * 0.35);
    camera.lookAt(look.current);
  };
  useLayoutEffect(() => {
    place(1);
    // snap once so the first frame already frames the bike
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_, dt) => place(dt));
  return null;
}

function World({ engine, quality, camilla }: { engine: RideEngine; quality: Quality; camilla: boolean }) {
  const track = engine.track;
  const segments = quality === 'low' ? 42 : quality === 'high' ? 84 : 60;
  const terrain = useMemo(() => buildTerrain(track, segments), [track, segments]);
  const road = useMemo(() => buildRoad(track), [track]);
  const dashes = useMemo(() => buildDashes(track), [track]);
  const trees = useMemo(() => scatterTrees(track, quality === 'low' ? 46 : quality === 'high' ? 120 : 78), [track, quality]);
  const flowers = useMemo(() => (camilla ? scatterFlowers(track, quality === 'low' ? 40 : 90) : []), [track, camilla, quality]);
  const gate = useMemo(() => track.poseAt(28), [track]);
  const sign = useMemo(() => makeSignTexture(), []);
  useEffect(() => {
    return () => {
      terrain.dispose();
      road.dispose();
      dashes.dispose();
      sign.dispose();
    };
  }, [terrain, road, dashes, sign]);

  return (
    <group>
      <Sky />
      <mesh geometry={terrain} receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <mesh geometry={road} receiveShadow castShadow>
        <meshLambertMaterial color="#3c4452" />
      </mesh>
      <mesh geometry={dashes}>
        <meshBasicMaterial color="#f0d56c" />
      </mesh>
      <Trees items={trees} />
      {flowers.length > 0 ? <Flowers items={flowers} /> : null}
      <Gate pose={gate} texture={sign} />
      <Rider engine={engine} camilla={camilla} />
    </group>
  );
}

function Sky() {
  const geo = useMemo(() => {
    const geometry = new THREE.SphereGeometry(900, 18, 12);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const top = new THREE.Color('#8ebbe6');
    const mid = new THREE.Color('#d7ecf8');
    const horizon = new THREE.Color('#f6e7c8');
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 900;
      const color = y > 0.15 ? mid.clone().lerp(top, y) : horizon.clone().lerp(mid, (y + 1) / 1.15);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} depthWrite={false} />
    </mesh>
  );
}

function Rider({ engine, camilla }: { engine: RideEngine; camilla: boolean }) {
  const group = useRef<THREE.Group>(null);
  const front = useRef<THREE.Group>(null);
  const rear = useRef<THREE.Group>(null);
  const crank = useRef<THREE.Group>(null);
  const thighL = useRef<THREE.Group>(null);
  const thighR = useRef<THREE.Group>(null);
  const shinL = useRef<THREE.Group>(null);
  const shinR = useRef<THREE.Group>(null);
  const spin = useRef(0);
  const jersey = camilla ? '#f0a0b6' : '#dff25a';
  const shorts = '#243044';

  useFrame((_, dt) => {
    const pose = engine.pose();
    const root = group.current;
    if (!root) return;
    root.position.set(pose.x, pose.y + 0.1, pose.z);
    root.rotation.set(0, pose.heading, 0);
    const cadence = engine.cadence;
    spin.current += (cadence > 1 ? (cadence / 60) * Math.PI * 2 : engine.speed / 0.34) * dt;
    if (front.current) front.current.rotation.x = engine.distance / 0.34;
    if (rear.current) rear.current.rotation.x = engine.distance / 0.34;
    if (crank.current) crank.current.rotation.x = spin.current;
    const a = spin.current;
    if (thighL.current) thighL.current.rotation.x = 0.55 * Math.sin(a);
    if (thighR.current) thighR.current.rotation.x = 0.55 * Math.sin(a + Math.PI);
    if (shinL.current) shinL.current.rotation.x = 0.85 * Math.max(0, Math.sin(a + 0.4));
    if (shinR.current) shinR.current.rotation.x = 0.85 * Math.max(0, Math.sin(a + Math.PI + 0.4));
  });

  return (
    <group ref={group}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, -0.2]}>
        <circleGeometry args={[0.85, 20]} />
        <meshBasicMaterial map={blob()} transparent depthWrite={false} />
      </mesh>
      <Wheel wheelRef={rear} z={-0.48} />
      <Wheel wheelRef={front} z={0.62} />
      <Tube a={[0, 0.34, -0.48]} b={[0, 0.34, 0.62]} r={0.025} color="#2c313c" />
      <Tube a={[0, 0.34, -0.48]} b={[0, 0.92, -0.16]} r={0.02} color="#2c313c" />
      <Tube a={[0, 0.92, -0.16]} b={[0, 0.96, 0.36]} r={0.02} color="#2c313c" />
      <Tube a={[0, 0.34, 0.62]} b={[0, 0.96, 0.36]} r={0.02} color="#2c313c" />
      <Tube a={[0, 0.34, 0.05]} b={[0, 0.92, -0.16]} r={0.018} color="#3a4150" />
      <group ref={crank} position={[0.11, 0.32, 0.05]}>
        <mesh>
          <boxGeometry args={[0.02, 0.36, 0.025]} />
          <meshStandardMaterial color="#1b1e26" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0.03, 0.18, 0]}>
          <boxGeometry args={[0.06, 0.025, 0.08]} />
          <meshStandardMaterial color="#1b1e26" />
        </mesh>
        <mesh position={[-0.03, -0.18, 0]}>
          <boxGeometry args={[0.06, 0.025, 0.08]} />
          <meshStandardMaterial color="#1b1e26" />
        </mesh>
      </group>
      <mesh position={[0, 0.95, -0.16]}>
        <boxGeometry args={[0.12, 0.05, 0.16]} />
        <meshStandardMaterial color="#1d2128" />
      </mesh>
      <mesh position={[0, 1.12, 0.1]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[0.28, 0.36, 0.16]} />
        <meshStandardMaterial color={jersey} roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.96, -0.02]}>
        <boxGeometry args={[0.28, 0.14, 0.16]} />
        <meshStandardMaterial color={shorts} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.4, 0.24]}>
        <sphereGeometry args={[0.11, 16, 14]} />
        <meshStandardMaterial color="#e2b89a" roughness={0.65} />
      </mesh>
      <mesh position={[0, 1.46, 0.22]}>
        <sphereGeometry args={[0.125, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
        <meshStandardMaterial color={camilla ? '#f7c5d4' : '#2a3038'} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.48, 0.27]}>
        <boxGeometry args={[0.16, 0.035, 0.02]} />
        <meshStandardMaterial color="#1a1c22" />
      </mesh>
      <Tube a={[-0.16, 1.22, 0.12]} b={[-0.16, 1.0, 0.42]} r={0.035} color={jersey} />
      <Tube a={[0.16, 1.22, 0.12]} b={[0.16, 1.0, 0.42]} r={0.035} color={jersey} />
      <Tube a={[-0.2, 0.98, 0.4]} b={[0.2, 0.98, 0.4]} r={0.016} color="#1c2028" />
      <group ref={thighL} position={[-0.1, 0.98, -0.02]}>
        <mesh position={[0, -0.2, 0.02]}>
          <boxGeometry args={[0.09, 0.4, 0.09]} />
          <meshStandardMaterial color={shorts} />
        </mesh>
        <group ref={shinL} position={[0, -0.38, 0.02]}>
          <mesh position={[0, -0.18, 0.04]}>
            <boxGeometry args={[0.07, 0.36, 0.07]} />
            <meshStandardMaterial color="#e2b89a" />
          </mesh>
        </group>
      </group>
      <group ref={thighR} position={[0.1, 0.98, -0.02]}>
        <mesh position={[0, -0.2, 0.02]}>
          <boxGeometry args={[0.09, 0.4, 0.09]} />
          <meshStandardMaterial color={shorts} />
        </mesh>
        <group ref={shinR} position={[0, -0.38, 0.02]}>
          <mesh position={[0, -0.18, 0.04]}>
            <boxGeometry args={[0.07, 0.36, 0.07]} />
            <meshStandardMaterial color="#e2b89a" />
          </mesh>
        </group>
      </group>
      {camilla ? <Trailer /> : null}
    </group>
  );
}

function Wheel({ z, wheelRef }: { z: number; wheelRef: RefObject<THREE.Group | null> }) {
  return (
    <group ref={wheelRef} position={[0, 0.34, z]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.34, 0.34, 0.035, 22]} />
        <meshStandardMaterial color="#1a1d24" roughness={0.7} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.04, 0.04, 0.05, 10]} />
        <meshStandardMaterial color="#d9dde6" metalness={0.7} roughness={0.25} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation={[0, 0, (i * Math.PI) / 3]}>
          <boxGeometry args={[0.015, 0.62, 0.012]} />
          <meshStandardMaterial color="#c5cad3" metalness={0.5} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function Tube({ a, b, r, color }: { a: [number, number, number]; b: [number, number, number]; r: number; color: string }) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const position: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(),
  );
  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[r, r, Math.max(0.01, length), 8]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.25} />
    </mesh>
  );
}

function Trailer() {
  return (
    <group position={[0, 0, -1.9]}>
      <Tube a={[0, 0.42, 1.25]} b={[0, 0.5, 0.35]} r={0.02} color="#8d6a55" />
      <mesh position={[0, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, 0.78, 8]} />
        <meshStandardMaterial color="#2a241f" />
      </mesh>
      <mesh position={[-0.38, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 0.07, 16]} />
        <meshStandardMaterial color="#f7f3ee" />
      </mesh>
      <mesh position={[0.38, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 0.07, 16]} />
        <meshStandardMaterial color="#f7f3ee" />
      </mesh>
      <mesh position={[0, 0.58, 0.02]}>
        <boxGeometry args={[0.72, 0.34, 0.92]} />
        <meshStandardMaterial color="#fff7f1" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.02, 0.28]} rotation={[1.05, 0, 0]}>
        <sphereGeometry args={[0.4, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.42]} />
        <meshStandardMaterial color="#ffb7cb" roughness={0.65} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.78, 0.22]}>
        <boxGeometry args={[0.62, 0.08, 0.08]} />
        <meshStandardMaterial color="#9fd4ff" />
      </mesh>
      <group position={[0, 0.78, -0.16]} rotation={[0.2, Math.PI, 0]}>
        <mesh>
          <sphereGeometry args={[0.16, 18, 16]} />
          <meshStandardMaterial color="#f6c7ad" roughness={0.55} />
        </mesh>
        <mesh position={[-0.055, 0.02, 0.13]}>
          <sphereGeometry args={[0.022, 10, 10]} />
          <meshStandardMaterial color="#2a2428" />
        </mesh>
        <mesh position={[0.055, 0.02, 0.13]}>
          <sphereGeometry args={[0.022, 10, 10]} />
          <meshStandardMaterial color="#2a2428" />
        </mesh>
        <mesh position={[0, -0.045, 0.145]} rotation={[0.2, 0, 0]}>
          <torusGeometry args={[0.04, 0.01, 8, 12, Math.PI]} />
          <meshStandardMaterial color="#d4537c" />
        </mesh>
        <mesh position={[-0.07, -0.01, 0.1]}>
          <sphereGeometry args={[0.028, 8, 8]} />
          <meshStandardMaterial color="#f3a8b8" />
        </mesh>
        <mesh position={[0.07, -0.01, 0.1]}>
          <sphereGeometry args={[0.028, 8, 8]} />
          <meshStandardMaterial color="#f3a8b8" />
        </mesh>
        <mesh position={[0, 0.16, 0.02]}>
          <sphereGeometry args={[0.055, 10, 8]} />
          <meshStandardMaterial color="#e23b6a" />
        </mesh>
        <mesh position={[-0.07, 0.13, 0.02]} rotation={[0, 0, 0.7]}>
          <sphereGeometry args={[0.045, 8, 6]} />
          <meshStandardMaterial color="#ff8fab" />
        </mesh>
        <mesh position={[0.07, 0.13, 0.02]} rotation={[0, 0, -0.7]}>
          <sphereGeometry args={[0.045, 8, 6]} />
          <meshStandardMaterial color="#ff8fab" />
        </mesh>
        <mesh position={[0, -0.2, 0]}>
          <sphereGeometry args={[0.13, 14, 12]} />
          <meshStandardMaterial color="#f7c5d4" />
        </mesh>
      </group>
    </group>
  );
}

function Gate({ pose, texture }: { pose: { x: number; y: number; z: number; heading: number }; texture: THREE.Texture }) {
  return (
    <group position={[pose.x, pose.y, pose.z]} rotation={[0, pose.heading, 0]}>
      <mesh position={[-1.7, 1.3, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 2.6, 8]} />
        <meshLambertMaterial color="#8a6246" />
      </mesh>
      <mesh position={[1.7, 1.3, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 2.6, 8]} />
        <meshLambertMaterial color="#8a6246" />
      </mesh>
      <mesh position={[0, 2.45, 0]}>
        <boxGeometry args={[3.6, 0.7, 0.08]} />
        <meshBasicMaterial map={texture} />
      </mesh>
    </group>
  );
}

function Trees({ items }: { items: Scatter[] }) {
  return <ScatterMesh items={items} kind="tree" />;
}
function Flowers({ items }: { items: Scatter[] }) {
  return <ScatterMesh items={items} kind="flower" />;
}

interface Scatter {
  x: number;
  y: number;
  z: number;
  s: number;
  color: string;
}

function ScatterMesh({ items, kind }: { items: Scatter[]; kind: 'tree' | 'flower' }) {
  const crown = useRef<THREE.InstancedMesh>(null);
  const trunk = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    items.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.scale.setScalar(item.s);
      dummy.rotation.y = item.x * 0.2;
      dummy.updateMatrix();
      if (kind === 'tree') {
        trunk.current?.setMatrixAt(index, dummy.matrix);
        dummy.position.y = item.y + 1.15 * item.s;
        dummy.updateMatrix();
        crown.current?.setMatrixAt(index, dummy.matrix);
        crown.current?.setColorAt(index, new THREE.Color(item.color));
      } else {
        crown.current?.setMatrixAt(index, dummy.matrix);
        crown.current?.setColorAt(index, new THREE.Color(item.color));
      }
    });
    if (crown.current) {
      crown.current.instanceMatrix.needsUpdate = true;
      if (crown.current.instanceColor) crown.current.instanceColor.needsUpdate = true;
    }
    if (trunk.current) trunk.current.instanceMatrix.needsUpdate = true;
  }, [items, kind]);
  const crownGeo = useMemo(
    () => (kind === 'flower' ? new THREE.SphereGeometry(0.16, 7, 6) : new THREE.ConeGeometry(0.55, 1.5, 7)),
    [kind],
  );
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.08, 0.12, 0.9, 6), []);
  const crownMat = useMemo(() => new THREE.MeshLambertMaterial(), []);
  const trunkMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#6b4a32' }), []);
  useEffect(
    () => () => {
      crownGeo.dispose();
      trunkGeo.dispose();
      crownMat.dispose();
      trunkMat.dispose();
    },
    [crownGeo, trunkGeo, crownMat, trunkMat],
  );
  if (items.length === 0) return null;
  if (kind === 'flower') {
    return <instancedMesh ref={crown} args={[crownGeo, crownMat, items.length]} />;
  }
  return (
    <group>
      <instancedMesh ref={trunk} args={[trunkGeo, trunkMat, items.length]} />
      <instancedMesh ref={crown} args={[crownGeo, crownMat, items.length]} />
    </group>
  );
}

function buildRoad(track: Track): THREE.BufferGeometry {
  return ribbon(track.points, 3.15, 0.08);
}

function buildDashes(track: Track): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const pts = track.points;
  for (let i = 0; i < pts.length; i++) {
    if (Math.floor(pts[i].distance / 7) % 2 !== 0) continue;
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const base = positions.length / 3;
    for (const p of [a, b]) {
      const rx = Math.cos(p.heading) * 0.07;
      const rz = -Math.sin(p.heading) * 0.07;
      positions.push(p.x - rx, p.y + 0.1, p.z - rz, p.x + rx, p.y + 0.1, p.z + rz);
    }
    indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

function ribbon(points: TrackPoint[], half: number, lift: number): THREE.BufferGeometry {
  const n = points.length;
  const positions = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const rx = Math.cos(p.heading) * half;
    const rz = -Math.sin(p.heading) * half;
    positions.set([p.x - rx, p.y + lift, p.z - rz, p.x + rx, p.y + lift, p.z + rz], i * 6);
  }
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = i * 2;
    const b = j * 2;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildTerrain(track: Track, segments: number): THREE.BufferGeometry {
  const size = 1500;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const index = spatialIndex(track.points);
  const water = new THREE.Color('#7ebbd4');
  const grassA = new THREE.Color('#6ea34f');
  const grassB = new THREE.Color('#97c56a');
  const dirt = new THREE.Color('#c6b08a');
  const tint = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const near = index.nearest(x, z);
    const radial = Math.hypot(x, z);
    if (radial < 92) {
      pos.setY(i, 2.15);
      water.toArray(colors, i * 3);
      continue;
    }
    const hills = 7 * Math.sin(x * 0.008) * Math.cos(z * 0.0065) + 12 * Math.sin(x * 0.0024 + 0.5) + 4 * Math.cos(z * 0.0032);
    const influence = Math.exp(-(near.dist * near.dist) / (36 * 36));
    pos.setY(i, hills * (1 - influence) + (near.alt - 0.55) * influence);
    const mix = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(x * 0.03) * Math.cos(z * 0.028));
    tint.copy(near.dist < 9 ? dirt : grassA).lerp(near.dist < 9 ? dirt : grassB, near.dist < 9 ? 0 : mix);
    tint.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function scatterTrees(track: Track, count: number): Scatter[] {
  const rand = mulberry32(7);
  const index = spatialIndex(track.points);
  const out: Scatter[] = [];
  const colors = ['#2f7a45', '#3e9454', '#256b3c', '#4aa063'];
  let guard = 0;
  while (out.length < count && guard < count * 12) {
    guard += 1;
    const ang = rand() * Math.PI * 2;
    const rad = 40 + rand() * 560;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad * 0.82;
    const near = index.nearest(x, z);
    if (near.dist < 14 || Math.hypot(x, z) < 110) continue;
    out.push({
      x,
      y: near.alt - 0.2,
      z,
      s: 0.85 + rand() * 0.9,
      color: colors[out.length % colors.length],
    });
  }
  return out;
}

function scatterFlowers(track: Track, count: number): Scatter[] {
  const rand = mulberry32(21);
  const index = spatialIndex(track.points);
  const out: Scatter[] = [];
  const colors = ['#ff8fab', '#fff4ea', '#ffd1dc', '#9fd4ff', '#ffe08a'];
  const step = Math.max(1, Math.floor(track.points.length / count));
  for (let i = 0; i < track.points.length && out.length < count; i += step) {
    const p = track.points[i];
    const side = rand() > 0.5 ? 1 : -1;
    const rx = Math.cos(p.heading) * side * (5.5 + rand() * 3);
    const rz = -Math.sin(p.heading) * side * (5.5 + rand() * 3);
    const x = p.x + rx;
    const z = p.z + rz;
    const near = index.nearest(x, z);
    if (near.dist < 4.2) continue;
    out.push({ x, y: p.y + 0.12, z, s: 0.7 + rand() * 0.6, color: colors[out.length % colors.length] });
  }
  return out;
}

function spatialIndex(points: TrackPoint[]) {
  const cell = 28;
  const map = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.z / cell)}`;
    const bucket = map.get(key);
    if (bucket) bucket.push(i);
    else map.set(key, [i]);
  });
  return {
    nearest(x: number, z: number) {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      let best = 0;
      let bestD = Infinity;
      for (let oz = -3; oz <= 3; oz++) {
        for (let ox = -3; ox <= 3; ox++) {
          const bucket = map.get(`${cx + ox}:${cz + oz}`);
          if (!bucket) continue;
          for (const i of bucket) {
            const p = points[i];
            const d = (p.x - x) ** 2 + (p.z - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      if (!Number.isFinite(bestD)) {
        for (let i = 0; i < points.length; i += 10) {
          const p = points[i];
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      return { dist: Math.sqrt(bestD), alt: points[best]?.y ?? 0 };
    },
  };
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.CanvasTexture(canvas);
  g.fillStyle = '#fff8f1';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#e7a0b6';
  g.lineWidth = 10;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#2c2428';
  g.font = '700 54px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('CAMILLA RIDE', 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let shadowBlob: THREE.CanvasTexture | null = null;
function blob(): THREE.CanvasTexture {
  if (shadowBlob) return shadowBlob;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.38)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  shadowBlob = new THREE.CanvasTexture(canvas);
  return shadowBlob;
}
