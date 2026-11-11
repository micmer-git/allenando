import type { WorldSession } from '@/open/session';

/**
 * I passaggi in corsa (piano U, F8; wireframe H3, O3): «Giro 2 di 2» accanto al titolo su un
 * anello, «Tratta 2 di 2» sul percorso aperto. Niente se il passaggio è uno solo.
 */
export function GiroBadge({ session }: { session: WorldSession | null }) {
  if (!session || session.giri <= 1) return null;
  const parola = session.chiuso ? 'Giro' : 'Tratta';
  return (
    <span className="num ml-1.5 inline-flex translate-y-[-2px] items-center whitespace-nowrap rounded-full border border-line px-2 py-px align-middle font-sans text-xs font-semibold normal-case" data-testid="ride-giro" data-giro={session.giro} data-giri={session.giri}>
      {`${parola} ${session.giro} di ${session.giri}`}
    </span>
  );
}

/** Il tempo dell'ultimo passaggio chiuso: «Giro 1 · 28:51». */
export function UltimoGiro({ session, format }: { session: WorldSession | null; format: (sec: number) => string }) {
  const g = session?.giriFatti[session.giriFatti.length - 1];
  if (!session || session.giri <= 1 || !g) return null;
  return (
    <p className="num rounded-2xl bg-bg/75 px-3 py-1.5 text-xs font-semibold backdrop-blur-md" data-testid="ride-giro-tempo">
      {`${session.chiuso ? 'Giro' : 'Tratta'} ${g.giro} · ${format(g.sec)}`}
    </p>
  );
}
