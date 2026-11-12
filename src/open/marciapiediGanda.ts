import type { WorldGraph } from './graph';
import raw from './marciapiedi-ganda.json?raw';

type Section = [startDm: number, endDm: number, leftDm: number, rightDm: number];
const file = JSON.parse(raw) as { graphBuiltAt: string; edgeCount: number; bounds: number[]; edges: Record<string, Section[]> };

export function walkSections(graph: WorldGraph, id: number): Section[] | undefined {
  if (graph.id === 'bergamo' && graph.builtAt === file.graphBuiltAt && graph.edges.length === file.edgeCount) return file.edges[id];
}

/** undefined fuori dal rilievo, zero sul lato rilevato privo di marciapiede. */
export function surveyedWalk(sections: Section[] | undefined, distance: number, side: number): number | undefined {
  const dm = Math.round(distance * 10);
  const row = sections?.find(([start, end]) => dm >= start && dm <= end);
  if (row) return row[side > 0 ? 2 : 3] / 10;
}

export function surveyedCorner(graph: WorldGraph, x: number, z: number): number | undefined {
  const [x0,z0,x1,z1] = file.bounds;
  if (graph.id !== 'bergamo' || x < x0 || x > x1 || z < z0 || z > z1) return;
  const hit = graph.nearest(x, z, 16);
  if (!hit) return;
  const sections = walkSections(graph, hit.edge);
  if (!sections) return;
  const p = graph.pose(hit.edge, hit.s, 1);
  const side = (x - p.x) * Math.cos(p.heading) - (z - p.z) * Math.sin(p.heading);
  return surveyedWalk(sections, hit.s, side);
}
