import { describe, expect, it } from 'vitest';
import { trainingLoad } from '../src/domain/load';

describe('carico', () => {
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
});
