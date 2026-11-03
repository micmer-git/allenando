import * as THREE from 'three';
import type { Rim } from '@/game/look';
import { B, BIKE, BODY, NEUTRAL, bindMatrices, pedalAt } from './rider';
import { ATLAS, swatchUv, type Swatch } from './riderKit';
import { gearRing, latheX, loft, mergeParts, pathTube, segmentLoft, tag, vec, type Profile, type Ring, type UvRect, type V3 } from './riderGeo';

/*
 * La geometria del ciclista e della bici, in tre livelli di dettaglio. Tutto si costruisce
 * sulla posa di riposo (rider.ts → bindMatrices) e finisce in UNA geometria con le ossa:
 * telaio, ruote, trasmissione, corpo, casco e occhiali.
 *
 *   alta  — chi pedala: raggi, catena, corone dentate, freni a disco, dita sulle leve
 *   media — i vicini: niente catena, dischi né raggi (a dieci metri sono un velo)
 *   bassa — la folla lontana: la sagoma giusta e i colori, poco altro
 */

export type RiderDetail = 'alta' | 'media' | 'bassa';

interface Lod {
  /** tubi del telaio, intorno */
  tube: number;
  /** tubi sottili (foderi, reggisella, collo) e pezzi piccoli */
  thin: number;
  /** ellissoidi piccoli (mani, giunzioni) */
  small: number;
  /** piega: passi lungo il percorso e lati */
  bar: number;
  barSeg: number;
  limb: number;
  torso: number;
  /** anelli delle cupole in cima agli arti */
  dome: number;
  head: number;
  helmet: [number, number];
  /** ruote: lati intorno, della gomma, del mozzo (0 = niente) */
  wheel: number;
  tyre: number;
  hub: number;
  spokes: [number, number];
  /** catena (0 = niente), pignoni, corona e i suoi denti */
  chain: number;
  cassette: number;
  ring: number;
  teeth: number;
  fine: boolean;
  mid: boolean;
}

const LOD: Record<RiderDetail, Lod> = {
  alta: { tube: 10, thin: 8, small: 8, bar: 16, barSeg: 6, limb: 12, torso: 24, dome: 3, head: 16, helmet: [12, 12], wheel: 36, tyre: 6, hub: 10, spokes: [20, 24], chain: 52, cassette: 3, ring: 0, teeth: 36, fine: true, mid: true },
  media: { tube: 6, thin: 5, small: 6, bar: 7, barSeg: 4, limb: 7, torso: 12, dome: 2, head: 9, helmet: [6, 6], wheel: 16, tyre: 4, hub: 6, spokes: [0, 0], chain: 0, cassette: 1, ring: 16, teeth: 0, fine: false, mid: true },
  bassa: { tube: 4, thin: 3, small: 4, bar: 3, barSeg: 3, limb: 5, torso: 8, dome: 1, head: 6, helmet: [4, 4], wheel: 14, tyre: 3, hub: 0, spokes: [0, 0], chain: 0, cassette: 0, ring: 8, teeth: 0, fine: false, mid: false },
};

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

type Uv = Swatch | UvRect;
const uvOf = (u: Uv) => (typeof u === 'string' ? swatchUv(u) : u);

/** Rettangolo con la v capovolta (le maniche partono dalla spalla). */
const flipV = (r: UvRect): UvRect => ({ u0: r.u0, v0: r.v1, u1: r.u1, v1: r.v0 });
/** Scambia u e v (la scritta corre lungo il tubo). */
function swapUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    uv.setXY(i, uv.getY(i), u);
  }
  return g;
}

const BONE_NAME = Object.fromEntries(Object.entries(B).map(([k, v]) => [v, k])) as Record<number, string>;

class Parts {
  list: THREE.BufferGeometry[] = [];
  /** triangoli per osso e colore: per tenere d'occhio il budget */
  log = new Map<string, number>();
  constructor(readonly bind: THREE.Matrix4[]) {}
  private note(g: THREE.BufferGeometry, bone: number | ((p: THREE.Vector3) => [number, number, number]), uv: Uv) {
    const k = `${typeof bone === 'number' ? BONE_NAME[bone] : 'busto'}:${typeof uv === 'string' ? uv : 'stampa'}`;
    this.log.set(k, (this.log.get(k) ?? 0) + (g.index ? g.index.count : g.attributes.position.count) / 3);
  }
  /** pezzo già nella posa di riposo, coordinate del ciclista */
  abs(g: THREE.BufferGeometry, bone: number | ((p: THREE.Vector3) => [number, number, number]), uv: Uv) {
    this.note(g, bone, uv);
    this.list.push(tag(g, bone, uvOf(uv)));
  }
  /** pezzo costruito nel riferimento del suo osso */
  local(g: THREE.BufferGeometry, bone: number, uv: Uv) {
    this.note(g, bone, uv);
    g.applyMatrix4(this.bind[bone]);
    this.list.push(tag(g, bone, uvOf(uv)));
  }
}

/** Un loft lungo a→b diviso in fasce di colore: [t0, t1, colore]. Le cupole alle estremità. */
function banded(
  a: THREE.Vector3,
  b: THREE.Vector3,
  side: THREE.Vector3,
  profile: Profile,
  bands: readonly (readonly [number, number, Uv])[],
  seg: number,
  opts: { domeA?: number; domeB?: number; domeSteps: number; n?: number; phase?: number },
): [THREE.BufferGeometry, Uv][] {
  const at = (t: number): [number, number, number, number] => {
    for (let i = 1; i < profile.length; i++) {
      const p0 = profile[i - 1];
      const p1 = profile[i];
      if (t <= p1[0] + 1e-9) {
        const k = (t - p0[0]) / Math.max(1e-9, p1[0] - p0[0]);
        return [t, p0[1] + (p1[1] - p0[1]) * k, p0[2] + (p1[2] - p0[2]) * k, (p0[3] ?? 0) + ((p1[3] ?? 0) - (p0[3] ?? 0)) * k];
      }
    }
    const l = profile[profile.length - 1];
    return [t, l[1], l[2], l[3] ?? 0];
  };
  return bands.map(([t0, t1, uv]) => {
    const prof: [number, number, number, number][] = [at(t0)];
    for (const p of profile) if (p[0] > t0 + 1e-6 && p[0] < t1 - 1e-6) prof.push([p[0], p[1], p[2], p[3] ?? 0]);
    prof.push(at(t1));
    // riportata sul segmento del pezzo
    const A = a.clone().lerp(b, t0);
    const Bv = a.clone().lerp(b, t1);
    const span = t1 - t0;
    const local = prof.map(([t, rx, ry, oy]) => [(t - t0) / span, rx, ry, oy] as const);
    const g = segmentLoft(A, Bv, side, local, seg, {
      n: opts.n,
      domeA: t0 === 0 ? opts.domeA : undefined,
      domeB: t1 === 1 ? opts.domeB : undefined,
      domeSteps: opts.domeSteps,
      phase: opts.phase,
    });
    return [g, uv] as [THREE.BufferGeometry, Uv];
  });
}

