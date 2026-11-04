import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { formatDuration, formatKm } from '@/domain/format';
import { clearCheckpoint, loadCheckpoint, resumePath, rideFromCheckpoint, type RideCheckpoint } from '@/sim/recovery';
import { useApp } from '@/store/useApp';

/**
 * «Hai un giro a metà»: se l'ultima pedalata si è interrotta (scheda chiusa, Safari caduto,
 * telefono spento) il suo punto di ripresa è ancora lì. Sta sopra qualunque pagina, tranne la
 * corsa, che fa la stessa domanda nel suo velo prima di partire. Niente 3D qui: è leggero.
 */
export function RideRecovery() {
  const hydrated = useApp((s) => s.hydrated);
  const onboarded = useApp((s) => s.profile.onboarded);
  const location = useLocation();
  const navigate = useNavigate();
  const [cp, setCp] = useState<RideCheckpoint | null>(null);
  const away = location.pathname.startsWith('/ride') || location.pathname === '/start';
  useEffect(() => {
    // tornando dalla corsa la risposta vecchia non vale: si richiede, e intanto non si mostra niente
    setCp(null);
    if (!hydrated || away) return;
    let alive = true;
    void loadCheckpoint()
      .then((c) => alive && setCp(c))
      .catch(() => alive && setCp(null));
    return () => {
      alive = false;
    };
  }, [hydrated, away, location.pathname]);
  if (!cp || !onboarded || away) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-3 md:items-center" data-testid="ride-recovery">
      <section role="dialog" aria-modal="true" aria-labelledby="recovery-title" className="rise-in w-full max-w-md rounded-3xl bg-elev p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <RecoveryCard
          cp={cp}
          onResume={() => navigate(resumePath(cp))}
          onDone={() => setCp(null)}
        />
      </section>
    </div>
  );
}

/** La domanda, coi numeri del giro a metà: riprendi, salvalo com'è, o scartalo (con conferma). */
export function RecoveryCard({ cp, onResume, onDone, saveLabel = 'Salva com’è' }: { cp: RideCheckpoint; onResume: () => void; onDone: () => void; saveLabel?: string }) {
  const saveRide = useApp((s) => s.saveRide);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const e = cp.engine;
  return (
    <div className="text-left">
      <h2 id="recovery-title" className="font-display text-3xl leading-tight">
        Hai un giro a metà
      </h2>
      <p className="mt-1 break-words font-semibold">{cp.name}</p>
      <p className="num text-sm text-muted">
        {formatDuration(e.elapsed)} · {formatKm(e.base + e.distance)} km
      </p>
      {ask ? (
        <div className="mt-4 flex flex-col gap-2" data-testid="recovery-confirm">
          <p className="text-sm font-semibold">Scartarlo? Non torna più.</p>
          <Button
            variant="danger"
            data-testid="recovery-discard-yes"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void clearCheckpoint().finally(onDone);
            }}
          >
            Scarta il giro
          </Button>
          <Button variant="ghost" onClick={() => setAsk(false)}>
            Tienilo
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <Button data-testid="recovery-resume" className="h-14 text-lg" onClick={onResume}>
            Riprendi
          </Button>
          <Button
            variant="ghost"
            data-testid="recovery-save"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void saveRide(rideFromCheckpoint(cp))
                .then(() => clearCheckpoint())
                .finally(onDone);
            }}
          >
            {saveLabel}
          </Button>
          <button type="button" className="h-11 text-sm font-semibold text-muted" data-testid="recovery-discard" onClick={() => setAsk(true)}>
            Scarta
          </button>
        </div>
      )}
    </div>
  );
}
