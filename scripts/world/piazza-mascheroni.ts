/** Piazza Mascheroni, Bergamo. Corrections to building tile 6_20, in its native
 * decimetre delta format. The plaza (OSM way 395128738) is a pedestrian area;
 * its perimeter coincides with three facades, not a passage through them.
 * Cittadella relation 1203036 consists of outer way 79939808 and inner way
 * 32785740. Its four solid wings and four elevated passages follow that ring
 * and ways 25063838, 32785741, 32785742, 168166179, 938292911,
 * 1523588155 and 1523588156. Covered street corridors are 7.2 m wide,
 * foot passages 4.4 m. Source: © OpenStreetMap contributors (ODbL).
 * Keep the same upper height and the driveable 4.3 m clearance at the gates.
 */
const cittadella: number[][] = [
  [0,120,0,0,3055,10141,15,90,82,12,-5,-1,94,-17,21,-108],
  [0,120,0,0,3040,10342,22,82,-6,193,-61,68,95,35,-14,33,-21,62,544,285,80,-197,7,5,4,-9,-128,-57,-16,51,-407,-200,52,-183,29,-123,-12,-6,12,-55,-64,-1,-12,-4,13,-2],
  [0,120,0,0,3770,10684,-43,-18,28,-66,21,10,22,-56,-19,-11,149,-328,45,11,39,-85,18,-33,-17,32,-44,-37,-63,-27,12,-1,-566,37,-28,178,425,66,10,46,-1,9,13,3,-13,38,-27,-7,-158,363,15,-33,128,57,-12,34],
  [0,120,0,0,4135,9966,276,154,-42,65,53,34,49,-73,-43,-26,38,-58,-187,-129,11,-20,-170,-91,-43,70,-72,-40,-66,169,3,-7,65,27,45,38],
  [0,120,43,0,3942,10014,-24,61,-12,1,63,27,44,37,29,-51,10,-10,-45,-38],
  [0,120,43,0,3220,10327,3,-9,111,10,243,46,136,21,1,5,44,11,1,-3,-10,-52,-425,-66,2,-13,-98,0,-1,5,-48,-1,25,-4,-49,0,2,42,-13,2,10,4],
  [0,120,43,0,3326,10277,26,-165,-90,5,-21,108,-94,17,5,1,3,34,49,0,25,-5,-1,5],
  [0,120,43,0,3588,10775,-15,33,-11,34,128,57,26,-67],
];

const plazaFacades = new Set([
  '3743,11451,160,73', // OSM way 88851688
  '3302,11350,31,20', // OSM way 207093381
  '3940,11009,246,125', // OSM way 808431740
]);

/** Only apply a correction when the known first edge still matches its footprint.
 * A future OSM geometry change must be reviewed instead of overwriting the new shape. */
export function fitPiazzaMascheroni(rows: number[][]): number[][] {
  return rows.flatMap(row => {
    const edge = row.slice(4, 8).join(',');
    if (edge === "2995,10685,95,35") return cittadella;
    if (plazaFacades.has(edge)) return [[row[0], row[1], 0, ...row.slice(3)]];
    return [row];
  });
}
