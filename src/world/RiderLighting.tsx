import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** Luce riflessa dal cielo e dal suolo: rende leggibili kit e superfici in ombra.
 * La PMREM è statica: non richiede un secondo rendering del mondo a ogni frame. */
export function RiderLighting() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const width = 128, height = 64;
    const pixels = new Uint8Array(width * height * 4);
    const sky = new THREE.Color('#dceafa');
    const horizon = new THREE.Color('#c0cbc9');
    const ground = new THREE.Color('#69705c');
    const color = new THREE.Color();
    for (let y = 0; y < height; y++) {
      // Le righe di DataTexture partono dal bordo inferiore (v = 0: suolo).
      const elevation = -Math.cos(y / (height - 1) * Math.PI);
      color.copy(horizon).lerp(elevation >= 0 ? sky : ground, Math.abs(elevation)).convertLinearToSRGB();
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        pixels[i] = Math.round(color.r * 255);
        pixels[i + 1] = Math.round(color.g * 255);
        pixels[i + 2] = Math.round(color.b * 255);
        pixels[i + 3] = 255;
      }
    }
    const source = new THREE.DataTexture(pixels, width, height);
    source.colorSpace = THREE.SRGBColorSpace;
    source.mapping = THREE.EquirectangularReflectionMapping;
    source.needsUpdate = true;
    const generator = new THREE.PMREMGenerator(gl);
    const environment = generator.fromEquirectangular(source);
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.32;
    source.dispose();
    generator.dispose();
    return () => {
      if (scene.environment === environment.texture) {
        scene.environment = previous;
        scene.environmentIntensity = previousIntensity;
      }
      environment.dispose();
    };
  }, [gl, scene]);
  return null;
}
