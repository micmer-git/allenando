"""Ritaglio DBGT (Gazzaniga + Aviatico) e OSM sul tratto Gazzaniga–Ganda–Aviatico.
Dipendenze: shapely 2, rasterio, numpy, requests. Vedere docs/rilievo-ganda.md.
"""
import argparse
from collections import Counter
import io
import json
import math
from pathlib import Path
import sqlite3
import zipfile

import numpy as np
import requests
import shapely
from rasterio.warp import transform
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import substring
from shapely.strtree import STRtree

WORLD = Path("public/world/bergamo")
CACHE = Path("scripts/world/cache/ganda")
GPACK = "https://www.geoportale.regione.lombardia.it/rlregis_download/service/package"
MUNICIPALITIES = [("gazzaniga", "16111"), ("aviatico", "16015")]
SURVEY = WORLD / "rilievo-ganda-v1.json"
BBOX_OSM = "45.785,9.757,45.838,9.848"


def dump(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf8")


def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, code in MUNICIPALITIES:
        output = CACHE / (name + ".gpkg")
        if not output.exists():
            res = requests.get(GPACK, params={"dbId": 514, "cod": code}, timeout=90)
            res.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(res.content)) as packet:
                output.write_bytes(packet.read("dbgt.gpkg"))
    osm = CACHE / "barriere-osm.json"
    if not osm.exists():
        query = f'[out:json][timeout:60];way[barrier~"^(guard_rail|retaining_wall|wall|fence|hedge|handrail)$"]({BBOX_OSM});out tags geom;'
        res = requests.get("https://overpass.openstreetmap.fr/api/interpreter", params={"data": query},
                           headers={"User-Agent": "Orobia-world/1.0 (github.com/micmer-git/allenando)"}, timeout=90)
        res.raise_for_status()
        data = res.json()
        if data.get("remark") or not data.get("elements"):
            raise ValueError("Risposta OSM incompleta")
        dump(osm, data)


def unpack(blob):
    # GeoPackageBinary header followed by WKB. Esri appends an all-NaN M coordinate.
    envelope = (blob[3] >> 1) & 7
    offset = 8 + [0, 32, 48, 48, 64][envelope]
    return shapely.force_2d(shapely.from_wkb(blob[offset:]))


class Corridor:
    def __init__(self):
        graph = json.loads((WORLD / "graph.json").read_text(encoding="utf8"))
        self.origin = graph["origin"]
        self.mlat = math.radians(1) * 6371008.8
        self.mlon = self.mlat * math.cos(math.radians(self.origin["lat"]))
        rides = json.loads((WORLD / "rides.json").read_text(encoding="utf8"))
        ride = next(r for r in rides if r["id"] == "ganda")
        marks = {m["id"]: m["at"] for m in ride["landmarks"]}
        edges = [np.cumsum(np.asarray(e[7]).reshape(-1, 3), axis=0)[:, :2] / 10 for e in graph["edges"]]
        self.loop = LineString(np.concatenate([edges[i][::direction] for i, direction in ride["legs"]]))
        self.route = substring(self.loop, marks["gazzaniga"]-400, marks["aviatico"]+550)
        # La chiesa e le case del borgo di Ganda sono accanto al passo, visitabili in giro libero.
        places = json.loads((WORLD / "features.json").read_text(encoding="utf8"))["places"]
        village = min((Point(x, z) for name, _, x, z, y in places if name == "Ganda"), key=self.route.distance)
        self.area = self.route.buffer(55).union(village.buffer(125))
        self.building_area = self.route.buffer(110).union(village.buffer(150))
        local_box = box(*self.area.bounds).buffer(50)
        roads = [LineString(coords).buffer(max(e[6]/10,1)+0.55)
                 for coords, e in zip(edges, graph["edges"])
                 if not (e[5] & 2) and local_box.intersects(LineString(coords))]
        self.asphalt = shapely.union_all(roads, grid_size=.03)
        self.yards = self.area.difference(self.asphalt)

    def local(self, lon, lat):
        return (np.asarray(lon)-self.origin["lon"])*self.mlon, (self.origin["lat"]-np.asarray(lat))*self.mlat

    def regional(self, coords):
        lon, lat = transform("EPSG:7791", "EPSG:4326", coords[:,0], coords[:,1])
        return np.column_stack(self.local(lon,lat))


