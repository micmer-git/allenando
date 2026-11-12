// I tipi di utm.mjs.
export function toUtm(lat: number, lon: number, lon0?: number): [number, number];
export function fromUtm(E: number, N: number, lon0?: number): { lat: number; lon: number };
