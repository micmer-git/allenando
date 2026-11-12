import { useEffect, useMemo, useState } from 'react';
import { matchSurveyPhotos, nearestPhotoStation, surveyStations, viewDirection, type PhotoAtlas, type PhotoMatch } from '@/open/fotoSopralluogo';
import type { WorldPath } from '@/open/path';
import { worldBase, type WorldData } from '@/open/world';

interface Props {
  data: WorldData;
  path: WorldPath;
  distance: number;
  selectStation(index: number): void;
}

const linkStyle = 'font-semibold text-accent underline underline-offset-2';
const km = (distance: number) => (distance / 1000).toLocaleString('it-IT', {maximumFractionDigits: 2});
const dateFormat = new Intl.DateTimeFormat('it-IT', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});

function PhotoFigure({match, travel, base}: {match: PhotoMatch; travel: number; base: string}) {
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
      <span>{photo.position === 'subject'
        ? <>Soggetto fotografato a {Math.round(off)} m dal punto · posizione della fotocamera sconosciuta</>
        : <>Fotocamera a {Math.round(off)} m dal punto{subjectOff != null && <> · soggetto a {Math.round(subjectOff)} m</>} · {viewDirection(photo.bearing, travel)}</>}</span>
      {photo.derivative && <span className="text-xs text-muted">{photo.derivative.note}</span>}
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

export function FotoSopralluogo({data, path, distance, selectStation}: Props) {
  const base = worldBase(data.graph.id) + 'foto/';
  const [catalog, setCatalog] = useState<{base: string; atlas: PhotoAtlas} | null>(null);
  const [failedBase, setFailedBase] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
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
  const stations = useMemo(() => surveyStations(path, data.toGeo), [path, data]);
  const photos = useMemo(() => atlas ? matchSurveyPhotos(atlas, stations) : [], [atlas, stations]);
  const index = Math.min(stations.length - 1, distance >= path.length ? stations.length - 1 : Math.round(distance / 100));
  const matches = photos[index]?.matches;
  const nearest = useMemo(() => matches?.length || !photos.length ? undefined : nearestPhotoStation(photos, index), [photos, index, matches]);
  if (!atlas) {
    if (failedBase !== base) return null;
    return <p className="text-sm text-muted">Archivio fotografico non disponibile.{' '}
      <button className={linkStyle} onClick={() => { setFailedBase(''); setAttempt(n => n + 1); }}>Riprova</button>
    </p>;
  }
  if (!matches?.length) {
    if (!nearest) return null;
    return <div className="flex flex-wrap items-center gap-x-3 text-sm">
      <span className="text-muted">Nessuna foto associata a questo punto.</span>
      <button className={'min-h-11 ' + linkStyle} onClick={() => { setOpen(true); selectStation(nearest.station); }}>Vai alla foto al km {km(nearest.distance)}</button>
    </div>;
  }
  return <div className="rounded-xl border border-line">
    <button type="button" aria-expanded={open} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm font-semibold text-ink"
      onClick={() => setOpen(v => !v)}>
      <span>{matches.length === 1 ? 'Foto vicino al punto' : `Foto vicino al punto (${matches.length})`}</span>
      <span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <div className="grid gap-5 px-3 pb-3">{matches.map(match =>
      <PhotoFigure key={match.photo.id} match={match} travel={stations[index].bearing} base={base} />)}</div>}
  </div>;
}
