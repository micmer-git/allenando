import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchSurveyPhotos, nearestPhotoStation, viewDirection, type PhotoAtlas, type RoadFrame, type SurveyPhoto } from '@/open/fotoSopralluogo';

const station = {lat: 46.5, lon: 11.8, bearing: 5, distance: 0};
const frame: RoadFrame = {...station, id: '1', seq: '2', idx: 3, bearing: null, date: '2023-01-01', author: 'A', url: 'https://cdn.kartaview.org/example.jpg'};

describe('Foto geolocalizzate del sopralluogo', () => {
  it('preferisce un fotogramma nel senso di marcia e scarta riprese oltre 35 m', () => {
    const frames = [{...frame, bearing: 185}, {...frame, id: '2', lon: 11.8001, bearing: 350}, {...frame, id: '3', lon: 11.81, bearing: 5}];
    const stations = [station, {...station, lat: 46.501, distance: 100}];
    const photos = matchSurveyPhotos({places: [], frames}, stations);
    expect(photos[0].matches.map(m => m.photo.id)).toEqual(['kv-2']);
    expect(photos[1].matches).toEqual([]);
    expect(nearestPhotoStation(photos, 1)?.station).toBe(0);
    expect(viewDirection(350, 5)).toContain('nel senso di marcia');
    expect(viewDirection(185, 5)).toContain('in senso opposto');
    expect(viewDirection(undefined, 5)).toContain('sconosciuto');
  });

  it('conserva la posizione del soggetto e assegna la foto alla sola stazione più vicina', () => {
    const landmark: SurveyPhoto = {...station, id:'m', title:'Chiesa', author:'A', license:'CC BY-SA 3.0', licenseUrl:'', source:'', image:'m.webp', position:'subject', lat:46.5008, bearing:undefined};
    const stations = [station, {...station, lat: 46.5009, distance: 100}];
    const result = matchSurveyPhotos({places:[landmark],frames:[]}, stations);
    expect(result[0].matches).toEqual([]);
    expect(result[1].matches[0].photo.position).toBe('subject');
    expect(result[1].matches[0].off).toBeCloseTo(11.12, 1);
  });

  for (const world of ['bergamo', 'sellaronda']) {
    it(`verifica sorgenti, date e file distribuiti per ${world}`, () => {
      const base = join('public/world', world, 'foto');
      const atlas = JSON.parse(readFileSync(join(base, 'atlante-v1.json'), 'utf8')) as PhotoAtlas;
      const assets: string[] = [];
      expect(atlas.places.length).toBeGreaterThan(0);
      expect(atlas.frames.length).toBeGreaterThan(0);
      for (const photo of atlas.places) {
        expect(photo.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
        expect(photo.licenseUrl).toMatch(/^https:\/\/creativecommons\.org\/licenses\//);
        expect(photo.author.trim().length).toBeGreaterThan(0);
        expect(photo.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (photo.position === 'subject') expect(photo.positionSource).toContain('openstreetmap.org/');
        assets.push(photo.image);
      }
      for (const frame of atlas.frames) {
        expect(frame.url).toMatch(/^https:\/\/cdn\.kartaview\.org\//);
        expect(frame.author.trim().length).toBeGreaterThan(0);
        expect(frame.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (frame.local) assets.push(frame.local);
      }
      for (const asset of assets) expect(readFileSync(join(base, asset)).toString('ascii', 8, 12)).toBe('WEBP');
    });
  }
});
