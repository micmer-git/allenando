import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackPose } from '@/domain/track';
import type { Quality } from '@/domain/types';
import type { RideEngine } from '@/sim/engine';
import { asphaltTexture, groundColor, hash2 } from '@/world/builders';
import { Gate, Rider, bannerTexture, canvasTex, kmTexture } from '@/world/Scene';
import { FLAG, type Dir } from './graph';
import type { WorldField } from './field';
import type { NpcCrowd } from './npc';
import { NPC_JERSEYS } from './npc';
import { buildingsJob, furnitureJob, railsGeometry, roadsJob, terrainJob, treesJob, waterGeometry, type BuildingMeshes, type TileMeshes, type TileSpec, type TreeKind } from './tiles';
import { facadeTexture, groundDetailTexture, roofTilesTexture } from './textures';
import { atmosphere, CLEAR, sunFor, sunVector, type Daytime } from './sky';
import type { WeatherNow } from './weather';
import { loadBuildings, type Building, type RideDef, type Terrain, type WorldData } from './world';
import { WorldPath } from './path';
import type { ArchSpec } from '@/game/arches';
import { Arches } from '@/world/Arches';
import {
  bridgePostGeometry,
  delineatorEyesGeometry,
  delineatorGeometry,
  disposeRoadsideMaterials,
  instanced,
  railPostGeometry,
  reflectorGeometry,
  roadsideMaterials,
  shrubGeometry,
  signalGeometry,
  signalGlowGeometry,
  signalGreenGeometry,
  signPoleGeometry,
  stoneGeometry,
  stoneTexture,
} from '@/world/roadside';
import { ROADSIDE_KINDS, streetJob, type RoadsideItems, type RoadsideKind } from './streets';

const QUALITY = {
  low: { tile: 500, ring: 2, spacing: 16, trees: 0.9, far: 6000, farStride: 2, npcs: 6, dpr: 1 as number | [number, number] },
  medium: { tile: 500, ring: 3, spacing: 10, trees: 1.6, far: 9000, farStride: 1, npcs: 10, dpr: [1, 1.25] as [number, number] },
  high: { tile: 500, ring: 4, spacing: 8, trees: 2.4, far: 13000, farStride: 1, npcs: 14, dpr: [1, 1.6] as [number, number] },
} satisfies Record<Quality, unknown>;

export function npcCount(quality: Quality): number {
  return QUALITY[quality].npcs;
}

const HAZE = '#cfdbe5';

export interface RemoteWorldRider {
  id: string;
  nick: string;
  color: string;
  /** posa in questo istante, o null se non è da mostrare */
  pose: () => { x: number; y: number; z: number; heading: number; grade: number; v: number; idle: boolean } | null;
}

export interface WorldSceneProps {
  engine: RideEngine;
  data: WorldData;
  path: WorldPath;
  field: WorldField;
  terrain: Terrain;
  quality: Quality;
  crowd: NpcCrowd;
  remote: RemoteWorldRider[];
  selfColor?: string;
  /** dove indicare la svolta scelta: il nodo e la direzione della strada che si prende */
  nextTurn: () => { x: number; y: number; z: number; heading: number } | null;
  /** posa del giocatore con lo scostamento di corsia: la usano anche HUD e scia */
  playerPose: () => TrackPose;
  onReady: () => void;
  /** meteo vero (null: sereno) e ora del giorno */
  weather: WeatherNow | null;
  daytime: Daytime;
  /** il percorso scelto, per i cartelli dei km e gli archi */
  ride: RideDef | null;
  /** archi e cartelli dei traguardi (volata, GPM, crono), calcolati dal gioco */
  arches?: ArchSpec[];
}

