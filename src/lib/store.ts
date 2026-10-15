import type {
  Supplier, Buyer, Task, Ticket, AppSettings, AppUser, HistoryEntry, FormConfig, FormConsentConfig, SyncLogEntry,
  ProductGroup, Source, PlanCity, PlanFactEntry, SupplierService, UserAccess,
  DEFAULT_LEAD_STATUSES,
  MediaAdType, MediaStatus, MediaRecord, KnowledgeCategory, KnowledgeItem,
} from '@/types';
import { EMPTY_ACCESS } from '@/types';
import { useEffect, useState } from 'react';
import { DEFAULT_STATUSES, DEFAULT_LEAD_STATUSES, DEFAULT_TASK_ENTITY_TYPES, DEFAULT_TASK_TYPES, SYSTEM_TASK_TYPE, CONTACT_PREFS, DEFAULT_SUPPLIER_GREETING, DEFAULT_FORM_CONFIGS, DEFAULT_FORM_CONSENT } from '@/constants';
import { generateId } from './utils';
import {
  isSupabaseConfigured, pullRemoteSnapshot, saveSettings,
  createSupplier, updateSupplier, deleteSupplier,
  createBuyer, updateBuyer, deleteBuyer,
  createTask, updateTask, deleteTask,
  createTicket, updateTicket, deleteTicket,
  createMediaRecord, updateMediaRecord, deleteMediaRecord,
  type RemoteSnapshot,
} from './supabase';

const STORE_KEY = 'vz_crm_data';

// ─────────────────────────────────────────────────────────────
// ЛОГ СИНХРОНИЗАЦИИ (ТЗ v1.23.43): локальный кольцевой буфер (последние 300 записей).
// Хранится в отдельном ключе localStorage и НИКОГДА не отправляется на сервер —
// иначе лог синка сам бы себя синхронизировал.
// ─────────────────────────────────────────────────────────────
const SYNC_LOG_KEY = 'vz_crm_sync_log';
const SYNC_ERRORS_KEY = 'vz_crm_sync_errors'; // ТЗ v1.23.52: история ошибок (переживает очистку лога)
let syncLogEntries: SyncLogEntry[] = (() => { try { return JSON.parse(localStorage.getItem(SYNC_LOG_KEY) || '[]'); } catch { return []; } })();
let syncErrorEntries: SyncLogEntry[] = (() => { try { return JSON.parse(localStorage.getItem(SYNC_ERRORS_KEY) || '[]'); } catch { return []; } })();
const syncLogListeners = new Set<() => void>();

export function getSyncLog(): SyncLogEntry[] { return syncLogEntries; }
export function getSyncErrors(): SyncLogEntry[] { return syncErrorEntries; } // история ошибок
export function clearSyncLog(): void {
  syncLogEntries = [];
  syncErrorEntries = []; // ТЗ v1.23.52: «Очистить» чистит и лог, и историю ошибок
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
  if (e.status === 'error') { // ошибки дублируем в историю (кап 500)
    syncErrorEntries.push(entry);
    if (syncErrorEntries.length > 500) syncErrorEntries = syncErrorEntries.slice(-500);
  }
  // ТЗ v1.23.52: автоочистка лога — перед вырезанием старых записей сохраняем ошибки в историю
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
  buyers: Buyer[];
  tasks: Task[];
  tickets: Ticket[];
  mediaRecords: MediaRecord[];
  settings: AppSettings;
}

function defaultAdmin(): AppUser {
  return {
    id: 'admin-1', name: 'Администратор', email: 'admin@vz.tech', password: 'admin123',
    role: 'admin',
    // Администратору все разделы доступны всегда — permissions/access для него не используются
    permissions: { dashboard: true, suppliers: true, buyers: true, tasks: true, support: true, media: true, pricing: true, planfact: true, analytics: true, knowledge: true, planfactEdit: true },
    access: { ...EMPTY_ACCESS },
    note: '',
    status: 'active',
    createdAt: new Date().toISOString(),
  };
}

