import { useLayoutEffect } from 'react';
import { useThree, type Camera } from '@react-three/fiber';
import { OrthographicCamera } from 'three';

/** R3F ridimensiona la proiezione al resize. Serve anche quando si cambia camera a finestra ferma. */
export function fitRideViewport(camera: Camera, width: number, height: number): void {
  if (width <= 0 || height <= 0) return;
  if (camera instanceof OrthographicCamera) {
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
  } else {
    camera.aspect = width / height;
  }
  camera.updateProjectionMatrix();
}

export function useRideCamera() {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    fitRideViewport(camera, size.width, size.height);
  }, [camera, size.width, size.height]);
  return { camera, size };
}