export function WorldScene(props: WorldSceneProps) {
  const q = QUALITY[props.quality];
  return (
    <Canvas
      dpr={q.dpr}
      gl={{ antialias: props.quality !== 'low', alpha: false, stencil: false, powerPreference: 'high-performance' }}
      camera={{ fov: 55, near: 0.3, far: q.far + 2000, position: [0, 4, -10] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <color attach="background" args={[HAZE]} />
      <fog attach="fog" args={[HAZE, 350, q.far * 0.92]} />
      <WorldContent {...props} />
      <ReadyWhenTiles onReady={props.onReady} />
    </Canvas>
  );
}

const readyFlag = { tiles: 0 };

function ReadyWhenTiles({ onReady }: { onReady: () => void }) {
  const sent = useRef(false);
  const frames = useRef(0);
  useFrame(() => {
    frames.current++;
    // pronto quando c'è il terreno sotto le ruote (o dopo 4 s comunque: meglio un mondo a metà che uno schermo nero)
    if (!sent.current && (readyFlag.tiles > 0 || frames.current > 240)) {
      sent.current = true;
      onReady();
    }
  });
  return null;
}

function WorldContent(props: WorldSceneProps) {
  const { data, field, terrain, quality } = props;
  const q = QUALITY[quality];
  const farRect = useRef({ value: new THREE.Vector3(0, 0, -1) });
  const mats = useMaterials(farRect.current);
  const names = useMemo(() => new Set<THREE.Sprite>(), []);
  return (
    <group>
      <Atmosphere weather={props.weather} daytime={props.daytime} data={data} far={q.far} mats={mats} />
      {props.weather && props.weather.rain >= 0.1 ? <Rain mmh={props.weather.rain} weather={props.weather} /> : null}
      <FarTerrain terrain={terrain} stride={q.farStride} material={mats.far} />
      <NearTiles {...props} mats={mats} rect={farRect.current} />
      <Lakes data={data} />
      <Walls data={data} field={field} />
      <Labels data={data} engine={props.engine} playerPose={props.playerPose} names={names} />
      <Landmarks data={data} playerPose={props.playerPose} names={names} />
      <Declutter names={names} />
      {props.ride ? <RideSigns data={data} ride={props.ride} /> : null}
      <PlayerRider {...props} />
      <NpcRiders crowd={props.crowd} />
      {props.remote.map((r) => (
        <RemoteRiderView key={r.id} rider={r} />
      ))}
      <TurnArrow nextTurn={props.nextTurn} />
      <WorldArches arches={props.arches} path={props.path} engine={props.engine} />
      <WorldCam {...props} />
    </group>
  );
}

// ---------- materiali condivisi ----------

function useMaterials(rect: { value: THREE.Vector3 }) {
  const mats = useMemo(() => {
    const asphaltTex = asphaltTexture();
    const stoneTex = settTexture();
    const facadeTex = facadeTexture();
    const tilesTex = roofTilesTexture();
    const groundTex = groundDetailTexture();
    const far = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 6 });
    far.onBeforeCompile = (shader) => {
      shader.uniforms.uRect = rect;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform vec3 uRect;')
        .replace('void main() {', 'void main() {\n  if (uRect.z > 0.0 && abs(vWPos.x - uRect.x) < uRect.z && abs(vWPos.z - uRect.y) < uRect.z) discard;');
    };
    return {
      far,
      terrain: new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTex }),
      asphalt: new THREE.MeshLambertMaterial({ map: asphaltTex, color: '#c9cbd0', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      stone: new THREE.MeshLambertMaterial({ map: stoneTex, color: '#d8cfc2', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      cycle: new THREE.MeshLambertMaterial({ map: asphaltTex, color: '#c98f7d', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      paint: new THREE.MeshLambertMaterial({ color: '#efeee6', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      verge: new THREE.MeshLambertMaterial({ color: '#8f8574', side: THREE.DoubleSide }),
      concrete: new THREE.MeshLambertMaterial({ color: '#b3b1aa', side: THREE.DoubleSide }),
      tunnel: new THREE.MeshLambertMaterial({ color: '#4b4a47', emissive: '#2a2618', side: THREE.DoubleSide }),
      rails: new THREE.MeshLambertMaterial({ color: '#7d756b' }),
      buildings: new THREE.MeshLambertMaterial({ vertexColors: true, map: facadeTex }),
      roofs: new THREE.MeshLambertMaterial({ vertexColors: true, map: tilesTex }),
      water: new THREE.MeshLambertMaterial({ color: '#4f8199', emissive: '#0d2430', transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      post: new THREE.MeshLambertMaterial({ color: '#8e949b' }),
      trees: {
        spruce: new THREE.MeshLambertMaterial(),
        larch: new THREE.MeshLambertMaterial(),
        broadleaf: new THREE.MeshLambertMaterial(),
        cypress: new THREE.MeshLambertMaterial(),
        rock: new THREE.MeshLambertMaterial({ flatShading: true }),
        trunk: new THREE.MeshLambertMaterial({ color: '#5a4331' }),
      },
      /** cordoli, marciapiedi e aiuole delle rotatorie: colori di vertice, visti anche da sotto */
      kerb: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      /** l'arredo stradale: lamiera zincata, cartelli, semafori, catadiottri */
      road: roadsideMaterials(),
      lamp: new THREE.MeshLambertMaterial({ color: '#3b3f45' }),
      lampHead: new THREE.MeshLambertMaterial({ color: '#d9d6cc', emissive: '#000000' }),
      textures: [asphaltTex, stoneTex, facadeTex, tilesTex, groundTex],
      geos: furnitureGeometries(),
      /** cartelli d'inizio paese, uno per nome */
      signs: new Map<string, THREE.MeshLambertMaterial>(),
    };
  }, [rect]);
  useEffect(
    () => () => {
      for (const [k, v] of Object.entries(mats)) {
        if (k === 'trees') Object.values(v as Record<string, THREE.Material>).forEach((m) => m.dispose());
        else if (k === 'textures') (v as THREE.Texture[]).forEach((t) => t.dispose());
        else if (k === 'geos') Object.values(v as Record<string, THREE.BufferGeometry>).forEach((g) => g.dispose());
        else if (k === 'road') disposeRoadsideMaterials(v as ReturnType<typeof roadsideMaterials>);
        else if (k === 'signs')
          (v as Map<string, THREE.MeshLambertMaterial>).forEach((m) => {
            m.map?.dispose();
            m.dispose();
          });
        else (v as THREE.Material).dispose();
      }
    },
    [mats],
  );
  return mats;
}

/** Geometrie condivise dell'arredo: non si buttano con le mattonelle (userData.shared). */
function furnitureGeometries() {
  const pole = new THREE.CylinderGeometry(0.07, 0.1, 6.6, 6);
  pole.translate(0, 3.3, 0);
  const arm = new THREE.BoxGeometry(0.07, 0.07, 1.35);
  arm.translate(0, 6.5, 0.62);
  const lamp = mergeGeometries([pole, arm], false)!;
  pole.dispose();
  arm.dispose();
  const lampHead = new THREE.BoxGeometry(0.36, 0.13, 0.55);
  lampHead.translate(0, 6.42, 1.22);
  const signPole = new THREE.CylinderGeometry(0.045, 0.045, 2.6, 5);
  signPole.translate(0, 1.3, 0);
  const sign = new THREE.PlaneGeometry(2.1, 0.72);
  sign.translate(0, 2.35, 0.06);
  const out = { lamp, lampHead, signPole, sign, stoneSS: stoneGeometry('#c3262b'), stoneSP: stoneGeometry('#e2b21c'), stoneFace: stonePlane() };
  for (const g of Object.values(out)) g.userData.shared = true;
  return out;
}

/** La faccia scritta del cippo, verso chi arriva (−z). */
function stonePlane(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.28, 0.42);
  g.rotateY(Math.PI);
  g.translate(0, 0.3, -0.082);
  return g;
}

/** Il cartello d'inizio centro abitato: bianco, bordo nero, il nome in maiuscolo. */
function townSignTexture(name: string): THREE.CanvasTexture {
  return canvasTex(512, 176, (g) => {
    g.fillStyle = '#f7f7f2';
    g.fillRect(0, 0, 512, 176);
    g.strokeStyle = '#121212';
    g.lineWidth = 12;
    g.strokeRect(14, 14, 484, 148);
    g.fillStyle = '#121212';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = name.toUpperCase();
    let size = 72;
    g.font = `700 ${size}px sans-serif`;
    while (g.measureText(label).width > 440 && size > 26) {
      size -= 4;
      g.font = `700 ${size}px sans-serif`;
    }
    g.fillText(label, 256, 90);
  });
}

type Mats = ReturnType<typeof useMaterials>;

/** Porfido di Città Alta: cubetti in file ad arco, toni caldi. */
function settTexture(): THREE.CanvasTexture {
  const t = canvasTex(128, 128, (g) => {
    g.fillStyle = '#7d7469';
    g.fillRect(0, 0, 128, 128);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const x = col * 16 + (row % 2) * 8;
        const y = row * 16;
        const l = 52 + rnd() * 22;
        g.fillStyle = `hsl(${24 + rnd() * 14}, ${10 + rnd() * 10}%, ${l}%)`;
        g.fillRect((x % 128) + 1, y + 1, 14, 14);
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- cielo, luce, nuvole ----------

/**
 * Il cielo di Bergamo adesso (o all'ora scelta): sole nella posizione vera, colori del cielo e della
 * luce, foschia che si chiude con le nuvole e la pioggia, strade bagnate. Si ricalcola ogni 30 s.
 */
function Atmosphere({ weather, daytime, data, far, mats }: { weather: WeatherNow | null; daytime: Daytime; data: WorldData; far: number; mats: Mats }) {
  const { scene, gl, camera } = useThree();
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const dome = useRef<THREE.Mesh>(null);
  const clouds = useRef<THREE.Mesh>(null);
  const clock = useRef(0);
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(1000, 40, 24);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    return g;
  }, []);
  const cloudGeo = useMemo(() => new THREE.SphereGeometry(940, 48, 16, 0, Math.PI * 2, 0, Math.PI * 0.47), []);
  const cloudTex = useMemo(() => cloudTexture(), []);
  const cloudMat = useMemo(() => new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide, opacity: 0 }), [cloudTex]);
  useEffect(
    () => () => {
      geo.dispose();
      cloudGeo.dispose();
      cloudTex.dispose();
      cloudMat.dispose();
    },
    [geo, cloudGeo, cloudTex, cloudMat],
  );
  const apply = () => {
    const s = sunFor(daytime, new Date(), data.graph.origin.lat, data.graph.origin.lon);
    const look = weather ?? CLEAR;
    const a = atmosphere(s, look);
    const dir = sunVector(s);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1000;
      if (y > 0.08) c.copy(a.mid).lerp(a.zenith, Math.min(1, (y - 0.08) / 0.7));
      else c.copy(a.horizon).lerp(a.mid, Math.max(0, (y + 0.1) / 0.18));
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const k = Math.max(0, v.dot(dir));
      c.lerp(a.glow, Math.pow(k, 24) * 0.85 + Math.pow(k, 4) * 0.16);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    if (scene.background instanceof THREE.Color) scene.background.copy(a.horizon);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(a.horizon);
      scene.fog.near = a.fogNear;
      scene.fog.far = far * 0.92 * a.fogFar;
    }
    if (sun.current) {
      sun.current.position.copy(dir).multiplyScalar(1000);
      sun.current.color.copy(a.sunColor);
      sun.current.intensity = a.sunIntensity;
    }
    if (hemi.current) {
      hemi.current.color.copy(a.hemiSky);
      hemi.current.groundColor.copy(a.hemiGround);
      hemi.current.intensity = a.hemiIntensity;
    }
    gl.toneMappingExposure = a.exposure;
    // nuvole: più fitte col cielo coperto, tinte dalla luce del momento
    cloudMat.opacity = look.cloud < 0.05 ? 0 : Math.min(0.92, 0.15 + look.cloud * 0.85);
    cloudMat.color.copy(a.horizon).lerp(a.glow, 0.35).multiplyScalar(look.rain > 0.1 ? 0.8 : 1.05);
    // lampioni accesi quando il sole è basso o il cielo è scuro
    const dusk = s.elevation < (7 * Math.PI) / 180 || (look.cloud > 0.85 && look.rain > 1);
    mats.lampHead.emissive.set(dusk ? '#ffcf8a' : '#000000');
    // asfalto e porfido bagnati: più scuri
    const wet = look.rain >= 0.1;
    mats.asphalt.color.set(wet ? '#7f8186' : '#c9cbd0');
    mats.stone.color.set(wet ? '#a39a8e' : '#d8cfc2');
  };
  useEffect(() => {
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather, daytime]);
  useFrame((_, dt) => {
    if (dome.current) dome.current.position.copy(camera.position);
    if (clouds.current) {
      clouds.current.position.copy(camera.position);
      // le nuvole viaggiano col vento
      const w = weather ? Math.max(0.3, weather.windMs) : 0.5;
      clouds.current.rotation.y += dt * w * 0.0006;
    }
    clock.current += dt;
    if (clock.current > 30) {
      clock.current = 0;
      apply();
    }
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#e6f0fb', '#4f5a3c', 0.62]} />
      <directionalLight ref={sun} position={[-700, 760, 520]} intensity={1.85} color="#fff0d6" />
      <mesh ref={dome} geometry={geo} frustumCulled={false} renderOrder={-100}>
        <meshBasicMaterial vertexColors side={THREE.BackSide} depthWrite={false} fog={false} />
      </mesh>
      <mesh ref={clouds} geometry={cloudGeo} material={cloudMat} frustumCulled={false} renderOrder={-99} />
    </>
  );
}

/** Cumuli su una fascia di cielo: bianchi con l'alfa, si ripetono tutto intorno. */
function cloudTexture(): THREE.CanvasTexture {
  let seed = 91;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const W = 1024;
  const H = 256;
  const t = canvasTex(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      // radi verso lo zenit (in alto nella trama), fitti sopra l'orizzonte
      const y = H * (0.25 + 0.7 * Math.sqrt(rnd()));
      const x = rnd() * W;
      const rx = 30 + rnd() * 90;
      const ry = rx * (0.35 + rnd() * 0.25);
      for (let k = 0; k < 7; k++) {
        const bx = x + (rnd() - 0.5) * rx * 1.4;
        const by = y + (rnd() - 0.6) * ry;
        const r = ry * (0.6 + rnd() * 0.7);
        for (const dx of [0, -W, W]) {
          const grd = g.createRadialGradient(bx + dx, by, 0, bx + dx, by, r);
          grd.addColorStop(0, 'rgba(255,255,255,0.55)');
          grd.addColorStop(0.6, 'rgba(255,255,255,0.25)');
          grd.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grd;
          g.fillRect(bx + dx - r, by - r, r * 2, r * 2);
        }
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

/** Pioggia: righe che cadono intorno alla camera, inclinate dal vento. */
function Rain({ mmh, weather }: { mmh: number; weather: WeatherNow }) {
  const { camera } = useThree();
  const n = Math.round(Math.min(2400, 500 + mmh * 450));
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      pos[i * 6] = (Math.random() - 0.5) * 70;
      pos[i * 6 + 1] = Math.random() * 30;
      pos[i * 6 + 2] = (Math.random() - 0.5) * 70;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, [n]);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<THREE.LineSegments>(null);
  useFrame((_, dt) => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    // il vento porta le gocce da dove soffia verso il lato opposto
    const wx = -Math.sin(weather.windFrom) * weather.windMs * 0.5;
    const wz = Math.cos(weather.windFrom) * weather.windMs * 0.5;
    const step = Math.min(0.05, dt);
    for (let i = 0; i < n; i++) {
      const k = i * 6;
      a[k] += wx * step;
      a[k + 1] -= 8.5 * step;
      a[k + 2] += wz * step;
      if (a[k + 1] < -2) {
        a[k] = (Math.random() - 0.5) * 70;
        a[k + 1] = 28;
        a[k + 2] = (Math.random() - 0.5) * 70;
      }
      a[k + 3] = a[k] + wx * 0.05;
      a[k + 4] = a[k + 1] - 0.55;
      a[k + 5] = a[k + 2] + wz * 0.05;
    }
    pos.needsUpdate = true;
    if (ref.current) ref.current.position.set(camera.position.x, camera.position.y - 8, camera.position.z);
  });
  return (
    <lineSegments ref={ref} geometry={geo} frustumCulled={false}>
      <lineBasicMaterial color="#c9d3dc" transparent opacity={0.45} fog={false} />
    </lineSegments>
  );
}

// ---------- terreno lontano ----------

function FarTerrain({ terrain, stride, material }: { terrain: Terrain; stride: number; material: THREE.Material }) {
  const mesh = useRef<THREE.Mesh>(null);
  useEffect(() => {
    let alive = true;
    void terrain.loadFar().then((h) => {
      if (!alive || !h || !mesh.current) return;
      const f = terrain.graph.far;
      const nx = Math.floor((f.nx - 1) / stride) + 1;
      const nz = Math.floor((f.nz - 1) / stride) + 1;
      const geo = new THREE.PlaneGeometry((nx - 1) * f.step * stride, (nz - 1) * f.step * stride, nx - 1, nz - 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(f.x0 + ((nx - 1) * f.step * stride) / 2, 0, f.z0 + ((nz - 1) * f.step * stride) / 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) pos.setY(j * nx + i, h[j * stride * f.nx + i * stride] - 1.5);
      geo.computeVertexNormals();
      const nrm = geo.attributes.normal as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let k = 0; k < pos.count; k++) {
        groundColor(c, pos.getY(k), nrm.getY(k), nrm.getZ(k), hash2(Math.floor(pos.getX(k) / 300), Math.floor(pos.getZ(k) / 300)), 99);
        c.toArray(col, k * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const old = mesh.current.geometry;
      mesh.current.geometry = geo;
      old.dispose();
    });
    return () => {
      alive = false;
      mesh.current?.geometry.dispose();
    };
  }, [terrain, stride]);
  return <mesh ref={mesh} material={material} frustumCulled={false} />;
}

// ---------- mattonelle vicine ----------

interface TileEntry {
  key: string;
  ix: number;
  iz: number;
  state: 'wait' | 'build' | 'ready';
  job: Generator<void, void, void> | null;
  group: THREE.Group | null;
  trees: TileMeshes['trees'];
  /** arredo vicino: si costruisce quando la mattonella arriva entro due anelli, anche se era nata lontana */
  detail: 'none' | 'build' | 'ready';
  djob: Generator<void, void, void> | null;
  items: RoadsideItems | null;
}

function NearTiles(props: WorldSceneProps & { mats: Mats; rect: { value: THREE.Vector3 } }) {
  const { data, field, terrain, quality, mats, rect, playerPose } = props;
  const q = QUALITY[quality];
  const root = useRef<THREE.Group>(null);
  const tiles = useRef(new Map<string, TileEntry>());
  const buildings = useRef(new Map<string, Building[] | Promise<Building[]>>());
  const forest = useRef<ForestHandle | null>(null);
  const roadside = useRef<RoadsideHandle | null>(null);
  const center = useRef<[number, number] | null>(null);
  const dirtyTrees = useRef(false);
  /** l'arredo piccolo (paletti, cartelli, semafori) si rifà anche quando il centro si sposta */
  const dirtyProps = useRef(false);
  const T = q.tile;
  const b = data.graph.bounds;

  useEffect(() => {
    const map = tiles.current;
    const grp = root.current;
    return () => {
      for (const t of map.values()) disposeGroup(t.group);
      map.clear();
      grp?.clear();
    };
  }, []);

  const specOf = (ix: number, iz: number, ring: number): TileSpec => ({
    tx: ix,
    tz: iz,
    x0: b.x0 + ix * T,
    z0: b.z0 + iz * T,
    size: T,
    spacing: ring >= 3 ? q.spacing * 1.6 : q.spacing,
    trees: ring >= 3 ? q.trees * 0.45 : q.trees,
    buildings: true,
    ring,
  });

  function buildingsFor(spec: TileSpec): Building[] | null {
    const [dx0, dz0] = terrain.tileOf(spec.x0 + 1, spec.z0 + 1);
    const key = `${dx0}_${dz0}`;
    const have = buildings.current.get(key);
    if (Array.isArray(have)) return have;
    if (!have) {
      const p = loadBuildings(data.graph, dx0, dz0).then((list) => {
        buildings.current.set(key, list);
        return list;
      });
      buildings.current.set(key, p);
    }
    return null;
  }

  function* tileJob(entry: TileEntry, spec: TileSpec): Generator<void, void, void> {
    const terrainGeo = yield* terrainJob(field, spec);
    const roads = yield* roadsJob(data.graph, field, spec);
    let bGeo: BuildingMeshes = { walls: null, roofs: null };
    for (;;) {
      const list = buildingsFor(spec);
      if (list) {
        bGeo = yield* buildingsJob(field, list, spec);
        break;
      }
      yield;
    }
    const trees = yield* treesJob(field, spec);
    const water = waterGeometry(data.features, spec);
    const rails = railsGeometry(field, data.features, spec);
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material) => {
      if (geo) g.add(new THREE.Mesh(geo, mat));
    };
    add(terrainGeo, mats.terrain);
    add(roads.asphalt, mats.asphalt);
    add(roads.stone, mats.stone);
    add(roads.cycle, mats.cycle);
    add(roads.paint, mats.paint);
    add(roads.verge, mats.verge);
    add(roads.concrete, mats.concrete);
    add(roads.kerb, mats.kerb);
    add(roads.tunnel, mats.tunnel);
    add(bGeo.walls, mats.buildings);
    add(bGeo.roofs, mats.roofs);
    add(water, mats.water);
    add(rails, mats.rails);
    entry.group = g;
    entry.trees = trees;
  }

  /**
   * L'arredo vicino: lampioni e cartelli dei paesi, guardrail, delineatori, semafori, cartelli,
   * strisce, aiuole, i luoghi da passare. Si aggiunge al gruppo della mattonella già pronta.
   */
  function* detailJob(entry: TileEntry, spec: TileSpec): Generator<void, void, void> {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material) => {
      if (geo) g.add(new THREE.Mesh(geo, mat));
    };
    const street = yield* streetJob(data.graph, field, data.features, spec);
    add(street.beam, mats.road.beam);
    add(street.paint, mats.paint);
    add(street.decal, mats.road.decal);
    add(street.island, mats.kerb);
    add(street.signs, mats.road.sign);
    add(street.signBacks, mats.road.signBack);
    add(street.props, mats.road.lit);
    for (const st of street.stones) {
      const key = `cippo:${st.ref}`;
      let mat = mats.signs.get(key);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ map: stoneTexture(st.ref) });
        mats.signs.set(key, mat);
      }
      const stone = new THREE.Group();
      stone.position.set(st.x, st.y, st.z);
      stone.rotation.y = st.h;
      stone.add(new THREE.Mesh(st.cap === '#c3262b' ? mats.geos.stoneSS : mats.geos.stoneSP, mats.road.lit), new THREE.Mesh(mats.geos.stoneFace, mat));
      g.add(stone);
    }
    // arredo dei paesi: lampioni e il cartello col nome all'ingresso
    const furn = yield* furnitureJob(data.graph, field, data.features.places, spec);
    const d = new THREE.Object3D();
    if (furn.lamps.length) {
      const poles = new THREE.InstancedMesh(mats.geos.lamp, mats.lamp, furn.lamps.length);
      const heads = new THREE.InstancedMesh(mats.geos.lampHead, mats.lampHead, furn.lamps.length);
      furn.lamps.forEach((l, i) => {
        d.position.set(l.x, l.y - 0.2, l.z);
        d.rotation.set(0, l.h, 0);
        d.updateMatrix();
        poles.setMatrixAt(i, d.matrix);
        heads.setMatrixAt(i, d.matrix);
      });
      poles.computeBoundingSphere();
      heads.computeBoundingSphere();
      g.add(poles, heads);
    }
    for (const t of furn.towns) {
      let mat = mats.signs.get(t.name);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ map: townSignTexture(t.name) });
        mats.signs.set(t.name, mat);
      }
      const sign = new THREE.Group();
      sign.position.set(t.x, t.y - 0.1, t.z);
      // la faccia (+z del piano) guarda chi arriva: verso −avanti
      sign.rotation.y = t.h + Math.PI;
      sign.add(new THREE.Mesh(mats.geos.sign, mat));
      for (const dx of [-0.8, 0.8]) {
        const p = new THREE.Mesh(mats.geos.signPole, mats.lamp);
        p.position.x = dx;
        sign.add(p);
      }
      g.add(sign);
    }
    entry.group?.add(g);
    entry.items = street.items;
    if (street.trees.length) entry.trees = [...entry.trees, ...street.trees];
  }

  useFrame(() => {
    const pose = playerPose();
    // il centro sta un po' avanti: si vede più strada davanti che dietro
    const ax = pose.x + Math.sin(pose.heading) * T * 0.4;
    const az = pose.z + Math.cos(pose.heading) * T * 0.4;
    const cx = Math.floor((ax - b.x0) / T);
    const cz = Math.floor((az - b.z0) / T);
    const map = tiles.current;
    if (!center.current || center.current[0] !== cx || center.current[1] !== cz) {
      center.current = [cx, cz];
      dirtyProps.current = true;
      for (let dz = -q.ring; dz <= q.ring; dz++) {
        for (let dx = -q.ring; dx <= q.ring; dx++) {
          const ix = cx + dx;
          const iz = cz + dz;
          const key = `${ix}_${iz}`;
          if (!map.has(key)) map.set(key, { key, ix, iz, state: 'wait', job: null, group: null, trees: [], detail: 'none', djob: null, items: null });
        }
      }
      for (const [key, t] of map) {
        if (Math.max(Math.abs(t.ix - cx), Math.abs(t.iz - cz)) > q.ring + 1) {
          if (t.group) root.current?.remove(t.group);
          disposeGroup(t.group);
          map.delete(key);
          dirtyTrees.current = true;
        }
      }
      // le mattonelle del DEM: quelle intorno, e via quelle lontane
      void terrain.around(pose.x, pose.z, (q.ring + 1.5) * T);
      terrain.prune(pose.x, pose.z, (q.ring + 3) * T);
    }
    // un lavoro alla volta, il più vicino, per non più di 6 ms a fotogramma
    const t0 = performance.now();
    let guard = 0;
    while (performance.now() - t0 < 6 && guard++ < 50) {
      let job: TileEntry | null = null;
      let best = Infinity;
      let detail = false;
      for (const t of map.values()) {
        const d = Math.max(Math.abs(t.ix - cx), Math.abs(t.iz - cz));
        if (t.state === 'ready') {
          // l'arredo vicino: entro due anelli, dopo le mattonelle che mancano ancora alla stessa distanza
          if (t.detail === 'build') {
            job = t;
            detail = true;
            break;
          }
          if (t.detail === 'none' && d <= DETAIL_RING && d + 0.5 < best) {
            best = d + 0.5;
            job = t;
            detail = true;
          }
          continue;
        }
        if (t.state === 'build') {
          job = t;
          detail = false;
          break;
        }
        // si comincia solo quando il DEM sotto la mattonella (e il bordo) è arrivato
        const spec = specOf(t.ix, t.iz, d);
        const [a0, b0] = terrain.tileOf(spec.x0 - 60, spec.z0 - 60);
        const [a1, b1] = terrain.tileOf(spec.x0 + T + 60, spec.z0 + T + 60);
        let ok = true;
        for (let i = a0; i <= a1 && ok; i++) for (let j = b0; j <= b1 && ok; j++) if (terrain.inBounds(i, j) && !terrain.has(i, j)) ok = false;
        if (!ok) continue;
        if (d < best) {
          best = d;
          job = t;
          detail = false;
        }
      }
      if (!job) break;
      if (detail) {
        if (job.detail === 'none') {
          const d = Math.max(Math.abs(job.ix - cx), Math.abs(job.iz - cz));
          job.djob = detailJob(job, specOf(job.ix, job.iz, d));
          job.detail = 'build';
        }
        const r = job.djob!.next();
        if (r.done) {
          job.detail = 'ready';
          job.djob = null;
          dirtyTrees.current = true;
          dirtyProps.current = true;
        }
        continue;
      }
      if (job.state === 'wait') {
        const d = Math.max(Math.abs(job.ix - cx), Math.abs(job.iz - cz));
        job.job = tileJob(job, specOf(job.ix, job.iz, d));
        job.state = 'build';
      }
      const r = job.job!.next();
      if (r.done) {
        job.state = 'ready';
        job.job = null;
        if (job.group) root.current?.add(job.group);
        dirtyTrees.current = true;
        readyFlag.tiles++;
      }
    }
    // il terreno lontano si nasconde dentro il quadrato di mattonelle tutte pronte
    let k = -1;
    for (let r = 0; r <= q.ring; r++) {
      let all = true;
      for (let dz = -r; dz <= r && all; dz++) for (let dx = -r; dx <= r && all; dx++) if (map.get(`${cx + dx}_${cz + dz}`)?.state !== 'ready') all = false;
      if (!all) break;
      k = r;
    }
    if (k >= 0) rect.value.set(b.x0 + (cx + 0.5) * T, b.z0 + (cz + 0.5) * T, (k + 0.5) * T - 3);
    else rect.value.z = -1;
    if (dirtyTrees.current && forest.current) {
      dirtyTrees.current = false;
      const all: TileMeshes['trees'] = [];
      for (const t of map.values()) if (t.state === 'ready') all.push(...t.trees);
      forest.current.set(all);
    }
    if (dirtyProps.current && roadside.current) {
      dirtyProps.current = false;
      // solo le mattonelle intorno al ciclista: a più di un anello un paletto è meno di un pixel
      const near: RoadsideItems[] = [];
      for (const t of map.values()) if (t.items && Math.max(Math.abs(t.ix - cx), Math.abs(t.iz - cz)) <= PROP_RING) near.push(t.items);
      roadside.current.set(near);
    }
  });

  return (
    <group>
      <group ref={root} />
      <Forest handle={forest} mats={mats} />
      <Roadside handle={roadside} mats={mats} />
    </group>
  );
}

function disposeGroup(g: THREE.Group | null): void {
  if (!g) return;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.geometry.userData.shared) o.geometry.dispose();
  });
}

