// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoveContenuto, useMondo } from '../src/pages/pedala/Dove';
import { isWorldId } from '../src/open/worlds';

/*
 * Pista S1.5, poi piano U (F3): la scelta del mondo sta in testa a Dove, dentro Pedala. Si rende in
 * jsdom lo stato di caricamento (i dati non arrivano: fetch resta sospesa), con la scelta del mondo.
 */

function Harness({ world }: { world: string }) {
  const id = isWorldId(world) ? world : 'bergamo';
  const mondo = useMondo(id, true);
  return createElement(DoveContenuto, { mondo, setWorld: () => undefined, strumento: 'lista', setStrumento: () => undefined, filtro: 'tutti', setFiltro: () => undefined, onScegli: () => undefined, scelto: null });
}

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  // i dati del mondo non arrivano mai: resta il velo di caricamento, con la scelta del mondo
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

async function render(path: string): Promise<HTMLDivElement> {
  root = createRoot(host!);
  const world = new URLSearchParams(path.split('?')[1] ?? '').get('world') ?? 'bergamo';
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Harness, { world })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150));
  });
  return host!;
}

describe('Dove con due mondi', () => {
  it('in testa la scelta del mondo: «Bergamo e le valli» e «Sellaronda», Bergamo per primo', async () => {
    const el = await render('/?dove=1');
    expect(el.querySelector('[data-testid=dove-mondo]')?.textContent).toContain('Bergamo e le valli');
    await act(async () => (el.querySelector('[data-testid=dove-mondo]') as HTMLButtonElement).click());
    const pick = el.querySelector('[data-testid=world-chooser]');
    expect(pick).not.toBeNull();
    expect(pick!.textContent).toContain('Bergamo e le valli');
    expect(pick!.textContent).toContain('Sellaronda');
    expect(el.textContent).toContain('Bergamo e le valli');
    expect(el.textContent).not.toMatch(/Carico le strade: Sellaronda/i);
  });

  it('con ?world=sellaronda Dove è quello del Sellaronda, e carica i suoi dati', async () => {
    const el = await render('/?dove=1&world=sellaronda');
    expect(el.querySelector('[data-testid=dove-mondo]')?.textContent).toContain('Sellaronda');
    await act(async () => (el.querySelector('[data-testid=dove-mondo]') as HTMLButtonElement).click());
    expect(el.querySelector('[data-testid=world-tagline]')?.textContent).toMatch(/^[A-ZÀ-Ý]/);
    const fetched = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(fetched.some((u) => u.includes('/world/sellaronda/graph.json'))).toBe(true);
    expect(fetched.some((u) => u.includes('/world/bergamo/'))).toBe(false);
  });

  it('un mondo sconosciuto nell’indirizzo non rompe niente: si apre Bergamo', async () => {
    const el = await render('/?dove=1&world=stelvio');
    expect(el.textContent).toContain('Bergamo e le valli');
    expect(el.querySelector('[data-testid=dove-mondo]')?.textContent).not.toContain('Sellaronda');
    // il caricamento è quello di Bergamo (la cache di loadWorld lo ha già chiesto nella prima prova: nessuna seconda fetch)
    expect(el.querySelector('[data-testid=dove-carica]')?.textContent).toMatch(/Carico Bergamo e le valli/);
    const fetched = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(fetched.some((u) => u.includes('/world/stelvio/'))).toBe(false);
  });
});