/** Ellissoide (sfera deformata). */
function ellipsoid(c: V3, r: V3, seg: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.65)));
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** Sezioni lungo una polilinea, assi della sezione: `side` e la perpendicolare nel piano. */
function ringsAlong(pts: readonly (readonly [number, number, number, number, number])[], side: THREE.Vector3, n = 2): Ring[] {
  return pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const t = new THREE.Vector3(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]).normalize();
    const ax = side.clone().addScaledVector(t, -side.dot(t)).normalize();
    const ay = new THREE.Vector3().crossVectors(t, ax).normalize();
    return { c: new THREE.Vector3(p[0], p[1], p[2]), ax, ay, rx: p[3], ry: p[4], n };
  });
}

/** Chiude una serie di sezioni con due poli (punta e coda arrotondate). */
function capped(rings: Ring[], depthA: number, depthB: number, steps: number): Ring[] {
  const out = [...rings];
  const dA = rings[0].c.clone().sub(rings[1].c).normalize();
  const dB = rings[rings.length - 1].c.clone().sub(rings[rings.length - 2].c).normalize();
  const dome = (r: Ring, d: THREE.Vector3, depth: number) => {
    const res: Ring[] = [];
    for (let j = 1; j <= steps; j++) {
      const a = (j / steps) * (Math.PI / 2);
      res.push({ ...r, c: r.c.clone().addScaledVector(d, Math.sin(a) * depth), rx: j === steps ? 0 : r.rx * Math.cos(a), ry: j === steps ? 0 : r.ry * Math.cos(a) });
    }
    return res;
  };
  if (depthA > 0) out.unshift(...dome(rings[0], dA, depthA).reverse());
  if (depthB > 0) out.push(...dome(rings[rings.length - 1], dB, depthB));
  return out;
}

// ---------- bici ----------

