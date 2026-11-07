import type { PoiKind } from './world';
import { WORLD_ID, worldBase } from './world';

/**
 * I monumenti del mondo: quaranta edifici e statue riconoscibili, ognuno col suo modello
 * procedurale (src/world/monumenti) al posto dell'edificio estruso generico. Li sceglie e li
 * misura scripts/world/monumenti.ts da OpenStreetMap e dal DEM e li scrive in
 * public/world/<id>/monumenti.json; qui si leggono.
 */

export type Archetipo = 'porta' | 'torre' | 'chiesa' | 'cappella' | 'tempietto' | 'mausoleo' | 'palazzo' | 'castello' | 'statua' | 'caduti' | 'stazione' | 'casa' | 'chiesetta' | 'rifugio' | 'ossario';

/** Parametri dell'archetipo: numeri, parole, sì/no. */
export type Params = Record<string, number | string | boolean>;

/** Come sta nel file: una riga per monumento, metri con un decimale. */
export interface MonumentoFile {
  /** «w», «r» o «n» + id OSM dell'elemento da cui viene il monumento */
  id: string;
  name: string;
  kind: Archetipo;
  /** centro dell'impronta, metri locali */
  x: number;
  z: number;
  /** quota del pavimento (sotto il fornice di una porta: la strada) */
  y: number;
  /** quota più bassa del terreno sotto l'impronta: lì arriva lo zoccolo */
  yMin: number;
  /** verso della facciata: la +z del modello guarda (sin yaw, cos yaw) */
  yaw: number;
  /** misure del rettangolo orientato che contiene l'impronta, e altezza */
  w: number;
  d: number;
  h: number;
  /** anelli dell'impronta nel riferimento del modello: [x, z, x, z, …] */
  rings: number[][];
  p: Params;
  /** a che distanza dal centro si «passa» dal monumento (il punto caldo) */
  reach: number;
}

export interface MonumentiFile {
  v: 1;
  source: string;
  monumenti: MonumentoFile[];
}

export interface Monumento extends Omit<MonumentoFile, 'rings'> {
  rings: [number, number][][];
}

export function decodeMonumenti(f: MonumentiFile): Monumento[] {
  return f.monumenti.map((m) => ({
    ...m,
    rings: m.rings.map((r) => {
      const out: [number, number][] = [];
      for (let i = 0; i + 1 < r.length; i += 2) out.push([r[i], r[i + 1]]);
      return out;
    }),
  }));
}

/** Che cosa è, in due parole, per l'etichetta del laboratorio e della carta. */
export const ARCHETIPO_LABEL: Record<Archetipo, string> = {
  porta: 'Porta delle Mura',
  torre: 'Torre',
  chiesa: 'Chiesa',
  cappella: 'Cappella',
  tempietto: 'Battistero',
  mausoleo: 'Mausoleo',
  palazzo: 'Palazzo',
  castello: 'Castello',
  statua: 'Statua',
  caduti: 'Monumento ai caduti',
  stazione: 'Stazione',
  casa: 'Casa storica',
  chiesetta: 'Cappella alpina',
  rifugio: 'Rifugio',
  ossario: 'Sacrario',
};

/** L'icona del punto caldo (src/pages/RideGameHud.tsx sceglie fra goccia, mappa e campana). */
export function monumentoPoiKind(m: Pick<Monumento, 'kind'>): PoiKind {
  switch (m.kind) {
    case 'chiesa':
    case 'cappella':
    case 'tempietto':
    case 'chiesetta':
      return 'chiesa';
    case 'rifugio':
      return 'rifugio';
    case 'ossario':
      return 'croce';
    case 'castello':
    case 'porta':
      return 'castello';
    default:
      return 'torre';
  }
}

/** Una cache per mondo; `ready` è l'ultimo mondo caricato, quello in cui si pedala. */
const cache = new Map<string, Promise<Monumento[]>>();
let ready: Monumento[] = [];
let readyWorld = '';

/** Carica i monumenti di un mondo una volta; un mondo senza il file (costruito prima) ne ha zero. */
export function loadMonumenti(id?: string): Promise<Monumento[]> {
  const wid = id ?? WORLD_ID;
  let p = cache.get(wid);
  if (!p) {
    p = fetch(`${worldBase(wid)}monumenti.json`)
      .then((r) => (r.ok ? (r.json() as Promise<MonumentiFile>) : null))
      .then((f) => {
        const list = f ? decodeMonumenti(f) : [];
        ready = list;
        readyWorld = wid;
        return list;
      })
      .catch(() => {
        cache.delete(wid);
        return [];
      });
    cache.set(wid, p);
  } else if (readyWorld !== wid) {
    // già scaricato: torna a essere «pronto» questo mondo
    void p.then((list) => {
      ready = list;
      readyWorld = wid;
    });
  }
  return p;
}

/** Quelli già arrivati (vuoto finché il file non c'è): lo legge il gioco, che non aspetta. */
export function monumentiPronti(): readonly Monumento[] {
  return ready;
}

/**
 * I monumenti sulla carta (src/components/WorldMap.tsx): un rombo dorato quando la carta è
 * abbastanza vicina da distinguerli, e il nome quando si guarda una città sola.
 */
export function drawMonumenti(g: CanvasRenderingContext2D, list: readonly Monumento[], v: { cx: number; cz: number; mpp: number }, W: number, H: number): void {
  if (!list.length || v.mpp > 45) return;
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.font = '600 10px sans-serif';
  for (const m of list) {
    const x = (m.x - v.cx) / v.mpp + W / 2;
    const y = (m.z - v.cz) / v.mpp + H / 2;
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    const r = v.mpp < 8 ? 5 : 3.5;
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
    g.fillStyle = '#c9a23c';
    g.strokeStyle = '#2b2416';
    g.lineWidth = 1.2;
    g.fill();
    g.stroke();
    if (v.mpp < 3.5) {
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.strokeText(m.name, x, y - r - 2);
      g.fillStyle = '#4a3a12';
      g.fillText(m.name, x, y - r - 2);
    }
  }
  g.restore();
}
