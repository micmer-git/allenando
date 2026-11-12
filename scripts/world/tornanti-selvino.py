"""Ritaglia le targhe della Nembro–Selvino per l'atlante CC BY-SA 4.0 (OpenCV, Pillow, requests).
Il JSON di ingresso è un elenco [idNodoOSM, lat, lon, tag] da un estratto OSM.
Le coordinate dei quattro angoli sono frazioni dell'immagine sorgente (ordine orario da sinistra in alto).
"""
import argparse, hashlib, json, re, time
from pathlib import Path
import cv2, numpy as np, requests
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
cache = root/'scripts/world/cache/tornanti-selvino'
out = root/'public/world/bergamo/campioni-v1'
cache.mkdir(parents=True, exist_ok=True)
out.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('nodes', type=Path)
parser.add_argument('--review', type=Path)
args = parser.parse_args()
nodes = [r for r in json.loads(args.nodes.read_text(encoding='utf-8')) if re.match(r'Tornante \d+',r[3].get('name','')) and 'wikimedia_commons' in r[3]]
nodes.sort(key=lambda r:int(re.search(r'\d+',r[3]['name'])[0]))
assert len(nodes)==19
headers={'User-Agent':'OROBIA/1.0 (https://github.com/micmer-git/allenando)'}
def fetch_one(row):
    nid,lat,lon,tags=row
    name=tags['wikimedia_commons'][5:].replace(' ','_')
    target=cache/name
    if not target.exists():
        md=hashlib.md5(name.encode()).hexdigest()
        url=f'https://upload.wikimedia.org/wikipedia/commons/thumb/{md[0]}/{md[:2]}/{name}/960px-{name}'
        for pause in (7, 35, 75):
            time.sleep(pause)
            r=requests.get(url,headers=headers,timeout=45)
            if r.status_code != 429: break
            retry = r.headers.get('Retry-After', '')
            if retry.isdigit(): time.sleep(int(retry))
        r.raise_for_status()
        target.write_bytes(r.content)
    return cv2.imread(str(target))
photos=list(map(fetch_one,nodes))
titles='|'.join(r[3]['wikimedia_commons'] for r in nodes)
r=requests.get('https://commons.wikimedia.org/w/api.php',params=dict(action='query',format='json',titles=titles,prop='imageinfo',iiprop='extmetadata'),headers=headers,timeout=35)
r.raise_for_status()
for page in r.json()['query']['pages'].values():
    m=page['imageinfo'][0]['extmetadata']
    assert m['LicenseShortName']['value']=='CC BY-SA 4.0' and 'Amadvance' in m['Artist']['value'],page['title']
overrides_path=Path(__file__).with_name('tornanti-angoli.json')
overrides=json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
plates=[]
metadata=[]
for i,(src,row) in enumerate(zip(photos,nodes),1):
    h,w=src.shape[:2]
    if str(i) in overrides:
        pts=np.array(overrides[str(i)],dtype='float32')*[w,h]
    else:
        hsv=cv2.cvtColor(src,cv2.COLOR_BGR2HSV)
        mask=((hsv[:,:,1]>48)&(hsv[:,:,0]%180<13)|(hsv[:,:,1]>48)&(hsv[:,:,0]>168)).astype('uint8')*255
        mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
        contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        candidates=[]
        for c in contours:
            hull=cv2.convexHull(c)
            area=cv2.contourArea(hull)
            if area < w*h*.005: continue
            for tol in (.015,.025,.04,.06,.08):
                poly=cv2.approxPolyDP(hull,tol*cv2.arcLength(hull,True),True)
                if len(poly)==4:
                    candidates.append((area,poly[:,0,:]));break
        if not candidates: pts=np.array([[0,0],[w,0],[w,h],[0,h]])
        else:
            q=max(candidates,key=lambda v:v[0])[1]
            pts=np.array([q[np.argmin(q.sum(1))], q[np.argmax(q[:,0]-q[:,1])], q[np.argmax(q.sum(1))],q[np.argmin(q[:,0]-q[:,1])]])
    tw,th=240,336
    mat=cv2.getPerspectiveTransform(np.float32(pts),np.float32([[0,0],[tw-1,0],[tw-1,th-1],[0,th-1]]))
    rect=cv2.warpPerspective(src,mat,(tw,th),flags=cv2.INTER_AREA)
    plates.append(Image.fromarray(cv2.cvtColor(rect,cv2.COLOR_BGR2RGB)))
    nid,lat,lon,tags=row
    name=re.sub(r'^Tornante \d+\s*[-(]?\s*','',tags['name']).rstrip(')')
    metadata.append(dict(n=i,node=nid,lat=lat,lon=lon,name=name,alt=int(tags['ele']),image=tags['wikimedia_commons'][5:]))
atlas=Image.new('RGB',(tw*5,th*4),(74,64,61))
for i,im in enumerate(plates): atlas.paste(im,(i%5*tw,i//5*th))
atlas.save(out/'targhe.webp',quality=86,method=6)
(out/'cartelli.json').write_text(json.dumps({'artist':'Amadvance','license':'https://creativecommons.org/licenses/by-sa/4.0/','modification':'Ritaglio e correzione prospettica','signs':metadata},ensure_ascii=False,indent=1),encoding='utf-8')
if args.review:
    atlas.thumbnail((700,810))
    atlas.save(args.review)

