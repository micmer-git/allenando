import { useEffect, useMemo, useState } from 'react';
import { matchSurveyPhotos, nearestPhotoStation, surveyStations, viewDirection, type PhotoAtlas, type PhotoMatch, type SurveyPhoto } from '@/open/fotoSopralluogo';
import { projector, type LatLon } from '@/domain/geo';
import { streetViewUrl, type LoadedRoute } from '@/domain/routes';
import type { Track } from '@/domain/track';
import { worldBase } from '@/open/world';

interface Props {
  base: string;
  path: Pick<Track, 'poseAt'|'length'>;
  toGeo(x: number, z: number): LatLon;
  distance: number;
  selectStation(index: number): void;
  lookAtPhoto?(photo: SurveyPhoto): void;
  gallery?: boolean;
}

const linkStyle = 'font-semibold text-accent underline underline-offset-2';
const km = (distance: number) => (distance / 1000).toLocaleString('it-IT', {maximumFractionDigits: 2});
const dateFormat = new Intl.DateTimeFormat('it-IT', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});

function PhotoFigure({match, travel, base, lookAtPhoto}: {match: PhotoMatch; travel: number; base: string; lookAtPhoto?: Props['lookAtPhoto']}) {
  const {photo, off, subjectOff} = match;
  const [failed, setFailed] = useState(false);
  const image = photo.image.startsWith('https://') ? photo.image : base + photo.image;
  return <figure className="min-w-0 space-y-2">
    {failed
      ? <p role="status" className="rounded-lg bg-elev p-3 text-sm">Immagine non disponibile. Puoi aprire la fonte originale qui sotto.</p>
      : <img src={image} alt={photo.title} loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onError={() => setFailed(true)} className="max-h-[44vh] w-full rounded-lg bg-black object-contain" />}
    <figcaption className="grid gap-1 text-sm">
      <strong>{photo.title}</strong>
      {off > 120 && <span className="text-xs text-muted">Nei dintorni del percorso</span>}
      <span>{photo.position === 'subject'
        ? <>Soggetto fotografato a {Math.round(off)} m dal punto · posizione della fotocamera sconosciuta</>
        : <>Fotocamera a {Math.round(off)} m dal punto{subjectOff != null && <> · soggetto a {Math.round(subjectOff)} m</>} · {viewDirection(photo.bearing, travel)}</>}</span>
      {photo.derivative && <span className="text-xs text-muted">{photo.derivative.note}</span>}
      {lookAtPhoto && (photo.viewTarget || photo.bearing != null || photo.position === 'subject' || photo.subject) &&
        <button type="button" onClick={() => lookAtPhoto(photo)} className={'min-h-11 justify-self-start ' + linkStyle}>
          {photo.viewTarget || photo.subject || photo.position === 'subject' ? 'Guarda il soggetto in 3D' : 'Guarda in 3D nella direzione dello scatto'}
        </button>}
      {!lookAtPhoto && photo.position === 'camera' && <a className={linkStyle} href={streetViewUrl(photo,photo.bearing)} target="_blank" rel="noreferrer">Apri il punto in Street View ↗</a>}
      <span className="text-xs text-muted">
        {photo.date && <>{dateFormat.format(new Date(photo.date + 'T12:00:00Z'))} · </>}
        {photo.author}{photo.credits && <> · {photo.credits}</>} ·{' '}
        <a href={photo.licenseUrl} className={linkStyle} target="_blank" rel="noreferrer">{photo.license}</a>
        {' · '}<a href={photo.source} className={linkStyle} target="_blank" rel="noreferrer">Foto originale ↗</a>
        {photo.positionSource && <>{' · '}<a href={photo.positionSource} className={linkStyle} target="_blank" rel="noreferrer">Posizione del soggetto su OpenStreetMap ↗</a></>}
      </span>
    </figcaption>
  </figure>;
}

