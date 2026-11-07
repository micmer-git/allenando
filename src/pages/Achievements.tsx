import { useEffect, useState } from 'react';
import { Glyph, Coin } from '@/components/Glyph';
import { ACHIEVEMENTS, GROUPS, type AchievementGroup, type Glyph as GlyphName } from '@/game/achievements';
import { PageHeader } from '@/components/ui';
import { ITEM_BY_ID } from '@/game/kit';
import { SERIES } from '@/game/missions';
import { seriesProgress } from '@/game/career';
import { worldInfo } from '@/open/worlds';
import { useGame } from '@/game/useGame';
import { formatDateTime } from '@/domain/format';
import { cn } from '@/lib/cn';

/** Un segno per categoria: la lista non è più cinquanta volte la stessa icona. */
const GROUP_GLYPH: Record<AchievementGroup, GlyphName> = {
  strada: 'km',
  salite: 'salita',
  traguardi: 'volata',
  mondo: 'mappa',
  costanza: 'fiamma',
  motore: 'fulmine',
};

type Ach = (typeof ACHIEVEMENTS)[number];

/** Volate, GPM e crono sono i «tratti», come nelle classifiche: e il filtro sta in una riga. */
const groupName = (g: { id: string; name: string }) => (g.id === 'traguardi' ? 'Tratti' : g.name);

