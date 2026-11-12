"""Estimate roof colours from interior pixels of the AGEA CC BY 4.0 orthophotos.
python scripts/world/tetti-ortofoto.py bergamo ../orobia/public/world/bergamo/ortofoto-v1
Uses the same north-up 1 km sheets as ortofoto.py. Requires Pillow, numpy and shapely.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image
from shapely import Polygon, contains_xy

from facciate import footprint_key, read_footprints


def sample(poly, raster, cell):
    n = raster.shape[0]
    step = 1000 / n
    # Stay 1.25 pixels inside every outer edge. Small and skinny roofs produce no estimate.
    inner = poly.buffer(-1.25 * step)
    if inner.is_empty:
        return None
    xmin, zmin, xmax, zmax = inner.bounds
    ox, oz = (i * 1000 for i in cell)
    xs = np.arange(max(0,int((xmin-ox)//step)), min(n,int((xmax-ox)//step)+1))
    zs = np.arange(max(0,int((zmin-oz)//step)), min(n,int((zmax-oz)//step)+1))
    if not xs.size or not zs.size:
        return None
    x,z = np.meshgrid(xs,zs)
    inside = contains_xy(inner, ox+(x+.5)*step, oz+(z+.5)*step)
    pixels = raster[z[inside],x[inside]].astype(float)
    if len(pixels) < 6:
        return None
    r,g,b,a = pixels.T
    light = .299*r+.587*g+.114*b
    vegetation = (g*1.045 >= r) & (g>b+18)
    blue_shadow = (light<100) & (b>r+10) & (g>r+5)
    clean = (a>=250) & (light>49) & (light<230) & ~vegetation & ~blue_shadow
    # Reject patches dominated by shadows, trees, glare or multiple incompatible materials.
    if clean.sum() < max(6,.70*len(pixels)):
        return None
    rgb = pixels[clean,:3]
    typical = np.median(rgb,axis=0)
    if np.percentile(np.abs(rgb-typical).max(axis=1),70)>25:
        return None
    return np.round(typical).astype(int)


def run(world, sheets):
    folder = Path('public/world')/world
    cells = {tuple(map(int,k.split('_'))) for k in json.loads((sheets/'index.json').read_text())}
    grouped = defaultdict(list)
    for ring in read_footprints(folder):
        if len(ring) < 3:
            continue
        # Accept only footprints wholly in a single sheet so seam pixels cannot influence the colour.
        cell = (ring[0][0]//10000, ring[0][1]//10000)
        if cell in cells and all((x//10000,z//10000)==cell for x,z in ring):
            grouped[cell].append(ring)
    known = json.loads((Path('src/open/facciate-data')/(world+'.json')).read_text())
    samples = {}
    duplicate = set()
    for cell,rings in sorted(grouped.items()):
        raster = np.asarray(Image.open(sheets/('%d_%d.webp'%cell)).convert('RGBA'))
        for ring in rings:
            poly = Polygon([(x/10,z/10) for x,z in ring])
            if not poly.is_valid or poly.area < 60:
                continue
            key = footprint_key(ring)
            if known.get(key,{}).get('roofColour'):
                continue
            color = sample(poly,raster,cell)
            if color is None:
                continue
            if int(key) in samples:
                duplicate.add(int(key))
            r,g,b = map(int,color)
            samples[int(key)] = (round(r*31/255)<<11) | (round(g*63/255)<<5) | round(b*31/255)
    for key in duplicate:
        del samples[key]
    with (folder/'tetti-v1.bin').open('wb') as f:
        f.write(b'TET1')
        for key,value in sorted(samples.items()):
            f.write(struct.pack('<IH',key,value))
    print(world, len(samples), 'roof colours in', len(grouped), 'sheets',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('world',choices=['bergamo','sellaronda'])
    parser.add_argument('sheets',type=Path)
    args=parser.parse_args()
    run(args.world,args.sheets)
