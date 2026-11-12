import { useEffect, useState } from 'react';
import { useOnline } from '@/components/Install';
import { formatDuration, formatNumber } from '@/domain/format';
import { fetchRideBoard } from '@/open/progress';
import type { BoardRow } from '@/multiplayer/world-protocol';

type BoardData = { total: number; rows: BoardRow[]; mine: { rank: number; sec: number } | null };

/**
 * Una classifica: i primi dieci e la tua posizione. Solo i tempi del rullo: la prova non va in
 * classifica (piano U, A11), e i tempi «sim» del server restano dove sono, senza mostrarsi.
 */
export function BoardPanel({ id, title = 'Classifica', limit = 10 }: { id: string; title?: string; limit?: number }) {
  const online = useOnline();
  const [board, setBoard] = useState<BoardData | null | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    setBoard('loading');
    void fetchRideBoard(id, false).then((b) => alive && setBoard(b));
    return () => {
      alive = false;
    };
  }, [id, online]);
  return (
    <section data-testid={`board-${id}`}>
      <h3 className="eyebrow">{title}</h3>
      <BoardRows board={board} limit={limit} offline={!online} />
    </section>
  );
}

export function BoardRows({ board, limit = 10, offline = false }: { board: BoardData | null | 'loading'; limit?: number; offline?: boolean }) {
  // senza rete, una parola (A16)
  if (offline && board !== 'loading' && !board) return <p className="mt-2 text-sm text-muted" data-testid="rete-offline">Offline</p>;
  if (board === 'loading') return <p className="mt-2 text-sm text-muted">Carico la classifica</p>;
  if (!board) return <p className="mt-2 text-sm text-muted">Classifica non raggiungibile</p>;
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
            {formatDuration(r.sec)} <span className="text-xs text-muted">{r.wkg ? `${formatNumber(r.wkg, 1)}\u00a0W/kg` : ''}</span>
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
