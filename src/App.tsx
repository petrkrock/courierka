import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { reconcileSession, canAccess } from './lib/auth';
import { initRemoteSync } from './lib/store';
import { startRealtime, stopRealtime } from './lib/realtime';
import type { AppUser } from './types';
import { Loader2 } from 'lucide-react';
import LoginPage from './pages/LoginPage';
import NotFound from './pages/NotFound';
import DeliveryPage from './pages/delivery/DeliveryPage';
import SettingsPage from './pages/SettingsPage';

const DeliverySupplierCardPage = lazy(() => import('./pages/delivery/DeliverySupplierCardPage'));

/** Гард: пропускает только пользователей с доступом к разделу. Админу — всё. */
function RequireAccess({ section, children }: { section: keyof AppUser['permissions']; children: ReactNode }) {
  const location = useLocation();
  if (!canAccess(section)) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/**
 * Бутстрап: перепроверяем сессию, затем инициализируем синхронизацию
 * с сервером и поднимаем realtime-подписки (см. lib/realtime.ts).
 */
function useAppBootstrap() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reconcileSession();
        await initRemoteSync();
      } catch (err) {
        console.error('[app] bootstrap failed:', err);
      } finally {
        if (!cancelled) setReady(true);
      }
      try {
        startRealtime();
      } catch (err) {
        console.error('[app] realtime start failed:', err);
      }
    })();
    return () => { cancelled = true; stopRealtime(); };
  }, []);
  return ready;
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-brand-red" />
    </div>
  );
}

export default function App() {
  const ready = useAppBootstrap();
  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-brand-gray">
        <Loader2 size={40} className="animate-spin text-brand-red" />
      </div>
    );
  }
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/delivery" replace />} />
              <Route path="/delivery" element={<RequireAccess section="delivery"><DeliveryPage /></RequireAccess>} />
              <Route path="/delivery/suppliers/:id" element={<RequireAccess section="delivery"><DeliverySupplierCardPage /></RequireAccess>} />
              <Route path="/settings" element={<RequireAccess section="delivery"><SettingsPage /></RequireAccess>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
