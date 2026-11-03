import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  CLOSE,
  MAX_DROPS,
  RIDER_COLORS,
  ROOM_ROUTES,
  cleanNick,
  isRoomId,
  newRoomId,
  parseClientMessage,
  parseJoin,
  pickColor,
  rateCheck,
} from '@/multiplayer/protocol';
import { RoomClient, estimateDistance, inviteUrl, type RemoteRider } from '@/multiplayer/room';
import { VERIFIED_ROUTES, headingToBearing, mapillaryUrl, streetViewUrl } from '@/domain/routes';
import { projector } from '@/domain/geo';
import { formatGap } from '@/pages/RideRoom';
import { BIKE, BODY, pedalAt, solveKnee } from '@/world/rider';

describe('protocollo delle stanze', () => {
  it('le salite delle stanze sono esattamente quelle verificate', () => {
    expect([...ROOM_ROUTES].sort()).toEqual(VERIFIED_ROUTES.map((r) => r.id).sort());
  });

  it('id stanza: 128 bit casuali, 22 caratteri url-safe, mai uguali', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRoomId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isRoomId(id)).toBe(true);
    expect(isRoomId('abc')).toBe(false);
    expect(isRoomId('../../../../etc/passwd/xx')).toBe(false);
  });

  it('parseJoin accetta solo stanza, salita, nome e id validi', () => {
    const room = newRoomId();
    const ok = parseJoin(new URL(`https://x.dev/rooms/${room}/ws?route=selvino-nembro&nick=Anna&pid=abcdefgh12`));
    expect(ok).toEqual({ ok: true, join: { room, route: 'selvino-nembro', nick: 'Anna', pid: 'abcdefgh12' } });
    expect(parseJoin(new URL(`https://x.dev/rooms/corto/ws?route=selvino-nembro&nick=A&pid=abcdefgh12`))).toEqual({ ok: false, error: 'room' });
    expect(parseJoin(new URL(`https://x.dev/rooms/${room}/ws?route=zoncolan&nick=A&pid=abcdefgh12`))).toEqual({ ok: false, error: 'route' });
    expect(parseJoin(new URL(`https://x.dev/rooms/${room}/ws?route=selvino-nembro&nick=%20%20&pid=abcdefgh12`))).toEqual({ ok: false, error: 'nick' });
    expect(parseJoin(new URL(`https://x.dev/rooms/${room}/ws?route=selvino-nembro&nick=A&pid=<script>`))).toEqual({ ok: false, error: 'pid' });
  });

  it('il nome perde caratteri invisibili e di controllo e si ferma a 24', () => {
    expect(cleanNick(`An${String.fromCharCode(0x202e)}na${String.fromCharCode(7)}`)).toBe('Anna');
    expect(cleanNick('  Bruno   il   veloce ')).toBe('Bruno il veloce');
    expect(cleanNick('x'.repeat(80))).toHaveLength(24);
    expect(cleanNick(String.fromCharCode(0x200b))).toBeNull();
    expect(cleanNick(42)).toBeNull();
  });

  it('i messaggi fuori schema si scartano', () => {
    expect(parseClientMessage('{"t":"state","d":120.55,"w":250.4,"v":6.123}')).toEqual({ t: 'state', d: 120.6, w: 250, v: 6.12, idle: false });
    expect(parseClientMessage('{"t":"state","d":-1,"w":1,"v":1}')).toBeNull();
    expect(parseClientMessage('{"t":"state","d":1,"w":9999,"v":1}')).toBeNull();
    expect(parseClientMessage('{"t":"state","d":1,"w":1,"v":"7"}')).toBeNull();
    expect(parseClientMessage('{"t":"state","d":1,"w":1,"v":1,"hr":150,"lat":45}')).toEqual({ t: 'state', d: 1, w: 1, v: 1, idle: false });
    expect(parseClientMessage(`{"t":"state","d":1,"w":1,"v":1,"x":"${'a'.repeat(300)}"}`)).toBeNull();
    expect(parseClientMessage('non json')).toBeNull();
    expect(parseClientMessage('{"t":"ping"}')).toEqual({ t: 'ping' });
  });

  it('limite di frequenza: uno ogni 350 ms, poi espulsione dopo troppi scarti', () => {
    const s = { last: 0, drops: 0, windowStart: 0 };
    expect(rateCheck(s, 1000)).toBe('ok');
    expect(rateCheck(s, 1100)).toBe('drop');
    expect(rateCheck(s, 1400)).toBe('ok');
    let last: string = 'ok';
    for (let i = 0; i <= MAX_DROPS; i++) last = rateCheck(s, 1401 + i);
    expect(last).toBe('kick');
    // una finestra nuova azzera gli scarti
    const t = { last: 0, drops: MAX_DROPS, windowStart: 0 };
    expect(rateCheck(t, 20_000)).toBe('ok');
    expect(t.drops).toBe(0);
  });

  it('colori: il primo libero', () => {
    expect(pickColor([])).toBe(0);
    expect(pickColor([0, 1, 3])).toBe(2);
    expect(pickColor([0, 1, 2, 3, 4, 5, 6, 7])).toBeLessThan(RIDER_COLORS.length);
  });
});

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState: 0 | 1 | 2 | 3 = 0;
  sent: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

