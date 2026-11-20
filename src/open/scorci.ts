// Posizioni di scatto nell'atlante, in metri locali. Azimut da nord della ripresa o della cima
// identificabile in foto. Solo il primo piano aperto, prima degli alberi visibili sullo sfondo.
const views: Record<string, readonly (readonly [number, number, number, number])[]> = {
  bergamo: [
    [-2328.5, -2491.3, 163.1, 55], // Prati davanti al Monte Alben, Commons 73791971.
    [-13725.9, -19974.3, 123, 80], // Dalla sommità del San Marco, Commons 169458395.
  ],
  sellaronda: [
    [19.7, 3138.5, 340.3, 75], // Pietraia davanti al Sass Pordoi, Commons 179135961.
    [5102.9, -2979.8, 325.9, 45], // Prato verso Corvara, Commons 202533996.
  ],
};

export function foregroundInTile(world: string, tile: {x0:number; z0:number; size:number}) {
  const near = (views[world] ?? []).filter(([x,z,,reach]) =>
    x+reach >= tile.x0 && x-reach <= tile.x0+tile.size && z+reach >= tile.z0 && z-reach <= tile.z0+tile.size
  ).map(([x,z,bearing,reach]) => ({x,z,reach,dx:Math.sin(bearing*Math.PI/180), dz:-Math.cos(bearing*Math.PI/180)}));
  return (x:number,z:number) => near.some(v => {
    const dx = x-v.x, dz = z-v.z;
    const ahead = dx*v.dx+dz*v.dz, side = Math.abs(dx*v.dz-dz*v.dx);
    return ahead >= 0 && ahead <= v.reach && side <= 2+ahead*0.32;
  });
}
