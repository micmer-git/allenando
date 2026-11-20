import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { trackFromGeo, trackFromRouteFile, VERIFIED_ROUTES, type RouteFile } from '@/domain/routes';
import { createRouteTrack, type Track } from '@/domain/track';
import { FLAG } from '@/open/graph';
import { createWorldField, type WorldField } from '@/open/field';
import { WorldPath } from '@/open/path';
import { loadWorld, Terrain, type RideDef, type WorldData } from '@/open/world';
import { WORLDS } from '@/open/world-table';
import { createHeightField } from '@/world/heightfield';
import { bendHeading, chaseRider, frameRider } from '@/world/isometric';
import { projector } from '@/domain/geo';
import { matchSurveyPhotos, surveyStations, type PhotoAtlas } from '@/open/fotoSopralluogo';
import { fitRideViewport } from '@/world/rideCamera';

const publicDir = join(__dirname, '..', 'public');
const fractions = [0, .25, .5, .75, 1];
function expectPhotos(track: Track, geo: ReturnType<typeof projector>, atlasDir: string) {
  const atlas = JSON.parse(readFileSync(join(publicDir, atlasDir, 'foto/atlante-v1.json'), 'utf8')) as PhotoAtlas;
  const photos = matchSurveyPhotos(atlas, surveyStations(track, geo.toGeo));
  expect(photos.some(p => p.matches.some(m => m.photo.id.startsWith('commons-')))).toBe(true);
}
const viewports = [[1200, 540], [390, 844], [844, 390], [320, 360]];

