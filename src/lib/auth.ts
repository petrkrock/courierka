import type { AppUser, AuthSession, UserAccess } from '@/types';
import { EMPTY_ACCESS } from '@/types';
import { getStore, updateStore, initRemoteSync, clearLocalStoreCache } from './store';
import { isSupabaseConfigured, signIn as supabaseSignIn, signOut as supabaseSignOut, getSession } from './supabase';
import { startRealtimeSync, stopRealtimeSync } from './realtime';

const SESSION_KEY = 'vz_crm_session';

export function getCurrentUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: AuthSession = JSON.parse(raw);
    if (new Date(session.expiresAt) < new Date()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    // Сессия перепроверяется по актуальному профилю: уволенный или заблокированный
    // пользователь теряет доступ немедленно, а не по истечении срока сессии (ТЗ п.1).
    const fresh = getStore().settings.users.find(
      u => u.id === session.user.id || u.email.toLowerCase() === session.user.email.toLowerCase(),
    );
    if (!fresh || fresh.status !== 'active') {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return fresh;
  } catch {
    return null;
  }
}

function persistSession(user: AppUser) {
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);
  const session: AuthSession = { user, expiresAt: expires.toISOString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Signs the user in.
 *
 * - Without Supabase configured: local demo mode — checks email/password
 *   against Настройки → Пользователи (settings.users), exactly as before.
 * - With Supabase configured: authenticates for real against Supabase Auth
 *   (so Row Level Security policies that check `auth.role() = 'authenticated'`
 *   actually work), then looks up the matching CRM profile — role and
 *   section permissions — by email in settings.users. A Supabase Auth
 *   account with no matching CRM profile is treated as "not provisioned"
 *   and is signed back out — see README.md § "Первый администратор" for
 *   how to create the first admin.
 */
export async function login(email: string, password: string): Promise<AppUser | null> {
  if (isSupabaseConfigured()) {
    let authUserId: string | undefined;
    try {
      const data = await supabaseSignIn(email, password);
      authUserId = data.user?.id;
    } catch {
      return null;
    }

    // App.tsx's bootstrap only pulls Supabase data once, on the very first
    // page load — before this sign-in, that pull always fails RLS (no
    // session yet) and silently no-ops, so the local cache is still empty
    // defaults at this point. Logging in is a client-side route change,
    // not a page reload, so nothing else would ever trigger a real pull —
    // without this call, every fresh login would show a blank/stale CRM
    // until the person manually refreshes the page. Pull now, before
    // looking up the profile below, so the profile (and the id-migration
    // that follows) both act on the real, current data — not the
    // pre-login placeholder.
    await initRemoteSync();

    const store = getStore();
    let profile = store.settings.users.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.status === 'active',
    );
    if (!profile) {
      // Authenticated with Supabase but no CRM role/permissions provisioned.
      await supabaseSignOut();
      return null;
    }
    // Self-healing migration: a profile created before this account had a
    // real Supabase Auth login (the bootstrap admin from README.md's "Первый
    // администратор" step, or anyone provisioned in old local-demo mode)
    // keeps its original local id (e.g. "admin-1") — never a real UUID.
    // Every new supplier/buyer/task this person creates stamps that id into
    // created_by, which is a UUID column with a foreign key to auth.users;
    // pushing it fails outright with Postgres error 22P02 (invalid input
    // syntax for type uuid). Now that we know the real, authoritative UUID
    // from this successful sign-in, correct the profile's id to match it —
    // once, here, so every record created from this point on is stamped
    // with a real, valid UUID instead.
    if (authUserId && profile.id !== authUserId) {
      const oldId = profile.id;
      updateStore(s => ({
        ...s,
        settings: {
          ...s.settings,
          users: s.settings.users.map(u => u.id === oldId ? { ...u, id: authUserId as string } : u),
        },
      }));
      profile = { ...profile, id: authUserId };
    }
    persistSession(profile);
    // App.tsx's bootstrap already started realtime once, earlier in this
    // same session, before Supabase Auth had a session to authorize these
    // channels with (same root cause as the pull above). Restart now so
    // every subscription opens under the real, current auth context —
    // startRealtimeSync() tears down whatever's already running first, so
    // this is safe to call regardless of what App.tsx already did.
    startRealtimeSync();
    return profile;
  }

  // Local demo mode (no Supabase configured).
  // SECURITY: fail closed — пустой/короткий пароль никогда не принимается,
  // сравнение за постоянное время (против тривиального timing-перебора).
  if (!password || password.length < 6) return null;
  const store = getStore();
  const user = store.settings.users.find(
    u => u.email.toLowerCase() === email.toLowerCase() && u.status === 'active',
  );
  // После синхронизации с Supabase в store паролей нет (sanitizeSettings) —
  // тогда локальный вход невозможен, это осознанное поведение: реальный
  // вход идёт через Supabase Auth.
  if (!user || !user.password) return null;
  const a = password, b = user.password;
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff !== 0) return null;
  persistSession(user);
  return user;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  clearLocalStoreCache();
  if (isSupabaseConfigured()) {
    stopRealtimeSync();
    void supabaseSignOut();
  }
}

