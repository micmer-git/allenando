import type { Career, RideFacts } from './career';
import { WORLD_RIDES } from '@/multiplayer/world-rides';
import { BERGHEM_RIDES, MARMOLADA_RIDES, SELLARONDA_PASSES, SELLARONDA_RIDES } from './passes';
import { formatAltText } from '@/domain/format';

/** I percorsi del mondo, quanti sono oggi: li scrive build-world, la Ganda è il quattordicesimo. */
const ALL_RIDES = Object.keys(WORLD_RIDES).length;

/**
 * I traguardi. Ognuno ha una regola che si legge (desc), un controllo sui numeri della
 * carriera dopo il giro, l'oro che dà e, a volte, un pezzo del guardaroba. Quelli «a soglia»
 * dicono anche a che punto si è, così la pagina mostra la barra.
 */

export type Glyph = 'km' | 'salita' | 'volata' | 'gpm' | 'crono' | 'cassonetto' | 'gruppo' | 'luna' | 'pioggia' | 'alba' | 'fiamma' | 'stella' | 'mappa' | 'fulmine' | 'coppa' | 'goccia' | 'campana' | 'maglia' | 'ingranaggio';

export type AchievementGroup = 'strada' | 'salite' | 'traguardi' | 'mondo' | 'costanza' | 'motore';

export const GROUPS: { id: AchievementGroup; name: string }[] = [
  { id: 'strada', name: 'Strada' },
  { id: 'salite', name: 'Salite' },
  { id: 'traguardi', name: 'Volate, GPM, crono' },
  { id: 'mondo', name: 'Mondo' },
  { id: 'costanza', name: 'Costanza' },
  { id: 'motore', name: 'Motore' },
];

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  group: AchievementGroup;
  glyph: Glyph;
  oro: number;
  /** pezzi del guardaroba che si sbloccano */
  items?: string[];
  check: (c: Career, f: RideFacts) => boolean;
  /** a che punto si è: [adesso, obiettivo] */
  progress?: (c: Career) => [number, number];
  /** traguardo raro: cornice d'oro */
  rare?: boolean;
}

const climbs = (c: Career, ...ids: string[]) => ids.some((id) => (c.counts.climbs[id] ?? 0) > 0);

const km = (id: string, name: string, goal: number, oro: number, rare = false): Achievement => ({
  id,
  name,
  desc: `${goal.toLocaleString('it-IT')} km in tutto.`,
  group: 'strada',
  glyph: 'km',
  oro,
  rare,
  check: (c) => c.counts.km >= goal,
  progress: (c) => [Math.floor(c.counts.km), goal],
});

const gain = (id: string, name: string, goal: number, oro: number, rare = false): Achievement => ({
  id,
  name,
  desc: `${formatAltText(goal)} di dislivello in tutto.`,
  group: 'salite',
  glyph: 'salita',
  oro,
  rare,
  check: (c) => c.counts.gainM >= goal,
  progress: (c) => [Math.floor(c.counts.gainM), goal],
});

const worldRide = (c: Career, ids: readonly string[]) => ids.some((id) => (c.counts.worldRides[id] ?? 0) > 0);

/** I quattro passi del Sellaronda in un giro solo: i luoghi passati in QUESTO giro, non la somma di più uscite. */
export function fourPasses(landmarks: readonly string[]): boolean {
  const seen = new Set(landmarks);
  return SELLARONDA_PASSES.every((id) => seen.has(id));
}

const count = (id: string, name: string, desc: string, group: AchievementGroup, glyph: Glyph, key: 'volata' | 'gpm' | 'crono' | 'cassonetto' | 'sessions' | 'workouts' | 'rides' | 'pois', goal: number, oro: number, rare = false): Achievement => ({
  id,
  name,
  desc,
  group,
  glyph,
  oro,
  rare,
  check: (c) => c.counts[key] >= goal,
  progress: (c) => [Math.min(goal, c.counts[key]), goal],
});

