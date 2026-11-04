import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kindLabel, LABEL_FULL, LABEL_GONE, labelFade, landmarkSub, occluded, placeLabels, type LabelCandidate, type Rect } from '../src/open/labels';
import { loadProgress, READY_RADIUS, tileDist } from '../src/open/pronto';

/*
 * Pista 3 (il mondo 3D): i nomi dei luoghi nel cielo, il pacchetto iniziale senza WebGL,
 * «pronto vuol dire pronto».
 */

describe('i nomi dei luoghi', () => {
  it('i tipi cominciano con la maiuscola, e sotto il nome nel 3D solo quando dicono qualcosa', () => {
    for (const k of ['citta', 'paese', 'chiesa', 'santuario', 'torre', 'porta', 'mura', 'ponte', 'fiume', 'cima', 'passo', 'lago', 'castello', 'luogo', 'funivia', 'stazione']) {
      expect(kindLabel(k)).toMatch(/^[A-ZÀ-Ý]/);
    }
    expect(kindLabel('citta')).toBe('Città');
    expect(kindLabel('sconosciuto')).toBe('Sconosciuto');
    expect(landmarkSub('paese')).toBe('');
    expect(landmarkSub('passo')).toBe('');
    expect(landmarkSub('citta')).toBe('');
    expect(landmarkSub('chiesa')).toBe('Chiesa');
    expect(landmarkSub('porta')).toBe('Porta delle Mura');
  });

  it('pieni fino a 1,5 km, poi sfumano', () => {
    expect(labelFade(200)).toBe(1);
    expect(labelFade(LABEL_FULL)).toBe(1);
    expect(labelFade((LABEL_FULL + LABEL_GONE) / 2)).toBeCloseTo(0.5, 5);
    expect(labelFade(LABEL_GONE)).toBe(0);
    expect(labelFade(9000)).toBe(0);
  });

  it('dietro una montagna un nome non si accende', () => {
    // un dosso alto 200 m a metà strada fra la camera e il paese
    const hill = (x: number) => (Math.abs(x - 1000) < 150 ? 300 : 100);
    expect(occluded((x) => hill(x), 0, 110, 0, 2000, 108, 0)).toBe(true);
    expect(occluded(() => 100, 0, 110, 0, 2000, 108, 0)).toBe(false);
    // il terreno sotto il nome stesso non lo nasconde
    expect(occluded((x) => (x > 1970 ? 140 : 100), 0, 110, 0, 2000, 108, 0)).toBe(false);
  });

  const cand = (key: string, rect: Rect, prio = 1, d = 500): LabelCandidate<string> => ({ key, rect, prio, d });
  const view = { width: 390, height: 577, top: 30 };

  it('mai tagliati dal bordo, mai nella fascia alta né sopra un pannello, al massimo tre', () => {
    const on = placeLabels(
      [
        cand('bordo-sinistro', [-20, 200, 80, 240]),
        cand('bordo-destro', [330, 200, 400, 240]),
        cand('in-alto', [100, 10, 200, 50]),
        cand('sul-pannello', [250, 100, 330, 140]),
        cand('a', [20, 300, 120, 340], 1, 300),
        cand('b', [140, 300, 240, 340], 1, 400),
        cand('c', [260, 300, 360, 340], 1, 500),
        cand('d', [20, 380, 120, 420], 1, 600),
      ],
      view,
      [[240, 90, 390, 150]],
    );
    expect([...on].sort()).toEqual(['a', 'b', 'c']);
  });

  it('prima i luoghi da riconoscere, poi i più vicini; chi copre un nome acceso resta spento', () => {
    const on = placeLabels([cand('paese', [100, 200, 200, 240], 1, 200), cand('chiesa', [150, 210, 250, 250], 0, 900), cand('cima', [20, 300, 100, 330], 2, 100)], view, []);
    expect(on.has('chiesa')).toBe(true);
    expect(on.has('paese')).toBe(false);
    expect(on.has('cima')).toBe(true);
  });
});

describe('pronto vuol dire pronto', () => {
  it('l’avanzamento arriva a 1 solo con tutte le mattonelle entro 400 m e il terreno lontano', () => {
    expect(READY_RADIUS).toBe(400);
    expect(loadProgress({ near: 0, nearReady: 0 }, false)).toBe(0);
    expect(loadProgress({ near: 6, nearReady: 6 }, false)).toBeLessThan(1);
    expect(loadProgress({ near: 6, nearReady: 5 }, true)).toBeLessThan(1);
    expect(loadProgress({ near: 6, nearReady: 6 }, true)).toBe(1);
    // cresce con le mattonelle
    expect(loadProgress({ near: 6, nearReady: 3 }, true)).toBeGreaterThan(loadProgress({ near: 6, nearReady: 2 }, true));
  });

  it('la distanza dal ciclista a una mattonella', () => {
    expect(tileDist({ ix: 0, iz: 0 }, 0, 0, 500, 250, 250)).toBe(0);
    expect(tileDist({ ix: 1, iz: 0 }, 0, 0, 500, 250, 250)).toBe(250);
    expect(tileDist({ ix: 1, iz: 1 }, 0, 0, 500, 400, 400)).toBeCloseTo(Math.hypot(100, 100), 6);
  });
});

describe('il pacchetto iniziale', () => {
  // gli import statici a partire da App.tsx: three.js e react-three-fiber solo dietro un import()
  const src = join(__dirname, '..', 'src');
  const resolveImport = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? join(src, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
    return null;
  };

  it('nessun modulo raggiunto senza import() porta three.js o la scena 3D', () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      // solo gli import di valori: `import type` sparisce dal pacchetto
      for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[1];
        if (spec === 'three' || spec.startsWith('three/') || spec.startsWith('@react-three/')) {
          bad.push(`${file.slice(src.length)} → ${spec}`);
          continue;
        }
        const next = resolveImport(file, spec);
        if (next) visit(next);
      }
    };
    visit(join(src, 'App.tsx'));
    expect(seen.size).toBeGreaterThan(30);
    expect(bad).toEqual([]);
  });
});
