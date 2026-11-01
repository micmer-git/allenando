import { unzipSync } from 'fflate';
import type { Ride } from '@/domain/types';
import { decodeFitActivity } from './fit';
import { decodeGpx } from './gpx';
import { decodeTcx } from './tcx';

export interface ImportContext {
  ftp: number;
  lthr: number;
}

export interface ParsedUpload {
  rides: Ride[];
  errors: { file: string; message: string }[];
}

const EXT = /\.(fit|tcx|gpx)$/i;

/** Punto di ingresso per file locali e, in futuro, per un connettore API. */
export function parseUpload(name: string, data: Uint8Array, ctx: ImportContext): ParsedUpload {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return parseZip(name, data, ctx);
  return parseOne(name, data, ctx);
}

export function parseZip(name: string, data: Uint8Array, ctx: ImportContext): ParsedUpload {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    return { rides: [], errors: [{ file: name, message: 'zip' }] };
  }
  const rides: Ride[] = [];
  const errors: { file: string; message: string }[] = [];
  const names = Object.keys(entries).filter((entry) => EXT.test(entry) && !entry.endsWith('/'));
  if (names.length === 0) {
    return { rides: [], errors: [{ file: name, message: 'empty-zip' }] };
  }
  for (const entry of names) {
    const base = entry.split('/').filter(Boolean).pop() ?? entry;
    const part = parseOne(base, entries[entry], ctx);
    rides.push(...part.rides);
    errors.push(...part.errors.map((err) => ({ ...err, file: `${name}/${base}` })));
  }
  return { rides, errors };
}

export function parseOne(name: string, data: Uint8Array, ctx: ImportContext): ParsedUpload {
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith('.fit')) {
      const ride = decodeFitActivity(data, { ...ctx, name: prettyName(name) });
      if (!ride) return { rides: [], errors: [{ file: name, message: 'fit' }] };
      ride.id = activityId(ride);
      if (!ride.name || ride.name === 'Attività FIT') ride.name = prettyName(name);
      return { rides: [ride], errors: [] };
    }
    if (lower.endsWith('.gpx')) {
      const rides = decodeGpx(data, { ...ctx, name: prettyName(name) }).map(tag);
      if (rides.length === 0) return { rides: [], errors: [{ file: name, message: 'gpx' }] };
      return { rides, errors: [] };
    }
    if (lower.endsWith('.tcx')) {
      const rides = decodeTcx(data, { ...ctx, name: prettyName(name) }).map(tag);
      if (rides.length === 0) return { rides: [], errors: [{ file: name, message: 'tcx' }] };
      return { rides, errors: [] };
    }
  } catch {
    return { rides: [], errors: [{ file: name, message: 'parse' }] };
  }
  return { rides: [], errors: [{ file: name, message: 'type' }] };
}

function tag(ride: Ride): Ride {
  ride.id = activityId(ride);
  return ride;
}

export function prettyName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  return base
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function activityId(ride: Pick<Ride, 'startTime' | 'name' | 'distanceM' | 'fileType'>): string {
  const raw = `${ride.startTime}|${ride.name}|${Math.round(ride.distanceM)}|${ride.fileType ?? ''}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `imp-${(h >>> 0).toString(16)}`;
}
