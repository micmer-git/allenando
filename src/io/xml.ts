import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) =>
    ['trk', 'trkseg', 'trkpt', 'rte', 'rtept', 'Activity', 'Lap', 'Track', 'Trackpoint', 'Course'].includes(name),
});

export function parseXml(text: string): unknown {
  return parser.parse(text.replace(/^\uFEFF/, ''));
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function textOf(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string') return node.trim() || undefined;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'object' && node && '#text' in node) {
    return textOf((node as { '#text': unknown })['#text']);
  }
  return undefined;
}

export function numberOf(node: unknown): number | undefined {
  const text = textOf(node);
  if (text == null) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function child(node: unknown, key: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  return (node as Record<string, unknown>)[key];
}

/** Cerca un numero fra le chiavi indicate, anche annidato (estensioni GPX/TCX). */
export function findNumber(node: unknown, keys: string[], depth = 0): number | undefined {
  if (!node || typeof node !== 'object' || depth > 6) return undefined;
  const obj = node as Record<string, unknown>;
  for (const key of keys) {
    if (key in obj) {
      const n = numberOf(obj[key]);
      if (n != null) return n;
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = findNumber(value, keys, depth + 1);
      if (found != null) return found;
    }
  }
  return undefined;
}

export function decodeXml(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data);
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
