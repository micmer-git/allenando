"""Associa ai giri Ganda/Selvino i tag surface delle way OSM del grafo distribuito.

Dalla radice: python scripts/world/fondi-ganda.py --osm scripts/world/cache/osm
Richiede numpy e shapely 2. Conserva soltanto gli archi con riscontro completo.
"""
import argparse
from collections import Counter
import json
import math
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.strtree import STRtree

WORLD = Path('public/world/bergamo')
RIDES = {'ganda', 'selvino'}
MATCH_M = 2
STEP_M = 4


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def tangent(line, at):
    a = line.interpolate(max(0, at - 1))
    b = line.interpolate(min(line.length, at + 1))
    dx, dz = b.x - a.x, b.y - a.y
    length = math.hypot(dx, dz)
    return (dx / length, dz / length) if length else (0, 0)


def match_edge(line, index, ways):
    sources = set()
    surface = None
    n = max(1, math.ceil(line.length / STEP_M))
    for i in range(n):
        at = (i + .5) * line.length / n
        p = line.interpolate(at)
        dx, dz = tangent(line, at)
        matches = []
        for k in index.query(p, predicate='dwithin', distance=MATCH_M):
            other = index.geometries[k]
            nx, nz = tangent(other, other.project(p))
            # Un'altra via che taglia l'incrocio non è la sorgente di questo fondo.
            if abs(dx * nx + dz * nz) >= .80:
                matches.append(k)
        values = {ways[k][1] for k in matches}
        if len(values) != 1 or '' in values:
            return None
        value = values.pop()
        if surface is not None and surface != value:
            return None
        surface = value
        sources.update(matches)
    # Controllo continuo, comprese le estremità, sul corridoio di sole way verificate.
    coverage = shapely.union_all([index.geometries[k].buffer(MATCH_M) for k in sources])
    if not coverage.covers(line):
        return None
    return [surface, sorted(ways[k][0] for k in sources)]


def main(osm):
    graph = read(WORLD / 'graph.json')
    rides = {r['id']: [i for i, _ in r['legs']] for r in read(WORLD / 'rides.json') if r['id'] in RIDES}
    ids = sorted({i for legs in rides.values() for i in legs})
    paths = {}
    for i in ids:
        xyz = np.asarray(graph['edges'][i][7]).reshape(-1, 3)
        paths[i] = LineString(np.cumsum(xyz[:, :2], axis=0) / 10)
    area = shapely.union_all(list(paths.values())).envelope.buffer(10)
    origin = graph['origin']
    mlat = math.radians(1) * 6371008.8
    mlon = mlat * math.cos(math.radians(origin['lat']))
    source = set()
    extracted = {}
    for name in ('roads-main.json', 'roads-city.json'):
        data = read(osm / name)
        source.add(data['source'])
        for row in data['elements']:
            if 'highway' in row['tags'] and len(row['geometry']) >= 2:
                extracted[row['id']] = row
    lines, ways = [], []
    for way_id, row in extracted.items():
        coords = [((p['lon'] - origin['lon']) * mlon, (origin['lat'] - p['lat']) * mlat) for p in row['geometry']]
        geom = LineString(coords)
        if area.intersects(geom):
            lines.append(geom)
            ways.append((way_id, row['tags'].get('surface', '')))
    index = STRtree(lines)
    edges = {}
    for i, geometry in paths.items():
        result = match_edge(geometry, index, ways)
        if result:
            edges[i] = result
    catalog = {
        'graphBuiltAt': graph['builtAt'], 'edgeCount': len(graph['edges']),
        'source': sorted(source), 'attribution': '© OpenStreetMap contributors, ODbL 1.0',
        'edges': edges,
    }
    output = WORLD / 'fondi-verificati-v1.json'
    output.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    for name, legs in rides.items():
        matches = [edges[i][0] if i in edges else 'senza riscontro completo' for i in legs]
        print(name, Counter(matches))
    print(len(edges), 'archi unici con tag esplicito e geometria verificata', output.stat().st_size, 'byte')


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--osm', type=Path, default=Path('scripts/world/cache/osm'))
    main(args.parse_args().osm)
