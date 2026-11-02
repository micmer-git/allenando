import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { LoadedRoute } from '@/domain/routes';
import type { Track, TrackPose } from '@/domain/track';
import type { Quality } from '@/domain/types';
import type { RideEngine } from '@/sim/engine';
import { estimateDistance, type RemoteRider } from '@/multiplayer/room';
import {
  asphaltTexture,
  buildFarTerrain,
  buildGuardrails,
  centerDashes,
  farTerrainMaterial,
  runToEnd,
  scatterProps,
  strip,
  tileJob,
  type Prop,
  type TileSpec,
} from './builders';
import { createHeightField, type HeightField } from './heightfield';
import {
  BIKE,
  BODY,
  buildBody,
  buildCrankset,
  buildFrame,
  buildWheel,
  labelTexture,
  limbGeometry,
  pedalAt,
  shadowTexture,
  shoeGeometry,
  solveKnee,
} from './rider';

const QUALITY = {
  low: { tile: 1200, spacing: 12, density: 0.6, far: 5000, dpr: 1 as number | [number, number] },
  medium: { tile: 1600, spacing: 8, density: 1, far: 8000, dpr: [1, 1.25] as [number, number] },
  high: { tile: 2400, spacing: 8, density: 1.6, far: 11000, dpr: [1, 1.6] as [number, number] },
} satisfies Record<Quality, unknown>;

const BRAND = '#c8f031';
const HAZE = '#cfdbe5';
const SUN: [number, number, number] = [-700, 760, 520];

