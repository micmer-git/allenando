"""Render local north-up 1 km ground-color sheets from AGEA's CC BY 4.0 WMTS.
python scripts/world/ortofoto.py bergamo (or sellaronda). Only mapped ride corridors.
Source camera, roofs and shadows are never used as height data. No live service in the app.
"""
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
import io
import json
import math
from pathlib import Path
import sys
import threading
import time

from PIL import Image, ImageStat
import requests

M = math.pi * 6371008.8 / 180
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "scripts/world/cache/agea-ortofoto-v1"
BASE = "https://geoportale.agea.gov.it/image/rest/services/AgEA/Ortofoto_AgEA_{}/ImageServer/tile/{}/{}/{}"
C = 1000
local = threading.local()


def corridors(graph, rides):
    cells = {}
    for ride in rides:
        # 1.95 m ground samples throughout Ganda and the Dolomite circuit. 3.91 m on other rides.
        zoom = 16 if ride["id"] in ("ganda", "sellaronda", "sellaronda-orario") else 15
        for e, _ in ride["legs"]:
            ds = graph["edges"][e][7]
            x = z = 0
            for dx, dz in zip(ds[::3], ds[1::3]):
                x += dx
                z += dz
                for a in range(math.floor((x / 10 - 300) / C), math.floor((x / 10 + 300) / C) + 1):
                    for b in range(math.floor((z / 10 - 300) / C), math.floor((z / 10 + 300) / C) + 1):
                        cells[a, b] = max(zoom, cells.get((a, b), 0))
    return cells


def pixel_bounds(a, b, origin, zoom):
    """Web Mercator pixel edges of one local sheet. North/top is smaller z, as in geo.ts."""
    xdeg = M * math.cos(math.radians(origin["lat"]))
    n = 256 * 2**zoom
    def pixel(x, z):
        lat = math.radians(origin["lat"] - z / M)
        lon = origin["lon"] + x / xdeg
        return (lon+180)/360*n, (1-math.asinh(math.tan(lat))/math.pi)/2*n
    return (*pixel(a*C, b*C), *pixel((a+1)*C, (b+1)*C))


def cached(year, zoom, col, row):
    return CACHE / f"{year}-{zoom}-{col}-{row}.img"


def download(key):
    year, zoom, col, row = key
    f = cached(*key)
    if f.exists():
        return
    if not hasattr(local, "session"):
        local.session = requests.Session()
        local.session.headers["User-Agent"] = "OROBIA/1.0 (+https://github.com/micmer-git/allenando)"
    url = BASE.format(year, zoom, row, col)
    for attempt in range(4):
        try:
            r = local.session.get(url, timeout=(8, 30))
            if r.status_code in (404, 204):
                data = b""
            else:
                r.raise_for_status()
                data = r.content
                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
            f.write_bytes(data)
            time.sleep(0.15)
            return
        except (OSError, requests.RequestException):
            if attempt == 3:
                raise
            time.sleep(2**attempt * 2)


@lru_cache(maxsize=64)
def source(year, zoom, col, row):
    data = cached(year, zoom, col, row).read_bytes()
    if not data:
        return None
    with Image.open(io.BytesIO(data)) as raw:
        if raw.size != (256,256):
            raise ValueError(f"Wrong tile dimensions {raw.size}")
        out = raw.convert("RGBA")
    if not out.getchannel("A").getbbox():
        return None
    # Some ArcGIS endpoints return a perfectly achromatic placeholder with an HTTP 200.
    stat = ImageStat.Stat(out.resize((32,32)))
    if max(stat.mean[:3])-min(stat.mean[:3]) < 0.1 and max(stat.stddev[:3]) < 0.5:
        return None
    return out


def run(world):
    wd = ROOT / "public/world" / world
    graph = json.loads((wd / "graph.json").read_text(encoding="utf8"))
    cells = corridors(graph, json.loads((wd / "rides.json").read_text(encoding="utf8")))
    directory = wd / "ortofoto-v1"
    directory.mkdir(exist_ok=True)
    CACHE.mkdir(parents=True,exist_ok=True)
    years = (2024,) if world == "bergamo" else (2023,2024)
    plan, keys = [], set()
    for (a,b), zoom in sorted(cells.items()):
        bounds = pixel_bounds(a,b,graph["origin"],zoom)
        left,top,right,bottom = bounds
        c0,r0,c1,r1 = (int(left//256),int(top//256),math.ceil(right/256)-1,math.ceil(bottom/256)-1)
        coords = [(col,row) for row in range(r0,r1+1) for col in range(c0,c1+1)]
        keys.update((year,zoom,col,row) for col,row in coords for year in years)
        plan.append((a,b,zoom,c0,r0,c1,r1,coords,bounds))
    print(f"{world}: {len(cells)} local sheets, {len(keys)} source tiles",flush=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        for i,_ in enumerate(pool.map(download, sorted(keys)),1):
            if i%100==0: print("source tiles",i,"/",len(keys),flush=True)
    index = []
    for a,b,zoom,c0,r0,c1,r1,coords,box in plan:
        canvas = Image.new("RGBA",(256*(c1-c0+1),256*(r1-r0+1)))
        for col,row in coords:
            for year in years:
                im = source(year,zoom,col,row)
                if im is not None:
                    canvas.alpha_composite(im,((col-c0)*256,(row-r0)*256))
        left,top,right,bottom = box
        size = 512 if zoom==16 else 256
        sheet = canvas.transform((size,size),Image.Transform.EXTENT,
            (left-c0*256,top-r0*256,right-c0*256,bottom-r0*256),Image.Resampling.BICUBIC)
        if not sheet.getchannel("A").getbbox():
            continue
        name = f"{a}_{b}"
        sheet.save(directory / (name + ".webp"), quality=83, method=4)
        index.append(name)
    (directory / "index.json").write_text(json.dumps(index,separators=(",",":")),encoding="utf8")
    print(f"{world}: {len(index)}/{len(cells)} covered; {sum(p.stat().st_size for p in directory.glob('*.webp'))/1e6:.1f} MB",flush=True)


if __name__ == "__main__":
    for w in sys.argv[1:] or ["bergamo","sellaronda"]:
        if w not in ("bergamo","sellaronda"):
            raise ValueError(w)
        run(w)
