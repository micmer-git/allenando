import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Ride } from '../src/domain/types';
import { Encoder, Profile, type FileIdMesg, type LapMesg, type RecordMesg } from '@garmin/fitsdk';
import { encodeActivityFit } from '../src/io/fit';
import { encodeTcx } from '../src/io/tcx';
import { parseUpload } from '../src/io/import';

const ctx = { ftp: 250, lthr: 165 };

function ride(partial: Partial<Ride> = {}): Ride {
  const samples = Array.from({ length: 120 }, (_, i) => ({
    t: i,
    power: i < 60 ? 180 : 260,
    hr: 140 + (i % 10),
    cadence: 88,
    speed: 8,
    distance: i * 8,
    altitude: 100 + Math.sin(i / 10) * 4,
    grade: 0.01,
  }));
  return {
    id: 'giro-1',
    name: 'Collina del martedì',
    sport: 'cycling',
    source: 'indoor',
    startTime: '2026-10-27T07:30:00.000Z',
    durationSec: 120,
    distanceM: 120 * 8,
    elevationGainM: 8,
    avgPower: 220,
    maxPower: 260,
    np: 230,
    intensityFactor: 0.92,
    tss: 12,
    tssSource: 'power',
    avgHr: 145,
    maxHr: 149,
    avgCadence: 88,
    avgSpeed: 8,
    kcal: 26,
    powerZoneSec: [0, 0, 60, 60, 0, 0, 0],
    hrZoneSec: [0, 0, 0, 120, 0, 0, 0],
    withCamilla: true,
    ftp: 250,
    samples,
    ...partial,
  };
}

describe('FIT, TCX, GPX e ZIP', () => {
  it('fa il giro completo di un FIT e conserva potenza e distanza', () => {
    const original = ride();
    const bytes = encodeActivityFit(original);
    const parsed = parseUpload('Collina del martedì.fit', bytes, ctx);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rides).toHaveLength(1);
    const back = parsed.rides[0];
    expect(back.fileType).toBe('fit');
    expect(back.distanceM).toBeCloseTo(original.distanceM, 0);
    expect(back.samples.length).toBeGreaterThan(60);
    expect(back.avgPower).toBeGreaterThan(200);
    expect(back.avgPower).toBeLessThan(240);
    expect(back.np).toBeGreaterThan(back.avgPower ?? 0);
    expect(back.tssSource).toBe('power');
    expect(back.sport).toBe('cycling');
    const powers = back.samples.map((s) => s.power);
    expect(Math.min(...powers.filter((p) => p > 0))).toBeLessThan(200);
    expect(Math.max(...powers)).toBeGreaterThan(240);
  });

  it('legge un GPX con potenza e frequenza nelle estensioni', () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" version="1.1">
  <trk>
    <name>Giro del parco</name>
    <trkseg>
      <trkpt lat="45.4642" lon="9.1900"><ele>120</ele><time>2026-10-12T08:00:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>130</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad><power>150</power></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="45.4650" lon="9.1920"><ele>125</ele><time>2026-10-12T08:05:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>142</gpxtpx:hr><gpxtpx:cad>90</gpxtpx:cad><power>190</power></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="45.4660" lon="9.1940"><ele>122</ele><time>2026-10-12T08:10:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>136</gpxtpx:hr><gpxtpx:cad>88</gpxtpx:cad><power>160</power></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;
    const parsed = parseUpload('parco.gpx', strToU8(gpx), ctx);
    expect(parsed.errors).toEqual([]);
    const activity = parsed.rides[0];
    expect(activity.name).toBe('Giro del parco');
    expect(activity.fileType).toBe('gpx');
    expect(activity.distanceM).toBeGreaterThan(200);
    expect(activity.durationSec).toBeCloseTo(600, 0);
    expect(activity.avgPower).toBeGreaterThan(140);
    expect(activity.avgHr).toBeGreaterThan(120);
    expect(activity.elevationGainM).toBeGreaterThan(4);
  });

  it('legge un TCX con i watt nelle estensioni', () => {
    const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-10-20T09:00:00Z</Id>
      <Lap StartTime="2026-10-20T09:00:00Z">
        <TotalTimeSeconds>120</TotalTimeSeconds>
        <DistanceMeters>800</DistanceMeters>
        <Calories>20</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          <Trackpoint>
            <Time>2026-10-20T09:00:00Z</Time>
            <DistanceMeters>0</DistanceMeters>
            <AltitudeMeters>140</AltitudeMeters>
            <HeartRateBpm><Value>125</Value></HeartRateBpm>
            <Cadence>84</Cadence>
            <Extensions><ns3:TPX><ns3:Watts>140</ns3:Watts><ns3:Speed>6.5</ns3:Speed></ns3:TPX></Extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-10-20T09:02:00Z</Time>
            <DistanceMeters>800</DistanceMeters>
            <AltitudeMeters>148</AltitudeMeters>
            <HeartRateBpm><Value>150</Value></HeartRateBpm>
            <Cadence>92</Cadence>
            <Extensions><ns3:TPX><ns3:Watts>220</ns3:Watts><ns3:Speed>7.1</ns3:Speed></ns3:TPX></Extensions>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
    const parsed = parseUpload('giro.tcx', strToU8(tcx), ctx);
    expect(parsed.errors).toEqual([]);
    const activity = parsed.rides[0];
    expect(activity.fileType).toBe('tcx');
    expect(activity.sport).toBe('cycling');
    expect(activity.distanceM).toBeCloseTo(800, 0);
    expect(activity.durationSec).toBeCloseTo(120, 0);
    expect(activity.avgPower).toBeGreaterThan(140);
    expect(activity.maxHr).toBeGreaterThanOrEqual(149);
    expect(activity.elevationGainM).toBeGreaterThan(7);
  });

  it('apre uno ZIP con FIT e GPX insieme', () => {
    const fit = encodeActivityFit(ride());
    const gpx = strToU8(`<?xml version="1.0"?><gpx><trk><name>Parco</name><trkseg>
      <trkpt lat="45.46" lon="9.19"><ele>10</ele><time>2026-09-01T10:00:00Z</time></trkpt>
      <trkpt lat="45.47" lon="9.20"><ele>20</ele><time>2026-09-01T10:10:00Z</time></trkpt>
    </trkseg></trk></gpx>`);
    const zip = zipSync({
      'Garmin/Activity/collina.fit': fit,
      'Garmin/Activity/parco.gpx': gpx,
      'leggi-questo.txt': strToU8('ignora'),
    });
    const parsed = parseUpload('archivio.zip', zip, ctx);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rides).toHaveLength(2);
    expect(parsed.rides.map((item) => item.fileType).sort()).toEqual(['fit', 'gpx']);
  });
});

