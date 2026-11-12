import * as THREE from 'three';
import type { WorldField } from './field';
import type { TileSpec } from './tiles';
import { worldBase, type Building } from './world';

/**
 * Palazzo Roncalli, OSM way 207093381. The facade on piazza Mascheroni runs from
 * 45.7051261,9.6598602 (left in the photograph) to 45.7052108,9.6595736.
 * Coordinates below are the decimetre vertices in the actual exported building tile.
 * At the surveyed 24.06 m width, Sailko's rectified facade gives a 14.6 m eave.
 */
const left = {x: -10850.7, z: 18055.2};
const right = {x: -10872.8, z: 18045.7};
const facadeHeight = 14.6;

function hasFacade(building: Building): boolean {
  const ring = building.ring;
  for (let i = 0; i < ring.length; i += 2) {
    if (Math.abs(ring[i] - left.x) > 0.2 || Math.abs(ring[i + 1] - left.z) > 0.2) continue;
    const prev = (i + ring.length - 2) % ring.length;
    const next = (i + 2) % ring.length;
    if ([prev, next].some(k => Math.abs(ring[k] - right.x) < 0.2 && Math.abs(ring[k + 1] - right.z) < 0.2)) return true;
  }
  return false;
}

const center = {x: -10874, z: 18061};

function containsPalazzoTile(spec: TileSpec): boolean {
  return center.x >= spec.x0 && center.x < spec.x0 + spec.size
    && center.z >= spec.z0 && center.z < spec.z0 + spec.size;
}

function frontElevation(field: Pick<WorldField, 'height'>, spec: TileSpec) {
  const leftY = field.height(left.x, left.z, spec.spacing);
  const rightY = field.height(right.x, right.z, spec.spacing);
  return {lowerLeft: leftY - 0.15, lowerRight: rightY - 0.15, eave: (leftY + rightY) / 2 + facadeHeight};
}

/** The back of the block rises uphill. Measure the eave above the square, then
 * convert to height above the ground plane buildingsJob computes for the footprint. */
export function fitRoncalliRoof(world: string, field: Pick<WorldField, 'height'>, spec: TileSpec, buildings: Building[]): Building[] {
  if (world !== 'bergamo' || !containsPalazzoTile(spec)) return buildings;
  const upper = buildings.find(hasFacade);
  if (!upper) return buildings;
  const groundY = frontElevation(field, spec).eave - facadeHeight;
  return buildings.map(b => {
    if (b === upper) return {...b, groundY, h: facadeHeight};
    if (b.upperRing === upper.ring) return {...b, groundY};
    return b;
  });
}

export function roncalliGeometry(field: Pick<WorldField, 'height'>, spec: TileSpec, buildings: Building[]): THREE.BufferGeometry | null {
  if (!containsPalazzoTile(spec)) return null;
  const upper = buildings.find(hasFacade);
  if (!upper) return null;
  const base = buildings.find(b => b.upperRing === upper.ring);
  const {lowerLeft, lowerRight, eave} = frontElevation(field, spec);
  const top = eave - 0.04;
  if (top <= Math.max(lowerLeft, lowerRight) + 1) return null;
  const streetY = eave - facadeHeight;
  const baseTop = streetY + upper.minH;

  const pos: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const quad = (a: typeof left, b: typeof left, ya: number, yb: number, ceiling: number, ua: number, ub: number, va: number, vb: number, upperV: number) => {
    const i = pos.length / 3;
    pos.push(a.x, ya, a.z, b.x, yb, b.z, a.x, ceiling, a.z, b.x, ceiling, b.z);
    uv.push(ua, va, ub, vb, ua, upperV, ub, upperV);
    indices.push(i, i+1, i+2, i+1, i+3, i+2);
  };
  const seam = base ? upper.minH / facadeHeight : 0;
  quad(left, right, base ? baseTop : lowerLeft, base ? baseTop : lowerRight, top, 0, 1, seam, seam, 1);
  if (base) {
    // Project the door and ground-floor windows onto the recessed frontage. The normalized
    // along-wall distance keeps the photo aligned horizontally with the uncut upper stories.
    const dx = right.x - left.x, dz = right.z - left.z;
    const length = Math.hypot(dx, dz);
    const project = (x: number, z: number) => ({
      x, z, u: ((x - left.x) * dx + (z - left.z) * dz) / (length * length),
      setback: ((x - left.x) * dz - (z - left.z) * dx) / length,
    });
    for (let i = 0; i < base.ring.length; i += 2) {
      const j = (i + 2) % base.ring.length;
      const a = project(base.ring[i], base.ring[i+1]);
      const b = project(base.ring[j], base.ring[j+1]);
      if (a.u >= b.u || b.u <= 0 || a.u >= 1 || Math.min(a.setback,b.setback) < 0 || Math.max(a.setback,b.setback) > 5.5) continue;
      const clip = (u: number) => {
        const t = (u - a.u) / (b.u - a.u);
        return {x: a.x + (b.x-a.x)*t, z: a.z + (b.z-a.z)*t};
      };
      const u0 = Math.max(0, a.u), u1 = Math.min(1, b.u);
      const p = clip(u0), q = clip(u1);
      const y0 = field.height(p.x, p.z, spec.spacing) - 0.15;
      const y1 = field.height(q.x, q.z, spec.spacing) - 0.15;
      quad(p, q, y0, y1, baseTop, u0, u1, 0, 0, seam);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** The tile group owns this mesh and fades it alongside its underlying building.
 * The photograph appears only after successful loading. Normal geometry disposal
 * in WorldScene also releases the texture and the material. */
export function addRoncalliFacade(group: THREE.Group, world: string, field: WorldField, spec: TileSpec, buildings: Building[]): void {
  if (world !== 'bergamo' || !containsPalazzoTile(spec)) return;
  const geo = roncalliGeometry(field, spec, buildings);
  if (!geo) return;
  const mat = new THREE.MeshLambertMaterial({emissive:0xffffff, emissiveIntensity:0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  mat.visible = false;
  let active = true;
  const map = new THREE.TextureLoader().load(worldBase(world) + 'foto/roncalli-facciata.webp', texture => {
    if (!active) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    mat.map = mat.emissiveMap = texture;
    mat.needsUpdate = true;
    mat.visible = true;
  }, undefined, () => { /* the building material remains visible */ });
  geo.addEventListener('dispose', () => { active = false; map.dispose(); mat.dispose(); });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Affreschi del Cariani · Palazzo Roncalli';
  mesh.renderOrder = 1;
  group.add(mesh);
}