function buildBike(P: Parts, L: Lod, rim: Rim) {
  const { bb, headTop: HT, headBottom: HBo, seatTop: ST, rearAxle: RA, frontAxle: FA } = BIKE;
  const t = L.tube;
  const th = L.thin;
  const steps = L.dome;
  const BBv = vec(bb);
  const HB = vec(HBo);
  // tubo obliquo, il più grosso, con la scritta
  const down = segmentLoft(
    vec([0, bb[1] + 0.005, bb[2] + 0.01]),
    vec([0, HBo[1] + 0.015, HBo[2] - 0.004]),
    X,
    L.mid
      ? [
          [0, 0.021, 0.03],
          [0.5, 0.02, 0.031],
          [1, 0.022, 0.029],
        ]
      : [
          [0, 0.021, 0.03],
          [1, 0.022, 0.029],
        ],
    t,
    { n: 2.4, phase: -Math.PI / 2 },
  );
  P.abs(swapUv(down), B.bike, L.mid ? ATLAS.decal : 'frame');
  // orizzontale, verticale, sterzo
  P.abs(
    segmentLoft(vec([0, 0.785, -0.142]), vec([0, 0.848, 0.47]), X, [
      [0, 0.016, 0.017],
      [1, 0.017, 0.019],
    ], t, { n: 2.4 }),
    B.bike,
    'frame',
  );
  P.abs(
    segmentLoft(vec([0, bb[1], bb[2]]), vec([0, ST[1] - 0.005, ST[2] + 0.001]), X, L.mid ? [
      [0, 0.018, 0.026],
      [0.6, 0.016, 0.024],
      [1, 0.017, 0.021],
    ] : [
      [0, 0.018, 0.026],
      [1, 0.017, 0.021],
    ], t, { n: 2.3 }),
    B.bike,
    'frame',
  );
  P.abs(
    segmentLoft(vec([0, HBo[1] - 0.012, HBo[2] + 0.003]), vec([0, HT[1] + 0.008, HT[2] - 0.002]), X, [
      [0, 0.026, 0.028],
      [1, 0.021, 0.023],
    ], t, { n: 2.2 }),
    B.bike,
    'frame',
  );
  if (L.mid) {
    // giunzione sella e scatola del movimento centrale
    P.abs(ellipsoid([0, 0.79, -0.143], [0.021, 0.026, 0.024], L.small), B.bike, 'frame');
    P.abs(
      latheX(
        [
          [0, -0.046],
          [0.026, -0.046],
          [0.026, 0.046],
          [0, 0.046],
        ],
        L.small,
      ).translate(0, bb[1], bb[2]),
      B.bike,
      'frame',
    );
  }
  // foderi: orizzontali bassi, verticali che scendono dal tubo sella
  for (const s of [-1, 1]) {
    P.abs(
      segmentLoft(vec([s * 0.03, bb[1] + 0.005, bb[2] - 0.03]), vec([s * 0.062, RA[1], RA[2] + 0.01]), X, [
        [0, 0.012, 0.017],
        [1, 0.008, 0.01],
      ], th, { n: 2.2 }),
      B.bike,
      'frame',
    );
    P.abs(
      segmentLoft(vec([s * 0.014, 0.735, -0.138]), vec([s * 0.062, RA[1] + 0.012, RA[2] + 0.008]), X, [
        [0, 0.009, 0.012],
        [1, 0.007, 0.009],
      ], th, { n: 2.2 }),
      B.bike,
      'frame',
    );
    // forcellini
    if (L.fine) P.abs(ellipsoid([s * 0.062, RA[1] + 0.004, RA[2] + 0.004], [0.006, 0.02, 0.018], 6), B.bike, 'frame');
  }
  // reggisella aero e sella
  P.abs(
    segmentLoft(vec([0, ST[1] - 0.03, ST[2] + 0.008]), vec([0, 0.948, -0.197]), X, [
      [0, 0.013, 0.019],
      [1, 0.013, 0.019],
    ], th, { n: 2.4 }),
    B.bike,
    'carbon',
  );
  const saddleRings: [number, number, number, number, number][] = [
    [0, 0.975, -0.335, 0.066, 0.017],
    [0, 0.969, -0.3, 0.071, 0.02],
    [0, 0.966, -0.25, 0.062, 0.02],
    [0, 0.966, -0.19, 0.036, 0.018],
    [0, 0.967, -0.13, 0.021, 0.016],
    [0, 0.968, -0.075, 0.017, 0.014],
  ];
  const saddle = capped(ringsAlong(L.mid ? saddleRings : saddleRings.filter((_, i) => i % 2 === 1), X, 3), 0.012, 0.016, steps);
  P.abs(loft(saddle, Math.max(4, t - 2)), B.bike, 'saddle');
  if (L.fine) {
    P.abs(segmentLoft(vec([0, 0.94, -0.215]), vec([0, 0.955, -0.17]), X, [[0, 0.016, 0.012], [1, 0.016, 0.012]], 6, { n: 4 }), B.bike, 'black');
    for (const s of [-1, 1])
      P.abs(segmentLoft(vec([s * 0.022, 0.951, -0.3]), vec([s * 0.018, 0.955, -0.09]), X, [[0, 0.0035, 0.0035], [1, 0.0035, 0.0035]], 3), B.bike, 'metal');
  }
  // borraccia sul tubo obliquo
  if (L.mid) {
    const dDir = vec(HBo).sub(BBv).normalize();
    const dUp = new THREE.Vector3().crossVectors(X, dDir).negate().normalize();
    const b0 = BBv.clone().lerp(HB, 0.3).addScaledVector(dUp, 0.062);
    const b1 = BBv.clone().lerp(HB, 0.72).addScaledVector(dUp, 0.062);
    P.abs(
      segmentLoft(b0, b1, X, [
        [0, 0.033, 0.033],
        [0.8, 0.034, 0.034],
        [0.92, 0.018, 0.018],
        [1, 0.014, 0.014],
      ], th, { domeA: 0.012, domeSteps: steps }),
      B.bike,
      'bottle',
    );
    if (L.fine) P.abs(segmentLoft(b1, b1.clone().addScaledVector(dDir, 0.022), X, [[0, 0.014, 0.014], [1, 0.012, 0.012]], 6, { domeB: 0.006, domeSteps: 1 }), B.bike, 'black');
  }

  // ---- sterzo: forcella, attacco, piega, leve ----
  if (L.mid) P.abs(ellipsoid([0, HBo[1] - 0.018, HBo[2] + 0.01], [0.05, 0.022, 0.034], L.small), B.steer, 'frame');
  for (const s of [-1, 1]) {
    const top = vec([s * 0.042, HBo[1] - 0.02, HBo[2] + 0.012]);
    const mid = vec([s * 0.05, 0.47, 0.565]);
    const tip = vec([s * 0.052, FA[1], FA[2] + 0.004]);
    P.abs(segmentLoft(top, mid, X, [[0, 0.015, 0.022], [1, 0.012, 0.018]], th, { n: 2.3 }), B.steer, 'frame');
    P.abs(segmentLoft(mid, tip, X, [[0, 0.012, 0.018], [1, 0.009, 0.013]], th, { n: 2.3, domeB: L.mid ? 0.01 : 0, domeSteps: 1 }), B.steer, 'frameAccent');
  }
  if (L.mid) P.abs(segmentLoft(vec([0, HT[1], HT[2]]), vec([0, 0.893, 0.4605]), X, [[0, 0.019, 0.019], [1, 0.018, 0.018]], th), B.steer, 'carbon');
  const bar = vec(BIKE.bar);
  P.abs(
    segmentLoft(vec([0, 0.882, 0.458]), bar.clone().add(vec([0, 0, 0.01])), X, [
      [0, 0.019, 0.021],
      [1, 0.02, 0.02],
    ], th, { n: 3.2, domeA: L.mid ? 0.012 : 0, domeSteps: 1 }),
    B.steer,
    'carbon',
  );
  // piega: parte centrale nuda, poi nastro fino alla fine delle curve basse
  const side = (s: number) =>
    (L.mid
      ? [
          [s * 0.2, -0.123, -0.045],
          [s * 0.205, -0.128, 0.005],
          [s * 0.208, -0.11, 0.06],
          [s * 0.208, -0.07, 0.088],
          [s * 0.207, -0.025, 0.088],
          [s * 0.205, -0.003, 0.07],
          [s * 0.195, 0.002, 0.035],
          [s * 0.165, 0.003, 0.008],
          [s * 0.11, 0.003, 0],
          [s * 0.06, 0.003, 0],
        ]
      : [
          [s * 0.2, -0.123, -0.03],
          [s * 0.208, -0.09, 0.08],
          [s * 0.206, -0.01, 0.075],
          [s * 0.17, 0.003, 0.01],
          [s * 0.06, 0.003, 0],
        ]
    ).map((p) => bar.clone().add(vec(p as unknown as V3)));
  for (const s of [-1, 1]) P.abs(pathTube(side(s), () => 0.0128, L.barSeg, L.bar), B.steer, 'tape');
  P.abs(segmentLoft(bar.clone().add(vec([-0.062, 0.003, 0])), bar.clone().add(vec([0.062, 0.003, 0])), Z, [[0, 0.0118, 0.0118], [1, 0.0118, 0.0118]], L.barSeg), B.steer, 'carbon');
  for (const s of [-1, 1]) {
    // tappo in fondo alla curva bassa
    if (L.fine) P.abs(ellipsoid([s * 0.2, bar.y - 0.123, bar.z - 0.046], [0.012, 0.012, 0.006], 6), B.steer, 'black');
    // corpo della leva (il «cappuccio» su cui stanno le mani) e la leva del freno
    const hx = s * 0.205;
    const hoodRings: [number, number, number, number, number][] = [
      [hx, 0.89, 0.648, 0.016, 0.019],
      [hx, 0.9, 0.675, 0.017, 0.022],
      [hx, 0.909, 0.705, 0.016, 0.022],
      [hx, 0.918, 0.728, 0.013, 0.019],
      [hx, 0.93, 0.742, 0.01, 0.012],
    ];
    const hood = capped(ringsAlong(L.mid ? hoodRings : [hoodRings[0], hoodRings[2], hoodRings[4]], X, 2.4), 0, L.mid ? 0.008 : 0, Math.max(1, steps - 1));
    P.abs(loft(hood, L.thin), B.steer, 'hood');
    if (L.mid)
      P.abs(
        pathTube(
          [
            [hx, 0.905, 0.736],
            [s * 0.207, 0.86, 0.735],
            [s * 0.21, 0.8, 0.72],
            [s * 0.212, 0.765, 0.695],
          ].map((p) => vec(p as unknown as V3)),
          (u) => [0.005, 0.011 - u * 0.004] as const,
          4,
          L.fine ? 6 : 3,
        ),
        B.steer,
        'carbon',
      );
  }

  // ---- ruote ----
  buildWheel(P, L, B.wheelF, rim === 'basso' ? 'basso' : 'alto', L.spokes[0], false);
  buildWheel(P, L, B.wheelR, rim, L.spokes[1], true);

  // ---- trasmissione ----
  buildDrivetrain(P, L);
}

