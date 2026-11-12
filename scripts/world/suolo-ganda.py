"""Extract Ganda's 5 m land-use mask from the regional DBGT GeoPackages (EPSG:7791).
python scripts/world/suolo-ganda.py scripts/world/cache/ganda
Download sources with scripts/world/ganda-rilievo.py. Requires rasterio, shapely, numpy.
"""
import argparse
import json
import math
from pathlib import Path
import sqlite3
import struct

import numpy as np
import shapely
from affine import Affine
from rasterio.features import rasterize
from rasterio.warp import transform
from shapely import LineString, Polygon

from facciate import read_footprints

WORLD = Path("public/world/bergamo")
STEP = 5
PAD = 350
BUILT = 250


def source_polys(db, layer, project, scope):
    row = db.execute("select column_name, srs_id from gpkg_geometry_columns where table_name=?", (layer,)).fetchone()
    if row is None:
        return []
    column, crs = row
    if crs != 7791:
        raise ValueError(f"Unexpected CRS {crs} in {layer}")
    geoms = []
    for (blob,) in db.execute(f'select "{column}" from "{layer}"'):
        if not blob:
            continue
        size = [0,32,48,48,64][(blob[3]>>1)&7]
        geoms.append(shapely.force_2d(shapely.from_wkb(blob[8+size:])))
    if not geoms:
        return []
    local = shapely.transform(geoms, project)
    return [p for p in local if not p.is_empty and p.geom_type in ('MultiPolygon','Polygon') and scope.intersects(p)]


def run(cache):
    graph=json.loads((WORLD/'graph.json').read_text(encoding='utf8'))
    ride=next(r for r in json.loads((WORLD/'rides.json').read_text(encoding='utf8')) if r['id']=='ganda')
    o=graph['origin']
    my=math.pi*6371008.8/180
    mx=my*math.cos(math.radians(o['lat']))
    def project(coords):
        lon,lat=transform("EPSG:7791","EPSG:4326",coords[:,0],coords[:,1])
        return np.column_stack(((np.asarray(lon)-o['lon'])*mx,(o['lat']-np.asarray(lat))*my))
    def road_line(edge):
        return LineString(np.cumsum(np.asarray(edge[7]).reshape(-1,3),axis=0)[:,:2]/10)
    route=shapely.union_all([road_line(graph['edges'][i]) for i in {e for e,_ in ride['legs']}])
    corridor=route.buffer(PAD)
    x0,z0,x1,z1 = corridor.bounds
    x0,z0=math.floor(x0/STEP)*STEP,math.floor(z0/STEP)*STEP
    w,h=math.ceil((x1-x0)/STEP),math.ceil((z1-z0)/STEP)
    affine=Affine(STEP,0,x0,0,STEP,z0)
    shape=(h,w)
    valid=rasterize([(corridor,1)],out_shape=shape,transform=affine,dtype='uint8')
    out=np.zeros(shape,'u1')
    layers=[('BOSCO',1),('CL_AGR_CL_AGR_SUP',7),('AR_VRD_AR_VRD_SUP',4),('SP_ACQ',6),
            ('AC_VEI',BUILT),('AC_PED',BUILT),('AC_CIC',BUILT),('UN_VOL',BUILT)]
    polygons={layer:[] for layer,_ in layers}
    for city in ('gazzaniga','aviatico'):
        with sqlite3.connect(f'file:{(cache/(city+".gpkg")).as_posix()}?mode=ro',uri=True) as db:
            for layer,_ in layers:
                polygons[layer].extend(source_polys(db,layer,project,corridor))
    for layer,value in layers:
        if polygons[layer]:
            rasterize([(geom,value) for geom in polygons[layer]],out=out,transform=affine,all_touched=value==BUILT)
    # Exclude current OSM footprints too. A mask cell touching a house or paved street stays treeless.
    buildings=[]
    for ring in read_footprints(WORLD):
        if not any(x0<=x/10<=x1 and z0<=z/10<=z1 for x,z in ring):
            continue
        p=Polygon([(x/10,z/10) for x,z in ring])
        if corridor.intersects(p):
            buildings.append(p)
    # Keep the survey local to land classes actually mapped in one of the two municipalities.
    # OSM exclusions outside these classes keep the old renderer's behaviour.
    mapped=out!=0
    exclusion=rasterize([(p,1) for p in buildings],out_shape=shape,transform=affine,all_touched=True,dtype='uint8')
    out[(exclusion>0)&mapped]=BUILT
    out[valid==0]=0
    rows,cols=np.where(out!=0)
    left,right,top,bottom=cols.min(),cols.max()+1,rows.min(),rows.max()+1
    out=out[top:bottom,left:right]
    x0,z0=x0+int(left)*STEP,z0+int(top)*STEP
    h,w=out.shape
    runs=bytearray()
    offsets=[]
    for row in out:
        offsets.append(len(runs)//5)
        cuts=np.flatnonzero(np.diff(np.r_[0,row,0]))
        for start,end in zip(cuts,cuts[1:]):
            if row[start]:
                runs.extend(struct.pack('<HHB',int(start),int(end),int(row[start])))
    offsets.append(len(runs)//5)
    data=struct.pack('<4siiHH',b'GCV1',x0,z0,w,h)+struct.pack('<'+'I'*len(offsets),*offsets)+runs
    (WORLD/'suolo-ganda-v1.bin').write_bytes(data)
    bounds=[x0,z0,x0+w*STEP,z0+h*STEP]
    Path('src/open/suolo-ganda-bounds.json').write_text(json.dumps(bounds)+'\n')
    print('bounds',bounds,'bytes',len(data),'rows',h,'cells',dict(zip(*np.unique(out,return_counts=True))),
          'polygons', {k:len(v) for k,v in polygons.items()},flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('cache',type=Path)
    run(parser.parse_args().cache)
