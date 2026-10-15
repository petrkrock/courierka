/**
 * ============================================================
 * SUPABASE BACKEND INTEGRATION — ВСЕМЗАПЧАСТИ ДОСТАВКА
 * ============================================================
 *
 * Полностью повторяет слой данных CRM, обрезан до таблицы suppliers
 * (доставочные поля) + app_settings. Используется автоматически
 * src/lib/store.ts (фоновая синхронизация) и src/lib/auth.ts (вход),
 * когда заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
 *
 * SETUP:
 * 1. Отдельный проект Supabase (своя база доставки)
 * 2. Выполнить supabase/schema.sql в SQL Editor
 * 3. Скопировать .env.example → .env, вписать ключи
 * 4. Создать первого пользователя — см. README.md § «Первый администратор»
 * ============================================================
 */

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import type { Supplier, AppSettings } from '@/types';

import { isSupabaseConfigured, getFunctionsUrl, getAnonKeyHeaders } from './functions-api';
export { isSupabaseConfigured, getFunctionsUrl, getAnonKeyHeaders };

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

/**
 * The Supabase client. `null` when env vars are missing so the rest of the
 * app can run in local-only (demo) mode without crashing on import.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

function requireClient(): SupabaseClient {
  if (!supabase) throw new Error('Supabase не настроен: заполните VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY в .env');
  return supabase;
}

/** Converts '' / undefined to null so optional UUID/text columns don't get an invalid empty string. */
function orNull<T>(v: T | undefined | ''): T | null {
  return v === undefined || v === '' ? null : v;
}

// ── AUTH ──────────────────────────────────────────────────

export async function signIn(email: string, password: string) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/** UUID of the currently signed-in Supabase Auth user, if any. Used for created_by FKs. */
async function currentAuthUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.user?.id ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres отклонит не-UUID в UUID-колонке (22P02) — created_by именно такая.
 * Любой write-path валидирует формат и фолбэкается на UUID текущей сессии.
 */
function safeCreatedBy(localValue: string | undefined, sessionUid: string | null): string | null {
  return localValue && UUID_RE.test(localValue) ? localValue : sessionUid;
}

/**
 * Admin-only: создаёт реальный Supabase Auth-логин для менеджера через
 * Edge Function create-manager (нужно развернуть один раз:
 * `supabase functions deploy create-manager`, см. README.md).
 */
export async function createManagerAccount(params: {
  email: string;
  password: string;
  name: string;
}): Promise<{ id: string; email: string }> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('create-manager', { body: params });
  if (error) {
    throw new Error(
      'Не удалось создать вход в Supabase — убедитесь, что Edge Function create-manager развёрнута (см. README.md). ' +
        error.message,
    );
  }
  if (data?.error) throw new Error(data.error);
  return data as { id: string; email: string };
}

// ── FIELD MAPPING: snake_case (DB) ↔ camelCase (app) ───────
// Поля — как в CRM: маппинг идёт в обе стороны, чтобы программа
// оставалась совместимой по данным с таблицей suppliers CRM.

function mapSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: row.id as string,
    type: row.type as string,
    tradeName: row.trade_name as string,
    city: row.city as string,
    address: (row.address as string) ?? undefined,
    website: (row.website as string) ?? undefined,
    inn: (row.inn as string) ?? undefined,
    contactRole: row.contact_role as Supplier['contactRole'],
    contactName: row.contact_name as string,
    phone: row.phone as string,
    email: row.email as string,
    status: row.status as string,
    source: (row.source as string) ?? undefined,
    contactPref: (row.contact_pref as Supplier['contactPref']) ?? undefined,
    contactPrefs: (row.contact_prefs as string[]) || [],
    warehouseCount: (row.warehouse_count as number) ?? undefined,
    multiWarehouse: ((row.multiwarehouse ?? row.multi_warehouse ?? row.multiWarehouse) as boolean | undefined) ?? undefined,
    skuCount: (row.sku_count as number) ?? undefined,
    warehouseLocations: (row.warehouse_locations as Supplier['warehouseLocations']) || [],
    productGroups: (row.product_groups as string[]) || [],
    ownBrands: (row.own_brands as string[]) || [],
    services: (row.services as string[]) || [],
    companyScore: (row.company_score as number) ?? 5,
    category: (row.category as Supplier['category']) ?? undefined,
    comment: (row.comment as string) ?? undefined,
    scoring: (row.scoring as Supplier['scoring']) ?? undefined,
    requisites: (row.requisites as Supplier['requisites']) ?? undefined,
    serviceSearch: (row.service_search as Supplier['serviceSearch']) || [],
    serviceAccess: (row.service_access as Supplier['serviceAccess']) ?? undefined,
    deliveryAccess: (row.delivery_access as Supplier['deliveryAccess']) ?? undefined,
    deliveryContract: (row.delivery_contract as Supplier['deliveryContract']) ?? undefined,
    history: (row.history as Supplier['history']) || [],
    additionalContacts: (row.additional_contacts as string) ?? undefined,
    additionalComment: (row.additional_comment as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) ?? undefined,
    fromApi: (row.from_api as boolean) ?? undefined,
    createdBy: (row.created_by as string) ?? undefined,
    responsibleId: (row.responsible_id as string) ?? undefined,
    responsibleName: (row.responsible_name as string) ?? undefined,
  };
}

