import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { B, BIKE, BODY, BONE_COUNT, NEUTRAL, ankleAt, bindMatrices, pedalAt, solvePose, type PoseState } from '@/world/rider';
import { buildRiderGeometry, triangles, type RiderDetail } from '@/world/riderBuild';
import { RiderRig } from '@/world/riderRig';
import { lookKey, palette, swatchUv, SWATCHES } from '@/world/riderKit';
import { DEFAULT_LOOK, lookFromColor } from '@/game/look';

const BUDGET: Record<RiderDetail, number> = { alta: 12000, media: 4000, bassa: 1500 };

function mats() {
  return Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
}
const pos = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);

describe('ciclista: geometria', () => {
  for (const detail of ['alta', 'media', 'bassa'] as const)
    for (const rim of ['basso', 'alto', 'lenticolare'] as const)
      it(`${detail}/${rim}: dentro il budget di triangoli, ossa e pesi validi`, () => {
        const g = buildRiderGeometry(detail, rim);
        const tris = triangles(g);
        expect(tris).toBeLessThanOrEqual(BUDGET[detail]);
        expect(tris).toBeGreaterThan(BUDGET[detail] * 0.35);
        const si = g.attributes.skinIndex as THREE.BufferAttribute;
        const sw = g.attributes.skinWeight as THREE.BufferAttribute;
        const p = g.attributes.position as THREE.BufferAttribute;
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
          for (let k = 0; k < 4; k++) expect(si.getComponent(i, k)).toBeLessThan(BONE_COUNT);
          expect(Math.abs(sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i) - 1)).toBeLessThan(1e-5);
          expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getX(i)).toBeLessThanOrEqual(1);
          expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getY(i)).toBeLessThanOrEqual(1);
        }
        // tutto sta sopra l'asfalto e dentro due metri
        g.computeBoundingBox();
        expect(g.boundingBox!.min.y).toBeGreaterThan(-0.01);
        expect(g.boundingBox!.max.y).toBeLessThan(1.8);
        expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeLessThan(2);
        // la geometria alta/lenticolare è la più pesante: su una macchina carica supera i 5 s
      }, 30000);

  it('le normali guardano fuori: busto, testa, cosce e pareti dei cerchi', () => {
    for (const detail of ['alta', 'bassa'] as const) {
      const g = buildRiderGeometry(detail, 'alto');
      const p = g.attributes.position as THREE.BufferAttribute;
      const n = g.attributes.normal as THREE.BufferAttribute;
      const si = g.attributes.skinIndex as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const skin = swatchUv('skin');
      const bind = bindMatrices();
      const spine = new THREE.Line3(new THREE.Vector3(0, 0.99, -0.215), new THREE.Vector3(0, 1.388, 0.292));
      const hip = pos(bind[B.thighL]);
      const knee = pos(bind[B.shinL]);
      const thigh = new THREE.Line3(hip, knee);
      const skull = pos(bind[B.head]).add(new THREE.Vector3(0, 0.075, 0.055));
      const tally: Record<string, [number, number]> = {};
      const v = new THREE.Vector3();
      const nn = new THREE.Vector3();
      const c = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        nn.fromBufferAttribute(n, i);
        const b = si.getX(i);
        let k = '';
        let ok = false;
        if (b === B.pelvis) {
          k = 'busto';
          ok = v.clone().sub(spine.closestPointToPoint(v, true, c)).dot(nn) > 0;
        } else if (b === B.head && Math.abs(uv.getX(i) - skin[0]) < 1e-6 && Math.abs(uv.getY(i) - skin[1]) < 1e-6) {
          k = 'testa';
          ok = v.clone().sub(skull).dot(nn) > 0;
        } else if (b === B.thighL) {
          k = 'coscia';
          ok = v.clone().sub(thigh.closestPointToPoint(v, true, c)).dot(nn) > 0;
        } else if (b === B.wheelF) {
          const r = Math.hypot(v.y - BIKE.frontAxle[1], v.z - BIKE.frontAxle[2]);
          if (r > 0.262 && r < 0.3 && Math.abs(v.x) > 0.004) {
            k = 'cerchio';
            ok = Math.sign(nn.x) === Math.sign(v.x);
          }
        }
        if (!k) continue;
        tally[k] ??= [0, 0];
        tally[k][1]++;
        if (ok) tally[k][0]++;
      }
      // il cerchio basso ha solo il bordo e il canale dei raggi: niente vertici a metà parete
      for (const k of detail === 'alta' ? ['busto', 'testa', 'coscia', 'cerchio'] : ['busto', 'testa', 'coscia']) {
        expect(tally[k], `${detail} ${k}`).toBeDefined();
        expect(tally[k][0] / tally[k][1], `${detail} ${k}`).toBeGreaterThan(0.9);
      }
    }
  });
});

