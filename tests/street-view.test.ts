import { expect, it } from 'vitest';
import { StreetRide, type Panorama } from '@/ride/streetNavigation';
import { intentoDaSearch, intentoInSearch } from '@/ride/intento';

const road = (id: string, lat: number, links: Panorama['links']): Panorama => ({ id, lat, lon: 9, links });
const a = road('a', 45, [{ id: 'b', heading: 2 }, { id: 'c', heading: 85 }]);
const b = road('b', 45.0001, [{ id: 'a', heading: 182 }, { id: 'c', heading: 12 }]);

it('avanza con i metri pedalati, conserva il resto e non torna automaticamente indietro', () => {
  const ride = new StreetRide();
  ride.jump(a, 4000, 359);
  expect(ride.exits[0].id).toBe('b');
  expect(ride.advance(b, 4010)).toBe(false);
  expect(ride.advance(b, 4014)).toBe(true);
  expect(ride.exits.map(x => x.id)).toEqual(['c']);
  expect(ride.advance(a, 5000)).toBe(false);
  expect(ride.advance(road('c', 45.0002, []), 4023)).toBe(true);
});

it('Jump riparte dal contachilometri attuale e un punto isolato conserva la strada', () => {
  const ride = new StreetRide();
  ride.jump(a, 0, 0);
  const tokyo = { ...a, id: 'tokyo', lat: 35, lon: 139 };
  expect(ride.jump(tokyo, 7500, 0)).toBe(true);
  expect(ride.jump(road('isolated', 12, []), 7600, 0)).toBe(false);
  expect(ride.current).toBe(tokyo);
  expect(ride.advance({ ...tokyo, id: 'b', lat: 35.0001 }, 7500)).toBe(false);
});

it('conserva Street View nel link per riprendere il giro', () => {
  const search = new URLSearchParams('street=1&manuale=1&watt=160');
  const intent = intentoDaSearch(search);
  expect(intent?.dove).toEqual({ kind: 'street' });
  expect(intentoDaSearch(new URLSearchParams(intentoInSearch(intent!)))).toEqual(intent);
});