function mapSupplierToDb(s: Partial<Supplier>): Record<string, unknown> {
  const db: Record<string, unknown> = {};
  if (s.type !== undefined) db.type = s.type;
  if (s.tradeName !== undefined) db.trade_name = s.tradeName;
  if (s.city !== undefined) db.city = s.city;
  if (s.address !== undefined) db.address = orNull(s.address);
  if (s.website !== undefined) db.website = orNull(s.website);
  if (s.inn !== undefined) db.inn = orNull(s.inn);
  if (s.contactRole !== undefined) db.contact_role = s.contactRole;
  if (s.contactName !== undefined) db.contact_name = s.contactName;
  if (s.phone !== undefined) db.phone = s.phone;
  if (s.email !== undefined) db.email = s.email;
  if (s.status !== undefined) db.status = s.status;
  if (s.source !== undefined) db.source = orNull(s.source);
  if (s.contactPref !== undefined) db.contact_pref = orNull(s.contactPref);
  if (s.contactPrefs !== undefined) db.contact_prefs = s.contactPrefs;
  if (s.warehouseCount !== undefined) db.warehouse_count = s.warehouseCount;
  const mwVal = (s as { multiWarehouse?: boolean; multiwarehouse?: boolean }).multiWarehouse ?? (s as { multiwarehouse?: boolean }).multiwarehouse;
  if (mwVal !== undefined) db.multiwarehouse = mwVal;
  if (s.skuCount !== undefined) db.sku_count = s.skuCount;
  if (s.warehouseLocations !== undefined) db.warehouse_locations = s.warehouseLocations;
  if (s.productGroups !== undefined) db.product_groups = s.productGroups;
  if (s.ownBrands !== undefined) db.own_brands = s.ownBrands;
  if (s.services !== undefined) db.services = s.services;
  if (s.companyScore !== undefined) db.company_score = s.companyScore;
  if (s.category !== undefined) db.category = s.category;
  if (s.comment !== undefined) db.comment = orNull(s.comment);
  if (s.scoring !== undefined) db.scoring = s.scoring;
  if (s.requisites !== undefined) db.requisites = s.requisites;
  if (s.serviceSearch !== undefined) db.service_search = s.serviceSearch;
  if (s.serviceAccess !== undefined) db.service_access = s.serviceAccess;
  db.delivery_access = s.deliveryAccess || null; // null при удалении, иначе серверная копия не очищалась
  db.delivery_contract = s.deliveryContract || null;
  if (s.history !== undefined) db.history = s.history;
  if (s.additionalContacts !== undefined) db.additional_contacts = orNull(s.additionalContacts);
  if (s.additionalComment !== undefined) db.additional_comment = orNull(s.additionalComment);
  if (s.fromApi !== undefined) db.from_api = s.fromApi;
  if (s.responsibleId !== undefined) db.responsible_id = orNull(s.responsibleId);
  if (s.responsibleName !== undefined) db.responsible_name = orNull(s.responsibleName);
  db.deleted_at = orNull(s.deletedAt);
  return db;
}

// ── SUPPLIERS CRUD ─────────────────────────────────────────

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await requireClient().from('suppliers').select('*');
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(mapSupplier);
}

export async function createSupplier(supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>, id?: string): Promise<Supplier> {
  const uid = await currentAuthUserId();
  const row = { ...(id ? { id } : {}), ...mapSupplierToDb(supplier), created_by: safeCreatedBy(supplier.createdBy, uid) };
  const { data, error } = await requireClient().from('suppliers').insert(row).select().single();
  if (error) throw error;
  return mapSupplier(data as Record<string, unknown>);
}

export async function updateSupplier(id: string, updates: Partial<Supplier>): Promise<Supplier> {
  const { data, error } = await requireClient().from('suppliers').update(mapSupplierToDb(updates)).eq('id', id).select().single();
  if (error) throw error;
  return mapSupplier(data as Record<string, unknown>);
}

export async function deleteSupplier(id: string): Promise<void> {
  const { error } = await requireClient().from('suppliers').delete().eq('id', id);
  if (error) throw error;
}

// ── SETTINGS (single JSONB row, id = 'global') ─────────────
// Всё, что не таблица suppliers (пользователи, маршруты, тарифы,
// города, задания, контент ЛК, ...), живёт внутри этого JSONB-блоба.

export async function fetchSettings(): Promise<AppSettings | null> {
  const { data, error } = await requireClient().from('app_settings').select('settings').eq('id', 'global').maybeSingle();
  if (error) throw error;
  const settings = (data?.settings as AppSettings) ?? null;
  return settings ? sanitizeSettings(settings) : null;
}

/**
 * SECURITY: вырезает plaintext-пароли из settings.users перед любыми
 * операциями с сервером. Поле `password` существует только для локального
 * демо-режима и никогда не должно попадать в БД. Idempotent.
 */
export function sanitizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    users: (settings.users || []).map(u => ({ ...u, password: '' })),
  };
}

