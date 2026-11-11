import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Rullo as RulloStato } from '@/ride/contract';
import { cn } from '@/lib/cn';
import { Foglio } from './Foglio';
import { rullo } from '@/sim/rullo';
import type { Pannello } from './vista';

const BLUEFY = 'https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055';

/**
 * Pedala senza un sensore di potenza (wireframe B1–B5, C5): una figura, una riga se serve, un
 * tasto pieno. Niente Dove, niente Come: senza potenza non c'è niente da scegliere.
 */
export function RulloPannello({ r, pannello }: { r: RulloStato; pannello: Pannello }) {
  const [copiato, setCopiato] = useState(false);
  const copia = () => {
    void navigator.clipboard?.writeText(location.href).then(() => setCopiato(true)).catch(() => setCopiato(false));
  };
  const pieno = 'flex h-14 w-full items-center justify-center rounded-full bg-accent px-5 text-[17px] font-semibold text-accent-ink transition active:scale-[0.98] disabled:opacity-60';
  const leggero = 'mt-2 flex h-12 w-full items-center justify-center rounded-full px-5 text-[15px] font-semibold text-ink';
  return (
    <section className="mx-auto flex w-full max-w-sm flex-col justify-center pb-6" data-testid="pedala-rullo" data-pannello={pannello}>
      <RulloFigura cerca={pannello === 'cerco'} />
      {pannello === 'mai' ? (
        <>
          <p className="mb-5 mt-4 flex justify-center gap-1.5">
            <Gettone>Rullo smart</Gettone>
            <Gettone>Potenza</Gettone>
            <Gettone>Cardio</Gettone>
          </p>
          <button type="button" className={pieno} onClick={() => void rullo.collega()} data-testid="pedala-collega">
            Collega il rullo
          </button>
        </>
      ) : null}
      {pannello === 'cerco' ? (
        <>
          <div className="mt-4 h-[46px]" />
          <button type="button" className={pieno} disabled aria-busy="true" data-testid="pedala-collega">
            <Giro /> Cerco il rullo
          </button>
          <button type="button" className={leggero} onClick={() => rullo.scollega()}>
            Annulla
          </button>
        </>
      ) : null}
      {pannello === 'fallito' ? (
        <>
          <p className="mb-5 mt-4 text-center">
            <Gettone avviso>Collegamento non riuscito</Gettone>
          </p>
          <button type="button" className={pieno} onClick={() => void rullo.collega()} data-testid="pedala-collega">
            Riprova
          </button>
          <button type="button" className={cn(leggero, 'border border-line')} onClick={() => void rullo.collega(true)} data-testid="pedala-collega-tutti">
            Cerca tutti i dispositivi
          </button>
        </>
      ) : null}
      {pannello === 'ios' ? (
        <>
          <p className="mt-4 text-center font-semibold">⚠ Su iPhone il rullo passa da Bluefy</p>
          <p className="mb-5 mt-0.5 text-center text-sm text-muted">Apri questo link in Bluefy</p>
          <a href={BLUEFY} target="_blank" rel="noreferrer" className={pieno} data-testid="pedala-bluefy">
            Scarica Bluefy
          </a>
          <button type="button" className={cn(leggero, 'border border-line')} onClick={copia} data-testid="pedala-copia">
            {copiato ? 'Link copiato' : 'Copia il link'}
          </button>
        </>
      ) : null}
      {pannello === 'manca' ? (
        <>
          <p className="mt-4 text-center font-semibold">⚠ Questo browser non vede il Bluetooth</p>
          <p className="mb-5 mt-0.5 text-center text-sm text-muted">Apri in Chrome o Edge</p>
          <button type="button" className={pieno} onClick={copia} data-testid="pedala-copia">
            {copiato ? 'Link copiato' : 'Copia il link'}
          </button>
        </>
      ) : null}
      {pannello === 'ricordato' ? (
        <>
          <p className="mb-5 mt-4 text-center text-lg font-semibold" data-testid="pedala-ricordato">
            {r.ricordato}
          </p>
          <button type="button" className={pieno} onClick={() => void rullo.ricollega()} data-testid="pedala-ricollega">
            Ricollega
          </button>
          <button type="button" className={leggero} onClick={() => void rullo.collega()}>
            Un altro rullo
          </button>
        </>
      ) : null}
      {pannello === 'cardio' ? (
        <>
          <p className="mb-5 mt-4 text-center">
            <Gettone avviso>Manca la potenza</Gettone>
          </p>
          <button type="button" className={pieno} onClick={() => void rullo.collega()} data-testid="pedala-collega">
            Collega il rullo
          </button>
        </>
      ) : null}
    </section>
  );
}

