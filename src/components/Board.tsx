import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui';
import { formatDuration, formatNumber } from '@/domain/format';
import { fetchRideBoard } from '@/open/progress';
import type { BoardRow } from '@/multiplayer/world-protocol';

type BoardData = { total: number; rows: BoardRow[]; mine: { rank: number; sec: number } | null };

/** Una classifica: rullo o simulatore, i primi dieci e la tua posizione. */
export function BoardPanel({ id, title = 'Classifica', limit = 10 }: { id: string; title?: string; limit?: number }) {
  const [sim, setSim] = useState(false);
  const [board, setBoard] = useState<BoardData | null | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    setBoard('loading');
    void fetchRideBoard(id, sim).then((b) => alive && setBoard(b));
    return () => {
      alive = false;
    };
  }, [id, sim]);
  return (
    <section data-testid={`board-${id}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        <div className="w-48">
          <Segmented<'rullo' | 'sim'>
            label="Tipo di tempo"
            value={sim ? 'sim' : 'rullo'}
            onChange={(v) => setSim(v === 'sim')}
            options={[
              { value: 'rullo', label: 'Rullo' },
              { value: 'sim', label: 'Simulatore' },
            ]}
          />
        </div>
      </div>
      <BoardRows board={board} limit={limit} />
    </section>
  );
}

export function BoardRows({ board, limit = 10 }: { board: BoardData | null | 'loading'; limit?: number }) {
  if (board === 'loading') return <p className="mt-2 text-sm text-muted">Carico la classifica…</p>;
  if (!board) return <p className="mt-2 text-sm text-muted">Classifica non raggiungibile: serve la rete.</p>;
  if (board.rows.length === 0) return <p className="mt-2 text-sm text-muted">Nessun tempo ancora. Il primo è tuo.</p>;
  return (
    <ol className="mt-2 flex flex-col gap-1">
      {board.rows.slice(0, limit).map((r, i) => (
        <li key={i} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${r.me ? 'bg-accent/20 font-semibold' : 'bg-bg/50'}`}>
          <span className="flex min-w-0 items-center gap-2">
            <Medal rank={i + 1} />
            <span className="truncate">{r.nick}</span>
          </span>
          <span className="num shrink-0">
            {formatDuration(r.sec)} <span className="text-xs text-muted">{r.wkg ? `${formatNumber(r.wkg, 1)} W/kg` : ''}</span>
          </span>
        </li>
      ))}
      {board.mine ? (
        <li className="flex items-center justify-between rounded-xl bg-accent/20 px-3 py-2 text-sm font-semibold">
          <span>
            Tu: {board.mine.rank}° su {board.total}
          </span>
          <span className="num">{formatDuration(board.mine.sec)}</span>
        </li>
      ) : null}
    </ol>
  );
}

/** Oro, argento, bronzo per i primi tre; il numero per gli altri. */
export function Medal({ rank }: { rank: number }) {
  const color = rank === 1 ? '#ffc814' : rank === 2 ? '#c9ccd2' : rank === 3 ? '#cd8a4a' : null;
  if (!color) return <span className="num w-6 shrink-0 text-center text-muted">{rank}</span>;
  return (
    <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-[#16130a]" style={{ background: color }}>
      {rank}
    </span>
  );
}
