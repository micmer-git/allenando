import { useEffect, useRef } from 'react';
import { WorkoutChart } from '@/components/WorkoutChart';
import { formatDuration, formatHours, formatNumber, formatTss } from '@/domain/format';
import type { Workout } from '@/domain/types';
import { workoutEstimate } from '@/domain/workouts';
import type { Capacita, Tipo } from '@/ride/contract';
import { WATT_MAX, WATT_PASSO, wattManuali } from '@/ride/intento';
import { cn } from '@/lib/cn';

/*
 * Come (piano U, F4; wireframe C1–C4, E2): il segmento dei tipi, poi una riga sola per il tipo
 * scelto (i watt con − +, l'allenamento), i giri e il fantasma. Niente prosa: le parole piccole
 * sotto il nome dicono cosa fa il rullo.
 */

const NOMI: Record<Tipo, string> = { libera: 'Libera', fissa: 'Potenza fissa', allenamento: 'Allenamento', allora: 'Watt di allora' };

export function sottoTipo(t: Tipo, sa: Capacita, prova: boolean, manuale = false): string {
  if (manuale) return t === 'allenamento' ? 'Watt dai blocchi' : 'Watt manuali';
  const erg = sa.erg || prova;
  if (t === 'libera') return sa.pendenza || prova ? 'Pendenza' : 'Senza pendenza';
  if (t === 'fissa') return 'ERG';
  if (t === 'allenamento') return erg ? 'A blocchi' : 'A bersaglio';
  return erg ? 'ERG' : 'A bersaglio';
}

export function ComeSegmento({ tipi, tipo, sa, prova, manuale = false, onChange }: { tipi: Tipo[]; tipo: Tipo; sa: Capacita; prova: boolean; manuale?: boolean; onChange: (t: Tipo) => void }) {
  return (
    <div role="radiogroup" aria-label="Come" className="grid overflow-hidden rounded-[26px] border border-line bg-elev" style={{ gridTemplateColumns: `repeat(${tipi.length}, minmax(0, 1fr))` }} data-testid="pedala-come">
      {tipi.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={t === tipo}
          onClick={() => onChange(t)}
          className={cn('flex min-h-[52px] flex-col items-center justify-center px-1 py-1 text-center leading-tight', t === tipo ? 'bg-[var(--thumb)] text-ink' : 'text-muted')}
          data-testid={`pedala-come-${t}`}
        >
          <span className="text-[14px] font-semibold">{NOMI[t]}</span>
          <span className="text-[11px] font-medium text-muted">{sottoTipo(t, sa, prova, manuale)}</span>
        </button>
      ))}
    </div>
  );
}

/** Un tasto − o + : un tocco 5 W, tenuto premuto 25 W ogni 300 ms (A7). */
export function Passo({ segno, onStep, label, testId, disabled }: { segno: '−' | '+'; onStep: (n: number) => void; label: string; testId?: string; disabled?: boolean }) {
  const t = useRef<number | null>(null);
  const tenuto = useRef(false);
  const step = useRef(onStep);
  useEffect(() => { step.current = onStep; }, [onStep]);
  const ferma = () => {
    if (t.current) window.clearTimeout(t.current);
    if (t.current) window.clearInterval(t.current);
    t.current = null;
  };
  useEffect(() => ferma, []);
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="grid h-11 w-11 shrink-0 select-none place-items-center rounded-full border border-line bg-elev text-[22px] font-semibold disabled:opacity-40"
      onPointerDown={() => {
        tenuto.current = false;
        ferma();
        t.current = window.setTimeout(() => {
          tenuto.current = true;
          step.current(5);
          t.current = window.setInterval(() => step.current(5), 300);
        }, 450);
      }}
      onPointerUp={ferma}
      onPointerLeave={ferma}
      onPointerCancel={ferma}
      onClick={() => {
        ferma();
        if (!tenuto.current) onStep(1);
        tenuto.current = false;
      }}
      data-testid={testId}
    >
      {segno}
    </button>
  );
}

/** Un tocco regola di 5 W; il cursore permette di cambiare rapidamente intensità. */
export function WattManuali({ watt, onChange, compatto = false }: { watt: number; onChange: (w: number) => void; compatto?: boolean }) {
  const regola = (w: number) => onChange(wattManuali(w));
  return (
    <div className={cn('min-w-0 text-sm', compatto ? 'mb-1.5 landscape:mb-0 landscape:w-36' : 'mt-3 rounded-2xl border border-line px-3 py-2')} data-testid="watt-manuali">
      <div className="flex items-center justify-center gap-2">
        <Passo segno="−" label="Riduci i watt manuali" onStep={(n) => regola(watt - WATT_PASSO * n)} disabled={watt <= 0} />
        <span className="num text-center font-semibold leading-none"><span className="block text-xs text-muted">Manuali</span><output>{watt} W</output></span>
        <Passo segno="+" label="Aumenta i watt manuali" onStep={(n) => regola(watt + WATT_PASSO * n)} disabled={watt >= WATT_MAX} />
      </div>
      <input aria-label="Potenza manuale in watt" type="range" min={0} max={WATT_MAX} step={WATT_PASSO} value={watt} onChange={(event) => regola(Number(event.target.value))} className="block h-6 w-full cursor-pointer accent-[var(--accent)]" />
    </div>
  );
}