const RIM_DEPTH = { basso: 0.024, alto: 0.058 } as const;

/** Un pezzo di cerchio: i profili sono scritti dal fianco sinistro al destro, il tornio li vuole al contrario. */
function rimLathe(pts: [number, number][], seg: number): THREE.BufferGeometry {
  return latheX(
    pts.map(([r, x]) => [r, -x] as [number, number]),
    seg,
  );
}

function buildWheel(P: Parts, L: Lod, bone: number, rim: Rim, spokes: number, rear: boolean) {
  const R = BIKE.wheelR;
  const tr = 0.0135;
  const seg = L.wheel;
  const tyre = new THREE.TorusGeometry(R - tr, tr, L.tyre, seg);
  tyre.rotateY(Math.PI / 2);
  P.local(tyre, bone, 'tyre');
  const Rb = R - 0.021;
  if (rim === 'lenticolare') {
    // ruota lenticolare: due calotte appena bombate, una fascia dell'accento
    const w = (r: number) => 0.0115 + (0.036 - 0.0115) * (1 - (r - 0.03) / (Rb - 0.03)) ** 1.6;
    const bands: [number, number, Swatch][] = L.mid
      ? [
          [Rb, 0.24, 'rim'],
          [0.24, 0.222, 'rimStripe'],
          [0.222, 0.03, 'rim'],
        ]
      : [[Rb, 0.03, 'rim']];
    for (const s of [-1, 1])
      for (const [r0, r1, sw] of bands) {
        // a sinistra il profilo va dal mozzo al bordo, a destra al contrario: facce verso l'esterno
        const pts: [number, number][] = L.fine
          ? [
              [r0, s * w(r0)],
              [(r0 + r1) / 2, s * w((r0 + r1) / 2)],
              [r1, s * w(r1)],
            ]
          : [
              [r0, s * w(r0)],
              [r1, s * w(r1)],
            ];
        P.local(latheX(s < 0 ? pts.reverse() : pts, seg), bone, sw);
      }
  } else {
    const D = RIM_DEPTH[rim];
    const inner = Rb - D;
    const s1 = Rb - D * 0.3;
    const s2 = Rb - D * 0.45;
    // profilo del cerchio, da fuori a sinistra giù fino al canale dei raggi e su a destra
    if (!L.mid)
      P.local(
        rimLathe(
          [
            [Rb, -0.012],
            [inner, 0],
            [Rb, 0.012],
          ],
          seg,
        ),
        bone,
        'rim',
      );
    else if (rim === 'alto') {
      // il cerchio alto ha una fascia dell'accento a metà parete
      P.local(rimLathe([[Rb + 0.003, -0.0105], [Rb, -0.0118], [s1, -0.013]], seg), bone, 'rim');
      P.local(rimLathe([[s1, -0.013], [s2, -0.0138]], seg), bone, 'rimStripe');
      P.local(rimLathe([[s2, -0.0138], [inner, 0], [s2, 0.0138]], seg), bone, 'rim');
      P.local(rimLathe([[s2, 0.0138], [s1, 0.013]], seg), bone, 'rimStripe');
      P.local(rimLathe([[s1, 0.013], [Rb, 0.0118], [Rb + 0.003, 0.0105]], seg), bone, 'rim');
    } else
      P.local(
        rimLathe(
          [
            [Rb + 0.003, -0.0105],
            [Rb, -0.0118],
            [s2, -0.0138],
            [inner, 0],
            [s2, 0.0138],
            [Rb, 0.0118],
            [Rb + 0.003, 0.0105],
          ],
          seg,
        ),
        bone,
        'rim',
      );
    // raggi: dal mozzo al cerchio, incrociati dietro
    const ri = inner + 0.002;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const s = i % 2 ? 1 : -1;
      const cross = rear ? (i % 4 < 2 ? 0.32 : -0.32) : 0;
      const a0 = a + cross;
      const from = new THREE.Vector3(s * 0.028, Math.cos(a0) * 0.026, Math.sin(a0) * 0.026);
      const to = new THREE.Vector3(s * 0.003, Math.cos(a) * ri, Math.sin(a) * ri);
      P.local(
        segmentLoft(from, to, X, [
          [0, 0.0011, 0.0011],
          [1, 0.0011, 0.0011],
        ], 3),
        bone,
        'spoke',
      );
    }
  }
  // mozzo con le flange
  if (L.hub > 0)
    P.local(
      latheX(
        L.fine
          ? [
              [0, -0.052],
              [0.011, -0.052],
              [0.011, -0.036],
              [0.027, -0.031],
              [0.016, -0.024],
              [0.016, 0.024],
              [0.027, 0.031],
              [0.011, 0.036],
              [0.011, 0.052],
              [0, 0.052],
            ]
          : [
              [0, -0.05],
              [0.02, -0.04],
              [0.02, 0.04],
              [0, 0.05],
            ],
        L.hub,
      ),
      bone,
      'hub',
    );
  if (L.fine) {
    // disco del freno a sinistra (+x)
    P.local(gearRing(0.08, 0.058, 0.0022, 24).translate(0.043, 0, 0), bone, 'rotor');
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      P.local(
        segmentLoft(vec([0.043, Math.cos(a) * 0.02, Math.sin(a) * 0.02]), vec([0.043, Math.cos(a + 0.3) * 0.06, Math.sin(a + 0.3) * 0.06]), X, [[0, 0.002, 0.006], [1, 0.002, 0.005]], 4, { n: 4 }),
        bone,
        'black',
      );
    }
  }
  if (rear && L.cassette > 0) {
    if (L.cassette > 1) {
      const radii = [0.05, 0.041, 0.032];
      radii.slice(0, L.cassette).forEach((r, i) => P.local(gearRing(r, 0.014, 0.0024, 16).translate(-(0.027 + i * 0.012), 0, 0), bone, 'metal'));
    } else
      P.local(
        latheX(
          [
            [0.014, -0.056],
            [0.026, -0.056],
            [0.048, -0.03],
            [0.048, -0.022],
            [0.014, -0.022],
          ],
          8,
        ),
        bone,
        'metal',
      );
  }
}

