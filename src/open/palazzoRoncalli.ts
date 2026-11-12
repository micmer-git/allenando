import * as THREE from 'three';
import type { WorldField } from './field';
import { footprintGround, type TileSpec } from './tiles';
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

/** Called once for the building list. Keep the portico clearance on the other walls. */
export function fitRoncalliRoof(world: string, tx: number, tz: number, buildings: Building[]): Building[] {
  if (world !== 'bergamo' || tx !== 6 || tz !== 20) return buildings;
  return buildings.map(b => hasFacade(b) ? {...b, h: facadeHeight} : b);
}

export function roncalliGeometry(field: Pick<WorldField, 'height'>, spec: TileSpec, buildings: Building[]): THREE.BufferGeometry | null {
  // Both building and decal must belong to the same render tile, including at a tile boundary.
  const building = buildings.find(hasFacade);
  if (!building) return null;
  let cx = 0, cz = 0;
  const ring = building.ring;
  for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
  cx /= ring.length / 2;
  cz /= ring.length / 2;
  if (cx < spec.x0 || cx >= spec.x0 + spec.size || cz < spec.z0 || cz >= spec.z0 + spec.size) return null;

  // Use the same footprint and spacing as buildingsJob so the roof and photograph meet
  // when LOD changes. The public square touches the lower edge of the real facade.
  const {low, high} = footprintGround(field, ring, spec.spacing, cx, cz);
  const ground = Math.max(low - 0.6, Math.min(high - 1, low + 12));
  const top = ground + building.h - 0.04;
  const lowerLeft = field.height(left.x, left.z, spec.spacing) - 0.15;
  const lowerRight = field.height(right.x, right.z, spec.spacing) - 0.15;
  if (top <= Math.max(lowerLeft, lowerRight) + 1) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    left.x, lowerLeft, left.z, right.x, lowerRight, right.z,
    left.x, top, left.z, right.x, top, right.z,
  ], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geo.setIndex([0, 1, 2, 1, 3, 2]);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** The tile group owns this mesh and fades it alongside its underlying building.
 * The photograph appears only after successful loading. Normal geometry disposal
 * in WorldScene also releases the texture and the material. */
export function addRoncalliFacade(group: THREE.Group, world: string, field: WorldField, spec: TileSpec, buildings: Building[]): void {
  if (world !== 'bergamo'
    || spec.x0 > Math.max(left.x, right.x) || spec.x0 + spec.size <= Math.min(left.x, right.x)
    || spec.z0 > Math.max(left.z, right.z) || spec.z0 + spec.size <= Math.min(left.z, right.z)) return;
  const geo = roncalliGeometry(field, spec, buildings);
  if (!geo) return;
  const mat = new THREE.MeshLambertMaterial({polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  mat.visible = false;
  let active = true;
  const map = new THREE.TextureLoader().load(worldBase(world) + 'foto/roncalli-facciata.webp', texture => {
    if (!active) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    mat.map = texture;
    mat.needsUpdate = true;
    mat.visible = true;
  }, undefined, () => { /* the building material remains visible */ });
  geo.addEventListener('dispose', () => { active = false; map.dispose(); mat.dispose(); });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Affreschi del Cariani · Palazzo Roncalli';
  mesh.renderOrder = 1;
  group.add(mesh);
}
