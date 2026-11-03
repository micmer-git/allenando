import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, TextInput } from '@/components/ui';
import { formatNumber } from '@/domain/format';
import { NICK_MAX, RIDER_COLORS, cleanNick, isRoomId, isRoute, MAX_RIDERS, type RoomRoute } from '@/multiplayer/protocol';
import { RoomClient, estimateDistance, inviteUrl, newRoomId, saveNick, savedNick, type RoomSnapshot, type RoomStatus } from '@/multiplayer/room';
import type { RideEngine } from '@/sim/engine';

/*
 * «Pedala insieme»: due o più telefoni sulla stessa salita, ognuno con il suo rullo o
 * il simulatore. La stanza vive nel Worker allenando-rooms; qui c'è solo il collegamento,
 * il pannello con i distacchi e il foglio per invitare.
 */

export const STATUS_LABEL: Record<RoomStatus, string> = {
  connecting: 'Mi collego…',
  open: 'In stanza',
  reconnecting: 'Riconnessione…',
  offline: 'Offline: rientro quando torna la rete',
  full: `Stanza piena (${MAX_RIDERS} su ${MAX_RIDERS})`,
  route: 'Questa stanza è su un’altra salita',
  expired: 'Stanza scaduta',
  error: 'Server delle stanze non raggiungibile',
  closed: 'Fuori dalla stanza',
};

export function useRoom(routeId: string | undefined, engine: RideEngine, defaultNick: string) {
  const [params, setParams] = useSearchParams();
  const roomParam = params.get('room');
  const room = isRoomId(roomParam) ? roomParam : null;
  const route: RoomRoute | null = isRoute(routeId) ? routeId : null;
  const [nick, setNick] = useState(() => savedNick());
  // chi arriva da un invito senza un nome salvato sceglie come farsi vedere, prima di entrare
  const [sheet, setSheet] = useState(() => Boolean(room && route && !savedNick()));
  const client = useMemo(() => (room && route && nick ? new RoomClient({ room, route, nick }) : null), [room, route, nick]);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!client) return;
    client.connect();
    const off = client.subscribe(() => bump((n) => n + 1));
    const state = () => ({ distance: engine.distance, power: engine.power3s, speed: engine.speed, idle: engine.phase !== 'riding' });
    const offEngine = engine.subscribe(() => client.update(state()));
    // anche in pausa (quando il motore tace) gli altri devono sapere che sei fermo
    const keep = setInterval(() => client.update(state()), 1000);
    return () => {
      off();
      offEngine();
      clearInterval(keep);
      client.leave();
    };
  }, [client, engine]);

  const setRoom = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('room', id);
        else next.delete('room');
        return next;
      },
      { replace: true },
    );

  return {
    available: route != null,
    room,
    route,
    client,
    snap: client ? client.snapshot() : null,
    nick: nick || defaultNick,
    sheet,
    setSheet,
    invite: room && route ? inviteUrl(route, room) : null,
    create(name: string) {
      const n = cleanNick(name) ?? 'Ciclista';
      saveNick(n);
      setNick(n);
      setRoom(newRoomId());
    },
    join(name: string) {
      const n = cleanNick(name) ?? 'Ciclista';
      saveNick(n);
      setNick(n);
    },
    leave() {
      client?.leave();
      setRoom(null);
      setSheet(false);
    },
  };
}

export type RoomHandle = ReturnType<typeof useRoom>;

export function formatGap(meters: number): string {
  const abs = Math.abs(meters);
  const text = abs >= 1000 ? `${formatNumber(abs / 1000, 1)} km` : `${Math.round(abs)} m`;
  if (abs < 5) return 'affiancati';
  return meters > 0 ? `${text} davanti` : `${text} dietro`;
}