function buildDrivetrain(P: Parts, L: Lod) {
  const Lc = BIKE.crank;
  const bb = vec(BIKE.bb);
  const ra = vec(BIKE.rearAxle);
  const CL = -0.056; // linea catena, a destra (−x)
  // guarnitura, nel riferimento della pedivella (destra in alto)
  P.local(gearRing(0.104, 0.084, 0.004, L.ring, L.teeth, 0.0035).translate(CL - 0.004, 0, 0), B.crank, 'chainring');
  if (L.fine) P.local(gearRing(0.078, 0.066, 0.004, 20).translate(CL + 0.004, 0, 0), B.crank, 'chainring');
  if (L.fine)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      P.local(
        segmentLoft(vec([CL - 0.006, 0, 0]), vec([CL - 0.006, Math.cos(a) * 0.09, Math.sin(a) * 0.09]), X, [[0, 0.006, 0.014], [1, 0.004, 0.009]], 4, { n: 4 }),
        B.crank,
        'black',
      );
    }
  if (L.mid) P.local(segmentLoft(vec([-0.082, 0, 0]), vec([0.082, 0, 0]), Z, [[0, 0.012, 0.012], [1, 0.012, 0.012]], L.small), B.crank, 'black');
  for (const s of [-1, 1]) {
    const x = s * 0.074;
    P.local(
      segmentLoft(vec([x, 0, 0]), vec([s * 0.082, -s * Lc, 0]), Z, [
        [0, 0.017, 0.008],
        [1, 0.011, 0.007],
      ], L.thin, { n: 2.5, domeA: L.mid ? 0.014 : 0, domeB: L.mid ? 0.01 : 0, domeSteps: 1 }),
      B.crank,
      'black',
    );
  }
  // pedali, nel riferimento del piede (punta avanti)
  if (L.mid)
    for (const bone of [B.pedalL, B.pedalR]) {
      const s = bone === B.pedalR ? -1 : 1;
      const body = capped(
        ringsAlong(
          [
            [0, -0.002, -0.032, 0.026, 0.006],
            [0, 0, -0.012, 0.034, 0.0085],
            [0, 0.001, 0.022, 0.033, 0.0085],
            [0, 0, 0.04, 0.022, 0.006],
          ],
          X,
          3.5,
        ),
        L.fine ? 0.005 : 0,
        L.fine ? 0.006 : 0,
        1,
      );
      P.local(loft(body, L.small), bone, 'pedal');
      if (L.fine) P.local(segmentLoft(vec([-s * 0.03, 0, 0]), vec([s * 0.02, 0, 0]), Z, [[0, 0.005, 0.005], [1, 0.005, 0.005]], 5), bone, 'metal');
    }
  if (L.chain > 0) {
    // catena: sopra dritta, intorno al pignone, giù nel cambio, sotto fino alla corona
    const pts: THREE.Vector3[] = [];
    const rc = 0.106;
    const rp = 0.036;
    const pulleyA = new THREE.Vector3(CL, ra.y - 0.058, ra.z + 0.005);
    const pulleyB = new THREE.Vector3(CL, ra.y - 0.118, ra.z + 0.035);
    for (let i = 0; i <= 8; i++) {
      // corona, davanti: da sotto a sopra passando per il davanti
      const b = (i / 8) * Math.PI;
      pts.push(new THREE.Vector3(CL, bb.y - Math.cos(b) * rc, bb.z + Math.sin(b) * rc));
    }
    for (let i = 1; i <= 5; i++) pts.push(new THREE.Vector3(CL, bb.y + rc + ((ra.y + rp - bb.y - rc) * i) / 6, bb.z + ((ra.z - bb.z) * i) / 6));
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 0.95;
      pts.push(new THREE.Vector3(CL, ra.y + Math.cos(a) * rp, ra.z - Math.sin(a) * rp));
    }
    pts.push(pulleyA.clone().add(vec([0, 0.0, -0.016])), pulleyA.clone().add(vec([0, -0.03, -0.012])), pulleyB.clone().add(vec([0, -0.002, -0.016])), pulleyB.clone().add(vec([0, -0.016, 0])));
    for (let i = 1; i <= 5; i++) pts.push(pulleyB.clone().add(vec([0, -0.016, 0])).lerp(new THREE.Vector3(CL, bb.y - rc, bb.z), i / 6));
    P.abs(pathTube(pts, () => [0.0032, 0.0045] as const, 4, L.chain, { closed: true }), B.bike, 'metal');
    // cambio posteriore: corpo, gabbia e due pulegge
    P.abs(segmentLoft(vec([CL - 0.01, ra.y - 0.012, ra.z - 0.008]), vec([CL - 0.014, ra.y - 0.05, ra.z + 0.004]), Z, [[0, 0.01, 0.014], [1, 0.012, 0.016]], 6, { domeA: 0.008, domeB: 0.008, domeSteps: 1 }), B.bike, 'black');
    P.abs(segmentLoft(pulleyA.clone().add(vec([-0.007, 0, 0])), pulleyB.clone().add(vec([-0.007, 0, 0])), X, [[0, 0.002, 0.016], [1, 0.002, 0.016]], 4, { n: 3 }), B.bike, 'black');
    for (const p of [pulleyA, pulleyB]) P.abs(gearRing(0.016, 0.004, 0.006, 10).translate(p.x, p.y, p.z), B.bike, 'black');
    // deragliatore anteriore sul tubo verticale
    P.abs(segmentLoft(vec([CL - 0.004, 0.39, -0.03]), vec([CL - 0.004, 0.375, 0.035]), X, [[0, 0.004, 0.012], [1, 0.004, 0.009]], 4, { n: 3 }), B.bike, 'black');
    // pinze dei freni a disco, a sinistra
    P.abs(segmentLoft(vec([0.05, 0.392, 0.548]), vec([0.05, 0.36, 0.53]), X, [[0, 0.011, 0.02], [1, 0.011, 0.02]], 6, { n: 3, domeA: 0.006, domeB: 0.006, domeSteps: 1 }), B.steer, 'black');
    P.abs(segmentLoft(vec([0.05, 0.378, -0.36]), vec([0.05, 0.37, -0.315]), X, [[0, 0.011, 0.018], [1, 0.011, 0.018]], 6, { n: 3, domeA: 0.006, domeB: 0.006, domeSteps: 1 }), B.bike, 'black');
  }
}

