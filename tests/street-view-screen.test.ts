// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { StreetViewRide } from '@/pages/StreetViewRide';
import { StreetRide } from '@/ride/streetNavigation';

const api = vi.hoisted(() => ({
  instances: 0, display: vi.fn(), lookup: vi.fn(), locate: vi.fn(),
}));
vi.mock('@/ride/streetGoogle', () => ({
  GAZZANIGA: { lat: 45.8, lng: 9.8 }, lookup: api.lookup, locate: api.locate,
  loadStreet: async () => ({
    StreetViewService: class {},
    StreetViewPanorama: class {
      constructor() { api.instances++; }
      setPano = api.display;
      setPov() {}
      setVisible() {}
    },
  }),
  importLibrary: async () => ({ Map: class { addListener() { return { remove() {} }; } } }),
}));

it('usa lo stesso visore durante il Jump e scarta una ricerca chiusa mentre Google risponde', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('google', { maps: { StreetViewPreference: { NEAREST: 'nearest' }, StreetViewSource: { OUTDOOR: 'outdoor' } } });
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test');
  const gaz = { id: 'ganda', lat: 45.8, lon: 9.8, links: [{ id: 'selvino', heading: 5 }] };
  const tokyo = { id: 'tokyo', lat: 35, lon: 139, links: [{ id: 'east', heading: 90 }] };
  api.lookup.mockImplementation(async (_service, req) => {
    if (req.pano) return { ...gaz, id: req.pano, lat: gaz.lat + 0.0001, links: [] };
    return req.location.lat === 45.8 ? gaz : tokyo;
  });
  const ride = new StreetRide();
  const ready = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const draw = async (odometer: number) => act(async () => {
    root.render(createElement(MemoryRouter, {}, createElement(StreetViewRide, { ride, odometer, onReady: ready })));
  });
  const press = async (text: string) => act(async () => {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === text);
    expect(button).toBeDefined();
    button!.click();
  });
  const search = async () => {
    await press('Jump');
    await act(async () => {
      const input = host.querySelector('input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Tokyo');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press('Vai');
  };
  try {
    await draw(1500);
    await draw(1512);
    expect(api.display.mock.calls.flat()).toEqual(['ganda', 'selvino']);
    let resolve!: (point: { lat: number; lng: number }) => void;
    api.locate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await search();
    await press('Chiudi');
    await act(async () => resolve({ lat: 35, lng: 139 }));
    expect(ride.current?.id).toBe('selvino');
    api.locate.mockResolvedValue({ lat: 35, lng: 139 });
    await search();
    await draw(1512);
    expect(ride.current?.id).toBe('tokyo');
    expect(api.instances).toBe(1);
    expect(host.querySelector('[role=dialog]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
