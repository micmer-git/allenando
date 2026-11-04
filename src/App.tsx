import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { BottomNav, SideNav } from '@/components/Nav';
import { useI18n } from '@/i18n';
import { OnboardingPage } from '@/pages/Onboarding';
import { HomePage } from '@/pages/Home';
import { WorkoutsPage } from '@/pages/Workouts';
import { WorkoutEditorPage } from '@/pages/WorkoutEditor';
import { HistoryPage } from '@/pages/History';
import { RideDetailPage } from '@/pages/RideDetail';
import { LoadPage } from '@/pages/Load';
import { ImportPage } from '@/pages/Import';
import { ClimbsPage } from '@/pages/Climbs';
import { ClimbDetailPage } from '@/pages/ClimbDetail';
import { RidesPage } from '@/pages/Rides';
import { ReplaySetupPage } from '@/pages/ReplaySetup';
import { ProfilePage } from '@/pages/Profile';
import { WorldPage } from '@/pages/World';
import { GaragePage } from '@/pages/Garage';
import { AchievementsPage } from '@/pages/Achievements';
import { LeaderboardsPage } from '@/pages/Leaderboards';
import { SessionsPage } from '@/pages/Sessions';
import { MePage } from '@/pages/Me';
import { Wordmark } from '@/components/ui';
import { OfflineBanner } from '@/components/Install';
import { useApp } from '@/store/useApp';

const RidePage = lazy(() => import('@/pages/Ride').then((mod) => ({ default: mod.RidePage })));
const PlansPage = lazy(() => import('@/pages/Plans').then((mod) => ({ default: mod.PlansPage })));

export function App() {
  const hydrate = useApp((s) => s.hydrate);
  const hydrated = useApp((s) => s.hydrated);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  if (!hydrated) return <Splash />;
  return (
    <>
      <ThemeSync />
      <Routes>
        <Route element={<Shell />}>
          <Route path="/start" element={<OnboardingPage />} />
          <Route path="/" element={<HomePage />} />
          <Route path="/ride" element={<Suspense fallback={<Splash />}><RidePage /></Suspense>} />
          <Route path="/workouts" element={<WorkoutsPage />} />
          <Route path="/workouts/edit/:id" element={<WorkoutEditorPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<RideDetailPage />} />
          <Route path="/load" element={<LoadPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/mondo" element={<WorldPage />} />
          <Route path="/salite" element={<ClimbsPage />} />
          <Route path="/salite/:id" element={<ClimbDetailPage />} />
          <Route path="/giri" element={<RidesPage />} />
          <Route path="/giri/:id" element={<ReplaySetupPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/garage" element={<GaragePage />} />
          <Route path="/traguardi" element={<AchievementsPage />} />
          <Route path="/classifiche" element={<LeaderboardsPage />} />
          <Route path="/sessioni" element={<SessionsPage />} />
          <Route path="/tu" element={<MePage />} />
          <Route path="/programmi" element={<Suspense fallback={<Splash />}><PlansPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
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
        <OfflineBanner />
        {memoryOnly ? <p className="bg-warn/15 px-4 py-2 text-sm text-warn">{t('app.memory')}</p> : null}
        <Outlet />
        <BottomNav />
      </div>
    </div>
  );
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
