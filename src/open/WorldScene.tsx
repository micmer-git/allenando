import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackPose } from '@/domain/track';
import type { Quality } from '@/domain/types';
import type { RideEngine } from '@/sim/engine';
import { asphaltTexture, smoothNoise } from '@/world/builders';
import { groundLook, LARCH_PALETTE, lookContext, lookFor, type LookCtx, type WorldLook } from './look';
import { patchRockShader } from './rockShader';
import { Lifts } from './Lifts';
import { Passi } from './Passi';
import { Gate, Rider, bannerTexture, canvasTex } from '@/world/Scene';
import { FLAG, type Dir } from './graph';
import type { WorldField } from './field';
import type { NpcCrowd } from './npc';
import { NPC_JERSEYS } from './npc';
import { lookFromColor, type Look } from '@/game/look';
import { buildingsJob, furnitureJob, railsGeometry, roadsJob, terrainJob, treesJob, waterGeometry, type BuildingMeshes, type TileMeshes, type TileSpec, type TreeKind } from './tiles';
import { facadeTexture, groundDetailTexture, roofTilesTexture } from './textures';
import { atmosphere, CLEAR, sunFor, sunVector, type Daytime } from './sky';
import type { WeatherNow } from './weather';
import { loadBuildings, type Building, type RideDef, type Terrain, type WorldData } from './world';
import { WorldPath } from './path';
import { createFarMask, patchFarShader, updateFarMask, type FarMask } from './farMask';
import { createTunnelCut, patchTerrainShader, updateTunnelCut, type TunnelCut } from './tunnels';
import type { ArchSpec } from '@/game/arches';
import { Arches } from '@/world/Arches';
import { HairpinSigns, hairpinSigns } from '@/world/HairpinSigns';
import { findHairpins } from '@/domain/geo';
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
import { Monumenti } from './MonumentiScene';
import { StatsProbe, statsWanted, type TileCounts } from './StatsProbe';
import { Declutter, Labels, Landmarks, type Occluders } from './WorldLabels';
import { boxVolume, volumeOf, type Volume } from './labels';
import { monumentiPronti } from './monumenti';
import { loadProgress, READY_RADIUS, readyReason, tileDist, tileStage } from './pronto';
import { URBAN_R, urbanDensity } from './urban';

/**
 * Per qualità: lato e anelli delle mattonelle, passo del terreno, alberi per cella di bosco e il
 * tetto degli alberi con le geometrie piene (`nearTrees`, i più vicini al ciclista: gli altri hanno
 * la chioma povera, 4-8 triangoli e niente tronco).
 */
const QUALITY = {
  low: { tile: 500, ring: 2, spacing: 16, trees: 0.9, nearTrees: 900, far: 6000, farStride: 2, npcs: 6, dpr: 1 as number | [number, number] },
  medium: { tile: 500, ring: 3, spacing: 10, trees: 1.6, nearTrees: 2200, far: 9000, farStride: 1, npcs: 10, dpr: [1, 1.25] as [number, number] },
  high: { tile: 500, ring: 4, spacing: 8, trees: 2.4, nearTrees: 3600, far: 13000, farStride: 1, npcs: 14, dpr: [1, 1.6] as [number, number] },
} satisfies Record<Quality, unknown>;

export function npcCount(quality: Quality): number {
  return QUALITY[quality].npcs;
}

/**
 * La qualità per questo mondo: nei mondi di montagna (look.ringExtra) un anello di mattonelle in
 * più, perché le pareti si vedono da 5 km e devono entrare prima; e il terreno lontano non si
 * dimezza (look.farFine), perché l'orizzonte è il punto.
 */
export function qualityFor(quality: Quality, look: WorldLook): (typeof QUALITY)[Quality] {
  const q = QUALITY[quality];
  return { ...q, ring: q.ring + look.ringExtra, farStride: look.farFine ? 1 : q.farStride };
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
  /**
   * Avanzamento del caricamento del mondo intorno al ciclista, da 0 a 1 (il velo della corsa):
   * il terreno lontano e le mattonelle entro READY_RADIUS. Arriva a 1 insieme a onReady.
   */
  onProgress?: (p: number) => void;
  /** meteo vero (null: sereno) e ora del giorno */
  weather: WeatherNow | null;
  daytime: Daytime;
  /** il percorso scelto, per i cartelli dei km e gli archi */
  ride: RideDef | null;
  /** archi e cartelli dei traguardi (volata, GPM, crono), calcolati dal gioco */
  arches?: ArchSpec[];
  /** quello che indossi nel garage */
  look?: Look;
  /** il tuo fantasma (src/game/ghosts.ts): la sua posa adesso, null quando non c'è */
  ghost?: () => TrackPose | null;
  /**
   * Ciclisti in più, disegnati come il giocatore (`ghost: true` lo fa trasparente).
   * La posa si legge a ogni fotogramma; null lo nasconde.
   */
  extraRiders?: ExtraWorldRider[];
}

export interface ExtraWorldRider {
  id: string;
  pose: () => TrackPose | null;
  ghost?: boolean;
  look?: Look;
  /** velocità (m/s) e cadenza, per le gambe; senza, pedala piano */
  speed?: () => number;
  cadence?: () => number;
}

export function WorldScene(props: WorldSceneProps) {
  const q = qualityFor(props.quality, lookFor(props.data.graph.id));
  // le mattonelle contate da NearTiles: le leggono il «pronto», l'avanzamento e le misure (?stats=1)
  const counts = useMemo<TileCounts>(() => ({ ready: 0, pending: 0, detail: 0, near: 0, nearReady: 0, nearPartial: 0, late: 0, lateMin: -1 }), []);
  const status = useMemo<LoadStatus>(() => ({ ready: false }), []);
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
      <WorldContent {...props} counts={counts} status={status} />
      <ReadyWhenTiles onReady={props.onReady} onProgress={props.onProgress} counts={counts} status={status} terrain={props.terrain} playerPose={props.playerPose} />
    </Canvas>
  );
}

/** Lo stato del caricamento, condiviso fra il «pronto» e le mattonelle. */
interface LoadStatus {
  ready: boolean;
}

/**
 * Il tetto: dopo READY_TIMEOUT ms si dice «pronto» comunque (meglio un mondo a metà che un velo per
 * sempre). Prima solo per un errore (una mattonella del DEM o il terreno lontano che non arrivano).
 * Un caricamento lento non è un errore: su un telefono lento il velo dura di più, e dietro non c'è
 * un mondo vuoto.
 */
