"""Attach only OSM attributes supported by matching vertices of a published footprint.
python scripts/world/facciate.py bergamo cache/osm/buildings.json --entrances /path/to/italia.osm.pbf
python scripts/world/facciate.py sellaronda cache/osm-sellaronda/buildings.json --entrances overpass
Dependencies: Pillow, pyosmium for a PBF, requests for Overpass.
Run from the repository root. Packaged data contains no names, street numbers or personal records.
"""
import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
from PIL import ImageColor

KINDS = {"garage": "garage", "garages": "garage", "barn": "fienile", "stable": "fienile",
         "farm_auxiliary": "fienile", "shed": "rimessa", "hut": "baita", "cabin": "baita"}
SHAPES = {"gabled": "gable", "hipped": "hip", "flat": "flat"}
ENTRANCE = {"main", "yes", "home", "garage", "shop"}


def colour(value):
    if not value:
        return None
    name = value.lower().strip()
    name = {"bianco": "white", "grigio": "grey"}.get(name, name)
    try:
        return "#%02x%02x%02x" % ImageColor.getrgb(name)
    except (ValueError, TypeError):
        return None


def tags_for(tags):
    attrs = {"kind": KINDS.get(tags.get("building")), "roof": SHAPES.get(tags.get("roof:shape")),
             "wallColour": colour(tags.get("building:colour")), "roofColour": colour(tags.get("roof:colour"))}
    return {k: v for k, v in attrs.items() if v}


def read_entrances(source, project, box):
    if not source:
        return {}
    west, south, east, north = box
    entrances = {}
    def add(lon, lat, kind):
        if west <= lon <= east and south <= lat <= north and kind in ENTRANCE:
            entrances[project(lon, lat)] = kind
    if source == "overpass":
        import requests
        query = f'[out:json][timeout:45];node["entrance"~"^(yes|main|home|garage|shop)$"]({south},{west},{north},{east});out body;'
        errors = []
        for url in ["https://overpass.private.coffee/api/interpreter","https://overpass-api.de/api/interpreter"]:
            try:
                response = requests.get(url, params={"data": query}, timeout=65,
                    headers={"User-Agent": "Orobia-world/1.0 (github.com/micmer-git/allenando)"})
                response.raise_for_status()
                data = response.json()
                if "remark" in data:
                    raise ValueError(data["remark"])
                for node in data["elements"]:
                    add(node["lon"], node["lat"], node["tags"]["entrance"])
                break
            except (ValueError, requests.RequestException) as error:
                errors.append(str(error))
        else:
            raise RuntimeError(errors)
    else:
        import osmium
        nodes = osmium.FileProcessor(source, osmium.osm.NODE).with_filter(osmium.filter.KeyFilter("entrance"))
        for node in nodes:
            add(node.location.lon, node.location.lat, node.tags["entrance"])
    return entrances


def footprint_key(points):
    # FNV of signed coordinates in decimal metres, in published order. Heights can be revised independently.
    state = 2166136261
    for x, z in points:
        for value in (x, z):
            state = ((state ^ (value & 0xffffffff)) * 16777619) & 0xffffffff
    return str(state)


def read_footprints(folder):
    for tile in sorted((folder/"b").glob("*.json")):
        data = json.loads(tile.read_text(encoding="utf-8"))
        ox, oz = (round(x*10) for x in data["o"])
        for record in data["b"]:
            x, z = ox, oz
            ring = []
            for dx, dz in zip(record[4::2], record[5::2]):
                x += dx
                z += dz
                ring.append((x,z))
            yield ring


def places_for_doors(corners, entrances, ring):
    """Side and distance along it. A simplified collinear vertex may have disappeared from the mesh."""
    result = set()
    for x, z in corners:
        kind = entrances.get((x,z))
        if not kind:
            continue
        closest = None
        for j, (ax, az) in enumerate(ring):
            bx, bz = ring[(j+1) % len(ring)]
            dx, dz = bx-ax, bz-az
            length_sq = dx*dx + dz*dz
            if not length_sq:
                continue
            t = ((x-ax)*dx + (z-az)*dz) / length_sq
            width = 14 if kind == "garage" else 5
            if min(t, 1-t) * math.sqrt(length_sq) < width:
                continue
            d2 = (x-ax-t*dx)**2 + (z-az-t*dz)**2
            if d2 <= 9**2 and (closest is None or d2 < closest[0]):
                closest = d2, (j, round(t*1000), int(kind == "garage"))
        if closest:
            result.add(closest[1])
    return sorted(result)


def run(world, source, entrance_source):
    folder = Path("public/world")/world
    graph = json.loads((folder/"graph.json").read_text(encoding="utf-8"))
    o, b = graph["origin"], graph["bounds"]
    my = math.radians(1)*6371008.8
    mx = my * math.cos(math.radians(o["lat"]))
    project = lambda lon, lat: (math.floor((lon-o["lon"])*mx*10+.5), math.floor((o["lat"]-lat)*my*10+.5))
    bbox = (o["lon"]+b["x0"]/mx, o["lat"]-b["z1"]/my, o["lon"]+b["x1"]/mx, o["lat"]-b["z0"]/my)
    entrances = read_entrances(entrance_source, project, bbox)
    candidates, by_corner = [], defaultdict(list)
    output, ambiguous = {}, set()
    stats = Counter()
    for area in json.loads(source.read_text(encoding="utf-8-sig"))["elements"]:
        attrs = tags_for(area["tags"])
        if area["tags"].get("location") == "underground":
            continue
        for outer in area["outer"]:
            corners = {project(lon, lat) for lon,lat in outer}
            if not attrs and entrances.keys().isdisjoint(corners):
                continue
            idx = len(candidates)
            candidates.append((attrs, corners))
            for corner in corners:
                by_corner[corner].append(idx)
    # Read one published tile at a time. Only the small set of tagged source features needs an index.
    for ring in read_footprints(folder):
        unique = set(ring)
        votes = Counter(i for corner in unique for i in by_corner.get(corner, ()))
        matches = [i for i, n in votes.items() if n >= max(3, len(unique)-1)]
        if len(matches) != 1:
            continue
        attrs, corners = candidates[matches[0]]
        hints = dict(attrs)
        doors = places_for_doors(corners, entrances, ring)
        if doors:
            hints["entrances"] = doors
        if not hints:
            continue
        key = footprint_key(ring)
        if key in output:
            ambiguous.add(key)
        output[key] = hints
    for key in ambiguous:
        output.pop(key,None)
    for hints in output.values():
        stats.update(hints.keys())
        stats["doors"] += len(hints.get("entrances",[]))
    dest = Path("src/open/facciate-data")
    dest.mkdir(exist_ok=True)
    (dest/(world+".json")).write_text(json.dumps(output, sort_keys=True, separators=(",",":"))+"\n", encoding="utf8")
    print(world, len(output), "impronte con attributi;", dict(stats), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("world", choices=["bergamo","sellaronda"])
    parser.add_argument("source", type=Path)
    parser.add_argument("--entrances")
    args = parser.parse_args()
    run(args.world, args.source, args.entrances)