const DEFAULT_PRODUCT_GROUPS: ProductGroup[] = [
  { id: 'pg-1',  name: 'Легковые иномарки',            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-2',  name: 'Грузовые иномарки',            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-3',  name: 'Китайские иномарки',           createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-4',  name: 'Легковые отечественные',       createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-5',  name: 'Грузовые отечественные',       createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-6',  name: 'Мототовары',                   createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-7',  name: 'Масла и автохимия (ГСМ)',      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-8',  name: 'Авто аксессуары',              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-9',  name: 'Инструменты и товары СТО',     createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-10', name: 'Шины и диски',                 createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-11', name: 'Автозвук',                     createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'pg-12', name: 'Аккумуляторы',                 createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

const DEFAULT_SOURCES: Source[] = [
  { id: 'src-1', name: 'реклама в интернете', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'src-2', name: 'email',               createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'src-3', name: 'звонок менеджера',    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'src-4', name: 'рекомендации',        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

const DEFAULT_SUPPLIER_SERVICES: SupplierService[] = [
  { id: 'svc-1',  name: 'DBS',   createdAt: new Date().toISOString(), system: true },
  { id: 'svc-2',  name: 'FBS',   createdAt: new Date().toISOString(), system: true },
  { id: 'svc-4',  name: 'MEDIA', createdAt: new Date().toISOString(), system: true },
];

// Типы обращений — дефолтный список, редактируется в Настройки → Типы и города
const DEFAULT_TICKET_TYPES: string[] = ['Вопрос', 'Проблема', 'Предложение', 'Жалоба', 'Другое'];

// Города для выпадающих списков в карточках поставщиков/покупателей.
// Сознательно пусто: реальный список (~100 городов) администратор
// заполняет сам в Настройки → Типы и города.
const DEFAULT_CITIES: string[] = [];

// Media ad types with embedded tariff options
// Медиатарифы (виды рекламных размещений с ценами) — сознательно пустой
// список для продакшена. Реальные пакеты и цены у каждого бизнеса свои —
// администратор добавляет их в Настройки → Медиа сервис.
const DEFAULT_MEDIA_AD_TYPES: MediaAdType[] = [];

const DEFAULT_MEDIA_STATUSES: MediaStatus[] = [
  { id: 'mst-1', name: 'Запрос МК',                  bgColor: '#FEF3C7', textColor: '#B45309', createdAt: new Date().toISOString() },
  { id: 'mst-2', name: 'Отправлен МК',               bgColor: '#EFF6FF', textColor: '#1D4ED8', createdAt: new Date().toISOString() },
  { id: 'mst-3', name: 'Переговоры',                 bgColor: '#F5F3FF', textColor: '#6D28D9', createdAt: new Date().toISOString() },
  { id: 'mst-4', name: 'Отправлен счет',             bgColor: '#FFF7ED', textColor: '#C2410C', createdAt: new Date().toISOString() },
  { id: 'mst-5', name: 'Активен на платформе',       bgColor: '#D1FAE5', textColor: '#065F46', createdAt: new Date().toISOString() },
  { id: 'mst-6', name: 'Ожидает места (предоплата)', bgColor: '#FCE7F3', textColor: '#9D174D', createdAt: new Date().toISOString() },
  { id: 'mst-7', name: 'Аннулирован',                bgColor: '#FEE2E2', textColor: '#B91C1C', createdAt: new Date().toISOString() },
  { id: 'mst-8', name: 'Заканчивается срок',         bgColor: '#F3F4F6', textColor: '#6B7280', createdAt: new Date().toISOString() },
];

// База знаний — пустой список для продакшена. Реальный контент
// (регламенты, инструкции, шаблоны) сотрудники добавляют сами через
// интерфейс — здесь ничего заранее не пишем, включая категории: их
// названия и структура тоже у каждой компании свои.
const DEFAULT_KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [];
const DEFAULT_KNOWLEDGE_ITEMS: KnowledgeItem[] = [];

function defaultStore(): CRMStore {
  const admin = defaultAdmin();

  const defaultPlanCities: PlanCity[] = [
    { id: generateId(), name: 'Москва', createdAt: new Date().toISOString() },
    { id: generateId(), name: 'Санкт-Петербург', createdAt: new Date().toISOString() },
    { id: generateId(), name: 'Екатеринбург', createdAt: new Date().toISOString() },
  ];

  return {
    // Пустой старт для продакшена — никаких тестовых
    // поставщиков/покупателей/задач/обращений/медиаразмещений. Первая
    // реальная запись создаётся администратором или менеджером через
    // интерфейс, либо приходит через публичную форму (см. Настройки → Формы).
    suppliers: [],
    buyers: [],
    tasks: [],
    tickets: [],
    mediaRecords: [],
    settings: {
      statuses: DEFAULT_STATUSES,
      serviceSearchLists: [],
      users: [admin],
      planFact: [],
      supplierTypes: ['Поставщик/склад', 'Производитель/бренд'],
      buyerTypes: ['магазин', 'СТО', 'организация'],
      ticketTypes: [...DEFAULT_TICKET_TYPES],
      cities: [...DEFAULT_CITIES],
      quickLinks: { mail: '', platform: '' },
      planCities: defaultPlanCities,
      productGroups: DEFAULT_PRODUCT_GROUPS,
      sources: DEFAULT_SOURCES,
      supplierServices: DEFAULT_SUPPLIER_SERVICES,
      dbLogs: [],
      taskEntityTypes: DEFAULT_TASK_ENTITY_TYPES,
      taskTypes: [...DEFAULT_TASK_TYPES],
      contactPrefs: [...CONTACT_PREFS],
      greetings: { supplier: DEFAULT_SUPPLIER_GREETING },
      mediaAdTypes: DEFAULT_MEDIA_AD_TYPES,
      mediaStatuses: DEFAULT_MEDIA_STATUSES,
      knowledgeItems: DEFAULT_KNOWLEDGE_ITEMS,
      knowledgeCategories: DEFAULT_KNOWLEDGE_CATEGORIES,
      forms: DEFAULT_FORM_CONFIGS,
    },
  };
}

// Кросс-вкладочная синхронизация: другая вкладка записала свежие данные —
// перечитываем store, чтобы устаревшая вкладка не перезаписала их пустым стейтом.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY && e.newValue) {
      try {
        if (e.newValue !== lastSavedJson) { lastSavedJson = e.newValue; notifyStoreChange(); }
      } catch { /* ignore */ }
    }
  });
}

let leadMigrationDone = false;

