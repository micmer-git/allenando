import {
  encodeIndoorBikeSimulation,
  encodeRequestControl,
  encodeSetTargetPower,
  parseControlPointResponse,
  parseFtmsFeatures,
  parseIndoorBikeData,
  FTMS_OP,
  FTMS_RESULT_CONTROL_NOT_PERMITTED,
  FTMS_RESULT_SUCCESS,
} from '@/domain/ftms';
import { cadenceFromCrank, parseCsc, parseCyclingPower, parseHeartRate, type CrankPoint } from '@/domain/sensors';
import { bluetoothSupport } from './support';
import type { SourceUpdate, TelemetrySource, TrainerServices, TrainerSnapshot } from '@/sim/source';

const FTMS = 0x1826;
const INDOOR_BIKE = 0x2ad2;
const CONTROL = 0x2ad9;
const FEATURE = 0x2acc;
const CPS = 0x1818;
const CPM = 0x2a63;
const HR = 0x180d;
const HRM = 0x2a37;
const CSC = 0x1816;
const CSCM = 0x2a5b;
const SERVICES = [FTMS, CPS, HR, CSC];
/** Oltre questo silenzio un valore non è più vero: il motore lo vede come zero. */
export const STALE_MS = 3000;

const emptyServices = (): TrainerServices => ({ ftms: false, power: false, hr: false, csc: false });

/**
 * Adattatore Web Bluetooth. Se il browser non lo espone, il chiamante resta
 * sul simulatore e mostra il messaggio (su iOS: Bluefy).
 */
export class BluetoothTrainer implements TelemetrySource {
  mode: TelemetrySource['mode'] = 'simulator';
  power = 0;
  hr = 70;
  cadence = 85;

  private listeners = new Set<() => void>();
  private services: TrainerServices = emptyServices();
  private control: TrainerSnapshot['control'] = 'none';
  private simulation: TrainerSnapshot['simulation'] = 'none';
  private status: TrainerSnapshot['status'] = 'idle';
  private deviceName: string | null = null;
  private busy = false;
  /** Rullo e fascia cardio possono essere due periferiche: si tengono tutte. */
  private devices: BluetoothDevice[] = [];
  private controlChar: BluetoothRemoteGATTCharacteristic | null = null;
  private controlDevice: BluetoothDevice | null = null;
  private targetPowerSupported = true;
  /** Un solo comando in volo; quelli arrivati nel frattempo valgono solo l'ultimo. */
  private pending: Uint8Array | null = null;
  private writing = false;
  private powerAt = 0;
  private cadenceAt = 0;
  private hrAt = 0;
  private lastGrade = Number.NaN;
  private lastPowerCmd = Number.NaN;
  private lastCmdAt = 0;
  private cpsCrank: CrankPoint | undefined;
  private cscCrank: CrankPoint | undefined;
  private ftmsCadence: number | undefined;
  private cpsCadence: number | undefined;
  private cscCadence: number | undefined;
  private simT = 0;
  private onDisconnect = (event: Event) => {
    const device = event.target as BluetoothDevice | null;
    this.devices = this.devices.filter((item) => item !== device);
    if (device && device === this.controlDevice) {
      this.controlChar = null;
      this.controlDevice = null;
      this.control = 'none';
      this.simulation = 'none';
      this.pending = null;
    }
    // niente valori fantasma: senza periferica la potenza è zero, non l'ultima letta
    this.power = 0;
    this.cadence = 0;
    this.hr = 0;
    this.cpsCrank = undefined;
    this.cscCrank = undefined;
    this.ftmsCadence = this.cpsCadence = this.cscCadence = undefined;
    if (this.devices.length === 0) this.status = 'disconnected';
    this.emit();
  };