/** Il chip in alto a destra: ● il rullo collegato, ◐ la prova. Un tocco apre il foglio (C6). */
export function RulloChip({ r, onClick, className }: { r: RulloStato; onClick: () => void; className?: string }) {
  const prova = r.prova && !r.sa.potenza;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('inline-flex h-11 max-w-[60vw] shrink-0 items-center gap-2 rounded-full border border-line bg-elev px-3.5 text-sm font-semibold', className)}
      data-testid="rullo-chip"
      data-stato={prova ? 'prova' : r.stato}
    >
      <span aria-hidden="true" className={cn('h-2.5 w-2.5 shrink-0 rounded-full', prova ? 'border-2 border-accent bg-[linear-gradient(90deg,var(--accent)_50%,transparent_50%)]' : r.stato === 'collegato' ? 'bg-good' : 'bg-warn')} />
      <span className="min-w-0 whitespace-nowrap">{prova ? 'Prova' : r.nome ?? 'Rullo'}</span>
    </button>
  );
}

/** Cosa sa fare quello che è collegato, in gettoni; da qui la fascia, un altro rullo, scollega (C6). */
export function RulloFoglio({ r, open, onClose, onSpegniProva }: { r: RulloStato; open: boolean; onClose: () => void; onSpegniProva: () => void }) {
  const prova = r.prova && !r.sa.potenza;
  const riga = 'flex min-h-14 w-full items-center justify-between gap-3 border-b border-line text-left font-semibold';
  return (
    <Foglio open={open} onClose={onClose} title={prova ? 'Prova' : r.nome ?? 'Rullo'} testId="rullo-foglio">
      {prova ? (
        <div className="mt-2">
          <button
            type="button"
            className={riga}
            onClick={() => {
              onClose();
              void rullo.collega();
            }}
          >
            Collega il rullo <span aria-hidden="true">›</span>
          </button>
          <button type="button" className={cn(riga, 'border-0')} onClick={onSpegniProva} data-testid="rullo-spegni-prova">
            Spegni la prova
          </button>
        </div>
      ) : (
        <>
          <p className="my-3 flex flex-wrap gap-1.5" data-testid="rullo-sa">
            <Gettone>{`Pendenza ${r.sa.pendenza ? '✓' : '—'}`}</Gettone>
            <Gettone>{`ERG ${r.sa.erg ? '✓' : '—'}`}</Gettone>
            <Gettone>{`Potenza ${r.sa.potenza ? '✓' : '—'}`}</Gettone>
            <Gettone>{`Cadenza ${r.sa.cadenza ? '✓' : '—'}`}</Gettone>
            <Gettone>{`Cardio ${r.sa.cardio ? '✓' : '—'}`}</Gettone>
          </p>
          {!r.sa.cardio ? (
            <button type="button" className={riga} onClick={() => void rullo.aggiungiCardio()} data-testid="rullo-cardio">
              Aggiungi la fascia cardio <span aria-hidden="true">›</span>
            </button>
          ) : null}
          <button
            type="button"
            className={riga}
            onClick={() => {
              onClose();
              void rullo.collega();
            }}
          >
            Un altro rullo <span aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            className={cn(riga, 'border-0 text-muted')}
            onClick={() => {
              rullo.scollega();
              onClose();
            }}
            data-testid="rullo-scollega"
          >
            Scollega
          </button>
        </>
      )}
      <Link to="/impostazioni" onClick={onClose} className="mt-1 flex h-11 items-center text-sm font-semibold text-muted">
        Impostazioni
      </Link>
    </Foglio>
  );
}

export function Gettone({ children, avviso }: { children: ReactNode; avviso?: boolean }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', avviso ? 'border-warn/50 text-warn' : 'border-line text-ink')}>
      {avviso ? '⚠ ' : ''}
      {children}
    </span>
  );
}

function Giro() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-accent-ink/40 border-t-accent-ink" />;
}

/** La figura: la ruota dietro sul rullo, e le onde del Bluetooth quando cerca. */
function RulloFigura({ cerca }: { cerca: boolean }) {
  return (
    <svg viewBox="0 0 320 200" className="mx-auto block h-auto w-full max-w-[320px]" aria-hidden="true" data-testid="rullo-figura">
      <rect x="0" y="0" width="320" height="200" rx="24" fill="var(--elev)" />
      {/* il pavimento */}
      <path d="M24 172h272" stroke="var(--line)" strokeWidth="2" />
      {/* il rullo: la base e il volano */}
      <path d="M118 172l22-40h56l22 40" fill="none" stroke="var(--muted)" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="138" y="104" width="62" height="36" rx="12" fill="var(--elev2)" stroke="var(--muted)" strokeWidth="3" />
      <circle cx="169" cy="122" r="9" fill="none" stroke="var(--accent)" strokeWidth="3" />
      {/* la bici: telaio e ruota davanti */}
      <circle cx="78" cy="130" r="36" fill="none" stroke="var(--ink)" strokeOpacity="0.85" strokeWidth="4" />
      <path d="M78 130l40-56h48l3 48M118 74l-6-14h-18M166 74l12-16h14M118 74l51 48" fill="none" stroke="var(--ink)" strokeOpacity="0.85" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      {/* il segnale */}
      <g fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" className={cerca ? 'animate-pulse' : undefined}>
        <path d="M232 64a24 24 0 0 1 0 34" />
        <path d="M246 52a42 42 0 0 1 0 58" opacity="0.7" />
        <path d="M260 40a60 60 0 0 1 0 82" opacity="0.4" />
      </g>
    </svg>
  );
}
