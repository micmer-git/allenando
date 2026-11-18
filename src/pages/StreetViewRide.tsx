import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GAZZANIGA, importLibrary, loadStreet, locate, lookup } from '@/ride/streetGoogle';
import { StreetRide, turnAngle, type Panorama } from '@/ride/streetNavigation';
import { Foglio } from './pedala/Foglio';

const control = 'min-h-11 rounded-full bg-elev px-4 text-sm font-semibold text-ink';
const noRoad = 'Nessuna strada Street View collegata qui. Scegli un altro punto.';
let tabKey = '';

function JumpMap({ center, choose }: { center: google.maps.LatLngLiteral; choose: (p: google.maps.LatLngLiteral) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let listener: google.maps.MapsEventListener | undefined;
    const element = host.current!;
    void importLibrary('maps').then(({ Map }) => {
      if (!active) return;
      const map = new Map(element, { center, zoom: 12, streetViewControl: false, fullscreenControl: false, mapTypeControl: false });
      listener = map.addListener('click', (e: google.maps.MapMouseEvent) => { if (e.latLng) choose(e.latLng.toJSON()); });
    }).catch(() => active && setError(true));
    return () => { active = false; listener?.remove(); element.replaceChildren(); };
  }, [center, choose]);
  return error ? <p role="status">Mappa non disponibile. Inserisci una strada o le coordinate.</p> : <div ref={host} className="h-52 rounded-xl" aria-label="Tocca una strada per raggiungerla" />;
}

