import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { TrackPose } from '@/domain/track';
import { DEFAULT_LOOK, lookFromColor, type Look } from '@/game/look';
import { labelTexture, shadowTexture } from './rider';
import { riderGeometry, type RiderDetail } from './riderBuild';
import { kitMaterial, lookKey } from './riderKit';
import { RiderRig, riderMesh } from './riderRig';

export type { RiderDetail } from './riderBuild';

const GHOST_MAT = new THREE.MeshBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.36, depthWrite: false });

/** L'aspetto da usare: quello dato, o uno semplice dal colore della maglia (e del casco). */
export function resolveLook(look?: Look, jersey?: string, helmet?: string): Look {
  if (look) return look;
  if (!jersey) return helmet ? { ...DEFAULT_LOOK, helmet } : DEFAULT_LOOK;
  const l = lookFromColor(jersey);
  return helmet ? { ...l, helmet } : l;
}

export interface RiderProps {
  getPose: () => TrackPose;
  getCadence: () => number;
  getSpeed: () => number;
  /** watt in questo istante: lo scatto lo fa alzare sui pedali */
  getPower?: () => number;
  /** pendenza, se diversa da quella della posa */
  getGrade?: () => number;
  ghost?: boolean;
  /** metri a sinistra dell'asse della strada */
  side?: number;
  /** colore della maglia, se non c'è un aspetto completo */
  jersey?: string;
  helmet?: string;
  label?: string;
  look?: Look;
  /** alta per chi pedala, media o bassa per gli altri */
  detail?: RiderDetail;
  /** oltre questa distanza dalla camera passa al dettaglio basso (metri) */
  lodDistance?: number;
}

/**
 * Un ciclista sulla strada: una maglia con lo scheletro (una chiamata di disegno), l'ombra e
 * l'eventuale nome. Pedala con la cadenza, si alza sui pedali sulle rampe e negli scatti, si
 * raccoglie veloce in pianura, piega in curva.
 */
export function Rider({
  getPose,
  getCadence,
  getSpeed,
  getPower,
  getGrade,
  ghost = false,
  side = 0.6,
  jersey,
  helmet,
  label,
  look: lookProp,
  detail = 'alta',
  lodDistance,
}: RiderProps) {
  const look = resolveLook(lookProp, jersey, helmet);
  const key = lookKey(look);
  const group = useRef<THREE.Group>(null);
  const sprite = useRef<THREE.Sprite>(null);
  const { camera } = useThree();
  const rig = useMemo(() => new RiderRig(), []);
  const mesh = useMemo(() => riderMesh(riderGeometry(detail, look.rim), GHOST_MAT, rig), [rig]); // eslint-disable-line react-hooks/exhaustive-deps
  const far = useRef(false);
  const last = useRef<{ heading: number | null }>({ heading: null });

  // aspetto e dettaglio: si cambiano geometria (condivisa) e materiale (condiviso per aspetto)
  useLayoutEffect(() => {
    mesh.geometry = riderGeometry(far.current ? 'bassa' : detail, look.rim);
    mesh.material = ghost ? GHOST_MAT : kitMaterial(look, detail);
    rig.glasses = !!look.glasses;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh, rig, key, detail, ghost]);

  const labelTex = useMemo(() => (label ? labelTexture(label, look.jersey) : null), [label, look.jersey]);
  useEffect(() => () => labelTex?.dispose(), [labelTex]);
  useEffect(
    () => () => {
      mesh.removeFromParent();
    },
    [mesh],
  );

  useFrame((_, dt) => {
    const pose = getPose();
    const root = group.current;
    if (!root) return;
    root.position.set(pose.x + Math.cos(pose.heading) * side, pose.y, pose.z - Math.sin(pose.heading) * side);
    root.rotation.set(-Math.atan(pose.grade), pose.heading, 0, 'YXZ');
    // velocità di rotazione della direzione, per la piega in curva
    let yaw = 0;
    const h0 = last.current.heading;
    if (h0 != null && dt > 0) {
      let dh = pose.heading - h0;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      // un salto di direzione (un nodo del grafo, un teletrasporto) non è una curva
      yaw = Math.abs(dh) > 0.5 ? 0 : dh / dt;
    }
    last.current.heading = pose.heading;
    const dist = camera.position.distanceTo(root.position);
    if (lodDistance != null) {
      const wantFar = far.current ? dist > lodDistance * 0.85 : dist > lodDistance;
      if (wantFar !== far.current) {
        far.current = wantFar;
        mesh.geometry = riderGeometry(wantFar ? 'bassa' : detail, look.rim);
      }
    }
    // lontanissimo (dietro una collina, sotto la strada): non serve animarlo
    if (dist < 400) {
      rig.update({
        dt,
        cadence: getCadence(),
        speed: getSpeed(),
        grade: getGrade ? getGrade() : pose.grade,
        power: getPower ? getPower() : null,
        // heading che cresce = curva a sinistra (+x); piegare a sinistra è una rotazione negativa intorno a z
        yawRate: -yaw,
      });
    }
    if (sprite.current) {
      // l'etichetta cresce con la distanza: resta leggibile anche a un tornante di distanza
      const k = THREE.MathUtils.clamp(dist * 0.07, 1, 18);
      sprite.current.scale.set(k * 2.2, k * 0.55, 1);
      sprite.current.position.y = 1.95 + k * 0.3;
    }
  });

  return (
    <group ref={group}>
      {!ghost ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0.08]} renderOrder={1}>
          <planeGeometry args={[0.75, 1.75]} />
          <meshBasicMaterial map={shadowTexture()} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-6} />
        </mesh>
      ) : null}
      <primitive object={mesh} />
      {labelTex ? (
        <sprite ref={sprite} position={[0, 2.1, 0]}>
          <spriteMaterial map={labelTex} depthTest={false} transparent />
        </sprite>
      ) : null}
    </group>
  );
}
