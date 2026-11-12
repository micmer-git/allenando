/**
 * La tabella dei mondi, senza il grafo: la pagina Mondo e Oggi la leggono prima di scaricare
 * i dati. `src/open/world.ts` la riesporta; `src/open/worlds.ts` ci costruisce sopra il catalogo
 * (centro, riquadro, quota) per la scelta, il meteo e il diario.
 */

/** Il mondo di partenza, quando nessuno ne ha scelto uno. */
export const WORLD_ID = 'bergamo';

/** Le zone dei percorsi: quelle di Bergamo e quelle del Sellaronda. */
export type RideArea = 'citta' | 'brembana' | 'seriana' | 'valli' | 'sella' | 'marmolada';

export interface WorldInfo {
  id: string;
  /** il nome in testa alla pagina Mondo e nelle schede */
  name: string;
  /** una riga sotto il nome */
  tagline: string;
  /** le zone dei percorsi, nell'ordine della pagina */
  areas: { id: RideArea; label: string }[];
  /** i paesi da cui si parte nel giro libero (nomi dei dati) */
  starts: string[];
  /** il paese di riferimento: il primo nelle liste, la partenza di A → B */
  home: string;
  /** l'arrivo proposto in A → B */
  away: string;
  /** quanto pesa scaricarlo, MB (a mano, dal build) */
  mb: number;
  /** le quote, nella riga delle fonti sotto il percorso (F.14) */
  quote: string;
  /** le quote con autori e licenze, in fondo alla pagina Mondo */
  quoteCredits: string;
}

/** I mondi dell'app, nell'ordine delle schede. I dati stanno in public/world/<id>/. */
export const WORLDS: readonly WorldInfo[] = [
  {
    id: 'bergamo',
    name: 'Bergamo e le valli',
    tagline: 'Città Alta, Val Seriana e Val Brembana fino ai passi',
    areas: [
      { id: 'citta', label: 'Bergamo città' },
      { id: 'seriana', label: 'Val Seriana' },
      { id: 'brembana', label: 'Val Brembana' },
      { id: 'valli', label: 'Fra le due valli' },
    ],
    starts: ['Bergamo', 'Città Alta', 'Ponteranica', 'Alzano Lombardo', 'Nembro', 'Albino', 'Gazzaniga', 'Ponte Nossa', 'Clusone', 'Castione della Presolana', 'Villa d’Almè', 'Zogno', 'San Pellegrino Terme', 'San Giovanni Bianco', 'Piazza Brembana', 'Branzi', 'Serina', 'Selvino'],
    home: 'Bergamo',
    away: 'Selvino',
    mb: 22,
    quote: 'Quote EU-DEM',
    quoteCredits: 'Quote EU-DEM © Copernicus. Ganda: rilievi DBGT rielaborati © Regione Lombardia (CC BY 4.0), Gazzaniga 2007 e Aviatico 2011.',
  },
  {
    id: 'sellaronda',
    name: 'Sellaronda',
    tagline: 'I quattro passi del Sella, Canazei e la Marmolada',
    areas: [
      { id: 'sella', label: 'I quattro passi' },
      { id: 'marmolada', label: 'La Marmolada' },
    ],
    starts: ['Selva di Val Gardena', 'Corvara in Badia', 'Colfosco', 'Arabba', 'Canazei', 'Campitello di Fassa', 'Plan de Gralba'],
    home: 'Selva di Val Gardena',
    away: 'Corvara in Badia',
    mb: 5,
    // pista S3: il rilievo LiDAR delle province dove c'è (Alto Adige, Trentino), EU-DEM altrove (Veneto)
    quote: 'Quote LiDAR Alto Adige e Trentino, EU-DEM',
    quoteCredits: 'Quote: DTM 2,5 m © Provincia autonoma di Bolzano – Alto Adige (CC0 1.0), LiDAR PAT 2006/2008 © Provincia autonoma di Trento (CC BY 4.0), EU-DEM © Copernicus.',
  },
];

export function worldInfo(id: string | null | undefined): WorldInfo {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}

export function isWorld(id: string | null | undefined): id is string {
  return WORLDS.some((w) => w.id === id);
}
