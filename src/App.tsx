import { lazy, Suspense, useEffect, useReducer, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useMatch } from 'react-router-dom';
import { RideView, rideKey, type ActiveRide } from '@/ride/activeRide';
import { RideRecovery } from '@/pages/RideRecovery';
import { formatDuration, formatKm } from '@/domain/format';
import { BottomNav, SideNav } from '@/components/Nav';
import { useI18n } from '@/i18n';
import { OnboardingPage } from '@/pages/Onboarding';
import { PedalaPage } from '@/pages/Pedala';
import { WorkoutsPage } from '@/pages/Workouts';
import { WorkoutEditorPage } from '@/pages/WorkoutEditor';
import { HistoryPage } from '@/pages/History';
import { RideDetailPage } from '@/pages/RideDetail';
import { LoadPage } from '@/pages/Load';
import { ImportPage } from '@/pages/Import';
import { ClimbDetailPage } from '@/pages/ClimbDetail';
import { ImpostazioniPage } from '@/pages/Impostazioni';
import { GaragePage } from '@/pages/Garage';
import { AchievementsPage } from '@/pages/Achievements';
import { LeaderboardsPage } from '@/pages/Leaderboards';
import { SessionsPage } from '@/pages/Sessions';
import { MePage } from '@/pages/Me';
import { Wordmark } from '@/components/ui';
import { OfflineBanner } from '@/components/Install';
import { useApp } from '@/store/useApp';
import { redirectFor } from '@/lib/redirect';

const SurveyPage = lazy(() => import('@/pages/Confronto'));
const RidePage = lazy(() => import('@/pages/Ride').then((mod) => ({ default: mod.RidePage })));
const PlansPage = lazy(() => import('@/pages/Plans').then((mod) => ({ default: mod.PlansPage })));