export function RideScene({
  engine,
  route,
  quality,
  ghostDistance,
  remote,
  selfColor,
  onReady,
}: {
  engine: RideEngine;
  route: LoadedRoute;
  quality: Quality;
  /** Distanza del fantasma in questo istante, o null se non c'è. */
  ghostDistance?: () => number | null;
  /** Compagni di stanza: chi c'è (cambia di rado) e dove sono (letto a ogni fotogramma). */
  remote?: { source: RemoteSource; list: { id: string; nick: string; color: number }[] };
  /** in una stanza, il colore che gli altri vedono addosso a te */
  selfColor?: string;
  onReady: () => void;
}) {
  const q = QUALITY[quality];
  const fogFar = route.dem ? q.far * 0.9 : 1400;
  return (
    <Canvas
      dpr={q.dpr}
      gl={{ antialias: quality !== 'low', alpha: false, stencil: false, powerPreference: 'high-performance' }}
      camera={{ fov: 55, near: 0.3, far: q.far + 1000, position: [0, 4, -10] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <color attach="background" args={[HAZE]} />
      {/* foschia dello stesso colore dell'orizzonte: le creste lontane sfumano nel cielo, senza bande */}
      <fog attach="fog" args={[HAZE, route.dem ? 260 : 120, fogFar]} />
      <hemisphereLight args={['#e6f0fb', '#4f5a3c', 0.62]} />
      {/* sole da sud-ovest, non troppo alto: i versanti del DEM prendono rilievo */}
      <directionalLight position={SUN} intensity={1.85} color="#fff0d6" />
      <World engine={engine} route={route} quality={quality} ghostDistance={ghostDistance} remote={remote} selfColor={selfColor} />
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

function World({
  engine,
  route,
  quality,
  ghostDistance,
  remote,
  selfColor,
}: {
  engine: RideEngine;
  route: LoadedRoute;
  quality: Quality;
  ghostDistance?: () => number | null;
  remote?: { source: RemoteSource; list: { id: string; nick: string; color: number }[] };
  selfColor?: string;
}) {
  const track = route.track;
  const q = QUALITY[quality];
  const field = useMemo(() => createHeightField(track, route.dem), [track, route.dem]);
  const tile = useRef({ value: new THREE.Vector3(0, 0, -1) });
  return (
    <group>
      <Sky />
      {route.dem ? <FarTerrain route={route} tile={tile.current} /> : null}
      <NearTerrain engine={engine} field={field} track={track} size={q.tile} spacing={q.spacing} tile={tile.current} />
      <Road track={track} field={field} />
      <Props track={track} field={field} density={q.density} />
      <Signs track={track} title={route.title} />
      <Rider getPose={() => engine.pose()} getCadence={() => engine.cadence} getSpeed={() => engine.speed} jersey={selfColor ?? BRAND} />
      {ghostDistance ? <Ghost track={track} ghostDistance={ghostDistance} /> : null}
      {remote && remote.list.length > 0 ? <RemoteRiders track={track} source={remote.source} list={remote.list} /> : null}
      <FollowCam engine={engine} field={field} />
    </group>
  );
}

// ---------- cielo ----------

function Sky() {
  const ref = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  useFrame(() => {
    if (ref.current) ref.current.position.copy(camera.position);
  });
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(1000, 32, 20);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const zenith = new THREE.Color('#4f88c6');
    const mid = new THREE.Color('#a3c4e2');
    const horizon = new THREE.Color(HAZE);
    const glow = new THREE.Color('#fff4dc');
    const sun = new THREE.Vector3(...SUN).normalize();
    const dir = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1000;
      if (y > 0.08) c.copy(mid).lerp(zenith, Math.min(1, (y - 0.08) / 0.7));
      else c.copy(horizon).lerp(mid, Math.max(0, (y + 0.1) / 0.18));
      // alone caldo intorno al sole, nello stesso punto della luce che illumina i versanti
      dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const k = Math.max(0, dir.dot(sun));
      c.lerp(glow, Math.pow(k, 24) * 0.85 + Math.pow(k, 4) * 0.12);
      c.toArray(colors, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh ref={ref} geometry={geo} frustumCulled={false} renderOrder={-100}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  );
}

// ---------- terreno ----------

function FarTerrain({ route, tile }: { route: LoadedRoute; tile: { value: THREE.Vector3 } }) {
  const geo = useMemo(() => (route.dem ? buildFarTerrain(route.dem, route.track.altitudeBase, 0.6) : null), [route]);
  const mat = useMemo(() => farTerrainMaterial(tile), [tile]);
  useEffect(
    () => () => {
      geo?.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  if (!geo) return null;
  return <mesh geometry={geo} material={mat} frustumCulled={false} />;
}

function snap(v: number, s: number): number {
  return Math.round(v / s) * s;
}

/**
 * Il riquadro di terreno fine intorno al ciclista. Quando ci si allontana dal centro, il
 * riquadro successivo si calcola a fette (pochi millisecondi per fotogramma) un po' più
 * avanti sulla strada, e si scambia solo quando è pronto.
 */
function NearTerrain({
  engine,
  field,
  track,
  size,
  spacing,
  tile,
}: {
  engine: RideEngine;
  field: HeightField;
  track: Track;
  size: number;
  spacing: number;
  tile: { value: THREE.Vector3 };
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const job = useRef<{ gen: Generator<number, THREE.BufferGeometry, void>; spec: TileSpec } | null>(null);
  const first = useMemo(() => {
    const p = engine.pose();
    const spec = { cx: snap(p.x, spacing), cz: snap(p.z, spacing), size, spacing };
    return { spec, geo: runToEnd(tileJob(field, spec)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, size, spacing]);
  const current = useRef(first.spec);
  useLayoutEffect(() => {
    current.current = first.spec;
    tile.value.set(first.spec.cx, first.spec.cz, first.spec.size / 2 - spacing * 3);
    if (mesh.current) mesh.current.geometry = first.geo;
    return () => {
      mesh.current?.geometry.dispose();
    };
  }, [first, tile, spacing]);
  useFrame(() => {
    const p = engine.pose();
    const c = current.current;
    if (!job.current && (Math.abs(p.x - c.cx) > size / 4 || Math.abs(p.z - c.cz) > size / 4)) {
      const ahead = track.poseAt(engine.distance + size * 0.2);
      const spec = { cx: snap((p.x + ahead.x) / 2, spacing), cz: snap((p.z + ahead.z) / 2, spacing), size, spacing };
      job.current = { gen: tileJob(field, spec), spec };
    }
    if (job.current) {
      const t0 = performance.now();
      for (;;) {
        const r = job.current.gen.next();
        if (r.done) {
          const old = mesh.current?.geometry;
          if (mesh.current) mesh.current.geometry = r.value;
          old?.dispose();
          current.current = job.current.spec;
          tile.value.set(job.current.spec.cx, job.current.spec.cz, size / 2 - spacing * 3);
          job.current = null;
          break;
        }
        if (performance.now() - t0 > 5) break;
      }
    }
  });
  return (
    <mesh ref={mesh} geometry={first.geo} frustumCulled={false}>
      <meshLambertMaterial vertexColors />
    </mesh>
  );
}

// ---------- strada ----------

function Road({ track, field }: { track: Track; field: HeightField }) {
  const hw = track.halfWidth;
  const parts = useMemo(() => {
    const pts = track.points;
    const wide = hw >= 2.7;
    return {
      asphalt: strip(pts, hw, 0, -hw, 0, { uvLength: 10 }),
      edgeL: strip(pts, hw - 0.12, 0.012, hw - 0.24, 0.012),
      edgeR: strip(pts, -hw + 0.24, 0.012, -hw + 0.12, 0.012),
      dashes: wide ? centerDashes(track) : null,
      shoulderL: strip(pts, hw + 0.7, -0.08, hw, -0.01),
      shoulderR: strip(pts, -hw, -0.01, -hw - 0.7, -0.08),
      // scarpate: dal ciglio giù di 3 m, a chiudere qualunque salto tra asfalto e terreno
      skirtL: strip(pts, hw + 1.8, -3.2, hw + 0.7, -0.08),
      skirtR: strip(pts, -hw - 0.7, -0.08, -hw - 1.8, -3.2),
      rails: buildGuardrails(track, field),
    };
  }, [track, field, hw]);
  const asphalt = useMemo(() => asphaltTexture(), []);
  const posts = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = posts.current;
    if (!m) return;
    const d = new THREE.Object3D();
    parts.rails.posts.forEach((p, i) => {
      d.position.set(p.x, p.y + 0.4, p.z);
      d.rotation.set(0, p.h, 0);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [parts]);
  useEffect(
    () => () => {
      for (const g of Object.values(parts)) {
        if (g && 'dispose' in g) g.dispose();
      }
      parts.rails.geometry.dispose();
      asphalt.dispose();
    },
    [parts, asphalt],
  );
  return (
    <group>
      <mesh geometry={parts.asphalt}>
        <meshLambertMaterial map={asphalt} color="#c9cbd0" polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={parts.edgeL}>
        <meshLambertMaterial color="#efeee6" polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
      </mesh>
      <mesh geometry={parts.edgeR}>
        <meshLambertMaterial color="#efeee6" polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
      </mesh>
      {parts.dashes ? (
        <mesh geometry={parts.dashes}>
          <meshLambertMaterial color="#efeee6" polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
        </mesh>
      ) : null}
      <mesh geometry={parts.shoulderL}>
        <meshLambertMaterial color="#8f8574" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={parts.shoulderR}>
        <meshLambertMaterial color="#8f8574" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={parts.skirtL}>
        <meshLambertMaterial color="#7b7468" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={parts.skirtR}>
        <meshLambertMaterial color="#7b7468" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={parts.rails.geometry}>
        <meshLambertMaterial color="#b9bec4" side={THREE.DoubleSide} />
      </mesh>
      {parts.rails.posts.length > 0 ? (
        <instancedMesh ref={posts} args={[undefined, undefined, parts.rails.posts.length]} frustumCulled={false}>
          <boxGeometry args={[0.09, 0.8, 0.09]} />
          <meshLambertMaterial color="#8e949b" />
        </instancedMesh>
      ) : null}
    </group>
  );
}

// ---------- alberi e rocce ----------

function Props({ track, field, density }: { track: Track; field: HeightField; density: number }) {
  const items = useMemo(() => scatterProps(track, field, density), [track, field, density]);
  const groups = useMemo(() => {
    const by: Record<Prop['kind'], Prop[]> = { spruce: [], larch: [], broadleaf: [], rock: [] };
    for (const it of items) by[it.kind].push(it);
    return by;
  }, [items]);
  const geos = useMemo(() => {
    const spruce = new THREE.ConeGeometry(2.2, 9, 7);
    spruce.translate(0, 6.3, 0);
    const larch = new THREE.ConeGeometry(2.4, 8, 6);
    larch.translate(0, 6, 0);
    const broad = new THREE.IcosahedronGeometry(3.2, 0);
    broad.scale(1, 0.85, 1);
    broad.translate(0, 5.6, 0);
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3.2, 5);
    trunk.translate(0, 1.4, 0);
    const rock = new THREE.DodecahedronGeometry(1, 0);
    rock.scale(1.3, 0.7, 1);
    return { spruce, larch, broad, trunk, rock };
  }, []);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  return (
    <group>
      <Instances items={groups.spruce} geometry={geos.spruce} colors={['#24452c', '#2c5233', '#1f3d29']} />
      <Instances items={groups.larch} geometry={geos.larch} colors={['#5b7a3a', '#6b8a40', '#4f6e35']} />
      <Instances items={groups.broadleaf} geometry={geos.broad} colors={['#4f7d36', '#5f8c3c', '#6d9443']} />
      <Instances
        items={[...groups.spruce, ...groups.larch, ...groups.broadleaf]}
        geometry={geos.trunk}
        colors={['#5a4331']}
      />
      <Instances items={groups.rock} geometry={geos.rock} colors={['#8b877f', '#7a766f', '#9b968c']} rock />
    </group>
  );
}

function Instances({
  items,
  geometry,
  colors,
  rock = false,
}: {
  items: Prop[];
  geometry: THREE.BufferGeometry;
  colors: string[];
  rock?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      d.position.set(it.x, it.y, it.z);
      d.rotation.set(rock ? it.tint : 0, it.r, 0);
      d.scale.setScalar(it.s);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      m.setColorAt(i, c.set(colors[Math.floor(it.tint * colors.length) % colors.length]));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items, colors, rock]);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]} frustumCulled={false}>
      <meshLambertMaterial flatShading={rock} />
    </instancedMesh>
  );
}

// ---------- cartelli ----------

function Signs({ track, title }: { track: Track; title: string }) {
  const data = useMemo(() => {
    const km: { pose: TrackPose; tex: THREE.CanvasTexture }[] = [];
    const total = track.length;
    for (let d = 1000; d < total - 300; d += 1000) {
      const a = track.poseAt(d);
      const b = track.poseAt(Math.min(total, d + 1000));
      const grade = (b.altitude - a.altitude) / (b.distance - a.distance || 1);
      km.push({ pose: a, tex: kmTexture(Math.round((total - d) / 1000), grade, Math.round(a.altitude)) });
    }
    const chevrons = track.hairpins.map((h) => ({ pose: track.poseAt(h.distance), side: h.side }));
    return {
      km,
      chevrons,
      start: track.poseAt(Math.min(20, total * 0.05)),
      finish: track.poseAt(Math.max(0, total - 8)),
      startTex: bannerTexture('PARTENZA', title),
      finishTex: bannerTexture('ARRIVO', title),
      chevronTex: chevronTexture(),
    };
  }, [track, title]);
  useEffect(
    () => () => {
      data.km.forEach((k) => k.tex.dispose());
      data.startTex.dispose();
      data.finishTex.dispose();
      data.chevronTex.dispose();
    },
    [data],
  );
  const hw = track.halfWidth;
  return (
    <group>
      <Gate pose={data.start} texture={data.startTex} hw={hw} />
      <Gate pose={data.finish} texture={data.finishTex} hw={hw} />
      {data.km.map((k, i) => (
        <group key={i} position={offset(k.pose, -(hw + 1.3))} rotation={[0, k.pose.heading + Math.PI, 0]}>
          <mesh position={[0, 0.7, 0]}>
            <boxGeometry args={[0.07, 1.4, 0.07]} />
            <meshLambertMaterial color="#666b72" />
          </mesh>
          <mesh position={[0, 1.65, 0]}>
            <planeGeometry args={[1.2, 0.6]} />
            <meshBasicMaterial map={k.tex} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {data.chevrons.map((c, i) => (
        // pannello a frecce sul lato esterno del tornante
        <group key={i} position={offset(c.pose, -c.side * (hw + 1.6))} rotation={[0, c.pose.heading + Math.PI, 0]}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[0.06, 1, 0.06]} />
            <meshLambertMaterial color="#666b72" />
          </mesh>
          <mesh position={[0, 1.2, 0]}>
            <planeGeometry args={[1.4, 0.5]} />
            <meshBasicMaterial map={data.chevronTex} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function offset(p: TrackPose, left: number): [number, number, number] {
  return [p.x + Math.cos(p.heading) * left, p.y, p.z - Math.sin(p.heading) * left];
}

function Gate({ pose, texture, hw }: { pose: TrackPose; texture: THREE.Texture; hw: number }) {
  const w = hw * 2 + 2.4;
  return (
    <group position={[pose.x, pose.y, pose.z]} rotation={[0, pose.heading, 0]}>
      <mesh position={[-w / 2, 2.2, 0]}>
        <boxGeometry args={[0.22, 4.4, 0.22]} />
        <meshLambertMaterial color="#20242b" />
      </mesh>
      <mesh position={[w / 2, 2.2, 0]}>
        <boxGeometry args={[0.22, 4.4, 0.22]} />
        <meshLambertMaterial color="#20242b" />
      </mesh>
      <mesh position={[0, 4.3, 0]}>
        <boxGeometry args={[w + 0.3, 1.1, 0.12]} />
        <meshBasicMaterial map={texture} />
      </mesh>
    </group>
  );
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function kmTexture(kmLeft: number, grade: number, alt: number): THREE.CanvasTexture {
  return canvasTex(256, 128, (g) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#16181d';
    g.fillRect(0, 0, 256, 40);
    g.fillStyle = '#f4f4f0';
    g.font = '700 26px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${alt} m`, 128, 21);
    g.fillStyle = '#16181d';
    g.font = '800 40px sans-serif';
    g.textAlign = 'left';
    g.fillText(`${kmLeft} km`, 12, 86);
    g.textAlign = 'right';
    g.fillStyle = grade > 0.1 ? '#c22f2f' : grade > 0.07 ? '#d07a12' : '#2f7a3d';
    g.font = '800 32px sans-serif';
    g.fillText(`${(grade * 100).toFixed(1).replace('.', ',')}%`, 246, 86);
  });
}

function bannerTexture(label: string, title: string): THREE.CanvasTexture {
  return canvasTex(1024, 128, (g) => {
    g.fillStyle = '#121418';
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = BRAND;
    g.fillRect(0, 0, 20, 128);
    g.font = '800 64px sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = BRAND;
    g.fillText(label, 52, 66);
    g.fillStyle = '#f1f2ee';
    g.textAlign = 'right';
    g.font = '700 54px sans-serif';
    g.fillText(title.toUpperCase(), 990, 66);
  });
}

function chevronTexture(): THREE.CanvasTexture {
  return canvasTex(256, 96, (g) => {
    g.fillStyle = '#c62828';
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      const x = 24 + i * 58;
      g.beginPath();
      g.moveTo(x, 14);
      g.lineTo(x + 28, 48);
      g.lineTo(x, 82);
      g.lineTo(x + 16, 82);
      g.lineTo(x + 44, 48);
      g.lineTo(x + 16, 14);
      g.closePath();
      g.fill();
    }
  });
}

// ---------- ciclista, fantasma e compagni di stanza ----------

function Ghost({ track, ghostDistance }: { track: Track; ghostDistance: () => number | null }) {
  const last = useRef(0);
  return (
    <Rider
      ghost
      side={-1.1}
      getPose={() => {
        const d = ghostDistance();
        if (d != null) last.current = d;
        return track.poseAt(last.current);
      }}
      getCadence={() => 85}
      getSpeed={() => 5}
    />
  );
}

/** Corsie dei compagni di stanza, per colore: non si sovrappongono a chi guarda (a +0,6 m). */
const LANES = [-0.7, 1.7, -1.8, -0.15, 2.2, -1.25, 1.15, -2.2];

export interface RemoteSource {
  /** i ciclisti lontani in questo istante, letti a ogni fotogramma */
  riders: () => Map<string, RemoteRider>;
  colors: readonly string[];
}

function RemoteRiders({ track, source, list }: { track: Track; source: RemoteSource; list: { id: string; nick: string; color: number }[] }) {
  return (
    <group>
      {list.map((r) => (
        <RemoteRiderView key={r.id} id={r.id} nick={r.nick} color={r.color} track={track} source={source} />
      ))}
    </group>
  );
}

function RemoteRiderView({ id, nick, color, track, source }: { id: string; nick: string; color: number; track: Track; source: RemoteSource }) {
  const shown = useRef<number | null>(null);
  const last = useRef<{ t: number }>({ t: performance.now() });
  const hex = source.colors[color % source.colors.length];
  const lane = LANES[color % LANES.length];
  return (
    <Rider
      side={lane}
      jersey={hex}
      helmet={hex}
      label={nick}
      getPose={() => {
        const r = source.riders().get(id);
        const now = performance.now();
        const dt = Math.min(0.2, (now - last.current.t) / 1000);
        last.current.t = now;
        if (r) {
          const target = Math.min(track.length, Math.max(0, estimateDistance(r, Date.now())));
          // si insegue la stima senza scatti; oltre 40 m di errore si salta
          if (shown.current == null || Math.abs(target - shown.current) > 40) shown.current = target;
          else shown.current += (target - shown.current) * (1 - Math.exp(-dt * 5));
        }
        return track.poseAt(shown.current ?? 0);
      }}
      getCadence={() => {
        const r = source.riders().get(id);
        return r && !r.idle && r.w > 0 && r.v > 0.3 ? 86 : 0;
      }}
      getSpeed={() => source.riders().get(id)?.v ?? 0}
    />
  );
}

const GHOST_MAT = new THREE.MeshBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.36, depthWrite: false });

function Rider({
  getPose,
  getCadence,
  getSpeed,
  ghost = false,
  side = 0.6,
  jersey = BRAND,
  helmet = '#f2f3ef',
  label,
}: {
  getPose: () => TrackPose;
  getCadence: () => number;
  getSpeed: () => number;
  ghost?: boolean;
  /** metri a sinistra dell'asse della strada */
  side?: number;
  jersey?: string;
  helmet?: string;
  label?: string;
}) {
  const group = useRef<THREE.Group>(null);
  const front = useRef<THREE.Mesh>(null);
  const rear = useRef<THREE.Mesh>(null);
  const crank = useRef<THREE.Mesh>(null);
  const legs = useRef<(THREE.Mesh | null)[]>([]);
  const sprite = useRef<THREE.Sprite>(null);
  const spin = useRef(Math.random() * Math.PI * 2);
  const roll = useRef(0);
  const { camera } = useThree();

  const geo = useMemo(
    () => ({
      frame: buildFrame({ frame: '#262a31', accent: jersey }),
      wheel: buildWheel(),
      crank: buildCrankset(),
      body: buildBody({ jersey, shorts: '#15181e', skin: '#d9ad8c', helmet }),
      thigh: limbGeometry(0.068, 0.05),
      shin: limbGeometry(0.047, 0.032),
      shoe: shoeGeometry(),
    }),
    [jersey, helmet],
  );
  const mats = useMemo(
    () =>
      ghost
        ? { vc: GHOST_MAT, shorts: GHOST_MAT, skin: GHOST_MAT, shoe: GHOST_MAT }
        : {
            vc: new THREE.MeshLambertMaterial({ vertexColors: true }),
            shorts: new THREE.MeshLambertMaterial({ color: '#15181e' }),
            skin: new THREE.MeshLambertMaterial({ color: '#d9ad8c' }),
            shoe: new THREE.MeshLambertMaterial({ color: '#eceee9' }),
          },
    [ghost],
  );
  const labelTex = useMemo(() => (label ? labelTexture(label, jersey) : null), [label, jersey]);
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      if (!ghost) Object.values(mats).forEach((m) => m.dispose());
      labelTex?.dispose();
    },
    [geo, mats, ghost, labelTex],
  );

  const tmp = useMemo(
    () => ({ hip: new THREE.Vector3(), pedal: new THREE.Vector3(), ankle: new THREE.Vector3(), knee: new THREE.Vector3(), dir: new THREE.Vector3(), down: new THREE.Vector3(0, -1, 0) }),
    [],
  );

  useFrame((_, dt) => {
    const pose = getPose();
    const root = group.current;
    if (!root) return;
    root.position.set(pose.x + Math.cos(pose.heading) * side, pose.y, pose.z - Math.sin(pose.heading) * side);
    root.rotation.set(-Math.atan(pose.grade), pose.heading, 0, 'YXZ');
    const cadence = getCadence();
    spin.current += (cadence > 1 ? (cadence / 60) * Math.PI * 2 : 0) * dt;
    roll.current += (getSpeed() / BIKE.wheelR) * dt;
    if (front.current) front.current.rotation.x = roll.current;
    if (rear.current) rear.current.rotation.x = roll.current;
    if (crank.current) crank.current.rotation.x = spin.current;
    // gambe: dal pedale alla caviglia, poi il ginocchio per cinematica inversa
    for (let i = 0; i < 2; i++) {
      const right = i === 1;
      const s = right ? 1 : -1;
      tmp.hip.set(s * BODY.hip[0], BODY.hip[1], BODY.hip[2]);
      pedalAt(spin.current, right, tmp.pedal);
      tmp.ankle.set(tmp.pedal.x, tmp.pedal.y + BODY.ankle[1], tmp.pedal.z + BODY.ankle[2]);
      solveKnee(tmp.hip, tmp.ankle, BODY.thigh, BODY.shin, tmp.knee);
      const thigh = legs.current[i * 3];
      const shin = legs.current[i * 3 + 1];
      const shoe = legs.current[i * 3 + 2];
      if (thigh) {
        thigh.position.copy(tmp.hip);
        tmp.dir.copy(tmp.knee).sub(tmp.hip);
        thigh.scale.set(1, tmp.dir.length(), 1);
        thigh.quaternion.setFromUnitVectors(tmp.down, tmp.dir.normalize());
      }
      if (shin) {
        shin.position.copy(tmp.knee);
        tmp.dir.copy(tmp.ankle).sub(tmp.knee);
        shin.scale.set(1, tmp.dir.length(), 1);
        shin.quaternion.setFromUnitVectors(tmp.down, tmp.dir.normalize());
      }
      if (shoe) {
        shoe.position.copy(tmp.ankle);
        // la punta scende un po' in spinta e sale in risalita, come la caviglia vera
        shoe.rotation.set(0.12 * Math.sin(spin.current + (right ? 0 : Math.PI) + 1.2), 0, 0);
      }
    }
    if (sprite.current) {
      const dist = camera.position.distanceTo(root.position);
      // l'etichetta cresce con la distanza: resta leggibile anche a un tornante di distanza
      const k = THREE.MathUtils.clamp(dist * 0.07, 1, 18);
      sprite.current.scale.set(k * 2.2, k * 0.55, 1);
      sprite.current.position.y = 1.95 + k * 0.3;
    }
  });

  return (
    <group ref={group}>
      {!ghost ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0.08]} renderOrder={1}>
          <planeGeometry args={[0.75, 1.75]} />
          <meshBasicMaterial map={shadowTexture()} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-6} />
        </mesh>
      ) : null}
      <mesh geometry={geo.frame} material={mats.vc} />
      <mesh ref={rear} geometry={geo.wheel} material={mats.vc} position={BIKE.rearAxle as unknown as [number, number, number]} />
      <mesh ref={front} geometry={geo.wheel} material={mats.vc} position={BIKE.frontAxle as unknown as [number, number, number]} />
      <mesh ref={crank} geometry={geo.crank} material={mats.vc} position={BIKE.bb as unknown as [number, number, number]} />
      <mesh geometry={geo.body} material={mats.vc} />
      {[0, 1].map((i) => (
        <group key={i}>
          <mesh ref={(m) => void (legs.current[i * 3] = m)} geometry={geo.thigh} material={mats.shorts} />
          <mesh ref={(m) => void (legs.current[i * 3 + 1] = m)} geometry={geo.shin} material={mats.skin} />
          <mesh ref={(m) => void (legs.current[i * 3 + 2] = m)} geometry={geo.shoe} material={mats.shoe} />
        </group>
      ))}
      {labelTex ? (
        <sprite ref={sprite} position={[0, 2.1, 0]}>
          <spriteMaterial map={labelTex} depthTest={false} transparent />
        </sprite>
      ) : null}
    </group>
  );
}

// ---------- camera ----------

/** Camera alle spalle; non entra mai nel versante, nemmeno nei tornanti stretti. */
function FollowCam({ engine, field }: { engine: RideEngine; field: HeightField }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3());
  const heading = useRef<number | null>(null);
  const place = (dt: number) => {
    const pose = engine.pose();
    // la direzione della camera insegue quella della strada con un po' di ritardo
    if (heading.current == null) heading.current = pose.heading;
    let dh = pose.heading - heading.current;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    heading.current += dh * (1 - Math.exp(-Math.min(1, dt) * 2.6));
    const h = heading.current;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    desired.current.set(pose.x - fx * 8.5, pose.y + 3.1, pose.z - fz * 8.5);
    const ground = field.height(desired.current.x, desired.current.z, 4);
    desired.current.y = Math.max(desired.current.y, ground + 1.8);
    const k = 1 - Math.exp(-Math.min(1, dt) * 4);
    camera.position.lerp(desired.current, k);
    const groundNow = field.height(camera.position.x, camera.position.z, 4);
    if (camera.position.y < groundNow + 1.5) camera.position.y = groundNow + 1.5;
    look.current.set(pose.x + Math.sin(pose.heading) * 7, pose.y + 1.2, pose.z + Math.cos(pose.heading) * 7);
    camera.lookAt(look.current);
  };
  useLayoutEffect(() => {
    place(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_, dt) => place(dt));
  return null;
}
