// Supabase Edge Function: supplier-service
// Самообслуживание поставщика: склады + условия сервиса поиска по ссылке /s/<token>.
// Доступ: секретный токен в URL + опциональный PIN. Работает с таблицей `suppliers`
// (колонки service_access / warehouse_locations / service_search / history).
// Деплой: supabase functions deploy supplier-service --no-verify-jwt
//
// Безопасность: функция ходит в БД только через service_role (RLS не применяется),
// поэтому вся авторизация — руками: токен из URL + PIN. Токен — 32 hex-символа,
// генерируется криптостойким генератором в карточке поставщика. PIN хранится
// открытым текстом (доступ к БД есть только у service_role); рекомендуется не
// использовать осмысленные коды и не включать PIN без необходимости.

// ТЗ v1.23.37: встроенный Deno.serve вместо legacy-импорта deno.land/std (устраняет сбои загрузки модуля)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const TOKEN_RE = /^[a-f0-9]{32}$/;
const MAX_WAREHOUSES = 50;
const MAX_CONDITIONS = 20;
const SS_KEYS = ['city', 'warehouseName', 'representative', 'contacts', 'email',
  'deliverySchedule', 'orderUnloadSchedule', 'returnConditions', 'officialWarehouse', 'deliveryTime'];

function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type SupplierRow = {
  id: string;
  trade_name: string;
  service_access: { token: string; pin?: string; enabled: boolean; createdAt: string } | null;
  warehouse_locations: Array<Record<string, unknown>> | null;
  service_search: Array<Record<string, unknown>> | null;
  history: unknown[] | null;
};

/** ТЗ v1.23.36: доп. поля (ИНН/контакты/мультисклад) качаем ОТДЕЛЬНЫМ запросом:
 *  если какой-то колонки нет в старой БД — PostgREST роняет весь SELECT (поэтому
 *  их нельзя мешать в основной запрос — иначе ЛК падал с 404). При ошибке — урезанный набор. */
async function extraFields(client: ReturnType<typeof createClient>, id: string): Promise<Record<string, unknown>> {
  const r1 = await client.from('suppliers').select('inn, contact_name, phone, email, contacts, multiwarehouse').eq('id', id).maybeSingle(); // ТЗ v1.25.16: lowercase-first (туда пишет CRM)
  if (!r1.error && r1.data) return r1.data as Record<string, unknown>;
  const r1b = await client.from('suppliers').select('inn, contact_name, phone, email, contacts, multiWarehouse').eq('id', id).maybeSingle();
  if (!r1b.error && r1b.data) return r1b.data as Record<string, unknown>;
  const r2 = await client.from('suppliers').select('inn, contact_name, phone, email').eq('id', id).maybeSingle();
  if (!r2.error && r2.data) return r2.data as Record<string, unknown>;
  return {};
}

// v1.30.40: ЭДО — ОТДЕЛЬНЫМ запросом (как ТЗ v1.23.36): если колонок edo_* ещё нет в БД
// до прогона миграции — PostgREST ронял бы весь SELECT и ЛК падал с 404.
async function edoFields(client: ReturnType<typeof createClient>, id: string): Promise<Record<string, unknown>> {
  const r = await client.from('suppliers').select('edo_operator, edo_token').eq('id', id).maybeSingle();
  return (!r.error && r.data) ? (r.data as Record<string, unknown>) : {};
}

async function findSupplierByToken(client: ReturnType<typeof createClient>, token: string): Promise<SupplierRow | null> {
  const { data, error } = await client
    .from('suppliers')
    .select('id, trade_name, service_access, warehouse_locations, service_search, history, phone, responsible_id, city, inn, website, type, contact_name, contact_role, phone, email, services, product_groups, own_brands, price_email')
    .is('deleted_at', null)
    .eq('service_access->>enabled', 'true')
    .eq('service_access->>token', token)
    .limit(1);
  if (error || !data?.length) return null;
  const extra = await extraFields(client, (data[0] as SupplierRow).id);
  const edo = await edoFields(client, (data[0] as SupplierRow).id);
  return { ...(data[0] as SupplierRow), ...(extra as object), ...edo } as SupplierRow;
}

