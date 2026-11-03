import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Segmented } from '@/components/ui';
import { BikeArt, HelmetArt, ItemArt, JerseyArt } from '@/components/KitArt';
import { Coin } from '@/components/Glyph';
import { ACHIEVEMENT_BY_ID } from '@/game/achievements';
import { availability, ITEMS, lookOf, SLOTS, type Item, type Slot } from '@/game/kit';
import { owns } from '@/game/career';
import { useGame } from '@/game/useGame';
import { levelOf } from '@/open/progress';
import { cn } from '@/lib/cn';

const RiderPreview = lazy(() => import('@/components/RiderPreview').then((m) => ({ default: m.RiderPreview })));

export function GaragePage() {
  const hydrate = useGame((s) => s.hydrate);
  const ready = useGame((s) => s.ready);
  const career = useGame((s) => s.career);
  const progress = useGame((s) => s.progress);
  const buy = useGame((s) => s.buy);
  const equip = useGame((s) => s.equip);
  const [slot, setSlot] = useState<Slot>('maglia');
  const [msg, setMsg] = useState<{ id: string; text: string } | null>(null);
  const [trying, setTrying] = useState<Item | null>(null);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const level = levelOf(progress.xp).level;
  const owned = useMemo(() => new Set(career.owned), [career.owned]);
  const worn = lookOf(career.equipped);
  // provare un pezzo non lo compra: si vede addosso finché non se ne sceglie un altro
  const look = trying ? { ...worn, ...trying.look } : worn;
  const items = ITEMS.filter((i) => i.slot === slot);
  const ownedCount = ITEMS.filter((i) => owns(career, i.id)).length;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="garage">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">
            {ownedCount} di {ITEMS.length} pezzi
          </p>
          <h1 className="font-display text-5xl uppercase leading-[0.9]">Garage</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="num inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-elev px-3 font-semibold" data-testid="garage-oro">
            <Coin size={18} />
            {ready ? career.oro.toLocaleString('it-IT') : '–'}
          </span>
          <span className="num inline-flex h-10 items-center rounded-full bg-accent px-3 font-semibold text-accent-ink">Liv. {level}</span>
        </div>
      </header>

      <section className="relative mt-4 overflow-hidden rounded-3xl border border-line bg-[radial-gradient(120%_90%_at_50%_100%,color-mix(in_oklab,var(--accent)_22%,transparent),transparent_70%)] bg-elev">
        <Suspense fallback={<FlatPreview look={look} />}>
          <PreviewOrFlat look={look} />
        </Suspense>
        {trying ? (
          <p className="absolute left-3 top-3 rounded-full bg-bg/80 px-3 py-1 text-xs font-semibold backdrop-blur">
            Prova: {trying.name}
          </p>
        ) : null}
      </section>

      <div className="mt-4">
        <Segmented<Slot> label="Reparto" value={slot} onChange={(v) => { setSlot(v); setTrying(null); }} options={SLOTS.map((s) => ({ value: s.id, label: s.name }))} testId="garage-slots" />
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item) => {
          const av = availability(item, owned, career.oro, level);
          const equipped = career.equipped[item.slot] === item.id;
          return (
            <li key={item.id}>
              <article
                className={cn(
                  'flex h-full flex-col rounded-2xl border bg-elev p-2.5',
                  equipped ? 'border-accent' : item.rare ? 'border-accent/40' : 'border-line',
                )}
                data-testid={`item-${item.id}`}
              >
                <button
                  type="button"
                  onClick={() => setTrying(trying?.id === item.id ? null : item)}
                  aria-label={`Prova ${item.name}`}
                  className={cn('relative grid aspect-square place-items-center rounded-xl bg-bg/60', trying?.id === item.id && 'ring-2 ring-accent')}
                >
                  <ItemArt item={item} base={worn} className="h-[82%] w-[82%]" />
                  {item.rare ? <span className="absolute right-1.5 top-1.5 rounded-full bg-accent px-1.5 text-[10px] font-bold uppercase text-accent-ink">raro</span> : null}
                </button>
                <h2 className="mt-2 font-semibold leading-tight">{item.name}</h2>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{item.note}</p>
                <div className="mt-auto pt-2">
                  {av.state === 'owned' ? (
                    equipped ? (
                      <span className="flex h-11 items-center justify-center rounded-full border border-accent text-sm font-semibold text-accent">Indossato</span>
                    ) : (
                      <button type="button" className="h-11 w-full rounded-full bg-elev2 text-sm font-semibold" onClick={() => { void equip(item.id); setTrying(null); }}>
                        Indossa
                      </button>
                    )
                  ) : av.state === 'buy' ? (
                    <button
                      type="button"
                      data-testid={`buy-${item.id}`}
                      className="num flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-accent text-sm font-semibold text-accent-ink"
                      onClick={() =>
                        void buy(item.id).then((why) => {
                          setMsg(why ? { id: item.id, text: why } : { id: item.id, text: 'Tuo. Indossato.' });
                          setTrying(null);
                        })
                      }
                    >
                      Compra <Coin size={15} /> {av.price}
                    </button>
                  ) : av.state === 'poor' ? (
                    <span className="num flex h-11 items-center justify-center gap-1.5 rounded-full border border-line text-sm text-muted">
                      <Coin size={15} /> {av.price} · mancano {av.missing}
                    </span>
                  ) : av.state === 'level' ? (
                    <span className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-line text-sm text-muted">
                      <Lock /> Livello {av.level}
                    </span>
                  ) : (
                    <Link to="/traguardi" className="flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line px-2 text-center text-xs leading-tight text-muted">
                      <Lock /> {ACHIEVEMENT_BY_ID.get(av.achievement)?.name ?? 'Traguardo'}
                    </Link>
                  )}
                  {msg?.id === item.id ? <p className="mt-1 text-center text-xs text-accent">{msg.text}</p> : null}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-center text-xs text-muted">Solo estetica: nessun pezzo cambia la fisica.</p>
    </main>
  );
}

function PreviewOrFlat({ look }: { look: ReturnType<typeof lookOf> }) {
  const [webgl] = useState(() => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  });
  if (!webgl) return <FlatPreview look={look} />;
  return <RiderPreview look={look} className="h-64 w-full sm:h-80" spin pedaling />;
}

/** Senza 3D: casco, maglia e bici in fila, grandi. */
function FlatPreview({ look }: { look: ReturnType<typeof lookOf> }) {
  return (
    <div className="grid h-64 grid-cols-[1fr_1.3fr_1.6fr] items-center gap-1 px-3 sm:h-80">
      <HelmetArt look={look} className="w-full" />
      <JerseyArt look={look} className="w-full" />
      <BikeArt look={look} className="w-full" />
    </div>
  );
}

function Lock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
