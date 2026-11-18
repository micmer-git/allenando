import { followBearing, frameRider, voxelTrees } from './isometric';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { LoadedRoute } from '@/domain/routes';
import type { Track, TrackPose } from '@/domain/track';
import type { Quality } from '@/domain/types';
import type { RideEngine } from '@/sim/engine';
import { estimateDistance, type RemoteRider } from '@/multiplayer/room';
import {
  ASPHALT_REPEAT_M,
  asphaltTexture,
  buildFarTerrain,
  centerDashes,
  farTerrainMaterial,
  runToEnd,
  scatterProps,
  strip,
  tileJob,
  type TileSpec,
} from './builders';
import { createHeightField, type HeightField } from './heightfield';
import { DEFAULT_LOOK, lookFromColor, type Look } from '@/game/look';
import { Rider } from './RiderMesh';
import type { ArchSpec } from '@/game/arches';
import { Arches } from './Arches';
import { ClimbRoadside } from './ClimbRoadside';
import { StatsProbe, statsWanted } from '@/open/StatsProbe';
import { localShadow } from '@/open/luceStrada';
import { createPropWindow, type PropGroup } from './propWindow';

// il ciclista vive in RiderMesh.tsx: lo si riesporta per chi lo prendeva da qui
export { Rider };

const QUALITY = {
  low: { tile: 1200, spacing: 12, density: 0.6, far: 5000, dpr: 1 as number | [number, number] },
  medium: { tile: 1600, spacing: 8, density: 1, far: 8000, dpr: [1, 1.25] as [number, number] },
  high: { tile: 2400, spacing: 8, density: 1.6, far: 11000, dpr: [1, 1.6] as [number, number] },
} satisfies Record<Quality, unknown>;

const BRAND = '#ffc814';
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
  arches,
  look,
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
  /** archi e cartelli dei traguardi (volata, GPM, crono), calcolati dal gioco */
  arches?: ArchSpec[];
  /** quello che indossi nel garage */
  look?: Look;
}) {
  const q = QUALITY[quality];
  const fogFar = route.dem ? q.far * 0.9 : 1400;
  return (
    <Canvas orthographic
      dpr={q.dpr}
      shadows={quality === 'low' ? false : 'percentage'}
      gl={{ antialias: quality !== 'low', alpha: false, stencil: false, powerPreference: 'high-performance' }}
      camera={{ near: 0.1, far: 240, position: [0, 4, -10] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <color attach="background" args={[HAZE]} />
      {/* foschia dello stesso colore dell'orizzonte: le creste lontane sfumano nel cielo, senza bande */}
      <fog attach="fog" args={[HAZE, route.dem ? 260 : 120, fogFar]} />
      <hemisphereLight args={['#e6f0fb', '#8c9b79', 0.85]} />
      <LocalSun quality={quality} />
      <World engine={engine} route={route} quality={quality} ghostDistance={ghostDistance} remote={remote} selfColor={selfColor} arches={arches} look={look} />
      <Ready onReady={onReady} />
      {statsWanted() ? <StatsProbe /> : null}
    </Canvas>
  );
}

/** Ombre locali anche sulle salite singole e sui replay: una sola mappa, aggiornata muovendosi. */
function LocalSun({ quality }: { quality: Quality }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const { camera } = useThree();
  const update = useMemo(localShadow, []);
  const direction = useMemo(() => new THREE.Vector3(...SUN).normalize(), []);
  useFrame(() => {
    if (ref.current) update(ref.current, camera.position, direction, 0, performance.now());
  });
  const size = quality === 'high' ? 2048 : 1024;
  return <directionalLight ref={ref} position={SUN} intensity={1.85} color="#fff0d6"
    castShadow={quality !== 'low'} shadow-autoUpdate={false}
    shadow-mapSize-width={size} shadow-mapSize-height={size}
    shadow-camera-left={-38} shadow-camera-right={38} shadow-camera-top={38} shadow-camera-bottom={-38}
    shadow-camera-near={5} shadow-camera-far={410} shadow-normalBias={0.065} shadow-bias={-0.00012} />;
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
  arches,
  look,
}: {
  engine: RideEngine;
  route: LoadedRoute;
  quality: Quality;
  ghostDistance?: () => number | null;
  remote?: { source: RemoteSource; list: { id: string; nick: string; color: number }[] };
  selfColor?: string;
  arches?: ArchSpec[];
  look?: Look;
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
      <Road track={track} />
      <ClimbRoadside track={track} field={field} />
      {arches && arches.length > 0 ? <Arches specs={arches} /> : null}
      <Props track={track} field={field} density={q.density} />
      <Signs track={track} title={route.title} />
      <Rider getPose={() => engine.pose()} getCadence={() => engine.cadence} getSpeed={() => engine.speed} getPower={() => engine.power} look={look ?? (selfColor ? lookFromColor(selfColor) : DEFAULT_LOOK)} />
      {ghostDistance ? <Ghost track={track} ghostDistance={ghostDistance} /> : null}
      {remote && remote.list.length > 0 ? <RemoteRiders track={track} source={remote.source} list={remote.list} /> : null}
      <FollowCam engine={engine} field={field} />
    </group>
  );
}

// ---------- cielo ----------

export function Sky() {
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
    <mesh ref={mesh} geometry={first.geo} frustumCulled={false} receiveShadow>
      <meshLambertMaterial vertexColors />
    </mesh>
  );
}