  snapshot(): TrainerSnapshot {
    return {
      mode: this.mode,
      deviceName: this.deviceName,
      services: { ...this.services },
      control: this.control,
      simulation: this.simulation,
      status: this.status,
      busy: this.busy,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(input: SourceUpdate): void {
    if (this.mode === 'simulator') {
      this.advanceSimulator(input);
      return;
    }
    const now = performance.now();
    this.dropStale(now);
    if (this.status !== 'connected') return;
    if (input.erg && input.targetPower != null && this.control === 'granted' && this.targetPowerSupported) {
      const watts = Math.round(input.targetPower);
      // !(x < soglia) è vero anche col primo comando, quando l'ultimo valore è NaN
      if (!(Math.abs(watts - this.lastPowerCmd) < 1) || now - this.lastCmdAt > 2000) {
        this.lastPowerCmd = watts;
        this.lastCmdAt = now;
        this.enqueue(encodeSetTargetPower(watts));
      }
      return;
    }
    if (!input.erg && this.simulation !== 'unsupported' && this.control === 'granted') {
      if (!(Math.abs(input.grade - this.lastGrade) < 0.0015) || now - this.lastCmdAt > 1000) {
        this.lastGrade = input.grade;
        this.lastCmdAt = now;
        this.enqueue(
          encodeIndoorBikeSimulation({
            grade: input.grade,
            crr: input.crr,
            cw: input.cw,
          }),
        );
        this.simulation = 'active';
      }
    }
  }

  async useSimulator(): Promise<void> {
    this.disconnect();
    this.mode = 'simulator';
    this.status = 'idle';
    this.deviceName = null;
    this.services = emptyServices();
    this.control = 'none';
    this.simulation = 'none';
    this.emit();
  }

  async connectBluetooth(acceptAll: boolean): Promise<void> {
    const support = bluetoothSupport();
    if (!support.available || !navigator.bluetooth) {
      this.status = 'failed';
      this.emit();
      throw new Error(support.reason === 'ios' ? 'ios' : 'missing');
    }
    // con un rullo già collegato si può aggiungere una fascia: se l'aggiunta fallisce, il rullo resta
    const already = this.mode === 'bluetooth' && this.devices.length > 0;
    this.busy = true;
    if (!already) this.status = 'connecting';
    this.emit();
    let device: BluetoothDevice | null = null;
    try {
      device = await navigator.bluetooth.requestDevice(
        acceptAll
          ? { acceptAllDevices: true, optionalServices: SERVICES }
          : {
              filters: SERVICES.map((service) => ({ services: [service] })),
              optionalServices: SERVICES,
            },
      );
      device.addEventListener('gattserverdisconnected', this.onDisconnect);
      const server = await device.gatt?.connect();
      if (!server) throw new Error('gatt');
      if (!this.devices.includes(device)) this.devices.push(device);
      const now = performance.now();
      this.powerAt = this.cadenceAt = this.hrAt = now;
      const hadControl = this.controlChar;
      await this.discover(server, device);
      this.deviceName = this.devices.map((item) => item.name).filter(Boolean).join(' + ') || null;
      this.mode = 'bluetooth';
      this.status = 'connected';
      if (this.controlChar && this.controlChar !== hadControl) {
        await this.requestControl();
      }
    } catch (error) {
      if (device) this.forget(device);
      const name = error instanceof DOMException ? error.name : '';
      if (already) this.status = 'connected';
      else if (name === 'NotFoundError') this.status = 'cancelled';
      else if (this.status !== 'connected') this.status = 'failed';
      if (this.status !== 'connected') this.mode = 'simulator';
      throw error;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private forget(device: BluetoothDevice): void {
    this.devices = this.devices.filter((item) => item !== device);
    if (device === this.controlDevice) {
      this.controlChar = null;
      this.controlDevice = null;
      this.pending = null;
    }
    try {
      device.removeEventListener('gattserverdisconnected', this.onDisconnect);
      device.gatt?.disconnect();
    } catch {
      /* già sparita */
    }
  }

  disconnect(): void {
    for (const device of [...this.devices]) this.forget(device);
    this.controlChar = null;
    this.controlDevice = null;
    this.pending = null;
    this.services = emptyServices();
    this.control = 'none';
    this.simulation = 'none';
    if (this.mode === 'bluetooth') this.status = 'disconnected';
  }

  private async discover(server: BluetoothRemoteGATTServer, device: BluetoothDevice): Promise<void> {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      if (isUuid(service.uuid, FTMS)) {
        this.services.ftms = true;
        await this.bindFtms(service, device);
      } else if (isUuid(service.uuid, CPS)) {
        this.services.power = true;
        await this.listen(service, CPM, (view) => this.onCyclingPower(view));
      } else if (isUuid(service.uuid, HR)) {
        this.services.hr = true;
        await this.listen(service, HRM, (view) => {
          const hr = parseHeartRate(view);
          if (hr != null) {
            this.hr = hr;
            this.hrAt = performance.now();
          }
          this.emit();
        });
      } else if (isUuid(service.uuid, CSC)) {
        this.services.csc = true;
        await this.listen(service, CSCM, (view) => this.onCsc(view));
      }
    }
  }

  private async bindFtms(service: BluetoothRemoteGATTService, device: BluetoothDevice): Promise<void> {
    try {
      const feature = await service.getCharacteristic(FEATURE);
      const value = await feature.readValue();
      const flags = parseFtmsFeatures(value);
      this.targetPowerSupported = flags.targetPower;
      if (!flags.simulation) this.simulation = 'unsupported';
      if (!flags.targetPower) this.control = 'unsupported';
    } catch {
      this.targetPowerSupported = true;
    }
    await this.listen(service, INDOOR_BIKE, (view) => this.onIndoorBike(view));
    try {
      const control = await service.getCharacteristic(CONTROL);
      await control.startNotifications();
      control.addEventListener('characteristicvaluechanged', (event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic | null;
        const value = target?.value;
        if (!value) return;
        const response = parseControlPointResponse(value);
        if (!response) return;
        if (response.opcode === FTMS_OP.requestControl) {
          this.control = response.result === FTMS_RESULT_SUCCESS ? 'granted' : 'denied';
          // controllo (ri)ottenuto: il prossimo giro rimanda subito bersaglio o pendenza
          this.lastPowerCmd = Number.NaN;
          this.lastGrade = Number.NaN;
          this.emit();
        } else if (response.result === FTMS_RESULT_CONTROL_NOT_PERMITTED && this.control === 'granted') {
          // il rullo ha tolto il controllo (per esempio a favore di un'altra app): lo si richiede
          this.control = 'none';
          void this.requestControl();
          this.emit();
        }
      });
      this.controlChar = control;
      this.controlDevice = device;
    } catch {
      this.control = 'unsupported';
    }
  }

  private async requestControl(): Promise<void> {
    if (!this.controlChar) return;
    try {
      await this.write(this.controlChar, encodeRequestControl());
    } catch {
      this.control = 'denied';
      this.emit();
    }
  }

  private onIndoorBike(view: DataView): void {
    const data = parseIndoorBikeData(view);
    const now = performance.now();
    if (!this.services.power && data.powerW != null) {
      this.power = Math.max(0, data.powerW);
      this.powerAt = now;
    }
    if (data.cadenceRpm != null) this.ftmsCadence = data.cadenceRpm;
    if (!this.services.hr && data.heartRate != null) {
      this.hr = data.heartRate;
      this.hrAt = now;
    }
    this.pickCadence();
    this.emit();
  }

  private onCyclingPower(view: DataView): void {
    const reading = parseCyclingPower(view);
    if (!reading) return;
    this.power = Math.max(0, reading.power);
    this.powerAt = performance.now();
    if (reading.crankRevs != null && reading.crankTime != null) {
      const next = { revs: reading.crankRevs, time: reading.crankTime };
      const rpm = cadenceFromCrank(this.cpsCrank, next);
      this.cpsCrank = next;
      if (rpm != null) this.cpsCadence = rpm;
    }
    this.pickCadence();
    this.emit();
  }

  private onCsc(view: DataView): void {
    const reading = parseCsc(view);
    if (!reading || reading.crankRevs == null || reading.crankTime == null) return;
    const next = { revs: reading.crankRevs, time: reading.crankTime };
    const rpm = cadenceFromCrank(this.cscCrank, next);
    this.cscCrank = next;
    if (rpm != null) this.cscCadence = rpm;
    this.pickCadence();
    this.emit();
  }

  private pickCadence(): void {
    const value = this.cpsCadence ?? this.cscCadence ?? this.ftmsCadence;
    if (value != null) {
      this.cadence = value;
      this.cadenceAt = performance.now();
    }
  }

  /** Un sensore che tace da più di STALE_MS non tiene in vita il suo ultimo valore. */
  private dropStale(now: number): void {
    if (this.mode !== 'bluetooth') return;
    let changed = false;
    if (this.power !== 0 && now - this.powerAt > STALE_MS) {
      this.power = 0;
      changed = true;
    }
    if (this.cadence !== 0 && now - this.cadenceAt > STALE_MS) {
      this.cadence = 0;
      this.cpsCadence = this.cscCadence = this.ftmsCadence = undefined;
      changed = true;
    }
    if (this.hr !== 0 && now - this.hrAt > STALE_MS * 2) {
      this.hr = 0;
      changed = true;
    }
    if (changed) this.emit();
  }

  private async listen(
    service: BluetoothRemoteGATTService,
    uuid: number,
    onValue: (view: DataView) => void,
  ): Promise<void> {
    try {
      const char = await service.getCharacteristic(uuid);
      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic | null;
        const value = target?.value;
        if (value) onValue(value);
      });
    } catch {
      /* caratteristica assente: si continua con quelle disponibili */
    }
  }

  private enqueue(bytes: Uint8Array): void {
    if (!this.controlChar) return;
    this.pending = bytes;
    if (!this.writing) void this.flush();
  }

  private async flush(): Promise<void> {
    this.writing = true;
    try {
      while (this.pending && this.controlChar) {
        const bytes = this.pending;
        this.pending = null;
        try {
          await this.write(this.controlChar, bytes);
        } catch {
          /* un comando perso si ripete al giro dopo: ERG ogni 2 s, pendenza ogni 1 s */
        }
      }
    } finally {
      this.writing = false;
    }
  }

  private async write(char: BluetoothRemoteGATTCharacteristic, bytes: Uint8Array): Promise<void> {
    const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    if (char.properties.write) await char.writeValueWithResponse(payload);
    else await char.writeValueWithoutResponse(payload);
  }

  private advanceSimulator(input: SourceUpdate): void {
    const target = input.erg && input.targetPower != null ? input.targetPower : input.effort * input.ftp;
    const tau = input.erg ? 2.2 : 1.3;
    const wobble = input.erg
      ? Math.sin(this.simT * 2.1) * 4 + Math.sin(this.simT * 5.3) * 2
      : Math.sin(this.simT * 0.65) * target * 0.035;
    const desired = Math.max(0, target + wobble);
    const k = 1 - Math.exp(-Math.max(0, input.dt) / tau);
    this.power += (desired - this.power) * k;
    if (this.power < 0.5) this.power = 0;
    const intensity = input.ftp > 0 ? this.power / input.ftp : 0;
    const frac = Math.min(1, Math.max(0, 0.32 + 0.53 * intensity));
    const hrTarget = input.restHr + (input.maxHr - input.restHr) * frac;
    this.hr += (hrTarget - this.hr) * (1 - Math.exp(-Math.max(0, input.dt) / 18));
    const cadTarget = this.power < 15 ? 0 : 78 + Math.min(22, intensity * 14) + Math.sin(this.simT * 0.45) * 3;
    this.cadence += (cadTarget - this.cadence) * (1 - Math.exp(-Math.max(0, input.dt) / 2.2));
    if (this.cadence < 1) this.cadence = 0;
    this.simT += input.dt;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function isUuid(uuid: string, alias: number): boolean {
  const short = alias.toString(16).padStart(4, '0');
  const compact = uuid.toLowerCase().replace(/-/g, '');
  return compact.startsWith(`0000${short}`) || uuid.toLowerCase() === short;
}
