"""Bake a north-up albedo atlas over the full far mesh, using HTTP range reads on ESA COGs.
Run from the repo root: python scripts/world/paesaggio.py (pip install rasterio numpy pillow certifi).
The shader uses EXACTLY the same first/last far vertex, so the near and far terrain share one UV.
"""
import json
import math
from pathlib import Path

import certifi
import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

S3 = "https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com"
SIZE = 2048


def bake(folder):
    graph = json.loads((folder / "graph.json").read_text(encoding="utf8"))
    far, origin = graph["far"], graph["origin"]
    my = math.radians(1) * 6371008.8
    mx = my * math.cos(math.radians(origin["lat"]))
    west = origin["lon"] + far["x0"] / mx
    north = origin["lat"] - far["z0"] / my
    dx = (far["nx"] - 1) * far["step"] / mx / SIZE
    dy = (far["nz"] - 1) * far["step"] / my / SIZE
    # Pixel centres decide which 1 degree source tile owns the output sample.
    lon = west + (np.arange(SIZE) + .5) * dx
    lat = north - (np.arange(SIZE) + .5) * dy
    rgb = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
    for n in np.unique(np.floor(lat).astype(int)):
        rows = np.flatnonzero(np.floor(lat) == n)
        for e in np.unique(np.floor(lon).astype(int)):
            cols = np.flatnonzero(np.floor(lon) == e)
            key = f"N{n:02d}E{e:03d}"
            url = f"{S3}/rgbnir/2021/N{n:02d}/ESA_WorldCover_10m_2021_v200_{key}_S2RGBNIR.tif"
            with rasterio.open(url) as ds:
                win = from_bounds(lon[cols[0]]-dx/2, lat[rows[-1]]-dy/2,
                                  lon[cols[-1]]+dx/2, lat[rows[0]]+dy/2, ds.transform)
                raw = ds.read((1,2,3), window=win, out_shape=(3,len(rows),len(cols)),
                              resampling=Resampling.average)
            if not raw.any():
                raise ValueError(f"Missing pixels: {key}")
            # Shared exposure for all tiles; encode reflectance as display sRGB.
            linear = np.clip(raw.astype("float32") / 3400, 0, 1)
            color = np.where(linear <= .0031308, 12.92*linear, 1.055*linear**(1/2.4)-.055)
            rgb[rows[0]:rows[-1]+1, cols[0]:cols[-1]+1, 3] = raw.any(axis=0) * 255
            rgb[rows[0]:rows[-1]+1, cols[0]:cols[-1]+1, :3] = np.round(255*color.transpose(1,2,0))
            print(folder.name, key, flush=True)
    Image.fromarray(rgb).save(folder / "paesaggio-2021.webp", quality=88, method=6)


if __name__ == "__main__":
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="35",
                      GDAL_HTTP_MAX_RETRY="2", CURL_CA_BUNDLE=certifi.where()):
        for folder in sorted(Path("public/world").glob("*/graph.json")):
            bake(folder.parent)