/** Potenza fissa (C2): i watt grandi con − +, il % FTP e quanto dura il Dove a quei watt. */
export function WattFissi({ watt, ftp, durataSec, onChange }: { watt: number; ftp: number; durataSec: number | null; onChange: (w: number) => void }) {
  return (
    <div className="mt-3" data-testid="pedala-watt">
      <div className="flex items-center justify-center gap-5">
        <Passo segno="−" label="Meno watt" onStep={(n) => onChange(watt - 5 * n)} testId="pedala-watt-meno" disabled={watt <= 50} />
        <span className="num font-display text-[44px] font-extrabold leading-none" data-testid="pedala-watt-valore">{`${watt} W`}</span>
        <Passo segno="+" label="Più watt" onStep={(n) => onChange(watt + 5 * n)} testId="pedala-watt-piu" disabled={watt >= 1000} />
      </div>
      <p className="mt-1.5 flex justify-center gap-1.5">
        <Tok>{`${formatNumber((watt / Math.max(1, ftp)) * 100, 0)} % FTP`}</Tok>
        {durataSec ? <Tok>{`≈ ${formatHours(durataSec)}`}</Tok> : null}
      </p>
    </div>
  );
}

/** L'allenamento scelto (C3): un tocco apre la lista. */
export function AllenamentoCard({ workout, titolo, ftp, onClick }: { workout: Workout | null; titolo: string; ftp: number; onClick: () => void }) {
  const est = workout ? workoutEstimate(workout, ftp) : null;
  return (
    <button type="button" onClick={onClick} className="mt-2 block w-full rounded-2xl border border-line bg-elev px-3 py-2.5 text-left" data-testid="pedala-allenamento">
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold">{workout ? titolo : 'Scegli l’allenamento'}</span>
        <span aria-hidden="true" className="text-lg leading-none text-muted">
          ›
        </span>
      </span>
      {workout && est ? (
        <>
          <span className="mt-1.5 block">
            <WorkoutChart workout={workout} ftp={ftp} />
          </span>
          <span className="num mt-1 block text-sm text-muted">{`${formatHours(est.durationSec)} · NP ${formatNumber(est.np, 0)} W · TSS ${formatTss(est.tss)}`}</span>
        </>
      ) : null}
    </button>
  );
}

/** I giri su un anello (C1, C3): − n giri · ≈ tempo +. */
export function Giri({ n, durataSec, onChange }: { n: number; durataSec: number | null; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2" data-testid="pedala-giri">
      <Passo segno="−" label="Un giro in meno" onStep={() => onChange(Math.max(1, n - 1))} testId="pedala-giri-meno" disabled={n <= 1} />
      <b className="num whitespace-nowrap" data-testid="pedala-giri-n">{`${n} ${n === 1 ? 'giro' : 'giri'}${durataSec ? ` · ≈ ${formatHours(durataSec)}` : ''}`}</b>
      <Passo segno="+" label="Un giro in più" onStep={() => onChange(Math.min(20, n + 1))} testId="pedala-giri-piu" disabled={n >= 20} />
    </div>
  );
}

/** Su un percorso che non è un anello, con un allenamento: andata, o andata e ritorno (E2). */
export function VaETorna({ n, andataSec, onChange }: { n: number; andataSec: number | null; onChange: (n: number) => void }) {
  const t = (k: number) => (andataSec ? ` · ${formatHours(andataSec * k)}` : '');
  return (
    <div className="mt-2 grid grid-cols-2 overflow-hidden rounded-[22px] border border-line bg-elev" role="radiogroup" aria-label="Passaggi" data-testid="pedala-passaggi">
      {[1, 2].map((k) => (
        <button key={k} type="button" role="radio" aria-checked={n === k} onClick={() => onChange(k)} className={cn('min-h-11 px-2 text-sm font-semibold', n === k ? 'bg-[var(--thumb)] text-ink' : 'text-muted')} data-testid={`pedala-passaggi-${k}`}>
          {`${k === 1 ? 'Andata' : 'Andata e ritorno'}${t(k)}`}
        </button>
      ))}
    </div>
  );
}

/** «Contro il record»: il fantasma, acceso di serie, solo dove c'è un record (A9). */
export function Fantasma({ on, sec, at, titolo = 'Contro il record', onChange }: { on: boolean; sec: number; at: string | null; titolo?: string; onChange: (v: boolean) => void }) {
  const quando = at ? new Date(at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : null;
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="mt-1.5 flex min-h-14 w-full items-center justify-between gap-3 border-b border-line text-left" data-testid="pedala-fantasma">
      <span className="min-w-0">
        <span className="block font-semibold">{titolo}</span>
        <span className="num block text-sm text-muted">{`${formatDuration(sec)}${quando ? ` · ${quando}` : ''}`}</span>
      </span>
      <span className={cn('relative h-8 w-[52px] shrink-0 rounded-full transition', on ? 'bg-accent' : 'bg-elev2')} aria-hidden="true">
        <span className={cn('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition', on ? 'left-[24px]' : 'left-1')} />
      </span>
    </button>
  );
}

export function Tok({ children, avviso }: { children: string; avviso?: boolean }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', avviso ? 'border-warn/50 text-warn' : 'border-line')}>{children}</span>;
}
