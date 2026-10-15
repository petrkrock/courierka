import type {
  Supplier, AppSettings, AppUser, HistoryEntry, SyncLogEntry, SupplierService,
} from '@/types';
import { EMPTY_ACCESS } from '@/types';
import { useEffect, useState } from 'react';
import { DEFAULT_DELIVERY_TASK_STATUSES, CONTACT_PREFS } from '@/constants';
import { generateId } from './utils';
import {
  isSupabaseConfigured, pullRemoteSnapshot, saveSettings,
  createSupplier, updateSupplier, deleteSupplier,
} from './supabase';

const STORE_KEY = 'vz_delivery_data';

// ─────────────────────────────────────────────────────────────
// ЛОГ СИНХРОНИЗАЦИИ: локальный кольцевой буфер (последние 300 записей).
// Хранится в отдельном ключе localStorage и НИКОГДА не отправляется на сервер.
// ─────────────────────────────────────────────────────────────
const SYNC_LOG_KEY = 'vz_delivery_sync_log';
const SYNC_ERRORS_KEY = 'vz_delivery_sync_errors';
let syncLogEntries: SyncLogEntry[] = (() => { try { return JSON.parse(localStorage.getItem(SYNC_LOG_KEY) || '[]'); } catch { return []; } })();
let syncErrorEntries: SyncLogEntry[] = (() => { try { return JSON.parse(localStorage.getItem(SYNC_ERRORS_KEY) || '[]'); } catch { return []; } })();
const syncLogListeners = new Set<() => void>();

export function getSyncLog(): SyncLogEntry[] { return syncLogEntries; }
export function getSyncErrors(): SyncLogEntry[] { return syncErrorEntries; }
export function clearSyncLog(): void {
  syncLogEntries = [];
  syncErrorEntries = [];
  try { localStorage.setItem(SYNC_LOG_KEY, '[]'); localStorage.setItem(SYNC_ERRORS_KEY, '[]'); } catch { /* noop */ }
  syncLogListeners.forEach(f => f());
}
export function useSyncLog(): SyncLogEntry[] {
  const [v, setV] = useState<SyncLogEntry[]>(syncLogEntries);
  useEffect(() => {
    const f = () => setV([...syncLogEntries]);
    syncLogListeners.add(f);
    return () => { syncLogListeners.delete(f); };
  }, []);
  return v;
}
/** Кол-во ошибок синка за последние N минут (для индикатора). */
export function recentSyncErrorCount(minutes = 15): number {
  const cutoff = Date.now() - minutes * 60 * 1000;
  return syncLogEntries.filter(e => e.status === 'error' && new Date(e.ts).getTime() >= cutoff).length;
}
function logSync(e: Omit<SyncLogEntry, 'id' | 'ts'>): void {
  const entry: SyncLogEntry = { ...e, id: generateId(), ts: new Date().toISOString() };
  syncLogEntries.push(entry);
  if (e.status === 'error') {
    syncErrorEntries.push(entry);
    if (syncErrorEntries.length > 500) syncErrorEntries = syncErrorEntries.slice(-500);
  }
  if (syncLogEntries.length > 300) {
    const removed = syncLogEntries.slice(0, syncLogEntries.length - 200);
    for (const r of removed) if (r.status === 'error' && !syncErrorEntries.includes(r)) syncErrorEntries.push(r);
    if (syncErrorEntries.length > 500) syncErrorEntries = syncErrorEntries.slice(-500);
    syncLogEntries = syncLogEntries.slice(-200);
  }
  try { localStorage.setItem(SYNC_LOG_KEY, JSON.stringify(syncLogEntries)); localStorage.setItem(SYNC_ERRORS_KEY, JSON.stringify(syncErrorEntries)); } catch { /* noop */ }
  syncLogListeners.forEach(f => f());
}

export interface CRMStore {
  suppliers: Supplier[];
  settings: AppSettings;
}

function defaultAdmin(): AppUser {
  return {
    id: 'admin-1', name: 'Администратор', email: 'admin@vz.tech', password: 'admin123',
    role: 'admin',
    // Администратору все разделы доступны всегда — permissions/access для него не используются
    permissions: { dashboard: true, suppliers: true, buyers: true, tasks: true, support: true, media: true, pricing: true, delivery: true, planfact: true, analytics: true, knowledge: true, planfactEdit: true },
    access: { ...EMPTY_ACCESS },
    note: '',
    status: 'active',
    createdAt: new Date().toISOString(),
  };
}

