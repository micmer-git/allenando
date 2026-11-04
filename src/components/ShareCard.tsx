import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { validPosition } from '@/domain/metrics';
import type { Ride } from '@/domain/types';
import type { ShareOutcome, WorldContext } from '@/io/share-image';
import { loadMonumenti } from '@/open/monumenti';
import { loadWorld, Terrain } from '@/open/world';

// il disegno della cartolina si carica al primo tocco: non pesa sull'avvio dell'app
const CARD_W = 1080;
const CARD_H = 1350;
const painter = () => import('@/io/share-image');

/**
 * Il tasto «Cartolina» (nel riepilogo del giro e nel dettaglio) e il foglio che la mostra:
 * l'anteprima del PNG, «Condividi» col pannello del telefono, «Scarica» dove non c'è.
 */
export function CartolinaButton({ ride, className }: { ride: Ride; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" className={className} onClick={() => setOpen(true)} data-testid="cartolina-open">
        Cartolina
      </Button>
      {open ? <CartolinaSheet ride={ride} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Il mondo di Bergamo per la carta: solo se il giro ha il GPS (sennò non c'è niente da mettere sotto). */
async function worldFor(ride: Ride): Promise<WorldContext | null> {
  if (!ride.samples.some((s) => validPosition(s.lat, s.lon))) return null;
  try {
    const data = await loadWorld();
    const far = await new Terrain(data.graph).loadFar();
    return { data, far };
  } catch {
    return null;
  }
}

function canShareFiles(): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    return typeof nav.share === 'function' && !!nav.canShare?.({ files: [new File([new Uint8Array(1)], 'orobia.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

const DONE: Record<ShareOutcome, string> = {
  condivisa: 'Cartolina condivisa.',
  scaricata: 'Cartolina scaricata.',
  annullata: 'Condivisione annullata.',
};

function CartolinaSheet({ ride, onClose }: { ride: Ride; onClose: () => void }) {
  const [card, setCard] = useState<{ blob: Blob; url: string; title: string; monuments: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const share = canShareFiles();

  useEffect(() => {
    let alive = true;
    let url = '';
    void (async () => {
      const world = await worldFor(ride);
      const monumenti = world ? await loadMonumenti(world.data.graph.id) : [];
      const { cardInputFromRide, renderCard } = await painter();
      const input = cardInputFromRide(ride, world?.data ?? null, monumenti);
      const blob = await renderCard(input, world);
      if (!alive) return;
      url = URL.createObjectURL(blob);
      setCard({ blob, url, title: input.title, monuments: input.monuments.map((m) => m.name) });
    })().catch(() => alive && setError('Non sono riuscito a disegnare la cartolina.'));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ride]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 md:items-center" role="dialog" aria-modal="true" aria-label="Cartolina del giro" data-testid="cartolina">
      <section className="flex max-h-[94dvh] w-full max-w-md flex-col rounded-3xl bg-elev p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-3xl uppercase leading-none">Cartolina</h2>
          <button type="button" className="h-11 rounded-full px-4 text-sm font-semibold" onClick={onClose} data-testid="cartolina-close">
            Chiudi
          </button>
        </div>
        <div className="mt-3 min-h-0 flex-1">
          {card ? (
            <img
              src={card.url}
              alt={`Cartolina: ${card.title}`}
              className="mx-auto block max-h-[62dvh] w-auto max-w-full rounded-2xl border border-line"
              style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}
              data-testid="cartolina-img"
              data-monumenti={card.monuments.join('|')}
            />
          ) : (
            <div className="mx-auto grid max-h-[62dvh] w-full place-items-center rounded-2xl border border-line bg-bg text-sm text-muted" style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}>
              {error ?? 'Preparo la cartolina…'}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {share ? (
            <Button disabled={!card} onClick={() => card && void painter().then(({ shareCard }) => shareCard(card.blob, card.title)).then((o) => setNote(DONE[o]))} data-testid="cartolina-share">
              Condividi
            </Button>
          ) : null}
          <Button
            variant={share ? 'ghost' : 'primary'}
            disabled={!card}
            onClick={() => {
              if (!card) return;
              void painter().then(({ downloadCard }) => downloadCard(card.blob, card.title));
              setNote(DONE.scaricata);
            }}
            data-testid="cartolina-download"
          >
            Scarica il PNG
          </Button>
          {note ? (
            <p className="text-center text-sm text-muted" role="status">
              {note}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
