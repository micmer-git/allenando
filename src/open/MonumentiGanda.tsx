import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { pixelTexture } from '@/world/isometric';
import { GIMONDI, marconiIsland } from './arteStrada';
import type { WorldData } from './world';
import type { WorldField } from './field';

/** Illustrazione originale della sagoma frontale, come nell'effige in cima al passo. */
function effigy() {
  return pixelTexture(96, 144, (g) => {
    function polygon(color: string, ...p: number[]) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      g.closePath();
      g.fill();
    }
    function line(color: string, width: number, ...p: number[]) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      g.stroke();
    }
    // Ruota anteriore di tre quarti e telaio celeste dietro le gambe.
    g.strokeStyle = '#252628';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(49, 116, 5, 24, -0.06, 0, 2 * Math.PI);
    g.stroke();
    line('#d6d7c6', 1, 49, 92, 50, 139);
    line('#64beb6', 3, 44, 92, 50, 119, 54, 83, 39, 71);
    polygon('#b97853', 31, 72, 43, 73, 40, 92, 34, 109, 29, 108, 31, 91);
    polygon('#d3976a', 53, 73, 65, 72, 64, 90, 56, 108, 50, 106, 56, 87);
    polygon('#251f24', 27, 108, 35, 106, 37, 112, 24, 114);
    polygon('#29262b', 50, 104, 57, 105, 59, 111, 48, 112);
    polygon('#242830', 27, 57, 68, 57, 65, 79, 53, 82, 47, 69, 43, 82, 29, 79);
    polygon('#f1ecdb', 27, 31, 38, 23, 55, 22, 69, 31, 74, 44, 65, 49, 61, 63, 33, 63, 28, 48, 20, 44);
    const bands = ['#2271af', '#b73834', '#292c2e', '#e8ba3c', '#44804c'];
    bands.forEach((color, i) => {
      g.fillStyle = color;
      g.fillRect(33, 47 + i * 2, 29, 2);
    });
    g.fillStyle = '#272a2a';
    g.textAlign = 'center';
    g.font = 'bold 8px sans-serif';
    g.fillText('BIANCHI', 48, 43);
    polygon('#bd805b', 21, 44, 29, 47, 23, 62, 24, 73, 18, 78, 16, 72, 16, 61);
    polygon('#d39468', 66, 48, 74, 44, 80, 62, 79, 74, 73, 77, 71, 72, 73, 63);
    line('#373e40', 3, 17, 77, 22, 72, 43, 75, 51, 75, 72, 72, 78, 77);
    polygon('#c58a63', 38, 9, 54, 8, 58, 15, 54, 26, 48, 30, 39, 24, 36, 16);
    polygon('#3c302b', 35, 13, 37, 5, 44, 2, 52, 3, 58, 8, 57, 15, 53, 13, 50, 9, 42, 11, 37, 17);
    g.fillStyle = '#78503d';
    g.fillRect(40, 15, 4, 2);
    g.fillRect(50, 14, 4, 2);
    g.fillRect(45, 23, 6, 1);
  });
}