describe('ciclista: posa', () => {
  const poses: [string, Partial<PoseState>][] = [
    ['seduto', {}],
    ['fuori sella', { stand: 1, bikeRoll: 0.12, shift: 0.03 }],
    ['aero', { tuck: 1 }],
    ['in curva', { lean: 0.35 }],
  ];
  for (const [name, extra] of poses)
    it(`${name}: piedi sui pedali e mani sulle leve per tutto il giro`, () => {
      const out = mats();
      for (let k = 0; k < 24; k++) {
        const crank = (k / 24) * Math.PI * 2;
        const s = { ...NEUTRAL, ...extra, crank };
        const info = solvePose(s, out);
        expect(info.reach).toBe(true);
        for (const right of [false, true]) {
          // la caviglia è dove la vuole il pedale, e lo stinco ci arriva
          const bike = out[B.bike];
          const ankle = ankleAt(crank, right).applyMatrix4(bike);
          const foot = pos(out[right ? B.footR : B.footL]);
          expect(foot.distanceTo(ankle)).toBeLessThan(1e-6);
          const knee = pos(out[right ? B.shinR : B.shinL]);
          expect(Math.abs(knee.distanceTo(ankle) - BODY.shin)).toBeLessThan(1e-4);
          const hip = pos(out[right ? B.thighR : B.thighL]);
          expect(Math.abs(hip.distanceTo(knee) - BODY.thigh)).toBeLessThan(1e-4);
          // il ginocchio sta davanti alla linea anca-caviglia
          const pedal = pedalAt(crank, right).applyMatrix4(bike);
          expect(pos(out[right ? B.pedalR : B.pedalL]).distanceTo(pedal)).toBeLessThan(1e-6);
          // polso: l'avambraccio finisce dove la mano tiene la leva
          const steer = out[B.steer];
          const wrist = new THREE.Vector3((right ? -1 : 1) * BODY.wrist[0], BODY.wrist[1], BODY.wrist[2]).applyMatrix4(steer);
          const elbow = pos(out[right ? B.forearmR : B.forearmL]);
          expect(Math.abs(elbow.distanceTo(wrist) - BODY.forearm)).toBeLessThan(1e-4);
        }
      }
    });

  it('la destra è il lato −x, con la trasmissione', () => {
    expect(pedalAt(0, true).x).toBeLessThan(0);
    expect(pedalAt(0, true).y).toBeCloseTo(BIKE.bb[1] + BIKE.crank, 6);
  });

  it('la posa di riposo coincide con le matrici di riposo', () => {
    const out = mats();
    solvePose(NEUTRAL, out);
    const bind = bindMatrices();
    for (let i = 0; i < BONE_COUNT; i++) for (let k = 0; k < 16; k++) expect(out[i].elements[k]).toBeCloseTo(bind[i].elements[k], 9);
  });
});

describe('ciclista: carattere', () => {
  const run = (rig: RiderRig, secs: number, inp: { cadence: number; speed: number; grade: number; power?: number }) => {
    let maxStand = 0;
    for (let t = 0; t < secs; t += 1 / 30) {
      rig.update({ dt: 1 / 30, ...inp });
      maxStand = Math.max(maxStand, rig.standing);
    }
    return maxStand;
  };
  it('sulle rampe dure si alza sui pedali, in pianura no', () => {
    expect(run(new RiderRig(0.3), 40, { cadence: 70, speed: 3, grade: 0.12 })).toBeGreaterThan(0.8);
    expect(run(new RiderRig(0.3), 40, { cadence: 88, speed: 9, grade: 0.0 })).toBeLessThan(0.05);
  });
  it('uno scatto di watt lo fa alzare', () => {
    const rig = new RiderRig(0.6);
    run(rig, 30, { cadence: 90, speed: 10, grade: 0, power: 200 });
    expect(run(rig, 2, { cadence: 105, speed: 11, grade: 0, power: 800 })).toBeGreaterThan(0.6);
  });
  it('veloce in pianura si raccoglie in posizione aero', () => {
    const rig = new RiderRig(0.1);
    run(rig, 6, { cadence: 95, speed: 13.5, grade: 0 });
    expect(rig.tucked).toBeGreaterThan(0.9);
  });
  it('a ruota libera le pedivelle si fermano orizzontali', () => {
    const rig = new RiderRig(0.42);
    run(rig, 6, { cadence: 0, speed: 12, grade: -0.06 });
    expect(Math.abs(Math.cos(rig.state.crank))).toBeLessThan(0.02);
  });
});

describe('ciclista: divisa', () => {
  it('ogni casella della tavolozza ha un colore e un punto suo', () => {
    const pal = palette(DEFAULT_LOOK);
    const seen = new Set<string>();
    for (const s of SWATCHES) {
      expect(pal[s]).toMatch(/^#[0-9a-f]{6}$/i);
      const [u, v] = swatchUv(s);
      seen.add(`${u.toFixed(4)},${v.toFixed(4)}`);
      expect(u).toBeGreaterThan(0);
      expect(v).toBeLessThan(0.375);
    }
    expect(seen.size).toBe(SWATCHES.length);
  });
  it('la chiave di un aspetto non dipende dall\'oggetto', () => {
    expect(lookKey(lookFromColor('#e94f37', 2))).toBe(lookKey({ ...lookFromColor('#e94f37', 2) }));
    expect(lookKey(lookFromColor('#e94f37', 2))).not.toBe(lookKey(lookFromColor('#e94f37', 3)));
  });
});
