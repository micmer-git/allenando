import { describe, expect, it } from 'vitest';
import type { Prop } from '@/world/builders';
import { createPropWindow } from '@/world/propWindow';

const prop = (x: number, z: number, kind: Prop['kind'] = 'spruce'): Prop => ({ kind, x, z, y: 2, s: 1.2, r: .7, tint: .4 });

describe('finestra della vegetazione sulle salite', () => {
  it('esclude il resto del percorso e aggiorna dopo un teletrasporto', () => {
    const near = prop(30, 0), far = prop(250, 0), boundary = prop(110, 0, 'rock');
    const window = createPropWindow([near, far, boundary]);
    window.update(0, 0);
    expect(window.groups.spruce).toEqual([near]);
    expect(window.groups.rock).toEqual([boundary]);
    expect(window.groups.trunk).toEqual([near]);
    window.update(260, 0);
    expect(window.groups.spruce).toEqual([far]);
    expect(window.groups.trunk).toEqual([far]);
    expect(window.groups.rock).toHaveLength(0);
  });

  it('rispetta il budget totale includendo i tronchi e preferisce i più vicini', () => {
    const items = Array.from({ length: 1000 }, (_, i) => prop(i / 20, 0, i % 3 === 0 ? 'rock' : 'broadleaf'));
    const window = createPropWindow(items, 110, 800);
    window.update(0, 0);
    const drawn = Object.values(window.groups).reduce((n, group) => n + group.length, 0);
    expect(drawn).toBe(800);
    expect(window.groups.trunk).toEqual(window.groups.broadleaf);
    expect(window.groups.broadleaf).toContain(items[1]);
    expect(window.groups.broadleaf).not.toContain(items[998]);
    for (const [kind, selected] of Object.entries(window.groups)) {
      expect(selected.length).toBeLessThanOrEqual(window.capacity[kind as keyof typeof window.capacity]);
    }
  });

  it('riusa selezione e revisione finché la camera resta nella stessa cella', () => {
    const item = prop(20, 0);
    const window = createPropWindow([item]);
    expect(window.update(1, 1)).toBe(true);
    const snapshot = window.groups, revision = window.revision;
    expect(window.update(15, 15)).toBe(false);
    expect(window.groups).toBe(snapshot);
    expect(window.revision).toBe(revision);
    expect(window.update(16, 15)).toBe(true);
    expect(window.groups).not.toBe(snapshot);
    expect(window.groups.spruce[0]).toBe(item);
    expect(window.groups.spruce[0]).toMatchObject({ s: 1.2, r: .7, tint: .4 });
  });
});
