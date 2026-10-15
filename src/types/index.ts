// ============================================================
// TYPES — ВСЕМЗАПЧАСТИ ДОСТАВКА (отдельная программа, сервис DBO)
// Вырезано из CRM: только то, что использует модуль Доставки.
// ============================================================

export type SupplierType = string;
export type RoleType = 'директор' | 'менеджер' | 'собственник' | 'РОП' | 'ТП';
export type ContactPref = 'почта' | 'телефон' | 'WhatsApp' | 'Telegram';

export interface StatusConfig {
  id: string;
  name: string;
  color: string;
  bgColor: string;
  textColor: string;
  entityTypes: string[];
  order: number;
}

export interface HistoryEntry {
  id: string;
  date: string;
  field: string;
  oldValue?: string;
  newValue?: string;
  comment?: string;
  userId: string;
  userName: string;
}

export interface ScoreData {
  annualRevenue?: string;
  employees?: string;
  yearsOnMarket?: string;
  apiLoaded?: boolean;
  apiLoadedAt?: string;
  year?: number;
  revenue?: number;
  inventory?: number;
  grossProfit?: number;
  marginPct?: number;
  companyName?: string;
}

export interface RequisitesData {
  bank?: string;
  bik?: string;
  accountNumber?: string;
  corrAccount?: string;
  legalName?: string;
  legalAddress?: string;
  ogrn?: string;
  kpp?: string;
  director?: string;
}

export type WarehouseStatus = 'Новый' | 'Проверен' | 'Заморожен';

export interface WarehouseLocation {
  id: string;
  city: string;
  skuCount: number;
  verified?: boolean;
  status?: WarehouseStatus;
  /** Адрес склада */
  address?: string;
}

export interface ServiceSearchCondition {
  id: string;
  city: string;
  warehouseName: string;
  representative: string;
  contacts: string;
  email: string;
  deliverySchedule: string;
  orderUnloadSchedule: string;
  returnConditions: string;
  officialWarehouse: string;
  deliveryTime?: string;
  status?: 'Новое' | 'Загружено' | 'Есть изменения';
  createdAt: string;
  updatedAt: string;
}

export interface SupplierService {
  id: string;
  name: string;
  createdAt: string;
  /** Системный сервис: нельзя удалить, только переименовать. */
  system?: boolean;
}

/** Этап 1.8 — данные скоринга (алиас ScoreData) */
export type SupplierScoring = ScoreData;

export interface Supplier {
  id: string;
  type: SupplierType;
  tradeName: string;
  city: string;
  address?: string;
  website?: string;
  inn?: string;
  contactRole: RoleType;
  contactName: string;
  phone: string;
  email: string;
  status: string;
  source?: string;
  contactPref?: ContactPref;
  /** Способы связи (мультивыбор), колонка contact_prefs в БД */
  contactPrefs?: string[];
  warehouseCount?: number;
  skuCount?: number;
  warehouseLocations?: WarehouseLocation[];
  productGroups: string[];
  ownBrands: string[];
  services?: string[];
  companyScore: number;
  category?: 'A' | 'B' | 'C';
  comment?: string;
  scoring?: ScoreData;
  requisites?: RequisitesData;
  serviceSearch?: ServiceSearchCondition[];
  /** Доступ к самообслуживанию по ссылке /s/<token> (единый ЛК платформы) */
  serviceAccess?: { token: string; pin?: string; enabled: boolean; createdAt: string };
  /** Доставка (DBO) — доступ к ЛК доставки по ссылке /d/<token>. СВОЯ настройка, с DBS не связана. */
  deliveryAccess?: { token: string; pin?: string; enabled: boolean; createdAt: string };
  /** Доставка (DBO) — данные анкеты договора из раздела Доставка */
  deliveryContract?: DeliveryContract;
  history: HistoryEntry[];
  additionalContacts?: string;
  additionalComment?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  responsibleId?: string;
  responsibleName?: string;
  fromApi?: boolean;
  createdBy?: string;
  multiWarehouse?: boolean;
}

// ── ДОСТАВКА (DBO) ─────────────────────────────────────────

export interface DeliveryContract {
  route?: string;
  scheduleDays?: string[];
  scheduleFrom?: string;
  scheduleTo?: string;
  warehouseId?: string;
  cities?: string[];
  operatorId?: string;
  status?: string;
  /** Номер договора — обязателен при активации */
  contractNumber?: string;
  /** Дата договора — обязательна при активации */
  contractDate?: string;
  serviceTariff?: string;
  cityTariff?: string;
  comment?: string;
}

/** Остановка маршрута самовывоза (DBO) */
export interface RouteStop {
  supplierId: string;
  /** Диапазон времени — вручную от и до */
  from: string;
  to: string;
  /** Порядок погрузки (1–10): чем выше цифра, тем ниже в списке */
  order?: number;
}

/** Новость платформы для ЛК поставщика */
export interface LkNews {
  id: string;
  title: string;
  date: string;
  text: string;
  createdAt: string;
  tag?: string;
  link?: string;
  fullText?: string;
}

/** Маршрут самовывоза (DBO) */
export interface DeliveryRoute {
  id: string;
  number: string;
  departureTime: string;
  scheduleDays: string[];
  stops: RouteStop[];
  arrivalTime: string;
  createdAt: string;
  history?: { at: string; by: string; action: string }[];
}

/** Тариф доставки (DBO) — Тариф сервиса / Тариф за Город */
export interface DeliveryTariff {
  id: string;
  name: string;
  pricePerMonth: number;
  basePackage?: number;
  cityRate?: number;
  pointsIncluded?: number;
  extraPointPrice?: number;
  volumeIncluded?: number;
  volumeExtraStep?: number;
  volumeExtraPrice?: number;
  createdAt: string;
}

