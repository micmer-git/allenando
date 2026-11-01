import { describe, expect, it } from 'vitest';
import { estimateLthr, hrZoneIndex, powerZoneIndex } from '../src/domain/zones';

describe('zone di Coggan e Friel', () => {
  const ftp = 200;

  it('assegna le 7 zone di potenza sui confini', () => {
    expect(powerZoneIndex(109, ftp)).toBe(1);
    expect(powerZoneIndex(110, ftp)).toBe(2);
    expect(powerZoneIndex(151, ftp)).toBe(2);
    expect(powerZoneIndex(152, ftp)).toBe(3);
    expect(powerZoneIndex(181, ftp)).toBe(3);
    expect(powerZoneIndex(182, ftp)).toBe(4);
    expect(powerZoneIndex(211, ftp)).toBe(4);
    expect(powerZoneIndex(212, ftp)).toBe(5);
    expect(powerZoneIndex(241, ftp)).toBe(5);
    expect(powerZoneIndex(242, ftp)).toBe(6);
    expect(powerZoneIndex(300, ftp)).toBe(6);
    expect(powerZoneIndex(301, ftp)).toBe(7);
  });

  it('con FTP 250, 200 W è tempo', () => {
    expect(powerZoneIndex(200, 250)).toBe(3);
  });

  it('zona FC sulla soglia cardiaca', () => {
    const lthr = 160;
    expect(hrZoneIndex(120, lthr)).toBe(1);
    expect(hrZoneIndex(130, lthr)).toBe(2);
    expect(hrZoneIndex(148, lthr)).toBe(3);
    expect(hrZoneIndex(155, lthr)).toBe(4);
    expect(hrZoneIndex(162, lthr)).toBe(5);
    expect(hrZoneIndex(168, lthr)).toBe(6);
    expect(hrZoneIndex(175, lthr)).toBe(7);
  });

  it('stima la soglia come 89% della FC max', () => {
    expect(estimateLthr(186)).toBe(166);
    expect(estimateLthr(186, 170)).toBe(170);
  });
});