export function StreetViewRide({ ride, odometer, onReady }: { ride: StreetRide; odometer: number; onReady: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<google.maps.StreetViewPanorama | null>(null);
  const service = useRef<google.maps.StreetViewService | null>(null);
  const metres = useRef(odometer);
  metres.current = odometer;
  const [key, setKey] = useState<string>(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || tabKey);
  const [keyInput, setKeyInput] = useState('');
  const [attempt, retry] = useState(0);
  const [scene, setScene] = useState<Panorama | null>(null);
  const [selected, select] = useState('');
  const [next, setNext] = useState<Panorama | null>(null);
  const [error, setError] = useState('');
  const [stepError, setStepError] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [mapCenter, setMapCenter] = useState(GAZZANIGA);
  const generation = useRef(0);
  const show = useCallback((place: Panorama) => {
    viewer.current?.setPano(place.id);
    viewer.current?.setPov({ heading: ride.heading, pitch: 0 });
    select(ride.exits[0]?.id ?? '');
    setScene(place);
    setNext(null);
    setStepError(false);
    onReady();
  }, [onReady, ride]);

  const jump = useCallback(async (where: string | google.maps.LatLngLiteral) => {
    const api = service.current;
    if (!api) return;
    const token = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const point = typeof where === 'string' ? await locate(where) : where;
      if (token !== generation.current) return;
      setMapCenter(point);
      const place = await lookup(api, { location: point, radius: 350, sources: [google.maps.StreetViewSource.OUTDOOR], preference: google.maps.StreetViewPreference.NEAREST });
      if (token !== generation.current) return;
      // Direzione di via Marconi verso Orezzo all'imbocco della salita.
      const heading = where === GAZZANIGA ? 256 : 0;
      if (!ride.jump(place, metres.current, heading)) { setError(noRoad); return; }
      ride.heading = ride.exits[0].heading;
      show(place);
      setJumpOpen(false);
    } catch (reason) {
      if (token === generation.current) setError(String(reason).includes('ZERO_RESULTS') ? noRoad : 'Ricerca non riuscita. Verifica rete e chiave Google o prova le coordinate.');
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }, [ride, show]);

  useEffect(() => {
    if (!key) return;
    let active = true;
    const element = host.current!;
    setError('');
    const authFail = () => {
      if (active) {
        generation.current++;
        setBusy(false);
        setError('Google ha rifiutato la chiave. Controlla API, fatturazione e domini consentiti, poi ricarica la pagina.');
      }
    };
    const browser = window as Window & { gm_authFailure?: () => void };
    const previousAuthHandler = browser.gm_authFailure;
    browser.gm_authFailure = authFail;
    void loadStreet(key).then(({ StreetViewPanorama, StreetViewService }) => {
      if (!active) return;
      service.current = new StreetViewService();
      viewer.current = new StreetViewPanorama(element, {
        disableDefaultUI: true, clickToGo: false, linksControl: false,
        motionTracking: false, showRoadLabels: true, visible: true,
      });
      if (ride.current) show(ride.current);
      else void jump(GAZZANIGA);
    }).catch(() => { if (active) setError('Google Maps non disponibile. Controlla la connessione e riprova.'); });
    return () => {
      active = false;
      browser.gm_authFailure = previousAuthHandler;
      generation.current++;
      viewer.current?.setVisible(false);
      viewer.current = null;
      service.current = null;
      element.replaceChildren();
    };
  }, [key, ride, jump, show, attempt]);

  useEffect(() => {
    let active = true;
    setNext(null);
    setStepError(false);
    if (scene && selected && service.current) {
      void lookup(service.current, { pano: selected }).then(p => { if (active) setNext(p); })
        .catch(() => { if (active) setStepError(true); });
    }
    return () => { active = false; };
  }, [scene, selected, attempt]);

  useEffect(() => {
    if (!jumpOpen && !busy && next?.id === selected && next && ride.advance(next, odometer)) show(next);
  }, [ride, next, odometer, show, selected, jumpOpen, busy]);

  const openJump = () => {
    if (scene) setMapCenter({ lat: scene.lat, lng: scene.lon });
    setAddress('');
    setError('');
    setJumpOpen(true);
  };
  const closeJump = () => { generation.current++; setBusy(false); setJumpOpen(false); setError(scene ? '' : noRoad); };
  return <>
    <div ref={host} className="absolute inset-x-0 top-0 bottom-[var(--dock)]" aria-label="Panorama Street View"
      onKeyDownCapture={event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); } }} />
    {!key ? <form className="absolute inset-0 z-10 grid place-content-center gap-3 bg-bg px-6"
      onSubmit={e => { e.preventDefault(); tabKey = keyInput.trim(); setKey(tabKey); setKeyInput(''); }}>
      <h1 className="font-display text-3xl">Collega Street View</h1>
      <label className="grid gap-1">Chiave browser di Google Maps
        <input type="password" required value={keyInput} onChange={e => setKeyInput(e.target.value)} className="rounded-xl border border-line bg-elev p-3" />
      </label>
      <p className="max-w-sm text-sm text-muted">Serve una chiave con Maps JavaScript API. Per cercare per nome attiva anche Geocoding API. La chiave dura fino alla ricarica della pagina.</p>
      <button disabled={!keyInput.trim()} className={control}>Apri Street View</button>
      <Link to="/" className="text-center text-accent">Torna a Pedala</Link>
    </form> : <div className="absolute inset-x-2 top-[4.5rem] z-10 flex flex-wrap items-start justify-center gap-2">
      {scene ? <button onClick={openJump} className={control}>Jump</button> : <Link className={control} to="/">Torna a Pedala</Link>}
      {scene && ride.exits.length > 1 && ride.exits.map(exit => {
        const turn = turnAngle(ride.heading, exit.heading);
        const label = Math.abs(turn) < 30 ? 'Dritto' : Math.abs(turn) > 150 ? 'Indietro' : turn < 0 ? 'Sinistra' : 'Destra';
        return <button key={exit.id} className={control + ' aria-pressed:ring-2 aria-pressed:ring-accent'} aria-label={label + ' · ' + Math.round(exit.heading) + '°'} aria-pressed={exit.id === selected}
          onClick={() => select(exit.id)}>{label}</button>;
      })}
      {!scene && !error && <span className={control} role="status">Cerco la strada a Gazzaniga…</span>}
      {(stepError || (scene && !selected)) && <span className={control} role="status">{stepError ? 'Strada non caricata.' : 'Fine della strada.'} Usa Jump.</span>}
      {error && !jumpOpen && <div role="alert" className="rounded-xl bg-elev p-3">{error} <button className={control} onClick={() => service.current ? void jump(GAZZANIGA) : retry(n => n + 1)}>Riprova</button>
        {service.current && <button className={control} onClick={openJump}>Scegli un punto</button>}</div>}
    </div>}
    <Foglio open={jumpOpen} onClose={closeJump} title="Jump">
      <form className="mb-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (address.trim()) void jump(address.trim()); }}>
        <input className="min-w-0 flex-1 rounded-xl border border-line bg-elev px-3" aria-label="Città, strada o coordinate" placeholder="Città, strada o coordinate" value={address} onChange={e => setAddress(e.target.value)} />
        <button disabled={!address.trim() || busy} className={control}>Vai</button>
      </form>
      <JumpMap center={mapCenter} choose={jump} />
      <p aria-live="polite" className="mt-2 text-sm">{busy ? 'Cerco una strada…' : error || 'Tocca una strada sulla mappa.'}</p>
    </Foglio>
  </>;
}