describe('RoomClient', () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    now = 10_000;
  });
  afterEach(() => vi.useRealTimers());

  const make = () =>
    new RoomClient({
      room: newRoomId(),
      route: 'selvino-nembro',
      nick: 'Anna Bella',
      pid: 'pid-anna-01',
      baseUrl: 'https://rooms.example',
      socketFactory: (url) => new FakeSocket(url),
      now: () => now,
    });

  const peer = (id: string, d: number, extra = {}) => ({ id, nick: id, color: 1, d, w: 200, v: 5, idle: false, at: 0, ...extra });

  it('si collega con i parametri giusti ed entra al benvenuto', () => {
    const c = make();
    c.connect();
    const ws = FakeSocket.all[0];
    expect(ws.url).toMatch(/^wss:\/\/rooms\.example\/rooms\/[A-Za-z0-9_-]{22}\/ws\?route=selvino-nembro&nick=Anna%20Bella&pid=pid-anna-01$/);
    expect(c.snapshot().status).toBe('connecting');
    ws.open();
    ws.receive({ t: 'welcome', you: 'pid-anna-01', color: 2, route: 'selvino-nembro', peers: [peer('bruno', 50)], max: 8 });
    expect(c.snapshot().status).toBe('open');
    expect(c.snapshot().color).toBe(2);
    expect(c.snapshot().riders.map((r) => r.id)).toEqual(['bruno']);
    ws.receive({ t: 'peer', p: peer('carla', 10) });
    ws.receive({ t: 'peer', p: peer('pid-anna-01', 999) });
    expect(c.snapshot().riders.map((r) => r.id).sort()).toEqual(['bruno', 'carla']);
    ws.receive({ t: 'leave', id: 'bruno' });
    expect(c.snapshot().riders.map((r) => r.id)).toEqual(['carla']);
  });

  it('manda al massimo un aggiornamento ogni 500 ms, con soli distanza/watt/velocità', () => {
    const c = make();
    c.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.receive({ t: 'welcome', you: 'pid-anna-01', color: 0, route: 'selvino-nembro', peers: [], max: 8 });
    const state = { distance: 12.345, power: 251.6, speed: 6.789, idle: false };
    for (let i = 0; i < 10; i++) {
      c.update(state);
      now += 50;
    }
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ t: 'state', d: 12.3, w: 252, v: 6.79, idle: false });
    now += 500;
    c.update(state);
    expect(ws.sent).toHaveLength(2);
  });

  it('dopo un taglio rientra da solo, con attese crescenti', () => {
    const c = make();
    c.connect();
    FakeSocket.all[0].open();
    FakeSocket.all[0].drop(1006);
    expect(c.snapshot().status).toBe('reconnecting');
    vi.advanceTimersByTime(599);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].drop(1006);
    vi.advanceTimersByTime(1199);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2].open();
    FakeSocket.all[2].receive({ t: 'welcome', you: 'pid-anna-01', color: 0, route: 'selvino-nembro', peers: [], max: 8 });
    expect(c.snapshot().status).toBe('open');
  });

  it('stanza piena o su un’altra salita: si ferma e lo dice, senza riprovare', () => {
    const c = make();
    c.connect();
    const ws = FakeSocket.all[0];
    ws.receive({ t: 'error', code: 'full' });
    ws.drop(CLOSE.full);
    expect(c.snapshot().status).toBe('full');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);

    const d = make();
    d.connect();
    FakeSocket.all[1].drop(CLOSE.route);
    expect(d.snapshot().status).toBe('route');
  });

  it('uscire chiude il socket e non rientra', () => {
    const c = make();
    c.connect();
    FakeSocket.all[0].open();
    c.leave();
    expect(c.snapshot().status).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('stima la distanza degli altri per al massimo 3 s', () => {
    const r: RemoteRider = { ...peer('x', 100), v: 10, seenAt: 0 };
    expect(estimateDistance(r, 1000)).toBe(110);
    expect(estimateDistance(r, 60_000)).toBe(130);
    expect(estimateDistance({ ...r, idle: true }, 60_000)).toBe(100);
  });

  it('il link d’invito apre la stessa salita nella stessa stanza', () => {
    expect(inviteUrl('mortirolo-mazzo', 'A'.repeat(22), 'https://micmer-git.github.io/allenando/')).toBe(
      `https://micmer-git.github.io/allenando/ride?route=mortirolo-mazzo&room=${'A'.repeat(22)}`,
    );
  });

  it('distacchi leggibili', () => {
    expect(formatGap(2)).toBe('affiancati');
    expect(formatGap(120.4)).toBe('120 m davanti');
    expect(formatGap(-40)).toBe('40 m dietro');
    expect(formatGap(2500)).toBe('2,5 km davanti');
  });
});