// ---------- corpo ----------

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function buildBody(P: Parts, L: Lod) {
  const bind = P.bind;
  const steps = L.dome;
  const pelvis = new THREE.Vector3().setFromMatrixPosition(bind[B.pelvis]);
  const neck = new THREE.Vector3().setFromMatrixPosition(bind[B.head]);

  // busto: dal sedere (dentro la sella) alla base del collo, sezioni un po' squadrate
  const spine: [number, number, number, number, number, number][] = [
    // y, z, semilarghezza, semiprofondità, esponente, scostamento verso la pancia
    [0.99, -0.215, 0.135, 0.085, 2.3, 0],
    [1.03, -0.19, 0.163, 0.104, 2.4, 0],
    [1.085, -0.12, 0.152, 0.098, 2.4, 0],
    [1.16, -0.02, 0.156, 0.108, 2.4, 0.004],
    [1.24, 0.09, 0.168, 0.122, 2.5, 0.008],
    [1.31, 0.19, 0.188, 0.118, 2.8, 0.006],
    [1.352, 0.245, 0.182, 0.092, 3.2, 0],
    [1.388, 0.292, 0.085, 0.064, 2.4, 0],
  ];
  const torsoRings: Ring[] = spine.map(([y, z, rx, ry, n, off], i) => {
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(spine.length - 1, i + 1)];
    const tg = new THREE.Vector3(0, next[0] - prev[0], next[1] - prev[1]).normalize();
    const ay = new THREE.Vector3().crossVectors(X, tg).normalize();
    return { c: new THREE.Vector3(0, y, z).addScaledVector(ay, off), ax: X.clone(), ay, rx, ry, n };
  });
  // si chiude sotto (nella sella) e sopra (sotto il collo); gli anelli intermedi seguono il dettaglio
  const keep = L.mid ? torsoRings : torsoRings.filter((_, i) => i % 2 === 1 || i === torsoRings.length - 2);
  const rings = capped(keep, 0.05, 0.03, steps);
  const torso = loft(rings, L.torso, { phase: Math.PI / 2 });
  const axis0 = pelvis.clone().add(new THREE.Vector3(0, -0.03, -0.04));
  const axis = neck.clone().sub(axis0);
  const len2 = axis.lengthSq();
  P.abs(
    torso,
    (p) => {
      const t = p.clone().sub(axis0).dot(axis) / len2;
      return [B.pelvis, B.chest, smooth(0.18, 0.62, t)];
    },
    ATLAS.jersey,
  );

  // collo, dal busto alla testa
  const nA = vec([0, 1.36, 0.255]);
  const nB = neck.clone().add(vec([0, 0.05, 0.045]));
  const nAxis = nB.clone().sub(nA);
  const nLen2 = nAxis.lengthSq();
  P.abs(
    segmentLoft(nA, nB, X, L.mid ? [[0, 0.056, 0.052], [0.5, 0.047, 0.046], [1, 0.045, 0.047]] : [[0, 0.056, 0.052], [1, 0.045, 0.047]], L.thin),
    (p) => [B.chest, B.head, smooth(0.2, 0.85, p.clone().sub(nA).dot(nAxis) / nLen2)],
    'skin',
  );

  buildHead(P, L);

  // braccia: manica fino a metà omero, poi pelle e guanto
  for (const s of [-1, 1]) {
    const up = s < 0 ? B.upperArmR : B.upperArmL;
    const fo = s < 0 ? B.forearmR : B.forearmL;
    const O = new THREE.Vector3();
    for (const [g, uv] of banded(
      O,
      new THREE.Vector3(0, -BODY.upperArm, 0),
      X,
      L.mid
        ? [
            [0, 0.054, 0.056],
            [0.15, 0.054, 0.056],
            [0.5, 0.043, 0.047, -0.003],
            [0.85, 0.037, 0.036],
            [1, 0.034, 0.033],
          ]
        : [
            [0, 0.054, 0.056],
            [1, 0.034, 0.033],
          ],
      [
        [0, 0.5, flipV(ATLAS.sleeve)],
        [0.5, 1, 'skin'],
      ],
      L.limb,
      { domeA: 0.05, domeB: 0.028, domeSteps: steps, phase: Math.PI / 2 },
    ))
      P.local(g, up, uv);
    for (const [g, uv] of banded(
      O,
      new THREE.Vector3(0, -BODY.forearm, 0),
      X,
      L.mid
        ? [
            [0, 0.034, 0.032],
            [0.22, 0.037, 0.034, 0.003],
            [0.7, 0.028, 0.023],
            [1, 0.025, 0.019],
          ]
        : [
            [0, 0.035, 0.033],
            [1, 0.025, 0.019],
          ],
      L.mid
        ? [
            [0, 0.84, 'skin'],
            [0.84, 1, 'gloveBack'],
          ]
        : [[0, 1, 'skin']],
      L.limb,
      { domeA: 0.03, domeB: 0.02, domeSteps: steps },
    ))
      P.local(g, fo, uv);
    buildHand(P, L, s);
  }

  // gambe: pantaloncini con l'elastico, poi pelle; calzino e scarpa
  for (const s of [-1, 1]) {
    const thigh = s < 0 ? B.thighR : B.thighL;
    const shin = s < 0 ? B.shinR : B.shinL;
    const O = new THREE.Vector3();
    for (const [g, uv] of banded(
      O,
      new THREE.Vector3(0, -BODY.thigh, 0),
      X,
      L.mid
        ? [
            [0, 0.083, 0.08],
            [0.15, 0.078, 0.079, 0.006],
            [0.45, 0.067, 0.066, 0.006],
            [0.75, 0.056, 0.054, 0.002],
            [0.92, 0.05, 0.05],
            [1, 0.048, 0.048],
          ]
        : [
            [0, 0.083, 0.08],
            [0.45, 0.067, 0.066, 0.006],
            [1, 0.048, 0.048],
          ],
      L.mid
        ? [
            [0, 0.7, 'shorts'],
            [0.7, 0.77, 'shortsHem'],
            [0.77, 1, 'skin'],
          ]
        : [
            [0, 0.74, 'shorts'],
            [0.74, 1, 'skin'],
          ],
      L.limb,
      { domeA: 0.06, domeB: 0.045, domeSteps: steps },
    ))
      P.local(g, thigh, uv);
    for (const [g, uv] of banded(
      O,
      new THREE.Vector3(0, -BODY.shin, 0),
      X,
      L.mid
        ? [
            [0, 0.046, 0.046],
            [0.12, 0.048, 0.051, -0.006],
            [0.3, 0.049, 0.057, -0.014],
            [0.55, 0.037, 0.042, -0.007],
            [0.8, 0.029, 0.031, -0.002],
            [1, 0.027, 0.03],
          ]
        : [
            [0, 0.046, 0.046],
            [0.3, 0.049, 0.057, -0.014],
            [1, 0.027, 0.03],
          ],
      L.mid
        ? [
            [0, 0.6, 'skin'],
            [0.6, 0.67, 'sockCuff'],
            [0.67, 1, 'sock'],
          ]
        : [
            [0, 0.64, 'skin'],
            [0.64, 1, 'sock'],
          ],
      L.limb,
      { domeA: 0.04, domeB: 0.03, domeSteps: steps },
    ))
      P.local(g, shin, uv);
    buildShoe(P, L, s);
  }
}

