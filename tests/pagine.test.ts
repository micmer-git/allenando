import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cap, formatTss } from '../src/domain/format';
import { it as dizionario } from '../src/i18n/it';

const PAGINE = join(__dirname, '..', 'src', 'pages');
/** I file della pista 1: tutte le pagine tranne quelle della corsa. */
const MIE = readdirSync(PAGINE).filter((f) => f.endsWith('.tsx') && !['Ride.tsx', 'WorldHud.tsx', 'RideGameHud.tsx', 'RideRoom.tsx'].includes(f));

describe('il TSS ha un formattatore solo', () => {
  it('sotto 10 con un decimale: un giro di un minuto fa 0,3, non 0', () => {
    expect(formatTss(0.3)).toBe('0,3');
    expect(formatTss(0.04)).toBe('0,0');
    expect(formatTss(9.94)).toBe('9,9');
  });
  it('da 10 in su intero, senza valore il trattino', () => {
    expect(formatTss(31.4)).toBe('31');
    expect(formatTss(145.6)).toBe('146');
    expect(formatTss(null)).toBe('–');
    expect(formatTss(undefined)).toBe('–');
    expect(formatTss(Number.NaN)).toBe('–');
  });
  it('lo stesso giro scritto nel riepilogo e nel dettaglio dà la stessa stringa', () => {
    for (const tss of [0, 0.3, 4.96, 9.99, 10, 57.5, 212.4]) expect(formatTss(tss)).toBe(formatTss(Number(String(tss))));
  });
  it('nessuna pagina della pista 1 scrive il TSS con formatNumber', () => {
    const fuori = MIE.filter((f) => /formatNumber\([^)]*\btss\b/i.test(readFileSync(join(PAGINE, f), 'utf8')));
    expect(fuori).toEqual([]);
  });
});

describe('la maiuscola iniziale', () => {
  it('sui testi che arrivano dai dati', () => {
    expect(cap('da Nembro')).toBe('Da Nembro');
    expect(cap('dalla stazione al castello')).toBe('Dalla stazione al castello');
    expect(cap('èlite')).toBe('Èlite');
    expect(cap('Già maiuscolo')).toBe('Già maiuscolo');
    expect(cap('')).toBe('');
  });
  it('il dizionario italiano non ha frasi che cominciano in minuscolo (unità a parte)', () => {
    const fuori: string[] = [];
    const visit = (o: unknown, path: string) => {
      if (typeof o === 'string') {
        if (/^[a-zàèéìòù]/.test(o) && /\s/.test(o) && !/^(km|m |min|kg|bpm|rpm|h )/.test(o)) fuori.push(`${path}: ${o}`);
      } else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) visit(v, path ? `${path}.${k}` : k);
    };
    // gli errori d'importazione si leggono dopo «nome del file:», a metà frase
    visit({ ...dizionario, import: { ...dizionario.import, err: {} } }, '');
    expect(fuori).toEqual([]);
  });
});

describe('le pagine della pista 1', () => {
  it('niente barretta colorata sul lato delle carte', () => {
    const fuori = MIE.filter((f) => /absolute inset-y-0 left-0 w-1/.test(readFileSync(join(PAGINE, f), 'utf8')));
    expect(fuori).toEqual([]);
  });
  it('nessun «XP» nei testi', () => {
    const fuori = MIE.filter((f) => /[>`'"][^<`'"]*\bXP\b/.test(readFileSync(join(PAGINE, f), 'utf8')));
    expect(fuori).toEqual([]);
  });
  it('i ritorni sono BackLink alti 44 px, non link di testo da 18', () => {
    const fuori = MIE.filter((f) => /className="text-sm font-semibold text-muted"[^>]*>\s*(←|\{t\('actions\.back'\)\}|\{t\('import\.back'\)\})/.test(readFileSync(join(PAGINE, f), 'utf8')));
    expect(fuori).toEqual([]);
  });
});
