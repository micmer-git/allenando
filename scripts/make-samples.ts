import { mkdirSync, writeFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { buildRide } from '../src/domain/metrics';
import type { Ride, RideSample } from '../src/domain/types';
import { encodeActivityFit } from '../src/io/fit';

const FTP = 220;
const LTHR = 166;

function ride(opts: {
  name: string;
  start: string;
  samples: RideSample[];
  fileType?: Ride['fileType'];
}): Ride {
  const last = opts.samples[opts.samples.length - 1];
  return buildRide({
    id: `sample-${opts.start}`,
    name: opts.name,
    source: 'import',
    fileType: opts.fileType,
    startTime: new Date(opts.start),
    durationSec: last?.t ?? opts.samples.length,
    samples: opts.samples,
    ftp: FTP,
    lthr: LTHR,
    withCamilla: false,
    distanceM: last?.distance ?? 0,
  });
}

function effort(minutes: number, powerAt: (minute: number) => number, gradeAt?: (second: number) => number): RideSample[] {
  const total = Math.round(minutes * 60);
  let distance = 0;
  let altitude = 140;
  const samples: RideSample[] = [];
  for (let t = 0; t < total; t++) {
    const minute = t / 60;
    const power = Math.max(0, powerAt(minute));
    const grade = gradeAt?.(t) ?? 0;
    const speed = 4.2 + power / 70;
    distance += speed;
    altitude += grade * speed;
    samples.push({
      t,
      power,
      hr: 118 + power / 7,
      cadence: power < 100 ? 78 : 88,
      speed,
      distance,
      altitude,
      grade,
    });
  }
  return samples;
}

const archived: { file: string; ride: Ride }[] = [
  {
    file: 'Fondo 6 settembre.fit',
    ride: ride({
      name: 'Fondo 6 settembre',
      start: '2026-09-06T07:30:00Z',
      samples: effort(75, () => 145 + Math.sin(0) * 0 + 8 * Math.sin(Math.PI)),
    }),
  },
  {
    file: 'Ripetute 13 settembre.fit',
    ride: ride({
      name: 'Ripetute 13 settembre',
      start: '2026-09-13T08:10:00Z',
      samples: effort(48, (minute) => {
        const block = minute % 8;
        return block < 4 ? 280 : 120;
      }),
    }),
  },
  {
    file: 'Lungo 20 settembre.fit',
    ride: ride({
      name: 'Lungo 20 settembre',
      start: '2026-09-20T06:40:00Z',
      samples: effort(100, (minute) => 155 + 12 * Math.sin(minute / 7)),
    }),
  },
  {
    file: 'Recupero 27 settembre.fit',
    ride: ride({
      name: 'Recupero 27 settembre',
      start: '2026-09-27T09:00:00Z',
      samples: effort(40, () => 115),
    }),
  },
  {
    file: 'Sweet spot 4 ottobre.fit',
    ride: ride({
      name: 'Sweet spot 4 ottobre',
      start: '2026-10-04T07:15:00Z',
      samples: effort(54, (minute) => {
        if (minute < 10) return 120;
        const into = (minute - 10) % 12;
        if (minute > 46) return 110;
        return into < 8 ? 200 : 125;
      }),
    }),
  },
  {
    file: 'Tempo 11 ottobre.fit',
    ride: ride({
      name: 'Tempo 11 ottobre',
      start: '2026-10-11T17:20:00Z',
      samples: effort(50, (minute) => (minute > 8 && minute < 42 ? 185 : 120)),
    }),
  },
  {
    file: 'Recupero 18 ottobre.fit',
    ride: ride({
      name: 'Recupero 18 ottobre',
      start: '2026-10-18T08:05:00Z',
      samples: effort(35, () => 110),
    }),
  },
  {
    file: 'Soglia 25 ottobre.fit',
    ride: ride({
      name: 'Soglia 25 ottobre',
      start: '2026-10-25T07:00:00Z',
      samples: effort(62, (minute) => {
        if (minute < 12 || minute > 54) return 125;
        if (minute > 32 && minute < 38) return 130;
        return 230;
      }),
    }),
  },
];

// The sine above for fondo is constant-ish. Make fondo gently variable so NP differs.
archived[0].ride = ride({
  name: 'Fondo 6 settembre',
  start: '2026-09-06T07:30:00Z',
  samples: effort(75, (minute) => 142 + 18 * Math.sin(minute / 6)),
});

const collina = ride({
  name: 'Collina del martedì',
  start: '2026-10-27T07:20:00Z',
  fileType: 'fit',
  samples: effort(
    36,
    (minute) => 150 + 40 * Math.sin(minute / 3),
    (second) => 0.03 * Math.sin(second / 40),
  ),
});

function gpx(): string {
  const start = Date.parse('2026-10-12T08:00:00Z');
  let lat = 45.4642;
  let lon = 9.19;
  const points: string[] = [];
  for (let i = 0; i <= 48; i++) {
    lat += 0.00035 * Math.cos(i / 6);
    lon += 0.00042 * Math.sin(i / 5);
    const ele = 122 + 6 * Math.sin(i / 5);
    const power = 150 + Math.round(30 * Math.sin(i / 4));
    const hr = 128 + Math.round(8 * Math.sin(i / 7));
    const time = new Date(start + i * 15000).toISOString();
    points.push(
      `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele><time>${time}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr><gpxtpx:cad>86</gpxtpx:cad><power>${power}</power></gpxtpx:TrackPointExtension></extensions></trkpt>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Camilla Ride" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><name>Giro del parco</name><trkseg>
    ${points.join('\n    ')}
  </trkseg></trk>
</gpx>`;
}

const dir = new URL('../public/samples/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('giro-parco.gpx', dir), gpx());
writeFileSync(new URL('Collina del martedì.fit', dir), encodeActivityFit(collina));

const zipped: Record<string, Uint8Array> = {};
for (const item of archived) {
  zipped[`Garmin/Activity/${item.file}`] = encodeActivityFit(item.ride);
}
writeFileSync(new URL('archivio-garmin.zip', dir), zipSync(zipped));
console.log('samples ready', Object.keys(zipped).length);
