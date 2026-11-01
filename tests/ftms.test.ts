import { describe, expect, it } from 'vitest';
import {
  encodeIndoorBikeSimulation,
  encodeRequestControl,
  encodeSetTargetPower,
  parseControlPointResponse,
  parseFtmsFeatures,
  parseIndoorBikeData,
  FTMS_RESULT_SUCCESS,
} from '../src/domain/ftms';
import { cadenceFromCrank, parseCsc, parseCyclingPower, parseHeartRate } from '../src/domain/sensors';
import { bluetoothSupport } from '../src/bluetooth/support';

function view(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

describe('FTMS e sensori BLE', () => {
  it('legge velocità, cadenza, potenza e FC da Indoor Bike Data', () => {
    const flags = 0x0004 | 0x0040 | 0x0200;
    const data = parseIndoorBikeData(
      view([
        flags & 0xff,
        (flags >> 8) & 0xff,
        0xb8,
        0x0b,
        0xb4,
        0x00,
        0xfa,
        0x00,
        150,
      ]),
    );
    expect(data.speedKmh).toBeCloseTo(30, 2);
    expect(data.cadenceRpm).toBeCloseTo(90, 2);
    expect(data.powerW).toBe(250);
    expect(data.heartRate).toBe(150);
    expect(data.distanceM).toBeUndefined();
  });

  it('salta la velocità quando More Data è attivo e legge la distanza su 3 byte', () => {
    const flags = 0x0001 | 0x0010;
    const data = parseIndoorBikeData(view([flags & 0xff, 0x00, 0x10, 0x0e, 0x00]));
    expect(data.speedKmh).toBeUndefined();
    expect(data.distanceM).toBe(0x0e10);
  });

  it('codifica controllo, potenza obiettivo e simulazione di pendenza', () => {
    expect(Array.from(encodeRequestControl())).toEqual([0x00]);
    expect(Array.from(encodeSetTargetPower(250))).toEqual([0x05, 0xfa, 0x00]);
    const sim = encodeIndoorBikeSimulation({ grade: 0.05, crr: 0.004, cw: 0.39, windSpeedMs: 0 });
    expect(Array.from(sim)).toEqual([0x11, 0x00, 0x00, 0xf4, 0x01, 40, 39]);
  });

  it('interpreta la risposta del control point e le feature', () => {
    expect(parseControlPointResponse(view([0x80, 0x05, 0x01]))).toEqual({
      opcode: 0x05,
      result: FTMS_RESULT_SUCCESS,
    });
    const feature = new Uint8Array(8);
    const dv = new DataView(feature.buffer);
    dv.setUint32(4, (1 << 3) | (1 << 13), true);
    expect(parseFtmsFeatures(dv)).toEqual({ targetPower: true, simulation: true });
  });

  it('legge la potenza ciclistica e la cadenza fra due campioni', () => {
    const reading = parseCyclingPower(view([0x20, 0x00, 0xfa, 0x00, 12, 0x00, 0x00, 0x04]));
    expect(reading?.power).toBe(250);
    expect(reading?.crankRevs).toBe(12);
    expect(cadenceFromCrank({ revs: 10, time: 0 }, { revs: 12, time: 1024 })).toBeCloseTo(120, 5);
  });

  it('legge FC a 8 e 16 bit e la cadenza CSC', () => {
    expect(parseHeartRate(view([0x00, 72]))).toBe(72);
    expect(parseHeartRate(view([0x01, 0xb4, 0x00]))).toBe(180);
    const csc = parseCsc(view([0x02, 0x0a, 0x00, 0x00, 0x00]));
    expect(csc?.crankRevs).toBe(10);
  });

  it('segnala iOS quando manca il Web Bluetooth', () => {
    expect(bluetoothSupport({ bluetooth: {}, userAgent: 'Mozilla' }).available).toBe(true);
    expect(
      bluetoothSupport({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }).reason,
    ).toBe('ios');
    expect(bluetoothSupport({ userAgent: 'Mozilla/5.0 Firefox', platform: 'Linux' }).reason).toBe('missing');
    expect(
      bluetoothSupport({ userAgent: 'Mozilla', platform: 'MacIntel', maxTouchPoints: 5 }).reason,
    ).toBe('ios');
  });
});