// ---------- bosco: un'istanza per specie per tutto il mondo vicino ----------

interface ForestHandle {
  set(list: TileMeshes['trees']): void;
}

const TREE_COLORS: Record<TreeKind, string[]> = {
  spruce: ['#24452c', '#2c5233', '#1f3d29'],
  larch: ['#5b7a3a', '#6b8a40', '#4f6e35'],
  broadleaf: ['#4f7d36', '#5f8c3c', '#6d9443', '#577f33'],
  cypress: ['#2f4a2a', '#34512d'],
  rock: ['#8b877f', '#7a766f', '#9b968c'],
};

function Forest({ handle, mats }: { handle: React.MutableRefObject<ForestHandle | null>; mats: Mats }) {
  const group = useRef<THREE.Group>(null);
  const geos = useMemo(() => {
    const spruce = new THREE.ConeGeometry(2.2, 9, 7);
    spruce.translate(0, 6.3, 0);
    const larch = new THREE.ConeGeometry(2.4, 8, 6);
    larch.translate(0, 6, 0);
    const broadleaf = new THREE.IcosahedronGeometry(3.2, 0);
    broadleaf.scale(1, 0.85, 1);
    broadleaf.translate(0, 5.6, 0);
    const cypress = new THREE.ConeGeometry(1.1, 10, 6);
    cypress.translate(0, 6.2, 0);
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3.2, 5);
    trunk.translate(0, 1.4, 0);
    const rock = new THREE.DodecahedronGeometry(1, 0);
    rock.scale(1.3, 0.7, 1);
    return { spruce, larch, broadleaf, cypress, trunk, rock };
  }, []);
  const meshes = useRef<Partial<Record<TreeKind | 'trunk', THREE.InstancedMesh>>>({});
  useEffect(() => {
    const g = group.current;
    const current = meshes.current;
    handle.current = {
      set(list) {
        if (!g) return;
        const by: Record<TreeKind, TileMeshes['trees']> = { spruce: [], larch: [], broadleaf: [], cypress: [], rock: [] };
        for (const t of list) by[t.kind].push(t);
        const d = new THREE.Object3D();
        const c = new THREE.Color();
        const make = (key: TreeKind | 'trunk', items: TileMeshes['trees'], geo: THREE.BufferGeometry, mat: THREE.Material, colors?: string[]) => {
          const old = current[key];
          if (old) {
            g.remove(old);
            old.dispose();
          }
          if (items.length === 0) return;
          const m = new THREE.InstancedMesh(geo, mat, items.length);
          items.forEach((it, i) => {
            d.position.set(it.x, it.y, it.z);
            d.rotation.set(key === 'rock' ? it.tint : 0, it.r, 0);
            d.scale.setScalar(it.s);
            d.updateMatrix();
            m.setMatrixAt(i, d.matrix);
            if (colors) m.setColorAt(i, c.set(colors[Math.floor(it.tint * colors.length) % colors.length]));
          });
          m.instanceMatrix.needsUpdate = true;
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          m.frustumCulled = false;
          current[key] = m;
          g.add(m);
        };
        (['spruce', 'larch', 'broadleaf', 'cypress', 'rock'] as TreeKind[]).forEach((k) => make(k, by[k], geos[k], mats.trees[k], TREE_COLORS[k]));
        make('trunk', [...by.spruce, ...by.larch, ...by.broadleaf, ...by.cypress], geos.trunk, mats.trees.trunk);
      },
    };
    return () => {
      handle.current = null;
      for (const m of Object.values(current)) m?.dispose();
      Object.values(geos).forEach((x) => x.dispose());
    };
  }, [handle, geos, mats]);
  return <group ref={group} />;
}

