// GENERATO da scripts/world/build-world.ts (WORLD=sellaronda): non modificare a mano.
// Per ogni percorso del mondo: lunghezza del tratto cronometrato e tempo minimo credibile
// (un professionista a 6,8 W/kg, con il 15% di margine). Li usa il server della classifica,
// attraverso world-rides.ts che mette insieme i mondi.

export const WORLD_ID = 'sellaronda';
export const WORLD_EDGES = 0;
export const WORLD_RIDES: Record<string, { timedM: number; minSec: number }> = {};