export function App() {
  const hydrate = useApp((s) => s.hydrate);
  const hydrated = useApp((s) => s.hydrated);
  const onboarded = useApp((s) => s.profile.onboarded);
  const location = useLocation();
  const [active, setActive] = useState<ActiveRide | null>(null);
  const inRide = useMatch('/ride') !== null;
  const switching = inRide && active !== null && rideKey(location.search) !== rideKey(active.search);
  const rideLocation = inRide && !switching ? location : active ? { pathname: '/ride', search: active.search } : null;
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  if (!hydrated) return <Splash />;
  return (
    <>
      <ThemeSync />
      {onboarded && rideLocation ? (
        <RideView.Provider value={{ visible: inRide && !switching, setActive }}>
          <Routes location={rideLocation}>
            <Route path="/ride" element={<Suspense fallback={inRide ? <Splash /> : null}><RidePage key={rideKey(rideLocation.search)} /></Suspense>} />
          </Routes>
        </RideView.Provider>
      ) : null}
      {active && !inRide ? <BackToRide ride={active} /> : null}
      {switching && <SwitchRide ride={active} onSaved={() => setActive(null)} />}
      <Routes>
        <Route path="/confronto" element={<Suspense fallback={<Splash />}><SurveyPage /></Suspense>} />
        <Route element={<Shell />}>
          <Route path="/start" element={<OnboardingPage />} />
          <Route path="/" element={<PedalaPage />} />
          <Route path="/ride" element={null} />
          <Route path="/workouts" element={<WorkoutsPage />} />
          <Route path="/workouts/edit/:id" element={<WorkoutEditorPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<RideDetailPage />} />
          <Route path="/load" element={<LoadPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/salite/:id" element={<ClimbDetailPage />} />
          <Route path="/impostazioni" element={<ImpostazioniPage />} />
          {/* le rotte di prima del riordino (piano U, § 2.6): ognuna porta dove la cosa sta adesso */}
          {['/mondo', '/salite', '/giri', '/giri/:id', '/profile'].map((path) => (
            <Route key={path} path={path} element={<Redirect />} />
          ))}
          <Route path="/garage" element={<GaragePage />} />
          <Route path="/traguardi" element={<AchievementsPage />} />
          <Route path="/classifiche" element={<LeaderboardsPage />} />
          <Route path="/sessioni" element={<SessionsPage />} />
          <Route path="/tu" element={<MePage />} />
          <Route path="/programmi" element={<Suspense fallback={<Splash />}><PlansPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      {!active ? <RideRecovery /> : null}
    </>
  );
}

function BackToRide({ ride }: { ride: ActiveRide }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const { engine } = ride;
  useEffect(() => engine.subscribe(redraw), [engine]);
  return (
    <Link to={{ pathname: '/ride', search: ride.search }} data-testid="back-to-live-ride"
      className="sticky top-0 z-40 flex min-h-12 items-center justify-between gap-3 bg-accent px-4 py-2 text-sm text-accent-ink">
      <span className="min-w-0 truncate"><strong>{ride.title}</strong> · {engine.phase === 'paused' ? 'In pausa' : formatDuration(engine.elapsed)} · {formatKm(engine.odometer)} km</span>
      <strong className="shrink-0">{engine.phase === 'finished' ? 'Vedi riepilogo' : 'Torna al giro'} →</strong>
    </Link>
  );
}

function SwitchRide({ ride, onSaved }: { ride: ActiveRide; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-6">
      <h1 className="font-display text-3xl">Cambiare giro?</h1>
      <p>Stai pedalando su {ride.title}. Puoi salvare questo giro e partire con quello appena scelto.</p>
      <button disabled={saving} className="min-h-12 rounded-full bg-accent font-semibold text-accent-ink"
        onClick={async () => {
          setSaving(true);
          setFailed(false);
          try { await ride.finish(); onSaved(); }
          catch { setSaving(false); setFailed(true); }
        }}>
        {saving ? 'Salvataggio…' : 'Salva e cambia giro'}
      </button>
      {failed && <p role="alert">Salvataggio non riuscito. Torna al giro per verificare il riepilogo.</p>}
      <Link to={{ pathname: '/ride', search: ride.search }} className="grid min-h-12 place-items-center font-semibold">Torna al giro</Link>
    </main>
  );
}

function Shell() {
  const onboarded = useApp((s) => s.profile.onboarded);
  const memoryOnly = useApp((s) => s.memoryOnly);
  const location = useLocation();
  const { t } = useI18n();
  // chi arriva da un link (un invito in una stanza) ci torna dopo il profilo
  const next = (location.state as { next?: string } | null)?.next;
  if (!onboarded && location.pathname !== '/start') return <Navigate to="/start" replace state={{ next: `${location.pathname}${location.search}` }} />;
  if (onboarded && location.pathname === '/start') return <Navigate to={next && next.startsWith('/') ? next : '/'} replace />;
  const bare = location.pathname === '/start' || location.pathname.startsWith('/ride');
  if (bare) return <Outlet />;
  return (
    <div className="rail:grid rail:grid-cols-[76px_minmax(0,1fr)] wide:grid wide:grid-cols-[240px_minmax(0,1fr)]">
      <SideNav />
      <div>
        <OfflineBanner hidden={location.pathname === '/'} />
        {memoryOnly ? <p className="bg-warn/15 px-4 py-2 text-sm text-warn">{t('app.memory')}</p> : null}
        <Outlet />
        <BottomNav />
      </div>
    </div>
  );
}

/** Una rotta vecchia: si va dove la cosa sta adesso, sostituendo la voce della cronologia. */
function Redirect() {
  const location = useLocation();
  return <Navigate to={redirectFor(location.pathname, location.search) ?? '/'} replace />;
}

function ThemeSync() {
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.lang = settings.locale;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'light' ? '#f6f3ea' : '#0c0b09');
  }, [settings]);
  return null;
}

function Splash() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <Wordmark className="text-5xl" />
        <p className="mt-3 text-muted">{t('app.loading')}</p>
      </div>
    </div>
  );
}