export const ACHIEVEMENTS: Achievement[] = [
  // strada
  { id: 'primo-giro', name: 'Si parte', desc: 'Il primo giro.', group: 'strada', glyph: 'km', oro: 50, check: (c) => c.counts.rides >= 1 },
  km('km-50', 'Cinquanta', 50, 60),
  km('km-200', 'Duecento', 200, 120),
  km('km-1000', 'Mille', 1000, 400, true),
  km('km-giro', 'Giro d’Italia', 3500, 1200, true),
  { id: 'giro-lungo', name: 'Giro lungo', desc: '50 km in un giro solo.', group: 'strada', glyph: 'km', oro: 150, check: (_c, f) => f.distanceM >= 50_000 },
  { id: 'ore-2', name: 'Due ore in sella', desc: 'Un giro di almeno due ore.', group: 'strada', glyph: 'km', oro: 120, check: (_c, f) => f.durationSec >= 7200 },
  count('giri-10', 'Dieci uscite', '10 giri.', 'strada', 'km', 'rides', 10, 80),
  count('giri-50', 'Cinquanta uscite', '50 giri.', 'strada', 'km', 'rides', 50, 300, true),
  // salite
  gain('su-1000', 'Mille metri', 1000, 80),
  gain('su-everest', 'Everest', 8848, 600, true),
  gain('su-30000', 'Trentamila', 30000, 1500, true),
  { id: 'salita-selvino', name: 'Selvino', desc: 'In cima a Selvino da Nembro.', group: 'salite', glyph: 'salita', oro: 100, check: (c) => climbs(c, 'selvino-nembro') || (c.counts.worldRides['selvino'] ?? 0) > 0 },
  { id: 'salita-mortirolo', name: 'Mortirolo', desc: 'In cima al Mortirolo da Mazzo.', group: 'salite', glyph: 'salita', oro: 200, rare: true, check: (c) => climbs(c, 'mortirolo-mazzo') },
  { id: 'salita-stelvio', name: 'Stelvio', desc: 'In cima allo Stelvio, da Prato o da Bormio.', group: 'salite', glyph: 'salita', oro: 250, rare: true, check: (c) => climbs(c, 'stelvio-prato', 'stelvio-bormio') },
  {
    id: 'salite-tutte',
    name: 'Collezionista di passi',
    desc: 'Tutti e quattro i versanti verificati.',
    group: 'salite',
    glyph: 'coppa',
    oro: 600,
    rare: true,
    check: (c) => ['selvino-nembro', 'mortirolo-mazzo', 'stelvio-prato', 'stelvio-bormio'].every((id) => (c.counts.climbs[id] ?? 0) > 0),
    progress: (c) => [['selvino-nembro', 'mortirolo-mazzo', 'stelvio-prato', 'stelvio-bormio'].filter((id) => (c.counts.climbs[id] ?? 0) > 0).length, 4],
  },
  { id: 'su-1000-giro', name: 'Mille in un giro', desc: `${formatAltText(1000)} di dislivello in un giro solo.`, group: 'salite', glyph: 'salita', oro: 200, check: (_c, f) => f.gainM >= 1000 },
  // volate, GPM, crono
  count('volata-1', 'Prima volata', 'Una volata tirata fino alla riga.', 'traguardi', 'volata', 'volata', 1, 40),
  count('volata-5', 'Velocista', 'Cinque volate. Vale la maglia ciclamino.', 'traguardi', 'volata', 'volata', 5, 120),
  count('volata-25', 'Treno', 'Venticinque volate.', 'traguardi', 'volata', 'volata', 25, 400, true),
  count('gpm-1', 'Primo GPM', 'Un gran premio della montagna.', 'traguardi', 'gpm', 'gpm', 1, 50),
  count('gpm-5', 'Re della montagna', 'Cinque GPM. Vale la maglia azzurra.', 'traguardi', 'gpm', 'gpm', 5, 150),
  count('gpm-25', 'Scalatore puro', 'Venticinque GPM.', 'traguardi', 'gpm', 'gpm', 25, 500, true),
  count('crono-1', 'Contro il tempo', 'Una cronometro finita. Vale il casco da crono.', 'traguardi', 'crono', 'crono', 1, 60),
  count('crono-3', 'Cronoman', 'Tre cronometro. Vale la maglia oro crono.', 'traguardi', 'crono', 'crono', 3, 150),
  count('cassonetto-1', 'Porta a porta', 'La prima volata del cassonetto, fino ai bidoni.', 'traguardi', 'cassonetto', 'cassonetto', 1, 30),
  count('cassonetto-10', 'Re del cassonetto', 'Dieci volate del cassonetto. Vale la maglia Differenziata.', 'traguardi', 'cassonetto', 'cassonetto', 10, 200),
  { id: 'record-1', name: 'Più forte di prima', desc: 'Un record personale su un tratto già fatto.', group: 'traguardi', glyph: 'coppa', oro: 60, check: (c) => Object.values(c.pbs).some((p) => p.count >= 2) },
  // mondo
  { id: 'mondo-ganda', name: 'La Ganda', desc: 'Il giro della Ganda, tutto: Orezzo, il passo, Selvino.', group: 'mondo', glyph: 'salita', oro: 150, check: (c) => (c.counts.worldRides['ganda'] ?? 0) > 0 },
  { id: 'mondo-citta-alta', name: 'Dentro le Mura', desc: 'Il percorso Città Alta, tutto. Vale la maglia Città Alta.', group: 'mondo', glyph: 'mappa', oro: 100, check: (c) => (c.counts.worldRides['citta-alta'] ?? 0) > 0 },
  {
    id: 'mondo-5',
    name: 'Esploratore',
    desc: 'Cinque percorsi diversi del mondo.',
    group: 'mondo',
    glyph: 'mappa',
    oro: 250,
    check: (c) => Object.keys(c.counts.worldRides).length >= 5,
    progress: (c) => [Math.min(5, Object.keys(c.counts.worldRides).length), 5],
  },
  {
    id: 'mondo-tutti',
    name: 'Bergamo intera',
    desc: `Tutti i ${ALL_RIDES} percorsi del mondo.`,
    group: 'mondo',
    glyph: 'coppa',
    oro: 1000,
    rare: true,
    check: (c) => Object.keys(c.counts.worldRides).filter((id) => id in WORLD_RIDES).length >= ALL_RIDES,
    progress: (c) => [Math.min(ALL_RIDES, Object.keys(c.counts.worldRides).filter((id) => id in WORLD_RIDES).length), ALL_RIDES],
  },
  // il Sellaronda e le Dolomiti (i percorsi li costruisce la pista S1; gli id sono in passes.ts)
  { id: 'quattro-passi', name: 'I quattro passi', desc: 'Sella, Pordoi, Gardena e Campolongo in un giro solo.', group: 'mondo', glyph: 'gpm', oro: 400, rare: true, check: (_c, f) => fourPasses(f.landmarks) },
  { id: 'mondo-sellaronda', name: 'Sellaronda', desc: 'Il giro intero del Sella, in un verso o nell’altro. Vale la maglia Sella.', group: 'mondo', glyph: 'coppa', oro: 500, rare: true, check: (c) => worldRide(c, SELLARONDA_RIDES) },
  { id: 'mondo-marmolada', name: 'Marmolada', desc: 'Il Passo Fedaia da Canazei, sotto il ghiacciaio.', group: 'mondo', glyph: 'salita', oro: 250, check: (c) => worldRide(c, MARMOLADA_RIDES) },
  { id: 'mondo-berghem', name: 'Berghem MolaMia', desc: 'La granfondo di Gazzaniga, il corto o il medio: Selvino, Serina, Zambla.', group: 'mondo', glyph: 'fiamma', oro: 300, check: (c) => worldRide(c, BERGHEM_RIDES) },
  { id: 'luoghi-10', name: 'Curioso', desc: 'Dieci luoghi scoperti nel mondo.', group: 'mondo', glyph: 'campana', oro: 60, check: (_c, f) => f.discovered >= 10 },
  { id: 'luoghi-40', name: 'Guida delle valli', desc: 'Quaranta luoghi scoperti nel mondo.', group: 'mondo', glyph: 'campana', oro: 250, rare: true, check: (_c, f) => f.discovered >= 40 },
  count('punti-20', 'Fontanelle e campanili', 'Venti punti caldi passati.', 'mondo', 'goccia', 'pois', 20, 120),
  { id: 'pioggia', name: 'Sotto la pioggia', desc: 'Un giro nel mondo mentre a Bergamo piove davvero.', group: 'mondo', glyph: 'pioggia', oro: 80, check: (c) => c.counts.rain >= 1 },
  { id: 'notte', name: 'Lampioni', desc: 'Un giro nel mondo quando a Bergamo è notte.', group: 'mondo', glyph: 'luna', oro: 60, check: (c) => c.counts.night >= 1 },
  { id: 'alba', name: 'Prima del lavoro', desc: 'Un giro partito prima delle sette.', group: 'mondo', glyph: 'alba', oro: 60, check: (c) => c.counts.dawn >= 1 },
  { id: 'insieme', name: 'In compagnia', desc: 'Un giro con altri ciclisti veri.', group: 'mondo', glyph: 'gruppo', oro: 80, check: (c) => c.counts.rooms >= 1 },
  // costanza
  { id: 'serie-3', name: 'Tre di fila', desc: 'Tre giorni di fila in sella.', group: 'costanza', glyph: 'fiamma', oro: 90, check: (c) => c.streak.best >= 3, progress: (c) => [Math.min(3, c.streak.days), 3] },
  { id: 'serie-7', name: 'Settimana piena', desc: 'Sette giorni di fila in sella.', group: 'costanza', glyph: 'fiamma', oro: 300, rare: true, check: (c) => c.streak.best >= 7, progress: (c) => [Math.min(7, c.streak.days), 7] },
  { id: 'sessione-1', name: 'Al via', desc: 'Una sessione finita.', group: 'costanza', glyph: 'gruppo', oro: 60, check: (c) => c.counts.sessions >= 1 },
  { id: 'sessione-gruppo', name: 'Col gruppo', desc: 'Una sessione di gruppo finita col gruppo. Vale la maglia Gruppo.', group: 'costanza', glyph: 'gruppo', oro: 120, check: (_c, f) => !!f.session?.finished && f.session.kind === 'gruppo' && f.session.withPack >= 0.7 },
  count('sessioni-10', 'Abbonato', 'Dieci sessioni finite.', 'costanza', 'gruppo', 'sessions', 10, 300, true),
  count('allenamenti-5', 'Metodo', 'Cinque allenamenti ERG completati.', 'costanza', 'stella', 'workouts', 5, 150),
  { id: 'livello-5', name: 'Livello 5', desc: 'Arriva al livello 5.', group: 'costanza', glyph: 'stella', oro: 100, check: (_c, f) => f.level >= 5 },
  { id: 'livello-10', name: 'Livello 10', desc: 'Arriva al livello 10.', group: 'costanza', glyph: 'stella', oro: 300, rare: true, check: (_c, f) => f.level >= 10 },
  // motore
  { id: 'scatto', name: 'Scatto', desc: 'Cinque secondi sopra il doppio della FTP.', group: 'motore', glyph: 'fulmine', oro: 80, check: (_c, f) => f.ftp > 0 && f.peak5s >= 2 * f.ftp },
  { id: 'cinque-minuti', name: 'Cinque minuti in apnea', desc: 'Cinque minuti sopra la FTP.', group: 'motore', glyph: 'fulmine', oro: 100, check: (_c, f) => f.ftp > 0 && f.peak5min >= 1.05 * f.ftp },
  { id: 'sopra-soglia', name: 'Fondo vero', desc: 'Un’ora di giro con la media sopra il 70% della FTP.', group: 'motore', glyph: 'fulmine', oro: 120, check: (_c, f) => f.ftp > 0 && f.durationSec >= 3600 && f.avgPower >= 0.7 * f.ftp },
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
