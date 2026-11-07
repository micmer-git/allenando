// I nomi in italiano. In Alto Adige e in Val di Fassa OSM scrive il nome in tre lingue in un
// tag solo («Jouf de Sela - Passo Sella - Sellajoch») e mette l'italiano in `name:it`: per un
// mondo con `lang: 'it'` (config.mjs) il nome diventa quello, e l'originale resta in `name:osm`.
// Per Bergamo non si tocca niente.

type Tags = Record<string, string>;

export function italianName(t: Tags): string | undefined {
  if (t['name:it']) return t['name:it'];
  const n = t.name;
  if (!n || !n.includes(' - ')) return n;
  // tre nomi separati da « - »: quello italiano è di solito in mezzo o in fondo; si prende il
  // pezzo che somiglia di più all'italiano (accenti italiani, «Passo», «Rifugio», «Chiesa»…)
  const parts = n.split(' - ').map((s) => s.trim());
  const score = (s: string) => (/\b(Passo|Rifugio|Chiesa|Cima|Monte|Sasso|Val |Forcella|Piz |Col |Torre|Punta|Lago|Rio|Santa|San |Sant')/.test(s) ? 2 : 0) + (/[äöüëß]|joch|spitze|bach|berg/i.test(s) ? -2 : 0) + (/[àèéìòù]/.test(s) ? 1 : 0);
  return parts.reduce((a, b) => (score(b) > score(a) ? b : a));
}

/** Rinomina in posto ogni elemento (nodo, via, area) con un tag `name`. */
export function italianize<T>(els: T[]): T[] {
  for (const e of els as unknown as { tags?: Tags }[]) {
    const t = e.tags;
    if (!t?.name) continue;
    const it = italianName(t);
    if (it && it !== t.name) {
      t['name:osm'] = t.name;
      t.name = it;
    }
  }
  return els;
}