const DEFAULT_SUPPLIER_SERVICES: SupplierService[] = [
  { id: 'svc-1',  name: 'DBS',   createdAt: new Date().toISOString(), system: true },
  { id: 'svc-2',  name: 'FBS',   createdAt: new Date().toISOString(), system: true },
  { id: 'svc-3',  name: 'DBO',   createdAt: new Date().toISOString(), system: true },
  { id: 'svc-4',  name: 'MEDIA', createdAt: new Date().toISOString(), system: true },
];

// Города для выпадающих списков — сознательно пусто: список администратор
// заполняет сам в Настройки → Города доставки.
const DEFAULT_CITIES: string[] = [];

function defaultStore(): CRMStore {
  const admin = defaultAdmin();
  return {
    suppliers: [],
    settings: {
      statuses: [],
      users: [admin],
      supplierTypes: ['Поставщик/склад', 'Производитель/бренд'],
      cities: [...DEFAULT_CITIES],
      quickLinks: { mail: '', platform: '' },
      supplierServices: DEFAULT_SUPPLIER_SERVICES,
      deliveryTaskStatuses: [...DEFAULT_DELIVERY_TASK_STATUSES],
    },
  };
}

export let lastSavedJson = '';
function saveStore(store: CRMStore, previousStore?: CRMStore) {
  const json = JSON.stringify(store);
  // Защита от циклов: если данные не изменились — ничего не делаем.
  if (json === lastSavedJson) return;
  lastSavedJson = json;
  localStorage.setItem(STORE_KEY, json);
  notifyStoreChange();
  if (previousStore) scheduleRemoteSync(previousStore, store);
}

export function getStore(): CRMStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) { const s = defaultStore(); saveStore(s); return s; }
    const parsed = JSON.parse(raw) as CRMStore;

    // Миграции/дефолты — только то, что нужно модулю Доставки.
    const settings = parsed.settings;
    if (!Array.isArray(settings.statuses)) settings.statuses = [];
    if (!settings.supplierServices) settings.supplierServices = DEFAULT_SUPPLIER_SERVICES;
    if (!settings.cities) settings.cities = [];
    if (!settings.quickLinks) settings.quickLinks = { mail: '', platform: '' };
    // Системные сервисы — вне гейта (существующие базы должны получать DBO).
    {
      const SYS_SVC = ['DBS', 'MARKET', 'DBO', 'MEDIA'];
      if (!Array.isArray(settings.supplierServices)) settings.supplierServices = [];
      SYS_SVC.forEach(name => {
        const existing = settings.supplierServices!.find(s => s.name === name);
        if (existing) existing.system = true;
        else settings.supplierServices!.push({ id: `svc-${name.toLowerCase()}`, name, createdAt: new Date().toISOString(), system: true });
      });
    }
    // Статусы заданий на доставку — дефолт, если ещё не настраивались.
    if (!Array.isArray(settings.deliveryTaskStatuses) || settings.deliveryTaskStatuses.length === 0) {
      settings.deliveryTaskStatuses = DEFAULT_DELIVERY_TASK_STATUSES.map(s => ({ ...s }));
    }

    if (!Array.isArray(parsed.suppliers)) parsed.suppliers = [];
    return parsed;
  } catch {
    const s = defaultStore();
    saveStore(s);
    return s;
  }
}

export function updateStore(updater: (store: CRMStore) => CRMStore) {
  const store = getStore();
  const updated = updater(store);
  saveStore(updated, store);
  return updated;
}

export function clearLocalStoreCache(): void {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  localStorage.removeItem(STORE_KEY);
  lastSavedJson = '';
}

// ── STORE-CHANGE EVENT BUS ───────────────────────────────────
//
// A tiny pub-sub so React components can re-render when the local cache
// changes — whether that's from a user action on the same page (saveStore
// above) or from a Supabase Realtime event landing from another user's
// browser (applyRemoteEntityChange / applyRemoteSettingsPatch below). See
// useStoreVersion() — every page calls it once to opt in.

type StoreListener = () => void;
const storeListeners = new Set<StoreListener>();

// Пакетная доставка: сколько бы saveStore ни вызвалось синхронно (realtime-эхо,
// merge-цепочки, пакетные правки) — подписчики получают ОДИН тик на микротаску.
let notifyScheduled = false;
let notifyCount = 0;
let notifyWindowStart = 0;
function notifyStoreChange() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    const now = Date.now();
    if (now - notifyWindowStart > 1000) { notifyWindowStart = now; notifyCount = 0; }
    notifyCount++;
    if (notifyCount > 50) {
      console.error('[store] Шторм уведомлений (>50/сек) — тик пропущен.');
      return;
    }
    const fns = Array.from(storeListeners);
    for (const fn of fns) fn();
  });
}

