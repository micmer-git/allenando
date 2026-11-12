import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Coin } from '@/components/Glyph';
import { InstallCard } from '@/components/Install';
import { ALL_BUILTIN } from '@/domain/workouts';
import { JerseyArt } from '@/components/KitArt';
import { ACHIEVEMENTS } from '@/game/achievements';
import { lookOf } from '@/game/kit';
import { useGame } from '@/game/useGame';
import { formatNumber } from '@/domain/format';
import { levelOf } from '@/open/progress';
import { useApp } from '@/store/useApp';

/** Il livello come anello: quanto manca al prossimo. */
export function LevelRing({ xp, size = 64 }: { xp: number; size?: number }) {
  const lv = levelOf(xp);
  const f = lv.to > lv.from ? (xp - lv.from) / (lv.to - lv.from) : 1;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--elev2)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 32 32)" />
      </svg>
      <span className="num absolute font-display text-2xl leading-none">{lv.level}</span>
    </span>
  );
}

export function MePage() {
  const profile = useApp((s) => s.profile);
  const custom = useApp((s) => s.workouts);
  const hydrate = useGame((s) => s.hydrate);
  const career = useGame((s) => s.career);
  const progress = useGame((s) => s.progress);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const lv = levelOf(progress.xp);
  const done = ACHIEVEMENTS.filter((a) => career.achievements[a.id]).length;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="me">
      <header className="flex items-center gap-3">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-line bg-elev">
          <JerseyArt look={lookOf(career.equipped)} className="h-12 w-12" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-display text-4xl uppercase leading-none">{profile.name || 'Tu'}</h1>
          <p className="mt-1 text-sm text-muted">{lv.title}</p>
        </div>
        <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-sm font-semibold" data-testid="me-level">{`Liv. ${lv.level}`}</span>
      </header>
      <div className="mt-4">
        <div className="h-2 overflow-hidden rounded-full bg-elev2">
          <div className="gold-sheen h-full rounded-full" style={{ width: `${Math.min(100, ((progress.xp - lv.from) / Math.max(1, lv.to - lv.from)) * 100)}%` }} />
        </div>
        <p className="num mt-1.5 flex items-center justify-between text-sm text-muted">
          <span>{`Punti ${formatNumber(progress.xp, 0)} · ${formatNumber(lv.to - progress.xp, 0)} al livello ${lv.level + 1}`}</span>
          <span className="inline-flex items-center gap-1" data-testid="me-oro">
            <Coin size={14} />
            {`Oro ${formatNumber(career.oro, 0)}`}
          </span>
        </p>
      </div>

      <nav aria-label="Le tue cose" className="mt-4">
        <Riga to="/garage" title="Garage" sub="Maglie e bici" />
        <Riga to="/traguardi" title="Traguardi" sub={`${done} di ${ACHIEVEMENTS.length}`} testId="me-achievements" />
        <Riga to="/classifiche" title="Classifiche" testId="me-boards" />
        <Riga to="/workouts" title="Allenamenti" sub={`${ALL_BUILTIN.length + custom.length} · Programmi`} testId="me-workouts" />
        <Riga to="/impostazioni" title="Impostazioni" sub="Profilo, rullo, prova" testId="me-settings" />
      </nav>
      <InstallCard className="mt-6" />
    </main>
  );
}

function Riga({ to, title, sub, testId }: { to: string; title: string; sub?: string; testId?: string }) {
  return (
    <Link to={to} data-testid={testId} className="flex min-h-14 items-center justify-between gap-3 border-b border-line">
      <span className="font-semibold">{title}</span>
      <span className="num text-sm text-muted">{sub ? `${sub} ›` : '›'}</span>
    </Link>
  );
}