// ---------- arredo stradale: un'istanza per tipo per tutto il mondo vicino ----------

/** Le mattonelle entro questo anello hanno l'arredo vicino. */
const DETAIL_RING = 2;
/** Le mattonelle entro questo anello mostrano l'arredo piccolo (istanze): paletti, cartelli, semafori. */
const PROP_RING = 1;

interface RoadsideHandle {
  set(list: RoadsideItems[]): void;
}

/**
 * Paletti e catadiottri dei guardrail, delineatori, pali dei cartelli, semafori (palo e lanterna,
 * la luce verde accesa e il suo alone), cespugli delle aiuole, montanti delle ringhiere: come il
 * bosco, un InstancedMesh per pezzo per tutte le mattonelle vicine, rifatto quando ne arriva una.
 */
function Roadside({ handle, mats }: { handle: React.MutableRefObject<RoadsideHandle | null>; mats: Mats }) {
  const group = useRef<THREE.Group>(null);
  const parts = useMemo(() => {
    const r = mats.road;
    const p: Record<RoadsideKind, [THREE.BufferGeometry, THREE.Material][]> = {
      railPost: [[railPostGeometry(), r.lit]],
      reflector: [[reflectorGeometry(), r.bright]],
      delineator: [
        [delineatorGeometry(), r.lit],
        [delineatorEyesGeometry(), r.bright],
      ],
      signPole: [[signPoleGeometry(), r.lit]],
      signal: [
        [signalGeometry(), r.lit],
        [signalGreenGeometry(), r.bright],
        [signalGlowGeometry(), r.glow],
      ],
      shrub: [[shrubGeometry(), r.shrub]],
      bridgePost: [[bridgePostGeometry(), r.lit]],
    };
    return p;
  }, [mats]);
  const live = useRef<THREE.InstancedMesh[]>([]);
  useEffect(() => {
    const g = group.current;
    const current = live.current;
    handle.current = {
      set(list) {
        if (!g) return;
        for (const m of current) {
          g.remove(m);
          m.dispose();
        }
        current.length = 0;
        for (const k of ROADSIDE_KINDS) {
          const items = list.flatMap((l) => l[k]);
          for (const [geo, mat] of parts[k]) {
            const m = instanced(geo, mat, items, false);
            if (m) {
              current.push(m);
              g.add(m);
            }
          }
        }
      },
    };
    return () => {
      handle.current = null;
      for (const m of current) m.dispose();
      current.length = 0;
      for (const l of Object.values(parts)) for (const [geo] of l) geo.dispose();
    };
  }, [handle, parts]);
  return <group ref={group} />;
}

