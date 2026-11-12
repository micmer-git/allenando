import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILT_SURFACE, LandSurvey } from '../src/open/suoloGanda';
import { COVER } from '../src/open/world';

describe('uso del suolo DBGT di Ganda', () => {
  const file = new Uint8Array(readFileSync('public/world/bergamo/suolo-ganda-v1.bin'));
  const land = LandSurvey.decode(file.buffer)!;

  it('legge punti controllati nei poligoni regionali anche con coordinate negative', () => {
    expect(land.at(-2247.5,8197.5)).toBe(COVER.forest);
    expect(land.at(-912.5,8167.5)).toBe(COVER.farmland);
    expect(land.at(2547.5,8197.5)).toBe(COVER.park);
    expect(land.at(2287.5,7272.5)).toBe(COVER.water);
    expect(land.at(-942.5,8242.5)).toBe(BUILT_SURFACE);
  });

  it('fuori dai rilievi mantiene il terreno di base e rifiuta un download parziale', () => {
    expect(land.at(0,0)).toBe(0);
    expect(land.at(-2947.5,6307.5)).toBe(0);
    expect(LandSurvey.decode(file.buffer.slice(0,-1))).toBeNull();
  });
});