export function subscribeToStoreChanges(fn: StoreListener): () => void {
  storeListeners.add(fn);
  return () => { storeListeners.delete(fn); };
}

/**
 * Call once per page component. Re-renders that component whenever the
 * store changes for any reason (a local edit anywhere in the app, or a
 * Supabase Realtime update from another user) — because every page already
 * reads fresh data via getStore() on every render, bumping this counter is
 * all it takes to reflect the latest data without any other page-specific
 * plumbing.
 */
export function useStoreVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeToStoreChanges(() => setVersion(v => v + 1)), []);
  return version;
}

// ── SUPABASE BACKGROUND SYNC (offline-first) ────────────────
//
// The whole app above reads/writes through the synchronous getStore() /
// saveStore() / updateStore() API backed by localStorage — every page in
// src/pages keeps working completely unchanged, online or offline.
//
// When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set, two things
// happen in addition:
//   1. On app start, initRemoteSync() pulls suppliers + settings from
//      Supabase and overwrites the local cache with them (Supabase is
//      the source of truth once configured).
//   2. Every saveStore() call schedules a debounced push of the current
//      snapshot back to Supabase, so changes reach the database — and
//      other devices/users — within ~1.5s, without any page having to
//      know Supabase exists.

let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 1500;

type EntityName = 'suppliers';

// Сервер владеет служебными полями — они НЕ участвуют в сравнении,
// иначе дифф никогда не сходится (update → триггер меняет updated_at →
// pull видит "расхождение" → бесконечный цикл). deliveryAccess НЕ исключён —
// иначе токен/PIN ЛК доставки не доезжали бы до БД.
const VOLATILE_SYNC_KEYS = new Set(['updatedAt', 'updated_at', 'history',
  'serviceAccess', 'service_access', 'companyScore', 'company_score', 'scoring']);

function stableEntityJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableEntityJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (VOLATILE_SYNC_KEYS.has(k)) continue;
      out[k] = src[k];
    }
    return JSON.stringify(out);
  }
  return JSON.stringify(value ?? null);
}

async function syncEntityDiff<T extends { id: string }>(
  entity: EntityName,
  previous: T[],
  current: T[],
): Promise<void> {
  const oldById = new Map(previous.map(x => [x.id, x]));
  const newById = new Map(current.map(x => [x.id, x]));
  const operations: Promise<unknown>[] = [];
  const opsMeta: Array<{ entity: typeof entity; op: 'create' | 'update' | 'delete'; id: string }> = [];

  for (const [id, next] of newById) {
    const prev = oldById.get(id);
    if (!prev) {
      opsMeta.push({ entity, op: 'create', id });
      operations.push(createSupplier(next as never, id));
    } else if (stableEntityJson(prev) !== stableEntityJson(next)) {
      opsMeta.push({ entity, op: 'update', id });
      operations.push(updateSupplier(id, next as never));
    }
  }

  // Hard deletions are rare because the app uses soft-delete. Kept for
  // admin hard-delete actions so the server cannot retain orphaned rows.
  for (const id of oldById.keys()) {
    if (newById.has(id)) continue;
    opsMeta.push({ entity, op: 'delete', id });
    operations.push(deleteSupplier(id));
  }

  const results = await Promise.allSettled(operations);
  let okCount = 0;
  results.forEach((r, i) => {
    const errObj = r.status === 'fulfilled' ? (r.value as { error?: { message?: string; code?: string } | null } | null)?.error : undefined;
    const reason = r.status === 'rejected' ? String((r as PromiseRejectedResult).reason) : undefined;
    const meta = opsMeta[i];
    if (errObj || reason) {
      // Операции с ошибкой ВНУТРИ resolved-значения (PostgREST возвращает
      // {error} без throw!) попадают в лог, а не пропадают молча.
      logSync({ kind: 'op', entity: meta.entity, op: meta.op, itemId: meta.id, status: 'error',
        message: [errObj?.code, errObj?.message || (errObj ? JSON.stringify(errObj) : reason)].filter(Boolean).join(': ') });
    } else okCount++;
  });
  logSync({ kind: 'summary', entity, op: 'sync', status: results.some((r, i) => r.status === 'rejected' || (r.value as { error?: unknown } | null)?.error) ? 'error' : 'ok',
    message: `${entity}: ${okCount} ок / ${results.length - okCount} ошибок` });
}