describe('strada vera: punto e direzione', () => {
  it('dalla direzione del mondo alla rotta bussola', () => {
    const proj = projector({ lat: 45.7, lon: 9.75 });
    const a = proj.toLocal({ lat: 45.7, lon: 9.75 });
    const north = proj.toLocal({ lat: 45.701, lon: 9.75 });
    const east = proj.toLocal({ lat: 45.7, lon: 9.751 });
    // nel mondo avanti = (sin h, cos h): h = atan2(dx, dz)
    const h = (b: { x: number; z: number }) => Math.atan2(b.x - a.x, b.z - a.z);
    expect(headingToBearing(h(north))).toBeCloseTo(0, 5);
    expect(headingToBearing(h(east))).toBeCloseTo(90, 5);
    const sw = proj.toLocal({ lat: 45.699, lon: 9.75 - 0.001 / Math.cos((45.7 * Math.PI) / 180) });
    expect(headingToBearing(h(sw))).toBeCloseTo(225, 0);
  });

  it('link ai visori ufficiali, senza scaricare immagini', () => {
    expect(streetViewUrl({ lat: 45.74397, lon: 9.75928 }, 361.4)).toBe(
      'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=45.74397,9.75928&heading=1&pitch=0&fov=90',
    );
    expect(mapillaryUrl({ lat: 45.74397, lon: 9.75928 })).toBe('https://www.mapillary.com/app/?lat=45.74397&lng=9.75928&z=17');
  });
});

describe('ciclista 3D: gambe sui pedali', () => {
  it('coscia e tibia restano lunghe quanto sono, il ginocchio sta davanti, la pedivella gira avanti', () => {
    const hip = new THREE.Vector3(BODY.hip[0], BODY.hip[1], BODY.hip[2]);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const pedal = pedalAt(a, true);
      expect(Math.hypot(pedal.y - BIKE.bb[1], pedal.z - BIKE.bb[2])).toBeCloseTo(BIKE.crank, 6);
      const ankle = new THREE.Vector3(pedal.x, pedal.y + BODY.ankle[1], pedal.z + BODY.ankle[2]);
      const knee = solveKnee(hip, ankle, BODY.thigh, BODY.shin);
      const thigh = Math.hypot(knee.y - hip.y, knee.z - hip.z);
      const shin = Math.hypot(ankle.y - knee.y, ankle.z - knee.z);
      expect(thigh).toBeCloseTo(BODY.thigh, 3);
      // al punto morto basso la gamba può arrivare tesa: la tibia non si allunga mai
      expect(shin).toBeLessThanOrEqual(BODY.shin + 1e-3);
      expect(knee.z).toBeGreaterThan(Math.min(hip.z, ankle.z));
    }
    expect(pedalAt(0.3, true).z).toBeGreaterThan(pedalAt(0, true).z);
    expect(pedalAt(0, false).y).toBeCloseTo(BIKE.bb[1] - BIKE.crank, 6);
  });
});
