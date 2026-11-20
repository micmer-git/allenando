import { CameraControls } from '@/components/CameraControls';
import { ISO_ZOOM, type RideView } from '@/world/isometric';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { headingToBearing, streetViewUrl } from '@/domain/routes';
import { createWorldField } from '@/open/field';
import { NpcCrowd } from '@/open/npc';
import { pedalaFromPoint, roadStart, type FreeStart } from '@/open/partenze';
import { intentoDaSearch } from '@/ride/intento';
import { WorldPath } from '@/open/path';
import { worldInfo } from '@/open/worlds';
import { loadWorld, Terrain, worldBase, WORLDS, type RideDef, type WorldData } from '@/open/world';
import { FORWARD, sightLine, wrapYaw, type SurveyAngles } from '@/open/sopralluogo';
import { FotoSopralluogo } from '@/components/FotoSopralluogo';
import { luoghiPercorso, type SurveyStop } from '@/open/luoghiPercorso';
import { TerrenoPercorso } from './TerrenoPercorso';
import { SurveyViewport } from './SurveyViewport';
import { WorldScene } from '@/open/WorldScene';
import { Wordmark } from '@/components/ui';
import { ProfileChart, RouteMap } from '@/components/RouteViz';
import { formatGrade, formatKm } from '@/domain/format';

const none = () => null;
const control = 'survey-control';

export default function Confronto() {
  const [params, set] = useSearchParams();
  const world = WORLDS.find(w => w.id === params.get('world')) ?? WORLDS[0];
  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setError(false);
    loadWorld(world.id).then(d => { if (active) setData(d); }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [world.id]);
  const current = data?.graph.id === world.id ? data : null;
  const requested = intentoDaSearch(params)?.dove;
  const point = current && requested?.kind === 'libero' ? roadStart(current.graph, requested.edge, requested.s, requested.dir) : null;
  const street = point && current?.graph.edges[point.edge];
  const ride = current?.rides.find(r => r.id === params.get('ride')) ?? current?.rides[0];
  return <main className="survey-page">
    <header className="survey-header">
      <Wordmark />
      <h1 className="survey-section-title">Sopralluogo 3D</h1>
      <Link to={'/?dove=lista&world=' + world.id} className="survey-back">← Mappa</Link>
    </header>
      <div className="survey-selectors">
        <select aria-label="Mondo" value={world.id} className={control+' min-w-0'} onChange={e => set({world:e.target.value})}>
          {WORLDS.map(w => <option key={w.id} value={w.id}>{worldInfo(w.id).short}</option>)}
        </select>
        {ride && current && <select aria-label="Percorso" value={point ? '' : ride.id} className={control+' min-w-0'} onChange={e => set({world:world.id,ride:e.target.value})}>
          {point && <option value="">{street && (street.name || street.ref) || 'Punto sulla mappa'}</option>}
          {current.rides.map(r => <option key={r.id} value={r.id}>{r.name} · {r.side}</option>)}
        </select>}
      </div>
    {current && params.has('edge') && !point ? <p role="status" className="p-4">Questo punto non si trova sulla rete stradale del mondo selezionato.</p> : current && ride ? <Survey key={world.id+'-'+(point ? [point.edge,point.s,point.dir].join('-') : ride.id)} data={current} ride={ride} point={point} place={params.get('luogo')} station={Number(params.get('punto'))}
      select={(n,place) => { const q=new URLSearchParams(params); if(place) q.set('luogo',place); else q.delete('luogo'); q.set('world',world.id); if (!point) q.set('ride',ride.id); q.set('punto',String(n)); set(q,{replace:true}); }} /> :
      <p role="status" className="p-4">{error ? 'Il mondo non è disponibile. Riprova con la rete attiva.' : 'Carico il percorso…'}</p>}
  </main>;
}