const READY_TIMEOUT = 60000;

/**
 * «Pronto» vuol dire che intorno al ciclista c'è il mondo: il terreno lontano e tutte le mattonelle
 * entro READY_RADIUS (suolo, strade, case) sono in scena. Prima, l'avanzamento va al velo.
 */
function ReadyWhenTiles({
  onReady,
  onProgress,
  counts,
  status,
  terrain,
  playerPose,
}: {
  onReady: () => void;
  onProgress?: (p: number) => void;
  counts: TileCounts;
  status: LoadStatus;
  terrain: Terrain;
  playerPose: () => TrackPose;
}) {
  const sent = useRef(false);
  const t0 = useRef<number | null>(null);
  const shown = useRef(-1);
  useFrame(() => {
    if (sent.current) return;
    const now = performance.now();
    if (t0.current == null) t0.current = now;
    const far = terrain.farHeights ? 1 : 0;
    const p = loadProgress(counts, far === 1);
    // a scatti di 2 punti, e mai indietro: chi disegna il velo non ridisegna a ogni fotogramma
    if (p < 1 && p - shown.current >= 0.02) {
      shown.current = p;
      onProgress?.(p);
    }
    const pose = playerPose();
    const error = terrain.farFailed || terrain.failedAround(pose.x, pose.z, READY_RADIUS + 100);
    const reason = readyReason(p, error, now - t0.current, READY_TIMEOUT);
    if (reason) {
      sent.current = true;
      status.ready = true;
      // per il collaudo (?stats=1): com'era il mondo intorno nell'istante del «pronto»
      if (statsWanted()) window.__orobiaReady = { reason, ms: Math.round(now - t0.current), near: counts.near, nearReady: counts.nearReady };
      onProgress?.(1);
      onReady();
    }
  });
  return null;
}

