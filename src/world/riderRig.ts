import * as THREE from 'three';
import { BIKE, BONE_COUNT, NEUTRAL, bindMatrices, solvePose, type PoseState } from './rider';

/*
 * Lo scheletro di un ciclista e il suo «carattere»: quando si alza sui pedali, quando si
 * raccoglie in posizione aero, come dondola la bici, dove guarda. Tutto deterministico a parte
 * un seme per ciclista, così venti ciclisti virtuali non si muovono all'unisono.
 */

export interface RigInput {
  dt: number;
  /** giri al minuto (0: non pedala, le pedivelle si mettono orizzontali) */
  cadence: number;
  /** m/s */
  speed: number;
  /** pendenza (0,08 = 8%) */
  grade: number;
  /** watt, se si sanno: decidono lo scatto fuori sella */
  power?: number | null;
  /** velocità di rotazione della direzione (rad/s): fa piegare in curva */
  yawRate?: number;
  /** forzature per il laboratorio e il garage */
  force?: { stand?: number; tuck?: number; crank?: number; glance?: number };
}

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

export class RiderRig {
  readonly bones: THREE.Bone[];
  readonly skeleton: THREE.Skeleton;
  readonly state: PoseState = { ...NEUTRAL };
  private readonly mats: THREE.Matrix4[];
  private readonly seed: number;
  private t = 0;
  private avgPower = 200;
  private sprint = 0;
  private effort = 0;
  private motion = 0;
  private glanceAt = 0;
  private glanceTo = 0;

  constructor(seed = Math.random()) {
    this.seed = seed;
    const bind = bindMatrices();
    this.mats = bind.map((m) => m.clone());
    this.bones = bind.map((m, i) => {
      const b = new THREE.Bone();
      b.name = `osso-${i}`;
      b.matrixAutoUpdate = false;
      b.matrix.copy(m);
      return b;
    });
    this.skeleton = new THREE.Skeleton(
      this.bones,
      bind.map((m) => m.clone().invert()),
    );
    this.state.crank = seed * TAU;
    this.glanceAt = 3 + seed * 6;
  }

  set glasses(on: boolean) {
    this.state.glasses = on;
  }

  /** quanto è in piedi (0..1) e quanto è raccolto: per le prove e per chi vuole saperlo */
  get standing(): number {
    return this.state.stand;
  }
  get tucked(): number {
    return this.state.tuck;
  }