// ---------- archi dei traguardi ----------

/**
 * Gli archi passati dal gioco. Solo in sviluppo, `?archlab` mette tre archi e un cartello davanti
 * al ciclista per vederli senza il gioco (non esiste nella build pubblicata).
 */
function WorldArches({ arches, path, engine }: { arches?: ArchSpec[]; path: WorldPath; engine: RideEngine }) {
  const lab = useMemo<ArchSpec[] | null>(() => {
    if (!import.meta.env.DEV || typeof location === 'undefined' || !new URLSearchParams(location.search).has('archlab')) return null;
    const at = (d: number) => path.poseAt(Math.min(path.length - 1, engine.distance + d));
    const hw = (d: number) => path.graph.edges[path.edgeAt(Math.min(path.length - 1, engine.distance + d)).edge].hw;
    const spec = (id: string, kind: ArchSpec['kind'], role: ArchSpec['role'], label: string, sub: string, d: number): ArchSpec => {
      const p = at(d);
      return { id, kind, role, label, sub, x: p.x, y: p.y, z: p.z, heading: p.heading, halfWidth: hw(d) };
    };
    return [
      spec('lab:a', 'volata', 'start', 'VOLATA', 'Traguardo di Zogno', 28),
      spec('lab:b', 'gpm', 'banner', '500 m', 'GPM', 60),
      spec('lab:c', 'gpm', 'finish', 'GPM', 'Colle di Zambla', 110),
      spec('lab:d', 'crono', 'start', 'CRONO', 'Cronoscalata', 170),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const list = lab ?? arches;
  if (!list || list.length === 0) return null;
  return <Arches specs={list} />;
}

// ---------- laghi e mura ----------

function Lakes({ data }: { data: WorldData }) {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const l of data.features.lakes) {
      const shape = new THREE.Shape();
      for (let i = 0; i < l.ring.length; i += 2) {
        if (i === 0) shape.moveTo(l.ring[i], -l.ring[i + 1]);
        else shape.lineTo(l.ring[i], -l.ring[i + 1]);
      }
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, l.level, 0);
      parts.push(g);
    }
    return parts;
  }, [data]);
  useEffect(() => () => geo.forEach((g) => g.dispose()), [geo]);
  return (
    <group>
      {geo.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshLambertMaterial color="#4f8199" emissive="#0d2430" />
        </mesh>
      ))}
    </group>
  );
}

