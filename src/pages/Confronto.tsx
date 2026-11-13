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

const none = () => null;
const control = 'min-h-11 max-w-full rounded-xl border border-line bg-elev px-3 text-sm text-ink';

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
  return <main className="flex min-h-dvh flex-col bg-bg text-ink">
    <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 md:flex">
      <Link to={'/?dove=lista&world=' + world.id} className="inline-flex min-h-11 items-center font-semibold text-accent">‹ Mappa</Link>
      <h1 className="font-display text-2xl uppercase md:mr-auto">Sopralluogo 3D</h1>
      <div className="col-span-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 md:flex">
        <select aria-label="Mondo" value={world.id} className={control+' min-w-0'} onChange={e => set({world:e.target.value})}>
          {WORLDS.map(w => <option key={w.id} value={w.id}>{worldInfo(w.id).short}</option>)}
        </select>
        {ride && current && <select aria-label="Percorso" value={point ? '' : ride.id} className={control+' min-w-0'} onChange={e => set({world:world.id,ride:e.target.value})}>
          {point && <option value="">{street && (street.name || street.ref) || 'Punto sulla mappa'}</option>}
          {current.rides.map(r => <option key={r.id} value={r.id}>{r.name} · {r.side}</option>)}
        </select>}
      </div>
    </header>
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
  const start = path.edgeAt(distance);
  const pose = path.poseAt(distance), geo = data.toGeo(pose.x, pose.z);
  const orientation = useRef<SurveyAngles>(FORWARD);
  const [angles,setAngles] = useState<SurveyAngles>(FORWARD);
  const direction = sightLine(pose,angles);
  const url = streetViewUrl(geo,headingToBearing(direction.heading),direction.pitch * 180 / Math.PI);
  const here = stops.filter(s=>s.station===index);
  const stop = landmark ?? here.find(s=>s.kind==='Arte lungo la strada') ?? here[0];
  const groups:SurveyStop['kind'][]=['Arte lungo la strada','Luoghi','Tornanti dei campioni'];
  useEffect(()=>{
    if(!landmark) return;
    const p=path.poseAt(landmark.viewAt ?? landmark.station*100);
    const target=landmark.target;
    const dir=target && Math.hypot(target.x-p.x,target.z-p.z)>1
      ? Math.atan2(target.x-p.x,target.z-p.z) : p.heading;
    const range=target?Math.hypot(target.x-p.x,target.z-p.z):0;
    const pitch=landmark.heightOffset!=null && range>1
      ? (Math.atan2(landmark.heightOffset,range)-Math.atan(p.grade))*180/Math.PI : 0;
    orientation.current = {yaw:wrapYaw((p.heading-dir)*180/Math.PI),pitch};
    setAngles({...orientation.current});
  },[path,landmark]);
  const changed = () => setAngles({...orientation.current});
  const reset = () => { orientation.current=FORWARD; changed(); };
  const [ready, setReady] = useState(false);
  return <>
    <div className="relative h-[48dvh] min-h-52 md:h-[56dvh]">
      <SurveyViewport orientation={orientation} changed={changed}>
        <WorldScene preview={() => orientation.current} data={data} terrain={terrain} field={field} path={path} quality="medium"
          engine={{distance, speed:0, cadence:0, power:0}} crowd={crowd} remote={[]} nextTurn={none}
          playerPose={() => pose} onReady={() => setReady(true)} weather={null} daytime="mezzogiorno" ride={null} />
      </SurveyViewport>
      {(angles.yaw !== 0 || angles.pitch !== 0) && <button className="absolute right-3 top-3 min-h-11 rounded-xl bg-black/75 px-3 text-sm text-white" onClick={reset}>Guarda la strada</button>}
      {!ready && <span className="pointer-events-none absolute left-4 top-4 rounded bg-black/70 px-2 py-1 text-sm text-white" role="status">Carico il paesaggio…</span>}
    </div>
    <div className="mx-auto grid w-full max-w-4xl gap-2 px-4 pb-6 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <strong className="num text-xl">{(distance/1000).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})} km</strong>
        <span className="num text-sm text-muted">{Math.round(pose.altitude)} m s.l.m.</span>
      </div>
      <div className="flex items-center gap-3">
        <button className={control+' shrink-0 disabled:opacity-40'} disabled={!index} onClick={() => select(index-1)}>−100 m</button>
        <input className="h-11 min-w-0 flex-1 accent-[var(--accent)]" aria-label="Punto sul percorso" type="range" min={0} max={max} value={index} onChange={e => select(Number(e.target.value))} />
        <button className={control+' shrink-0 disabled:opacity-40'} disabled={index===max} onClick={() => select(index+1)}>+100 m</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-line pb-2">
        <Link to={pedalaFromPoint({ kind: 'libero', world: data.graph.id, edge: start.edge, s: start.s, dir: start.dir })} className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 font-semibold text-accent-ink" data-testid="sopralluogo-pedala">Prepara il giro da qui</Link>
        <a className="inline-flex min-h-11 items-center font-semibold text-accent" href={url} target="_blank" rel="noreferrer">Street View ↗</a>
      </div>
      {stops.length > 0 && <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
        Vai a un luogo
        <select className={control} aria-label="Luogo lungo il percorso" value={stop?.id ?? ''} onChange={e=>{
          const selected=stops.find(s=>s.id===e.target.value); if(selected) select(selected.station,selected.id);
        }}>
          <option value="">Scegli lungo la strada…</option>
          {groups.map(group=>stops.some(s=>s.kind===group) && <optgroup key={group} label={group}>{stops.filter(s=>s.kind===group).map(s=><option key={s.id} value={s.id}>{s.name} · {(s.station/10).toLocaleString('it-IT')} km</option>)}</optgroup>)}
        </select>
      </label>}
      {stop?.plate && <div role="img" aria-label={stop.name} className="h-[126px] w-[90px] rounded-sm" style={{
        backgroundImage:'url('+worldBase('bergamo')+'campioni-v1/targhe.webp)',backgroundSize:'500% 400%',
        backgroundPosition:((stop.plate-1)%5)*25+'% '+Math.floor((stop.plate-1)/5)*100/3+'%'
      }} />}
      {stop?.note && <p className="text-sm">{stop.note} {stop.source && <a className="font-semibold text-accent underline" href={stop.source} target="_blank" rel="noreferrer">Vedi l’originale ↗</a>}</p>}
      <TerrenoPercorso terrain={terrain} pose={pose} edge={data.graph.edges[path.edgeAt(distance).edge]} />
      {stop?.id==='palazzo-roncalli' && <p className="text-xs text-muted">Facciata fotografata da <a href="https://commons.wikimedia.org/?curid=43474545" className="underline">Sailko</a>, ritagliata e raddrizzata · <a href="https://creativecommons.org/licenses/by/3.0/" className="underline">CC BY 3.0</a>.</p>}
      <FotoSopralluogo data={data} path={path} distance={distance} selectStation={select} />
      <p className="text-xs text-muted">Street View apre il panorama disponibile più vicino. Terreno: ortofoto © AGEA (voli 2023–2024) e ESA WorldCover / Copernicus Sentinel-2 (2021), colori rielaborati · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Targhe di Selvino: foto © Amadvance, ritaglio e prospettiva · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Strade e arredi: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>.</p>
    </div>
  </>;
}