export function getStore(): CRMStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) { const s = defaultStore(); ensureSystemStatuses(s.settings); saveStore(s); return s; }
    const parsed = JSON.parse(raw) as CRMStore;

    const p = parsed as unknown as Record<string, unknown>;
    if (p['supplierLeads']) delete p['supplierLeads'];
    if (p['buyerLeads']) delete p['buyerLeads'];

    if (!parsed.mediaRecords) parsed.mediaRecords = [];

    const settings = parsed.settings;
    if (!settings.productGroups) settings.productGroups = DEFAULT_PRODUCT_GROUPS;
    if (!settings.sources) settings.sources = DEFAULT_SOURCES;
    if (!settings.dbLogs) settings.dbLogs = [];
    if (!settings.taskEntityTypes) settings.taskEntityTypes = DEFAULT_TASK_ENTITY_TYPES;
    if (!settings.mediaStatuses) settings.mediaStatuses = DEFAULT_MEDIA_STATUSES;
    // v_1.9: досеивание недостающих системных статусов медиа (пользовательские не трогаем)
    {
      const have = new Set((settings.mediaStatuses || []).map(s => s.name));
      for (const s of DEFAULT_MEDIA_STATUSES) {
        if (!have.has(s.name)) settings.mediaStatuses = [...(settings.mediaStatuses || []), { ...s, id: `${s.id}-${Date.now().toString(36)}` }];
      }
    }
    if (!settings.knowledgeItems) settings.knowledgeItems = DEFAULT_KNOWLEDGE_ITEMS;
    if (!settings.knowledgeCategories) settings.knowledgeCategories = DEFAULT_KNOWLEDGE_CATEGORIES;

    // Migrate supplierTags → supplierServices
    const ps = settings as unknown as Record<string, unknown>;
    if (!settings.supplierServices) {
      const oldTags = ps['supplierTags'] as Array<{ id: string; name: string; createdAt: string }> | undefined;
      settings.supplierServices = (oldTags && Array.isArray(oldTags) && oldTags.length > 0) ? oldTags : DEFAULT_SUPPLIER_SERVICES;
    }
    // Системные сервисы продаж — ВНЕ гейта.
    {
      const SYS_SVC = ['DBS', 'MARKET', 'MEDIA'];
      if (!Array.isArray(settings.supplierServices)) settings.supplierServices = [];
      SYS_SVC.forEach(name => {
        const existing = settings.supplierServices.find(s => s.name === name);
        if (existing) existing.system = true;
        else settings.supplierServices.push({ id: `svc-${name.toLowerCase()}`, name, createdAt: new Date().toISOString(), system: true });
      });
    }

    // Migrate mediaAdTypes: ensure durationOptions exist
    if (!settings.mediaAdTypes || settings.mediaAdTypes.length === 0) {
      settings.mediaAdTypes = DEFAULT_MEDIA_AD_TYPES;
    } else {
      settings.mediaAdTypes = (Array.isArray(settings.mediaAdTypes) ? settings.mediaAdTypes : []).map(at => ({
        enabled: true, // v_1.9: по умолчанию тариф включён
        ...at,
        durationOptions: (at.durationOptions || []).map(o => ({ enabled: true, ...o })), // v_1.9
        spotsCount: at.spotsCount || 1,
        pricePerMonth: at.pricePerMonth || 0,
      }));
    }

    // Migrate planCities
    if (!settings.planCities || !Array.isArray(settings.planCities) || typeof (settings.planCities as unknown[])[0] === 'string') {
      const oldCities = ((settings.planCities as unknown) as string[] | undefined) || [];
      settings.planCities = oldCities.map((c: string) => ({ id: generateId(), name: c, createdAt: new Date().toISOString() }));
    }

    // Типы обращений (появились в настройках) — подставляем дефолт, если нет
    // ⚠ Миграции статусов (ТЗ) — ВЫПОЛНЯЮТСЯ ОДИН РАЗ за загрузку страницы.
    // getStore() вызывается на КАЖДОМ рендере каждой страницы; без флага релиз
    // с базой лидов (v1.5.0) порождал мутации в фазе рендера → React #301.
    if (!leadMigrationDone) {
      leadMigrationDone = true;
    // «Архив дублей» (ТЗ): системный статус поставщиков/покупателей, если его ещё нет
    if (!settings.statuses.some(s => s.id === 'dup_archive' || s.name === 'Архив дублей')) {
      settings.statuses.push({ id: 'dup_archive', name: 'Архив дублей', color: '#6B7280', order: 6, entityTypes: ['supplier', 'buyer'] });
    }

    // База лидов (ТЗ): добавляем системные статусы лидов, если их ещё нет
    if (!settings.statuses) settings.statuses = [];
    for (const ls of DEFAULT_LEAD_STATUSES) {
      if (!settings.statuses.some(s => s.id === ls.id || s.name === ls.name)) {
        settings.statuses.push({ ...ls });
      }
    }
    // Статусы лидов: канонические названия (если кто-то правил вручную)
    const LEAD_STATUS_BY_ID: Record<string, string> = {
      lead_new: 'ЛИД', lead_mailing: 'Рассылка', lead_call: 'Обзвон',
      lead_found: 'Найден в базе', lead_unsub: 'Отписался',
      lead_dup: 'Архив дублей', lead_archive: 'АРХИВ',
    };
    for (const s of settings.statuses) {
      const canonicalName = LEAD_STATUS_BY_ID[s.id];
      const canonicalOrder = DEFAULT_LEAD_STATUSES.find(d => d.id === s.id)?.order;
      // Мутируем ТОЛЬКО при реальном расхождении — getStore() вызывается на каждом рендере
      if (canonicalName && (s.name !== canonicalName || s.order !== canonicalOrder)) {
        s.name = canonicalName;
        s.order = canonicalOrder ?? s.order;
      }
    }
    if (Array.isArray(settings.leads)) {
      // ТЗ: статус «Найден в базе» удалён — такие лиды переводим в «Архив дублей»
      settings.leads = settings.leads.map(l => l.status === 'Найден в базе' ? { ...l, status: 'Архив дублей', deletedAt: l.deletedAt || new Date().toISOString() } : l);
    } else {
      settings.leads = [];
    }
    }

    // Новые списки типов (ТЗ): старые не-системные типы удаляются, добавляются новые.
    // Существующие задачи/обращения со старыми типами в данных не теряются —
    // они по-прежнему видны через «Все типы».
    const NEW_TASK_TYPES = ['Ждет активации', 'От поддержки', 'Обратная связь', 'Техподдержка', 'Документы', 'Отправить КП'];
    const NEW_TICKET_TYPES = ['Обратная связь', 'Техподдержка', 'Регистрация', 'Партнерство', 'Пожелания']; // v_1.9: + Пожелания (системный)
        // v_1.9: переименование «Маркетинг-кит» → «Регистрация» в существующих базах
    settings.ticketTypes = (settings.ticketTypes || []).map(t => t === 'Маркетинг-кит' ? 'Регистрация' : t);
    for (const t of NEW_TICKET_TYPES) { if (!(settings.ticketTypes || []).includes(t)) settings.ticketTypes = [...(settings.ticketTypes || []), t]; }