function WorldContent(props: WorldSceneProps & { counts: TileCounts; status: LoadStatus }) {
  const { data, field, terrain, quality } = props;
  // l'aspetto del mondo e la stagione di oggi (look.ts): roccia, neve, bosco, case
  const ctx = useMemo(() => lookContext(data.graph.id), [data]);
  const q = qualityFor(quality, ctx.look);
  // le mattonelle vicine possono essere fino a ring + 1 dal centro: tante per lato nella maschera
  const farMask = useMemo(() => createFarMask(2 * q.ring + 3), [q.ring]);
  useEffect(() => () => farMask.uReady.value.dispose(), [farMask]);
  // il terreno che entra nelle gallerie vicine non si disegna (tunnels.ts)
  const cut = useMemo(() => createTunnelCut(), []);
  const mats = useMaterials(farMask, cut, ctx.look);
  const names = useMemo(() => new Set<THREE.Sprite>(), []);
  const { counts } = props;
  // le case e i monumenti intorno al ciclista: coprono i nomi (WorldLabels)
  const occluders = useMemo<Occluders>(() => ({ list: [] }), []);
  const stats = useMemo(() => statsWanted(), []);
  return (
    <group>
      {stats ? <StatsProbe tiles={() => ({ ...counts, treesNear: treeCount.near, treesFar: treeCount.far })} /> : null}
      <Atmosphere weather={props.weather} daytime={props.daytime} data={data} far={q.far} mats={mats} />
      {props.weather && props.weather.rain >= 0.1 ? <Rain mmh={props.weather.rain} weather={props.weather} /> : null}
      <FarTerrain terrain={terrain} stride={q.farStride} material={mats.far} ctx={ctx} />
      <NearTiles {...props} mats={mats} mask={farMask} cut={cut} occluders={occluders} ctx={ctx} />
      <Lakes data={data} />
      <Walls data={data} field={field} />
      <Lifts data={data} terrain={terrain} playerPose={props.playerPose} />
      <Passi data={data} field={field} playerPose={props.playerPose} />
      <Monumenti playerPose={props.playerPose} />
      <Labels data={data} playerPose={props.playerPose} names={names} />
      <Landmarks data={data} playerPose={props.playerPose} names={names} />
      <Declutter names={names} terrain={terrain} playerPose={props.playerPose} occluders={occluders} />
      {props.ride ? <RideSigns data={data} ride={props.ride} /> : null}
      <PlayerRider {...props} />
      <ContactShadow playerPose={props.playerPose} />
      {props.extraRiders?.map((r) => (
        <ExtraRider key={r.id} rider={r} />
      ))}
      <NpcRiders crowd={props.crowd} />
      {props.ghost ? <GhostRider pose={props.ghost} /> : null}
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

function useMaterials(mask: FarMask, cut: TunnelCut, look: WorldLook) {
  const mats = useMemo(() => {
    const asphaltTex = asphaltTexture();
    const stoneTex = settTexture();
    // le facciate: persiane verdi e balconcini in Lombardia, legno e balconi a tutta facciata nei paesi ladini
    const facadeTex = facadeTexture(look.case);
    const tilesTex = roofTilesTexture();
    const groundTex = groundDetailTexture();
    const far = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 6 });
    far.onBeforeCompile = (shader) => {
      patchFarShader(shader, mask);
      patchRockShader(shader, look.rock.bands);
    };
    return {
      far,
      terrain: terrainMaterial(groundTex, cut, look.rock.bands),
      asphalt: new THREE.MeshLambertMaterial({ map: asphaltTex, color: '#c9cbd0', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      stone: new THREE.MeshLambertMaterial({ map: stoneTex, color: '#d8cfc2', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      cycle: new THREE.MeshLambertMaterial({ map: asphaltTex, color: '#c98f7d', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      paint: new THREE.MeshLambertMaterial({ color: '#efeee6', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      verge: new THREE.MeshLambertMaterial({ color: '#8f8574', side: THREE.DoubleSide }),
      concrete: new THREE.MeshLambertMaterial({ color: '#b3b1aa', side: THREE.DoubleSide }),
      /** dentro le gallerie la luce è cotta nei colori (tunnels.ts): niente sole sotto il monte */
      tunnel: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      tunnelRoad: new THREE.MeshBasicMaterial({ map: asphaltTex, color: '#b9bbc0', vertexColors: true, side: THREE.DoubleSide }),
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
  }, [mask, cut, look]);
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

/** Il terreno vicino: colori di vertice, la grana, il taglio dentro le gallerie, le bande della roccia. */
function terrainMaterial(map: THREE.Texture, cut: TunnelCut, bands: number): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, map });
  m.onBeforeCompile = (shader) => {
    patchTerrainShader(shader, cut);
    patchRockShader(shader, bands);
  };
  return m;
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
  const appliedAlt = useRef(0);
  const apply = () => {
    const s = sunFor(daytime, new Date(), data.graph.origin.lat, data.graph.origin.lon);
    const look = weather ?? CLEAR;
    // il cielo di chi guarda da quassù: a 2000 m più scuro e saturo, l'aria più tersa
    appliedAlt.current = camera.position.y;
    const a = atmosphere(s, look, camera.position.y);
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
    // ogni 30 s, o quando si è saliti (o scesi) di 250 m: il cielo cambia con la quota
    if (clock.current > 30 || (clock.current > 2 && Math.abs(camera.position.y - appliedAlt.current) > 250)) {
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

/**
 * Il terreno lontano (far.bin): la stessa regola roccia/prato/neve delle mattonelle (look.ts), le
 * normali vere così il sole lo ombreggia (le pareti a nord scure, quelle al sole chiare) e
 * l'attributo `rock` per le bande. Il passo lo decide il build del mondo (120 m per le Dolomiti,
 * 250 per Bergamo): qui si legge `graph.far.step`.
 */
function FarTerrain({ terrain, stride, material, ctx }: { terrain: Terrain; stride: number; material: THREE.Material; ctx: LookCtx }) {
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
      const rock = new Float32Array(pos.count);
      const c = new THREE.Color();
      const noiseStep = Math.max(90, f.step * stride * 0.8);
      for (let k = 0; k < pos.count; k++) {
        const g = groundLook(c, ctx.look, ctx.season, pos.getY(k), nrm.getY(k), nrm.getZ(k), smoothNoise(pos.getX(k) / noiseStep, pos.getZ(k) / noiseStep), 0);
        rock[k] = g.rock;
        c.toArray(col, k * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('rock', new THREE.BufferAttribute(rock, 1));
      const old = mesh.current.geometry;
      mesh.current.geometry = geo;
      old.dispose();
    });
    return () => {
      alive = false;
      mesh.current?.geometry.dispose();
    };
  }, [terrain, stride, ctx]);
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
  /** la mattonella è entrata del tutto (dissolvenza finita): sotto, il terreno lontano si nasconde */
  shown: boolean;
  /** passi fatti del lavoro della mattonella e di quello dell'arredo (l'avanzamento del velo) */
  steps: number;
  dsteps: number;
  /** e il suo arredo vicino */
  dshown: boolean;
  /** il bosco fitto delle mattonelle intorno al ciclista */
  dense: 'none' | 'build' | 'ready';
  xjob: Generator<void, TileMeshes['trees'], void> | null;
}

function NearTiles(props: WorldSceneProps & { mats: Mats; mask: FarMask; cut: TunnelCut; counts: TileCounts; status: LoadStatus; occluders: Occluders; ctx: LookCtx }) {
  const { data, field, terrain, quality, mats, mask, cut, playerPose, counts, status, occluders, ctx } = props;
  /** dove e con quante liste di case si sono raccolti gli ultimi volumi che coprono i nomi */
  const occAt = useRef({ x: Infinity, z: Infinity, lists: -1, mon: -1 });
  const q = qualityFor(quality, ctx.look);
  const root = useRef<THREE.Group>(null);
  const tiles = useRef(new Map<string, TileEntry>());
  const buildings = useRef(new Map<string, Building[] | Promise<Building[]>>());
  const forest = useRef<ForestHandle | null>(null);
  const roadside = useRef<RoadsideHandle | null>(null);
  const center = useRef<[number, number] | null>(null);
  const dirtyTrees = useRef(false);
  /** l'arredo piccolo (paletti, cartelli, semafori) si rifà anche quando il centro si sposta */
  const dirtyProps = useRef(false);
  const riderTile = useRef<[number, number] | null>(null);
  /** le mattonelle (e l'arredo) che stanno entrando in dissolvenza */
  const fades = useRef<Fade[]>([]);
  const T = q.tile;
  const b = data.graph.bounds;

  useEffect(() => {
    const map = tiles.current;
    const grp = root.current;
    const fading = fades.current;
    return () => {
      for (const f of fading) endFade(f);
      fading.length = 0;
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
    return buildingsAt(dx0, dz0);
  }

  function buildingsAt(dx0: number, dz0: number): Building[] | null {
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

  /** Le case di tutte le mattonelle del DEM che toccano il rettangolo, o null se ne manca ancora qualcuna. */
  function buildingsAround(x0: number, z0: number, x1: number, z1: number): Building[][] | null {
    const [a0, b0] = terrain.tileOf(x0, z0);
    const [a1, b1] = terrain.tileOf(x1, z1);
    const out: Building[][] = [];
    let ok = true;
    for (let i = a0; i <= a1; i++) {
      for (let j = b0; j <= b1; j++) {
        if (!terrain.inBounds(i, j)) continue;
        const list = buildingsAt(i, j);
        if (list) out.push(list);
        else ok = false;
      }
    }
    return ok ? out : null;
  }

  function* tileJob(entry: TileEntry, spec: TileSpec): Generator<void, void, void> {
    // prima le case (anche delle mattonelle del DEM vicine): dicono dove il suolo è città
    let near: Building[][] | null = null;
    while (!(near = buildingsAround(spec.x0 - URBAN_R, spec.z0 - URBAN_R, spec.x0 + T + URBAN_R, spec.z0 + T + URBAN_R))) yield;
    const urban = urbanDensity(near, spec.x0, spec.z0, spec.x0 + T, spec.z0 + T, URBAN_R);
    const terrainGeo = yield* terrainJob(field, spec, urban, ctx);
    const roads = yield* roadsJob(data.graph, field, spec);
    let bGeo: BuildingMeshes = { walls: null, roofs: null };
    for (;;) {
      const list = buildingsFor(spec);
      if (list) {
        bGeo = yield* buildingsJob(field, list, spec, ctx);
        break;
      }
      yield;
    }
    const trees = yield* treesJob(field, spec, 0, false, ctx);
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
    add(roads.tunnelRoad, mats.tunnelRoad);
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
    fades.current.push(startFade(g, entry, 'detail'));
    entry.items = street.items;
    if (street.trees.length) entry.trees = [...entry.trees, ...street.trees];
  }

  useFrame((_, dt) => {
    const pose = playerPose();
    // il centro sta un po' avanti: si vede più strada davanti che dietro
    const ax = pose.x + Math.sin(pose.heading) * T * 0.4;
    const az = pose.z + Math.cos(pose.heading) * T * 0.4;
    const cx = Math.floor((ax - b.x0) / T);
    const cz = Math.floor((az - b.z0) / T);
    // la mattonella sotto le ruote: l'arredo vicino parte da lì (il centro sta 200 m avanti)
    const rx = Math.floor((pose.x - b.x0) / T);
    const rz = Math.floor((pose.z - b.z0) / T);
    const near = (t: TileEntry) => Math.min(Math.max(Math.abs(t.ix - cx), Math.abs(t.iz - cz)), Math.max(Math.abs(t.ix - rx), Math.abs(t.iz - rz)));
    if (!riderTile.current || riderTile.current[0] !== rx || riderTile.current[1] !== rz) {
      riderTile.current = [rx, rz];
      dirtyProps.current = true;
      // quali mattonelle hanno gli alberi pieni dipende da dove sta il ciclista
      dirtyTrees.current = true;
    }
    const map = tiles.current;
    if (!center.current || center.current[0] !== cx || center.current[1] !== cz) {
      center.current = [cx, cz];
      dirtyProps.current = true;
      for (let dz = -q.ring; dz <= q.ring; dz++) {
        for (let dx = -q.ring; dx <= q.ring; dx++) {
          const ix = cx + dx;
          const iz = cz + dz;
          const key = `${ix}_${iz}`;
          if (!map.has(key)) map.set(key, { key, ix, iz, state: 'wait', job: null, group: null, trees: [], detail: 'none', djob: null, items: null, shown: false, dshown: false, steps: 0, dsteps: 0, dense: 'none', xjob: null });
        }
      }
      for (const [key, t] of map) {
        if (Math.max(Math.abs(t.ix - cx), Math.abs(t.iz - cz)) > q.ring + 1) {
          // una mattonella che se ne va mentre entrava: prima si chiude la dissolvenza
          fades.current = fades.current.filter((f) => {
            if (f.tile !== t) return true;
            endFade(f);
            return false;
          });
          if (t.group) root.current?.remove(t.group);
          disposeGroup(t.group);
          map.delete(key);
          dirtyTrees.current = true;
        }
      }
      // le mattonelle del DEM: prima quelle sotto le ruote (il «pronto» aspetta quelle), poi le altre
      void terrain.around(pose.x, pose.z, READY_RADIUS + 100);
      void terrain.around(pose.x, pose.z, (q.ring + 1.5) * T);
      // e le case, che il suolo delle mattonelle aspetta: si chiedono subito, tutte insieme
      buildingsAround(pose.x - READY_RADIUS - URBAN_R, pose.z - READY_RADIUS - URBAN_R, pose.x + READY_RADIUS + URBAN_R, pose.z + READY_RADIUS + URBAN_R);
      buildingsAround(b.x0 + (cx - q.ring) * T - URBAN_R, b.z0 + (cz - q.ring) * T - URBAN_R, b.x0 + (cx + q.ring + 1) * T + URBAN_R, b.z0 + (cz + q.ring + 1) * T + URBAN_R);
      terrain.prune(pose.x, pose.z, (q.ring + 3) * T);
    }
    // un lavoro alla volta, il più vicino, per non più di 6 ms a fotogramma; mentre si carica
    // il velo copre la scena e un fotogramma lento non si vede: 24 ms
    const t0 = performance.now();
    // e su un telefono lento (fotogrammi lunghi) almeno tre quarti del fotogramma: altrimenti il
    // caricamento va a passo di fotogramma, e con il velo davanti non serve disegnare in fretta
    const budget = status.ready ? 6 : Math.min(400, Math.max(24, dt * 750));
    let guard = 0;
    while (performance.now() - t0 < budget && guard++ < (status.ready ? 80 : 600)) {
      let job: TileEntry | null = null;
      let best = Infinity;
      let kind: 'tile' | 'detail' | 'dense' = 'tile';
      for (const t of map.values()) {
        const d = Math.max(Math.abs(t.ix - cx), Math.abs(t.iz - cz));
        if (t.state === 'ready') {
          // l'arredo vicino: entro due anelli, dopo le mattonelle che mancano ancora alla stessa distanza
          if (t.detail === 'build') {
            job = t;
            kind = 'detail';
            break;
          }
          if (t.dense === 'build') {
            job = t;
            kind = 'dense';
            break;
          }
          const dn = near(t);
          if (t.detail === 'none' && dn <= DETAIL_RING && dn + 0.5 < best) {
            best = dn + 0.5;
            job = t;
            kind = 'detail';
          } else if (t.detail === 'ready' && t.dense === 'none' && dn <= DENSE_RING && dn + 0.6 < best) {
            // e il bosco fitto, dopo l'arredo
            best = dn + 0.6;
            job = t;
            kind = 'dense';
          }
          continue;
        }
        if (t.state === 'build') {
          job = t;
          kind = 'tile';
          break;
        }
        // si comincia solo quando il DEM sotto la mattonella (e il bordo) è arrivato
        const spec = specOf(t.ix, t.iz, d);
        const [a0, b0] = terrain.tileOf(spec.x0 - 60, spec.z0 - 60);
        const [a1, b1] = terrain.tileOf(spec.x0 + T + 60, spec.z0 + T + 60);
        let ok = true;
        for (let i = a0; i <= a1 && ok; i++) for (let j = b0; j <= b1 && ok; j++) if (terrain.inBounds(i, j) && !terrain.has(i, j)) ok = false;
        if (!ok) continue;
        // prima le mattonelle entro READY_RADIUS dal ciclista, poi le altre dal centro in fuori
        const k = tileDist(t, b.x0, b.z0, T, pose.x, pose.z) <= READY_RADIUS ? -1 : d;
        if (k < best) {
          best = k;
          job = t;
          kind = 'tile';
        }
      }
      if (!job) break;
      if (kind === 'dense') {
        if (job.dense === 'none') {
          job.xjob = treesJob(field, { ...specOf(job.ix, job.iz, 0), trees: q.trees * DENSE_EXTRA }, 7.3, true, ctx);
          job.dense = 'build';
        }
        const r = job.xjob!.next();
        if (r.done) {
          job.dense = 'ready';
          job.xjob = null;
          if (r.value.length) job.trees = [...job.trees, ...r.value];
          dirtyTrees.current = true;
        }
        continue;
      }
      if (kind === 'detail') {
        if (job.detail === 'none') {
          const d = Math.max(Math.abs(job.ix - cx), Math.abs(job.iz - cz));
          job.djob = detailJob(job, specOf(job.ix, job.iz, d));
          job.detail = 'build';
        }
        job.dsteps++;
        const r = job.djob!.next();
        if (r.done) {
          job.detail = 'ready';
          job.djob = null;
          if (status.ready) noteLate(counts, tileDist(job, b.x0, b.z0, T, pose.x, pose.z));
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
      job.steps++;
      const r = job.job!.next();
      if (r.done) {
        job.state = 'ready';
        job.job = null;
        if (job.group) {
          root.current?.add(job.group);
          fades.current.push(startFade(job.group, job, 'tile'));
        }
        dirtyTrees.current = true;
        if (status.ready) noteLate(counts, tileDist(job, b.x0, b.z0, T, pose.x, pose.z));
      }
    }
    countTiles(counts, map, b.x0, b.z0, T, pose.x, pose.z, terrain);
    // i volumi che coprono i nomi: ogni 25 m, o quando arrivano case o monumenti nuovi
    {
      const o = occAt.current;
      let lists = 0;
      for (const v of buildings.current.values()) if (Array.isArray(v)) lists++;
      const mon = monumentiPronti().length;
      if (Math.hypot(pose.x - o.x, pose.z - o.z) > 25 || lists !== o.lists || mon !== o.mon) {
        occAt.current = { x: pose.x, z: pose.z, lists, mon };
        occluders.list = nearVolumes(buildings.current, monumentiPronti(), terrain, pose.x, pose.z, OCC_R);
      }
    }
    updateTunnelCut(cut, data.graph, pose.x, pose.z);
    // il terreno lontano si nasconde sotto ogni mattonella pronta (farMask.ts)
    // le dissolvenze: 300 ms, poi i materiali condivisi tornano al loro posto
    if (fades.current.length) {
      const now = performance.now();
      fades.current = fades.current.filter((f) => {
        const k = (now - f.t0) / FADE_MS;
        if (k < 1) {
          f.group.position.y = -RISE_M * (1 - k) * (1 - k);
          return true;
        }
        endFade(f);
        if (f.part === 'tile') f.tile.shown = true;
        else f.tile.dshown = true;
        return false;
      });
    }
    updateFarMask(mask, b.x0, b.z0, T, cx, cz, (ix, iz) => !!map.get(`${ix}_${iz}`)?.shown);
    if (dirtyTrees.current && forest.current) {
      dirtyTrees.current = false;
      const all: ForestPatch[] = [];
      for (const t of map.values()) if (t.state === 'ready') all.push({ trees: t.trees, near: near(t) <= DENSE_RING });
      forest.current.set(all, pose.x, pose.z, q.nearTrees);
    }
    if (dirtyProps.current && roadside.current) {
      dirtyProps.current = false;
      // solo le mattonelle intorno al ciclista: a più di un anello un paletto è meno di un pixel
      const list: RoadsideItems[] = [];
      for (const t of map.values()) if (t.items && near(t) <= PROP_RING) list.push(t.items);
      roadside.current.set(list);
    }
  });

  return (
    <group>
      <group ref={root} />
      <Forest handle={forest} mats={mats} larch={LARCH_PALETTE[ctx.season.larch]} />
      <Roadside handle={roadside} mats={mats} />
    </group>
  );
}

/** Fin dove case e monumenti possono coprire un nome, metri dal ciclista. */
const OCC_R = 120;

/** Il riquadro delle case già lette, per non ricalcolarlo a ogni giro. */
const bboxOf = new WeakMap<Building, [number, number, number, number]>();

/** Case e monumenti entro `r` da (x, z), come volumi che coprono la vista. */
function nearVolumes(lists: Map<string, Building[] | Promise<Building[]>>, mons: readonly { x: number; z: number; w: number; d: number; yaw: number; yMin: number; y: number; h: number }[], terrain: Terrain, x: number, z: number, r: number): Volume[] {
  const out: Volume[] = [];
  // solo le liste delle mattonelle del DEM che toccano il quadrato intorno
  const [a0, b0] = terrain.tileOf(x - r, z - r);
  const [a1, b1] = terrain.tileOf(x + r, z + r);
  for (let i = a0; i <= a1; i++) for (let j = b0; j <= b1; j++) {
    const list = lists.get(`${i}_${j}`);
    if (!Array.isArray(list)) continue;
    for (const bd of list) {
      let bb = bboxOf.get(bd);
      if (!bb) {
        const v = volumeOf(bd.ring, 0, 0);
        bb = [v.minX, v.minZ, v.maxX, v.maxZ];
        bboxOf.set(bd, bb);
      }
      if (bb[2] < x - r || bb[0] > x + r || bb[3] < z - r || bb[1] > z + r) continue;
      const ground = terrain.height((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2);
      out.push(volumeOf(bd.ring, ground - 3, ground + Math.max(3, bd.h) + 1));
    }
  }
  for (const m of mons) {
    if (Math.abs(m.x - x) > r + m.w || Math.abs(m.z - z) > r + m.d) continue;
    out.push(boxVolume(m.x, m.z, m.w, m.d, m.yaw, m.yMin - 1, m.y + m.h));
  }
  return out;
}

/** Sotto questa distanza, una mattonella o il suo arredo che entra in scena dopo il «pronto» si vede comparire. */
const POP_NEAR = 150;

/** Una mattonella (o il suo arredo) entrata in scena dopo il «pronto»: per le misure del pop-in. */
function noteLate(c: TileCounts, d: number): void {
  if (d < POP_NEAR) c.late++;
  if (c.lateMin < 0 || d < c.lateMin) c.lateMin = Math.round(d);
}

/** Conta le mattonelle in scena, in attesa, e quelle entro READY_RADIUS dal ciclista. */
function countTiles(c: TileCounts, map: Map<string, TileEntry>, x0: number, z0: number, T: number, px: number, pz: number, terrain: Terrain): void {
  c.ready = 0;
  c.pending = 0;
  c.detail = 0;
  c.near = 0;
  c.nearReady = 0;
  c.nearPartial = 0;
  for (const t of map.values()) {
    if (t.state === 'ready') c.ready++;
    else c.pending++;
    if (t.detail === 'ready') c.detail++;
    if (tileDist(t, x0, z0, T, px, pz) <= READY_RADIUS) {
      c.near++;
      // in scena davvero: la mattonella e il suo arredo, salita finita (startFade)
      if (t.shown && t.dshown) c.nearReady++;
      const [dx, dz] = terrain.tileOf(x0 + (t.ix + 0.5) * T, z0 + (t.iz + 0.5) * T);
      c.nearPartial += tileStage(t, terrain.has(dx, dz));
    }
  }
}

/** Quanto dura l'entrata di una mattonella o del suo arredo, millisecondi. */
const FADE_MS = 300;
/** Da quanto sotto sale: abbastanza da stare sotto il terreno lontano, che la copre finché non arriva. */
const RISE_M = 8;

interface Fade {
  group: THREE.Group;
  tile: TileEntry;
  /** la mattonella o il suo arredo */
  part: 'tile' | 'detail';
  t0: number;
}

/**
 * Una mattonella (o il suo arredo) entra in scena salendo da sotto il terreno lontano in 300 ms,
 * invece di comparire di colpo: il terreno lontano resta finché non è arrivata. Niente trasparenza
 * (alphaHash): voleva un programma in più per ogni materiale, e con la grafica software il «pronto»
 * arrivava 20 s dopo.
 */
function startFade(group: THREE.Group, tile: TileEntry, part: Fade['part']): Fade {
  group.position.y = -RISE_M;
  return { group, tile, part, t0: performance.now() };
}

function endFade(f: Fade): void {
  f.group.position.y = 0;
}

function disposeGroup(g: THREE.Group | null): void {
  if (!g) return;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.geometry.userData.shared) o.geometry.dispose();
  });
}

// ---------- bosco: un'istanza per specie per tutto il mondo vicino ----------

interface ForestHandle {
  /** gli alberi di tutte le mattonelle; i più vicini a (px, pz), al più `cap`, con le geometrie piene */
  set(list: ForestPatch[], px: number, pz: number, cap: number): void;
}

const TREE_COLORS: Record<TreeKind, string[]> = {
  spruce: ['#24452c', '#2c5233', '#1f3d29'],
  larch: ['#5b7a3a', '#6b8a40', '#4f6e35'],
  broadleaf: ['#4f7d36', '#5f8c3c', '#6d9443', '#577f33'],
  cypress: ['#2f4a2a', '#34512d'],
  rock: ['#8b877f', '#7a766f', '#9b968c'],
};

/** Una corona di latifoglia: due sfere basse fuse e sfalsate, non un icosaedro solo (40 triangoli). */
function broadleafCrown(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [
    [0, 5.4, 0.2, 2.8],
    [-0.9, 6.5, -0.5, 2.1],
  ];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 0.82, 1);
    g.translate(x, y, z);
    parts.push(g);
  }
  const out = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return out;
}

/** Un abete a due palchi, aperto sotto: più abete di un cono solo, con pochi triangoli in più. */
function spruceTiers(): THREE.BufferGeometry {
  const a = new THREE.ConeGeometry(2.3, 6, 7, 1, true);
  a.translate(0, 5.2, 0);
  const b = new THREE.ConeGeometry(1.6, 5, 7, 1, true);
  b.translate(0, 8.4, 0);
  const out = mergeGeometries([a, b], false)!;
  a.dispose();
  b.dispose();
  return out;
}

/**
 * Le chiome lontane: quattro facce bastano, e il tronco non si vede. Abeti, larici e cipressi
 * lontani sono un'istanza sola (un cono, allargato o stretto per specie: FAR_CONE), le latifoglie
 * un ottaedro: due chiamate di disegno per tutto il bosco lontano.
 */
function farGeometries(): { conifer: THREE.BufferGeometry; broadleaf: THREE.BufferGeometry } {
  const conifer = new THREE.ConeGeometry(2.2, 9.5, 4, 1, true);
  conifer.translate(0, 6.1, 0);
  const broadleaf = new THREE.OctahedronGeometry(3.2, 0);
  broadleaf.scale(1, 0.9, 1);
  broadleaf.translate(0, 5.6, 0);
  return { conifer, broadleaf };
}

/** Larghezza e altezza del cono lontano per specie, rispetto all'abete. */
const FAR_CONE: Partial<Record<TreeKind, [number, number]>> = { spruce: [1, 1], larch: [2.4 / 2.2, 8 / 9.5], cypress: [0.5, 1.05] };

/** La chiave dell'istanza di un albero: piena per specie, lontana per forma (i sassi sono sempre pieni). */
function treeKey(kind: TreeKind, full: boolean): string {
  if (full || kind === 'rock') return `${kind}:n`;
  return kind === 'broadleaf' ? 'broadleaf:f' : 'conifer:f';
}

/** Gli alberi in scena con le geometrie piene e con quelle povere (per le misure, ?stats=1). */
export const treeCount = { near: 0, far: 0 };

/** Gli alberi di una mattonella, e se la mattonella è vicina (geometrie piene) o lontana (povere). */
interface ForestPatch {
  trees: TileMeshes['trees'];
  near: boolean;
}

/** `larch`: i colori del larice nella stagione di oggi (look.ts: d'oro in ottobre e novembre). */
function Forest({ handle, mats, larch }: { handle: React.MutableRefObject<ForestHandle | null>; mats: Mats; larch: string[] }) {
  const group = useRef<THREE.Group>(null);
  const geos = useMemo(() => {
    const larch = new THREE.ConeGeometry(2.4, 8, 6, 1, true);
    larch.translate(0, 6, 0);
    const cypress = new THREE.ConeGeometry(1.1, 10, 6, 1, true);
    cypress.translate(0, 6.2, 0);
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3.2, 5, 1, true);
    trunk.translate(0, 1.4, 0);
    const rock = new THREE.DodecahedronGeometry(1, 0);
    rock.scale(1.3, 0.7, 1);
    const near: Record<TreeKind, THREE.BufferGeometry> = { spruce: spruceTiers(), larch, broadleaf: broadleafCrown(), cypress, rock };
    return { near, far: farGeometries(), trunk };
  }, []);
  const meshes = useRef(new Map<string, THREE.InstancedMesh>());
  useEffect(() => {
    const g = group.current;
    const current = meshes.current;
    const KINDS: TreeKind[] = ['spruce', 'larch', 'broadleaf', 'cypress', 'rock'];
    handle.current = {
      set(patches, px, pz, cap) {
        if (!g) return;
        const by = new Map<string, TileMeshes['trees']>();
        const push = (key: string, t: TileMeshes['trees'][number]) => {
          const l = by.get(key);
          if (l) l.push(t);
          else by.set(key, [t]);
        };
        // le geometrie piene alle mattonelle vicine, e fra i loro alberi ai `cap` più vicini
        const near: TileMeshes['trees'] = [];
        for (const p of patches) for (const t of p.trees) if (p.near) near.push(t);
        let limit = Infinity;
        if (near.length > cap) {
          const d = near.map((t) => (t.x - px) ** 2 + (t.z - pz) ** 2).sort((a, b) => a - b);
          limit = d[cap - 1];
        }
        let nNear = 0;
        let nFar = 0;
        for (const p of patches) {
          for (const t of p.trees) {
            const full = p.near && (t.x - px) ** 2 + (t.z - pz) ** 2 <= limit;
            push(treeKey(t.kind, full), t);
            // il tronco solo vicino: da lontano è meno di un pixel
            if (full && t.kind !== 'rock') push('trunk', t);
            if (full) nNear++;
            else nFar++;
          }
        }
        treeCount.near = nNear;
        treeCount.far = nFar;
        const d = new THREE.Object3D();
        const c = new THREE.Color();
        const make = (key: string, geo: THREE.BufferGeometry, mat: THREE.Material, colored = true) => {
          const old = current.get(key);
          if (old) {
            g.remove(old);
            old.dispose();
            current.delete(key);
          }
          const items = by.get(key) ?? [];
          if (items.length === 0) return;
          const m = new THREE.InstancedMesh(geo, mat, items.length);
          const rock = key.startsWith('rock');
          const cone = key === 'conifer:f';
          items.forEach((it, i) => {
            d.position.set(it.x, it.y, it.z);
            d.rotation.set(rock ? it.tint : 0, it.r, 0);
            // chiome più alte o più tozze, e colori un po' diversi da un albero all'altro
            const tall = rock ? 1 : 0.85 + ((it.tint * 7.31) % 1) * 0.35;
            const [wide, high] = (cone && FAR_CONE[it.kind]) || [1, 1];
            d.scale.set(it.s * wide, it.s * tall * high, it.s * wide);
            d.updateMatrix();
            m.setMatrixAt(i, d.matrix);
            if (colored) {
              const colors = it.kind === 'larch' ? larch : TREE_COLORS[it.kind];
              c.set(colors[Math.floor(it.tint * colors.length) % colors.length]);
              c.offsetHSL(0, (((it.tint * 13.7) % 1) - 0.5) * 0.08, (((it.tint * 29.3) % 1) - 0.5) * 0.07);
              m.setColorAt(i, c);
            }
          });
          m.instanceMatrix.needsUpdate = true;
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          m.frustumCulled = false;
          current.set(key, m);
          g.add(m);
        };
        for (const k of KINDS) make(`${k}:n`, geos.near[k], mats.trees[k]);
        make('conifer:f', geos.far.conifer, mats.trees.spruce);
        make('broadleaf:f', geos.far.broadleaf, mats.trees.broadleaf);
        make('trunk', geos.trunk, mats.trees.trunk, false);
      },
    };
    return () => {
      handle.current = null;
      for (const m of current.values()) m.dispose();
      current.clear();
      Object.values(geos.near).forEach((x) => x.dispose());
      Object.values(geos.far).forEach((x) => x.dispose());
      geos.trunk.dispose();
    };
  }, [handle, geos, mats, larch]);
  return <group ref={group} />;
}

// ---------- arredo stradale: un'istanza per tipo per tutto il mondo vicino ----------

/** Le mattonelle entro questo anello hanno l'arredo vicino. */
const DETAIL_RING = 2;
/** Le mattonelle entro questo anello mostrano l'arredo piccolo (istanze): paletti, cartelli, semafori. */
const PROP_RING = 1;
/** Le mattonelle entro questo anello hanno il bosco fitto e gli alberi con le geometrie piene. */
const DENSE_RING = 1;
/** Quanti alberi in più per cella di bosco nelle mattonelle vicine, rispetto alla qualità. */
const DENSE_EXTRA = 0.9;

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
 * Gli archi passati dal gioco. Solo in sviluppo, `?archlab` mette davanti al ciclista un arco per
 * tipo (traguardi, cassonetto, km, ultimo km, ERG) per vederli senza il gioco (non esiste nella
 * build pubblicata).
 */
function WorldArches({ arches, path, engine }: { arches?: ArchSpec[]; path: WorldPath; engine: RideEngine }) {
  const lab = useMemo<ArchSpec[] | null>(() => {
    if (!import.meta.env.DEV || typeof location === 'undefined' || !new URLSearchParams(location.search).has('archlab')) return null;
    const at = (d: number) => path.poseAt(Math.min(path.length - 1, engine.distance + d));
    const hw = (d: number) => path.graph.edges[path.edgeAt(Math.min(path.length - 1, engine.distance + d)).edge].hw;
    const spec = (id: string, kind: ArchSpec['kind'], role: ArchSpec['role'], label: string, sub: string, d: number, grade?: number): ArchSpec => {
      const p = at(d);
      return { id, kind, role, label, sub, grade, x: p.x, y: p.y, z: p.z, heading: p.heading, halfWidth: hw(d) };
    };
    return [
      spec('lab:a', 'volata', 'start', 'VOLATA', 'Traguardo di Zogno', 28),
      spec('lab:b', 'gpm', 'banner', '500 m', 'GPM', 60),
      spec('lab:c', 'gpm', 'finish', 'GPM', 'Colle di Zambla', 110),
      spec('lab:d', 'crono', 'start', 'CRONO', 'Cronoscalata', 170),
      spec('lab:e', 'cassonetto', 'finish', 'CASSONETTO', 'Cene', 230),
      spec('lab:f', 'km', 'km', '3 km', 'alla vetta', 290, 0.084),
      spec('lab:g', 'ultimo', 'km', 'Ultimo km', 'all’arrivo', 350),
      spec('lab:h', 'erg', 'start', '5′ · 280 W', 'Intervallo', 410),
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

// ---------- cartelli del percorso ----------

/**
 * Sul percorso scelto: l'arco di partenza e quello d'arrivo del tratto cronometrato e, se è una
 * salita, i tornanti numerati. I chilometri sono i portali alla Zwift del gioco (game.arches).
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
    const startTex = bannerTexture(climb ? 'INIZIO SALITA' : 'PARTENZA', ride.name);
    const finishTex = bannerTexture('ARRIVO', ride.name);
    // tornanti numerati sulle salite, contati dall'alto come i cartelli veri (Selvino ne ha venti)
    const pts = path.points;
    // il giro di una rotatoria non è un tornante
    const nearRing = (d: number) => [-40, -20, 0, 20, 40].some((o) => g.isRing(path.edgeAt(Math.min(path.length, Math.max(0, d + o))).edge));
    const bends = climb ? findHairpins(pts.map((p) => p.distance), pts.map((p) => p.heading)).filter((h) => h.distance > from + 20 && h.distance < to - 20 && !nearRing(h.distance)) : [];
    const hairpins = hairpinSigns(bends, (d) => path.poseAt(d), (d) => g.edges[path.edgeAt(d).edge].hw);
    return {
      hairpins,
      start: { pose: path.poseAt(Math.min(path.length, from + 4)), tex: startTex, hw: g.edges[path.edgeAt(from + 4).edge].hw },
      finish: { pose: path.poseAt(Math.max(0, to - 2)), tex: finishTex, hw: g.edges[path.edgeAt(Math.max(0, to - 2)).edge].hw },
    };
  }, [data, ride]);
  useEffect(
    () => () => {
      signs.start.tex.dispose();
      signs.finish.tex.dispose();
    },
    [signs],
  );
  return (
    <group>
      <Gate pose={signs.start.pose} texture={signs.start.tex} hw={signs.start.hw} />
      <Gate pose={signs.finish.pose} texture={signs.finish.tex} hw={signs.finish.hw} />
      <HairpinSigns items={signs.hairpins} />
    </group>
  );
}

// ---------- ciclisti ----------

function PlayerRider({ engine, playerPose, selfColor, look }: WorldSceneProps) {
  return <Rider side={0} look={look ?? (selfColor ? lookFromColor(selfColor) : undefined)} getPose={playerPose} getCadence={() => engine.cadence} getSpeed={() => engine.speed} getPower={() => engine.power} />;
}

/**
 * L'ombra di contatto del ciclista: una macchia morbida sotto le ruote, inclinata con la strada.
 * Lo appoggia sull'asfalto anche col cielo coperto, quando il sole non fa ombre (due triangoli).
 */
function ContactShadow({ playerPose }: { playerPose: () => TrackPose }) {
  const ref = useRef<THREE.Group>(null);
  const { geo, mat } = useMemo(() => {
    const tex = canvasTex(64, 64, (g) => {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(0,0,0,0.85)');
      grd.addColorStop(0.55, 'rgba(0,0,0,0.45)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    });
    const geo = new THREE.PlaneGeometry(0.95, 2.3);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#000000', transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    return { geo, mat };
  }, []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.map?.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const p = playerPose();
    g.position.set(p.x, p.y + 0.06, p.z);
    g.rotation.set(-Math.atan(p.grade), p.heading, 0, 'YXZ');
  });
  return (
    <group ref={ref}>
      <mesh geometry={geo} material={mat} renderOrder={1} />
    </group>
  );
}

/** Un ciclista in più (ExtraWorldRider): fuori scena quando non ha una posa. */
function ExtraRider({ rider }: { rider: ExtraWorldRider }) {
  const hidden: TrackPose = { x: 0, y: -5000, z: 0, heading: 0, grade: 0, altitude: 0, distance: 0 };
  return (
    <Rider
      side={0}
      ghost={rider.ghost}
      look={rider.look}
      detail="media"
      getPose={() => rider.pose() ?? hidden}
      getCadence={() => rider.cadence?.() ?? 80}
      getSpeed={() => rider.speed?.() ?? 6}
    />
  );
}

function NpcRiders({ crowd }: { crowd: NpcCrowd }) {
  return (
    <group>
      {crowd.npcs.map((n) => (
        <Rider
          key={n.slot}
          side={0}
          look={lookFromColor(NPC_JERSEYS[n.slot % NPC_JERSEYS.length], n.slot)}
          detail="media"
          lodDistance={30}
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

const HIDDEN: TrackPose = { x: 0, y: -5000, z: 0, heading: 0, grade: 0, altitude: 0, distance: 0 };

/** Il fantasma del tuo giro migliore: trasparente, sotto terra quando non c'è. */
function GhostRider({ pose }: { pose: () => TrackPose | null }) {
  return <Rider ghost side={0} detail="media" getPose={() => pose() ?? HIDDEN} getCadence={() => 86} getSpeed={() => 6} />;
}

function RemoteRiderView({ rider }: { rider: RemoteWorldRider }) {
  const last = useRef({ x: 0, y: -5000, z: 0, heading: 0, grade: 0, v: 0, idle: true });
  return (
    <Rider
      side={0}
      jersey={rider.color}
      helmet={rider.color}
      detail="media"
      lodDistance={35}
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
        <meshBasicMaterial color="#ffc814" side={THREE.DoubleSide} transparent opacity={0.92} depthTest={false} fog={false} />
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
    // collaudo: scripts/world-shot.mjs con CAM="indietro,su[,lato[,gradi]]" guarda la strada da un
    // altro punto; i gradi girano lo sguardo (negativi a sinistra), per guardare una parete di lato
    const dbg = (globalThis as { __orobiaCam?: number[] }).__orobiaCam;
    if (dbg) {
      const [b0, up, side = 0, yawDeg = 0] = dbg;
      const yaw = pose.heading - (yawDeg * Math.PI) / 180;
      camera.position.set(pose.x - Math.sin(h) * b0 + Math.cos(h) * side, pose.y + up, pose.z - Math.cos(h) * b0 - Math.sin(h) * side);
      // con lo sguardo girato si guarda lontano, un filo verso l'alto: le pareti e le cime, non il ciglio
      const reach = yawDeg ? 300 : 7;
      look.current.set(pose.x + Math.sin(yaw) * reach, yawDeg ? pose.y + up + 20 : pose.y + 1.2, pose.z + Math.cos(yaw) * reach);
      camera.lookAt(look.current);
      return;
    }
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