/** Le Mura venete di Città Alta: la strada corre sopra, la cortina scende di 14 m verso la pianura. */
function Walls({ data, field }: { data: WorldData; field: WorldField }) {
  const geo = useMemo(() => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const w of data.features.walls) {
      const p = w.pts;
      let prev = -1;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i];
        const z = p[i + 1];
        const top = p[i + 2] + 1.1;
        const bottom = Math.min(field.terrain.height(x, z), top - 4) - 12;
        const base = pos.length / 3;
        pos.push(x, top, z, x, bottom, z);
        if (prev >= 0) idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
        prev = base;
      }
    }
    if (pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [data, field]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo}>
      <meshLambertMaterial color="#b9ab90" side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---------- nomi di cime e paesi ----------

interface LabelItem {
  name: string;
  sub: string;
  x: number;
  y: number;
  z: number;
  range: number;
  peak: boolean;
}

function labelTex(name: string, sub: string, peak: boolean): THREE.CanvasTexture {
  return canvasTex(512, 128, (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 44px sans-serif';
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(10,12,15,0.72)';
    g.fillStyle = peak ? '#fff7e8' : '#ffffff';
    g.strokeText(name, 256, 50);
    g.fillText(name, 256, 50);
    if (sub) {
      g.font = '600 30px sans-serif';
      g.lineWidth = 7;
      g.strokeText(sub, 256, 98);
      g.fillStyle = peak ? '#ffd27a' : '#c8f031';
      g.fillText(sub, 256, 98);
    }
  });
}

