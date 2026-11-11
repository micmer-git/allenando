import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cap, formatHours, formatKmText, formatMetersText, formatTss, NBSP, withUnit } from '../src/domain/format';
import { sessionAt, SLOT_MS } from '../src/game/sessions';
import { kindAndKm } from '../src/pages/Leaderboards';
import { countdown, sessionClock } from '../src/pages/Sessions';
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

describe('numero e unità non si separano', () => {
  it('i formattatori mettono lo spazio non separabile (U+00A0)', () => {
    expect(NBSP).toBe('\u00a0');
    expect(formatKmText(4830)).toBe('4,83\u00a0km');
    expect(formatMetersText(1288)).toBe('1288\u00a0m');
    expect(withUnit('2,9', 'W/kg')).toBe('2,9\u00a0W/kg');
    expect(formatHours(65 * 60)).toBe('1\u00a0h\u00a005');
    expect(formatHours(40 * 60)).toBe('40\u00a0min');
    expect(countdown(39 * 60_000)).toBe('39\u00a0min');
    for (const t of [formatKmText(12_345), formatMetersText(945), formatHours(7200), countdown(2 * 3600_000)]) expect(t).not.toMatch(/ /);
  });
  it('il tipo del tratto si scrive solo se il nome non lo dice già', () => {
    expect(kindAndKm('Volata del cassonetto', 'Volata del cassonetto', 250)).toBe('0,25\u00a0km');
    expect(kindAndKm('Ponte di Albino', 'Volata', 400)).toBe('Volata · 0,40\u00a0km');
  });
});

describe('il conto alla rovescia della sessione ha la sua parola', () => {
  const s = sessionAt(1000);
  it('prima dell\'apertura, aperta, dopo il via', () => {
    expect(sessionClock(s, s.start - 39 * 60_000).text).toBe('Fra 39\u00a0min');
    expect(sessionClock(s, s.start - (6 * 60 + 7) * 1000).text).toBe('Via fra 6:07');
    expect(sessionClock(s, s.start + 2 * 60_000 + 5000).text).toBe('Partita da 2\u00a0min');
    expect(sessionClock(s, s.start + 20_000).text).toBe('Partita da 1\u00a0min');
    expect(s.start % SLOT_MS).toBe(0);
  });
  it('mai un numero da solo', () => {
    for (let t = -40 * 60_000; t <= 5 * 60_000; t += 37_000) expect(sessionClock(s, s.start + t).text).toMatch(/^(Fra|Via fra|Partita da) \S/);
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

describe('piano U: niente «Simulatore» a schermo', () => {
  it('il dizionario non dice «simulatore»: la prova si chiama Prova (A3)', () => {
    const fuori: string[] = [];
    const visit = (o: unknown, path: string) => {
      if (typeof o === 'string') {
        if (/simulator[ei]/i.test(o)) fuori.push(`${path}: ${o}`);
      } else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) visit(v, path ? `${path}.${k}` : k);
    };
    visit(dizionario, '');
    expect(fuori).toEqual([]);
  });
  it('nessuna pagina e nessun componente scrive «Simulatore» in un testo', () => {
    const dirs = [PAGINE, join(PAGINE, 'pedala'), join(__dirname, '..', 'src', 'components'), join(__dirname, '..', 'src', 'components', 'ride')];
    const fuori: string[] = [];
    for (const d of dirs)
      for (const f of readdirSync(d).filter((x) => x.endsWith('.tsx'))) {
        // i testi a schermo: fra > e <, o nelle stringhe JSX; i commenti no
        const src = readFileSync(join(d, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        if (/>[^<{]*\bSimulator[ei]\b|['"`]Simulator[ei]\b/.test(src)) fuori.push(f);
      }
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
