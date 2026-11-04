import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Coin, Glyph } from '@/components/Glyph';
import { JerseyArt } from '@/components/KitArt';
import { ACHIEVEMENTS } from '@/game/achievements';
import { lookOf } from '@/game/kit';
import { useGame } from '@/game/useGame';
import { formatKm, formatNumber } from '@/domain/format';
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
  const rides = useApp((s) => s.rides);
  const hydrate = useGame((s) => s.hydrate);
  const career = useGame((s) => s.career);
  const progress = useGame((s) => s.progress);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const lv = levelOf(progress.xp);
  const done = ACHIEVEMENTS.filter((a) => career.achievements[a.id]).length;
  const km = rides.reduce((s, r) => s + r.distanceM, 0);
  const gain = rides.reduce((s, r) => s + r.elevationGainM, 0);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="me">
      <header className="flex items-center gap-4">
        <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full border border-line bg-elev">
          <JerseyArt look={lookOf(career.equipped)} className="h-16 w-16" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-display text-4xl uppercase leading-none">{profile.name || 'Tu'}</h1>
          <p className="mt-1 text-sm text-muted">{lv.title}</p>
        </div>
        <LevelRing xp={progress.xp} />
      </header>
      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-elev2">
          <div className="gold-sheen h-full rounded-full" style={{ width: `${Math.min(100, ((progress.xp - lv.from) / Math.max(1, lv.to - lv.from)) * 100)}%` }} />
        </div>
        <p className="num mt-1 text-xs text-muted">{`${formatNumber(progress.xp, 0)} punti · ${formatNumber(lv.to - progress.xp, 0)} al livello ${lv.level + 1}`}</p>
      </div>

      <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
        <Tile label="oro" value={<span className="inline-flex items-center gap-1"><Coin size={16} />{formatNumber(career.oro, 0)}</span>} />
        <Tile label="km" value={formatKm(km)} />
        <Tile label="D+ m" value={formatNumber(gain, 0)} />
        <Tile label="di fila" value={`${career.streak.days}`} />
      </dl>

      <nav aria-label="Le tue cose" className="mt-5 grid grid-cols-2 gap-2">
        <Hub to="/traguardi" glyph="coppa" title="Traguardi" sub={`${done} di ${ACHIEVEMENTS.length}`} testId="me-achievements" />
        <Hub to="/classifiche" glyph="stella" title="Classifiche" sub="Salite, tratti" testId="me-boards" />
        <Hub to="/garage" glyph="maglia" title="Garage" sub="Maglie e bici" />
        <Hub to="/history" glyph="mappa" title="Diario" sub={rides.length === 1 ? '1 giro' : `${rides.length} giri`} />
        <Hub to="/workouts" glyph="fulmine" title="Allenamenti" sub="ERG e test" />
        <Hub to="/giri" glyph="crono" title="Rifai un giro" sub="FIT, GPX" />
        <Hub to="/load" glyph="fiamma" title="Carico" sub="Forma e fatica" />
        <Hub to="/profile" glyph="ingranaggio" title="Profilo" sub="Peso, FTP" />
      </nav>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-elev px-1 py-2.5">
      <dd className="num font-display text-2xl leading-none">{value}</dd>
      <dt className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
    </div>
  );
}

function Hub({ to, glyph, title, sub, testId }: { to: string; glyph: Parameters<typeof Glyph>[0]['name']; title: string; sub: string; testId?: string }) {
  return (
    <Link to={to} data-testid={testId} className="flex items-center gap-3 rounded-2xl border border-line bg-elev p-3 transition hover:border-accent/50">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-elev2 text-accent">
        <Glyph name={glyph} size={20} />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold leading-tight">{title}</span>
        <span className="block text-xs leading-snug text-muted">{sub}</span>
      </span>
    </Link>
  );
}