function Labels({ data, playerPose, names }: { data: WorldData; engine: RideEngine; playerPose: () => TrackPose; names: Set<THREE.Sprite> }) {
  const items = useMemo<LabelItem[]>(() => {
    const out: LabelItem[] = [];
    for (const p of data.features.peaks) {
      if (p.pass) out.push({ name: p.name, sub: `${p.ele} m`, x: p.x, y: p.ele + 12, z: p.z, range: 7000, peak: false });
      else if (p.ele >= 1400) out.push({ name: p.name, sub: `${p.ele} m`, x: p.x, y: p.ele + 25, z: p.z, range: p.ele > 2300 ? 22000 : 13000, peak: true });
    }
    for (const p of data.features.places) {
      const range = p.kind === 'city' ? 30000 : p.kind === 'town' ? 9000 : p.kind === 'village' ? 4500 : p.kind === 'suburb' || p.kind === 'quarter' ? 1500 : 1200;
      out.push({ name: p.name, sub: '', x: p.x, y: p.y + (p.kind === 'city' ? 120 : 45), z: p.z, range, peak: false });
    }
    return out;
  }, [data]);
  const group = useRef<THREE.Group>(null);
  const live = useRef(new Map<number, THREE.Sprite>());
  const clock = useRef(0);
  const { camera } = useThree();
  useEffect(() => {
    const map = live.current;
    return () => {
      for (const s of map.values()) {
        names.delete(s);
        s.material.map?.dispose();
        s.material.dispose();
      }
      map.clear();
    };
  }, [names]);
  useFrame((_, dt) => {
    clock.current -= dt;
    const g = group.current;
    if (!g) return;
    if (clock.current <= 0) {
      clock.current = 0.6;
      const p = playerPose();
      // al più 26 nomi alla volta, i più vicini per la loro portata
      const near: { i: number; k: number }[] = [];
      items.forEach((it, i) => {
        const d = Math.hypot(it.x - p.x, it.z - p.z);
        if (d < it.range && d > 60) near.push({ i, k: d / it.range });
      });
      near.sort((a, b) => a.k - b.k);
      const want = new Set(near.slice(0, 26).map((n) => n.i));
      for (const [i, s] of live.current) {
        if (!want.has(i)) {
          names.delete(s);
          g.remove(s);
          s.material.map?.dispose();
          s.material.dispose();
          live.current.delete(i);
        }
      }
      for (const i of want) {
        if (live.current.has(i)) continue;
        const it = items[i];
        const mat = new THREE.SpriteMaterial({ map: labelTex(it.name, it.sub, it.peak), transparent: true, opacity: 0, depthTest: true, depthWrite: false, fog: false, sizeAttenuation: false });
        const s = new THREE.Sprite(mat);
        s.position.set(it.x, it.y, it.z);
        s.center.set(0.5, 0);
        s.renderOrder = 5;
        s.userData.prio = it.peak ? 2 : 1;
        live.current.set(i, s);
        names.add(s);
        g.add(s);
      }
    }
    // dimensione fissa sullo schermo, un po' più piccola per i lontani
    for (const [i, s] of live.current) {
      const it = items[i];
      const d = camera.position.distanceTo(s.position);
      const k = THREE.MathUtils.clamp(1 - d / (it.range * 1.4), 0.55, 1) * 0.105;
      s.scale.set(k * 4, k, 1);
    }
  });
  return <group ref={group} />;
}

// ---------- luoghi da riconoscere ----------

function Landmarks({ data, playerPose, names }: { data: WorldData; playerPose: () => TrackPose; names: Set<THREE.Sprite> }) {
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
      const tex = labelTex(l.name, kindLabel(l.kind), l.kind === 'cima' || l.kind === 'passo');
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false, sizeAttenuation: false }));
      const tall = l.kind === 'cima' || l.kind === 'passo' || l.kind === 'fiume' || l.kind === 'paese' || l.kind === 'citta';
      s.position.set(l.x, l.y + (tall ? 30 : 16), l.z);
      s.center.set(0.5, 0);
      s.scale.set(0.38, 0.095, 1);
      s.userData = { range: tall ? 6000 : 1600, prio: 0 };
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
          o.material.map?.dispose();
          o.material.dispose();
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
      if (o instanceof THREE.Sprite) o.visible = Math.hypot(o.position.x - p.x, o.position.z - p.z) < (o.userData.range as number);
    }
  });
  return <group ref={group} />;
}

/**
 * I nomi nel 3D non si accavallano. Cinque volte al secondo si proiettano sullo schermo e, dal più
 * importante (i luoghi da riconoscere, poi i paesi, poi le cime) e dal più vicino, si spegne chi
 * copre un nome già acceso o finisce sotto la barra in alto. Si accendono e si spengono sfumando.
 */
function Declutter({ names }: { names: Set<THREE.Sprite> }) {
  const { camera } = useThree();
  const clock = useRef(0);
  const want = useRef(new WeakMap<THREE.Sprite, number>());
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    clock.current -= dt;
    if (clock.current <= 0) {
      clock.current = 0.2;
      const P = camera.projectionMatrix.elements;
      const list: { s: THREE.Sprite; d: number; prio: number }[] = [];
      for (const s of names) if (s.visible) list.push({ s, d: camera.position.distanceToSquared(s.position), prio: (s.userData.prio as number | undefined) ?? 1 });
      list.sort((a, b) => a.prio - b.prio || a.d - b.d);
      const taken: [number, number, number, number][] = [];
      for (const { s } of list) {
        v.copy(s.position).project(camera);
        let ok = v.z < 1 && Math.abs(v.x) < 1.2 && v.y < 1;
        if (ok) {
          // misure in coordinate di schermo (-1…1): il testo occupa circa tre quarti della tela
          const w = s.scale.x * P[0] * 0.78;
          const h = s.scale.y * P[5] * 0.85;
          const r: [number, number, number, number] = [v.x - w / 2, v.y, v.x + w / 2, v.y + h];
          // sotto il titolo in alto, e sotto la colonna di km e meteo a destra, un nome non si legge
          if (r[3] > 0.78 || (r[3] > 0.56 && r[2] > 0.28)) ok = false;
          else
            for (const t of taken)
              if (r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1]) {
                ok = false;
                break;
              }
          if (ok) taken.push(r);
        }
        want.current.set(s, ok ? 1 : 0);
      }
    }
    const k = Math.min(1, dt * 6);
    for (const s of names) {
      const t = want.current.get(s) ?? 0;
      s.material.opacity += (t - s.material.opacity) * k;
    }
  });
  return null;
}

// ---------- cartelli del percorso ----------

/**
 * Sul percorso scelto: l'arco di partenza e quello d'arrivo del tratto cronometrato e, se è una salita,
 * il cartello a ogni chilometro con i km che mancano, la quota e la pendenza del km dopo.
 */
