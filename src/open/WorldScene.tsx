import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { TrackPose } from '@/domain/track';
import type { Quality } from '@/domain/types';
import type { RideEngine } from '@/sim/engine';
import { asphaltTexture, groundColor, hash2 } from '@/world/builders';
import { Rider, Sky, canvasTex } from '@/world/Scene';
import { FLAG, type Dir } from './graph';
import type { WorldField } from './field';
import type { WorldPath } from './path';
import type { NpcCrowd } from './npc';
import { NPC_JERSEYS } from './npc';
import { buildingsJob, railsGeometry, roadsJob, terrainJob, treesJob, waterGeometry, type TileMeshes, type TileSpec, type TreeKind } from './tiles';
import { loadBuildings, type Building, type Terrain, type WorldData } from './world';

const QUALITY = {
  low: { tile: 500, ring: 2, spacing: 16, trees: 0.9, far: 6000, farStride: 2, npcs: 6, dpr: 1 as number | [number, number] },
  medium: { tile: 500, ring: 3, spacing: 10, trees: 1.6, far: 9000, farStride: 1, npcs: 10, dpr: [1, 1.25] as [number, number] },
  high: { tile: 500, ring: 4, spacing: 8, trees: 2.4, far: 13000, farStride: 1, npcs: 14, dpr: [1, 1.6] as [number, number] },
} satisfies Record<Quality, unknown>;

export function npcCount(quality: Quality): number {
  return QUALITY[quality].npcs;
}

const HAZE = '#cfdbe5';
const SUN: [number, number, number] = [-700, 760, 520];

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
      <hemisphereLight args={['#e6f0fb', '#4f5a3c', 0.62]} />
      <directionalLight position={SUN} intensity={1.85} color="#fff0d6" />
      <Sky />
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
  return (
    <group>
      <FarTerrain terrain={terrain} stride={q.farStride} material={mats.far} />
      <NearTiles {...props} mats={mats} rect={farRect.current} />
      <Lakes data={data} />
      <Walls data={data} field={field} />
      <Labels data={data} engine={props.engine} playerPose={props.playerPose} />
      <Landmarks data={data} playerPose={props.playerPose} />
      <PlayerRider {...props} />
      <NpcRiders crowd={props.crowd} />
      {props.remote.map((r) => (
        <RemoteRiderView key={r.id} rider={r} />
      ))}
      <TurnArrow nextTurn={props.nextTurn} />
      <WorldCam {...props} />
    </group>
  );
}

// ---------- materiali condivisi ----------

