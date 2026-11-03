"""
Estrae dal file OpenStreetMap di Geofabrik (Italia nord-ovest) quello che serve al mondo di
Bergamo e lo scrive in scripts/world/cache/osm/*.json, nello stesso formato delle risposte di
Overpass (elementi con type, id, tags, nodes, geometry), più le aree già ricomposte
(type "area": anelli esterni e interni) per edifici, uso del suolo e acque.

  curl -L -o scripts/world/cache/pbf/nord-ovest.osm.pbf https://download.geofabrik.de/europe/italy/nord-ovest-latest.osm.pbf
  python scripts/world/extract-pbf.py

Serve pyosmium (pip install osmium). Le posizioni dei nodi stanno in un file su disco, non
in memoria: l'estratto ha decine di milioni di nodi.
"""

import json
import os
import sys
import time

import osmium

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "cache", "pbf", "nord-ovest.osm.pbf")
OUT = os.path.join(HERE, "cache", "osm")

# gli stessi confini di config.mjs
REGION = dict(s=45.66, w=9.5, n=46.075, e=10.1)
CITY = dict(s=45.664, w=9.618, n=45.727, e=9.712)
HORIZON = dict(s=45.5, w=9.25, n=46.25, e=10.38)

MAIN = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "cycleway"}
CITY_CLASSES = {"residential", "living_street", "pedestrian", "road"}
BIKE_PATHS = {"path", "footway", "bridleway", "track"}
ROAD_KEYS = {"highway", "name", "ref", "oneway", "oneway:bicycle", "bicycle", "access", "vehicle", "motorroad", "bridge", "tunnel", "layer", "surface", "width", "lanes", "cycleway", "cycleway:left", "cycleway:right", "cycleway:both", "junction", "smoothness", "tracktype", "covered", "official_name", "alt_name", "loc_name", "name:it"}

LANDUSE = {"forest", "residential", "industrial", "commercial", "retail", "meadow", "grass", "farmland", "orchard", "vineyard", "quarry", "cemetery", "construction", "allotments", "farmyard"}
NATURAL_AREA = {"wood", "grassland", "heath", "scrub", "bare_rock", "scree", "glacier", "shingle", "fell", "water", "wetland"}
LEISURE_AREA = {"park", "pitch", "golf_course", "stadium", "garden"}

POI_TAGS = {
    "historic": None,
    "tourism": {"attraction", "viewpoint", "museum", "alpine_hut", "artwork"},
    "amenity": {"place_of_worship", "theatre", "townhall", "university", "hospital", "casino", "fountain"},
    "building": {"church", "cathedral", "chapel", "basilica", "tower", "castle", "bell_tower", "campanile"},
    "man_made": {"tower", "bridge", "campanile", "lighthouse", "water_tower"},
    "leisure": {"stadium", "park"},
    "railway": {"station", "halt", "tram_stop"},
    "aerialway": {"station"},
    "natural": {"waterfall", "cave_entrance", "spring", "cliff", "gorge"},
    "waterway": {"waterfall"},
}


def inside(b, lat, lon):
    return b["s"] <= lat <= b["n"] and b["w"] <= lon <= b["e"]


def r6(v):
    return round(v, 6)


def is_poi(tags):
    if "name" not in tags:
        return False
    for k, allowed in POI_TAGS.items():
        v = tags.get(k)
        if v is None:
            continue
        if allowed is None or v in allowed:
            return True
    return False


def bike_path(tags):
    hw = tags.get("highway")
    if hw not in BIKE_PATHS:
        return False
    if tags.get("bicycle") not in ("designated", "yes", "permissive"):
        return False
    # sterrati da mountain bike no: solo fondo pedalabile con una bici da strada
    surface = tags.get("surface", "")
    if hw == "track" and tags.get("tracktype", "grade2") not in ("grade1",) and surface not in ("asphalt", "paved", "concrete"):
        return False
    return surface in ("", "asphalt", "paved", "concrete", "paving_stones", "compacted", "fine_gravel", "sett")