def table(db, name, fields, corridor):
    meta = db.execute("select column_name,srs_id from gpkg_geometry_columns where table_name=?", (name,)).fetchone()
    if meta is None:
        return []
    if meta[1] != 7791:
        raise ValueError(f"Proiezione inattesa per {name}: {meta[1]}")
    rows = db.execute(f'select "{meta[0]}",{",".join(fields)} from {name}').fetchall()
    if not rows:
        return []
    geoms = shapely.transform([unpack(r[0]) for r in rows], corridor.regional)
    return [(g, *row[1:]) for g, row in zip(geoms,rows) if not g.is_empty]


def lines(geom):
    if geom.geom_type in ("LineString", "LinearRing"):
        yield geom
    elif geom.geom_type in ("MultiLineString", "GeometryCollection"):
        for part in geom.geoms:
            yield from lines(part)


def decimetres(line):
    coords = np.rint(np.asarray(line.coords)[:,:2]*10).astype(int)
    keep = np.r_[True, np.any(np.diff(coords,axis=0) != 0, axis=1)]
    coords = coords[keep]
    return np.diff(coords, axis=0, prepend=[[0,0]]).flatten().tolist()


def regional_assets(corridor):
    osm = json.loads((CACHE / "barriere-osm.json").read_text(encoding="utf8"))
    # source/type/height(dm, 0=unknown)/line: all source IDs survive clipping in the distributed subset.
    borders = []
    near_osm, regional_trees, volumes = [], [], []
    kinds = dict(fence="fence", wall="wall", retaining_wall="retaining", hedge="hedge", handrail="handrail", guard_rail="rail")
    for item in osm["elements"]:
        seq = [(float(corridor.local(p["lon"],p["lat"])[0]),float(corridor.local(p["lon"],p["lat"])[1])) for p in item["geometry"]]
        if len(seq)<2:
            continue
        geom = LineString(seq).intersection(corridor.yards)
        if geom.is_empty:
            continue
        try:
            height = round(float(item["tags"].get("height","").replace(" m",""))*10)
        except ValueError:
            height = 0
        kind = kinds[item["tags"]["barrier"]]
        for l in lines(geom):
            if l.length >= 1.5:
                near_osm.append(l)
                borders.append(["w"+str(item["id"]),kind,height if 3<=height<=65 else 0,l])
    free = corridor.yards.difference(shapely.union_all(near_osm).buffer(2.0)) if near_osm else corridor.yards
    for city,_ in MUNICIPALITIES:
        with sqlite3.connect(CACHE / (city+".gpkg")) as db:
            for geom,oid,ty in table(db,"EL_DIV",["OBJECTID","EL_DIV_TY"],corridor):
                kind = {"02":"grille","13":"fence","17":"fence","18":"timber","19":"hedge"}.get(ty)
                if not kind or not free.intersects(geom):
                    continue
                borders.extend([f"{city}:EL_DIV:{oid}",kind,0,l] for l in lines(geom.intersection(free)) if l.length >= 1.5)
            for geom,oid in table(db,"ALBERO",["OBJECTID"],corridor):
                if free.contains(geom) and corridor.asphalt.distance(geom)>1.4:
                    regional_trees.append([round(geom.x*10),round(geom.y*10)])
            for geom,oid,group,h,por in table(db,"UN_VOL",["OBJECTID","CEDIUV","UN_VOL_AV","UN_VOL_POR"],corridor):
                if por=="01" and h and 2.6 <= h <= 70 and corridor.building_area.intersects(geom):
                    valid = shapely.make_valid(geom) if not geom.is_valid else geom
                    volumes.append((valid, f"{city}:{group}", float(h)))
            # A retaining wall has an actual footprint. Keep the footprint rather than following both
            # sides with two parallel walls. Its height is estimated separately by the renderer.
            wall_types = dict(db.execute("select CLASSID,MSOS_TY from MU_SOS"))
            for geom,oid,ref in table(db,"MU_SOS_MSOS_SUP",["OBJECTID","CLASSREF"],corridor):
                if wall_types.get(ref) != "04":
                    continue
                if not geom.is_valid:
                    geom=shapely.make_valid(geom)
                if not free.intersects(geom):
                    continue
                for poly in shapely.get_parts(geom.intersection(free)):
                    if poly.geom_type == "Polygon" and not poly.interiors and poly.area>=1.2:
                        borders.append([f"{city}:MU_SOS:{oid}","footprint",0,poly.exterior])
    return borders,regional_trees,volumes,osm["osm3s"]["timestamp_osm_base"]


