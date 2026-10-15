import { lazy, Suspense, useEffect, useState } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import Layout from '@/components/layout/Layout';
import LoginPage from '@/pages/LoginPage';
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const SuppliersPage = lazy(() => import('@/pages/suppliers/SuppliersPage'));
const SupplierCardPage = lazy(() => import('@/pages/suppliers/SupplierCardPage'));
const BuyersPage = lazy(() => import('@/pages/buyers/BuyersPage'));
const BuyerCardPage = lazy(() => import('@/pages/buyers/BuyerCardPage'));
const TasksPage = lazy(() => import('@/pages/tasks/TasksPage'));
const TaskCardPage = lazy(() => import('@/pages/tasks/TaskCardPage'));
const AnalyticsPage = lazy(() => import('@/pages/analytics/AnalyticsPage'));
const PlanFactPage = lazy(() => import('@/pages/planfact/PlanFactPage'));
const SupportPage = lazy(() => import('@/pages/support/SupportPage'));
const LeadsPage = lazy(() => import('@/pages/leads/LeadsPage'));
const LeadsExportPage = lazy(() => import('@/pages/leads/LeadsExportPage'));
const EntityExportPage = lazy(() => import('@/pages/EntityExportPage'));
const TicketCardPage = lazy(() => import('@/pages/support/TicketCardPage'));
const MediaPage = lazy(() => import('@/pages/media/MediaPage'));
const PricingPage = lazy(() => import('@/pages/pricing/PricingPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const DatabasePage = lazy(() => import('@/pages/database/DatabasePage'));
const ServerPage = lazy(() => import('@/pages/server/ServerPage'));
const KnowledgePage = lazy(() => import('@/pages/knowledge/KnowledgePage'));
const ManagerDashboardPage = lazy(() => import('@/pages/ManagerDashboardPage'));
import NotFound from '@/pages/NotFound';
import { getCurrentUser, reconcileSession, canAccess, canSeeSupplier, canSeeBuyer, canSeeTicket, isAdmin } from '@/lib/auth';
import { getStore } from '@/lib/store';
import type { AppUser } from '@/types';
import { initRemoteSync } from '@/lib/store';
import { startRealtimeSync } from '@/lib/realtime';
import { isSupabaseConfigured } from '@/lib/supabase';

/** Первый доступный менеджеру раздел — куда редиректить при отказе в доступе (без петель). */
function firstAllowedPath(): string {
  const order: Array<keyof AppUser['permissions']> =
    ['dashboard', 'planfact', 'suppliers', 'buyers', 'tasks', 'support', 'leads', 'media', 'knowledge'];
  const paths: Record<string, string> = {
    dashboard: '/dashboard', suppliers: '/suppliers', buyers: '/buyers', tasks: '/tasks',
    support: '/support', leads: '/leads', media: '/media', planfact: '/planfact', analytics: '/analytics', knowledge: '/knowledge',
  };
  return paths[order.find(s => canAccess(s)) ?? ''] || '/login';
}

function IndexRedirect() { return <Navigate to={firstAllowedPath()} replace />; }

/** Гард раздела: менеджер без галочки — на первый доступный раздел. */
function RequireAccess({ section, children }: { section: keyof AppUser['permissions']; children: React.ReactNode }) {
  if (!canAccess(section)) return <Navigate to={firstAllowedPath()} replace />;
  return <>{children}</>;
}

/** Карточка сущности вне фильтров менеджера (тип/город) — обратно к списку. */
function SupplierGuard({ children }: { children: React.ReactNode }) {
  const { id } = useParams();
  const s = getStore().suppliers.find(x => x.id === id);
  if (s && !canSeeSupplier(s)) return <Navigate to="/suppliers" replace />;
  return <>{children}</>;
}
function BuyerGuard({ children }: { children: React.ReactNode }) {
  const { id } = useParams();
  const b = getStore().buyers.find(x => x.id === id);
  if (b && !canSeeBuyer(b)) return <Navigate to="/buyers" replace />;
  return <>{children}</>;
}
function TicketGuard({ children }: { children: React.ReactNode }) {
  const { id } = useParams();
  const t = getStore().tickets.find(x => x.id === id);
  if (t && !canSeeTicket(t)) return <Navigate to="/support" replace />;
  return <>{children}</>;
}

/** Предпросмотр дашборда менеджера из Настроек — только для администратора (ТЗ v1.21.3). */
function DashboardPreviewRoute() {
  const { type } = useParams();
  if (!isAdmin()) return <Navigate to="/dashboard" replace />;
  return <ManagerDashboardPage previewType={type === 'moz' ? 'moz' : 'mop'} />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Runs once before the app renders: pulls the latest data from Supabase
 * into the local cache (see src/lib/store.ts) and makes sure the local
 * "logged in" state agrees with the real Supabase Auth session. A no-op
 * (resolves instantly) when Supabase isn't configured, so local/demo mode
 * starts exactly as fast as before. Once ready, starts real-time sync
 * (src/lib/realtime.ts) for the lifetime of the app.
 *
 * Public routes (/forms/*, /s/*) never reach this code at all:
 * src/main.tsx serves them a separate lightweight PublicApp instead.
 */
function useBootstrap() {
  const [ready, setReady] = useState(!isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // АУДИТ: без env-переменных в проде обязаны упасть ГРОМКО, а не молча
      // работать в демо-режиме с общим паролем admin123 (иначе при опечатке
      // в конфигурации менеджеры неделями работают в localStorage и теряют
      // данные). Демо включается только явным VITE_DEMO_MODE=true.
      if (import.meta.env.VITE_DEMO_MODE !== 'true') {
        throw new Error('Supabase не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY, либо явно включите VITE_DEMO_MODE=true для демо-режима.');
      }
      return;
    }
    let cancelled = false;
    let stopRealtime: (() => void) | null = null;
    (async () => {
      await reconcileSession();
      await initRemoteSync();
      if (cancelled) return;
      setReady(true);
      stopRealtime = startRealtimeSync();
    })();
    return () => {
      cancelled = true;
      if (stopRealtime) stopRealtime();
    };
  }, []);

  return ready;
}

/** Дашборд выбираем по факту текущего пользователя — без «мигания» МОП у админа (ТЗ v1.22.2). */
function DashboardRoute() {
  const user = getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  return user.role === 'admin' ? <Dashboard /> : <ManagerDashboardPage />;
}

export default function App() {
  const ready = useBootstrap();

  /** Мгновенный фолбэк ленивых чанков — спиннер без задержки. */
  const pageFallback = (
    <div className="min-h-screen flex items-center justify-center bg-brand-gray">
      <div className="w-8 h-8 border-2 border-brand-red border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-gray">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-red border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Синхронизация с сервером...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster position="top-right" richColors closeButton />
      <ErrorBoundary>
      <Suspense fallback={pageFallback}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<IndexRedirect />} />
          <Route path="dashboard" element={<RequireAccess section="dashboard"><DashboardRoute /></RequireAccess>} />
          <Route path="suppliers" element={<RequireAccess section="suppliers"><SuppliersPage /></RequireAccess>} />
          <Route path="suppliers/:id" element={<RequireAccess section="suppliers"><SupplierGuard><SupplierCardPage /></SupplierGuard></RequireAccess>} />
          <Route path="buyers" element={<RequireAccess section="buyers"><BuyersPage /></RequireAccess>} />
          <Route path="buyers/:id" element={<RequireAccess section="buyers"><BuyerGuard><BuyerCardPage /></BuyerGuard></RequireAccess>} />
          <Route path="tasks" element={<RequireAccess section="tasks"><TasksPage /></RequireAccess>} />
          <Route path="tasks/:id" element={<RequireAccess section="tasks"><TaskCardPage /></RequireAccess>} />
          <Route path="support" element={<RequireAccess section="support"><SupportPage /></RequireAccess>} />
          <Route path="leads" element={<RequireAccess section="leads"><LeadsPage /></RequireAccess>} />
          <Route path="leads-export/:taskId" element={<RequireAccess section="leads"><LeadsExportPage /></RequireAccess>} />
          <Route path="entity-export/:taskId" element={<RequireAccess section="suppliers"><EntityExportPage /></RequireAccess>} />
          <Route path="support/:id" element={<RequireAccess section="support"><TicketGuard><TicketCardPage /></TicketGuard></RequireAccess>} />
          <Route path="media" element={<RequireAccess section="media"><MediaPage /></RequireAccess>} />
        <Route path="pricing" element={<RequireAccess section="pricing"><PricingPage /></RequireAccess>} />
          <Route path="planfact" element={<RequireAccess section="planfact"><PlanFactPage /></RequireAccess>} />
          <Route path="analytics" element={<RequireAccess section="analytics"><AnalyticsPage /></RequireAccess>} />
          <Route path="dashboard-preview/:type" element={<RequireAuth><DashboardPreviewRoute /></RequireAuth>} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="knowledge" element={<RequireAccess section="knowledge"><KnowledgePage /></RequireAccess>} />
          <Route path="database" element={<DatabasePage />} />
          <Route path="server" element={<ServerPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </>
  );
}
