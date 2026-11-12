"""Sezioni dei marciapiedi DBGT sulla carreggiata del mondo. Richiede la cache di ganda-rilievo.py."""
from collections import Counter
import json
import math
from pathlib import Path
import runpy
import sqlite3

import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.strtree import STRtree

base = runpy.run_path(str(Path(__file__).with_name('ganda-rilievo.py')))
corridor = base['Corridor']()
table = base['table']
vehicles = []
pavements = []
for town, _ in base['MUNICIPALITIES']:
    with sqlite3.connect(base['CACHE'] / (town + '.gpkg')) as db:
        for g, _, kind, level in table(db, 'AC_PED_AC_PED_SUP_SR', ['OBJECTID','AC_PED_ZON','AC_PED_SED'], corridor):
            if kind == '01' and level == '01' and g.intersects(corridor.area):
                pavements.append(shapely.make_valid(g))
        for g, _ in table(db, 'AC_VEI', ['OBJECTID'], corridor):
            if g.intersects(corridor.area):
                vehicles.append(shapely.make_valid(g))

road_area = shapely.union_all(vehicles).intersection(corridor.area)
shapely.prepare(road_area)
pedestrians = STRtree(pavements)
graph = json.loads((base['WORLD'] / 'graph.json').read_text(encoding='utf8'))
catalog = {}

def width_at(p, nx, nz, hw, candidates):
    # L'asse OSM e la semilarghezza del grafo possono differire dal rilievo comunale.
    # Si conserva il marciapiede del medesimo lato solo se adiacente al suo bordo.
    extent = hw + 6
    ray = LineString([(p.x, p.y), (p.x + nx*extent, p.y + nz*extent)])
    widths = []
    for i in candidates:
        for line in base['lines'](pedestrians.geometries[i].intersection(ray)):
            if line.length < .45:
                continue
            lower = min(ray.project(shapely.Point(x, z)) for x, z in line.coords)
            if max(.8, hw-2) <= lower <= hw+1.8:
                widths.append(line.length)
    return min(40, round(max(widths, default=0)*10))

for edge_id, e in enumerate(graph['edges']):
    if e[5] & 3 or e[4] > 5:
        continue
    coords = np.cumsum(np.asarray(e[7]).reshape(-1, 3), axis=0)[:, :2] / 10
    path = LineString(coords)
    if not corridor.area.intersects(path):
        continue
    n = max(1, math.ceil(path.length / 3))
    runs = []
    for j in range(n):
        at = path.length*(j+.5)/n
        p = path.interpolate(at)
        if not road_area.covers(p):
            continue
        left = right = 0
        hw = e[6]/10
        matches = pedestrians.query(p, predicate='dwithin', distance=hw+6)
        if len(matches):
            a, b = path.interpolate(max(0, at-1)), path.interpolate(min(path.length, at+1))
            dx, dz = b.x-a.x, b.y-a.y
            length = math.hypot(dx, dz)
            if length:
                left = width_at(p, dz/length, -dx/length, hw, matches)
                right = width_at(p, -dz/length, dx/length, hw, matches)
        start, end = (round(path.length*v/n*10) for v in (j, j+1))
        if runs and runs[-1][1] == start and runs[-1][2:] == [left, right]:
            runs[-1][1] = end
        else:
            runs.append([start, end, left, right])
    if runs:
        catalog[edge_id] = runs

out = {'graphBuiltAt':graph['builtAt'], 'edgeCount':len(graph['edges']), 'bounds':list(corridor.area.bounds), 'edges':catalog}
base['dump'](Path('src/open/marciapiedi-ganda.json'), out)
counts = Counter()
for runs in catalog.values():
    for a,b,l,r in runs:
        counts['sede rilevata'] += (b-a)/10
        if l: counts['sinistro'] += (b-a)/10
        if r: counts['destro'] += (b-a)/10
print(len(catalog), 'archi;', len(pavements), 'poligoni AC_PED_ZON=01 a raso nel corridoio;', counts)
