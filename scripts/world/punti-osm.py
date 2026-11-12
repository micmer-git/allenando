"""Collect individual mapped trees and lamps before the roadside build. No node position index.
Usage: python scripts/world/punti-osm.py bergamo path/to/geofabrik.osm.pbf output.json
       python scripts/world/punti-osm.py sellaronda overpass output.json
"""
import argparse
import json
import math
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("world", choices=["bergamo", "sellaronda"])
p.add_argument("source")
p.add_argument("output", type=Path)
args = p.parse_args()
g = json.loads(Path(f"public/world/{args.world}/graph.json").read_text(encoding="utf8"))
o, b = g["origin"], g["bounds"]
my = math.radians(1) * 6371008.8
mx = my * math.cos(math.radians(o["lat"]))
rows = []


def add(lat, lon, tags):
    x, z = (lon-o["lon"])*mx, (o["lat"]-lat)*my
    if not (b["x0"] <= x < b["x1"] and b["z0"] <= z < b["z1"]):
        return
    kind = "lamp" if tags.get("highway") == "street_lamp" else (
        "spruce" if tags.get("leaf_type") == "needleleaved" else "broadleaf")
    try:
        height = float(tags.get("height", "0").removesuffix(" m"))
    except ValueError:
        height = 0
    rows.append([round(x,1), round(z,1), kind, height if 1 <= height <= 45 else 0])


if args.source == "overpass":
    import requests
    bbox = ",".join(map(str, [o["lat"]-b["z1"]/my, o["lon"]+b["x0"]/mx,
                              o["lat"]-b["z0"]/my, o["lon"]+b["x1"]/mx]))
    query = f'[out:json][timeout:60];(node["natural"="tree"]({bbox});node["highway"="street_lamp"]({bbox}););out body;'
    last_error = None
    for host in ["overpass.private.coffee", "overpass-api.de", "overpass.openstreetmap.fr"]:
        try:
            res = requests.get(f"https://{host}/api/interpreter", params={"data": query}, timeout=80,
                               headers={"User-Agent":"Orobia-world/1.0 (github.com/micmer-git/allenando)"})
            res.raise_for_status()
            data = res.json()
            if data.get("remark"):
                raise ValueError(data["remark"])
            for node in data["elements"]:
                add(node["lat"], node["lon"], node["tags"])
            break
        except (requests.RequestException, ValueError) as ex:
            last_error = ex
    else:
        raise RuntimeError("Overpass unavailable") from last_error
else:
    import osmium
    nodes = osmium.FileProcessor(args.source, osmium.osm.NODE).with_filter(
        osmium.filter.TagFilter(("natural", "tree"), ("highway", "street_lamp")))
    for n in nodes:
        add(n.location.lat, n.location.lon, n.tags)
if not rows:
    raise ValueError("Empty extract")
args.output.write_text(json.dumps(rows, separators=(",",":")), encoding="utf8")
print(args.world, len(rows))