function pinOk(expected: string | undefined, provided: unknown): boolean {
  if (!expected) return true;
  const p = typeof provided === 'string' ? provided : '';
  return /^\d{4,6}$/.test(p) && p === expected;
}

// Анти-брутфорс PIN (аудит): PIN — всего 4–6 цифр (до 10^6 комбинаций), без
// лимита попыток его можно перебрать. Не более 5 неверных попыток с одного IP
// на один токен за 15 минут; успешная попытка сбрасывает счётчик.
const PIN_WINDOW = 15 * 60 * 1000;
const pinFails = new Map<string, number[]>();
function pinFailsNow(key: string): number[] {
  const now = Date.now();
  const fails = (pinFails.get(key) || []).filter(t => now - t < PIN_WINDOW);
  pinFails.set(key, fails);
  if (pinFails.size > 5000) pinFails.clear();
  return fails;
}
function pinBlocked(key: string): boolean {
  return pinFailsNow(key).length >= 5;
}
function pinFail(key: string): void {
  pinFails.set(key, [...pinFailsNow(key), Date.now()]);
}

function validateWarehouses(input: unknown, existing: Array<Record<string, unknown>>) {
  if (!Array.isArray(input)) return 'Некорректный список складов';
  if (input.length > MAX_WAREHOUSES) return `Максимум ${MAX_WAREHOUSES} складов`;
  const cities = new Set<string>();
  for (const w of input as Array<Record<string, unknown>>) {
    const city = String(w.city || '').trim();
    if (!city || city.length > 100) return 'У каждого склада обязателен город (до 100 символов)';
    if (cities.has(city.toLowerCase())) return `Склад "${city}" повторяется`;
    cities.add(city.toLowerCase());
    const sku = Number(w.skuCount ?? 0);
    if (!Number.isInteger(sku) || sku < 0 || sku > 10000000) return 'SKU — целое число от 0 до 10 000 000';
  }
  return (input as Array<Record<string, unknown>>).map((w, i) => {
    const id = typeof w.id === 'string' && w.id ? w.id : `wh-self-${i}-${Date.now()}`;
    const city = String(w.city).trim();
    // «Склад проверен» ставит ТОЛЬКО менеджер в CRM — значение от клиента игнорируется,
    // флаг сохраняется из текущей записи (по id или городу).
    const old = existing.find((e) => e.id === id) ||
      existing.find((e) => String(e.city || '').toLowerCase() === city.toLowerCase());
    // ТЗ v1.25.0: сохраняем адрес склада и статус (статус меняет только менеджер в CRM)
    const st = String(old?.status || '');
    return { id, city, skuCount: Number(w.skuCount ?? 0), verified: Boolean(old?.verified),
      address: String(w.address || old?.address || '').trim().slice(0, 300),
      status: ['Новый', 'Проверен', 'Заморожен'].includes(st) ? st : (old?.verified ? 'Проверен' : 'Новый') };
  });
}

function validateConditions(input: unknown, warehouses: Array<{ city: string }>) {
  if (!Array.isArray(input)) return 'Некорректный список условий';
  if (input.length > MAX_CONDITIONS) return `Максимум ${MAX_CONDITIONS} условий`;
  const whCities = new Set(warehouses.map((w) => w.city.toLowerCase()));
  for (const raw of input as Array<Record<string, unknown>>) {
    const city = String(raw.city || '').trim();
    if (!city || city.length > 100) return 'В каждом условии обязателен город показов';
    const wh = String(raw.warehouseName || '').trim();
    if (wh && !whCities.has(wh.toLowerCase())) return `Склад "${wh}" отсутствует в вашем списке складов`;
    for (const k of SS_KEYS) if (String(raw[k] ?? '').length > 500) return 'Поле слишком длинное (макс. 500 символов)';
  }
  return (input as Array<Record<string, unknown>>).map((c) => {
    const out: Record<string, string> = {};
    for (const k of SS_KEYS) out[k] = String(c[k] ?? '').trim();
    // ТЗ v1.23.31: id и status ОБЯЗАНЫ сохраняться — иначе условия теряли id
    // (CRM-анкета не могла их редактировать) и статус «Удаление» затирался.
    if (c.id) out.id = String(c.id);
    if (c.status) out.status = String(c.status);
    return out;
  });
}