/** Задание на доставку */
export interface DeliveryTask {
  id: string;
  supplierId: string;
  date: string;
  city: string;
  points: number;
  rate: number;
  extra: number;
  volumeExtra?: number;
  volumeExtraSum?: number;
  total: number;
  status?: string;
  createdAt: string;
}

/** Строка таблицы городов доставки */
export interface DeliveryCityRow {
  id: string;
  city: string;
  supplierId: string;
  status?: string;
  activatedAt?: string;
  tariff?: string;
  history?: { at: string; by: string; action: string }[];
}

/** Оператор доставки (DBO) */
export interface DeliveryOperator {
  id: string;
  name: string;
  phone: string;
  email?: string;
  avatar?: string;
  userId: string;
  maxLink?: string;
  createdAt: string;
}

/** Статус задания на доставку с настраиваемыми цветами */
export interface DeliveryTaskStatus { name: string; bgColor: string; textColor: string; }

export type UserStatus = 'active' | 'blocked' | 'fired';

/** Фильтры видимости для роли «Менеджер». Пустой массив = без ограничений. */
export interface UserAccess {
  supplierTypes: string[];
  supplierCities: string[];
  buyerTypes: string[];
  buyerCities: string[];
  ticketTypes: string[];
  planCities: string[];
  dashboardCities: string[];
  taskTypes: string[];
  taskEntityTypes: string[];
  mediaAdTypes: string[];
  mediaDurationOptions: string[];
  mediaStatuses: string[];
  analyticsCities: string[];
  knowledgeCategories: string[];
}

export const EMPTY_ACCESS: UserAccess = {
  supplierTypes: [], supplierCities: [], buyerTypes: [], buyerCities: [],
  ticketTypes: [], planCities: [], dashboardCities: [], taskTypes: [],
  taskEntityTypes: [], mediaAdTypes: [], mediaDurationOptions: [],
  mediaStatuses: [], analyticsCities: [], knowledgeCategories: [],
};

export type NotifyChannel = 'telegram' | 'max' | 'email';

/** Пользователь программы. Структура permissions сохранена как в CRM. */
export interface AppUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'manager';
  note?: string;
  notifyChatId?: string;
  notifyChannel?: NotifyChannel;
  notifyEmail?: string;
  permissions: {
    dashboard: boolean;
    suppliers: boolean;
    buyers: boolean;
    tasks: boolean;
    support: boolean;
    leads: boolean;
    media: boolean;
    pricing: boolean;
    /** Доставка (DBO) — основной (и единственный) раздел этой программы. */
    delivery: boolean;
    planfact: boolean;
    analytics: boolean;
    knowledge: boolean;
    planfactEdit: boolean;
  };
  access: UserAccess;
  dashboardType?: 'mop' | 'moz';
  planfactBase?: 'buyers' | 'suppliers';
  leadsBase?: 'buyers' | 'suppliers';
  allowedCities?: string[];
  firedAt?: string;
  status: UserStatus;
  createdAt: string;
}

export interface AppSettings {
  statuses: StatusConfig[];
  users: AppUser[];
  supplierTypes: string[];
  cities: string[];
  /** Города, доступные для доставки (DBO) */
  deliveryCities?: string[];
  /** Операторы доставки (DBO) */
  deliveryOperators?: DeliveryOperator[];
  /** Статусы договоров доставки (DBO) */
  deliveryContractStatuses?: string[];
  /** Статусы заданий на доставку (DBO) */
  deliveryTaskStatuses?: DeliveryTaskStatus[];
  /** Тарифы сервиса доставки (DBO) */
  deliveryServiceTariffs?: DeliveryTariff[];
  /** Тарифы за Город (DBO) */
  deliveryCityTariffs?: DeliveryTariff[];
  /** Маршруты самовывоза (DBO) */
  deliveryRoutes?: DeliveryRoute[];
  /** Дашборд ЛК поставщика */
  lkDashboard?: {
    buyersMode: 'manual' | 'db'; buyersCount: number;
    warehousesMode: 'manual' | 'db'; warehousesCount: number;
    skuMode: 'manual' | 'db'; skuCount: number;
    requestsPerDay: number;
  };
  /** Баннер дашборда ЛК */
  lkBanner?: { image: string; link: string };
  /** Новости платформы для ЛК */
  lkNews?: LkNews[];
  /** «От поставщиков поставщикам» — слайдер новостей в ЛК */
  lkVendorNews?: LkNews[];
  /** Ссылки офер для кнопок Доставка / Кросс-докинг / Продвижение */
  lkLinks?: { delivery?: string; crossdock?: string; promo?: string };
  /** МКП (мин. количество поставщиков) по городам доставки */
  deliveryCityMinSuppliers?: Record<string, number>;
  /** Таблица «Города доставки» (город × поставщик) */
  deliveryCityRows?: DeliveryCityRow[];
  /** Задания на доставку */
  deliveryTasks?: DeliveryTask[];
  /** График и время развоза по городам доставки */
  deliveryCitySchedules?: Record<string, { days: string[]; from: string; to: string }>;
  /** Быстрые кнопки в шапке */
  quickLinks: { mail: string; platform: string };
  supplierServices: SupplierService[];
  contactPrefs?: string[];
}

export interface AuthSession {
  user: AppUser;
  expiresAt: string;
}

/** Запись локального лога синхронизации. НЕ синхронизируется с сервером. */
export interface SyncLogEntry {
  id: string;
  ts: string;
  kind: 'op' | 'summary' | 'system';
  entity?: 'suppliers' | 'settings' | 'system';
  op?: 'create' | 'update' | 'delete' | 'sync' | 'push' | 'pull';
  itemId?: string;
  status: 'ok' | 'error';
  message?: string;
}