export function FotoSopralluogo({base, path, toGeo, distance, selectStation, lookAtPhoto, gallery}: Props) {
  const [catalog, setCatalog] = useState<{base: string; atlas: PhotoAtlas} | null>(null);
  const [failedBase, setFailedBase] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(Boolean(gallery));
  const [chosen, setChosen] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(base + 'atlante-v1.json', {signal: controller.signal})
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<PhotoAtlas>;
      })
      .then(atlas => { if (!controller.signal.aborted) setCatalog({base, atlas}); })
      .catch(() => { if (!controller.signal.aborted) setFailedBase(base); });
    return () => controller.abort();
  }, [base, attempt]);

  const atlas = catalog?.base === base ? catalog.atlas : null;
  const stations = useMemo(() => surveyStations(path, toGeo), [path, toGeo]);
  const photos = useMemo(() => atlas ? matchSurveyPhotos(atlas, stations) : [], [atlas, stations]);
  const choices = useMemo(() => photos.flatMap(s => s.matches.filter(m => !m.photo.id.startsWith('kv-'))
    .map(m => ({photo: m.photo, station: s.station, distance: s.distance}))), [photos]);
  const requested = distance >= path.length ? stations.length - 1 : Math.round(distance / 100);
  const index = gallery && !chosen && choices.length ? choices[0].station : Math.min(stations.length - 1, requested);
  const matches = photos[index]?.matches;
  const nearest = useMemo(() => matches?.length || !photos.length ? undefined : nearestPhotoStation(photos, index), [photos, index, matches]);
  if (!atlas) {
    if (failedBase !== base) return null;
    return <p className="text-sm text-muted">Archivio fotografico non disponibile.{' '}
      <button className={linkStyle} onClick={() => { setFailedBase(''); setAttempt(n => n + 1); }}>Riprova</button>
    </p>;
  }
  if (!matches?.length && !nearest) return null;
  const selected = choices.find(c => c.station === index && c.photo.id === chosen) ?? choices.find(c => c.station === index);
  const selector = choices.length > 0 && <label className="grid gap-1 text-sm font-semibold">
    Foto lungo il percorso
    <select className="survey-control w-full min-w-0" value={selected?.photo.id ?? ''} onChange={e => {
      const pick = choices.find(c => c.photo.id === e.target.value);
      if (pick) { setChosen(pick.photo.id); setOpen(true); selectStation(pick.station); }
    }}>
      <option value="" disabled>Scegli un punto fotografato…</option>
      {[true, false].map(panorama => <optgroup key={String(panorama)} label={panorama ? 'Panorami' : 'Luoghi lungo la strada'}>
        {choices.filter(c => Boolean(c.photo.panorama) === panorama).map(c => <option key={c.photo.id} value={c.photo.id}>
          Km {km(c.distance)} · {c.photo.title}
        </option>)}
      </optgroup>)}
    </select>
  </label>;
  return <div className="grid min-w-0 gap-2">{selector}
    {!matches?.length && nearest ? <div className="flex flex-wrap items-center gap-x-3 text-sm">
      <span className="text-muted">Nessuna foto associata a questo punto.</span>
      <button className={'min-h-11 ' + linkStyle} onClick={() => { setOpen(true); selectStation(nearest.station); }}>Vai alla foto al km {km(nearest.distance)}</button>
    </div> : <div className="rounded-xl border border-line">
    <button type="button" aria-expanded={open} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm font-semibold text-ink"
      onClick={() => setOpen(v => !v)}>
      <span>{matches?.length === 1 ? 'Foto vicino al punto' : `Foto vicino al punto (${matches?.length ?? 0})`}</span>
      <span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <div className="grid gap-5 px-3 pb-3">{[...(matches ?? [])].sort((a,b) =>
      Number(b.photo.id === selected?.photo.id) - Number(a.photo.id === selected?.photo.id)).map(match =>
      <PhotoFigure key={match.photo.id} match={match} travel={stations[index].bearing} base={base} lookAtPhoto={lookAtPhoto} />)}</div>}
    </div>}
  </div>;
}

export function FotoSalita({route}: {route: LoadedRoute}) {
  const [station, selectStation] = useState(0);
  const geo = useMemo(() => projector(route.origin), [route.origin]);
  const base = route.id === 'selvino-nembro' ? worldBase('bergamo') + 'foto/' : import.meta.env.BASE_URL + 'routes/foto/';
  return <FotoSopralluogo base={base} path={route.track} toGeo={geo.toGeo} distance={Math.min(route.track.length, station*100)}
    selectStation={selectStation} gallery />;
}