settings.taskTypes = Array.from(new Set([...(settings.taskTypes || []).filter((t: string) => NEW_TASK_TYPES.includes(t)), ...NEW_TASK_TYPES]));
    settings.ticketTypes = Array.from(new Set([...(settings.ticketTypes || []).filter((t: string) => NEW_TICKET_TYPES.includes(t)), ...NEW_TICKET_TYPES]));
    if (!settings.ticketTypes || !Array.isArray(settings.ticketTypes)) settings.ticketTypes = [...DEFAULT_TICKET_TYPES];
    // Города для карточек поставщиков/покупателей
    if (!settings.cities || !Array.isArray(settings.cities)) settings.cities = [...DEFAULT_CITIES];
    // v1.30.0: дашборд ЛК поставщика
    if (!settings.lkDashboard) settings.lkDashboard = { buyersMode: 'manual', buyersCount: 500, warehousesMode: 'db', warehousesCount: 500, skuMode: 'manual', skuCount: 350000, requestsPerDay: 1000 };
    else {
      // v1.30.0: миграция счётчиков на индивидуальные режимы
      const ld = settings.lkDashboard as Record<string, unknown>;
      settings.lkDashboard = {
        buyersMode: (ld.countersMode === 'database' ? 'db' : (ld.buyersMode as 'manual' | 'db')) || 'manual',
        buyersCount: Number(ld.buyersCount ?? 500),
        warehousesMode: (ld.warehousesMode as 'manual' | 'db') || 'db',
        warehousesCount: Number(ld.warehousesCount ?? 500),
        skuMode: (ld.skuMode as 'manual' | 'db') || 'manual',
        skuCount: Number(ld.skuCount ?? 350000),
        requestsPerDay: Number(ld.requestsPerDay ?? 1000),
      };
    }
    if (!settings.lkBanner) settings.lkBanner = { image: '', link: '' };
    if (!Array.isArray(settings.lkNews)) settings.lkNews = [];
    if (!Array.isArray(settings.lkVendorNews)) settings.lkVendorNews = [];
    if (!settings.lkLinks) settings.lkLinks = { crossdock: '', promo: '' };
    // v1.30.43: операторы (персональные менеджеры) ЛК поставщика
    if (!Array.isArray(settings.lkOperators)) settings.lkOperators = [];
    if (!Array.isArray(settings.edoOperators)) settings.edoOperators = [];

    // Быстрые кнопки шапки (у старых сохранений может не быть)
    if (!settings.quickLinks || typeof settings.quickLinks !== 'object') {
      settings.quickLinks = { mail: '', platform: '' };
    }

    // Ensure 'Лид' status exists
    if (!settings.statuses.find(s => s.name === 'Лид')) {
      settings.statuses.unshift({ id: 'lead', name: 'Лид', color: '#888888', bgColor: '#F3F4F6', textColor: '#374151', entityTypes: ['supplier', 'buyer'], order: 0 });
    }
    // Системный статус поставщика «Настройка прайса» — добавляется на существующие базы
    if (!settings.statuses.find(s => s.name === 'Настройка прайса')) {
      const idx = settings.statuses.findIndex(s => s.name === 'Активный');
      const entry = { id: 'price_setup', name: 'Настройка прайса', color: '#F97316', bgColor: '#FFF7ED', textColor: '#C2410C', entityTypes: ['supplier'], order: 3.5 };
      if (idx >= 0) settings.statuses.splice(idx + 1, 0, entry);
      else settings.statuses.push(entry);
    }
    // Ensure 'Новый с сайта' status exists (public forms — Настройки → Формы)
    if (!settings.statuses.find(s => s.name === 'Новый с сайта')) {
      settings.statuses.push({ id: 'from_site', name: 'Новый с сайта', color: '#6D28D9', bgColor: '#F5F3FF', textColor: '#6D28D9', entityTypes: ['supplier', 'buyer'], order: settings.statuses.length });
    }
    // Ensure public form configs exist
    if (!settings.forms) {
      settings.forms = DEFAULT_FORM_CONFIGS;
    }
    // v_1.9: форма «Запросить Маркетинг-кит» (merge для существующих баз)
    settings.forms = { marketingKit: (DEFAULT_FORM_CONFIGS as Record<string, FormConfig>).marketingKit, ...(settings.forms as Record<string, FormConfig>) };
    // ТЗ v1.22.38: миграция системных текстов успеха — старые сохранённые конфиги
    // перекрывали новые дефолты, поэтому тексты «не обновлялись».
    const NEW_SUCCESS: Record<string, string> = {
      supplier: 'Поздравляем с успешной регистрацией на платформе!\n\nВ течение 24 часов мы отправим вам на почту Приглашение и ПИН-КОД для самостоятельной настройки вашего склада в системе.\n\nЭто будет просто - не переживайте! Если что, мы всегда рядом.\n\nС уважением, команда ВсемЗапчасти.',
      buyer: 'Поздравляем с успешной регистрацией на платформе!\n\nВ течение 24 часов мы отправим вам на почту доступ в Ваш личный кабинет. Ожидайте! Если что, мы всегда рядом.\n\nС уважением, команда ВсемЗапчасти.',
      ticket: 'Благодарим за обращение!\n\nВаше сообщение уже в поддержке.\n\nОжидайте ответа! Если что, мы всегда рядом.\n\nС уважением, команда ВсемЗапчасти.',
      marketingKit: 'Благодарим за Ваш интерес! Маркетинг-кит уже в пути.\n\nОжидайте презентацию на почте! Если что, мы всегда рядом.\n\nС уважением, команда ВсемЗапчасти.',
    };
    const OLD_GENERIC = ['Спасибо! Заявка отправлена, мы свяжемся с вами в ближайшее время.', 'Заявка на Маркетинг-кит отправлена!', ''];
    (Object.keys(settings.forms) as string[]).forEach(k => {
      const cfg = settings.forms[k] as FormConfig | undefined;
      if (cfg && OLD_GENERIC.includes((cfg.successMessage || '').trim()) && NEW_SUCCESS[k]) {
        cfg.successMessage = NEW_SUCCESS[k];
      }
    });
    // Согласие на обработку ПДн: у старых конфигов его нет — подставляем дефолт
    (Object.keys(settings.forms) as Array<'supplier' | 'buyer' | 'ticket' | 'marketingKit'>).forEach(k => {
      const cfg = settings.forms[k] as FormConfig & { consent?: FormConsentConfig };
      if (!cfg.consent) cfg.consent = { ...DEFAULT_FORM_CONSENT };
    });

    // Migrate users (ТЗ «Управление пользователями»):
    // active:boolean → status:'active'|'blocked'|'fired'; удалён устаревший ключ leads;
    // добавлены права dashboard/knowledge (существующим менеджерам — включены, чтобы не лишить
    // доступа к разделам, которые раньше были видны всем); добавлен блок фильтров access.
    settings.users = (settings.users || []).map(rawUser => {
      const u = rawUser as AppUser & { active?: boolean };
      const migrated = { ...u } as AppUser & { active?: boolean };
      delete migrated.active;
      if (!migrated.status) migrated.status = u.active === false ? 'blocked' : 'active';
      const perms = { ...(migrated.permissions || {}) } as unknown as Record<string, unknown>;
      delete perms['leads'];
      if (perms['dashboard'] === undefined) perms['dashboard'] = true;
      if (perms['knowledge'] === undefined) perms['knowledge'] = true;
      if (perms['planfactEdit'] === undefined) perms['planfactEdit'] = migrated.role === 'admin';
      if (migrated.note === undefined) migrated.note = '';
      migrated.permissions = perms as AppUser['permissions'];
      if (!migrated.access) migrated.access = { ...EMPTY_ACCESS };
      return migrated;
    });

    // Воронка статусов поставщиков (ТЗ): переименование старых статусов,
    // «Не активный» → «АРХИВ», сортировка по этапам воронки.
    const STATUS_RENAMES: Record<string, string> = {
      from_site: 'Новый с сайта', // ТЗ v1.22.3: канон статуса заявок с формы
      in_work: 'Лид CRM', registered: 'Лид CRM',
      negotiation: 'Переговоры', commercial: 'Переговоры',
      price_setup: 'Приветствие',
      problem: 'Проблемный', inactive: 'АРХИВ',
    };
    const FUNNEL_ORDER: Record<string, number> = {
      from_site: 0, in_work: 1, negotiation: 2,
      price_setup: 3, active: 4, problem: 5, dup_archive: 6, archive: 7,
    };
    const oldNames: Record<string, string> = {
      'Зарег. с формы': 'Новый с сайта', // ТЗ v1.22.3: канон статуса заявок с формы
      'Зарег. в CRM': 'Лид CRM',
    };
    settings.statuses = (settings.statuses || []).map(s => {
      const next = { ...s };
      // «База лидов» удалён: сущности переводим на «Зарег. в CRM»
      if (next.id === 'lead') { oldNames[next.name] = 'Зарег. в CRM'; next.id = '__remove__'; }
      if (STATUS_RENAMES[next.id]) { oldNames[next.name] = STATUS_RENAMES[next.id]; next.name = STATUS_RENAMES[next.id]; }
      // «Активный» — системный статус активации на платформе: возвращаем каноническое имя
      if (next.id === 'active' && next.name !== 'Активный') { oldNames[next.name] = 'Активный'; next.name = 'Активный'; }
      if (next.id === 'inactive') next.id = 'archive';
      next.order = FUNNEL_ORDER[next.id] ?? (next.order ?? 99);
      return next;
    }).filter(s => s.id !== '__remove__');
    const byName = new Set<string>();
    settings.statuses = settings.statuses.filter(s => byName.has(s.name) ? false : (byName.add(s.name), true));
    if (!settings.statuses.some(s => s.id === 'archive')) {
      settings.statuses.push({ id: 'archive', name: 'АРХИВ', color: '#6B7280', order: 7, entityTypes: ['supplier', 'buyer'] });
    }
    // Переименовываем значения статусов у существующих сущностей
    parsed.suppliers = (parsed.suppliers || []).map(s => oldNames[s.status] ? { ...s, status: oldNames[s.status] } : s);
    parsed.buyers = (parsed.buyers || []).map(b => oldNames[b.status] ? { ...b, status: oldNames[b.status] } : b);

    // Типы задач: если список пуст/отсутствует (базы, созданные до этой фичи) — дефолтный набор.
    // Системный тип «Ждет активации» постоянный: возвращаем его в список, если удалили/нет.
    if (!Array.isArray(settings.taskTypes) || !settings.taskTypes.length) settings.taskTypes = [...DEFAULT_TASK_TYPES];
    else {
      const sysTypes = [SYSTEM_TASK_TYPE, 'От поддержки'].filter(x => !settings.taskTypes.includes(x));
      if (sysTypes.length) settings.taskTypes = [...sysTypes, ...settings.taskTypes];
    }

    // Способы связи: если список пуст/отсутствует — дефолтный набор из константы.
    // Системные типы (почта, телефон, MAX) постоянны: возвращаем, если пропали.
    if (!Array.isArray(settings.contactPrefs) || !settings.contactPrefs.length) settings.contactPrefs = [...CONTACT_PREFS];
    else {
      const sysMissing = SYSTEM_CONTACT_PREFS.filter(x => !settings.contactPrefs!.some(p => p.toLowerCase() === x));
      if (sysMissing.length) settings.contactPrefs = [...sysMissing, ...settings.contactPrefs];
      // ТЗ v1.22.30: справочник ролей контактов (редактируемый)
      if (!Array.isArray(settings.roleTypes) || !settings.roleTypes.length) settings.roleTypes = ['Директор', 'Менеджер', 'Собственник', 'РОП', 'ТП'];
    }

    // Приветствие поставщику: дефолтный шаблон, если пусто/отсутствует
    if (!settings.greetings) settings.greetings = {};
    if (typeof settings.greetings.supplier !== 'string' || !settings.greetings.supplier) settings.greetings.supplier = DEFAULT_SUPPLIER_GREETING;

    // Migrate planFact: год/месяц + ручной факт → период startDate/endDate.
    // Факт теперь считается автоматически из createdAt поставщиков/покупателей (ТЗ).
    settings.planFact = (settings.planFact || []).map(raw => {
      const e = raw as PlanFactEntry & { year?: number; month?: number; factSuppliers?: number; factBuyers?: number };
      if (!e.startDate && e.year && e.month) {
        e.startDate = `${e.year}-${String(e.month).padStart(2, '0')}-01`;
        e.endDate = new Date(e.year, e.month, 0).toISOString().slice(0, 10);
      }
      delete e.year; delete e.month; delete e.factSuppliers; delete e.factBuyers;
      return e;
    });
    // PlanFact: единая запись с planSuppliers/planBuyers → отдельные записи по типу
    // kind ('suppliers' | 'buyers') с одним значением plan — чтобы разным менеджерам
    // ставить разные планы (ТЗ). Одна старая запись с обоими планами распадается на две.
    settings.planFact = (settings.planFact || []).flatMap(raw => {
      const e = raw as PlanFactEntry & { planSuppliers?: number; planBuyers?: number; kind?: 'suppliers' | 'buyers' };
      if (e.kind) { delete e.planSuppliers; delete e.planBuyers; return [e]; }
      const out: PlanFactEntry[] = [];
      if ((e.planSuppliers || 0) > 0) out.push({ ...e, id: e.id, kind: 'suppliers', plan: e.planSuppliers! });
      if ((e.planBuyers || 0) > 0) out.push({ ...e, id: `${e.id}-b`, kind: 'buyers', plan: e.planBuyers! });
      if (!out.length) out.push({ ...e, kind: 'suppliers', plan: 0 });
      delete e.planSuppliers; delete e.planBuyers;
      return out;
    });

    // Knowledge: флаг доступа менеджерам (ТЗ). Существующие материалы остаются видимыми всем.
    (settings.knowledgeItems || []).forEach(i => { if (i.availableToManagers === undefined) i.availableToManagers = true; });

    // Migrate suppliers
    parsed.suppliers = parsed.suppliers.map(s => {
      const a = s as unknown as Record<string, unknown>;
      let updated = { ...s };
      if (a['companyScore'] === undefined && a['priority'] !== undefined) updated = { ...updated, companyScore: Math.min(10, Number(a['priority']) * 2) };
      if (a['companyScore'] === undefined) updated = { ...updated, companyScore: 5 };
      if (!updated.services) { updated = { ...updated, services: (a['tags'] as string[] | undefined) || [] }; }
      return updated;
    });

    // Migrate buyers
    parsed.buyers = parsed.buyers.map(b => {
      const a = b as unknown as Record<string, unknown>;
      if (a['companyScore'] === undefined && a['priority'] !== undefined) return { ...b, companyScore: Math.min(10, Number(a['priority']) * 2) };
      if (a['companyScore'] === undefined) return { ...b, companyScore: 5 };
      return b;
    });

    // Migrate tasks
    parsed.tasks = parsed.tasks.map(t => {
      const a = t as unknown as Record<string, unknown>;
      const taskStatus = a['taskStatus'] ?? (t.completed ? 'Решено' : 'Новая');
      return { ...t, taskStatus: taskStatus as import('@/types').TaskStatus, priority: Number(a['priority'] ?? 3) };
    });

    // Migrate ticket statuses
    parsed.tickets = parsed.tickets.map(tk => {
      const statusMap: Record<string, string> = { 'Новое': 'Новая', 'В обработке': 'Решаю', 'Ожидание ответа': 'Решаю', 'Закрыто': 'Без решения' };
      return { ...tk, status: (statusMap[tk.status] ?? tk.status) as import('@/types').TicketStatus };
    });

    // Migrate user permissions
    settings.users = settings.users.map(u => ({ ...u, permissions: { media: true, ...u.permissions } }));

    // Migrate media records: ensure new fields exist
    parsed.mediaRecords = (parsed.mediaRecords || []).map(r => ({
      ...r,
      pricePerMonth: r.pricePerMonth,
      totalPrice: r.totalPrice,
      durationLabel: r.durationLabel,
      expandedNotes: r.expandedNotes || '',
    }));

    // ГАРАНТИЯ: системные статусы (лиды, «Архив дублей») при каждой загрузке —
    // независимо от здоровья миграционной цепочки выше.
    ensureSystemStatuses(parsed.settings);
    return parsed;
  } catch (e) {
    // FAIL-SAFE: любая ошибка загрузки/миграции НЕ должна уничтожать данные.
    // Раньше catch писал defaultStore() прямо в localStorage — одна ошибка
    // в миграции = полная потеря базы при F5. Теперь: логируем причину,
    // возвращаем сырые данные как есть (без миграций), хранилище не трогаем.
    console.error('[store] ОШИБКА загрузки/миграции localStorage — данные НЕ затираются:', e);
    try {
      const raw2 = localStorage.getItem(STORE_KEY);
      if (raw2) {
        const p2 = JSON.parse(raw2) as CRMStore;
        ensureSystemStatuses(p2.settings);
        return p2;
      }
    } catch { /* совсем битый JSON — идём в дефолт ниже */ }
    return defaultStore();
  }
}