  update(inp: RigInput): void {
    const dt = clamp(inp.dt, 0, 0.1);
    const s = this.state;
    this.t += dt;
    const f = inp.force ?? {};
    const pedaling = inp.cadence > 1;
    this.motion += ((pedaling ? 1 : 0) - this.motion) * ease(dt, 2.5);
    const m = this.motion;

    // pedivelle: girano con la cadenza; a ruota libera si fermano orizzontali, il destro avanti
    if (f.crank != null) s.crank = f.crank;
    else if (pedaling) s.crank += (inp.cadence / 60) * TAU * dt;
    else {
      const target = Math.round((s.crank - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      s.crank += (target - s.crank) * ease(dt, 2.2);
    }
    if (s.crank > TAU * 4) s.crank -= TAU * 4;
    s.wheel = (s.wheel + (inp.speed / BIKE.wheelR) * dt) % TAU;

    // sforzo: dai watt se ci sono, se no dalla pendenza
    const p = inp.power ?? null;
    if (p != null && pedaling) this.avgPower += (p - this.avgPower) * ease(dt, 1 / 25);
    const effortT = !pedaling ? 0 : p != null ? clamp(p / 420, 0, 1.2) : clamp((inp.grade - 0.01) / 0.09, 0, 1) * 0.8 + 0.15;
    this.effort += (effortT - this.effort) * ease(dt, 0.9);
    const e = this.effort;

    // fuori sella: lo scatto (watt ben sopra la media) o a tratti sulle rampe dure
    let standT = 0;
    if (pedaling) {
      if (p != null && p > 330 && p > this.avgPower * 1.45 + 40) this.sprint = 1.4;
      this.sprint = Math.max(0, this.sprint - dt);
      if (this.sprint > 0) standT = 1;
      else if (inp.grade > 0.07 && inp.speed < 9) {
        const period = 22 + this.seed * 10;
        const share = inp.grade > 0.11 ? 0.45 : 0.28;
        standT = (this.t + this.seed * period) % period < period * share ? 1 : 0;
      }
    }
    if (f.stand != null) standT = f.stand;
    s.stand += (standT - s.stand) * ease(dt, 3.2);
    const st = s.stand;

    // aero: veloce in pianura, o in discesa senza pedalare
    let tuckT = (pedaling ? inp.speed > 12 && inp.grade < 0.02 : inp.speed > 8.5 && inp.grade < -0.015) ? 1 - st : 0;
    if (f.tuck != null) tuckT = f.tuck;
    s.tuck += (tuckT - s.tuck) * ease(dt, 1.4);

    // il corpo che lavora: bici che dondola fuori sella, bacino e spalle che ondeggiano seduti
    const a = s.crank;
    s.bikeRoll = m * (st * 0.12 * Math.sin(a - 0.25) + (1 - st) * (0.004 + e * 0.012) * Math.sin(a));
    s.pelvisRoll = m * (1 - st) * -0.028 * (0.35 + e) * Math.sin(a);
    s.shift = m * st * 0.035 * Math.sin(a - 0.2);
    s.sway = m * ((1 - st) * 0.024 * (0.3 + e) * Math.sin(a + 0.5) + st * 0.05 * Math.sin(a + 0.15));
    s.bob = m * (1 - st) * 0.004 * Math.sin(2 * a);
    const breath = 0.3 + e * 0.3;
    s.shrug = 0.005 * (0.4 + e) * Math.sin(this.t * TAU * breath);
    s.steer = m * st * -0.04 * Math.sin(a - 0.25) + 0.006 * Math.sin(this.t * 0.9 + this.seed * 10);

    // testa: un'occhiata ogni tanto, giù quando fa fatica, un cenno fuori sella
    if (f.glance != null) this.glanceTo = f.glance;
    else if (this.t > this.glanceAt) {
      const looking = this.glanceTo !== 0;
      this.glanceTo = looking ? 0 : (this.seed > 0.5 ? 1 : -1) * (0.25 + 0.2 * Math.abs(Math.sin(this.t * 1.7)));
      this.glanceAt = this.t + (looking ? 4 + 7 * Math.abs(Math.sin(this.t + this.seed * 7)) : 1.1);
    }
    s.headYaw += (this.glanceTo * (1 - 0.7 * st) - s.headYaw) * ease(dt, 3);
    s.headPitch = m * st * 0.03 * Math.sin(2 * a) + 0.05 * e - 0.02;

    // piega in curva: tan(φ) = v·ω / g
    const leanT = clamp(Math.atan((inp.speed * (inp.yawRate ?? 0)) / 9.81), -0.45, 0.45);
    s.lean += (leanT - s.lean) * ease(dt, 4);

    solvePose(s, this.mats);
    for (let i = 0; i < BONE_COUNT; i++) {
      this.bones[i].matrix.copy(this.mats[i]);
      this.bones[i].matrixWorldNeedsUpdate = true;
    }
  }
}

/** Una maglia con lo scheletro del ciclista: le ossa sono figlie dirette della maglia. */
export function riderMesh(geometry: THREE.BufferGeometry, material: THREE.Material, rig: RiderRig): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(...rig.bones);
  mesh.bind(rig.skeleton, new THREE.Matrix4());
  // sfera fissa (bici e ciclista stanno in 2 m): niente ricalcolo sulle ossa a ogni prova di visibilità
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.85, 0.08), 1.25);
  mesh.name = 'ciclista';
  return mesh;
}
