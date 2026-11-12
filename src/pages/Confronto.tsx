import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { headingToBearing, streetViewUrl } from '@/domain/routes';
import { createWorldField } from '@/open/field';
import { NpcCrowd } from '@/open/npc';
import { WorldPath } from '@/open/path';
import { loadWorld, Terrain, WORLDS, type RideDef, type WorldData } from '@/open/world';
import { FORWARD, sightLine, surveyStops, type SurveyAngles } from '@/open/sopralluogo';
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
  const ride = current?.rides.find(r => r.id === params.get('ride')) ?? current?.rides[0];
  return <main className="flex min-h-dvh flex-col bg-bg text-ink">
    <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
      <Link to="/" className="font-display text-xl text-accent">OROBIA</Link>
      <h1 className="mr-auto font-display text-xl uppercase">Sopralluogo 3D</h1>
      <select aria-label="Mondo" value={world.id} className={control} onChange={e => set({world:e.target.value})}>
        {WORLDS.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {ride && current && <select aria-label="Percorso" value={ride.id} className={control} onChange={e => set({world:world.id,ride:e.target.value})}>
        {current.rides.map(r => <option key={r.id} value={r.id}>{r.name} · {r.side}</option>)}
      </select>}
    </header>
    {current && ride ? <Survey key={world.id} data={current} ride={ride} station={Number(params.get('punto'))}
      select={n => { const q=new URLSearchParams(params); q.set('world',world.id); q.set('ride',ride.id); q.set('punto',String(n)); set(q,{replace:true}); }} /> :
      <p role="status" className="p-4">{error ? 'Il mondo non è disponibile. Riprova con la rete attiva.' : 'Carico il percorso…'}</p>}
  </main>;
}

function Survey({data, ride, station, select}: {data: WorldData; ride: RideDef; station: number; select: (n: number) => void}) {
  const path = useMemo(() => {
    const [[edge, dir], ...rest] = ride.legs;
    const path = new WorldPath(data.graph, {edge, dir, s:dir === 1 ? 0 : data.graph.edges[edge].length});
    for (const [id, direction] of rest) path.append(id, direction);
    return path;
  }, [data, ride]);
  const terrain = useMemo(() => new Terrain(data.graph), [data]);
  const field = useMemo(() => createWorldField(data.graph, terrain, data.features), [data, terrain]);
  const crowd = useMemo(() => new NpcCrowd(data.graph, 0), [data]);
  const max = Math.ceil(path.length / 100);
  const index = Number.isFinite(station) ? Math.min(max, Math.max(0, Math.round(station))) : 0;
  const distance = Math.min(path.length, index * 100);
  const pose = path.poseAt(distance), geo = data.toGeo(pose.x, pose.z);
  const orientation = useRef<SurveyAngles>(FORWARD);
  const [angles,setAngles] = useState<SurveyAngles>(FORWARD);
  const direction = sightLine(pose,angles);
  const url = streetViewUrl(geo,headingToBearing(direction.heading),direction.pitch * 180 / Math.PI);
  const stops = useMemo(() => surveyStops(ride,data),[ride,data]);
  const stop = stops.find(s => s.station === index);
  const changed = () => setAngles({...orientation.current});
  const reset = () => { orientation.current=FORWARD; changed(); };
  const [ready, setReady] = useState(false);
  return <>
    <div className="relative h-[56dvh] min-h-64 flex-1" style={{flexBasis:'56dvh'}}>
      <SurveyViewport orientation={orientation} changed={changed}>
        <WorldScene preview={() => orientation.current} data={data} terrain={terrain} field={field} path={path} quality="medium"
          engine={{distance, speed:0, cadence:0, power:0}} crowd={crowd} remote={[]} nextTurn={none}
          playerPose={() => pose} onReady={() => setReady(true)} weather={null} daytime="mezzogiorno" ride={null} />
      </SurveyViewport>
      {(angles.yaw !== 0 || angles.pitch !== 0) && <button className="absolute right-3 top-3 min-h-11 rounded-xl bg-black/75 px-3 text-sm text-white" onClick={reset}>Guarda la strada</button>}
      {!ready && <span className="pointer-events-none absolute left-4 top-4 rounded bg-black/70 px-2 py-1 text-sm text-white" role="status">Carico il paesaggio…</span>}
    </div>
    <div className="mx-auto grid w-full max-w-4xl gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="num">{stop && stop.name + ' · '}{(distance/1000).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})} km · {Math.round(pose.y)} m s.l.m.</strong>
        <a className="inline-flex min-h-11 items-center font-semibold text-accent" href={url} target="_blank" rel="noreferrer">Apri Street View ↗</a>
      </div>
      <div className="flex items-center gap-3">
        <button className={control+' shrink-0 disabled:opacity-40'} disabled={!index} onClick={() => select(index-1)}>−100 m</button>
        <input className="min-w-0 flex-1 accent-yellow-400" aria-label="Punto sul percorso" type="range" min={0} max={max} value={index} onChange={e => select(Number(e.target.value))} />
        <button className={control+' shrink-0 disabled:opacity-40'} disabled={index===max} onClick={() => select(index+1)}>+100 m</button>
      </div>
      {stops.length > 0 && <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
        Vai a un luogo
        <select className={control} aria-label="Luogo lungo il percorso" value={stop?.id ?? ''} onChange={e=>{
          const selected=stops.find(s=>s.id===e.target.value); if(selected) { reset(); select(selected.station); }
        }}>
          <option value="">Scegli lungo la strada…</option>
          {stops.map(s=><option key={s.id} value={s.id}>{s.name} · {(s.station/10).toLocaleString('it-IT')} km</option>)}
        </select>
      </label>}
      <p className="text-xs text-muted">Street View apre il panorama disponibile più vicino. Terreno: ortofoto © AGEA (voli 2023–2024) e ESA WorldCover / Copernicus Sentinel-2 (2021), colori rielaborati · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Strade e arredi: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>.</p>
    </div>
  </>;
}