// Percorso DEMO: una retta sintetica, nessuna salita reale.
const DEMO_LAT = 45.1;
const DEMO_LON = 9.1;
const M_PER_DEG_LAT = 111_320;

function demoGpsRide(): Ride {
  const base = ride({ name: 'DEMO retta GPS', source: 'import' });
  const samples = base.samples.map((s) => ({
    ...s,
    lat: DEMO_LAT + s.distance / M_PER_DEG_LAT,
    lon: DEMO_LON,
  }));
  return {
    ...base,
    samples,
    laps: [
      { startSec: 0, endSec: 60, distanceStartM: 0, distanceEndM: 480, name: 'Giro 1' },
      { startSec: 60, endSec: 119, distanceStartM: 480, distanceEndM: 952, name: 'Giro 2' },
    ],
  };
}

describe('GPS e giri negli import', () => {
  it('FIT: posizioni in gradi e giri tornano indietro dal file', () => {
    const original = demoGpsRide();
    const back = parseUpload('DEMO retta.fit', encodeActivityFit(original), ctx).rides[0];
    expect(back.samples[0].lat).toBeCloseTo(DEMO_LAT, 6);
    expect(back.samples[0].lon).toBeCloseTo(DEMO_LON, 6);
    expect(back.samples[50].lat).toBeCloseTo(DEMO_LAT + 400 / M_PER_DEG_LAT, 6);
    expect(back.laps).toHaveLength(2);
    expect(back.laps![0].startSec).toBeCloseTo(0, 3);
    expect(back.laps![0].endSec).toBeCloseTo(60, 3);
    expect(back.laps![1].startSec).toBeCloseTo(60, 3);
    expect(back.laps![1].endSec).toBeCloseTo(119, 3);
    expect(back.laps![1].distanceStartM).toBeCloseTo(480, 0);
    expect(back.laps![1].distanceEndM).toBeCloseTo(952, 0);
  });

  it('FIT senza GPS: niente coordinate, mai 0,0', () => {
    const back = parseUpload('DEMO indoor.fit', encodeActivityFit(ride()), ctx).rides[0];
    expect(back.samples.every((s) => s.lat === undefined && s.lon === undefined)).toBe(true);
    // Il file ha un solo lap che copre tutto il giro.
    expect(back.laps).toHaveLength(1);
  });

  it('FIT: i record senza posizione restano senza coordinate', () => {
    const original = demoGpsRide();
    original.samples = original.samples.map((s, i) => (i >= 60 ? { ...s, lat: undefined, lon: undefined } : s));
    const back = parseUpload('DEMO mezzo GPS.fit', encodeActivityFit(original), ctx).rides[0];
    expect(back.samples[30].lat).toBeCloseTo(DEMO_LAT + 240 / M_PER_DEG_LAT, 6);
    expect(back.samples[90].lat).toBeUndefined();
    expect(back.samples.some((s) => s.lat === 0 || s.lon === 0)).toBe(false);
  });

  it("FIT: decodifica un file scritto a mano con l'Encoder del FIT SDK", () => {
    const encoder = new Encoder();
    const start = new Date('2026-10-01T06:00:00Z');
    const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180);
    encoder.onMesg(Profile.MesgNum.FILE_ID, {
      type: 'activity',
      manufacturer: 'development',
      product: 1,
      timeCreated: start,
    } as FileIdMesg);
    for (let i = 0; i <= 30; i++) {
      encoder.onMesg(Profile.MesgNum.RECORD, {
        timestamp: new Date(start.getTime() + i * 1000),
        positionLat: i === 10 ? undefined : semi(DEMO_LAT + i * 1e-4),
        positionLong: i === 10 ? undefined : semi(DEMO_LON),
        distance: i * 11,
        power: 200,
      } as RecordMesg);
    }
    encoder.onMesg(Profile.MesgNum.LAP, {
      messageIndex: 0,
      startTime: start,
      timestamp: new Date(start.getTime() + 15_000),
      totalElapsedTime: 15,
      totalDistance: 165,
    } as LapMesg);
    encoder.onMesg(Profile.MesgNum.LAP, {
      messageIndex: 1,
      startTime: new Date(start.getTime() + 15_000),
      timestamp: new Date(start.getTime() + 30_000),
      totalElapsedTime: 15,
      totalDistance: 165,
    } as LapMesg);
    const back = parseUpload('DEMO sdk.fit', encoder.close(), ctx).rides[0];
    expect(back.samples[20].lat).toBeCloseTo(DEMO_LAT + 20e-4, 6);
    expect(back.laps?.map((l) => [l.startSec, l.endSec])).toEqual([
      [0, 15],
      [15, 30],
    ]);
    expect(back.laps![1].distanceStartM).toBeCloseTo(165, 0);
  });

  it('TCX: Position e ogni <Lap> diventano coordinate e giri', () => {
    const tp = (sec: number, dist: number) => {
      const time = new Date(Date.UTC(2026, 9, 20, 9, 0, sec)).toISOString();
      const lat = (DEMO_LAT + dist / M_PER_DEG_LAT).toFixed(7);
      return `<Trackpoint><Time>${time}</Time><Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${DEMO_LON}</LongitudeDegrees></Position><DistanceMeters>${dist}</DistanceMeters><AltitudeMeters>100</AltitudeMeters></Trackpoint>`;
    };
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Biking"><Id>2026-10-20T09:00:00Z</Id>
      <Lap StartTime="2026-10-20T09:00:00Z"><TotalTimeSeconds>30</TotalTimeSeconds><DistanceMeters>240</DistanceMeters><Track>${tp(0, 0)}${tp(15, 120)}${tp(30, 240)}</Track></Lap>
      <Lap StartTime="2026-10-20T09:00:30Z"><TotalTimeSeconds>30</TotalTimeSeconds><DistanceMeters>240</DistanceMeters><Track>${tp(45, 360)}${tp(60, 480)}</Track></Lap>
      <Notes>DEMO due giri</Notes></Activity></Activities></TrainingCenterDatabase>`;
    const back = parseUpload('DEMO.tcx', strToU8(tcx), ctx).rides[0];
    expect(back.samples[0].lat).toBeCloseTo(DEMO_LAT, 6);
    expect(back.samples[60].lat).toBeCloseTo(DEMO_LAT + 480 / M_PER_DEG_LAT, 6);
    expect(back.laps).toHaveLength(2);
    expect(back.laps![1].startSec).toBe(30);
    expect(back.laps![1].endSec).toBe(60);
    expect(back.laps![1].distanceStartM).toBeCloseTo(240, 0);
    expect(back.laps![1].distanceEndM).toBeCloseTo(480, 0);
  });

  it('TCX: encodeTcx scrive posizioni e giri e li rilegge', () => {
    const original = demoGpsRide();
    const back = parseUpload('DEMO.tcx', strToU8(encodeTcx(original)), ctx).rides[0];
    expect(back.samples[10].lat).toBeCloseTo(original.samples[10].lat!, 6);
    expect(back.laps).toHaveLength(2);
    expect(back.laps![1].startSec).toBeCloseTo(60, 3);
  });

  it('TCX senza Position: coordinate assenti', () => {
    const back = parseUpload('DEMO.tcx', strToU8(encodeTcx(ride())), ctx).rides[0];
    expect(back.samples.every((s) => s.lat === undefined)).toBe(true);
  });

  it('GPX: le coordinate arrivano nei campioni, senza giri', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><name>DEMO</name><trkseg>
      <trkpt lat="45.1000" lon="9.1000"><ele>10</ele><time>2026-09-01T10:00:00Z</time></trkpt>
      <trkpt lat="45.1010" lon="9.1000"><ele>12</ele><time>2026-09-01T10:00:20Z</time></trkpt>
    </trkseg></trk></gpx>`;
    const back = parseUpload('DEMO.gpx', strToU8(gpx), ctx).rides[0];
    expect(back.samples[0].lat).toBeCloseTo(45.1, 6);
    expect(back.samples[10].lat).toBeCloseTo(45.1005, 6);
    expect(back.samples[20].lon).toBeCloseTo(9.1, 6);
    expect(back.laps).toBeUndefined();
  });
});