function RideSigns({ data, ride }: { data: WorldData; ride: RideDef }) {
  const signs = useMemo(() => {
    const g = data.graph;
    const [first, ...rest] = ride.legs;
    const e0 = g.edges[first[0]];
    const path = new WorldPath(g, { edge: first[0], dir: first[1], s: first[1] > 0 ? 0 : e0.length });
    for (const [edge, dir] of rest) path.append(edge, dir);
    const [from, to] = ride.timed;
    const a = path.poseAt(from);
    const b = path.poseAt(to);
    const climb = b.altitude - a.altitude > 80;
    const km: { pose: TrackPose; tex: THREE.CanvasTexture; hw: number }[] = [];
    if (climb) {
      for (let d = from + 1000; d < to - 300; d += 1000) {
        const p = path.poseAt(d);
        const q = path.poseAt(Math.min(to, d + 1000));
        const grade = (q.altitude - p.altitude) / Math.max(1, Math.min(to, d + 1000) - d);
        km.push({ pose: p, tex: kmTexture(Math.round((to - d) / 1000), grade, Math.round(p.altitude)), hw: g.edges[path.edgeAt(d).edge].hw });
      }
    }
    const startTex = bannerTexture(climb ? 'INIZIO SALITA' : 'PARTENZA', ride.name);
    const finishTex = bannerTexture('ARRIVO', ride.name);
    return {
      km,
      start: { pose: path.poseAt(Math.min(path.length, from + 4)), tex: startTex, hw: g.edges[path.edgeAt(from + 4).edge].hw },
      finish: { pose: path.poseAt(Math.max(0, to - 2)), tex: finishTex, hw: g.edges[path.edgeAt(Math.max(0, to - 2)).edge].hw },
    };
  }, [data, ride]);
  useEffect(
    () => () => {
      signs.km.forEach((k) => k.tex.dispose());
      signs.start.tex.dispose();
      signs.finish.tex.dispose();
    },
    [signs],
  );
  return (
    <group>
      <Gate pose={signs.start.pose} texture={signs.start.tex} hw={signs.start.hw} />
      <Gate pose={signs.finish.pose} texture={signs.finish.tex} hw={signs.finish.hw} />
      {signs.km.map((k, i) => {
        // a destra di chi sale
        const off = k.hw + 1.3;
        return (
          <group key={i} position={[k.pose.x - Math.cos(k.pose.heading) * off, k.pose.y, k.pose.z + Math.sin(k.pose.heading) * off]} rotation={[0, k.pose.heading + Math.PI, 0]}>
            <mesh position={[0, 0.7, 0]}>
              <boxGeometry args={[0.07, 1.4, 0.07]} />
              <meshLambertMaterial color="#666b72" />
            </mesh>
            <mesh position={[0, 1.65, 0]}>
              <planeGeometry args={[1.2, 0.6]} />
              <meshBasicMaterial map={k.tex} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    citta: 'città',
    paese: 'paese',
    chiesa: 'chiesa',
    santuario: 'santuario',
    torre: 'torre',
    porta: 'porta delle Mura',
    mura: 'Mura venete',
    ponte: 'ponte',
    fiume: 'fiume',
    cima: 'cima',
    passo: 'passo',
    lago: 'lago',
    castello: 'castello',
    luogo: 'luogo',
    funivia: 'funivia',
    stazione: 'stazione',
  };
  return map[kind] ?? kind;
}

// ---------- ciclisti ----------

function PlayerRider({ engine, playerPose, selfColor }: WorldSceneProps) {
  return <Rider side={0} jersey={selfColor} getPose={playerPose} getCadence={() => engine.cadence} getSpeed={() => engine.speed} />;
}

function NpcRiders({ crowd }: { crowd: NpcCrowd }) {
  return (
    <group>
      {crowd.npcs.map((n) => (
        <Rider
          key={n.slot}
          side={0}
          jersey={NPC_JERSEYS[n.slot % NPC_JERSEYS.length]}
          helmet={n.slot % 3 === 0 ? '#20242b' : '#f2f3ef'}
          getPose={() => {
            const m = crowd.npcs[n.slot];
            return { x: m.x, y: m.active ? m.y : -5000, z: m.z, heading: m.heading, grade: m.grade, altitude: m.y, distance: 0 };
          }}
          getCadence={() => (crowd.npcs[n.slot].grade < -0.04 ? 0 : crowd.npcs[n.slot].cadence)}
          getSpeed={() => crowd.npcs[n.slot].v}
        />
      ))}
    </group>
  );
}

function RemoteRiderView({ rider }: { rider: RemoteWorldRider }) {
  const last = useRef({ x: 0, y: -5000, z: 0, heading: 0, grade: 0, v: 0, idle: true });
  return (
    <Rider
      side={0}
      jersey={rider.color}
      helmet={rider.color}
      label={rider.nick}
      getPose={() => {
        const p = rider.pose();
        if (p) last.current = p;
        const l = last.current;
        return { x: l.x, y: p ? l.y : -5000, z: l.z, heading: l.heading, grade: l.grade, altitude: l.y, distance: 0 };
      }}
      getCadence={() => (last.current.idle || last.current.v < 0.3 ? 0 : 86)}
      getSpeed={() => last.current.v}
    />
  );
}

// ---------- freccia della svolta ----------

function TurnArrow({ nextTurn }: { nextTurn: WorldSceneProps['nextTurn'] }) {
  const ref = useRef<THREE.Group>(null);
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 2.2);
    s.lineTo(1.6, 0.4);
    s.lineTo(0.6, 0.4);
    s.lineTo(0.6, -1.6);
    s.lineTo(-0.6, -1.6);
    s.lineTo(-0.6, 0.4);
    s.lineTo(-1.6, 0.4);
    s.closePath();
    const g = new THREE.ShapeGeometry(s);
    // la freccia distesa sulla strada, punta verso +z locale
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = nextTurn();
    if (!t) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(t.x, t.y + 2.6 + Math.sin(clock.elapsedTime * 3) * 0.25, t.z);
    g.rotation.set(0, t.heading, 0);
  });
  return (
    <group ref={ref} visible={false}>
      <mesh geometry={geo} rotation={[-0.5, 0, 0]}>
        <meshBasicMaterial color="#c8f031" side={THREE.DoubleSide} transparent opacity={0.92} depthTest={false} fog={false} />
      </mesh>
    </group>
  );
}

// ---------- camera ----------

/** Camera alle spalle. Fuori resta sopra il terreno; in galleria resta sotto la volta. */
function WorldCam({ engine, path, field, playerPose }: WorldSceneProps) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3());
  const heading = useRef<number | null>(null);
  const place = (dt: number) => {
    const pose = playerPose();
    if (heading.current == null) heading.current = pose.heading;
    let dh = pose.heading - heading.current;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    heading.current += dh * (1 - Math.exp(-Math.min(1, dt) * 2.6));
    const h = heading.current;
    const at = path.edgeAt(engine.distance);
    const e = path.graph.edges[at.edge];
    const covered = (e.flags & FLAG.tunnel) !== 0;
    const raised = (e.flags & FLAG.bridge) !== 0;
    const back = covered ? 6 : 8.5;
    desired.current.set(pose.x - Math.sin(h) * back, pose.y + (covered ? 2.2 : 3.1), pose.z - Math.cos(h) * back);
    if (!covered && !raised) {
      const ground = field.height(desired.current.x, desired.current.z, 4);
      desired.current.y = Math.max(desired.current.y, ground + 1.8);
    }
    const k = 1 - Math.exp(-Math.min(1, dt) * 4);
    camera.position.lerp(desired.current, k);
    if (covered) camera.position.y = Math.min(Math.max(camera.position.y, pose.y + 1.4), pose.y + e.hw + 0.6);
    else if (!raised) {
      const groundNow = field.height(camera.position.x, camera.position.z, 4);
      if (camera.position.y < groundNow + 1.5) camera.position.y = groundNow + 1.5;
    }
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

export type { Dir };
