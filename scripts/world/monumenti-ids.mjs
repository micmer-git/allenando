// Gli elementi OSM dei monumenti che fetch-osm.mjs scarica con la geometria (cache/<osmDir>/
// monumenti-nodi.json), per i mondi che vengono da Overpass. Le schede vere (archetipo, altezza,
// facciata) stanno in monumenti.ts: qui solo gli id, letti da uno script senza TypeScript.
// Per Bergamo il file lo scrive monumenti-extract.py dal PBF, e questa lista resta vuota.

/** @type {Record<string, { nodes: number[], ways: number[], relations: number[] }>} */
const IDS = {
  bergamo: { nodes: [], ways: [], relations: [] },
  sellaronda: {
    nodes: [
      796380013, // Fausto Coppi, il busto al Passo Pordoi
      29916900, // Sass Pordoi, stazione a monte della funivia
      29916899, // Sass Pordoi, stazione a valle (al passo)
      1642475077, // Arabba, stazione della funivia di Porta Vescovo
      2749674147, // Rifugio Frara, al Passo Gardena
      3309824059, // il memoriale al Passo Pordoi
    ],
    ways: [
      68827782, // Rifugio Carlo Valentini, Passo Sella
      233233503, // la cappella del Passo Sella
      427207651, // Passo Sella Mountain Resort (l'albergo grande del passo)
      199516793, // Hotel Savoia, Passo Pordoi
      199516854, // la cappella del Passo Pordoi
      42257301, // Rifugio Maria, in cima al Sass Pordoi
      237016903, // San Mauriz, la cappella del Passo Gardena
      42107052, // Hotel Cir, Passo Gardena
      199514203, // Rifugio Bec de Roces, Passo Campolongo
      255592975, // la chiesa di Selva (Maria Hilf)
      1197350465, // il campanile di Selva
      42210743, // Chiesa Sacro Cuore di Gesù, Corvara
      235162263, // Chiesa di Santa Caterina, Corvara
      199519403, // la chiesa di Arabba
      59275646, // chiesa di San Floriano, Canazei
      107176085, // Rifugio Marmolada Castiglioni, Passo Fedaia
    ],
    relations: [],
  },
};

export const MONUMENTI_IDS = IDS[process.env.WORLD || 'bergamo'] ?? { nodes: [], ways: [], relations: [] };
