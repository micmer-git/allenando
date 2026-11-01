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
import { SleepPage } from '@/pages/Sleep';
import { ProfilePage } from '@/pages/Profile';
import { useApp } from '@/store/useApp';

const RidePage = lazy(() => import('@/pages/Ride').then((mod) => ({ default: mod.RidePage })));

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
          <Route path="/sleep" element={<SleepPage />} />
          <Route path="/profile" element={<ProfilePage />} />
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
  if (!onboarded && location.pathname !== '/start') return <Navigate to="/start" replace />;
  if (onboarded && location.pathname === '/start') return <Navigate to="/" replace />;
  const bare = location.pathname === '/start' || location.pathname.startsWith('/ride');
  if (bare) return <Outlet />;
  return (
    <div className="md:grid md:grid-cols-[240px_1fr]">
      <SideNav />
      <div>
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
    root.dataset.camilla = settings.camilla ? 'on' : 'off';
    root.lang = settings.locale;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'light' ? '#f3efe6' : '#090a0e');
  }, [settings]);
  return null;
}

function Splash() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="font-display text-5xl tracking-tight">
          Camilla <span className="text-accent">Ride</span>
        </p>
        <p className="mt-3 text-muted">{t('app.loading')}</p>
      </div>
    </div>
  );
}
