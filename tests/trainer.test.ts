import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BluetoothTrainer, STALE_MS } from '../src/bluetooth/trainer';
import type { SourceUpdate } from '../src/sim/source';

/**
 * Rullo FTMS finto: nessun hardware, solo la forma degli oggetti Web Bluetooth.
 * Prova la logica dell'adattatore, non la compatibilità con un rullo vero.
 */
const FULL = (short: number) => `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

class FakeChar extends EventTarget {
  value: DataView | null = null;
  properties = { write: true };
  writes: number[][] = [];
  hold: (() => void)[] = [];
  slow = false;
  constructor(private readonly initial?: DataView) {
    super();
  }
  async startNotifications() {
    return this;
  }
  async readValue() {
    if (!this.initial) throw new Error('no value');
    return this.initial;
  }
  async writeValueWithResponse(buffer: ArrayBuffer) {
    this.writes.push([...new Uint8Array(buffer)]);
    if (this.slow) await new Promise<void>((resolve) => this.hold.push(resolve));
  }
  async writeValueWithoutResponse(buffer: ArrayBuffer) {
    this.writes.push([...new Uint8Array(buffer)]);
  }
  notify(bytes: number[]) {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

function makeTrainer(name = 'KICKR finto') {
  // Feature: target setting con potenza (bit 3) e simulazione (bit 13)
  const target = (1 << 3) | (1 << 13);
  const feature = new FakeChar(new DataView(Uint8Array.of(0, 0, 0, 0, target & 0xff, (target >> 8) & 0xff, 0, 0).buffer));
  const bike = new FakeChar();
  const control = new FakeChar();
  const chars = new Map<number, FakeChar>([
    [0x2acc, feature],
    [0x2ad2, bike],
    [0x2ad9, control],
  ]);
  const service = { uuid: FULL(0x1826), getCharacteristic: async (uuid: number) => chars.get(uuid)! };
  const device = Object.assign(new EventTarget(), {
    name,
    gatt: {
      connected: true,
      connect: async () => ({ getPrimaryServices: async () => [service] }),
      disconnect: vi.fn(),
    },
  });
  return { device, bike, control };
}

function erg(watts: number): SourceUpdate {
  return { dt: 0.05, grade: 0, targetPower: watts, effort: 0, ftp: 250, maxHr: 186, restHr: 52, erg: true, crr: 0.004, cw: 0.39 };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('BluetoothTrainer con un rullo finto', () => {
  let now = 1000;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function connected(fake = makeTrainer()) {
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => fake.device }, userAgent: 'test' });
    const trainer = new BluetoothTrainer();
    await trainer.connectBluetooth(false);
    // il rullo concede il controllo
    fake.control.notify([0x80, 0x00, 0x01]);
    return { trainer, ...fake };
  }

  it('chiede il controllo e manda la potenza ERG', async () => {
    const { trainer, control } = await connected();
    expect(control.writes[0]).toEqual([0x00]);
    expect(trainer.snapshot().control).toBe('granted');
    trainer.update(erg(200));
    await flush();
    expect(control.writes.at(-1)).toEqual([0x05, 200, 0]);
  });

  it('con il rullo lento manda solo l’ultimo bersaglio, non la coda', async () => {
    const { trainer, control } = await connected();
    control.slow = true;
    trainer.update(erg(150));
    await flush();
    for (const w of [160, 170, 180, 190]) trainer.update(erg(w));
    // libera la scrittura in volo e quelle che seguono
    while (control.hold.length) {
      control.hold.shift()!();
      await flush();
    }
    const ergWrites = control.writes.filter((bytes) => bytes[0] === 0x05).map((bytes) => bytes[1]);
    expect(ergWrites).toEqual([150, 190]);
  });

  it('dopo la disconnessione la potenza torna a zero', async () => {
    const { trainer, bike, device } = await connected();
    bike.notify([0x41, 0x00, 0xfa, 0x00]); // More Data (niente velocità) + potenza: 250 W
    expect(trainer.power).toBe(250);
    device.dispatchEvent(new Event('gattserverdisconnected'));
    expect(trainer.power).toBe(0);
    expect(trainer.snapshot().status).toBe('disconnected');
  });

  it('un rullo che smette di parlare non tiene in vita l’ultima potenza', async () => {
    const { trainer, bike } = await connected();
    bike.notify([0x45, 0x00, 0xb4, 0x00, 0xfa, 0x00]); // cadenza 90, potenza 250
    now += STALE_MS - 100;
    trainer.update(erg(200));
    expect(trainer.power).toBe(250);
    now += 200;
    trainer.update(erg(200));
    expect(trainer.power).toBe(0);
    expect(trainer.cadence).toBe(0);
  });

  it('se il rullo revoca il controllo, lo richiede', async () => {
    const { trainer, control } = await connected();
    control.notify([0x80, 0x05, 0x05]); // set target power: control not permitted
    await flush();
    expect(control.writes.filter((bytes) => bytes[0] === 0x00)).toHaveLength(2);
    expect(trainer.snapshot().control).toBe('none');
  });

  it('una seconda periferica che fallisce non stacca il rullo', async () => {
    const { trainer } = await connected();
    vi.stubGlobal('navigator', {
      bluetooth: { requestDevice: async () => Promise.reject(new DOMException('annullato', 'NotFoundError')) },
      userAgent: 'test',
    });
    await expect(trainer.connectBluetooth(false)).rejects.toThrow();
    expect(trainer.snapshot().status).toBe('connected');
    expect(trainer.snapshot().mode).toBe('bluetooth');
  });

  it('uscendo stacca tutte le periferiche', async () => {
    const first = makeTrainer('Rullo');
    const { trainer } = await connected(first);
    const strap = makeTrainer('Fascia');
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => strap.device }, userAgent: 'test' });
    await trainer.connectBluetooth(false);
    expect(trainer.snapshot().deviceName).toBe('Rullo + Fascia');
    trainer.disconnect();
    expect(first.device.gatt.disconnect).toHaveBeenCalled();
    expect(strap.device.gatt.disconnect).toHaveBeenCalled();
  });
});