function useMaterials(rect: { value: THREE.Vector3 }) {
  const mats = useMemo(() => {
    const asphaltTex = asphaltTexture();
    const stoneTex = settTexture();
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
      terrain: new THREE.MeshLambertMaterial({ vertexColors: true }),
      asphalt: new THREE.MeshLambertMaterial({ map: asphaltTex, color: '#c9cbd0', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      stone: new THREE.MeshLambertMaterial({ map: stoneTex, color: '#d8cfc2', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      cycle: new THREE.MeshLambertMaterial({ map: asphaltTex, color: '#c98f7d', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      paint: new THREE.MeshLambertMaterial({ color: '#efeee6', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      verge: new THREE.MeshLambertMaterial({ color: '#8f8574', side: THREE.DoubleSide }),
      concrete: new THREE.MeshLambertMaterial({ color: '#b3b1aa', side: THREE.DoubleSide }),
      tunnel: new THREE.MeshLambertMaterial({ color: '#4b4a47', emissive: '#2a2618', side: THREE.DoubleSide }),
      rails: new THREE.MeshLambertMaterial({ color: '#7d756b' }),
      buildings: new THREE.MeshLambertMaterial({ vertexColors: true }),
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
      textures: [asphaltTex, stoneTex],
    };
  }, [rect]);
  useEffect(
    () => () => {
      for (const [k, v] of Object.entries(mats)) {
        if (k === 'trees') Object.values(v as Record<string, THREE.Material>).forEach((m) => m.dispose());
        else if (k === 'textures') (v as THREE.Texture[]).forEach((t) => t.dispose());
        else (v as THREE.Material).dispose();
      }
    },
    [mats],
  );
  return mats;
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
  posts: TileMeshes['posts'];
}

function NearTiles(props: WorldSceneProps & { mats: Mats; rect: { value: THREE.Vector3 } }) {
  const { data, field, terrain, quality, mats, rect, playerPose } = props;
  const q = QUALITY[quality];
  const root = useRef<THREE.Group>(null);
  const tiles = useRef(new Map<string, TileEntry>());
  const buildings = useRef(new Map<string, Building[] | Promise<Building[]>>());
  const forest = useRef<ForestHandle | null>(null);
  const center = useRef<[number, number] | null>(null);
  const dirtyTrees = useRef(false);
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
    let bGeo: THREE.BufferGeometry | null = null;
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
    add(roads.tunnel, mats.tunnel);
    add(bGeo, mats.buildings);
    add(water, mats.water);
    add(rails, mats.rails);
    if (roads.posts.length) {
      const box = new THREE.BoxGeometry(0.09, 0.8, 0.09);
      const inst = new THREE.InstancedMesh(box, mats.post, roads.posts.length);
      const d = new THREE.Object3D();
      roads.posts.forEach((p, i) => {
        d.position.set(p.x, p.y + 0.4, p.z);
        d.rotation.set(0, p.h, 0);
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });
      inst.computeBoundingSphere();
      g.add(inst);
    }
    entry.group = g;
    entry.trees = trees;
    entry.posts = roads.posts;
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
      for (let dz = -q.ring; dz <= q.ring; dz++) {
        for (let dx = -q.ring; dx <= q.ring; dx++) {
          const ix = cx + dx;
          const iz = cz + dz;
          const key = `${ix}_${iz}`;
          if (!map.has(key)) map.set(key, { key, ix, iz, state: 'wait', job: null, group: null, trees: [], posts: [] });
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
      for (const t of map.values()) {
        if (t.state === 'ready') continue;
        const d = Math.max(Math.abs(t.ix - cx), Math.abs(t.iz - cz));
        if (t.state === 'build') {
          job = t;
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
        }
      }
      if (!job) break;
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
  });

  return (
    <group>
      <group ref={root} />
      <Forest handle={forest} mats={mats} />
    </group>
  );
}

function disposeGroup(g: THREE.Group | null): void {
  if (!g) return;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
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

function Labels({ data, playerPose }: { data: WorldData; engine: RideEngine; playerPose: () => TrackPose }) {
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
        s.material.map?.dispose();
        s.material.dispose();
      }
      map.clear();
    };
  }, []);
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
          g.remove(s);
          s.material.map?.dispose();
          s.material.dispose();
          live.current.delete(i);
        }
      }
      for (const i of want) {
        if (live.current.has(i)) continue;
        const it = items[i];
        const mat = new THREE.SpriteMaterial({ map: labelTex(it.name, it.sub, it.peak), transparent: true, depthTest: true, depthWrite: false, fog: false, sizeAttenuation: false });
        const s = new THREE.Sprite(mat);
        s.position.set(it.x, it.y, it.z);
        s.center.set(0.5, 0);
        s.renderOrder = 5;
        live.current.set(i, s);
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

function Landmarks({ data, playerPose }: { data: WorldData; playerPose: () => TrackPose }) {
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
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, sizeAttenuation: false }));
      const tall = l.kind === 'cima' || l.kind === 'passo' || l.kind === 'fiume' || l.kind === 'paese' || l.kind === 'citta';
      s.position.set(l.x, l.y + (tall ? 30 : 16), l.z);
      s.center.set(0.5, 0);
      s.scale.set(0.38, 0.095, 1);
      s.userData = { range: tall ? 6000 : 1600 };
      s.visible = false;
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
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      pole.dispose();
      poleMat.dispose();
      g.clear();
      built.current = false;
    };
  }, [data]);
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