function buildHead(P: Parts, L: Lod) {
  const seg = L.head;
  // cranio e viso (riferimento della testa: origine all'atlante, viso verso +z)
  const skull = new THREE.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.7)));
  const pos = skull.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    // mandibola più stretta, mento in avanti, nuca piena
    if (y < 0) x *= 1 - 0.28 * -y;
    if (y < 0 && z > 0) z *= 1 + 0.12 * -y;
    x *= 0.074;
    y *= 0.105;
    z *= z > 0 ? 0.1 : 0.098;
    pos.setXYZ(i, x, y + 0.075, z + 0.055);
  }
  skull.computeVertexNormals();
  P.local(skull, B.head, 'skin');
  if (L.mid) {
    P.local(ellipsoid([0, 0.068, 0.158], [0.011, 0.02, 0.018], L.small - 2), B.head, 'skin');
    for (const s of [-1, 1]) P.local(ellipsoid([s * 0.073, 0.072, 0.045], [0.011, 0.027, 0.019], L.small - 2), B.head, 'skin');
  }
  if (L.fine) {
    for (const s of [-1, 1]) P.local(ellipsoid([s * 0.03, 0.092, 0.142], [0.011, 0.007, 0.006], 5), B.head, 'eye');
    // capelli che escono dal casco dietro
    const hair = new THREE.SphereGeometry(1, 10, 5, Math.PI, Math.PI, 0.3 * Math.PI, 0.32 * Math.PI);
    hair.scale(0.078, 0.104, 0.101);
    hair.translate(0, 0.078, 0.053);
    P.local(hair, B.head, 'hair');
  }

  // casco: guscio a fette dalla fronte alla nuca, bordo più alto davanti
  const [nu, na] = L.helmet;
  const key = [
    // s, z, y bordo, semilarghezza, altezza
    [0, 0.16, 0.118, 0.06, 0.01],
    [0.12, 0.138, 0.114, 0.082, 0.05],
    [0.35, 0.07, 0.1, 0.091, 0.092],
    [0.6, -0.02, 0.078, 0.09, 0.104],
    [0.85, -0.108, 0.045, 0.077, 0.082],
    [1, -0.155, 0.035, 0.044, 0.03],
  ];
  const at = (s: number) => {
    for (let i = 1; i < key.length; i++)
      if (s <= key[i][0]) {
        const k = (s - key[i - 1][0]) / (key[i][0] - key[i - 1][0]);
        const e = k * k * (3 - 2 * k);
        return key[i - 1].map((v, j) => v + (key[i][j] - v) * (j === 0 ? k : e));
      }
    return key[key.length - 1];
  };
  const hp: number[] = [];
  const huv: number[] = [];
  const hi: number[] = [];
  // il guscio scende un po' sotto il bordo ai lati: avvolge le tempie invece di posarsi sopra
  const a0 = -0.3;
  const a1 = Math.PI + 0.3;
  for (let i = 0; i <= nu; i++) {
    const [, z, yr, w, h] = at(i / nu);
    for (let j = 0; j <= na; j++) {
      const a = a0 + ((a1 - a0) * j) / na;
      hp.push(-Math.cos(a) * w * (1 - 0.06 * Math.max(0, -Math.sin(a))), yr + Math.sin(a) * (h + 0.012), z);
      huv.push(i / nu, j / na);
    }
  }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j;
      const b = a + 1;
      const c = a + na + 1;
      const d = c + 1;
      hi.push(a, b, c, b, d, c);
    }
  const helmet = new THREE.BufferGeometry();
  helmet.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
  helmet.setAttribute('uv', new THREE.Float32BufferAttribute(huv, 2));
  helmet.setIndex(hi);
  helmet.computeVertexNormals();
  P.local(helmet, B.head, ATLAS.helmet);
  if (L.fine) {
    // cinghietti sotto il mento
    for (const s of [-1, 1]) {
      const under2 = vec([s * 0.06, 0.03, 0.065]);
      P.local(pathTube([vec([s * 0.08, 0.085, 0.1]), under2, vec([s * 0.03, -0.01, 0.11]), vec([0, -0.02, 0.114])], () => 0.0026, 3, 6), B.head, 'strap');
      P.local(pathTube([vec([s * 0.082, 0.06, -0.01]), under2], () => 0.0026, 3, 2), B.head, 'strap');
    }
  }

  // occhiali avvolgenti: lente curva davanti agli occhi, montatura sopra e stanghette
  const gl: number[] = [];
  const guv: number[] = [];
  const gi: number[] = [];
  const cols = L.fine ? 14 : L.mid ? 6 : 3;
  const rows = L.fine ? 2 : 1;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const a = -1.32 + (2.64 * c) / cols;
      const yb = 0.075 + (0.036 * r) / rows;
      const bulge = 1 + 0.03 * Math.sin((Math.PI * r) / rows);
      gl.push(Math.sin(a) * 0.086 * bulge, yb - 0.006 * Math.cos(a), 0.047 + Math.cos(a) * 0.126 * bulge);
      guv.push(c / cols, r / rows);
    }
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      gi.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
    }
  const lens = new THREE.BufferGeometry();
  lens.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
  lens.setAttribute('uv', new THREE.Float32BufferAttribute(guv, 2));
  lens.setIndex(gi);
  lens.computeVertexNormals();
  P.local(lens, B.glasses, 'lens');
  if (L.mid) {
    const top: THREE.Vector3[] = [];
    for (let c = 0; c <= 8; c++) {
      const a = -1.32 + (2.64 * c) / 8;
      top.push(new THREE.Vector3(Math.sin(a) * 0.088, 0.113 - 0.006 * Math.cos(a), 0.047 + Math.cos(a) * 0.128));
    }
    P.local(pathTube(top, () => 0.0042, L.fine ? 4 : 3, L.fine ? 12 : 6), B.glasses, 'glassesFrame');
    if (L.fine) for (const s of [-1, 1]) P.local(pathTube([vec([s * 0.084, 0.108, 0.068]), vec([s * 0.08, 0.1, 0.0]), vec([s * 0.072, 0.085, -0.03])], () => 0.003, 3, 3), B.glasses, 'glassesFrame');
  }
}

