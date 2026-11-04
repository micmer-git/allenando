"""
Monumenti: quello che extract-pbf.py non tiene, in tre giri veloci sull'estratto Geofabrik e
senza indice delle posizioni su disco (meno di un minuto in tutto):

1. i NODI con historic=memorial/monument, tourism=artwork, man_made=obelisk, anche senza nome
   (la statua di Garibaldi alla Rotonda dei Mille in OSM non ha un nome, ha un soggetto);
2. le VIE e le RELAZIONI con historic=castle/memorial/monument/city_gate o tourism=artwork
   (il Castello di San Vigilio è un multipoligono senza «building»): se ne tengono i nodi;
3. le posizioni di quei nodi, filtrate per id, per ricomporre le impronte (le relazioni come
   anelli esterni, cuciti dalle loro vie).

  python scripts/world/monumenti-extract.py     → scripts/world/cache/osm/monumenti-nodi.json

Lo legge scripts/world/monumenti.ts (facoltativo: se manca, i monumenti che vengono da qui non
ci sono e la costruzione lo dice).
"""

import json
import os
import time

import osmium

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "cache", "pbf", "nord-ovest.osm.pbf")
OUT = os.path.join(HERE, "cache", "osm", "monumenti-nodi.json")

# gli stessi confini di config.mjs
REGION = dict(s=45.66, w=9.5, n=46.075, e=10.1)


def wanted(t):
    if t.get("historic") in ("memorial", "monument", "statue"):
        return True
    if t.get("tourism") == "artwork":
        return True
    if t.get("man_made") in ("obelisk",):
        return True
    return "memorial" in t


WAY_HISTORIC = {"castle", "memorial", "monument", "city_gate", "tower", "fort"}


def ways_wanted(t):
    return t.get("historic") in WAY_HISTORIC or t.get("tourism") == "artwork" or t.get("man_made") == "obelisk"


def main():
    t0 = time.time()
    out = []
    fp = osmium.FileProcessor(PBF, osmium.osm.NODE).with_filter(osmium.filter.KeyFilter("historic", "tourism", "memorial", "man_made"))
    for obj in fp:
        loc = obj.location
        if not loc.valid():
            continue
        lat, lon = loc.lat, loc.lon
        if not (REGION["s"] <= lat <= REGION["n"] and REGION["w"] <= lon <= REGION["e"]):
            continue
        tags = {t.k: t.v for t in obj.tags}
        if not wanted(tags):
            continue
        out.append({"type": "node", "id": obj.id, "lat": round(lat, 7), "lon": round(lon, 7), "tags": tags})
    n_nodes = len(out)
    # le relazioni: le vie «outer» da cucire in anelli
    rels = []
    for obj in osmium.FileProcessor(PBF, osmium.osm.RELATION).with_filter(osmium.filter.KeyFilter("historic", "tourism")):
        tags = {t.k: t.v for t in obj.tags}
        if not ways_wanted(tags):
            continue
        rels.append((obj.id, tags, [m.ref for m in obj.members if m.type == "w" and m.role in ("outer", "")]))
    member_ids = {w for _, _, ws in rels for w in ws}
    members = {}
    if member_ids:
        for obj in osmium.FileProcessor(PBF, osmium.osm.WAY).with_filter(osmium.filter.IdFilter(member_ids)):
            members[obj.id] = [n.ref for n in obj.nodes]
    # le vie: prima i riferimenti ai nodi, poi le posizioni di quei nodi soli
    ways = []
    for obj in osmium.FileProcessor(PBF, osmium.osm.WAY).with_filter(osmium.filter.KeyFilter("historic", "tourism", "man_made")):
        tags = {t.k: t.v for t in obj.tags}
        if not ways_wanted(tags):
            continue
        ways.append((obj.id, tags, [n.ref for n in obj.nodes]))
    refs = {r for _, _, rs in ways for r in rs} | {r for rs in members.values() for r in rs}
    pos = {}
    for obj in osmium.FileProcessor(PBF, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(refs)):
        if obj.location.valid():
            pos[obj.id] = (round(obj.location.lat, 7), round(obj.location.lon, 7))
    for wid, tags, rs in ways:
        geom = [pos[r] for r in rs if r in pos]
        if len(geom) < 2 or len(geom) != len(rs):
            continue
        if not any(REGION["s"] <= la <= REGION["n"] and REGION["w"] <= lo <= REGION["e"] for la, lo in geom):
            continue
        out.append({"type": "way", "id": wid, "tags": tags, "geometry": [{"lat": la, "lon": lo} for la, lo in geom]})
    n_ways = len(out) - n_nodes
    for rid, tags, ws in rels:
        rings = stitch([members[w] for w in ws if w in members])
        outer = [[[pos[r][1], pos[r][0]] for r in ring] for ring in rings if all(r in pos for r in ring)]
        if not outer:
            continue
        if not any(REGION["s"] <= p[1] <= REGION["n"] and REGION["w"] <= p[0] <= REGION["e"] for p in outer[0]):
            continue
        out.append({"type": "relation", "id": rid, "tags": tags, "outer": outer})
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "Geofabrik nord-ovest " + time.strftime("%Y-%m-%d", time.gmtime(os.path.getmtime(PBF))), "elements": out}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"monumenti-nodi: {n_nodes} nodi, {n_ways} vie, {len(out) - n_nodes - n_ways} relazioni in {time.time() - t0:.0f} s", flush=True)


def stitch(parts):
    """Cuce le vie di un multipoligono in anelli chiusi (liste di id di nodo)."""
    parts = [list(p) for p in parts if len(p) >= 2]
    rings = []
    while parts:
        ring = parts.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, p in enumerate(parts):
                if p[0] == ring[-1]:
                    ring += p[1:]
                elif p[-1] == ring[-1]:
                    ring += p[::-1][1:]
                elif p[-1] == ring[0]:
                    ring = p[:-1] + ring
                elif p[0] == ring[0]:
                    ring = p[::-1][:-1] + ring
                else:
                    continue
                parts.pop(i)
                changed = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


if __name__ == "__main__":
    main()