async function pushRemoteDiff(previous: CRMStore, current: CRMStore): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const jobs: Promise<unknown>[] = [
    syncEntityDiff('suppliers', previous.suppliers, current.suppliers),
  ];
  if (JSON.stringify(previous.settings) !== JSON.stringify(current.settings)) {
    jobs.push(saveSettings(current.settings));
  }
  try {
    await Promise.all(jobs);
    logSync({ kind: 'system', entity: 'system', op: 'push', status: 'ok', message: 'pushRemoteDiff завершён' });
  } catch (e) {
    logSync({ kind: 'system', entity: 'system', op: 'push', status: 'error', message: String(e) });
  }
}

let pendingSyncPrevious: CRMStore | null = null;
let pendingSyncCurrent: CRMStore | null = null;
function scheduleRemoteSync(previous: CRMStore, current: CRMStore) {
  if (!isSupabaseConfigured()) return;
  if (!pendingSyncPrevious) pendingSyncPrevious = previous;
  pendingSyncCurrent = current;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const prev = pendingSyncPrevious;
    const next = pendingSyncCurrent;
    pendingSyncPrevious = null;
    pendingSyncCurrent = null;
    if (prev && next) void pushRemoteDiff(prev, next);
  }, SYNC_DEBOUNCE_MS);
}

// How long a local-only record (created here, not yet seen on the server)
// is trusted as "still pending sync" rather than "was deleted by someone
// else remotely" — см. mergeEntityList().
const PENDING_SYNC_GRACE_MS = 5 * 60 * 1000;

/**
 * Merges a remote snapshot of an entity list with what's already in the
 * local cache. Rule: for an id present on both sides, keep whichever copy
 * has the newer updatedAt. For an id only in the local cache, keep it if
 * it looks recent (still within the sync grace window); otherwise drop it.
 */
function mergeEntityList<T extends { id: string; updatedAt?: string; createdAt?: string }>(
  remoteList: T[],
  localList: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const item of remoteList) byId.set(item.id, item);
  const now = Date.now();
  for (const item of localList) {
    const remote = byId.get(item.id);
    if (remote) {
      const remoteTs = Date.parse(remote.updatedAt || remote.createdAt || '0') || 0;
      const localTs = Date.parse(item.updatedAt || item.createdAt || '0') || 0;
      if (localTs > remoteTs) byId.set(item.id, item);
    } else {
      const localTs = Date.parse(item.updatedAt || item.createdAt || '0') || 0;
      if (localTs >= now - PENDING_SYNC_GRACE_MS) byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

function mergeSettings(remote: AppSettings | null, local: AppSettings | undefined, defaults: AppSettings): AppSettings {
  const merged: AppSettings = { ...defaults, ...(local || {}), ...(remote || {}) };
  // Пользователи: сервер — источник истины, но локальных (ещё не
  // запушенных) не теряем.
  const remoteUsers = remote?.users || [];
  const localUsers = local?.users || [];
  if (remoteUsers.length) {
    const remoteIds = new Set(remoteUsers.map(u => u.id));
    merged.users = [...remoteUsers, ...localUsers.filter(u => !remoteIds.has(u.id))];
  } else {
    merged.users = localUsers.length ? localUsers : defaults.users;
  }
  return merged;
}

/**
 * One-shot remote→local merge, called once at app start (see App.tsx's
 * bootstrap). Pulls the latest data from Supabase into the local cache.
 * No-op (resolves instantly) when Supabase isn't configured.
 */
export async function initRemoteSync(): Promise<void> {
  // Демо-режим: данные живут ТОЛЬКО в localStorage этого браузера.
  if (import.meta.env.VITE_DEMO_MODE === 'true') return;
  if (!isSupabaseConfigured()) return;

  // 1) СНАЧАЛА тянем remote. Локальный кэш НЕ трогаем, пока не убедимся,
  //    что сервер отвечает: иначе при офлайне/ошибке RLS данные
  //    уничтожались бы при каждой перезагрузке (F5).
  const remote = await pullRemoteSnapshot();
  if (!remote) {
    console.warn('[store] pull не удался — локальные данные сохранены, синхронизация отложена.');
    return;
  }

  let localRaw: CRMStore | null = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) localRaw = JSON.parse(raw) as CRMStore;
  } catch { /* ignore corrupt local cache */ }

  // Владение локальными данными: локаль считается «своей», только если
  // email сессии присутствует в её settings.users.
  const email = localSessionEmail();
  const owned = Boolean(email) && Boolean(localRaw) &&
    ((localRaw!.settings.users || []).some(u => (u.email || '').toLowerCase() === email));

  // 2) Сервер ПОЛНОСТЬЮ пуст — новый проект. Локальные данные — единственная
  //    копия: сохраняем и выгружаем на сервер (если владелец подтверждён).
  const serverHasEntities = remote.suppliers.length > 0;
  const serverHasUsers = Boolean(remote.settings && (remote.settings.users || []).length);
  const localHasEntities = Boolean(localRaw && localRaw.suppliers.length);

  if (!serverHasEntities && !serverHasUsers) {
    if (localRaw && localHasEntities) {
      if (owned) {
        clearLocalStoreCache();
        const emptyPrev: CRMStore = { ...localRaw, suppliers: [] };
        saveStore(localRaw, emptyPrev);
        console.warn('[store] Сервер пуст: локальные данные приняты за истину и выгружаются на сервер.');
      } else {
        console.warn('[store] Сервер пуст; локальные данные сохранены без выгрузки (владелец не подтверждён).');
      }
    }
    return;
  }

  // 3) Сервер содержит данные → он источник истины. Список, который на
  //    сервере ПУСТ, а локально есть записи, НЕ затираем, если данные свои.
  clearLocalStoreCache();
  const pick = <T extends { id: string }>(remoteList: T[], localList: T[] | undefined): T[] => {
    if (!owned) return remoteList;
    if (remoteList.length) return remoteList;
    return (localList && localList.length) ? localList : remoteList;
  };
  const merged: CRMStore = {
    suppliers: pick(remote.suppliers, localRaw?.suppliers),
    settings: mergeSettings(remote.settings, localRaw?.settings, defaultStore().settings),
  };
  if (owned && localHasEntities) {
    const emptyPrev: CRMStore = { ...merged, suppliers: [] };
    saveStore(merged, emptyPrev);
  } else {
    localStorage.setItem(STORE_KEY, JSON.stringify(merged));
    lastSavedJson = JSON.stringify(merged);
  }

  // Backfill: пустой app_settings на новом проекте — выгрузить реальные настройки.
  if (!remote.settings || !remote.settings.users) {
    void saveSettings(merged.settings).catch(err => console.warn('[supabase] initial settings seed failed:', err));
  }
}

