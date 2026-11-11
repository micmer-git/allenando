import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { geoPointsFromSamples, hasAltitude, hasGps, profileFromSamples, sliceSection, type ReplayMode } from '@/domain/replay';
import { loadRouteFile, routeMeta, trackFromGeo, trackFromRouteFile, type LoadedRoute } from '@/domain/routes';
import { createRouteTrack } from '@/domain/track';
import type { RideSample } from '@/domain/types';
import { reteAdesso, statoPacco } from '@/lib/rete';
import { loadPlan } from '@/open/plan';
import { WorldSession } from '@/open/session';
import { loadWorld, type WorldData } from '@/open/world';
import { npcCount } from '@/open/WorldScene';
import type { Dir } from '@/open/graph';
import { worldInfo } from '@/open/worlds';
import { decodeSection } from '@/pages/ReplaySetup';
import { rulloAdesso } from '@/sim/rullo';
import { useApp } from '@/store/useApp';
import type { Intento, PaccoMondo } from './contract';
import { intentoDaSearch } from './intento';

/**
 * Dal link della corsa alla strada da pedalare: il mondo (percorso, anello, giro libero), una
 * salita verificata o un tuo giro. Qui non c'è interfaccia: la usano RidePage e le prove.
 */
export interface RideSetup {
  route: LoadedRoute;
  /** id della salita verificata, per legare il giro salvato al fantasma futuro */
  routeId?: string;
  replayMode?: ReplayMode;
  replaySamples?: RideSample[];
  ghostSamples?: RideSample[];
  label: string;
  note?: string;
  /** mondo aperto: il grafo e la pedalata che lo percorre */
  world?: { data: WorldData; session: WorldSession };
  /** dove, come, quanti giri: letto dal link (src/ride/intento.ts) */
  intento: Intento;
  /** giro di prova: il simulatore al posto del rullo (niente classifica, oro, punti, record, esportazione) */
  prova: boolean;
  /** quale mondo c'è sul disco: l'intero, il leggero (strade e terreno lontano), ancora niente */
  pacco: PaccoMondo;
}

/** Strada neutra, dritta, per i giri senza GPS: lo diciamo, non la spacciamo per vera. */
export function neutralRoute(samples: RideSample[]): LoadedRoute {
  const prof = hasAltitude(samples) ? profileFromSamples(samples) : [];
  const total = Math.max(200, samples[samples.length - 1]?.distance ?? 1000);
  const pts = [];
  for (let d = 0; d <= total; d += 10) {
    let ele: number | null = null;
    if (prof.length) {
      const k = prof.findIndex((p) => p.distance >= d);
      ele = (k < 0 ? prof[prof.length - 1] : prof[k]).altitude;
    }
    pts.push({ x: 0, z: d, ele });
  }
  return {
    id: 'neutral',
    title: 'Strada neutra',
    subtitle: 'Giro senza GPS',
    track: createRouteTrack(pts, { halfWidth: 3 }),
    dem: null,
    origin: { lat: 0, lon: 0 },
    attribution: '',
    verified: false,
  };
}

/** Il modo del giro rifatto: i watt di allora, il fantasma (di serie) o la sola pendenza. */
export function replayModeDi(i: Intento): ReplayMode {
  if (i.tipo === 'allora') return 'power';
  return i.fantasma === false ? 'grade' : 'ghost';
}

