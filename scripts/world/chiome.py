"""Build the local alpha atlas of CC0 photographs. Pillow, numpy and requests are used only here.
Onsemeliot https://opengameart.org/content/purple-leaf-plum-tree and https://opengameart.org/content/vaious-vegetation-sprites
rubberduck https://opengameart.org/content/high-res-tree-textures-treecollection1kpng
"""
from pathlib import Path
import numpy as np
import requests
from PIL import Image

cache = Path('scripts/world/cache/chiome')
cache.mkdir(exist_ok=True, parents=True)
atlas = Image.new('RGBA',(1024,1024))


def photo(file, path):
    target = cache / (file+'.png')
    if not target.exists():
        r=requests.get('https://opengameart.org/sites/default/files/'+path,timeout=40)
        r.raise_for_status()
        target.write_bytes(r.content)
    return Image.open(target).convert('RGBA')


def place(im, box):
    # The palette in the scene supplies foliage colour and season. Keep the local shading of the photo.
    im = im.crop(im.getchannel('A').getbbox())
    x,y,w,h=box
    im=im.resize((w-8,h-8), Image.Resampling.LANCZOS)
    rgba=np.asarray(im).copy()
    values=rgba[:,:,:3].max(axis=2).astype(float)
    low,high=np.percentile(values[rgba[:,:,3]>150],[2,97])
    gray=np.clip(92+147*(values-low)/max(1,high-low),55,250).astype(np.uint8)
    rgba[:,:,:3]=gray[:,:,None]
    atlas.paste(Image.fromarray(rgba),(x+4,y+4))


place(photo('plum','purple-leaf-plum.png'), (0,0,512,512))
place(photo('dry-slim-bush2','dry-slim-bush2.png'), (512,0,512,512))
trees=photo('conifers','oga-textures/82657/tree_collection_1k.png')
# All cuts lie in transparent columns between specimens in the original sheet.
for i,(left,right) in enumerate([(2437,2729),(2729,3157),(491,933),(0,491)]):
    place(trees.crop((left,0,right,1024)),(i*256,512,256,512))
atlas.save('src/open/chiome.webp',quality=80,method=6)
