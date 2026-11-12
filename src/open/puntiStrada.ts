/** Posizioni OSM in metri locali; altezza 0 = non censita. */
export type RoadPoint = [number, number, 'lamp' | 'spruce' | 'broadleaf', number];
const CELL = 100;
export function indexRoadPoints(points: RoadPoint[]) {
  const cells = new Map<string, RoadPoint[]>();
  for (const p of points) {
    const key = Math.floor(p[0]/CELL) + ':' + Math.floor(p[1]/CELL);
    const cell = cells.get(key);
    if (cell) cell.push(p); else cells.set(key, [p]);
  }
  return (x0: number, z0: number, size: number, margin = 0) => {
    const result: RoadPoint[] = [];
    const x1 = x0 + size + margin, z1 = z0 + size + margin;
    for (let i = Math.floor((x0-margin)/CELL); i <= Math.floor(x1/CELL); i++)
      for (let j = Math.floor((z0-margin)/CELL); j <= Math.floor(z1/CELL); j++)
        for (const p of cells.get(i+':'+j) ?? [])
          if (p[0] >= x0-margin && p[0] < x1 && p[1] >= z0-margin && p[1] < z1) result.push(p);
    return result;
  };
}