export function useRideSetup(): { setup: RideSetup | null; error: string | null } {
  const [params] = useSearchParams();
  const rides = useApp((s) => s.rides);
  const quality = useApp((s) => s.settings.quality);
  const [state, setState] = useState<{ setup: RideSetup | null; error: string | null }>({ setup: null, error: null });
  // entrare o uscire da una stanza cambia ?room=, non la strada: non si ricarica niente
  const key = useMemo(() => {
    const p = new URLSearchParams(params);
    p.delete('room');
    return p.toString();
  }, [params]);
  useEffect(() => {
    let alive = true;
    const done = (setup: RideSetup | null, error: string | null = null) => {
      if (alive) setState({ setup, error });
    };
    const intento = intentoDaSearch(params);
    if (!intento) {
      done(null, 'Non so dove pedalare: scegli da Pedala.');
      return;
    }
    // la prova vale per tutta la corsa: decisa qui, alla partenza
    const prova = rulloAdesso().prova;
    const base: { intento: Intento; prova: boolean; pacco: PaccoMondo } = { intento, prova, pacco: 'intero' };
    const dove = intento.dove;
    if (dove.kind === 'percorso' || dove.kind === 'piano' || dove.kind === 'libero') {
      // senza rete e senza il mondo intero sul telefono: il mondo leggero (strade e terreno lontano)
      const offline = reteAdesso() === 'offline';
      (offline ? statoPacco(dove.world).catch(() => null) : Promise.resolve(null))
        .then((p) => {
          base.pacco = offline && p?.stato !== 'intero' ? 'leggero' : 'intero';
          return loadWorld(dove.world);
        })
        .then((loaded) => {
          const data: WorldData = base.pacco === 'leggero' ? { ...loaded, leggero: true } : loaded;
          const n = npcCount(quality);
          let session: WorldSession;
          let title: string;
          let subtitle: string;
          if (dove.kind === 'percorso') {
            const ride = data.rides.find((r) => r.id === dove.ride);
            if (!ride) throw new Error('Percorso sconosciuto.');
            session = new WorldSession(data, { ride }, n, { giri: intento.giri });
            title = ride.name;
            subtitle = ride.side;
          } else if (dove.kind === 'piano') {
            const plan = loadPlan(dove.plan);
            if (!plan || plan.legs.length === 0) throw new Error('Anello non più disponibile: rifallo da Pedala.');
            session = new WorldSession(data, { legs: plan.legs, name: plan.name }, n, { giri: intento.giri });
            title = plan.name;
            subtitle = 'Anello suggerito';
          } else {
            const e = data.graph.edges[dove.edge];
            if (!e) throw new Error('Punto di partenza fuori dal mondo.');
            const dir = dove.dir as Dir;
            const s0 = Math.min(e.length, Math.max(0, dove.s));
            session = new WorldSession(data, { edge: dove.edge, dir: data.graph.allowed(dove.edge, dir) ? dir : ((-dir) as Dir), s: s0 }, n);
            title = 'Giro libero';
            subtitle = e.name || e.ref || worldInfo(data.graph.id).name;
          }
          const route: LoadedRoute = { id: 'world', title, subtitle, track: session.path, dem: null, origin: data.graph.origin, attribution: data.graph.attribution, verified: true };
          done({ ...base, route, label: subtitle && dove.kind === 'percorso' ? `${title} ${subtitle}` : title, world: { data, session } });
        })
        .catch((err: unknown) => done(null, offline ? 'Offline: questo mondo non è ancora sul telefono.' : err instanceof Error ? err.message : 'Mondo non disponibile.'));
      return () => {
        alive = false;
      };
    }
    if (dove.kind === 'giro') {
      const ride = rides.find((r) => r.id === dove.replay);
      if (!ride) {
        done(null, 'Giro da rifare non trovato.');
        return;
      }
      const mode = replayModeDi(intento);
      const samples = sliceSection(ride, decodeSection(dove.sec ?? null));
      if (samples.length < 2) {
        done(null, 'Il pezzo scelto è vuoto.');
        return;
      }
      let route: LoadedRoute;
      let note: string | undefined;
      try {
        route = hasGps(samples)
          ? trackFromGeo(`replay-${ride.id}`, ride.name, geoPointsFromSamples(samples), 'Traccia del tuo giro')
          : neutralRoute(samples);
        if (!hasGps(samples)) note = 'Giro senza GPS: strada neutra, pendenza dal file se c’è.';
        else if (!hasAltitude(samples)) note = 'Il file non ha quota: la strada è in piano.';
      } catch {
        route = neutralRoute(samples);
        note = 'Traccia GPS inutilizzabile: strada neutra.';
      }
      const ghost = mode === 'grade' || intento.fantasma === false ? undefined : samples;
      done({ ...base, route, replayMode: mode, replaySamples: samples, ghostSamples: ghost, label: ride.name, note });
      return;
    }
    const id = dove.route;
    const meta = routeMeta(id);
    if (!meta) {
      done(null, 'Salita sconosciuta.');
      return;
    }
    const ghostId = intento.fantasma === false || intento.tipo === 'allenamento' ? null : params.get('ghost');
    const ghost = ghostId ? rides.find((r) => r.id === ghostId) : undefined;
    loadRouteFile(id)
      .then((file) => {
        const route = trackFromRouteFile(file, meta.halfWidth);
        done({ ...base, route, routeId: id, ghostSamples: ghost?.samples, label: `${meta.name} ${meta.side}` });
      })
      .catch((err: unknown) => done(null, err instanceof Error ? err.message : 'Traccia non disponibile.'));
    return () => {
      alive = false;
    };
    // salvare un giro cambia la lista: la strada non va ricaricata per questo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
