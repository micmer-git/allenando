// Quattro campate per riga. Le prime tre righe sono famiglie di finestre.
// L'ultima contiene pietra, assi, portoncino e serranda (nell'ordine). Canvas ha y verso il basso.
export const FACADE_COLUMNS = 4;
export const PLASTER_UV = 0.99;
export type WallFinish = 'pietra' | 'assi' | 'porta' | 'serranda';
const FINISH: Record<WallFinish, number> = { pietra: 0, assi: 1, porta: 2, serranda: 3 };

// Un margine rispetto alle celle vicine evita che i mipmap mettano una finestra nel muro in pietra.
export function finishUV(finish: WallFinish, u: number, v: number): [number, number] {
  return [(FINISH[finish] + 0.025 + 0.95 * u) / 4, (0.025 + 0.95 * v) / 4];
}