def osm_elevated(path, corridor):
    """Only newer OSM buildings with explicitly reported height/floors need protecting."""
    out=[]
    for b in json.loads(path.read_text(encoding="utf8"))["elements"]:
        if not any(b["tags"].get(key) for key in ("height","building:levels","min_height","building:min_level")):
            continue
        for outer in b.get("outer",[]):
            if len(outer)<3: continue
            g=Polygon(np.column_stack(corridor.local(*np.asarray(outer).T)))
            if corridor.building_area.intersects(g): out.append(g if g.is_valid else shapely.make_valid(g))
    return STRtree(out)


def building_heights(corridor, volumes, osm_buildings):
    # Many buildings are split into more than one volume. Match only base volumes belonging to
    # the same building, with similar heights. An annex or two attached houses must not inherit
    # each other's roof height merely because a centroid or bounding box falls inside.
    bodies={}
    for geom, key, h in volumes:
        if key.endswith(":None"): continue
        bodies.setdefault(key,[]).append((geom,h))
    models=[]
    for key, parts in bodies.items():
        major=[(p,h) for p,h in parts if p.area>=0.12*sum(v.area for v,_ in parts)]
        if not major or max(h for _,h in major)-min(h for _,h in major)>2.0: continue
        g=shapely.union_all([p for p,h in parts])
        h=sum(p.area*h for p,h in major)/sum(p.area for p,h in major)
        models.append((key,g,h))
    idx=STRtree([m[1] for m in models])
    protected=osm_elevated(osm_buildings,corridor)
    result={}
    for file in sorted((WORLD/"b").glob("*.json")):
        tile=json.loads(file.read_text(encoding="utf8"))
        x,z=tile["o"]
        if not corridor.building_area.intersects(box(x-50,z-50,x+2050,z+2050)): continue
        hits={}
        for row in tile["b"]:
            if row[2]!=0 or row[0] in (3,4,6): continue
            ring=np.cumsum(np.array(row[4:]).reshape(-1,2),axis=0)/10 + np.array([x,z])
            b=Polygon(ring)
            if not b.is_valid or b.area < 15 or not corridor.building_area.contains(b.centroid): continue
            if any(b.intersection(protected.geometries[k]).area > b.area*.12 for k in protected.query(b)):
                continue
            matched=[]
            for i in idx.query(b):
                key,g,h=models[i]
                if b.centroid.distance(g.centroid)>4: continue
                overlap=b.intersection(g).area
                if overlap>=.85*b.area and overlap>=.85*g.area: matched.append((key,h))
            if len(matched)!=1: continue
            key,h=matched[0]
            # Exact source row geometry plus original category/roof, independent of position in tile.
            signature = ",".join(map(str, row))
            if signature in hits:
                raise ValueError(f"Impronta duplicata: {file.stem} {signature}")
            hits[signature] = [round(h*10), key]
        if hits: result[file.stem]=hits
    return result


def build(osm_buildings):
    corridor=Corridor()
    borders,trees,volumes,stamp=regional_assets(corridor)
    existing=STRtree([Point(x,z) for x,z,k,h in json.loads((WORLD/"punti-strada-v1.json").read_text(encoding="utf8")) if k!="lamp"])
    trees=sorted(set((x,z) for x,z in trees if not len(existing.query(Point(x/10,z/10),predicate="dwithin",distance=4))))
    rows=[]
    for key,kind,h,l in borders:
        coords=decimetres(l.simplify(.16,preserve_topology=True))
        if len(coords)>=4: rows.append([key,kind,h,coords])
    out={"dateOSM":stamp,"bounds":[int(v) for v in (math.floor(corridor.area.bounds[0]),math.floor(corridor.area.bounds[1]),math.ceil(corridor.area.bounds[2]),math.ceil(corridor.area.bounds[3]))],"borders":rows,"trees":trees}
    heights=building_heights(corridor,volumes,osm_buildings)
    out["heights"] = heights
    dump(SURVEY,out)
    print("barriere",Counter(r[1] for r in rows),"alberi",len(trees),"case",sum(map(len,heights.values())),"bytes",SURVEY.stat().st_size)
    for d in range(9000,24001,1000):
        segment=substring(corridor.loop,d,min(d+1000,corridor.loop.length)).buffer(45)
        print(f"km {d/1000:.0f}–{d/1000+1:.0f}",Counter(kind for _,kind,_,line in borders if segment.intersects(line)))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--fetch",action="store_true")
    p.add_argument("--osm-buildings",type=Path,default=Path("scripts/world/cache/osm/buildings.json"))
    args=p.parse_args()
    if args.fetch: fetch()
    build(args.osm_buildings)
