/**
 * ============================================================
 * SUPABASE BACKEND INTEGRATION — ВСЕМЗАПЧАСТИ CRM
 * ============================================================
 *
 * This file is a fully working Supabase data-access layer. It is used
 * automatically by src/lib/store.ts (background sync) and src/lib/auth.ts
 * (login) whenever VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set.
 * Without those env vars the app keeps working exactly as before, on
 * localStorage only (see README.md — "Демо-режим без Supabase").
 *
 * SETUP:
 * 1. Create a project at https://supabase.com
 * 2. Run supabase/schema.sql in the SQL editor (creates tables + RLS)
 * 3. Copy .env.example to .env and fill in the two VITE_SUPABASE_* values
 * 4. npm install (pulls @supabase/supabase-js, already in package.json)
 * 5. Create at least one Supabase Auth user + matching profile — see
 *    README.md § "Первый администратор"
 *
 * ============================================================
 */

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import type {
  Supplier, Buyer, Task, Ticket, MediaRecord, AppSettings,
} from '@/types';

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
 * Postgres will outright reject a non-UUID value in a UUID column (error
 * 22P02: invalid input syntax for type uuid) — created_by is exactly such
 * a column. A record's local createdBy can end up non-UUID for reasons
 * outside any single insert's control (e.g. a CRM profile that predates
 * having a real Supabase Auth login — see the id-migration in
 * src/lib/auth.ts's login() — or data synced before that fix existed), so
 * every write path that sends created_by validates the format here first
 * and falls back to the current session's real UUID (or null) rather than
 * ever forwarding a bad value and having the whole insert fail.
 */
function safeCreatedBy(localValue: string | undefined, sessionUid: string | null): string | null {
  return localValue && UUID_RE.test(localValue) ? localValue : sessionUid;
}

