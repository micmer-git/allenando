import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BoardPanel, Medal } from '@/components/Board';
import { Segmented } from '@/components/ui';
import { Glyph } from '@/components/Glyph';
import { formatDuration, formatKm, formatNumber } from '@/domain/format';
import { VERIFIED_ROUTES } from '@/domain/routes';
import { SEGMENT_STYLE, type Segment } from '@/game/arches';
import { worldSegments } from '@/game/segments';
import { useGame } from '@/game/useGame';
import { CLIMB_BOARD, type XpRow } from '@/multiplayer/world-protocol';
import { fetchLeaders, fetchXpBoard, levelOf, type Leader } from '@/open/progress';
import { loadWorld, type WorldData } from '@/open/world';
import { cn } from '@/lib/cn';

type Tab = 'salite' | 'percorsi' | 'tratti' | 'punti';

export function LeaderboardsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (['salite', 'percorsi', 'tratti', 'punti'].includes(params.get('tab') ?? '') ? params.get('tab') : 'salite') as Tab;
  const hydrate = useGame((s) => s.hydrate);
  const pbs = useGame((s) => s.career.pbs);
  const [world, setWorld] = useState<WorldData | null>(null);
  const [leaders, setLeaders] = useState<Record<string, Leader> | null | 'loading'>('loading');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void hydrate();
    let alive = true;
    void loadWorld().then((d) => alive && setWorld(d)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hydrate]);
  const segs = useMemo(() => (world ? worldSegments(world) : null), [world]);
  const ids = useMemo(() => {
    if (tab === 'salite') return VERIFIED_ROUTES.map((r) => `salita:${r.id}`);
    if (tab === 'percorsi') return world?.rides.map((r) => r.id) ?? [];
    if (tab === 'tratti') return segs ? [...segs.byRide.values()].flat().map((s) => s.id) : [];
    return [];
  }, [tab, world, segs]);
  useEffect(() => {
    if (!ids.length) return;
    let alive = true;
    setLeaders('loading');
    void fetchLeaders(ids, false).then((l) => alive && setLeaders(l));
    return () => {
      alive = false;
    };
  }, [ids]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="leaderboards">
      <Link to="/tu" className="-ml-1 inline-flex h-11 items-center text-sm font-semibold text-muted">
        ← Tu
      </Link>
      <h1 className="font-display text-5xl uppercase leading-[0.9]">Classifiche</h1>
      <div className="mt-4">
        <Segmented<Tab>
          label="Classifiche"
          value={tab}
          onChange={(v) => {
            setOpen(null);
            setParams({ tab: v }, { replace: true });
          }}
          options={[
            { value: 'salite', label: 'Salite' },
            { value: 'percorsi', label: 'Percorsi' },
            { value: 'tratti', label: 'Tratti' },
            { value: 'punti', label: 'Punti' },
          ]}
        />
      </div>
      {tab !== 'punti' && leaders === null ? <p className="mt-3 text-sm text-muted">Classifiche non raggiungibili: serve la rete. I tuoi record restano qui.</p> : null}

      {tab === 'salite' ? (
        <ul className="mt-3 flex flex-col gap-2">
          {VERIFIED_ROUTES.map((r) => {
            const id = `salita:${r.id}`;
            const c = CLIMB_BOARD[r.id];
            return (
              <Row
                key={id}
                id={id}
                open={open === id}
                onToggle={() => setOpen(open === id ? null : id)}
                kind="gpm"
                title={`${r.name} ${r.side}`}
                sub={c ? `${formatKm(c.lengthM)} km · ${formatNumber(c.gainM, 0)} m` : r.region}
                leader={leaders === 'loading' || !leaders ? undefined : leaders[id]}
                pb={pbs[id]?.sec}
              />
            );
          })}
        </ul>
      ) : null}

      {tab === 'percorsi' ? (
        world ? (
          <ul className="mt-3 flex flex-col gap-2">
            {world.rides.map((r) => (
              <Row
                key={r.id}
                id={r.id}
                open={open === r.id}
                onToggle={() => setOpen(open === r.id ? null : r.id)}
                kind="crono"
                title={r.name}
                sub={`${formatKm(r.lengthM)} km · ${formatNumber(r.gainM, 0)} m`}
                leader={leaders === 'loading' || !leaders ? undefined : leaders[r.id]}
                pb={pbs[`w:${r.id}`]?.sec}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">Carico il mondo…</p>
        )
      ) : null}

      {tab === 'tratti' ? (
        world && segs ? (
          <div className="mt-3 flex flex-col gap-4">
            {world.rides.map((r) => {
              const list = segs.byRide.get(r.id) ?? [];
              if (!list.length) return null;
              return (
                <section key={r.id}>
                  <h2 className="eyebrow mb-1.5">{r.name}</h2>
                  <ul className="flex flex-col gap-2">
                    {list.map((s: Segment) => (
                      <Row
                        key={s.id}
                        id={s.id}
                        open={open === s.id}
                        onToggle={() => setOpen(open === s.id ? null : s.id)}
                        kind={s.kind}
                        title={s.name}
                        sub={`${SEGMENT_STYLE[s.kind].name} · ${formatKm(s.to - s.from)} km`}
                        leader={leaders === 'loading' || !leaders ? undefined : leaders[s.id]}
                        pb={pbs[s.id]?.sec}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Carico i tratti…</p>
        )
      ) : null}

      {tab === 'punti' ? <XpBoard /> : null}
    </main>
  );
}

function Row({
  id,
  open,
  onToggle,
  kind,
  title,
  sub,
  leader,
  pb,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  kind: 'volata' | 'gpm' | 'crono';
  title: string;
  sub: string;
  leader?: Leader;
  pb?: number;
}) {
  const st = SEGMENT_STYLE[kind];
  return (
    <li className={cn('overflow-hidden rounded-2xl border bg-elev', open ? 'border-accent/60' : 'border-line')} data-testid={`lb-${id}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-3 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: st.color, color: st.ink }}>
          <Glyph name={kind} size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted">{sub}</span>
        </span>
        <span className="shrink-0 text-right text-xs">
          {leader ? (
            <span className="flex items-center justify-end gap-1.5">
              <Medal rank={1} />
              <span className="num font-semibold">{formatDuration(leader.sec)}</span>
            </span>
          ) : (
            <span className="text-muted">nessun tempo</span>
          )}
          {pb != null ? <span className="num mt-0.5 block text-accent">tu {formatDuration(pb)}</span> : leader ? <span className="mt-0.5 block max-w-24 truncate text-muted">{leader.nick}</span> : null}
        </span>
      </button>
      {open ? (
        <div className="border-t border-line p-3">
          <BoardPanel id={id} />
        </div>
      ) : null}
    </li>
  );
}

function XpBoard() {
  const [scope, setScope] = useState<'week' | 'all'>('week');
  const [rows, setRows] = useState<XpRow[] | null | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    setRows('loading');
    void fetchXpBoard(scope).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [scope]);
  return (
    <section className="mt-3">
      <div className="w-56">
        <Segmented<'week' | 'all'>
          label="Periodo"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'week', label: 'Settimana' },
            { value: 'all', label: 'Sempre' },
          ]}
        />
      </div>
      {rows === 'loading' ? (
        <p className="mt-3 text-sm text-muted">Carico…</p>
      ) : !rows ? (
        <p className="mt-3 text-sm text-muted">Classifica non raggiungibile: serve la rete.</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nessuno ancora questa settimana.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-1">
          {rows.map((r, i) => (
            <li key={i} className={cn('flex items-center justify-between rounded-xl px-3 py-2 text-sm', r.me ? 'bg-accent/20 font-semibold' : 'bg-elev')}>
              <span className="flex min-w-0 items-center gap-2">
                <Medal rank={i + 1} />
                <span className="truncate">{r.nick}</span>
                <span className="text-xs text-muted">liv. {levelOf(r.xp).level}</span>
              </span>
              <span className="num">{formatNumber(r.xp, 0)} pt</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