function buildHand(P: Parts, L: Lod, s: number) {
  const bone = s < 0 ? B.handR : B.handL;
  const seg = L.small;
  // dorso della mano sul cappuccio della leva
  P.local(ellipsoid([s * 0.002, 0.004, -0.012], [0.028, 0.019, 0.05], seg), bone, 'gloveBack');
  // dita chiuse intorno alla leva, dal lato esterno, e il pollice dall'interno
  P.local(ellipsoid([s * 0.021, -0.012, 0.03], [0.014, 0.028, 0.026], seg), bone, 'glove');
  if (L.fine) P.local(segmentLoft(vec([-s * 0.016, 0.004, -0.018]), vec([-s * 0.02, -0.006, 0.03]), X, [[0, 0.011, 0.01], [1, 0.008, 0.008]], 6, { domeB: 0.008, domeSteps: 1 }), bone, 'glove');
}

function buildShoe(P: Parts, L: Lod, s: number) {
  const bone = s < 0 ? B.footR : B.footL;
  const seg = L.thin + 2;
  // riferimento del piede: origine alla caviglia, punta verso +z
  const upper = capped(
    ringsAlong(
      (
        [
          [0, -0.045, -0.074, 0.03, 0.035],
          [0, -0.034, -0.05, 0.036, 0.046],
          [0, -0.03, 0.0, 0.038, 0.05],
          [0, -0.045, 0.06, 0.042, 0.037],
          [0, -0.058, 0.12, 0.044, 0.025],
          [0, -0.065, 0.168, 0.037, 0.017],
          [0, -0.068, 0.19, 0.024, 0.011],
        ] as [number, number, number, number, number][]
      ).filter((_, i) => L.fine || i % 2 === 0),
      X,
      2.5,
    ),
    L.mid ? 0.012 : 0.008,
    0.012,
    Math.max(1, L.dome - 1),
  );
  P.local(loft(upper, seg), bone, 'shoe');
  if (L.mid) {
    const sole = capped(
      ringsAlong(
        [
          [0, -0.077, -0.078, 0.033, 0.0065],
          [0, -0.079, 0.0, 0.037, 0.0065],
          [0, -0.08, 0.12, 0.045, 0.0065],
          [0, -0.077, 0.19, 0.026, 0.006],
        ],
        X,
        4,
      ),
      0.006,
      0.008,
      1,
    );
    P.local(loft(sole, seg), bone, 'sole');
  }
  if (L.fine) {
    // rotella di chiusura e cinghia
    P.local(segmentLoft(vec([s * 0.012, -0.012, 0.035]), vec([s * 0.019, 0.0, 0.035]), new THREE.Vector3(0, 0, 1), [[0, 0.013, 0.013], [1, 0.012, 0.012]], 8, { domeB: 0.003, domeSteps: 1 }), bone, 'shoeAccent');
    P.local(
      pathTube(
        [vec([-0.041, -0.06, 0.085]), vec([-0.02, -0.035, 0.09]), vec([0.02, -0.035, 0.09]), vec([0.041, -0.06, 0.085])],
        () => [0.0025, 0.009] as const,
        4,
        6,
      ),
      bone,
      'shoeAccent',
    );
  }
}

// ---------- assemblaggio e cache ----------

function assemble(detail: RiderDetail, rim: Rim): Parts {
  const L = LOD[detail];
  const P = new Parts(bindMatrices());
  buildBike(P, L, rim);
  buildBody(P, L);
  return P;
}

/** Triangoli per osso e colore, i più costosi prima. */
export function riderBreakdown(detail: RiderDetail, rim: Rim): [string, number][] {
  const P = assemble(detail, rim);
  P.list.forEach((g) => g.dispose());
  return [...P.log].sort((a, b) => b[1] - a[1]);
}

export function buildRiderGeometry(detail: RiderDetail, rim: Rim): THREE.BufferGeometry {
  const P = assemble(detail, rim);
  const geo = mergeParts(P.list);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Geometria condivisa (una per dettaglio e profilo dei cerchi): non va mai liberata a mano. */
export function riderGeometry(detail: RiderDetail, rim: Rim): THREE.BufferGeometry {
  const key = `${detail}|${rim}`;
  let g = cache.get(key);
  if (!g) {
    g = buildRiderGeometry(detail, rim);
    cache.set(key, g);
  }
  return g;
}

export function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

/** Il pedale nella posa di riposo: serve alle prove (il piede deve starci sopra). */
export function bindPedal(right: boolean): THREE.Vector3 {
  return pedalAt(NEUTRAL.crank, right);
}