/**
 * Admin-only: provisions a real Supabase Auth login for a new manager, by
 * calling the create-manager Edge Function (see
 * supabase/functions/create-manager/index.ts — must be deployed once via
 * `supabase functions deploy create-manager`, see README.md). Without
 * this, a manager's CRM profile (Настройки → Пользователи) would exist but
 * have nothing to actually sign in with.
 *
 * Returns the new Supabase Auth user's id/email on success — the caller
 * (SettingsPage.tsx) uses that id as the new AppUser.id, so it lines up
 * with auth.users.id / profiles.id for the rest of the app (created_by
 * FKs, profiles-based RLS, etc).
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
    priceEmail: (row.price_email as string) || '',
    contactName: row.contact_name as string,
    phone: row.phone as string,
    email: row.email as string,
    status: row.status as string,
    source: (row.source as string) ?? undefined,
    contactPref: (row.contact_pref as Supplier['contactPref']) ?? undefined,
    contactPrefs: (row.contact_prefs as string[]) || [],
    warehouseCount: (row.warehouse_count as number) ?? undefined,
  multiWarehouse: ((row.multiwarehouse ?? row.multi_warehouse ?? row.multiWarehouse) as boolean | undefined) ?? undefined, // ТЗ v1.25.15
    multiwarehouse: ((row.multiwarehouse ?? row.multi_warehouse ?? row.multiWarehouse) as boolean | undefined) ?? undefined, // ТЗ v1.25.18: и lowercase-свойство (карточка CRM читает его)
    skuCount: (row.sku_count as number) ?? undefined,
    warehouseLocations: (row.warehouse_locations as Supplier['warehouseLocations']) || [],
    productGroups: (row.product_groups as string[]) || [],
    ownBrands: (row.own_brands as string[]) || [],
    services: (row.services as string[]) || [],
    companyScore: (row.company_score as number) ?? 5,
    category: (row.category as Supplier['category']) ?? undefined, // ТЗ 1.8
    comment: (row.comment as string) ?? undefined,
    scoring: (row.scoring as Supplier['scoring']) ?? undefined,
    requisites: (row.requisites as Supplier['requisites']) ?? undefined,
    serviceSearch: (row.service_search as Supplier['serviceSearch']) || [],
    serviceAccess: (row.service_access as Supplier['serviceAccess']) ?? undefined,
    // v1.30.39: ЭДО — колонки edo_operator/edo_token
    edoOperator: (row.edo_operator as string) ?? undefined,
    edoToken: (row.edo_token as string) ?? undefined,
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
  if (s.priceEmail !== undefined) db.price_email = s.priceEmail;
  if (s.contactName !== undefined) db.contact_name = s.contactName;
  if (s.phone !== undefined) db.phone = s.phone;
  if (s.email !== undefined) db.email = s.email;
  if (s.status !== undefined) db.status = s.status;
  if (s.source !== undefined) db.source = orNull(s.source);
  if (s.contactPref !== undefined) db.contact_pref = orNull(s.contactPref);
  if (s.contactPrefs !== undefined) db.contact_prefs = s.contactPrefs;
  if (s.warehouseCount !== undefined) db.warehouse_count = s.warehouseCount;
  // ТЗ v1.25.18: карточка CRM работает со свойством multiwarehouse (lowercase) — пишем из обоих
  const mwVal = (s as { multiWarehouse?: boolean; multiwarehouse?: boolean }).multiWarehouse ?? (s as { multiwarehouse?: boolean }).multiwarehouse;
  if (mwVal !== undefined) db.multiwarehouse = mwVal;
  if (s.skuCount !== undefined) db.sku_count = s.skuCount;
  if (s.warehouseLocations !== undefined) db.warehouse_locations = s.warehouseLocations;
  if (s.productGroups !== undefined) db.product_groups = s.productGroups;
  if (s.ownBrands !== undefined) db.own_brands = s.ownBrands;
  if (s.services !== undefined) db.services = s.services;
  if (s.companyScore !== undefined) db.company_score = s.companyScore;
  if (s.category !== undefined) db.category = s.category; // ТЗ 1.8
  if (s.comment !== undefined) db.comment = orNull(s.comment);
  if (s.scoring !== undefined) db.scoring = s.scoring;
  if (s.requisites !== undefined) db.requisites = s.requisites;
  if (s.serviceSearch !== undefined) db.service_search = s.serviceSearch;
  if (s.serviceAccess !== undefined) db.service_access = s.serviceAccess;
  if (s.edoOperator !== undefined) db.edo_operator = orNull(s.edoOperator);
  if (s.edoToken !== undefined) db.edo_token = orNull(s.edoToken);
  if (s.history !== undefined) db.history = s.history;
  if (s.additionalContacts !== undefined) db.additional_contacts = orNull(s.additionalContacts);
  if (s.additionalComment !== undefined) db.additional_comment = orNull(s.additionalComment);
  if (s.fromApi !== undefined) db.from_api = s.fromApi;
  if (s.responsibleId !== undefined) db.responsible_id = orNull(s.responsibleId);
  if (s.responsibleName !== undefined) db.responsible_name = orNull(s.responsibleName);
  db.deleted_at = orNull(s.deletedAt);
  return db;
}

function mapBuyer(row: Record<string, unknown>): Buyer {
  return {
    id: row.id as string,
    type: row.type as string,
    tradeName: row.trade_name as string,
    city: row.city as string,
    address: (row.address as string) ?? undefined,
    website: (row.website as string) ?? undefined,
    inn: (row.inn as string) ?? undefined,
    contactRole: row.contact_role as Buyer['contactRole'],
    contactName: row.contact_name as string,
    phone: row.phone as string,
    email: row.email as string,
    status: row.status as string,
    source: (row.source as string) ?? undefined,
    contactPref: (row.contact_pref as Buyer['contactPref']) ?? undefined,
    contactPrefs: (row.contact_prefs as string[]) || [],
    locationsCount: (row.locations_count as number) ?? undefined, // Аудит-matrix: канон locations_count
    locationCount: (row.locations_count as number) ?? undefined, // legacy-алиас для старых экранов
    companyScore: (row.company_score as number) ?? 5,
    category: (row.category as Buyer['category']) ?? undefined, // ТЗ 1.8
    comment: (row.comment as string) ?? undefined,
    scoring: (row.scoring as Buyer['scoring']) ?? undefined,
    requisites: (row.requisites as Buyer['requisites']) ?? undefined,
    history: (row.history as Buyer['history']) || [],
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

function mapBuyerToDb(b: Partial<Buyer>): Record<string, unknown> {
  const db: Record<string, unknown> = {};
  if (b.type !== undefined) db.type = b.type;
  if (b.tradeName !== undefined) db.trade_name = b.tradeName;
  if (b.city !== undefined) db.city = b.city;
  if (b.address !== undefined) db.address = orNull(b.address);
  if (b.website !== undefined) db.website = orNull(b.website);
  if (b.inn !== undefined) db.inn = orNull(b.inn);
  if (b.contactRole !== undefined) db.contact_role = b.contactRole;
  if (b.contactName !== undefined) db.contact_name = b.contactName;
  if (b.phone !== undefined) db.phone = b.phone;
  if (b.email !== undefined) db.email = b.email;
  if (b.status !== undefined) db.status = b.status;
  if (b.source !== undefined) db.source = orNull(b.source);
  if (b.contactPref !== undefined) db.contact_pref = orNull(b.contactPref);
  if (b.contactPrefs !== undefined) db.contact_prefs = b.contactPrefs;
  if (b.companyScore !== undefined) db.company_score = b.companyScore;
  if (b.category !== undefined) db.category = b.category; // ТЗ 1.8
  if (b.locationsCount !== undefined) db.locations_count = b.locationsCount;
  else if (b.locationCount !== undefined) db.locations_count = b.locationCount; // legacy-алиас
  if (b.comment !== undefined) db.comment = orNull(b.comment);
  if (b.scoring !== undefined) db.scoring = b.scoring;
  if (b.requisites !== undefined) db.requisites = b.requisites;
  if (b.history !== undefined) db.history = b.history;
  if (b.additionalContacts !== undefined) db.additional_contacts = orNull(b.additionalContacts);
  if (b.additionalComment !== undefined) db.additional_comment = orNull(b.additionalComment);
  if (b.fromApi !== undefined) db.from_api = b.fromApi;
  if (b.responsibleId !== undefined) db.responsible_id = orNull(b.responsibleId);
  if (b.responsibleName !== undefined) db.responsible_name = orNull(b.responsibleName);
  db.deleted_at = orNull(b.deletedAt);
  return db;
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    entityType: row.entity_type as string,
    entityId: (row.entity_id as string) ?? undefined,
    entityName: (row.entity_name as string) ?? undefined,
    title: row.title as string,
    description: (row.description as string) ?? undefined,
    dueDate: row.due_date as string,
    taskStatus: row.task_status as Task['taskStatus'],
    completed: Boolean(row.completed),
    resolvedAt: (row.resolved_at as string) ?? undefined,
    deletedAt: (row.deleted_at as string) ?? undefined,
    history: (row.history as Task['history']) || [],
    priority: (row.priority as number) ?? 3,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    createdBy: (row.created_by as string) ?? undefined,
    responsibleId: (row.responsible_id as string) ?? undefined,
    responsibleName: (row.responsible_name as string) ?? undefined,
  };
}

function mapTaskToDb(t: Partial<Task>): Record<string, unknown> {
  const db: Record<string, unknown> = {};
  if (t.entityType !== undefined) db.entity_type = t.entityType;
  if (t.entityId !== undefined) db.entity_id = orNull(t.entityId);
  if (t.entityName !== undefined) db.entity_name = orNull(t.entityName);
  if (t.title !== undefined) db.title = t.title;
  if (t.description !== undefined) db.description = orNull(t.description);
  if (t.dueDate !== undefined) db.due_date = t.dueDate;
  if (t.taskStatus !== undefined) db.task_status = t.taskStatus;
  if (t.completed !== undefined) db.completed = t.completed;
  if (t.resolvedAt !== undefined) db.resolved_at = orNull(t.resolvedAt);
  db.deleted_at = orNull(t.deletedAt);
  if (t.history !== undefined) db.history = t.history;
  if (t.priority !== undefined) db.priority = t.priority;
  if (t.responsibleId !== undefined) db.responsible_id = orNull(t.responsibleId);
  if (t.responsibleName !== undefined) db.responsible_name = orNull(t.responsibleName);
  return db;
}

function mapTicket(row: Record<string, unknown>): Ticket {
  return {
    id: row.id as string,
    type: row.type as Ticket['type'],
    category: (row.category as string) ?? undefined,
    status: row.status as Ticket['status'],
    priority: (row.priority as number) ?? 3,
    subject: row.subject as string,
    text: row.text as string,
    contactName: (row.contact_name as string) ?? undefined,
    contactPhone: (row.contact_phone as string) ?? undefined,
    contactEmail: (row.contact_email as string) ?? undefined,
    contactPref: (row.contact_pref as string) ?? undefined,
    contactPrefs: (row.contact_prefs as string[]) || [],
    taskId: (row.task_id as string) ?? undefined,
    entityType: (row.entity_type as string) ?? undefined,
    entityId: (row.entity_id as string) ?? undefined,
    history: (row.history as Ticket['history']) || [],
    fromApi: (row.from_api as boolean) ?? undefined,
    createdAt: row.created_at as string,
    responsibleId: (row.responsible_id as string) ?? undefined,
    responsibleName: (row.responsible_name as string) ?? undefined,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) ?? undefined,
  };
}

function mapTicketToDb(t: Partial<Ticket>): Record<string, unknown> {
  const db: Record<string, unknown> = {};
  if (t.type !== undefined) db.type = t.type;
  if (t.category !== undefined) db.category = orNull(t.category);
  if (t.status !== undefined) db.status = t.status;
  if (t.contactPref !== undefined) db.contact_pref = orNull(t.contactPref);
  if (t.contactPrefs !== undefined) db.contact_prefs = t.contactPrefs;
  if (t.taskId !== undefined) db.task_id = orNull(t.taskId);
  if (t.priority !== undefined) db.priority = t.priority;
  if (t.responsibleId !== undefined) db.responsible_id = orNull(t.responsibleId);
  if (t.responsibleName !== undefined) db.responsible_name = orNull(t.responsibleName);
  if (t.subject !== undefined) db.subject = t.subject;
  if (t.text !== undefined) db.text = t.text;
  if (t.contactName !== undefined) db.contact_name = orNull(t.contactName);
  if (t.contactPhone !== undefined) db.contact_phone = orNull(t.contactPhone);
  if (t.contactEmail !== undefined) db.contact_email = orNull(t.contactEmail);
  if (t.entityType !== undefined) db.entity_type = orNull(t.entityType);
  if (t.entityId !== undefined) db.entity_id = orNull(t.entityId);
  if (t.history !== undefined) db.history = t.history;
  if (t.fromApi !== undefined) db.from_api = t.fromApi;
  if (t.responsibleId !== undefined) db.responsible_id = orNull(t.responsibleId);
  if (t.responsibleName !== undefined) db.responsible_name = orNull(t.responsibleName);
  db.deleted_at = orNull(t.deletedAt);
  return db;
}

function mapMediaRecord(row: Record<string, unknown>): MediaRecord {
  return {
    id: row.id as string,
    supplierId: row.supplier_id as string,
    supplierName: row.supplier_name as string,
    adTypeId: row.ad_type_id as string,
    adTypeName: row.ad_type_name as string,
    durationOptionId: (row.duration_option_id as string) ?? undefined,
    durationLabel: (row.duration_label as string) ?? undefined,
    pricePerMonth: (row.price_per_month as number) ?? undefined,
    totalPrice: (row.total_price as number) ?? undefined,
    status: row.status as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    notes: (row.notes as string) ?? undefined,
    expandedNotes: (row.expanded_notes as string) ?? undefined,
    createdAt: row.created_at as string,
    responsibleId: (row.responsible_id as string) ?? undefined,
    responsibleName: (row.responsible_name as string) ?? undefined,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) ?? undefined,
  };
}

function mapMediaRecordToDb(r: Partial<MediaRecord>): Record<string, unknown> {
  const db: Record<string, unknown> = {};
  if (r.supplierId !== undefined) db.supplier_id = r.supplierId;
  if (r.supplierName !== undefined) db.supplier_name = r.supplierName;
  if (r.adTypeId !== undefined) db.ad_type_id = r.adTypeId;
  if (r.adTypeName !== undefined) db.ad_type_name = r.adTypeName;
  if (r.durationOptionId !== undefined) db.duration_option_id = orNull(r.durationOptionId);
  if (r.durationLabel !== undefined) db.duration_label = orNull(r.durationLabel);
  if (r.pricePerMonth !== undefined) db.price_per_month = r.pricePerMonth;
  if (r.totalPrice !== undefined) db.total_price = r.totalPrice;
  if (r.status !== undefined) db.status = r.status;
  if (r.startDate !== undefined) db.start_date = r.startDate;
  if (r.endDate !== undefined) db.end_date = r.endDate;
  if (r.notes !== undefined) db.notes = orNull(r.notes);
  if (r.expandedNotes !== undefined) db.expanded_notes = orNull(r.expandedNotes);
  if (r.responsibleId !== undefined) db.responsible_id = orNull(r.responsibleId);
  if (r.responsibleName !== undefined) db.responsible_name = orNull(r.responsibleName);
  db.deleted_at = orNull(r.deletedAt);
  return db;
}

// ── SUPPLIERS ─────────────────────────────────────────────

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await requireClient().from('suppliers').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapSupplier);
}

// v1.30.40: если в БД ещё нет колонок edo_* (до прогона миграции SQL) — PostgREST роняет ВЕСЬ
// upsert (тот же урок, что ТЗ v1.23.36). Вырезаем edo-ключи и повторяем один раз.
function stripEdoKeys<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(r => {
    const { edo_operator, edo_token, ...rest } = r;
    return rest as T;
  });
}
function isMissingEdoColumnError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message || e || '');
  return msg.includes('edo_operator') || msg.includes('edo_token');
}

export async function createSupplier(supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>, id?: string): Promise<Supplier> {
  const uid = await currentAuthUserId();
  const payload = [{ ...(id ? { id } : {}), ...mapSupplierToDb(supplier), created_by: uid }];
  let res = await requireClient().from('suppliers').upsert(payload, { onConflict: 'id' }).select().single();
  if (res.error && isMissingEdoColumnError(res.error)) res = await requireClient().from('suppliers').upsert(stripEdoKeys(payload), { onConflict: 'id' }).select().single();
  if (res.error) throw res.error;
  return mapSupplier(res.data);
}

export async function updateSupplier(id: string, updates: Partial<Supplier>): Promise<Supplier> {
  const payload = mapSupplierToDb(updates);
  let res = await requireClient().from('suppliers').update(payload).eq('id', id).select().single();
  if (res.error && isMissingEdoColumnError(res.error)) res = await requireClient().from('suppliers').update(stripEdoKeys([payload])[0]).eq('id', id).select().single();
  if (res.error) throw res.error;
  return mapSupplier(res.data);
}

export async function deleteSupplier(id: string): Promise<void> {
  const { error } = await requireClient().from('suppliers').delete().eq('id', id);
  if (error) throw error;
}

// ── BUYERS ────────────────────────────────────────────────

export async function fetchBuyers(): Promise<Buyer[]> {
  const { data, error } = await requireClient().from('buyers').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapBuyer);
}

export async function createBuyer(buyer: Omit<Buyer, 'id' | 'createdAt' | 'updatedAt'>, id?: string): Promise<Buyer> {
  const uid = await currentAuthUserId();
  const payload = [{ ...(id ? { id } : {}), ...mapBuyerToDb(buyer), created_by: uid }];
  let res = await requireClient().from('buyers').upsert(payload, { onConflict: 'id' }).select().single();
  if (res.error && isMissingEdoColumnError(res.error)) res = await requireClient().from('buyers').upsert(stripEdoKeys(payload), { onConflict: 'id' }).select().single();
  if (res.error) throw res.error;
  return mapBuyer(res.data);
}

export async function updateBuyer(id: string, updates: Partial<Buyer>): Promise<Buyer> {
  const payload = mapBuyerToDb(updates);
  let res = await requireClient().from('buyers').update(payload).eq('id', id).select().single();
  if (res.error && isMissingEdoColumnError(res.error)) res = await requireClient().from('buyers').update(stripEdoKeys([payload])[0]).eq('id', id).select().single();
  if (res.error) throw res.error;
  return mapBuyer(res.data);
}

export async function deleteBuyer(id: string): Promise<void> {
  const { error } = await requireClient().from('buyers').delete().eq('id', id);
  if (error) throw error;
}

// ── TASKS ─────────────────────────────────────────────────

export async function fetchTasks(): Promise<Task[]> {
  const { data, error } = await requireClient().from('tasks').select('*').order('due_date', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapTask);
}

export async function createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>, id?: string): Promise<Task> {
  const uid = await currentAuthUserId();
  const { data, error } = await requireClient().from('tasks').upsert([{ ...(id ? { id } : {}), ...mapTaskToDb(task), created_by: uid }], { onConflict: 'id' }).select().single();
  if (error) throw error;
  return mapTask(data);
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<Task> {
  const { data, error } = await requireClient().from('tasks').update(mapTaskToDb(updates)).eq('id', id).select().single();
  if (error) throw error;
  return mapTask(data);
}

// Безвозвратного удаления задач НЕТ (ТЗ): задача помечается deleted_at
// (мягкое удаление) и фиксируется в журнале dbLogs раздела «База данных».
export async function deleteTask(id: string): Promise<void> {
  const { error } = await requireClient().from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ── TICKETS ───────────────────────────────────────────────

export async function fetchTickets(): Promise<Ticket[]> {
  const { data, error } = await requireClient().from('tickets').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapTicket);
}

export async function createTicket(ticket: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'>, id?: string): Promise<Ticket> {
  const { data, error } = await requireClient().from('tickets').upsert([{ ...(id ? { id } : {}), ...mapTicketToDb(ticket) }], { onConflict: 'id' }).select().single();
  if (error) throw error;
  return mapTicket(data);
}

export async function updateTicket(id: string, updates: Partial<Ticket>): Promise<Ticket> {
  const { data, error } = await requireClient().from('tickets').update(mapTicketToDb(updates)).eq('id', id).select().single();
  if (error) throw error;
  return mapTicket(data);
}

export async function deleteTicket(id: string): Promise<void> {
  const { error } = await requireClient().from('tickets').delete().eq('id', id);
  if (error) throw error;
}

// ── MEDIA RECORDS ─────────────────────────────────────────

export async function fetchMediaRecords(): Promise<MediaRecord[]> {
  const { data, error } = await requireClient().from('media_records').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapMediaRecord);
}

export async function createMediaRecord(record: Omit<MediaRecord, 'id' | 'createdAt' | 'updatedAt'>, id?: string): Promise<MediaRecord> {
  const { data, error } = await requireClient().from('media_records').upsert([{ ...(id ? { id } : {}), ...mapMediaRecordToDb(record) }], { onConflict: 'id' }).select().single();
  if (error) throw error;
  return mapMediaRecord(data);
}

export async function updateMediaRecord(id: string, updates: Partial<MediaRecord>): Promise<MediaRecord> {
  const { data, error } = await requireClient().from('media_records').update(mapMediaRecordToDb(updates)).eq('id', id).select().single();
  if (error) throw error;
  return mapMediaRecord(data);
}

export async function deleteMediaRecord(id: string): Promise<void> {
  const { error } = await requireClient().from('media_records').delete().eq('id', id);
  if (error) throw error;
}

// ── SETTINGS (single JSONB row, id = 'global') ─────────────
// Everything that isn't one of the 5 tables above (statuses, users,
// product groups, media ad types, knowledge base, db logs, ...) lives
// inside this one JSONB blob — mirroring exactly how CRMStore.settings
// is already modelled locally (see src/lib/store.ts).

export async function fetchSettings(): Promise<AppSettings | null> {
  const { data, error } = await requireClient().from('app_settings').select('settings').eq('id', 'global').maybeSingle();
  if (error) throw error;
  const settings = (data?.settings as AppSettings) ?? null;
  return settings ? sanitizeSettings(settings) : null;
}

/**
 * SECURITY: вырезает plaintext-пароли из settings.users перед любыми
 * операциями с сервером. Поле `password` существует только для локального
 * демо-режима и никогда не должно попадать в БД (строка app_settings
 * читается всеми авторизованными) и обратно из БД в локальный кэш.
 * Безопасно вызывать повторно — idempotent.
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
 * authenticated user (see supabase/schema.sql RLS policies), so
 * passwords must never leave the browser. Real authentication should
 * go through Supabase Auth (src/lib/auth.ts) once configured.
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  // ТЗ: защита от записи NULL — колонка settings NOT NULL
  if (!settings) { console.warn('[supabase] saveSettings: пустые настройки — запись пропущена'); return; }
  // v1.30.6: аварийная защита — никогда не пушим настройки без пользователей (признак затёртого localStorage):
  // иначе пустое локальное состояние перезапишет серверные настройки целиком.
  if (!Array.isArray(settings.users) || settings.users.length === 0) {
    console.error('[supabase] saveSettings: БЛОКИРОВКА — в настройках нет пользователей, push на сервер отменён (защита от затирания).');
    return;
  }
  let sanitized;
  try { sanitized = sanitizeSettings(settings) ?? {}; } catch { sanitized = {}; }
  if (sanitized === null || sanitized === undefined) sanitized = {};
  try {
    // Аудит-фикс 6: PostgREST upsert на app_settings падал 21000 "DELETE requires a WHERE clause"
    // (PostgREST эмулирует upsert как DELETE+INSERT на таблицах с RLS-триггером синхронизации).
    // Решение: явный UPDATE, при отсутствии строки — INSERT.
    const client = requireClient();
    const now = new Date().toISOString();
    const upd = await client.from('app_settings')
      .update({ settings: sanitized, updated_at: now })
      .eq('id', 'global')
      .select('id', { count: 'exact', head: true });
    if (upd.error) throw upd.error;
    if ((upd.count ?? 0) === 0) {
      // ТЗ v1.23.46: upsert вместо insert — иначе гонка «update вернул 0 строк → insert»
      // давала 409 duplicate key app_settings_pkey на каждом сохранении настроек.
      const ins = await client.from('app_settings')
        .upsert({ id: 'global', settings: sanitized, updated_at: now }, { onConflict: 'id' });
      if (ins.error) throw ins.error;
    }
  } catch (e) {
    // ТЗ: запись настроек не должна ронять приложение — лог и мягкий выход
    console.error('[supabase] saveSettings не удался:', e);
  }
}

// ── REAL-TIME SUBSCRIPTIONS ───────────────────────────────
//
// One postgres_changes channel per table, wired up here (mapping raw rows
// back to app types) and consumed by src/lib/realtime.ts, which is what
// actually starts/stops them for the whole app — see that file for how
// changes reach the UI without a manual refresh.

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

export function subscribeToBuyers(callback: (event: RealtimeEvent, entity: Buyer) => void) {
  return subscribeToTable('buyers', mapBuyer, callback);
}

export function subscribeToTasks(callback: (event: RealtimeEvent, entity: Task) => void) {
  return subscribeToTable('tasks', mapTask, callback);
}

export function subscribeToTickets(callback: (event: RealtimeEvent, entity: Ticket) => void) {
  return subscribeToTable('tickets', mapTicket, callback);
}

export function subscribeToMediaRecords(callback: (event: RealtimeEvent, entity: MediaRecord) => void) {
  return subscribeToTable('media_records', mapMediaRecord, callback);
}

/**
 * Real-time updates for everything that lives inside app_settings.settings
 * (knowledge base, statuses, users, ...). Fires with the fresh AppSettings
 * every time any client updates the row.
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

// ── FILE STORAGE ──────────────────────────────────────────

/** Uploads a file to the public "knowledge" Storage bucket and returns its public URL. */
export async function uploadKnowledgeFile(file: File): Promise<string> {
  const client = requireClient();
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;
  const { error } = await client.storage.from('knowledge').upload(`files/${fileName}`, file);
  if (error) throw error;
  const { data } = client.storage.from('knowledge').getPublicUrl(`files/${fileName}`);
  return data.publicUrl;
}