// ---------- strada ----------

function Road({ track }: { track: Track }) {
  const hw = track.halfWidth;
  const parts = useMemo(() => {
    const pts = track.points;
    const wide = hw >= 2.7;
    return {
      asphalt: strip(pts, hw, 0, -hw, 0, { uvLength: ASPHALT_REPEAT_M }),
      edgeL: strip(pts, hw - 0.12, 0.012, hw - 0.24, 0.012),
      edgeR: strip(pts, -hw + 0.24, 0.012, -hw + 0.12, 0.012),
      dashes: wide ? centerDashes(track) : null,
      shoulderL: strip(pts, hw + 0.7, -0.08, hw, -0.01),
      shoulderR: strip(pts, -hw, -0.01, -hw - 0.7, -0.08),
      // scarpate: dal ciglio giù di 3 m, a chiudere qualunque salto tra asfalto e terreno
      skirtL: strip(pts, hw + 1.8, -3.2, hw + 0.7, -0.08),
      skirtR: strip(pts, -hw - 0.7, -0.08, -hw - 1.8, -3.2),
    };
  }, [track, hw]);
  const asphalt = useMemo(() => asphaltTexture(), []);
  useEffect(
    () => () => {
      for (const g of Object.values(parts)) g?.dispose();
      asphalt.dispose();
    },
    [parts, asphalt],
  );
  return (
    <group>
      <mesh geometry={parts.asphalt} receiveShadow>
        <meshPhongMaterial map={asphalt} color="#d2d7d5" shininess={9} specular="#283230" polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={parts.edgeL} receiveShadow>
        <meshLambertMaterial color="#efeee6" polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
      </mesh>
      <mesh geometry={parts.edgeR} receiveShadow>
        <meshLambertMaterial color="#efeee6" polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
      </mesh>
      {parts.dashes ? (
        <mesh geometry={parts.dashes} receiveShadow>
          <meshLambertMaterial color="#efeee6" polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
        </mesh>
      ) : null}
      <mesh geometry={parts.shoulderL} receiveShadow>
        <meshLambertMaterial color="#8f8574" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={parts.shoulderR} receiveShadow>
        <meshLambertMaterial color="#8f8574" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={parts.skirtL}>
        <meshLambertMaterial color="#7b7468" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={parts.skirtR}>
        <meshLambertMaterial color="#7b7468" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ---------- alberi e rocce ----------

function Props({ track, field, density }: { track: Track; field: HeightField; density: number }) {
  const items = useMemo(() => scatterProps(track, field, density), [track, field, density]);
  const window = useMemo(() => createPropWindow(items), [items]);
  const geos = useMemo(() => {
    const { cypress, broadleaf, ...trees } = voxelTrees();
    cypress.dispose();
    return { ...trees, broad: broadleaf };
  }, []);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  return (
    <group>
      <Instances window={window} kind="spruce" geometry={geos.spruce} colors={['#3d684b', '#477653', '#365e43']} />
      <Instances window={window} kind="larch" geometry={geos.larch} colors={['#719a4b', '#85a853', '#628642']} />
      <Instances window={window} kind="broadleaf" geometry={geos.broad} colors={['#62984b', '#75a855', '#8bb65c']} />
      <Instances window={window} kind="trunk" geometry={geos.trunk} colors={['#71533b']} />
      <Instances window={window} kind="rock" geometry={geos.rock} colors={['#8b877f', '#7a766f', '#9b968c']} rock />
    </group>
  );
}

function Instances({
  window,
  kind,
  geometry,
  colors,
  rock = false,
}: {
  window: ReturnType<typeof createPropWindow>;
  kind: PropGroup;
  geometry: THREE.BufferGeometry;
  colors: string[];
  rock?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { camera, scene } = useThree();
  const written = useRef(-1);
  const scratch = useMemo(() => ({ d: new THREE.Object3D(), c: new THREE.Color() }), []);
  useLayoutEffect(() => {
    written.current = -1;
    ref.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }, [window, kind, colors, rock]);
  useFrame(() => {
    if (window.update(camera.position.x, camera.position.z)) {
      // Il cambio della finestra può precedere il prossimo scatto della luce:
      // invalida anche la mappa statica quando cambia l'insieme dei caster.
      scene.traverse(object => {
        if (object instanceof THREE.DirectionalLight && object.castShadow) object.shadow.needsUpdate = true;
      });
    }
    if (written.current === window.revision) return;
    const m = ref.current;
    if (!m) return;
    const { d, c } = scratch;
    const items = window.groups[kind];
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
    m.count = items.length;
    written.current = window.revision;
  });
  const capacity = window.capacity[kind];
  if (capacity === 0) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, capacity]} count={0} frustumCulled={false} castShadow receiveShadow>
      <meshLambertMaterial vertexColors flatShading={rock} />
    </instancedMesh>
  );
}

