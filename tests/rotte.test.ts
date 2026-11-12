import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redirectFor, sezioneDi } from '../src/lib/redirect';

/*
 * Piano U, § 2.6: le 21 rotte di prima del riordino. Ognuna resta, o porta dove la cosa sta adesso.
 * Nessuna finisce su una pagina bianca: una destinazione è sempre una rotta che App.tsx conosce.
 */

const VECCHIE: [string, string | null][] = [
  ['/start', null],
  ['/', null],
  ['/ride?world=bergamo&ride=ganda', null],
  ['/workouts', null],
  ['/workouts/edit/abc', null],
  ['/history', null],
  ['/history/abc', null],
  ['/load', null],
  ['/import', null],
  ['/mondo', '/?dove=1'],
  ['/salite', '/?dove=salite'],
  ['/salite/selvino-nembro', null],
  ['/giri', '/history'],
  ['/giri/abc', '/?dove=giro&replay=abc'],
  ['/profile', '/impostazioni'],
  ['/garage', null],
  ['/traguardi', null],
  ['/classifiche', null],
  ['/sessioni', null],
  ['/tu', null],
  ['/programmi', null],
];

const split = (url: string): [string, string] => {
  const i = url.indexOf('?');
  return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i)];
};

describe('le rotte vecchie (§ 2.6)', () => {
  it('sono 21, e ognuna resta o porta alla sua destinazione', () => {
    expect(VECCHIE).toHaveLength(21);
    for (const [url, to] of VECCHIE) expect(redirectFor(...split(url)), url).toBe(to);
  });

  it('il Mondo con le sue schede: Pedala col foglio Dove, sullo strumento giusto', () => {
    expect(redirectFor('/mondo', '?world=sellaronda')).toBe('/?dove=1&world=sellaronda');
    expect(redirectFor('/mondo', '?tab=libero')).toBe('/?dove=libero');
    expect(redirectFor('/mondo', '?world=bergamo&tab=anello')).toBe('/?dove=anello&world=bergamo');
    expect(redirectFor('/mondo', '?tab=ab')).toBe('/?dove=ab');
    expect(redirectFor('/mondo', '?tab=percorsi')).toBe('/?dove=1');
    expect(redirectFor('/mondo', '?tab=classifiche')).toBe('/classifiche');
    expect(redirectFor('/mondo/', '')).toBe('/?dove=1');
  });

  it('il link di un percorso del Mondo sceglie quel percorso', () => {
    expect(redirectFor('/mondo', '?world=bergamo&ride=ganda')).toBe('/?dove=percorso&world=bergamo&ride=ganda');
  });

  it('un id di giro con caratteri strani resta intero', () => {
    expect(redirectFor('/giri/intervals%3Ai123', '')).toBe('/?dove=giro&replay=intervals%3Ai123');
  });

  it('ogni destinazione è una rotta che App.tsx conosce', () => {
    const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
    for (const [url, to] of VECCHIE) {
      if (!to) continue;
      const path = split(to)[0];
      expect(app.includes(`path="${path}"`), `${url} → ${path}`).toBe(true);
    }
  });
});

describe('la voce accesa della barra', () => {
  it('tre sezioni: Pedala, Diario, Tu', () => {
    expect(sezioneDi('/')).toBe('pedala');
    expect(sezioneDi('/sessioni')).toBe('pedala');
    expect(sezioneDi('/salite/selvino-nembro')).toBe('pedala');
    expect(sezioneDi('/history')).toBe('diario');
    expect(sezioneDi('/history/abc')).toBe('diario');
    expect(sezioneDi('/load')).toBe('diario');
    expect(sezioneDi('/import')).toBe('diario');
    for (const p of ['/tu', '/garage', '/traguardi', '/classifiche', '/workouts', '/workouts/edit/x', '/programmi', '/impostazioni']) expect(sezioneDi(p), p).toBe('tu');
    expect(sezioneDi('/ride')).toBeNull();
  });
});
