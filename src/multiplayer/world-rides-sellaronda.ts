// GENERATO da scripts/world/build-world.ts (WORLD=sellaronda): non modificare a mano.
// Per ogni percorso del mondo: lunghezza del tratto cronometrato e tempo minimo credibile
// (un professionista a 6,8 W/kg, con il 15% di margine). Li usa il server della classifica,
// attraverso world-rides.ts che mette insieme i mondi.

export const WORLD_ID = 'sellaronda';
export const WORLD_EDGES = 1684;
export const WORLD_RIDES: Record<string, { timedM: number; minSec: number }> = {
  "sellaronda": {
    "timedM": 61545,
    "minSec": 4845
  },
  "sellaronda-orario": {
    "timedM": 61583,
    "minSec": 4846
  },
  "sella-canazei": {
    "timedM": 11140,
    "minSec": 1323
  },
  "pordoi-arabba": {
    "timedM": 9032,
    "minSec": 1066
  },
  "pordoi-canazei": {
    "timedM": 12007,
    "minSec": 1353
  },
  "gardena-corvara": {
    "timedM": 9389,
    "minSec": 1040
  },
  "gardena-selva": {
    "timedM": 10774,
    "minSec": 1102
  },
  "campolongo-corvara": {
    "timedM": 5698,
    "minSec": 614
  },
  "fedaia-canazei": {
    "timedM": 11375,
    "minSec": 1184
  }
};