/** Il pannello sopra il mondo: chi c'è, quanto è lontano, con quanti watt. */
export function RoomPanel({ snap, myDistance, onOpen }: { snap: RoomSnapshot; myDistance: number; onOpen: () => void }) {
  const now = Date.now();
  const rows = snap.riders
    .map((r) => ({ r, gap: estimateDistance(r, now) - myDistance }))
    .sort((a, b) => b.gap - a.gap);
  const shown = rows.slice(0, 4);
  const live = snap.status === 'open';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pointer-events-auto block w-[min(15rem,58vw)] rounded-2xl bg-bg/72 p-2 text-left backdrop-blur"
      data-testid="room-panel"
    >
      <span className="flex items-center gap-2 px-1 text-xs font-semibold" data-testid="room-status" data-status={snap.status}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${live ? 'bg-good' : snap.status === 'connecting' || snap.status === 'reconnecting' ? 'animate-pulse bg-warn' : 'bg-danger'}`} />
        <span className="truncate">{live ? `In stanza · ${snap.riders.length + 1}/${MAX_RIDERS}` : STATUS_LABEL[snap.status]}</span>
      </span>
      {live && rows.length === 0 ? <span className="mt-1 block px-1 text-xs text-muted">Aspetto gli altri: manda il link</span> : null}
      {shown.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {shown.map(({ r, gap }) => (
            <li key={r.id} className="flex items-center gap-2 rounded-xl px-1 py-0.5 text-[13px]" data-testid="room-rider">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RIDER_COLORS[r.color % RIDER_COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate font-semibold">{r.nick}</span>
              <span className={`num shrink-0 ${gap > 5 ? 'text-warn' : gap < -5 ? 'text-good' : 'text-muted'}`}>{formatGap(gap)}</span>
              <span className="num w-11 shrink-0 text-right text-muted">{r.idle ? 'fermo' : `${r.w} W`}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length > shown.length ? <span className="mt-0.5 block px-1 text-xs text-muted">e altri {rows.length - shown.length}</span> : null}
    </button>
  );
}

/** Il foglio dal basso: crea, entra, invita, esci. */
export function RoomSheet({ handle, routeTitle, onClose }: { handle: RoomHandle; routeTitle: string; onClose: () => void }) {
  const [name, setName] = useState(handle.nick);
  const [note, setNote] = useState<string | null>(null);
  const snap = handle.snap;
  const joined = handle.client != null;
  const invited = handle.room != null && !joined;

  async function share() {
    if (!handle.invite) return;
    const data = { title: 'OROBIA · Pedala insieme', text: `Pedala con me su ${routeTitle}`, url: handle.invite };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    await copy();
  }

  async function copy() {
    if (!handle.invite) return;
    try {
      await navigator.clipboard.writeText(handle.invite);
      setNote('Link copiato');
    } catch {
      setNote('Copia il link qui sopra a mano');
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/55 md:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-title"
        className="max-h-[88dvh] w-full max-w-lg overflow-auto rounded-t-3xl bg-elev px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 md:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="room-sheet"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line md:hidden" />
        <div className="flex items-center justify-between gap-3">
          <h2 id="room-title" className="font-display text-3xl uppercase leading-none">
            Pedala insieme
          </h2>
          <button type="button" className="-mr-2 h-11 rounded-full px-3 text-sm font-semibold" onClick={onClose}>
            Chiudi
          </button>
        </div>

        {!joined ? (
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (invited) handle.join(name);
              else handle.create(name);
              setNote(null);
            }}
          >
            <p className="text-[15px] leading-relaxed text-muted">
              {invited
                ? `Ti hanno invitato su ${routeTitle}. Ognuno pedala col suo rullo o col simulatore: vi vedete sulla strada e nel pannello dei distacchi.`
                : `Apri una stanza su ${routeTitle} e manda il link: chi lo apre pedala sulla stessa salita, col suo rullo o col simulatore. Fino a ${MAX_RIDERS} persone.`}
            </p>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-medium text-muted">Come ti vedono gli altri</span>
              <TextInput
                value={name}
                maxLength={NICK_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="Il tuo nome"
                autoComplete="nickname"
                data-testid="room-nick"
              />
            </label>
            <Button type="submit" className="mt-4 w-full" data-testid={invited ? 'room-join' : 'room-create'} disabled={!cleanNick(name)}>
              {invited ? 'Entra nella stanza' : 'Crea la stanza e invita'}
            </Button>
          </form>
        ) : (
          <div className="mt-3">
            <p className="flex items-center gap-2 text-sm font-semibold" role="status">
              <span className={`h-2.5 w-2.5 rounded-full ${snap?.status === 'open' ? 'bg-good' : 'bg-warn'}`} />
              {snap ? STATUS_LABEL[snap.status] : ''}
              {snap?.status === 'open' ? ` · ${snap.riders.length + 1} su ${MAX_RIDERS}` : ''}
            </p>
            {handle.invite ? (
              <>
                <input
                  readOnly
                  value={handle.invite}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Link d’invito"
                  className="mt-3 h-12 w-full rounded-2xl border border-line bg-elev2 px-3 text-sm text-muted outline-none"
                  data-testid="room-link"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button onClick={() => void share()} data-testid="room-share">
                    Invita
                  </Button>
                  <Button variant="soft" onClick={() => void copy()}>
                    Copia link
                  </Button>
                </div>
                {note ? <p className="mt-2 text-sm text-good">{note}</p> : null}
              </>
            ) : null}
            {snap && snap.riders.length > 0 ? (
              <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
                {snap.riders.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="h-3 w-3 rounded-full" style={{ background: RIDER_COLORS[r.color % RIDER_COLORS.length] }} />
                    <span className="flex-1 truncate font-semibold">{r.nick}</span>
                    <span className="num text-sm text-muted">{r.idle ? 'fermo' : `${r.w} W · ${formatNumber(r.v * 3.6, 1)} km/h`}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {snap && (snap.status === 'error' || snap.status === 'full' || snap.status === 'closed') ? (
              <Button variant="soft" className="mt-3 w-full" onClick={() => handle.client?.rejoin()}>
                Riprova a entrare
              </Button>
            ) : null}
            <Button variant="ghost" className="mt-3 w-full" onClick={handle.leave} data-testid="room-leave">
              Esci dalla stanza
            </Button>
          </div>
        )}
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Il server vede solo il nome che scegli, i metri fatti sulla salita, i watt e la velocità di adesso. Niente battito, niente posizione GPS,
          niente storico: la stanza esiste finché c’è qualcuno dentro, al massimo sei ore.
        </p>
      </section>
    </div>
  );
}