function Survey({data, ride, point, place, station, select}: {data: WorldData; ride: RideDef; point: FreeStart | null; place:string|null; station: number; select: (n: number, place?:string) => void}) {
  const edge = point?.edge, dir = point?.dir, s = point?.s;
  const path = useMemo(() => {
    if (edge !== undefined && dir !== undefined && s !== undefined) return new WorldPath(data.graph, {edge, dir, s});
    const [[first, forward], ...rest] = ride.legs;
    const path = new WorldPath(data.graph, {edge:first, dir:forward, s:forward === 1 ? 0 : data.graph.edges[first].length});
    for (const [id, direction] of rest) path.append(id, direction);
    return path;
  }, [data, ride, edge, dir, s]);
  const terrain = useMemo(() => new Terrain(data.graph), [data]);
  const field = useMemo(() => createWorldField(data.graph, terrain, data.features), [data, terrain]);
  const crowd = useMemo(() => new NpcCrowd(data.graph, 0), [data]);
  const max = Math.ceil(path.length / 100);
  const stops = useMemo(() => luoghiPercorso(data,edge === undefined ? ride : null,path),[ride,edge,data,path]);
  const landmark=stops.find(s=>s.id===place);
  const index = landmark?.station ?? (Number.isFinite(station) ? Math.min(max, Math.max(0, Math.round(station))) : 0);
  const distance = landmark?.viewAt ?? Math.min(path.length, index * 100);
  const [camera, setCamera] = useState<RideView | 'strada'>('iso');
  const [viewpoint, setViewpoint] = useState<{station:number; x:number; z:number; y:number; photographed:boolean} | null>(null);
  const [zoom, setZoom] = useState(2);
  const detail = camera === 'strada' ? landmark?.detailRoad : undefined;
  const start = detail ?? path.edgeAt(distance);
  const onRoute = path.poseAt(distance);
  const streetPose = detail && data.graph.pose(detail.edge,detail.s,detail.dir);
  const fromPhoto = camera === 'strada' && !landmark && viewpoint?.station === index ? viewpoint : null;
  const pose = fromPhoto ? {...onRoute, x:fromPhoto.x, z:fromPhoto.z, y:fromPhoto.y, altitude:fromPhoto.y} :
    streetPose ? { ...onRoute,...streetPose,altitude:streetPose.y } : onRoute;
  const geo = data.toGeo(pose.x, pose.z);
  const orientation = useRef<SurveyAngles>(FORWARD);
  const stage = useRef<HTMLDivElement>(null);
  const [angles,setAngles] = useState<SurveyAngles>(FORWARD);
  const direction = sightLine(pose,angles);
  const url = streetViewUrl(geo,headingToBearing(direction.heading),direction.pitch * 180 / Math.PI);
  const here = stops.filter(s=>s.station===index);
  const stop = landmark ?? here.find(s=>s.kind==='Arte lungo la strada') ?? here[0];
  const groups:SurveyStop['kind'][]=['Arte lungo la strada','Luoghi','Tornanti dei campioni'];
  useEffect(()=>{
    if(!landmark) return;
    if(landmark.target) setCamera('strada');
    const near = landmark.detailRoad;
    const p = near ? data.graph.pose(near.edge, near.s, near.dir) : path.poseAt(landmark.viewAt ?? landmark.station*100);
    const target=landmark.target;
    const dir=target && Math.hypot(target.x-p.x,target.z-p.z)>1
      ? Math.atan2(target.x-p.x,target.z-p.z) : p.heading;
    const range=target?Math.hypot(target.x-p.x,target.z-p.z):0;
    const pitch=landmark.heightOffset!=null && range>1
      ? (Math.atan2(landmark.heightOffset,range)-Math.atan(p.grade))*180/Math.PI : 0;
    orientation.current = {yaw:wrapYaw((p.heading-dir)*180/Math.PI),pitch};
    setAngles({...orientation.current});
  },[data,path,landmark]);
  const changed = () => setAngles({...orientation.current});
  const reset = () => { setViewpoint(null); orientation.current=FORWARD; changed(); };
  const move = (n:number, id?:string) => { if (viewpoint) reset(); select(n,id); };
  const [ready, setReady] = useState(false);
  const road = data.graph.edges[start.edge];
  return <div className="survey-layout">
    <div className="survey-stage" ref={stage}>
      <SurveyViewport orientation={orientation} changed={changed}>
        <WorldScene preview={() => orientation.current} surveyCamera={camera} magnification={ISO_ZOOM[zoom]} data={data} terrain={terrain} field={field} path={path} quality="medium"
          engine={{distance, speed:0, cadence:0, power:0}} crowd={crowd} remote={[]} nextTurn={none}
          playerPose={() => pose} onReady={() => setReady(true)} weather={null} daytime="mezzogiorno" ride={null} />
      </SurveyViewport>
      <div className="survey-locator" aria-label="Posizione sul percorso"><RouteMap track={path} position={distance} /></div>
      {(fromPhoto || angles.yaw !== 0 || angles.pitch !== 0) && <button className="survey-recenter" onClick={reset}>Guarda la strada</button>}
      {!ready && <span className="survey-loading" role="status">Carico il paesaggio…</span>}
      {ready && (fromPhoto || road.name || road.ref) && <div className="survey-road"><span aria-hidden="true" />{detail && 'Affaccio · '}{fromPhoto ? (fromPhoto.photographed ? 'Dal punto di scatto' : 'Dalla strada vicina al soggetto') : road.name || road.ref}</div>}
    </div>
    <section className="survey-instruments" aria-label="Controlli del percorso">
      <CameraControls view={camera} change={v => { setCamera(v); reset(); }} zoom={zoom} setZoom={setZoom} survey />
      <div className="survey-km">
        <span className="survey-caption">Posizione sul percorso</span>
        <strong className="num">{formatKm(distance)} <small>km</small></strong>
      </div>
      <div className="survey-facts">
        <div><span className="survey-caption">Quota</span><strong className="num">{Math.round(pose.altitude)} <small>m</small></strong></div>
        <div><span className="survey-caption">Pendenza</span><strong className="num">{formatGrade(pose.grade)}</strong></div>
      </div>
      <div className="survey-profile">
        <ProfileChart track={path} position={distance} bin={Math.max(100,path.length/95)} height={62} className="h-full w-full" />
      </div>
      <div className="survey-range">
        <button className={control+' shrink-0 disabled:opacity-40'} disabled={!index} onClick={() => move(index-1)}>−100 m</button>
        <input className="h-11 min-w-0 flex-1 accent-[var(--accent)]" aria-label="Punto sul percorso" type="range" min={0} max={max} value={index} onChange={e => move(Number(e.target.value))} />
        <button className={control+' shrink-0 disabled:opacity-40'} disabled={index===max} onClick={() => move(index+1)}>+100 m</button>
      </div>
      {stops.length > 0 && <label className="survey-place">
        <span className="survey-caption">Vai a un luogo</span>
        <select className={control} aria-label="Luogo lungo il percorso" value={landmark?.id ?? ''} onChange={e=>{
          const selected=stops.find(s=>s.id===e.target.value); if(selected) move(selected.station,selected.id);
        }}>
          <option value="">Scegli lungo la strada…</option>
          {groups.map(group=>stops.some(s=>s.kind===group) && <optgroup key={group} label={group}>{stops.filter(s=>s.kind===group).map(s=><option key={s.id} value={s.id}>{s.name} · {(s.station/10).toLocaleString('it-IT')} km</option>)}</optgroup>)}
        </select>
      </label>}
      <div className="survey-actions">
        <Link to={pedalaFromPoint({ kind: 'libero', world: data.graph.id, edge: start.edge, s: start.s, dir: start.dir })} className="survey-start" data-testid="sopralluogo-pedala">Prepara il giro da qui <span aria-hidden="true">→</span></Link>
        <a className="survey-street" href={url} target="_blank" rel="noreferrer">Street View ↗</a>
      </div>
    </section>
    <div className="survey-notes">
      {stop?.plate && <div role="img" aria-label={stop.name} className="h-[126px] w-[90px] rounded-sm" style={{
        backgroundImage:'url('+worldBase('bergamo')+'campioni-v1/targhe.webp)',backgroundSize:'500% 400%',
        backgroundPosition:((stop.plate-1)%5)*25+'% '+Math.floor((stop.plate-1)/5)*100/3+'%'
      }} />}
      {stop?.note && <p className="text-sm">{stop.note} {stop.source && <a className="font-semibold text-accent underline" href={stop.source} target="_blank" rel="noreferrer">Vedi l’originale ↗</a>}</p>}
      <TerrenoPercorso terrain={terrain} pose={pose} edge={data.graph.edges[path.edgeAt(distance).edge]} />
      {stop?.id==='palazzo-roncalli' && <p className="text-xs text-muted">Facciata fotografata da <a href="https://commons.wikimedia.org/?curid=43474545" className="underline">Sailko</a>, ritagliata e raddrizzata · <a href="https://creativecommons.org/licenses/by/3.0/" className="underline">CC BY 3.0</a>.</p>}
      <FotoSopralluogo base={worldBase(data.graph.id)+'foto/'} path={path} toGeo={data.toGeo} distance={distance} selectStation={move}
        lookAtPhoto={photo => {
          const peak = photo.viewTarget ? data.features.landmarks.find(l => l.id === photo.viewTarget) : undefined;
          const subject = photo.position === 'subject' ? photo : photo.subject;
          const target = peak ?? (subject && data.proj.toLocal(subject));
          const photographed = photo.position === 'camera';
          const near = !photographed && target ? data.graph.nearest(target.x,target.z,65) : null;
          const nearbyRoad = near && data.graph.pose(near.edge,near.s);
          const at = nearbyRoad || (photographed && (photo.panorama || photo.subject) ? data.proj.toLocal(photo) : onRoute);
          const eyeY = nearbyRoad?.y ?? (at === onRoute ? onRoute.y : field.height(at.x,at.z,4));
          setViewpoint(at === onRoute ? null : {...at,y:eyeY,station:index,photographed});
          const dir = target ? Math.atan2(target.x-at.x, target.z-at.z)
            : Math.PI - (photo.bearing ?? 0)*Math.PI/180;
          const elevation = target ? Math.atan2((peak?.y ?? field.height(target.x,target.z,4)+2)-eyeY-1.65, Math.hypot(target.x-at.x, target.z-at.z)) : 0;
          orientation.current = {yaw:wrapYaw((onRoute.heading-dir)*180/Math.PI), pitch:(elevation-Math.atan(onRoute.grade))*180/Math.PI};
          if (landmark) select(index);
          setCamera('strada');
          changed();
          stage.current?.scrollIntoView({block:'center'});
        }} />
      <details className="survey-sources"><summary>Fonti e attribuzioni</summary><p className="text-xs text-muted">Terreno da ortofoto © AGEA (voli 2023–2024) ed ESA WorldCover / Copernicus Sentinel-2 (2021), colori rielaborati · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Targhe di Selvino da foto © Amadvance, ritaglio e prospettiva · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Strade e arredi © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>.</p></details>
    </div>
  </div>;
}