beforeAll(() => {
  // Gli stessi dati del gioco, dal disco: la prova non dipende dalla rete.
  vi.stubGlobal('fetch', async (url: string) => {
    try {
      const bytes = readFileSync(join(publicDir, String(url).replace(/^.*\/world\//, 'world/')));
      return {
        ok: true,
        json: async () => JSON.parse(bytes.toString('utf8')),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    } catch {
      return { ok: false, status: 404 };
    }
  });
});
afterAll(() => vi.unstubAllGlobals());

// Un quadrato parallelo allo schermo deve mantenere i lati uguali in pixel.
function expectSquarePixels(camera: THREE.Camera, width: number, height: number) {
  camera.updateMatrixWorld();
  const lower = new THREE.Vector3(-0.5, -0.5, -8).applyMatrix4(camera.matrixWorld).project(camera);
  const upper = new THREE.Vector3(0.5, 0.5, -8).applyMatrix4(camera.matrixWorld).project(camera);
  expect((upper.x - lower.x) * width / ((upper.y - lower.y) * height)).toBeCloseTo(1, 6);
}

function checkFrame(track: Track, distance: number, ground: WorldField['height'], tunnel = false) {
  const pose = track.poseAt(distance);
  for (const [width, height] of viewports) {
    // Come nel gioco, la camera appena selezionata nasce quadrata anche se il canvas è già largo.
    const chase = new THREE.PerspectiveCamera(55, 1, 0.12, 2000);
    fitRideViewport(chase, width, height);
    chaseRider(chase, pose, pose.heading, new THREE.Vector3(), ground, [], tunnel);
    expectSquarePixels(chase, width, height);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 240);
    fitRideViewport(camera, width, height);
    frameRider(camera, pose, pose.heading, height, new THREE.Vector3(), ground, 0, 0, tunnel);
    expectSquarePixels(camera, width, height);
    expect([...camera.position, ...camera.quaternion, camera.zoom].every(Number.isFinite)).toBe(true);
    // Ingombro del ciclista completo: ruote, casco e busto devono restare nel quadro.
    for (const x of [-.55, .55]) for (const y of [0, 1.8]) for (const z of [-1, 1]) {
      const point = new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), pose.heading);
      point.add(new THREE.Vector3(pose.x, pose.y, pose.z)).project(camera);
      expect(Math.abs(point.x), `${width}px a ${Math.round(distance)}m: lato`).toBeLessThan(.98);
      expect(Math.abs(point.y), `${width}px a ${Math.round(distance)}m: altezza`).toBeLessThan(.98);
      expect(Math.abs(point.z), `${width}px a ${Math.round(distance)}m: piani di taglio`).toBeLessThan(1);
    }
  }
}

for (const world of WORLDS) {
  describe(`camera isometrica: tutti i percorsi di ${world.id}`, () => {
    const rides = JSON.parse(readFileSync(join(publicDir, 'world', world.id, 'rides.json'), 'utf8')) as RideDef[];
    let data: WorldData;
    let terrain: Terrain;
    let field: WorldField;
    beforeAll(async () => {
      data = await loadWorld(world.id);
      terrain = new Terrain(data.graph, `/world/${world.id}/`);
      await terrain.loadFar();
      field = createWorldField(data.graph, terrain, data.features);
    });

    for (const ride of rides) {
      it(`${ride.id}: ciclista inquadrato alla partenza, lungo il percorso e all'arrivo`, async () => {
        const [first, ...rest] = ride.legs;
        const path = new WorldPath(data.graph, { edge: first[0], dir: first[1], s: first[1] > 0 ? 0 : data.graph.edges[first[0]].length });
        for (const [edge, dir] of rest) path.append(edge, dir);
        expect(path.length).toBeGreaterThan(100);
        expectPhotos(path, data.proj, 'world/' + data.graph.id);
        for (const fraction of fractions) {
          const distance = Math.min(path.length - .1, path.length * fraction);
          const pose = path.poseAt(distance);
          await terrain.around(pose.x, pose.z, 40);
          const tunnel = !!(data.graph.edges[path.edgeAt(distance).edge].flags & FLAG.tunnel);
          checkFrame(path, distance, field.height, tunnel);
        }
      });
    }
  });
}

describe('camera isometrica: salite, replay e allenamento senza GPS', () => {
  for (const meta of VERIFIED_ROUTES) {
    it(`${meta.id}: l'intera salita usa la stessa inquadratura`, () => {
      const file = JSON.parse(readFileSync(join(publicDir, 'routes', `${meta.id}.json`), 'utf8')) as RouteFile;
      const route = trackFromRouteFile(file, meta.halfWidth);
      const field = createHeightField(route.track, route.dem);
      expectPhotos(route.track, projector(route.origin), route.id === 'selvino-nembro' ? 'world/bergamo' : 'routes');
      for (const fraction of fractions) checkFrame(route.track, route.track.length * fraction, field.height);
    });
  }

  it('una traccia GPS importata resta inquadrata anche senza DEM', () => {
    const route = trackFromGeo('prova-gps', 'Prova GPS', Array.from({ length: 50 }, (_, i) => ({
      lat: 45.7 + i * .0001, lon: 9.7 + Math.sin(i / 7) * .001, ele: 300 + i * 2,
    })));
    const field = createHeightField(route.track, route.dem);
    for (const fraction of fractions) checkFrame(route.track, route.track.length * fraction, field.height);
  });

  it('la strada neutra del replay senza GPS mantiene il ciclista nel quadro', () => {
    const track = createRouteTrack([{ x: 0, z: 0, ele: 0 }, { x: 0, z: 1000, ele: 0 }]);
    const field = createHeightField(track, null);
    for (const fraction of fractions) checkFrame(track, track.length * fraction, field.height);
  });

  it('la terza persona anticipa la curva dal rettilineo e si ferma alla fine della salita', () => {
    const track = createRouteTrack([{x:0,z:0,ele:0},{x:0,z:100,ele:0},{x:60,z:102,ele:0},{x:62,z:15,ele:0}]);
    const straight = track.poseAt(20);
    expect(bendHeading(track,straight,12)).toBeCloseTo(straight.heading,5);
    const beforeBend = track.poseAt(88);
    const turn = bendHeading(track,beforeBend,15) - beforeBend.heading;
    expect(turn).toBeGreaterThan(0.04);
    expect(turn).toBeLessThanOrEqual(Math.PI/8 + 1e-8);
    const finish = track.poseAt(track.length);
    expect(bendHeading(track,finish,20)).toBe(finish.heading);
  });
});