// Статус условия определяет СЕРВЕР (поставщик прислать его не может):
//  — такого города+склада ещё нет → «Новое»;
//  — есть, содержимое изменилось → «Есть изменения» (если было «Загружено»),
//    «Новое»/«Есть изменения» остаются как есть (менеджер ещё не обработал);
//  — есть, без изменений → текущий статус сохраняется (legacy без статуса → «Загружено»).
function withStatuses(
  incoming: Array<Record<string, string>>,
  existing: Array<Record<string, unknown>>,
): Array<Record<string, string>> {
  return incoming.map((c) => {
    const match = (existing || []).find(
      (e) => String(e.city || '').toLowerCase() === c.city.toLowerCase() &&
             String(e.warehouseName || '').toLowerCase() === (c.warehouseName || '').toLowerCase(),
    );
    if (!match) return { ...c, status: 'Новое' };
    const prev = (match.status as string) || 'Новое';
    const inc = c.status || prev;
    // ТЗ v1.23.30: клиенту разрешено ставить только «Новое»/«Есть изменения»/«Удаление»;
    // «Загружено» — только менеджер. Запрос на удаление проходит ВСЕГДА (раньше затирался,
    // т.к. при смене одного статуса changed=false и возвращался старый статус).
    if (inc === 'Удаление') return { ...c, status: 'Удаление' };
    const CLIENT_OK = (st: string) => st === 'Новое' || st === 'Есть изменения' || st === 'Удаление';
    const changed = SS_KEYS.some((k) => String(match[k] ?? '').trim() !== c[k]);
    if (changed && prev === 'Загружено') return { ...c, status: 'Есть изменения' };
    // Косяки ч.5: условие БЕЗ изменений сохраняет свой текущий статус — «Загружено»
    // не должно сбрасываться в «Новое» при пересохранении списка (например, когда
    // поставщик удаляет другое условие и шлёт весь массив обратно).
    // Legacy-условия без статуса → «Загружено» (согласно описанию функции выше).
    if (!changed) return { ...c, status: match.status ? prev : 'Загружено' };
    return { ...c, status: CLIENT_OK(prev) ? prev : 'Новое' };
  });
}

async function handleGet(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!TOKEN_RE.test(token)) return json({ error: 'Недействительная ссылка' }, 400);
  const client = serviceClient();
  const supplier = await findSupplierByToken(client, token);
  if (!supplier) return json({ error: 'Ссылка недействительна или доступ отключён' }, 404);
  // Список городов, доступных для показов — из настроек CRM (Настройки → Типы и города)
  const { data: settingsRow } = await client.from('app_settings').select('settings').eq('id', 'global').maybeSingle();
  const availableCities = ((settingsRow?.settings as Record<string, unknown> | undefined)?.cities as string[]) || [];
  return json({
    companyName: supplier.trade_name || 'Поставщик',
      inn: supplier.inn || '', // ТЗ v1.23.0: ИНН для экрана PIN ЛК
      contactName: supplier.contact_name || (Array.isArray((supplier as { contacts?: Array<{ name?: string }> }).contacts) ? ((supplier as { contacts: Array<{ name?: string }> }).contacts[0]?.name ?? '') : '') || '', // ТЗ v1.23.35: fallback — первый контакт карточки
      contactPhone: supplier.phone || (Array.isArray((supplier as { contacts?: Array<{ phone?: string }> }).contacts) ? ((supplier as { contacts: Array<{ phone?: string }> }).contacts[0]?.phone ?? '') : '') || '',
      contactEmail: supplier.email || (Array.isArray((supplier as { contacts?: Array<{ email?: string }> }).contacts) ? ((supplier as { contacts: Array<{ email?: string }> }).contacts[0]?.email ?? '') : '') || '',
        multiWarehouse: Boolean((supplier as { multiwarehouse?: boolean }).multiwarehouse ?? (supplier as { multi_warehouse?: boolean }).multi_warehouse ?? (supplier as { multiWarehouse?: boolean }).multiWarehouse), // ТЗ v1.25.16
    hasPin: Boolean(supplier.service_access?.pin),
    warehouses: supplier.warehouse_locations || [],
    availableCities,
    // Never expose protected supplier data before PIN verification.
    // The client must POST the PIN first to receive warehouses/serviceSearch.

  });
}