/**
 * Call once at app startup alongside initRemoteSync(). If Supabase is
 * configured but the browser lost its local session cookie while a
 * Supabase Auth session is still valid (or vice-versa), this keeps the two
 * in sync so the user isn't stuck logged out — or, worse, shown CRM data
 * while no longer authenticated against Supabase (which RLS would reject
 * anyway, surfacing as failed requests instead of a clean login screen).
 */
export async function reconcileSession(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const [supabaseSession, localUser] = [await getSession(), getCurrentUser()];
  if (!supabaseSession && localUser) {
    // Supabase session expired/revoked server-side — force re-login.
    localStorage.removeItem(SESSION_KEY);
  }
}

export function isAdmin(): boolean {
  const user = getCurrentUser();
  return user?.role === 'admin';
}

export function canAccess(section: keyof AppUser['permissions']): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === 'admin') return true;
  // Аналитика — только администратор (ТЗ v1.21.0): менеджеру не выдаётся,
  // даже если у старого профиля осталась галочка analytics.
  if (section === 'analytics') return false;
  return user.permissions[section] === true;
}

export function canExport(): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return user.role === 'admin';
}

/**
 * Whether the current user may permanently or soft-delete/archive records
 * (suppliers, buyers, tasks, tickets, media, knowledge base). Managers can
 * create and edit everything they have section access to — only admins can
 * remove data. Named separately from isAdmin() so call sites read as
 * "can this action happen" rather than "is this an admin", even though the
 * two happen to coincide today.
 */
export function canDelete(): boolean {
  return isAdmin();
}

// ── ФИЛЬТРЫ ВИДИМОСТИ МЕНЕДЖЕРА (ТЗ «Управление пользователями», п.2) ──
// Пустой массив внутри access = без ограничений по этому измерению;
// null целиком = текущий пользователь — админ (видит всё).

/** Фильтры текущего менеджера; null = без ограничений. */
export function getAccessFilters(): UserAccess | null {
  const user = getCurrentUser();
  if (!user || user.role === 'admin') return null;
  // Нормализация (v1.20.9): у пользователей, созданных до появления новых измерений,
  // в access нет новых ключей — мержим с EMPTY_ACCESS, чтобы не было undefined.includes().
  return { ...EMPTY_ACCESS, ...(user.access || {}) };
}

export function canSeeSupplier(s: { type: string; city: string; responsibleId?: string }): boolean {
  const f = getAccessFilters();
  if (!f) return true;
  // Запись без ответственного доступна всем менеджерам (ТЗ), помечается ★ в списках
  if (!s.responsibleId) return true;
  return (f.supplierTypes.length === 0 || f.supplierTypes.includes(s.type))
    && (f.supplierCities.length === 0 || f.supplierCities.includes(s.city));
}