export function MonumentiGanda({ data, field }: { data: WorldData; field: WorldField }) {
  const site = useMemo(() => {
    const actual = data.proj.toLocal(GIMONDI);
    const hit = data.graph.nearest(actual.x, actual.z, 50);
    const island = marconiIsland(data.graph);
    if (!hit || !island) return null;
    const road = data.graph.pose(hit.edge, hit.s);
    const yaw = Math.atan2(road.x - actual.x, road.z - actual.z);
    // La posizione pubblicata cade sul bordo della piazzola. La sua base deve stare tutta fuori strada.
    const gap = Math.max(hit.d, data.graph.edges[hit.edge].hw + 2.05);
    return {
      x: road.x - Math.sin(yaw) * gap,
      z: road.z - Math.cos(yaw) * gap,
      yaw,
      roadY: road.y,
      stone: { x: island.cx, z: island.cz },
      stoneY: island.ys.reduce((sum, y) => sum + y, 0) / island.n + 0.65,
    };
  }, [data]);
  const assets = useMemo(() => {
    const timberSign = (words: string) =>
      pixelTexture(256, 32, (g) => {
        g.fillStyle = '#6b4530';
        g.fillRect(0, 0, 256, 32);
        for (let i = 0; i < 25; i++) {
          g.fillStyle = i % 2 ? '#593c2b' : '#774e35';
          g.fillRect((i * 43) % 240, (i * 7) % 32, 12 + ((i * 11) % 25), 1);
        }
        g.fillStyle = '#fff0cd';
        g.font = 'bold italic 21px Georgia';
        g.textAlign = 'center';
        g.fillText(words, 128, 23, 236);
      });
    const paving = pixelTexture(64, 64, (g) => {
      g.fillStyle = '#c7c2b4';
      g.fillRect(0, 0, 64, 64);
      for (let row = 0; row < 8; row++)
        for (let col = -1; col < 8; col++) {
          g.fillStyle = ['#928b80', '#a6a094', '#b1aa9d'][(row * 7 + col + 9) % 3];
          g.fillRect(col * 8 + (row % 2) * 4, row * 8, 7, 7);
        }
    });
    return { pass: timberSign('Passo Ganda'), dedication: timberSign('Valico Felice Gimondi'), paving, rider: effigy() };
  }, []);
  useEffect(() => () => Object.values(assets).forEach((t) => t.dispose()), [assets]);
  // Le quote stradali sono disponibili anche prima dell'arrivo della mattonella DEM.
  const arch = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (site && arch.current && Math.hypot(camera.position.x - site.x, camera.position.z - site.z) < 180)
      arch.current.position.y = Math.max(field.height(site.x, site.z, 4), site.roadY - 0.35);
  });
  if (!site) return null;
  return (
    <>
      <group ref={arch} position={[site.x, site.roadY, site.z]} rotation={[0, site.yaw, 0]}>
        <mesh position={[0, 0.04, 0]} receiveShadow>
          <cylinderGeometry args={[1.85, 1.88, 0.13, 12]} />
          <meshLambertMaterial map={assets.paving} />
        </mesh>
        {[-1.14, 1.14].map((x) => (
          <mesh key={x} position={[x, 1.35, 0]} castShadow>
            <boxGeometry args={[0.19, 2.7, 0.22]} />
            <meshLambertMaterial color="#60432c" />
          </mesh>
        ))}
        {[
          { y: 2.62, w: 2.68, tex: assets.pass },
          { y: 2.29, w: 2.18, tex: assets.dedication },
        ].map(({ y, w, tex }) => (
          <group key={y} position={[0, y, 0.14]}>
            <mesh castShadow>
              <boxGeometry args={[w, 0.26, 0.1]} />
              <meshLambertMaterial color="#795137" />
            </mesh>
            <mesh position={[0, 0, 0.052]}>
              <planeGeometry args={[w, 0.26]} />
              <meshLambertMaterial map={tex} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 1.03, 0.06]} castShadow>
          <planeGeometry args={[1.26, 1.89]} />
          <meshLambertMaterial map={assets.rider} alphaTest={0.5} side={THREE.DoubleSide} />
        </mesh>
        {[-1.55, 0, 1.55].map((x) => (
          <mesh key={x} position={[x, 0.57, -0.75]}>
            <boxGeometry args={[0.11, 1.1, 0.11]} />
            <meshLambertMaterial color="#594a36" />
          </mesh>
        ))}
        {[0.5, 0.93].map((y) => (
          <mesh key={y} position={[0, y, -0.75]}>
            <boxGeometry args={[3.15, 0.12, 0.09]} />
            <meshLambertMaterial color="#6b573e" />
          </mesh>
        ))}
      </group>
      <group position={[site.stone.x, site.stoneY - 0.15, site.stone.z]}>
        <mesh position={[0, 0.26, 0]} castShadow>
          <boxGeometry args={[1.5, 0.65, 1.5]} />
          <meshLambertMaterial color="#414443" />
        </mesh>
        <mesh position={[0, 3.2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <cylinderGeometry args={[0.36, 0.62, 5.45, 4]} />
          <meshLambertMaterial color="#262d2d" flatShading />
        </mesh>
        <mesh position={[0, 6.29, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[0.36, 0.75, 4]} />
          <meshLambertMaterial color="#383e3e" flatShading />
        </mesh>
      </group>
    </>
  );
}
