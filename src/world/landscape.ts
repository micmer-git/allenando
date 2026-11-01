import type { Track } from '@/domain/track';

/** Full terrain square enclosing the route + space for nearby scenery. */
export function terrainSizeForTrack(track: Pick<Track, 'points'>, margin = 400): number {
  let extent = 0;
  for (const p of track.points) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.z));
  return Math.ceil((extent + margin) / 100) * 200;
}
