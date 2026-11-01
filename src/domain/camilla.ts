export interface Milestone {
  id: string;
  km: number;
  titleKey: string;
  detailKey: string;
}

export const MILESTONES: Milestone[] = [
  { id: 'primo-km', km: 1, titleKey: 'milestones.primo.title', detailKey: 'milestones.primo.detail' },
  { id: 'cinque', km: 5, titleKey: 'milestones.cinque.title', detailKey: 'milestones.cinque.detail' },
  { id: 'dieci', km: 10, titleKey: 'milestones.dieci.title', detailKey: 'milestones.dieci.detail' },
  { id: 'mezza', km: 21.1, titleKey: 'milestones.mezza.title', detailKey: 'milestones.mezza.detail' },
  { id: 'maratona', km: 42.195, titleKey: 'milestones.maratona.title', detailKey: 'milestones.maratona.detail' },
  { id: 'cinquanta', km: 50, titleKey: 'milestones.cinquanta.title', detailKey: 'milestones.cinquanta.detail' },
  { id: 'cento', km: 100, titleKey: 'milestones.cento.title', detailKey: 'milestones.cento.detail' },
  { id: 'duecento', km: 200, titleKey: 'milestones.duecento.title', detailKey: 'milestones.duecento.detail' },
  { id: 'cinquecento', km: 500, titleKey: 'milestones.cinquecento.title', detailKey: 'milestones.cinquecento.detail' },
  { id: 'mille', km: 1000, titleKey: 'milestones.mille.title', detailKey: 'milestones.mille.detail' },
];

export function kmWithCamilla(rides: { distanceM: number; withCamilla: boolean }[]): number {
  let m = 0;
  for (const r of rides) if (r.withCamilla) m += r.distanceM;
  return m / 1000;
}

export function unlockedMilestoneIds(km: number): string[] {
  return MILESTONES.filter((item) => km + 1e-6 >= item.km).map((item) => item.id);
}

export function nextMilestone(km: number): Milestone | undefined {
  return MILESTONES.find((item) => item.km > km + 1e-9);
}

export function previousMilestone(km: number): Milestone | undefined {
  let prev: Milestone | undefined;
  for (const item of MILESTONES) {
    if (item.km <= km + 1e-9) prev = item;
    else break;
  }
  return prev;
}

export function milestoneById(id: string): Milestone | undefined {
  return MILESTONES.find((item) => item.id === id);
}