// ---------- cartelli ----------

/**
 * Partenza, arrivo e frecce dei tornanti. I chilometri non stanno più qui: sono i portali alla
 * Zwift che mette il gioco (src/game/arches.ts, kmMarks), uno a ogni km con la pendenza.
 */
function Signs({ track, title }: { track: Track; title: string }) {
  const data = useMemo(() => {
    const total = track.length;
    const chevrons = track.hairpins.map((h) => ({ pose: track.poseAt(h.distance), side: h.side }));
    return {
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

export function Gate({ pose, texture, hw }: { pose: TrackPose; texture: THREE.Texture; hw: number }) {
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

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function kmTexture(kmLeft: number, grade: number, alt: number): THREE.CanvasTexture {
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

export function bannerTexture(label: string, title: string): THREE.CanvasTexture {
  return canvasTex(1024, 128, (g) => {
    g.fillStyle = '#121418';
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = BRAND;
    g.fillRect(0, 0, 20, 128);
    g.font = '800 64px sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = BRAND;
    g.fillText(label, 52, 66);
    // il nome nello spazio che resta dopo l'etichetta: si stringe il carattere finché ci sta
    const left = 52 + g.measureText(label).width + 36;
    const room = 990 - left;
    let size = 54;
    g.font = `700 ${size}px sans-serif`;
    const text = title.toUpperCase();
    while (g.measureText(text).width > room && size > 24) {
      size -= 3;
      g.font = `700 ${size}px sans-serif`;
    }
    g.fillStyle = '#f1f2ee';
    g.textAlign = 'right';
    g.fillText(text, 990, 66, room);
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
      detail="media"
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
      detail="media"
      lodDistance={35}
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

// ---------- camera ----------

/** Camera alle spalle; non entra mai nel versante, nemmeno nei tornanti stretti. */
function FollowCam({ engine, field }: { engine: RideEngine; field: HeightField }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3());
  const heading = useRef<number | null>(null);
  const place = (dt: number) => {
    const pose = engine.pose();
    heading.current = followBearing(heading.current ?? pose.heading, pose.heading, dt);
    if (camera instanceof THREE.OrthographicCamera) frameRider(camera, pose, heading.current, size.height, look.current, field.height);
  };
  useLayoutEffect(() => {
    place(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_, dt) => place(dt));
  return null;
}
