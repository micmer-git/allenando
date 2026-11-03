import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Glyph, Coin } from '@/components/Glyph';
import { ACHIEVEMENTS, GROUPS, type AchievementGroup } from '@/game/achievements';
import { ITEM_BY_ID } from '@/game/kit';
import { useGame } from '@/game/useGame';
import { formatDateTime } from '@/domain/format';
import { cn } from '@/lib/cn';

export function AchievementsPage() {
  const hydrate = useGame((s) => s.hydrate);
  const career = useGame((s) => s.career);
  const [group, setGroup] = useState<AchievementGroup | 'tutti'>('tutti');
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const done = ACHIEVEMENTS.filter((a) => career.achievements[a.id]).length;
  const list = ACHIEVEMENTS.filter((a) => group === 'tutti' || a.group === group).sort(
    (a, b) => Number(!!career.achievements[b.id]) - Number(!!career.achievements[a.id]) || progressOf(b) - progressOf(a),
  );
  function progressOf(a: (typeof ACHIEVEMENTS)[number]): number {
    if (career.achievements[a.id]) return 2;
    const p = a.progress?.(career);
    return p ? p[0] / p[1] : 0;
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="achievements">
      <Link to="/tu" className="-ml-1 inline-flex h-11 min-w-11 items-center pr-3 text-sm font-semibold text-muted">
        ← Tu
      </Link>
      <h1 className="font-display text-5xl uppercase leading-[0.9]">Traguardi</h1>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-elev2">
          <div className="gold-sheen h-full rounded-full" style={{ width: `${(done / ACHIEVEMENTS.length) * 100}%` }} />
        </div>
        <span className="num text-sm font-semibold">
          {done}/{ACHIEVEMENTS.length}
        </span>
      </div>

      <div className="-mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Gruppi">
        {[{ id: 'tutti' as const, name: 'Tutti' }, ...GROUPS].map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={group === g.id}
            onClick={() => setGroup(g.id)}
            className={cn('h-11 shrink-0 rounded-full px-4 text-sm font-semibold', group === g.id ? 'bg-accent text-accent-ink' : 'bg-elev2 text-muted')}
          >
            {g.name}
          </button>
        ))}
      </div>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {list.map((a) => {
          const at = career.achievements[a.id];
          const p = a.progress?.(career);
          return (
            <li
              key={a.id}
              data-testid={`ach-${a.id}`}
              className={cn('flex gap-3 rounded-2xl border p-3', at ? (a.rare ? 'border-accent bg-accent/10' : 'border-accent/40 bg-elev') : 'border-line bg-elev/60')}
            >
              <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-full', at ? 'bg-accent text-accent-ink' : 'bg-elev2 text-muted')}>
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
                {a.items?.length || itemFor(a.id) ? <span className="mt-0.5 block text-xs text-accent">Sblocca: {itemFor(a.id)}</span> : null}
                {at ? (
                  <span className="mt-1 block text-xs text-good">Preso il {formatDateTime(at)}</span>
                ) : p ? (
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-elev2">
                      <span className="block h-full rounded-full bg-accent/70" style={{ width: `${Math.min(100, (p[0] / p[1]) * 100)}%` }} />
                    </span>
                    <span className="num text-xs text-muted">
                      {p[0].toLocaleString('it-IT')}/{p[1].toLocaleString('it-IT')}
                    </span>
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function itemFor(achievement: string): string {
  const names: string[] = [];
  for (const [, item] of ITEM_BY_ID) if (item.achievement === achievement) names.push(item.name);
  return names.join(', ');
}
