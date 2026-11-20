import { Mesh, PAL } from './kit';

// La foto di Ago76 (Commons 3149662) mostra la nicchia sotto la roccia, l'altare e la figura sulla destra.
export function grottaRoscianoGeometry() {
  const m = new Mesh();
  const rock = PAL.pietraScura, recess = PAL.buio;
  const foot = -1.8;
  m.box(-1.8,foot,-1,1.8,4.25,-0.58,recess);
  m.box(-1.75,foot,-0.65,1.75,0.08,1.0,rock);
  m.beam([-1.60,-0.5,0.6],[-1.35,2.35,0.55],0.86,rock);
  m.beam([-1.36,2.1,0.48],[-0.74,4.16,0.24],1.0,rock);
  m.beam([1.56,-0.6,0.7],[1.30,2.14,0.68],0.83,rock);
  m.beam([1.30,2.05,0.62],[0.88,4.01,0.33],0.82,rock);
  m.beam([-0.95,3.99,0.24],[1.09,3.77,0.39],0.9,rock);
  m.box(-0.34,0.06,-0.25,0.34,0.66,0.17,PAL.pietra);
  m.box(-0.57,0.66,-0.37,0.57,0.76,0.26,PAL.marmo);
  m.box(0.52,1.62,-0.38,1.08,1.74,0.08,rock);
  m.cyl(0.80,-0.10,0.13,0.07,1.74,2.25,8,PAL.marmo);
  m.ball(0.80,2.31,-0.10,0.087,PAL.marmo);
  m.beam([0.85,2.20,0],[0.77,1.86,0.04],0.042,[0.15,0.38,0.57]);
  return m.geometry().rotateY(Math.PI);
}
