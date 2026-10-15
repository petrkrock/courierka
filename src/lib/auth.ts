/**
 * AUTH — ВСЕМЗАПЧАСТИ ДОСТАВКА
 *
 * Единый источник истины о том, «кто сейчас сидит в программе».
 *
 * Сессия живёт в localStorage (7 дней) и при каждой загрузке приложения
 * перепроверяется по актуальным settings.users из кеша: если пользователя
 * уволили / заблокировали / удалили, доступ прекращается мгновенно —
 * без ожидания истечения токена и без дополнительных запросов к серверу.
 */
import { toast } from 'sonner';
import type { AppUser, AuthSession } from '@/types';
import { getStore } from './store';
import { isSupabaseConfigured, signIn as sbSignIn, signOut as sbSignOut, getSession as sbGetSession } from './supabase';

const SESSION_KEY = 'vz_delivery_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней

// Список активных слушателей: при login() каждый получает свежего пользователя,
// при logout() — null (для обнуления форм состояний).
const authListeners = new Set<(user: AppUser | null) => void>();

function saveSession(user: AppUser): void {
  const session: AuthSession = { user, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  authListeners.forEach(f => f(user));
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  authListeners.forEach(f => f(null));
}

function readSession(): AppUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.expiresAt || new Date(parsed.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed.user ?? null;
  } catch { return null; }
}

/** Текущий пользователь из localStorage (без перепроверки по settings.users). */
export function getCurrentUser(): AppUser | null {
  return readSession();
}

/** true, если currentUser — admin или demo. */
export function isAdmin(): boolean {
  const user = getCurrentUser();
  return Boolean(user && user.role === 'admin');
}

/**
 * Единая точка входа. По возможности — Supabase Auth, в демо-режиме —
 * сверка с settings.users из локального кеша (без Supabase).
 */
export async function login(email: string, password: string): Promise<AppUser | null> {
  email = (email || '').trim();
  password = password || '';

  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    const user = getStore().settings.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (user) { saveSession(user); return user; }
    toast.error('Неверный email или пароль');
    return null;
  }

  if (!isSupabaseConfigured()) {
    toast.error('Сервер не настроен: задайте VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY в .env');
    return null;
  }

  let sbUser: { id: string; email?: string } | null = null;
  try {
    const { user } = await sbSignIn(email, password);
    sbUser = user;
  } catch (err) {
    console.error('[auth] Supabase signIn failed:', err);
    toast.error('Ошибка входа: проверьте email и пароль');
    return null;
  }

  const users = getStore().settings.users;
  let appUser = users.find(u => (u.email || '').toLowerCase() === (sbUser?.email || email).toLowerCase());

  if (!appUser) {
    // Пользователь залогинился в Supabase Auth, но нет его записи в
    // settings.users — например, ещё не успел подтянуться initRemoteSync.
    // Подождём и перепроверим один раз.
    await new Promise(r => setTimeout(r, 2000));
    appUser = getStore().settings.users.find(u => (u.email || '').toLowerCase() === (sbUser?.email || email).toLowerCase());
  }
  if (!appUser) {
    await sbSignOut();
    toast.error('Пользователь не найден в настройках программы');
    return null;
  }
  // ТЗ: вход запрещён при статусе blocked/fired. Проверка по свежему стору.
  if (appUser.status && appUser.status !== 'active') {
    await sbSignOut();
    toast.error('Доступ заблокирован');
    return null;
  }

  // Id миграция: реальный UUID из auth.users — это и есть будущий id профиля.
  if (sbUser && appUser.id !== sbUser.id) {
    appUser = { ...appUser, id: sbUser.id };
    saveSession(appUser);
  } else {
    saveSession(appUser);
  }
  return appUser;
}

/** Выход: очищаем локальную сессию и Supabase-сессию (best-effort). */
export function logout(): void {
  clearSession();
  void sbSignOut().catch(() => {});
}

/**
 * Перепроверка сессии при загрузке приложения. Если пользователь уволен
 * или заблокирован — выкидываем из сессии немедленно.
 */
export async function reconcileSession(): Promise<AppUser | null> {
  const sessionUser = readSession();
  if (!sessionUser) return null;

  const users = getStore().settings.users;
  const u = users.find(x => x.id === sessionUser.id) || users.find(x => (x.email || '').toLowerCase() === (sessionUser.email || '').toLowerCase());
  if (!u || (u.status && u.status !== 'active')) {
    clearSession();
    if (u) toast.error('Доступ заблокирован');
    return null;
  }

  // Обновляем сессию свежими данными пользователя (права, имя и т.п.)
  saveSession(u);

  // Если есть Supabase — верифицируем токен. Если Supabase-сессия протухла,
  // но локальная жива — ОСТАЁМСЯ залогиненными (демо-режим без сервера).
  if (isSupabaseConfigured()) {
    const sbSession = await sbGetSession();
    if (!sbSession) {
      clearSession();
      return null;
    }
  }
  return u;
}

/**
 * Проверяет, есть ли у текущего пользователя доступ к разделу.
 * Разделы с ключом == false в permissions скрываются из интерфейса и
 * блокируются на уровне роутинга (см. RequireAccess в App.tsx).
 */
export function canAccess(section: keyof AppUser['permissions']): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  // Администратору разрешено всё, независимо от permissions
  if (user.role === 'admin') return true;
  return Boolean(user.permissions[section]);
}

/** Фильтры менеджера (по типам и городам поставщиков). Пустой массив = без ограничений. */
export function getAccessFilters(): { supplierTypes: string[]; supplierCities: string[] } {
  const user = getCurrentUser();
  if (!user || user.role === 'admin') return { supplierTypes: [], supplierCities: [] };
  return {
    supplierTypes: user.access?.supplierTypes || [],
    supplierCities: user.access?.supplierCities || [],
  };
}

/** Фильтр видимости поставщика для менеджера по типу/городу/ответственному. */
export function canSeeSupplier(supplier: { type: string; city: string; responsibleId?: string }): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === 'admin') return true;
  const filters = getAccessFilters();
  const typeOk = filters.supplierTypes.length === 0 || filters.supplierTypes.includes(supplier.type);
  const cityOk = filters.supplierCities.length === 0 || filters.supplierCities.includes(supplier.city);
  const respOk = !supplier.responsibleId || supplier.responsibleId === user.id;
  return typeOk && cityOk && respOk;
}
