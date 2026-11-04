/*
 * I nomi dei luoghi: le parole (che servono anche alle pagine, senza tirarsi dietro il 3D) e le
 * regole con cui i nomi entrano nella scena. Qui niente three.js: la pagina Mondo importa
 * `kindLabel` da questo file, e il pacchetto iniziale dell'app resta senza WebGL.
 */

const KIND: Record<string, string> = {
  citta: 'Città',
  paese: 'Paese',
  chiesa: 'Chiesa',
  santuario: 'Santuario',
  torre: 'Torre',
  porta: 'Porta delle Mura',
  mura: 'Mura venete',
  ponte: 'Ponte',
  fiume: 'Fiume',
  cima: 'Cima',
  passo: 'Passo',
  lago: 'Lago',
  castello: 'Castello',
  luogo: 'Luogo',
  funivia: 'Funivia',
  stazione: 'Stazione',
};

/** Il tipo di un luogo da riconoscere, con la maiuscola («Chiesa», «Porta delle Mura»). */
export function kindLabel(kind: string): string {
  return KIND[kind] ?? (kind ? kind[0].toUpperCase() + kind.slice(1) : kind);
}

/** I tipi che sotto il nome nel 3D non dicono niente di più del nome stesso («Albino · Paese»). */
const OVVI = new Set(['citta', 'paese', 'cima', 'passo', 'luogo', 'fiume', 'lago']);

/** La seconda riga del nome nel 3D: il tipo solo quando aggiunge qualcosa. */
export function landmarkSub(kind: string): string {
  return OVVI.has(kind) ? '' : kindLabel(kind);
}

// ---------- i nomi nella scena ----------

/** Fino a qui un nome si legge pieno; oltre sfuma, e a LABEL_GONE non c'è più. Metri. */
export const LABEL_FULL = 1500;
export const LABEL_GONE = 2500;
/** Nomi accesi insieme, al massimo. */
export const LABEL_MAX = 3;

/** Opacità di un nome per la sua distanza dalla camera. */
export function labelFade(d: number): number {
  if (d <= LABEL_FULL) return 1;
  if (d >= LABEL_GONE) return 0;
  return 1 - (d - LABEL_FULL) / (LABEL_GONE - LABEL_FULL);
}

/**
 * Il nome si vede dalla camera, o c'è il terreno in mezzo? Si campiona la quota lungo la linea
 * di vista, lasciando stare i primi metri (sotto la camera) e gli ultimi (il nome sta sopra il
 * suo luogo, il terreno lì intorno è il luogo stesso).
 */
export function occluded(
  height: (x: number, z: number) => number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  samples = 24,
): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 80) return false;
  const t0 = 30 / len;
  const t1 = 1 - 60 / len;
  for (let i = 0; i <= samples; i++) {
    const t = t0 + ((t1 - t0) * i) / samples;
    if (t <= 0 || t >= 1) continue;
    const ground = height(ax + (bx - ax) * t, az + (bz - az) * t);
    if (ground > ay + (by - ay) * t + 2) return true;
  }
  return false;
}

/** Un rettangolo sullo schermo, in pixel della tela: sinistra, alto, destra, basso. */
export type Rect = [number, number, number, number];

export interface LabelCandidate<K> {
  key: K;
  rect: Rect;
  /** 0 i luoghi da riconoscere, 1 i paesi, 2 le cime */
  prio: number;
  /** distanza dalla camera, metri */
  d: number;
}

function overlap(a: Rect, b: Rect): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/**
 * Quali nomi accendere: dal più importante e dal più vicino, al massimo `max`, solo se il
 * rettangolo sta tutto dentro la tela (mai tagliato dal bordo), sotto la fascia alta `top`, fuori
 * da ogni pannello dell'HUD (`blocked`) e senza coprire un nome già acceso.
 */
export function placeLabels<K>(cands: LabelCandidate<K>[], view: { width: number; height: number; top: number; margin?: number }, blocked: Rect[], max = LABEL_MAX): Set<K> {
  const m = view.margin ?? 6;
  const list = [...cands].sort((a, b) => a.prio - b.prio || a.d - b.d);
  const taken: Rect[] = [];
  const out = new Set<K>();
  for (const c of list) {
    if (out.size >= max) break;
    const r = c.rect;
    if (r[0] < m || r[2] > view.width - m || r[1] < Math.max(m, view.top) || r[3] > view.height - m) continue;
    const pad: Rect = [r[0] - m, r[1] - m, r[2] + m, r[3] + m];
    if (blocked.some((b) => overlap(pad, b))) continue;
    if (taken.some((t) => overlap(pad, t))) continue;
    taken.push(r);
    out.add(c.key);
  }
  return out;
}
