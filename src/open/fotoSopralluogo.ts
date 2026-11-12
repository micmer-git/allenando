import { haversine, type LatLon } from '@/domain/geo';
import { headingToBearing } from '@/domain/routes';
import type { WorldPath } from './path';

export interface SurveyPhoto extends LatLon {
  id: string;
  title: string;
  position: 'camera' | 'subject';
  /** North-clockwise azimuth recorded by the source. Omitted for an undocumented view. */
  bearing?: number;
  date?: string;
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
  /** Local paths are relative to the world's foto directory. */
  image: string;
  credits?: string;
  positionSource?: string;
  subject?: LatLon;
  derivative?: {image: string; note: string};
  radiusM?: number;
}

export interface RoadFrame extends LatLon {
  id: string;
  seq: string;
  idx: number;
  date: string;
  author: string;
  bearing: number | null;
  url: string;
  local?: string;
}
export interface PhotoAtlas { places: SurveyPhoto[]; frames: RoadFrame[] }

export function roadPhoto(frame: RoadFrame): SurveyPhoto {
  return {
    id: 'kv-' + frame.id, title: 'Vista dalla strada', position: 'camera',
    lat: frame.lat, lon: frame.lon, bearing: frame.bearing ?? undefined,
    date: frame.date, author: frame.author, credits: '© Grab and KartaView Contributors',
    source: `https://kartaview.org/details/${frame.seq}/${frame.idx}/track-info`,
    license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    image: frame.local ?? frame.url,
  };
}

export interface PhotoStation extends LatLon { bearing: number; distance: number }
export interface PhotoMatch { photo: SurveyPhoto; off: number; subjectOff?: number }
export interface StationPhotos { station: number; distance: number; matches: PhotoMatch[] }

export function surveyStations(path: WorldPath, toGeo: (x: number, z: number) => LatLon): PhotoStation[] {
  return Array.from({length: Math.ceil(path.length / 100) + 1}, (_, index) => {
    const distance = Math.min(index * 100, path.length);
    const pose = path.poseAt(distance);
    return { ...toGeo(pose.x, pose.z), bearing: headingToBearing(pose.heading), distance };
  });
}

function angleDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function viewDirection(bearing: number | undefined, travel: number): string {
  if (bearing == null) return 'Orientamento dello scatto sconosciuto';
  const delta = angleDifference(bearing, travel);
  const direction = delta < 50 ? 'nel senso di marcia' : delta > 130 ? 'in senso opposto' : 'di lato';
  return `${Math.round(bearing) % 360}° da nord · ${direction}`;
}

/** A road capture is only useful close to a 100 m station. A landmark photograph belongs
 * to its single closest station; the distance displayed is explicitly to camera or subject. */
export function matchSurveyPhotos(atlas: PhotoAtlas, stations: PhotoStation[]): StationPhotos[] {
  const result: StationPhotos[] = stations.map(({distance}, station) => ({station, distance, matches: []}));
  for (const photo of atlas.places) {
    let closest = -1, off = Infinity;
    stations.forEach((p, i) => {
      const meters = haversine(photo, p);
      if (meters < off) { closest = i; off = meters; }
    });
    const radius = photo.radiusM ?? 120;
    if (closest >= 0 && off <= radius) result[closest].matches.push({photo, off, subjectOff: photo.subject && haversine(photo.subject, stations[closest])});
  }

  // 0.001° cells are wider than our search radius at both worlds' latitudes.
  const frames = new Map<string, RoadFrame[]>();
  for (const frame of atlas.frames) {
    const key = `${Math.floor(frame.lat * 1000)},${Math.floor(frame.lon * 1000)}`;
    const bucket = frames.get(key);
    if (bucket) bucket.push(frame);
    else frames.set(key, [frame]);
  }
  stations.forEach((station, i) => {
    const lat = Math.floor(station.lat * 1000), lon = Math.floor(station.lon * 1000);
    let best: RoadFrame | undefined, bestDist = 0, bestScore = Infinity;
    for (let y = lat - 1; y <= lat + 1; y++) {
      for (let x = lon - 1; x <= lon + 1; x++) {
        for (const frame of frames.get(`${y},${x}`) ?? []) {
          const distance = haversine(frame, station);
          if (distance > 35) continue;
          const delta = frame.bearing == null ? 100 : angleDifference(frame.bearing, station.bearing);
          const score = distance + delta * 0.02 + (delta < 50 ? 0 : 50);
          if (score < bestScore) { best = frame; bestScore = score; bestDist = distance; }
        }
      }
    }
    result[i].matches.sort((a, b) => a.off - b.off);
    if (best) result[i].matches.unshift({photo: roadPhoto(best), off: bestDist});
  });
  return result;
}

export function nearestPhotoStation(stations: StationPhotos[], index: number): StationPhotos | undefined {
  let nearest: StationPhotos | undefined;
  for (const station of stations) {
    if (station.matches.length && (!nearest || Math.abs(station.distance - stations[index].distance) < Math.abs(nearest.distance - stations[index].distance))) nearest = station;
  }
  return nearest;
}
