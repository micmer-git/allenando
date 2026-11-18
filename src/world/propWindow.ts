import type { Prop } from './builders';

export type PropGroup = Prop['kind'] | 'trunk';
const groups = (): Record<PropGroup, Prop[]> => ({ spruce: [], larch: [], broadleaf: [], rock: [], trunk: [] });

/** La vista isometrica usa una finestra locale. Il budget conta anche i tronchi:
 * una chioma e il suo tronco entrano sempre insieme, una roccia costa un'istanza. */
export function createPropWindow(items: readonly Prop[], radius = 110, budget = 800) {
  let cellX = NaN;
  let cellZ = NaN;
  const capacity: Record<PropGroup, number> = { spruce: 0, larch: 0, broadleaf: 0, rock: 0, trunk: 0 };
  for (const item of items) {
    capacity[item.kind]++;
    if (item.kind !== 'rock') capacity.trunk++;
  }
  for (const kind of Object.keys(capacity) as PropGroup[]) {
    capacity[kind] = Math.min(capacity[kind], kind === 'rock' ? budget : Math.floor(budget / 2));
  }
  const window = {
    capacity,
    groups: groups(),
    revision: 0,
    update(x: number, z: number) {
      const nextX = Math.floor(x / 16);
      const nextZ = Math.floor(z / 16);
      if (nextX === cellX && nextZ === cellZ) return false;
      cellX = nextX;
      cellZ = nextZ;
      const distance = (p: Prop) => (p.x - x) ** 2 + (p.z - z) ** 2;
      const nearby = items.filter(p => distance(p) <= radius * radius).sort((a, b) => distance(a) - distance(b));
      const next = groups();
      let remaining = budget;
      for (const item of nearby) {
        const cost = item.kind === 'rock' ? 1 : 2;
        if (remaining < cost) continue;
        next[item.kind].push(item);
        if (item.kind !== 'rock') next.trunk.push(item);
        remaining -= cost;
        if (!remaining) break;
      }
      window.groups = next;
      window.revision++;
      return true;
    },
  };
  return window;
}