export function canSeeBuyer(b: { type: string; city: string; responsibleId?: string }): boolean {
  const f = getAccessFilters();
  if (!f) return true;
  if (!b.responsibleId) return true; // без ответственного — всем (ТЗ)
  return (f.buyerTypes.length === 0 || f.buyerTypes.includes(b.type))
    && (f.buyerCities.length === 0 || f.buyerCities.includes(b.city));
}

export function canSeeTicket(t: { type?: string }): boolean {
  const f = getAccessFilters();
  if (!f) return true;
  return f.ticketTypes.length === 0 || f.ticketTypes.includes(t.type || '');
}

export function canSeePlanCity(cityName?: string): boolean {
  const f = getAccessFilters();
  if (!f) return true;
  return f.planCities.length === 0 || (cityName ? f.planCities.includes(cityName) : false);
}

// ── ФИЛЬТРЫ РАЗДЕЛОВ Дашборд / Задачи / Медиа сервис / Аналитика / База знаний (v1.20.9) ──
// Та же логика, что у canSeeSupplier/canSeeTicket: пустой массив в access = без ограничений.
export function canSeeDashboardCity(cityName?: string): boolean {
  const f = getAccessFilters();
  if (!f) return true;
  return f.dashboardCities.length === 0 || (cityName ? f.dashboardCities.includes(cityName) : false);
}

export function canSeeTask(t: { title: string; entityType?: string }): boolean {
  const f = getAccessFilters();
  if (!f) return true;
  return (f.taskTypes.length === 0 || f.taskTypes.includes(t.title))
    && (f.taskEntityTypes.length === 0 || f.taskEntityTypes.includes(t.entityType || ''));
}

export function canSeeMedia(m: { adTypeName?: string; durationLabel?: string; status?: string }): boolean {
  const f = getAccessFilters();
  if (!f) return true;
  return (f.mediaAdTypes.length === 0 || f.mediaAdTypes.includes(m.adTypeName || ''))
    && (f.mediaDurationOptions.length === 0 || f.mediaDurationOptions.includes(m.durationLabel || ''))
    && (f.mediaStatuses.length === 0 || f.mediaStatuses.includes(m.status || ''));
}

export function canSeeAnalyticsCity(cityName?: string): boolean {
  const f = getAccessFilters();
  if (!f) return true;
  return f.analyticsCities.length === 0 || (cityName ? f.analyticsCities.includes(cityName) : false);
}

export function canSeeKnowledge(a: { categoryName?: string }): boolean {
  const f = getAccessFilters();
  if (!f) return true;
  return f.knowledgeCategories.length === 0 || f.knowledgeCategories.includes(a.categoryName || '');
}

/** Правило дашборда менеджера (ТЗ v1.21.3): запись видна, если закреплена за текущим
 *  пользователем или ответственный не назначен. Администратор видит всё. */
export function isMineOrUnassigned(x: { responsibleId?: string }): boolean {
  const user = getCurrentUser();
  if (!user || user.role === 'admin') return true;
  return !x.responsibleId || x.responsibleId === user.id;
}

/** Города, доступные менеджеру с дашбордом МОП (ТЗ v1.21.6): видит покупателей только в выбранных
 *  городах (названия из «Типы и города»). Пустой список или другой тип дашборда — без ограничений. */
export function canSeeManagerCity(cityName?: string): boolean {
  const user = getCurrentUser();
  if (!user || user.role === 'admin') return true;
  if (user.dashboardType !== 'mop' || !user.allowedCities || user.allowedCities.length === 0) return true;
  return !!cityName && user.allowedCities.includes(cityName);
}

/** Право создавать/редактировать План/Факт: админ или менеджер с planfactEdit (ТЗ). */
export function canEditPlanFact(): boolean {
  // ТЗ v1.22.3: создавать/редактировать записи План/Факт может только администратор.
  const user = getCurrentUser();
  return !!user && user.role === 'admin';
}