def main():
    if not os.path.exists(PBF):
        sys.exit(f"manca {PBF}")
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    idx = os.path.join(HERE, "cache", "pbf", "locations.idx")
    if os.path.exists(idx):
        os.remove(idx)

    roads_main, roads_city = [], []
    water_lines, walls = [], []
    places, peaks, pois = [], [], []
    buildings, landuse, water_areas = [], [], []

    keys = ["highway", "waterway", "natural", "landuse", "building", "place", "mountain_pass", "historic", "tourism", "amenity", "man_made", "leisure", "railway", "aerialway", "barrier", "water"]
    fp = (
        osmium.FileProcessor(PBF)
        .with_locations(f"sparse_file_array,{idx}")
        .with_areas(osmium.filter.KeyFilter("building", "landuse", "natural", "leisure", "water", "waterway", "historic", "tourism", "amenity", "man_made"))
        .with_filter(osmium.filter.KeyFilter(*keys))
    )
    n = 0
    for obj in fp:
        n += 1
        if n % 500000 == 0:
            print(f"  {n} oggetti, {time.time() - t0:.0f} s", flush=True)
        tags = {t.k: t.v for t in obj.tags}

        if obj.is_node():
            loc = obj.location
            if not loc.valid():
                continue
            lat, lon = loc.lat, loc.lon
            if not inside(HORIZON, lat, lon):
                continue
            el = {"type": "node", "id": obj.id, "lat": r6(lat), "lon": r6(lon), "tags": tags}
            if "place" in tags and "name" in tags:
                places.append(el)
            if (tags.get("natural") in ("peak", "saddle", "volcano") or tags.get("mountain_pass") == "yes") and "name" in tags:
                peaks.append(el)
            if inside(REGION, lat, lon) and is_poi(tags):
                pois.append({"type": "node", "id": obj.id, "center": {"lat": r6(lat), "lon": r6(lon)}, "tags": tags})
            continue

        if obj.is_way():
            try:
                geom = [(r6(nd.lat), r6(nd.lon)) for nd in obj.nodes]
                refs = [nd.ref for nd in obj.nodes]
            except osmium.InvalidLocationError:
                continue
            if len(geom) < 2:
                continue
            in_region = any(inside(REGION, la, lo) for la, lo in geom)
            in_horizon = in_region or any(inside(HORIZON, la, lo) for la, lo in geom)
            if not in_horizon:
                continue
            hw = tags.get("highway")

            def way_el(keep=None):
                t = tags if keep is None else {k: v for k, v in tags.items() if k in keep}
                return {"type": "way", "id": obj.id, "tags": t, "nodes": refs, "geometry": [{"lat": la, "lon": lo} for la, lo in geom]}

            if hw and in_region:
                if hw in MAIN or bike_path(tags):
                    roads_main.append(way_el(ROAD_KEYS))
                elif hw in CITY_CLASSES and any(inside(CITY, la, lo) for la, lo in geom):
                    roads_city.append(way_el(ROAD_KEYS))
            ww = tags.get("waterway")
            if ww in ("river", "canal") or (ww == "stream" and "name" in tags and in_region):
                water_lines.append(way_el({"waterway", "name", "width", "tunnel", "intermittent"}))
            if in_region and (tags.get("barrier") == "city_wall" or tags.get("historic") in ("city_gate", "citywalls") or tags.get("railway") in ("rail", "tram", "light_rail", "funicular", "narrow_gauge") or "aerialway" in tags):
                walls.append(way_el())
            if in_region and is_poi(tags) and not tags.get("building"):
                la = sum(p[0] for p in geom) / len(geom)
                lo = sum(p[1] for p in geom) / len(geom)
                pois.append({"type": "way", "id": obj.id, "center": {"lat": r6(la), "lon": r6(lo)}, "tags": tags})
            continue

        if obj.is_area():
            try:
                outers = []
                inners = []
                for ring in obj.outer_rings():
                    outers.append([[r6(nd.lon), r6(nd.lat)] for nd in ring])
                    for inner in obj.inner_rings(ring):
                        inners.append([[r6(nd.lon), r6(nd.lat)] for nd in inner])
            except osmium.InvalidLocationError:
                continue
            if not outers:
                continue
            first = outers[0]
            if not any(inside(REGION, p[1], p[0]) for p in first[:: max(1, len(first) // 8)] + [first[0]]):
                continue
            el = {"type": "area", "id": obj.orig_id(), "way": obj.from_way(), "tags": tags, "outer": outers}
            if inners:
                el["inner"] = inners
            if "building" in tags:
                keep = {k: v for k, v in tags.items() if k in ("building", "height", "building:levels", "roof:shape", "roof:levels", "name", "min_height", "building:min_level", "amenity", "religion", "man_made", "historic", "tower:type", "roof:colour", "building:colour", "layer", "location")}
                el["tags"] = keep
                buildings.append(el)
                if is_poi(tags):
                    xs = [p[0] for p in first]
                    ys = [p[1] for p in first]
                    pois.append({"type": "area", "id": obj.orig_id(), "center": {"lat": r6(sum(ys) / len(ys)), "lon": r6(sum(xs) / len(xs))}, "tags": tags})
            elif tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("water"):
                water_areas.append(el)
            elif tags.get("landuse") in LANDUSE or tags.get("natural") in NATURAL_AREA or tags.get("leisure") in LEISURE_AREA:
                el["tags"] = {k: v for k, v in tags.items() if k in ("landuse", "natural", "leisure", "name", "wood", "leaf_type")}
                landuse.append(el)
            if is_poi(tags) and "building" not in tags:
                xs = [p[0] for p in first]
                ys = [p[1] for p in first]
                pois.append({"type": "area", "id": obj.orig_id(), "center": {"lat": r6(sum(ys) / len(ys)), "lon": r6(sum(xs) / len(xs))}, "tags": tags})

    def dump(name, elements):
        with open(os.path.join(OUT, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump({"source": "Geofabrik nord-ovest " + time.strftime("%Y-%m-%d", time.gmtime(os.path.getmtime(PBF))), "elements": elements}, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{name}: {len(elements)}", flush=True)

    dump("roads-main", roads_main)
    dump("roads-city", roads_city)
    dump("water", water_lines + water_areas)
    dump("places", places)
    dump("peaks", peaks)
    dump("pois", pois)
    dump("walls", walls)
    dump("buildings", buildings)
    dump("landuse", landuse)
    print(f"fatto in {time.time() - t0:.0f} s, {n} oggetti letti")
    try:
        os.remove(idx)
    except OSError:
        pass


if __name__ == "__main__":
    main()