// ── BULK SYNC HELPERS (used by src/lib/store.ts) ───────────
// These pull/push everything in one shot and never throw — callers get a
// best-effort result and the local (localStorage) copy always stays the
// source of truth for what's shown on screen. See store.ts for the full
// offline-first sync strategy.

export interface RemoteSnapshot {
  suppliers: Supplier[];
  buyers: Buyer[];
  tasks: Task[];
  tickets: Ticket[];
  mediaRecords: MediaRecord[];
  settings: AppSettings | null;
}

/** Fetches every table. Returns null (and logs a warning) on any failure. */
export async function pullRemoteSnapshot(): Promise<RemoteSnapshot | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const [suppliers, buyers, tasks, tickets, mediaRecords, settings] = await Promise.all([
      fetchSuppliers(), fetchBuyers(), fetchTasks(), fetchTickets(), fetchMediaRecords(), fetchSettings(),
    ]);
    return { suppliers, buyers, tasks, tickets, mediaRecords, settings };
  } catch (err) {
    console.warn('[supabase] pullRemoteSnapshot failed, staying on local data:', err);
    return null;
  }
}

/**
 * Upserts every row of every entity array + the settings blob. Best-effort:
 * failures are logged, never thrown, so a sync hiccup never breaks the UI.
 */
export async function pushRemoteSnapshot(snapshot: RemoteSnapshot): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const client = requireClient();
  try {
    const uid = await currentAuthUserId();
    const tasks: Promise<unknown>[] = [];

    if (snapshot.suppliers.length) {
      const rows = snapshot.suppliers.map(s => ({ id: s.id, ...mapSupplierToDb(s), created_by: safeCreatedBy(s.createdBy, uid) }));
      tasks.push((async () => {
        let r = await client.from('suppliers').upsert(rows);
        if (r.error && isMissingEdoColumnError(r.error)) r = await client.from('suppliers').upsert(stripEdoKeys(rows));
        if (r.error) throw r.error;
      })());
    }
    if (snapshot.buyers.length) {
      const rows = snapshot.buyers.map(b => ({ id: b.id, ...mapBuyerToDb(b), created_by: safeCreatedBy(b.createdBy, uid) }));
      tasks.push((async () => {
        let r = await client.from('buyers').upsert(rows);
        if (r.error && isMissingEdoColumnError(r.error)) r = await client.from('buyers').upsert(stripEdoKeys(rows));
        if (r.error) throw r.error;
      })());
    }
    if (snapshot.tasks.length) {
      const rows = snapshot.tasks.map(t => ({ id: t.id, ...mapTaskToDb(t), created_by: safeCreatedBy(t.createdBy, uid) }));
      tasks.push(client.from('tasks').upsert(rows));
    }
    if (snapshot.tickets.length) {
      const rows = snapshot.tickets.map(t => ({ id: t.id, ...mapTicketToDb(t) }));
      tasks.push(client.from('tickets').upsert(rows));
    }
    if (snapshot.mediaRecords.length) {
      const rows = snapshot.mediaRecords.map(r => ({ id: r.id, ...mapMediaRecordToDb(r) }));
      tasks.push(client.from('media_records').upsert(rows));
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

/**
 * Admin-only: updates an existing manager's Supabase Auth account (email,
 * password) or bans/unbans it (ban_duration, e.g. '876000h' / 'none') —
 * called when the admin edits a user or changes their status to
 * «Заблокирован» / «Уволен» (ТЗ «Управление пользователями»). Requires the
 * update-manager Edge Function (see supabase/functions/update-manager/):
 *   supabase functions deploy update-manager --no-verify-jwt
 */
export async function updateManagerAccount(params: {
  id: string;
  email?: string;
  password?: string;
  ban_duration?: string;
}): Promise<{ id: string; email?: string }> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('update-manager', { body: params });
  if (error) {
    throw new Error(
      'Не удалось обновить пользователя в Supabase — убедитесь, что Edge Function update-manager развёрнута (см. README.md). ' +
        error.message,
    );
  }
  if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : 'Не удалось обновить пользователя');
  return data;
}
