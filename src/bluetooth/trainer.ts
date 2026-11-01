import {
  encodeIndoorBikeSimulation,
  encodeRequestControl,
  encodeSetTargetPower,
  parseControlPointResponse,
  parseFtmsFeatures,
  parseIndoorBikeData,
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
  private server: BluetoothRemoteGATTServer | null = null;
  private device: BluetoothDevice | null = null;
  private controlChar: BluetoothRemoteGATTCharacteristic | null = null;
  private targetPowerSupported = true;
  private writeChain: Promise<void> = Promise.resolve();
  private lastGrade = Number.NaN;
  private lastPowerCmd = Number.NaN;
  private lastCmdAt = 0;
  private cpsCrank: CrankPoint | undefined;
  private cscCrank: CrankPoint | undefined;
  private ftmsCadence: number | undefined;
  private cpsCadence: number | undefined;
  private cscCadence: number | undefined;
  private simT = 0;
  private onDisconnect = () => {
    this.status = 'disconnected';
    this.control = 'none';
    this.simulation = 'none';
    this.server = null;
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
    if (this.status !== 'connected') return;
    const now = performance.now();
    if (input.erg && input.targetPower != null && this.control === 'granted' && this.targetPowerSupported) {
      const watts = Math.round(input.targetPower);
      if (Math.abs(watts - this.lastPowerCmd) >= 1 || now - this.lastCmdAt > 2000) {
        this.lastPowerCmd = watts;
        this.lastCmdAt = now;
        this.enqueue(encodeSetTargetPower(watts));
      }
      return;
    }
    if (!input.erg && this.simulation !== 'unsupported' && this.control === 'granted') {
      if (Math.abs(input.grade - this.lastGrade) >= 0.0015 || now - this.lastCmdAt > 1000) {
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
    this.busy = true;
    this.status = 'connecting';
    this.emit();
    try {
      const device = await navigator.bluetooth.requestDevice(
        acceptAll
          ? { acceptAllDevices: true, optionalServices: SERVICES }
          : {
              filters: SERVICES.map((service) => ({ services: [service] })),
              optionalServices: SERVICES,
            },
      );
      this.device = device;
      this.deviceName = device.name ?? null;
      device.addEventListener('gattserverdisconnected', this.onDisconnect);
      const server = await device.gatt?.connect();
      if (!server) throw new Error('gatt');
      this.server = server;
      await this.discover(server);
      this.mode = 'bluetooth';
      this.status = 'connected';
      if (this.services.ftms && this.controlChar) {
        await this.requestControl();
      }
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotFoundError') this.status = 'cancelled';
      else if (this.status !== 'connected') this.status = 'failed';
      if (this.status !== 'connected') this.mode = 'simulator';
      throw error;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  disconnect(): void {
    try {
      this.device?.removeEventListener('gattserverdisconnected', this.onDisconnect);
      this.server?.disconnect();
    } catch {
      /* la periferica può essere già sparita */
    }
    this.server = null;
    this.device = null;
    this.controlChar = null;
    this.services = emptyServices();
    this.control = 'none';
    this.simulation = 'none';
    if (this.mode === 'bluetooth') this.status = 'disconnected';
  }

  private async discover(server: BluetoothRemoteGATTServer): Promise<void> {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      if (isUuid(service.uuid, FTMS)) {
        this.services.ftms = true;
        await this.bindFtms(service);
      } else if (isUuid(service.uuid, CPS)) {
        this.services.power = true;
        await this.listen(service, CPM, (view) => this.onCyclingPower(view));
      } else if (isUuid(service.uuid, HR)) {
        this.services.hr = true;
        await this.listen(service, HRM, (view) => {
          const hr = parseHeartRate(view);
          if (hr != null) this.hr = hr;
          this.emit();
        });
      } else if (isUuid(service.uuid, CSC)) {
        this.services.csc = true;
        await this.listen(service, CSCM, (view) => this.onCsc(view));
      }
    }
  }

  private async bindFtms(service: BluetoothRemoteGATTService): Promise<void> {
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
        if (response.opcode === 0x00) {
          this.control = response.result === FTMS_RESULT_SUCCESS ? 'granted' : 'denied';
          this.emit();
        }
      });
      this.controlChar = control;
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
    }
  }

  private onIndoorBike(view: DataView): void {
    const data = parseIndoorBikeData(view);
    if (!this.services.power && data.powerW != null) this.power = data.powerW;
    if (data.cadenceRpm != null) this.ftmsCadence = data.cadenceRpm;
    if (!this.services.hr && data.heartRate != null) this.hr = data.heartRate;
    this.pickCadence();
    this.emit();
  }

  private onCyclingPower(view: DataView): void {
    const reading = parseCyclingPower(view);
    if (!reading) return;
    this.power = reading.power;
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
    if (value != null) this.cadence = value;
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
    const char = this.controlChar;
    if (!char) return;
    this.writeChain = this.writeChain
      .then(() => this.write(char, bytes))
      .catch(() => undefined);
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