export function clearLocalStoreCache() {
  // FORENSIC: любая очистка кэша логируется со стеком — при повторной потере
  // данных консоль покажет точного виновника.
  console.warn('[store] clearLocalStoreCache вызван:', new Error('trace').stack);
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  localStorage.removeItem(STORE_KEY);
  lastSavedJson = '';
}

export let lastSavedJson = '';
function saveStore(store: CRMStore, previousStore?: CRMStore) {
  const json = JSON.stringify(store);
  // Защита от циклов: если данные не изменились — ничего не делаем.
  // Без этой проверки любая запись → notify → рендер → запись могла
  // крутиться бесконечно (React #301 «Too many re-renders»).
  if (json === lastSavedJson) return;
  lastSavedJson = json;
  localStorage.setItem(STORE_KEY, json);
  notifyStoreChange();
  if (previousStore) scheduleRemoteSync(previousStore, store);
}

export function updateStore(updater: (store: CRMStore) => CRMStore) {
  const store = getStore();
  const updated = updater(store);
  saveStore(updated, store);
  return updated;
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

// Пакетная отправка: сколько бы saveStore ни вызвалось синхронно (realtime-эхо,
// merge-цепочки, пакетные правки) — подписчики получают ОДИН тик на микротаску.
// Механически исключает React #301 «Too many re-renders» от шторма уведомлений.
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
//   1. On app start, initRemoteSync() pulls the 5 entity tables + settings
//      from Supabase and overwrites the local cache with them (Supabase is
//      the source of truth once configured).
//   2. Every saveStore() call schedules a debounced push of the current
//      snapshot back to Supabase, so changes made in the CRM reach the
//      database — and other devices/users — within ~1.5s, without any
//      page having to know Supabase exists.
//
// This keeps the UI instantaneous (it always reads/writes localStorage
// synchronously) while still being backed by a real multi-user database.

let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 1500;

type EntityName = 'suppliers' | 'buyers' | 'tasks' | 'tickets' | 'mediaRecords';

// ТЗ v1.23.44: сервер владеет служебными полями — они НЕ должны участвовать в сравнении,
// иначе дифф никогда не сходится: update → триггер меняет updated_at/дописывает history →
// pull видит "расхождение" → снова update → бесконечный цикл (шторм уведомлений, тормоза).
// ТЗ v1.23.51: кроме служебных — игнорируем поля, которыми владеет СЕРВЕР/ЛК:
// service_access (PIN самообслуживания), warehouse_locations (склады из ЛК),
// company_score/scoring (вычисляемые триггерами). Иначе CRM вечно «догонял» сервер —
// дифф не сходился, и одна и та же запись уходила в обновление каждый цикл.
// ТЗ v1.25.12: склады убраны из исключений — маппер ведёт warehouse_locations в ОБЕ стороны,
// значит CRM↔ЛК зеркальны: удаление/правка SKU в любом месте доезжает до базы и отображается
// в другом. Исключения оставлены только для НЕмапируемых серверных полей (иначе вечный цикл).
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
      switch (entity) {
        case 'suppliers': operations.push(createSupplier(next as never, id)); break;
        case 'buyers': operations.push(createBuyer(next as never, id)); break;
        case 'tasks': operations.push(createTask(next as never, id)); break;
        case 'tickets': operations.push(createTicket(next as never, id)); break;
        case 'mediaRecords': operations.push(createMediaRecord(next as never, id)); break;
      }
    } else if (stableEntityJson(prev) !== stableEntityJson(next)) {
      opsMeta.push({ entity, op: 'update', id });
      switch (entity) {
        case 'suppliers': operations.push(updateSupplier(id, next as never)); break;
        case 'buyers': operations.push(updateBuyer(id, next as never)); break;
        case 'tasks': operations.push(updateTask(id, next as never)); break;
        case 'tickets': operations.push(updateTicket(id, next as never)); break;
        case 'mediaRecords': operations.push(updateMediaRecord(id, next as never)); break;
      }
    }
  }

  // Hard deletions are rare because CRM uses soft-delete. Keep this branch for
  // admin hard-delete actions so the server cannot retain orphaned rows.
  for (const id of oldById.keys()) {
    if (newById.has(id)) continue;
    opsMeta.push({ entity, op: 'delete', id });
    switch (entity) {
      case 'suppliers': operations.push(deleteSupplier(id)); break;
      case 'buyers': operations.push(deleteBuyer(id)); break;
      case 'tasks': operations.push(deleteTask(id)); break;
      case 'tickets': operations.push(deleteTicket(id)); break;
      case 'mediaRecords': operations.push(deleteMediaRecord(id)); break;
    }
  }

  const results = await Promise.allSettled(operations);
  let okCount = 0;
  results.forEach((r, i) => {
    const errObj = r.status === 'fulfilled' ? (r.value as { error?: { message?: string; code?: string } | null } | null)?.error : undefined;
    const reason = r.status === 'rejected' ? String((r as PromiseRejectedResult).reason) : undefined;
    const meta = opsMeta[i];
    if (errObj || reason) {
      // ТЗ v1.23.43: операции с ошибкой ВНУТРИ resolved-значения (PostgREST возвращает
      // {error} без throw!) раньше пропадали молча — теперь каждая попадает в лог.
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
    syncEntityDiff('buyers', previous.buyers, current.buyers),
    syncEntityDiff('tasks', previous.tasks, current.tasks),
    syncEntityDiff('tickets', previous.tickets, current.tickets),
    syncEntityDiff('mediaRecords', previous.mediaRecords, current.mediaRecords),
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
// else remotely, and my stale cache just hasn't heard about it yet" — see
// mergeEntityList() below. Comfortably above the 1.5s push debounce
// (scheduleRemoteSync) so a same-tab refresh right after creating
// something never loses it, while old, no-longer-pending records don't
// get incorrectly resurrected after a legitimate remote deletion.
const PENDING_SYNC_GRACE_MS = 5 * 60 * 1000;

/**
 * Merges a remote snapshot of one entity list with what's already in the
 * local cache — used by initRemoteSync() below instead of blindly
 * overwriting local with remote on every page load. Blind overwrite has a
 * real failure mode: saveStore() pushes to Supabase on a 1.5s debounce
 * (see scheduleRemoteSync), so a refresh that lands inside that window —
 * or any push that failed for some other reason — would otherwise make a
 * perfectly good local change vanish the moment the next pull ran, even
 * though it was correctly saved to localStorage the whole time.
 *
 * Rule: for an id present on both sides, keep whichever copy has the newer
 * updatedAt. For an id only in the local cache, keep it if it looks recent
 * (still within the sync grace window — most likely mid-flight to the
 * server); otherwise drop it, since by then it's more likely something
 * that used to be on the server and was deleted by someone else than a
 * change that's been stuck pending for 5+ minutes.
 */
function mergeEntityList<T extends { id: string; updatedAt?: string; createdAt?: string }>(
  remoteList: T[],
  localList: T[],
): T[] {
  const remoteById = new Map(remoteList.map(r => [r.id, r]));
  const localById = new Map(localList.map(l => [l.id, l]));
  const now = Date.now();
  const merged: T[] = [];

  for (const [id, remoteItem] of remoteById) {
    const localItem = localById.get(id);
    if (!localItem) { merged.push(remoteItem); continue; }
    const remoteTime = remoteItem.updatedAt ? new Date(remoteItem.updatedAt).getTime() : 0;
    const localTime = localItem.updatedAt ? new Date(localItem.updatedAt).getTime() : 0;
    merged.push(localTime > remoteTime ? localItem : remoteItem);
  }

  for (const [id, localItem] of localById) {
    if (remoteById.has(id)) continue; // already handled above
    const referenceTime = localItem.updatedAt || localItem.createdAt;
    const age = referenceTime ? now - new Date(referenceTime).getTime() : Infinity;
    if (age <= PENDING_SYNC_GRACE_MS) merged.push(localItem);
  }

  return merged;
}

/**
 * Call once at app startup (see src/main.tsx). Pulls the latest data from
 * Supabase into the local cache. No-op (resolves immediately) when Supabase
 * isn't configured, so it's always safe to call.
 */
/**
 * Merges settings.forms in from mostly-empty remote (a freshly-seeded
 * Supabase project starts with settings = {} — see schema.sql's initial
 * INSERT) key-by-key with local/defaults, instead of the whole-object
 * replacement initRemoteSync() used to do. A blind `remote ?? local`
 * treated that empty `{}` as "valid settings from the server" and wiped
 * out every local default in one shot — statuses, users, forms, all of
 * it — because `{}` is not null/undefined, so `??` never fell through.
 * The very next getStore() call would then crash calling .find() on a
 * now-undefined settings.statuses. Any key remote actually has (once the
 * CRM has pushed something real) still wins; anything remote doesn't have
 * yet falls back to local, then hard defaults.
 */
function mergeSettings(remote: AppSettings | null | undefined, local: AppSettings | undefined, defaults: AppSettings): AppSettings {
  const base: AppSettings = local ?? defaults;
  if (!remote) return base;
  const merged: AppSettings = { ...base };
  for (const key of Object.keys(remote) as Array<keyof AppSettings>) {
    const value = remote[key];
    if (value !== undefined && value !== null) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  ensureSystemStatuses(merged); // системные статусы (лиды, «Архив дублей») не теряются при первом pull
  return merged;
}

/**
 * Call once at app startup (see src/main.tsx) — and again right after a
 * successful login (see src/lib/auth.ts's login()), since a fresh sign-in
 * is a client-side route change, not a page reload, so nothing else would
 * ever trigger a real pull for that session. Pulls the latest data from
 * Supabase into the local cache. No-op (resolves immediately) when
 * Supabase isn't configured, so it's always safe to call.
 */
export async function initRemoteSync(): Promise<void> {
  // Демо-режим: данные живут ТОЛЬКО в localStorage этого браузера.
  // Никаких pull/push/clear — иначе F5 мог перезаписать демо-данные пустым сервером.
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

  // Владение локальными данными (защита от чужого кэша в общем браузере,
  // CRITICAL-03): локаль считается «своей», только если email сессии
  // присутствует в её settings.users.
  const email = localSessionEmail();
  const owned = Boolean(email) && Boolean(localRaw) &&
    ((localRaw!.settings.users || []).some(u => (u.email || '').toLowerCase() === email));

  // 2) Сервер ПОЛНОСТЬЮ пуст (нет ни сущностей, ни пользователей) —
  //    новый проект. Локальные данные — единственная копия: сохраняем
  //    и выгружаем на сервер (если владелец подтверждён).
  const serverHasEntities =
    remote.suppliers.length || remote.buyers.length || remote.tasks.length ||
    remote.tickets.length || remote.mediaRecords.length;
  const serverHasUsers = Boolean(remote.settings && (remote.settings.users || []).length);
  const localHasEntities = Boolean(localRaw && (localRaw.suppliers.length || localRaw.buyers.length ||
    localRaw.tasks.length || localRaw.tickets.length || localRaw.mediaRecords.length));

  if (!serverHasEntities && !serverHasUsers) {
    if (localRaw && localHasEntities) {
      if (owned) {
        clearLocalStoreCache();
        // diff против «пустого предыдущего» состояния = все строки будут созданы на сервере
        const emptyPrev: CRMStore = { ...localRaw, suppliers: [], buyers: [], tasks: [], tickets: [], mediaRecords: [] };
        saveStore(localRaw, emptyPrev);
        console.warn('[store] Сервер пуст: локальные данные приняты за истину и выгружаются на сервер.');
      } else {
        console.warn('[store] Сервер пуст; локальные данные сохранены без выгрузки (владелец не подтверждён).');
      }
    }
    return;
  }

  // 3) Сервер содержит данные → он источник истины. НО: список, который на
  //    сервере ПУСТ, а локально есть записи, НЕ затираем, если данные свои
  //    (типичный случай: свежий проект, пуш ещё не доехал из-за RLS/сети) —
  //    иначе F5 уничтожала бы локальную работу. Чужой кэш (не owned) — затираем.
  clearLocalStoreCache();
  const pick = <T extends { id: string }>(remoteList: T[], localList: T[] | undefined): T[] => {
    if (!owned) return remoteList;                       // безопасность важнее: сервер — источник
    if (remoteList.length) return remoteList;            // сервер знает больше
    return (localList && localList.length) ? localList : remoteList; // сохраним свои записи, доки пойдут пушем
  };
  const merged: CRMStore = {
    suppliers: pick(remote.suppliers, localRaw?.suppliers),
    buyers: pick(remote.buyers, localRaw?.buyers),
    tasks: pick(remote.tasks, localRaw?.tasks),
    tickets: pick(remote.tickets, localRaw?.tickets),
    mediaRecords: pick(remote.mediaRecords, localRaw?.mediaRecords),
    settings: mergeSettings(remote.settings, localRaw?.settings, defaultStore().settings),
  };
  // Запушим спасённые локальные списки, чтобы следующий pull их уже видел.
  if (owned && localHasEntities) {
    const emptyPrev: CRMStore = { ...merged, suppliers: [], buyers: [], tasks: [], tickets: [], mediaRecords: [] };
    saveStore(merged, emptyPrev);
  } else {
    localStorage.setItem(STORE_KEY, JSON.stringify(merged));
    lastSavedJson = JSON.stringify(merged);
  }

  // Backfill: пустой app_settings на новом проекте — выгрузить реальные настройки.
  if (!remote.settings || !remote.settings.forms) {
    void saveSettings(merged.settings).catch(err => console.warn('[supabase] initial settings seed failed:', err));
  }
}

/** Email текущей сессии из localStorage (без импорта auth — избегаем цикл). */
function localSessionEmail(): string | null {
  try {
    const raw = localStorage.getItem('vz_crm_session');
    const s = raw ? (JSON.parse(raw) as { user?: { email?: string } }).user?.email : undefined;
    return s ? s.toLowerCase() : null;
  } catch { return null; }
}

/**
 * Applies a partial settings update that arrived via Supabase real-time
 * (see subscribeToAppSettings in src/lib/supabase.ts, wired up for the
 * whole app in src/lib/realtime.ts) directly to the local cache —
 * deliberately bypassing saveStore(), so it does NOT schedule another push
 * back to Supabase. Without this, an incoming remote change would
 * immediately echo straight back out (and could overwrite a concurrent
 * edit from a third client with this client's stale copy of unrelated
 * settings fields).
 */
/** Гарантирует наличие системных статусов (лиды + «Архив дублей») в настройках.
 * Вызывается после каждого merge с сервером: realtime-эхо может принести настройки,
 * записанные до появления этих статусов — без этого они молча пропадали. */
export function ensureSystemStatuses(settings: AppSettings): void {
  if (!settings.statuses) settings.statuses = [];
  // ТЗ: статус «Найден в базе» удалён — вычищаем его из настроек
  settings.statuses = settings.statuses.filter(s => s.id !== 'lead_found' && s.name !== 'Найден в базе');
  // ТЗ-фикс: «Архив дублей» и «АРХИВ» — ОБЩИЕ системные статусы (поставщики/покупатели/лиды).
  // Раньше совпадение по имени ПРОПУСКАЛО лиды-версии → статусы отсутствовали в лидах.
  // Теперь: если статус с таким именем уже есть — расширяем его entityTypes до 'lead';
  // если нет — создаём новый.
  for (const ls of DEFAULT_LEAD_STATUSES) {
    const existing = settings.statuses.find(x => x.id === ls.id || x.name === ls.name);
    if (!existing) {
      settings.statuses.push({ ...ls });
    } else if (!existing.entityTypes.includes('lead')) {
      existing.entityTypes = Array.from(new Set([...existing.entityTypes, 'lead']));
    }
  }
  if (!settings.statuses.some(s => s.id === 'dup_archive' || s.name === 'Архив дублей')) {
    settings.statuses.push({ id: 'dup_archive', name: 'Архив дублей', color: '#6B7280', order: 6, entityTypes: ['supplier', 'buyer'] });
  }
  // ТЗ 1.8: системным статусам — дефолтные фон и цвет текста (только если не заданы; пользовательские правки не трогаем)
  const SYS_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
    'Активный': { bg: '#D1FAE5', text: '#065F46' },
    'Лид форма': { bg: '#EFF6FF', text: '#1D4ED8' },
    'Новый с сайта': { bg: '#EFF6FF', text: '#1D4ED8' }, // ТЗ v1.22.3
    'Лид CRM': { bg: '#F5F3FF', text: '#6D28D9' },
    'Переговоры': { bg: '#FEF3C7', text: '#B45309' },
    'Приветствие': { bg: '#FCE7F3', text: '#9D174D' },
    'Проблемный': { bg: '#FEE2E2', text: '#B91C1C' },
    'Настройка прайса': { bg: '#FFF7ED', text: '#C2410C' },
    'Архив дублей': { bg: '#F3F4F6', text: '#6B7280' },
    'АРХИВ': { bg: '#F3F4F6', text: '#6B7280' },
    'Лид': { bg: '#F3F4F6', text: '#374151' },
  };
  settings.statuses.forEach(s => {
    const stl = SYS_STATUS_STYLES[s.name];
    if (stl) { if (!s.bgColor) s.bgColor = stl.bg; if (!s.textColor) s.textColor = stl.text; }
  });
  if (!Array.isArray(settings.leads)) settings.leads = [];
}

export function applyRemoteSettingsPatch(patch: Partial<AppSettings>): CRMStore {
  const store = getStore();
  const merged: CRMStore = { ...store, settings: { ...store.settings, ...patch } };
  ensureSystemStatuses(merged.settings); // системные статусы не должны теряться при sync
  const json = JSON.stringify(merged);
  if (json !== lastSavedJson) {
    lastSavedJson = json;
    localStorage.setItem(STORE_KEY, json);
    notifyStoreChange();
  }
  return merged;
}

type EntityListKey = 'suppliers' | 'buyers' | 'tasks' | 'tickets' | 'mediaRecords';

/**
 * Applies a single-row Supabase Realtime change (INSERT/UPDATE/DELETE) to
 * one of the 5 entity arrays directly in the local cache — same
 * bypass-saveStore reasoning as applyRemoteSettingsPatch above: this must
 * NOT schedule another push back to Supabase, or every change would echo
 * forever between connected clients.
 */
export function applyRemoteEntityChange<T extends { id: string }>(
  key: EntityListKey,
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

/** Способы связи — редактируемый справочник (Настройки → Источники → Связь);
 *  константа CONTACT_PREFS — фолбэк для баз без настройки. */
export function getContactPrefs(): string[] {
  const list = getStore().settings.contactPrefs;
  return Array.isArray(list) && list.length ? list : [...CONTACT_PREFS];
}
