import type { RideFacts } from './career';

/**
 * Tre missioni al giorno, le stesse per tutti in quel giorno (dipendono solo dalla data).
 * Si completano in un giro solo: sono piccole apposta, per dare un motivo a uscire oggi.
 */

export interface Mission {
  id: string;
  title: string;
  oro: number;
  check: (f: RideFacts) => boolean;
}

const POOL: Mission[] = [
  { id: 'km-10', title: 'Pedala 10 km', oro: 40, check: (f) => f.distanceM >= 10_000 },
  { id: 'km-25', title: 'Pedala 25 km', oro: 80, check: (f) => f.distanceM >= 25_000 },
  { id: 'min-30', title: 'Mezz’ora in sella', oro: 40, check: (f) => f.durationSec >= 1800 },
  { id: 'min-60', title: 'Un’ora in sella', oro: 70, check: (f) => f.durationSec >= 3600 },
  { id: 'su-200', title: 'Sali 200 metri', oro: 50, check: (f) => f.gainM >= 200 },
  { id: 'su-500', title: 'Sali 500 metri', oro: 90, check: (f) => f.gainM >= 500 },
  { id: 'volata', title: 'Tira una volata', oro: 50, check: (f) => f.segments.some((s) => s.kind === 'volata' || s.kind === 'cassonetto') },
  { id: 'gpm', title: 'Prendi un GPM', oro: 60, check: (f) => f.segments.some((s) => s.kind === 'gpm') },
  { id: 'crono', title: 'Fai una crono', oro: 70, check: (f) => f.segments.some((s) => s.kind === 'crono') },
  { id: 'tre-tratti', title: 'Tre tratti cronometrati', oro: 80, check: (f) => f.segments.length >= 3 },
  { id: 'punti', title: 'Passa da 3 punti caldi', oro: 50, check: (f) => f.pois.length >= 3 },
  { id: 'luoghi', title: 'Passa da 4 luoghi del mondo', oro: 50, check: (f) => new Set(f.landmarks).size >= 4 },
  { id: 'sessione', title: 'Finisci una sessione', oro: 80, check: (f) => !!f.session?.finished },
  { id: 'soglia', title: '5 minuti alla FTP', oro: 70, check: (f) => f.ftp > 0 && f.peak5min >= f.ftp },
  { id: 'scatto', title: 'Uno scatto oltre 1,5 volte la FTP', oro: 40, check: (f) => f.ftp > 0 && f.peak5s >= 1.5 * f.ftp },
  { id: 'percorso', title: 'Finisci un percorso del mondo', oro: 80, check: (f) => !!f.worldRideDone },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Le tre missioni del giorno `day` (AAAA-MM-GG): tre diverse, mai due dello stesso tipo. */
export function missionsFor(day: string): Mission[] {
  const out: Mission[] = [];
  const used = new Set<string>();
  let h = hash(day);
  for (let guard = 0; out.length < 3 && guard < 50; guard++) {
    const m = POOL[h % POOL.length];
    const family = m.id.split('-')[0];
    if (!used.has(family)) {
      used.add(family);
      out.push(m);
    }
    h = hash(`${day}:${h}`);
  }
  return out;
}