export function AchievementsPage() {
  const hydrate = useGame((s) => s.hydrate);
  const career = useGame((s) => s.career);
  const [group, setGroup] = useState<AchievementGroup | 'tutti'>('tutti');
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const done = ACHIEVEMENTS.filter((a) => career.achievements[a.id]).length;
  function progressOf(a: Ach): number {
    if (career.achievements[a.id]) return 2;
    const p = a.progress?.(career);
    return p ? p[0] / p[1] : 0;
  }
  const sort = (list: Ach[]) =>
    [...list].sort((a, b) => Number(!!career.achievements[b.id]) - Number(!!career.achievements[a.id]) || progressOf(b) - progressOf(a) || a.oro - b.oro);
  // i tre più vicini: più avanti nella barra, e a parità i più facili (meno oro)
  const near = ACHIEVEMENTS.filter((a) => !career.achievements[a.id])
    .sort((a, b) => progressOf(b) - progressOf(a) || a.oro - b.oro)
    .slice(0, 3);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="achievements">
      <PageHeader back={{ to: '/tu', label: 'Tu' }} title="Traguardi" aside={<span className="num text-lg font-semibold">{`${done}/${ACHIEVEMENTS.length}`}</span>} />
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-elev2">
        <div className="gold-sheen h-full rounded-full" style={{ width: `${(done / ACHIEVEMENTS.length) * 100}%` }} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Gruppi" data-testid="ach-groups">
        {[{ id: 'tutti' as const, name: 'Tutti' }, ...GROUPS].map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={group === g.id}
            onClick={() => setGroup(g.id)}
            className={cn('inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold', group === g.id ? 'border-ink/30 bg-[var(--thumb)] text-ink' : 'border-transparent bg-elev2 text-muted')}
          >
            {g.id !== 'tutti' ? <Glyph name={GROUP_GLYPH[g.id]} size={16} className={group === g.id ? 'text-accent' : ''} /> : null}
            {groupName(g)}
          </button>
        ))}
      </div>

      {group === 'tutti' && near.length ? (
        <section className="mt-5" data-testid="ach-near">
          <h2 className="eyebrow">Quasi tuoi</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {near.map((a) => (
              <AchItem key={a.id} a={a} career={career} testId={`near-${a.id}`} />
            ))}
          </ul>
        </section>
      ) : null}

      {group === 'tutti' || group === 'mondo' ? (
        <section className="mt-6" data-testid="ach-series">
          <h2 className="flex items-center gap-2 font-display text-2xl uppercase">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-elev2 text-accent">
              <Glyph name="maglia" size={18} />
            </span>
            Serie
          </h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {SERIES.map((s) => {
              const p = seriesProgress(career, s.id);
              const done = new Set(career.series[s.id] ?? []);
              const reward = [...ITEM_BY_ID.values()].find((i) => i.series === s.id);
              return (
                <li key={s.id} className={cn('rounded-2xl border p-3', p.finished ? 'border-accent bg-accent/10' : 'border-line bg-elev/60')} data-testid={`series-${s.id}`}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{s.name}</span>
                    <span className="num text-xs text-muted">{`${p.done}/${p.total} · ${worldInfo(s.world).short}`}</span>
                  </span>
                  <span className="block text-sm leading-snug text-muted">{s.blurb}</span>
                  <ol className="mt-2 flex flex-col gap-1">
                    {s.steps.map((st, i) => (
                      <li key={st.id} className="flex items-center gap-2 text-sm">
                        <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px]', done.has(st.id) ? 'border-accent bg-accent text-accent-ink' : 'border-line text-muted')} aria-hidden="true">
                          {done.has(st.id) ? '✓' : i + 1}
                        </span>
                        <span className={done.has(st.id) ? 'text-muted line-through' : ''}>{st.title}</span>
                        <span className="num ml-auto inline-flex items-center gap-1 text-xs text-muted">
                          <Coin size={12} /> {st.oro}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {reward ? <span className="mt-1.5 block text-xs text-accent">{`Sblocca: ${reward.name}`}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {(group === 'tutti' ? GROUPS : GROUPS.filter((g) => g.id === group)).map((g) => {
        const list = sort(ACHIEVEMENTS.filter((a) => a.group === g.id));
        const got = list.filter((a) => career.achievements[a.id]).length;
        return (
          <section key={g.id} className="mt-6">
            <h2 className="flex items-center gap-2 font-display text-2xl uppercase">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-elev2 text-accent">
                <Glyph name={GROUP_GLYPH[g.id]} size={18} />
              </span>
              {groupName(g)}
              <span className="num ml-auto font-sans text-sm font-semibold text-muted">{`${got}/${list.length}`}</span>
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {list.map((a) => (
                <AchItem key={a.id} a={a} career={career} testId={`ach-${a.id}`} />
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}

function AchItem({ a, career, testId }: { a: Ach; career: ReturnType<typeof useGame.getState>['career']; testId: string }) {
  const at = career.achievements[a.id];
  const p = a.progress?.(career);
  const unlocks = itemFor(a.id);
  return (
    <li
      data-testid={testId}
      className={cn('flex gap-3 rounded-2xl border p-3', at ? (a.rare ? 'border-accent bg-accent/10' : 'border-accent/40 bg-elev') : 'border-line bg-elev/60')}
    >
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full', at ? 'bg-accent text-accent-ink' : 'bg-elev2 text-muted')}>
        <Glyph name={a.glyph} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('font-semibold', !at && 'text-ink/80')}>{a.name}</span>
          <span className="num inline-flex shrink-0 items-center gap-1 text-xs text-muted">
            <Coin size={13} /> {a.oro}
          </span>
        </span>
        <span className="block text-sm leading-snug text-muted">{a.desc}</span>
        {unlocks ? <span className="mt-0.5 block text-xs text-accent">{`Sblocca: ${unlocks}`}</span> : null}
        {at ? (
          <span className="mt-1 block text-xs text-good">{`Preso il ${formatDateTime(at)}`}</span>
        ) : p ? (
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-elev2">
              <span className="block h-full rounded-full bg-accent/70" style={{ width: `${Math.min(100, (p[0] / p[1]) * 100)}%` }} />
            </span>
            <span className="num text-xs text-muted">{`${p[0].toLocaleString('it-IT')}/${p[1].toLocaleString('it-IT')}`}</span>
          </span>
        ) : null}
      </span>
    </li>
  );
}

function itemFor(achievement: string): string {
  const names: string[] = [];
  for (const [, item] of ITEM_BY_ID) if (item.achievement === achievement) names.push(item.name);
  return names.join(', ');
}
