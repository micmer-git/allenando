import { describe, expect, it } from 'vitest';
import { trainingLoad } from '../src/domain/load';
import { sleepSecondsOnDay } from '../src/domain/sleep';
import { kmWithCamilla, nextMilestone, unlockedMilestoneIds } from '../src/domain/camilla';

describe('carico, sonno e Camilla', () => {
  it('aggiorna CTL e ATL con le costanti 42 e 7', () => {
    const days = trainingLoad(
      [
        { date: '2026-10-01', tss: 100 },
        { date: '2026-10-02', tss: 0 },
      ],
      new Date(2026, 9, 2),
    );
    expect(days).toHaveLength(2);
    expect(days[0].ctl).toBeCloseTo(100 / 42, 6);
    expect(days[0].atl).toBeCloseTo(100 / 7, 6);
    expect(days[0].tsb).toBeCloseTo(0, 6);
    expect(days[1].tsb).toBeCloseTo(100 / 42 - 100 / 7, 6);
    const ctl1 = 100 / 42 + (0 - 100 / 42) / 42;
    const atl1 = 100 / 7 + (0 - 100 / 7) / 7;
    expect(days[1].ctl).toBeCloseTo(ctl1, 6);
    expect(days[1].atl).toBeCloseTo(atl1, 6);
  });

  it('spezza il sonno a cavallo della mezzanotte', () => {
    const sessions = [{ start: '2026-10-01T22:00:00', end: '2026-10-02T06:30:00' }];
    expect(sleepSecondsOnDay(sessions, '2026-10-01')).toBe(2 * 3600);
    expect(sleepSecondsOnDay(sessions, '2026-10-02')).toBe(6.5 * 3600);
    expect(sleepSecondsOnDay(sessions, '2026-10-03')).toBe(0);
  });

  it('sblocca i traguardi dei km con Camilla', () => {
    const rides = [
      { distanceM: 6000, withCamilla: true },
      { distanceM: 2000, withCamilla: false },
    ];
    expect(kmWithCamilla(rides)).toBeCloseTo(6, 5);
    expect(unlockedMilestoneIds(6)).toEqual(['primo-km', 'cinque']);
    expect(nextMilestone(6)?.id).toBe('dieci');
  });
});