async function handlePost(req: Request) {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > 512 * 1024) return json({ error: 'Запрос слишком большой' }, 413);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Некорректный запрос' }, 400); }
  const token = String(body.token || '');
  if (!TOKEN_RE.test(token)) return json({ error: 'Недействительная ссылка' }, 400);
  const client = serviceClient();
  const supplier = await findSupplierByToken(client, token);
  if (!supplier) return json({ error: 'Ссылка недействительна или доступ отключён' }, 404);
  const rlIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rlKey = `${token}:${rlIp}`;
  if (supplier.service_access?.pin) {
    // ТЗ v1.23.19: анти-брутфорс отключён по требованию владельца (блокировал легальных поставщиков).
    if (!pinOk(supplier.service_access?.pin, body.pin)) {
      return json({ error: 'Неверный PIN-код' }, 403);
    }
    pinFails.delete(rlKey); // успех — сброс счётчика неудач
  }

  const patch: Record<string, unknown> = {};
  if (body.warehouses !== undefined) {
    const wh = validateWarehouses(body.warehouses, supplier.warehouse_locations || []);

    // ТЗ v1.25.8: лимит мультисклада — читаем флаг из базы напрямую (колонка может быть
    // camelCase multiWarehouse или lowercase multiwarehouse — пробуем обе, какая есть).
    {
      let mk = false;
      // ТЗ v1.25.18: CRM пишет флаг в lowercase-колонку — читаем ЕЁ в первую очередь
      const fr = await client.from('suppliers').select('multiwarehouse').eq('id', supplier.id).maybeSingle();
      if (!fr.error && fr.data) mk = !!fr.data.multiwarehouse;
      else {
        const fr2 = await client.from('suppliers').select('multiWarehouse').eq('id', supplier.id).maybeSingle();
        if (!fr2.error && fr2.data) mk = !!fr2.data.multiWarehouse;
      }
      if (!mk && wh.length > 1) {
        return json({ error: 'Мультисклад не подключён. Для добавления второго склада обратитесь в поддержку.' }, 403);
      }
    }
    if (typeof wh === 'string') return json({ error: wh }, 400);
    patch.warehouse_locations = wh;
  }
  if (body.serviceSearch !== undefined) {
    const whNow = (patch.warehouse_locations as Array<{ city: string }>) ||
      (supplier.warehouse_locations as Array<{ city: string }>) || [];
    const cond = validateConditions(body.serviceSearch, whNow);
    if (typeof cond === 'string') return json({ error: cond }, 400);
    patch.service_search = withStatuses(cond, supplier.service_search || []);
  }

  // Пустой PATCH = проверка PIN (вход по ссылке с PIN). Валидный PIN
  // grants access to the protected supplier data. No PIN-protected data is
  // returned by GET before this point.
  // v1.30.1: поставщик правит в ЛК контакты представителя и ЭДО
  const CAB_KEYS: Record<string, string> = { contactName: 'contact_name', contactRole: 'contact_role', phone: 'phone', email: 'email', priceEmail: 'price_email' };
  for (const [k, col] of Object.entries(CAB_KEYS)) {
    if (body[k] !== undefined) patch[col] = String(body[k] ?? '').slice(0, 200);
  }
  if (body.edoOperator !== undefined || body.edoToken !== undefined) {
    if (body.edoOperator !== undefined) patch.edo_operator = String(body.edoOperator ?? '').slice(0, 100);
    if (body.edoToken !== undefined) patch.edo_token = String(body.edoToken ?? '').slice(0, 300);
  }
  if (!Object.keys(patch).length) {
    // данные кабинета и дашборда после проверки PIN
    const dsetRow = await client.from('app_settings').select('settings').eq('id', 'global').maybeSingle();
    const dset = (dsetRow.data?.settings || {}) as Record<string, unknown>;
    // v1.30.43: оператор (персональный менеджер) ЛК — из настроек ЛК Поставщик
    const lkOp = ((dset.lkOperators as Array<Record<string, unknown>>) || []).find(op => String(op.userId) === String(supplier.responsible_id || ''));
    return json({
      ok: true,
      pinVerified: true,
      phone: supplier.phone || '',
      // v1.30.43: оператор ЛК (null — «Персональный менеджер не настроен»)
      lkOperator: lkOp ? { name: (lkOp.name as string) || '', avatar: (lkOp.avatar as string) || '', phone: (lkOp.phone as string) || '', email: (lkOp.email as string) || '', maxLink: (lkOp.maxLink as string) || '' } : null,
      // v1.30.1: данные кабинета поставщика (страница «Кабинет» в ЛК)
      cabinet: {
        tradeName: supplier.trade_name || '',
        city: supplier.city || '',
        inn: supplier.inn || '',
        website: supplier.website || '',
        type: supplier.type || '',
        contactName: supplier.contact_name || '',
        contactRole: supplier.contact_role || '',
        contactPhone: supplier.phone || '',
        contactEmail: supplier.email || '',
        services: supplier.services || [],
        productGroups: supplier.product_groups || [],
        ownBrands: supplier.own_brands || [],
        edoOperator: supplier.edo_operator || '',
        edoToken: supplier.edo_token || '',
        active: Boolean(supplier.edo_operator),
        edoOperators: (dset.edoOperators as string[]) || [],
        priceEmail: supplier.price_email || '',
      },
      companyName: supplier.trade_name || 'Поставщик',
      inn: supplier.inn || '', // ТЗ v1.23.0: ИНН для экрана PIN ЛК
      contactName: supplier.contact_name || (Array.isArray((supplier as { contacts?: Array<{ name?: string }> }).contacts) ? ((supplier as { contacts: Array<{ name?: string }> }).contacts[0]?.name ?? '') : '') || '', // ТЗ v1.23.35: fallback — первый контакт карточки
      contactPhone: supplier.phone || (Array.isArray((supplier as { contacts?: Array<{ phone?: string }> }).contacts) ? ((supplier as { contacts: Array<{ phone?: string }> }).contacts[0]?.phone ?? '') : '') || '',
      contactEmail: supplier.email || (Array.isArray((supplier as { contacts?: Array<{ email?: string }> }).contacts) ? ((supplier as { contacts: Array<{ email?: string }> }).contacts[0]?.email ?? '') : '') || '',
      multiWarehouse: Boolean((supplier as { multiwarehouse?: boolean }).multiwarehouse ?? (supplier as { multi_warehouse?: boolean }).multi_warehouse ?? (supplier as { multiWarehouse?: boolean }).multiWarehouse), // ТЗ v1.25.16
      warehouses: supplier.warehouse_locations || [],
      serviceSearch: supplier.service_search || [],
      // v1.30.0: дашборд ЛК (баннер, новости, счётчики)
      dashboard: {
        banner: (dset.lkBanner as Record<string, string>) || { image: '', link: '' },
        lkLinks: (dset.lkLinks as Record<string, string>) || {},
        news: (((dset.lkNews as Array<Record<string, unknown>>) || []).slice(-3)).reverse(),
        vendorNews: (((dset.lkVendorNews as Array<Record<string, unknown>>) || []).slice(-8)).reverse(),
        counters: (dset.lkDashboard as Record<string, unknown>) || { countersMode: 'manual', buyersCount: 500, suppliersCount: 500, skuCount: 350000 },
        dbBuyers: (await client.from('buyers').select('id', { count: 'exact', head: true })).count ?? 0,
        dbSuppliers: (await client.from('suppliers').select('id', { count: 'exact', head: true })).count ?? 0,
        // платформенные агрегаты: проценки (условия DBS) и склады по всем поставщикам
        pricingTotal: ((await client.from('suppliers').select('service_search')).data || []).reduce((acc: number, r: Record<string, unknown>) => acc + ((r.service_search as unknown[]) || []).length, 0),
        warehousesTotal: ((await client.from('suppliers').select('warehouse_locations')).data || []).reduce((acc: number, r: Record<string, unknown>) => acc + ((r.warehouse_locations as unknown[]) || []).length, 0),
        skuTotal: ((await client.from('suppliers').select('warehouse_locations')).data || []).reduce((acc: number, r: Record<string, unknown>) => acc + ((r.warehouse_locations as Array<Record<string, unknown>>) || []).reduce((a: number, w: Record<string, unknown>) => a + (Number(w.skuCount) || 0), 0), 0),
      },
      availableCities: ((await client.from('app_settings').select('settings').eq('id', 'global').maybeSingle()).data?.settings as Record<string, unknown> | undefined)?.cities || [],
    });
  }

  const history = Array.isArray(supplier.history) ? [...supplier.history] : [];
  history.push({
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    userId: 'supplier-self',
    userName: 'Поставщик (самообслуживание)',
    field: patch.service_search !== undefined ? 'serviceSearch' : 'warehouseLocations',
    oldValue: '',
    newValue: JSON.stringify(patch),
    comment: 'Изменено через ссылку самообслуживания',
  });
  patch.history = history;
  patch.warehouse_count = (patch.warehouse_locations as unknown[])?.length ??
    (supplier.warehouse_locations || []).length;
  patch.updated_at = new Date().toISOString();

  const { error } = await client.from('suppliers').update(patch).eq('id', supplier.id);
  if (error) return json({ error: 'Не удалось сохранить. Попробуйте позже.' }, 500);
  const c0 = Array.isArray((supplier as { contacts?: Array<Record<string, unknown>> }).contacts) ? (supplier as { contacts: Array<Record<string, unknown>> }).contacts[0] : undefined;
  return json({
    ok: true,
    // ТЗ v1.23.39: контакты/ИНН в POST-ответ — иначе ЛК терял их после каждого сохранения
    contactName: supplier.contact_name || String(c0?.name ?? ''),
    contactPhone: supplier.phone || String(c0?.phone ?? ''),
    contactEmail: supplier.email || String(c0?.email ?? ''),
    inn: supplier.inn || '',
    warehouses: patch.warehouse_locations ?? supplier.warehouse_locations ?? [],
    serviceSearch: patch.service_search ?? supplier.service_search ?? [],
    // ТЗ v1.23.34: флаг мультисклада ОБЯЗАН возвращаться — иначе после первого сохранения
    // ЛК терял его, и добавление второго склада блокировалось («обратитесь в поддержку»).
    multiWarehouse: Boolean((supplier as { multiwarehouse?: boolean }).multiwarehouse ?? (supplier as { multi_warehouse?: boolean }).multi_warehouse ?? (supplier as { multiWarehouse?: boolean }).multiWarehouse), // ТЗ v1.25.16
    availableCities: (await client.from('app_settings').select('settings').eq('id', 'global').maybeSingle()).data?.settings?.cities ?? [],
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method === 'GET') return await handleGet(req);
    if (req.method === 'POST') return await handlePost(req);
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('[supplier-service] error:', err);
    return json({ error: 'Внутренняя ошибка сервера. Попробуйте позже.' }, 500);
  }
});