/**
 * Persists settings to Supabase. Plaintext user passwords are stripped
 * before the write — the app_settings row is readable by every
 * authenticated user (see supabase/schema.sql RLS policies).
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!settings) { console.warn('[supabase] saveSettings: пустые настройки — запись пропущена'); return; }
  // Аварийная защита — никогда не пушим настройки без пользователей:
  // иначе пустое локальное состояние перезапишет серверные настройки целиком.
  if (!Array.isArray(settings.users) || settings.users.length === 0) {
    console.error('[supabase] saveSettings: БЛОКИРОВКА — в настройках нет пользователей, push на сервер отменён (защита от затирания).');
    return;
  }
  let sanitized;
  try { sanitized = sanitizeSettings(settings) ?? {}; } catch { sanitized = {}; }
  if (sanitized === null || sanitized === undefined) sanitized = {};
  try {
    // PostgREST upsert на app_settings падает 21000 "DELETE requires a WHERE clause"
    // (PostgREST эмулирует upsert как DELETE+INSERT на таблицах с RLS-триггером).
    // Решение: явный UPDATE, при отсутствии строки — upsert INSERT.
    const client = requireClient();
    const now = new Date().toISOString();
    const upd = await client.from('app_settings')
      .update({ settings: sanitized, updated_at: now })
      .eq('id', 'global')
      .select('id', { count: 'exact', head: true });
    if (upd.error) throw upd.error;
    if ((upd.count ?? 0) === 0) {
      const ins = await client.from('app_settings')
        .upsert({ id: 'global', settings: sanitized, updated_at: now }, { onConflict: 'id' });
      if (ins.error) throw ins.error;
    }
  } catch (e) {
    // Запись настроек не должна ронять приложение — лог и мягкий выход
    console.error('[supabase] saveSettings не удался:', e);
  }
}

// ── REAL-TIME SUBSCRIPTIONS ───────────────────────────────

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

interface PgChangePayload {
  eventType: RealtimeEvent;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

function subscribeToTable<T>(
  table: string,
  mapRow: (row: Record<string, unknown>) => T,
  callback: (event: RealtimeEvent, entity: T) => void,
) {
  if (!supabase) return { unsubscribe: () => {} };
  const channel = supabase
    .channel(`${table}-changes`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload: PgChangePayload) => {
        // DELETE only carries the old row; INSERT/UPDATE carry the new one.
        const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
        if (!row) return;
        callback(payload.eventType, mapRow(row));
      },
    )
    .subscribe();
  return { unsubscribe: () => { supabase?.removeChannel(channel); } };
}

export function subscribeToSuppliers(callback: (event: RealtimeEvent, entity: Supplier) => void) {
  return subscribeToTable('suppliers', mapSupplier, callback);
}

/**
 * Real-time updates for everything that lives inside app_settings.settings
 * (users, маршруты, тарифы, города, задания, контент ЛК, ...).
 */
export function subscribeToAppSettings(callback: (settings: AppSettings) => void) {
  if (!supabase) return { unsubscribe: () => {} };
  const channel = supabase
    .channel('app-settings-changes')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'app_settings', filter: 'id=eq.global' },
      (payload: { new: Record<string, unknown> }) => {
        const settings = payload.new?.settings as AppSettings | undefined;
        if (settings) callback(sanitizeSettings(settings));
      },
    )
    .subscribe();
  return { unsubscribe: () => { supabase?.removeChannel(channel); } };
}

// ── BULK SYNC HELPERS (used by src/lib/store.ts) ───────────
// Pull/push всего одним вызовом, никогда не бросают исключения —
// локальный кэш всегда остаётся источником того, что на экране.

export interface RemoteSnapshot {
  suppliers: Supplier[];
  settings: AppSettings | null;
}

/** Fetches everything. Returns null (and logs a warning) on any failure. */
export async function pullRemoteSnapshot(): Promise<RemoteSnapshot | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const [suppliers, settings] = await Promise.all([fetchSuppliers(), fetchSettings()]);
    return { suppliers, settings };
  } catch (err) {
    console.warn('[supabase] pullRemoteSnapshot failed, staying on local data:', err);
    return null;
  }
}

/**
 * Upserts every row + the settings blob. Best-effort: failures are
 * logged, never thrown, so a sync hiccup never breaks the UI.
 */
export async function pushRemoteSnapshot(snapshot: RemoteSnapshot): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const client = requireClient();
  try {
    const uid = await currentAuthUserId();
    const tasks: Promise<unknown>[] = [];

    if (snapshot.suppliers.length) {
      const rows = snapshot.suppliers.map(s => ({ id: s.id, ...mapSupplierToDb(s), created_by: safeCreatedBy(s.createdBy, uid) }));
      tasks.push(client.from('suppliers').upsert(rows));
    }
    if (snapshot.settings) {
      tasks.push(saveSettings(snapshot.settings));
    }

    const results = await Promise.allSettled(tasks);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) {
      console.warn('[supabase] pushRemoteSnapshot: some tables failed to sync:', failed);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[supabase] pushRemoteSnapshot failed:', err);
    return false;
  }
}