/** Email текущей сессии из localStorage (без импорта auth — избегаем цикл). */
function localSessionEmail(): string | null {
  try {
    const raw = localStorage.getItem('vz_delivery_session');
    const s = raw ? (JSON.parse(raw) as { user?: { email?: string } }).user?.email : undefined;
    return s ? s.toLowerCase() : null;
  } catch { return null; }
}

/**
 * Applies a partial settings update that arrived via Supabase real-time
 * directly to the local cache — deliberately bypassing saveStore(), so it
 * does NOT schedule another push back to Supabase (иначе входящее изменение
 * тут же эхом ушло бы обратно и перезаписало бы чужую правку).
 */
export function applyRemoteSettingsPatch(patch: Partial<AppSettings>): CRMStore {
  const store = getStore();
  const merged: CRMStore = { ...store, settings: { ...store.settings, ...patch } };
  const json = JSON.stringify(merged);
  if (json !== lastSavedJson) {
    lastSavedJson = json;
    localStorage.setItem(STORE_KEY, json);
    notifyStoreChange();
  }
  return merged;
}

/**
 * Applies a single-row Supabase Realtime change (INSERT/UPDATE/DELETE) to
 * the local cache — same bypass-saveStore reasoning as
 * applyRemoteSettingsPatch above.
 */
export function applyRemoteEntityChange<T extends { id: string }>(
  key: 'suppliers',
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  entity: T,
): CRMStore {
  const store = getStore();
  const list = store[key] as unknown as T[];
  const list_ = event === 'DELETE'
    ? list.filter(item => item.id !== entity.id)
    : (list.some(item => item.id === entity.id)
      ? list.map(item => (item.id === entity.id ? entity : item))
      : [...list, entity]);
  const merged: CRMStore = { ...store, [key]: list_ };
  localStorage.setItem(STORE_KEY, JSON.stringify(merged));
  notifyStoreChange();
  return merged;
}

export function makeHistoryEntry(
  field: string,
  oldValue: string | undefined,
  newValue: string | undefined,
  comment: string | undefined,
  userId: string,
  userName: string,
): HistoryEntry {
  return { id: generateId(), date: new Date().toISOString(), field, oldValue, newValue, comment, userId, userName };
}

/** Системные способы связи — не удаляются, можно только переименовать. */
export const SYSTEM_CONTACT_PREFS = ['почта', 'телефон', 'max'];

/** Способы связи — редактируемый справочник; CONTACT_PREFS — фолбэк. */
export function getContactPrefs(): string[] {
  const list = getStore().settings.contactPrefs;
  return Array.isArray(list) && list.length ? list : [...CONTACT_PREFS];
}
