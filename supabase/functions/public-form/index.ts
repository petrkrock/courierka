// ============================================================
// EDGE FUNCTION: public-form
// ============================================================
//
// Powers the embeddable public forms (Настройки → Формы → код для сайта).
// Unlike create-manager, this function is deliberately open to ANY origin,
// with NO authentication — that's the whole point: a visitor on some
// completely unrelated third-party website, who has never logged into the
// CRM and never will, needs to be able to submit it.
//
//   GET  /public-form?type=supplier|buyer|ticket|marketingKit
//        → public, non-sensitive form config (title, fields, messages)
//   POST /public-form   body: { type, values, honeypot, renderedAt }
//        → validates + inserts a new record with status "Новый с сайта"
//          and from_api: true
//
// Security model, since there's no login to rely on here:
//   - Anonymous visitors never talk to Postgres directly — this function
//     always uses the service_role key internally, and Postgres RLS never
//     even enters the picture for these requests.
//   - Submitted values are filtered down to exactly the fields the admin
//     configured for that form (core fields + Настройки → Формы selection)
//     — nothing else the client sends is ever written anywhere.
//   - status is always forced server-side to "Новый с сайта" — a
//     submission can never claim any other status.
//   - Honeypot field (must arrive empty) + a minimum elapsed-time check
//     (must be >= 1.2s between the form rendering and submitting) catch
//     the overwhelming majority of bot traffic without a CAPTCHA/paid
//     service. A caught bot gets a fake "success" response (never told it
//     was caught) — nothing is written to the database either way.
//
// CORE_FIELDS/FIELD_DEFS below must be kept in sync by hand with
// src/constants/index.ts's FORM_FIELD_DEFINITIONS — Deno Edge Functions
// are deployed standalone and can't import from the React app's src/.
//
// Deploy: supabase functions deploy public-form --no-verify-jwt
// (--no-verify-jwt is required — this must be reachable without a
// Supabase Auth session; see README.md for the full walkthrough.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS: 'Access-Control-Allow-Origin': '*' is deliberate — this function
// must be callable from any third-party website that embeds the form.
// authorization/apikey/x-client-info are allowed because the CRM frontend
// uses a shared Supabase-functions helper that attaches those headers by
// default; the function itself never requires a valid token.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Vary': 'Origin',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type EntityType = 'supplier' | 'buyer' | 'ticket' | 'marketingKit'; // v_1.9

interface FieldDef {
  key: string;
  label: string;
  inputType: 'text' | 'textarea' | 'tel' | 'email' | 'number' | 'select' | 'multiselect';
  core?: boolean;
  defaultValue?: string | number; // ТЗ v1.22.31: предзаполнение поля (например, торговые точки = 1)
  alwaysShow?: boolean; // ТЗ v1.22.32: показывать в форме всегда (необязательное)
  optionsSource?: 'supplierTypes' | 'buyerTypes' | 'productGroups' | 'supplierServices' | 'roleTypes' | 'contactPrefs' | 'ticketTypes';
}

// Keep in sync with src/constants/index.ts FORM_FIELD_DEFINITIONS.
const FIELD_DEFS: Record<EntityType, FieldDef[]> = {
  supplier: [
    { key: 'tradeName', label: 'Торговое название компании', inputType: 'text', core: true }, // ТЗ v1.22.29
    { key: 'inn', label: 'ИНН', inputType: 'text', core: true }, // ТЗ v1.22.32: подпись без '*'; обязательность — через core
    { key: 'type', label: 'Тип', inputType: 'select', core: true, optionsSource: 'supplierTypes' },
    { key: 'city', label: 'Город ЦС', inputType: 'text', core: true }, // ТЗ v1.22.29
    { key: 'contactName', label: 'Контактное лицо', inputType: 'text', core: true },
    { key: 'contactRole', label: 'Должность контакта', inputType: 'select', optionsSource: 'roleTypes', alwaysShow: true }, // ТЗ v1.22.32: всегда в форме, но необязательно
    { key: 'phone', label: 'Телефон', inputType: 'tel', core: true },
    { key: 'email', label: 'Email', inputType: 'email', core: true },
    { key: 'website', label: 'Сайт', inputType: 'text' },
    { key: 'source', label: 'Откуда про нас узнали?', inputType: 'select', optionsSource: 'sources' },
    { key: 'contactPref', label: 'Предпочтительный способ связи', inputType: 'multiselect', optionsSource: 'contactPrefs' },
    { key: 'ownBrands', label: 'Собственные бренды (через запятую)', inputType: 'text' },
    { key: 'productGroups', label: 'Товарные группы', inputType: 'multiselect', optionsSource: 'productGroups' },
  ],
  buyer: [
    { key: 'tradeName', label: 'Торговое название или ИП', inputType: 'text', core: true }, // ТЗ v1.22.31
    { key: 'inn', label: 'ИНН/ОГРНИП', inputType: 'text' },
    { key: 'type', label: 'Тип', inputType: 'select', core: true, optionsSource: 'buyerTypes' },
    { key: 'city', label: 'Город нахождения', inputType: 'text', core: true }, // ТЗ v1.22.31
    { key: 'contactName', label: 'Контактное лицо', inputType: 'text', core: true },
    { key: 'contactRole', label: 'Должность контакта', inputType: 'select', optionsSource: 'roleTypes', alwaysShow: true }, // ТЗ v1.22.32: всегда в форме, но необязательно
    { key: 'phone', label: 'Телефон', inputType: 'tel', core: true },
    { key: 'email', label: 'Email', inputType: 'email', core: true },
    { key: 'website', label: 'Сайт', inputType: 'text' },
    { key: 'source', label: 'Откуда про нас узнали?', inputType: 'select', optionsSource: 'sources' },
    { key: 'contactPref', label: 'Предпочтительный способ связи', inputType: 'multiselect', optionsSource: 'contactPrefs' },
    { key: 'locationCount', label: 'Количество торговых точек', inputType: 'number', defaultValue: 1, alwaysShow: true }, // ТЗ v1.22.32 // ТЗ v1.22.31: по умолчанию 1
    { key: 'category', label: 'Примерный оборот в мес.', inputType: 'select', optionsSource: 'buyerCategoryComments' },
  ],
  // Форма сайта (новая, ТЗ): контакт, тип, текст*, способ связи.
  // Ответственного и выбора из списка на сайте НЕТ. Синхронизировать с
  // FORM_FIELD_DEFINITIONS.ticket в src/constants/index.ts (keep in sync by hand).
  ticket: [
    { key: 'type', label: 'Тип обращения', inputType: 'select', optionsSource: 'ticketTypes', core: true }, // ТЗ v1.22.32: первым и обязательным
    { key: 'contactName', label: 'Контактное лицо', inputType: 'text' },
    { key: 'contactPhone', label: 'Телефон', inputType: 'tel' },
    { key: 'contactEmail', label: 'Email', inputType: 'email' },
    { key: 'contactPref', label: 'Способ связи', inputType: 'multiselect', optionsSource: 'contactPrefs' }, // ТЗ v1.22.32: как в формах поставщик/покупатель
    { key: 'text', label: 'Текст обращения', inputType: 'textarea', core: true },
  ],
  // v_1.9: Маркетинг-кит — анкета фиксированная: ТОЛЬКО ИНН (других полей нет)
  marketingKit: [
    { key: 'inn', label: 'ИНН', inputType: 'text', core: true },
  ],
};

const STATIC_OPTIONS: Record<string, string[]> = {
  abcCategories: ['A', 'B', 'C'], // ТЗ v1.22.23: категория покупателя (A/B/C)
  roleTypes: ['директор', 'менеджер', 'собственник', 'РОП', 'ТП'],
  contactPrefs: ['почта', 'телефон', 'WhatsApp', 'Telegram'],
};
// ticketTypes намеренно НЕ статичны — берутся из настроек CRM (см. resolveOptions)

// Согласие на обработку ПДн: используется, если в сохранённом конфиге формы
// его ещё нет (старые конфиги до появления этой настройки).
const DEFAULT_CONSENT = {
  label: 'Я согласен на обработку персональных данных',
  documentUrl: '',
  documentLabel: 'Политика обработки персональных данных',
};

const MIN_SUBMIT_MS = 1200; // minimum time between form render and submit — see security note above

function serviceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function loadFormConfig(client: ReturnType<typeof createClient>, type: EntityType) {
  const { data, error } = await client.from('app_settings').select('settings').eq('id', 'global').maybeSingle();
  if (error || !data?.settings) return null;
  const settings = data.settings as Record<string, unknown>;
  const forms = settings.forms as Record<string, unknown> | undefined;
  const config = forms?.[type] as
    | {
        enabled: boolean; title: string; description?: string;
        fields: Array<{ key: string; required: boolean }>;
        successMessage: string; errorMessage: string;
        consent?: { label: string; documentUrl: string; documentLabel: string };
      }
    | undefined;
  // ТЗ v1.22.18: Маркетинг-кит работает «из коробки» — если админ не настраивал форму,
  // используем дефолтный конфиг вместо 404 «Форма недоступна» (иначе проверка ИНН не доходит).
  const DEFAULT_MK_CONFIG = {
    enabled: true,
    title: 'Маркетинг-кит',
    description: '',
    fields: [{ key: 'inn', required: true }],
    successMessage: 'Благодарим за Ваш интерес! Маркетинг-кит уже в пути.\n\nОжидайте презентацию на почте! Если что, мы всегда рядом.\n\nС уважением, команда ВсемЗапчасти.', // ТЗ v1.22.37
    errorMessage: 'Не удалось отправить заявку. Попробуйте позже.',
  };
  return { config: config ?? (type === 'marketingKit' ? DEFAULT_MK_CONFIG : null), settings };
}

function resolveOptions(source: string | undefined, settings: Record<string, unknown>): string[] | undefined {
  if (!source) return undefined;
  // ТЗ v1.22.26: «Предпочтительный способ связи» — из справочника Настройки → Связь
  // «Способы связи» (переименовываемый, как в карточках), а не из жёсткого списка.
  if (source === 'contactPrefs') {
    const cp = settings.contactPrefs as string[] | undefined;
    if (Array.isArray(cp) && cp.length) return cp;
    return STATIC_OPTIONS.contactPrefs;
  }
  // ТЗ v1.22.30: «Должность контакта» — из справочника Настройки → Источники → Роль
  if (source === 'roleTypes') {
    const rt = settings.roleTypes as string[] | undefined;
    if (Array.isArray(rt) && rt.length) return rt;
    return STATIC_OPTIONS.roleTypes;
  }
  if (source in STATIC_OPTIONS) return STATIC_OPTIONS[source];
  if (source === 'sources') { // ТЗ v1.22.24
    const srcs = (settings.sources as Array<{ name: string; deletedAt?: string }>) || [];
    return srcs.filter(x => !x.deletedAt).map(x => x.name);
  }
  if (source === 'buyerCategoryComments') { // ТЗ v1.22.25
    const c = (settings.buyerCategoryComment as Record<string, string>) || { A: '1 500 000 и больше', B: '500 000 – 1 500 000', C: '50 000 – 500 000' };
    return ['A', 'B', 'C'].map(k => c[k]).filter(Boolean); // выводим ТОЛЬКО комментарий
  }
  if (source === 'supplierTypes') return (settings.supplierTypes as string[]) || [];
  if (source === 'buyerTypes') return (settings.buyerTypes as string[]) || [];
  if (source === 'ticketTypes') return (settings.ticketTypes as string[]) || [];
  if (source === 'productGroups') {
    const groups = (settings.productGroups as Array<{ name: string; deletedAt?: string }>) || [];
    return groups.filter(g => !g.deletedAt).map(g => g.name);
  }
  if (source === 'supplierServices') {
    const services = (settings.supplierServices as Array<{ name: string; deletedAt?: string }>) || [];
    return services.filter(s => !s.deletedAt).map(s => s.name);
  }
  return undefined;
}

async function handleGetConfig(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') as EntityType | null;
  if (!type || !FIELD_DEFS[type]) return json({ error: 'Некорректный тип формы' }, 400);

  const client = serviceClient();
  const result = await loadFormConfig(client, type);
  if (!result || !result.config) return json({ error: 'Форма не настроена' }, 404);
  const { config, settings } = result;

  const chosenKeys = new Set(config.fields.map(f => f.key));
  const requiredKeys = new Set(config.fields.filter(f => f.required).map(f => f.key));

  const fields = FIELD_DEFS[type]
    .filter(def => def.core || def.alwaysShow || chosenKeys.has(def.key)) // ТЗ v1.22.32: alwaysShow-поля всегда в форме
    .map(def => ({
      key: def.key,
      label: def.label,
      inputType: def.inputType,
      required: Boolean(def.core || requiredKeys.has(def.key)),
      defaultValue: def.defaultValue, // ТЗ v1.22.31
      options: resolveOptions(def.optionsSource, settings),
    }));

  return json({
    enabled: config.enabled,
    title: config.title,
    description: config.description || '',
    successMessage: config.successMessage,
    errorMessage: config.errorMessage,
    consent: config.consent || DEFAULT_CONSENT,
    fields,
  });
}


// ─────────────────────────────────────────────────────────────
// УВЕДОМЛЕНИЯ О НОВЫХ ЗАЯВКАХ (Telegram + MAX + Email)
// Каждый канал включается заданием secrets в Supabase Dashboard
// → Edge Functions → Manage Secrets:
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   — общий чат (admins)
//   MAX_BOT_TOKEN + MAX_CHAT_ID             — мессенджер MAX
//   RESEND_API_KEY + NOTIFY_EMAIL (+ NOTIFY_EMAIL_FROM) — почта
// Плюс персональная маршрутизация: активным менеджерам, у которых
// включён соответствующий раздел и заполнен notifyChatId в профиле
// CRM, дубль уходит в их личный Telegram-чат (поле задаёт админ в
// Настройки → Пользователи).
// Отправка неблокирующая: ошибка канала НИКОГДА не ломает форму.
// ─────────────────────────────────────────────────────────────

const ENTITY_LABELS: Record<EntityType, string> = {
  supplier: 'Поставщик',
  buyer: 'Покупатель',
  ticket: 'Обращение',
  marketingKit: 'Маркетинг-кит',
};
const SECTION_PERM: Record<EntityType, string> = {
  supplier: 'suppliers',
  buyer: 'buyers',
  ticket: 'support',
  marketingKit: 'media',
};

function buildNotifyText(type: EntityType, clean: Record<string, unknown>): string {
  const lines = [`🆕 Новая заявка с сайта: ${ENTITY_LABELS[type]}`];
  const add = (label: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') lines.push(`${label}: ${Array.isArray(v) ? v.join(', ') : v}`); };
  add('Компания', clean.tradeName ?? clean.subject);
  add('Имя', clean.contactName);
  add('Телефон', clean.phone ?? clean.contactPhone);
  add('Email', clean.email ?? clean.contactEmail);
  add('Тип', clean.type);
  add('Город', clean.city);
  add('Текст', clean.text);
  add('Комментарий', clean.comment);
  if (clean.__dup) lines.push(`⚠️ Дубликат: ${clean.__dup}`);
  return lines.join('\n');
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function notifyTelegram(token: string, chatId: string, text: string): Promise<void> {
  await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}

/** MAX Bot API: база platform-api2.max.ru, токен — в заголовке Authorization
 *  БЕЗ слова Bearer (требование API). chat_id — число. */
async function notifyMax(token: string, chatId: string, text: string): Promise<void> {
  await fetchWithTimeout('https://platform-api2.max.ru/messages', {
    method: 'POST',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { chat_id: Number(chatId) }, text }),
  });
}

async function notifyEmail(text: string, subject: string, to: string, from?: string): Promise<void> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key || !to) return;
  await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from || Deno.env.get('NOTIFY_EMAIL_FROM') || 'CRM <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
    }),
  });
}

async function sendNotifications(type: EntityType, clean: Record<string, unknown>, settings: Record<string, unknown>): Promise<void> {
  const text = buildNotifyText(type, clean);
  const jobs: Array<Promise<void>> = [];
  // Конфиг каналов — из настроек CRM (модуль «Уведомления»); токены — только в Secrets
  const cfg = (settings.notifications || {}) as {
    telegram?: { enabled?: boolean; globalChatId?: string };
    max?: { enabled?: boolean; globalChatId?: string };
    email?: { enabled?: boolean; to?: string; from?: string };
  };

  const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const tgGlobal = cfg.telegram?.enabled ? (cfg.telegram.globalChatId || Deno.env.get('TELEGRAM_CHAT_ID') || '') : '';
  if (tgToken && tgGlobal) {
    jobs.push(notifyTelegram(tgToken, tgGlobal, text).catch(e => console.error('[notify] telegram global:', e)));
  }

  const maxToken = Deno.env.get('MAX_BOT_TOKEN');
  const maxChat = cfg.max?.enabled ? (cfg.max.globalChatId || Deno.env.get('MAX_CHAT_ID') || '') : '';
  if (maxToken && maxChat) {
    jobs.push(notifyMax(maxToken, maxChat, text).catch(e => console.error('[notify] max:', e)));
  }

  if (cfg.email?.enabled) {
    const to = cfg.email.to || Deno.env.get('NOTIFY_EMAIL') || '';
    if (to) jobs.push(notifyEmail(text, `Новая заявка: ${ENTITY_LABELS[type]}`, to, cfg.email.from).catch(e => console.error('[notify] email:', e)));
  }

  // Персональная маршрутизация: активные менеджеры с правом на раздел и своим каналом
  const permKey = SECTION_PERM[type];
  const users = (settings.users as Array<Record<string, unknown>>) || [];
  for (const u of users) {
    if (u.status !== 'active') continue;
    const perms = (u.permissions as Record<string, unknown>) || {};
    if (perms[permKey] !== true) continue;
    const channel = u.notifyChannel as string | undefined;
    const chatId = u.notifyChatId as string | undefined;
    const email = u.notifyEmail as string | undefined;
    if (channel === 'telegram' && tgToken && chatId) {
      jobs.push(notifyTelegram(tgToken, chatId, text).catch(e => console.error('[notify] telegram user:', e)));
    } else if (channel === 'max' && maxToken && chatId) {
      jobs.push(notifyMax(maxToken, chatId, text).catch(e => console.error('[notify] max user:', e)));
    } else if (channel === 'email' && email) {
      jobs.push(notifyEmail(text, `Новая заявка: ${ENTITY_LABELS[type]}`, email, cfg.email?.from).catch(e => console.error('[notify] email user:', e)));
    }
  }

  // Ждём все каналы (каждый с таймаутом 8с) — форма уже сохранена,
  // здесь только добиваем отправку; ошибки каналов выше пойманы.
  await Promise.allSettled(jobs);
}

async function handleSubmit(req: Request): Promise<Response> {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > 256 * 1024) return json({ error: 'Запрос слишком большой' }, 413);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Некорректный запрос' }, 400);

  const type = body.type as EntityType;
  const values = (body.values || {}) as Record<string, unknown>;
  const honeypot = typeof body.honeypot === 'string' ? body.honeypot : '';
  const renderedAt = typeof body.renderedAt === 'number' ? body.renderedAt : 0;

  if (!type || !FIELD_DEFS[type]) return json({ error: 'Некорректный тип формы' }, 400);

  // Bot traps: never reveal that a submission was rejected for these
  // reasons specifically — respond exactly like a real success, but don't
  // touch the database.
  if (honeypot) return json({ success: true });
  if (!renderedAt || Date.now() - renderedAt < MIN_SUBMIT_MS) return json({ success: true });

  // Согласие на обработку персональных данных — обязательно (152-ФЗ).
  // Проверяется на сервере, а не только галочкой в браузере.
  // ТЗ v1.22.12: consent приходит на верхнем уровне тела запроса (фронт), не в values
  const consent = (body as Record<string, unknown>).consent ?? (values as Record<string, unknown>).consent;
  if (consent !== true && consent !== 'on' && consent !== 'true') {
    return json({ error: 'Необходимо согласие на обработку персональных данных' }, 400);
  }

  const client = serviceClient();
  const result = await loadFormConfig(client, type);
  if (!result || !result.config || !result.config.enabled) {
    return json({ error: 'Форма недоступна' }, 404);
  }
  const { config, settings } = result;

  const chosenKeys = new Set(config.fields.map(f => f.key));
  const requiredKeys = new Set(config.fields.filter(f => f.required).map(f => f.key));
  const allowedDefs = FIELD_DEFS[type].filter(def => def.core || chosenKeys.has(def.key));

  // Whitelist: only keys explicitly configured for this form ever reach
  // the insert payload below — anything else the client sent is dropped.
  const clean: Record<string, unknown> = {};
  for (const def of allowedDefs) {
    const raw = values[def.key] ?? def.defaultValue; // ТЗ v1.22.39: дефолт поля (точки = 1) попадает в заявку
    const isRequired = def.core || requiredKeys.has(def.key);
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (isRequired && empty) {
      return json({ error: `Заполните обязательное поле: ${def.label}` }, 400);
    }
    if (!empty) clean[def.key] = raw;
  }

  // v_1.9: Маркетинг-кит — анкета ТОЛЬКО ИНН: точное совпадение → заявка «Запрос МК»
  if (type === 'marketingKit') {
    const inn = String(clean.inn || '').replace(/\D/g, '');
    if (!/^\d{10}$|^\d{12}$/.test(inn)) return json({ error: 'Введите корректный ИНН (10 или 12 цифр)' }, 400);
    const { data: sup } = await client
      .from('suppliers')
      .select('id, trade_name')
      .eq('inn', inn)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (!sup) return json({ error: 'Извините, услуга доступна только поставщикам платформы!' }, 404);
    const today = new Date().toISOString().slice(0, 10);
    const { error: mkErr } = await client.from('media_records').insert({
      supplier_id: sup.id,
      supplier_name: sup.trade_name,
      ad_type_id: '',
      ad_type_name: '—',
      status: 'Запрос МК',
      price_per_month: 0,
      total_price: 0,
      start_date: today,
      end_date: today,
    });
    if (mkErr) { console.error('[public-form] marketing-kit:', mkErr); return json({ error: 'Не удалось создать заявку' }, 500); }
    return json({ ok: true, message: 'Заявка на Маркетинг-кит создана' });
  }

  const nowIso = new Date().toISOString();
  let table: string;
  let row: Record<string, unknown>;

  if (type === 'supplier') {
    table = 'suppliers';
    row = {
      type: clean.type || 'Поставщик/склад',
      trade_name: clean.tradeName,
      city: clean.city,
      address: clean.address ?? null,
      website: clean.website ?? null,
      inn: clean.inn ?? null,
      contact_role: clean.contactRole ?? null,
      contact_name: clean.contactName,
      phone: clean.phone,
      email: clean.email,
      status: 'Новый с сайта',
      source: (typeof clean.source === 'string' && clean.source) ? clean.source : 'Форма с сайта', // ТЗ v1.22.24: источник из формы, иначе канал «Форма с сайта»
      contact_prefs: Array.isArray(clean.contactPref) ? clean.contactPref : (clean.contactPref ? [clean.contactPref] : []), // ТЗ v1.22.27: мультивыбор
      warehouse_count: clean.warehouseCount ? Number(clean.warehouseCount) : null,
      sku_count: clean.skuCount ? Number(clean.skuCount) : null,
      product_groups: Array.isArray(clean.productGroups) ? clean.productGroups : [],
      own_brands: typeof clean.ownBrands === 'string' ? clean.ownBrands.split(',').map(s => s.trim()).filter(Boolean) : [],
      // ТЗ v1.22.41: «Анкета → Сервисы продаж» — по умолчанию DBS для поставщиков с формы
      services: (() => { const list = Array.isArray(clean.services) ? [...clean.services] : []; if (!list.includes('DBS')) list.push('DBS'); return list; })(),
      comment: clean.comment ?? null,
      additional_contacts: clean.additionalContacts ?? null,
      from_api: true,
      history: [{ id: crypto.randomUUID(), date: nowIso, field: 'создание', oldValue: undefined, newValue: 'Заявка с сайта', comment: undefined, userId: 'public-form', userName: 'Форма с сайта' }],
    };
  } else if (type === 'buyer') {
    table = 'buyers';
    row = {
      type: clean.type || 'магазин',
      trade_name: clean.tradeName,
      city: clean.city,
      address: clean.address ?? null,
      website: clean.website ?? null,
      inn: clean.inn ?? null,
      contact_role: clean.contactRole ?? null,
      contact_name: clean.contactName,
      phone: clean.phone,
      email: clean.email,
      status: 'Новый с сайта',
      source: (typeof clean.source === 'string' && clean.source) ? clean.source : 'Форма с сайта', // ТЗ v1.22.24: источник из формы, иначе канал «Форма с сайта»
      contact_prefs: Array.isArray(clean.contactPref) ? clean.contactPref : (clean.contactPref ? [clean.contactPref] : []),
      locations_count: clean.locationCount ? Number(clean.locationCount) : null,
      comment: clean.comment ?? null,
      // ТЗ v1.22.25: в форме выбран комментарий (оборот) — маппим обратно на букву категории
      category: (() => {
        const cc = (settings.buyerCategoryComment as Record<string, string>) || { A: '1 500 000 и больше', B: '500 000 – 1 500 000', C: '50 000 – 500 000' };
        const byComment = ['A', 'B', 'C'].find(k => cc[k] === clean.category);
        return byComment ?? (['A', 'B', 'C'].includes(String(clean.category)) ? String(clean.category) : undefined);
      })(),
      additional_contacts: clean.additionalContacts ?? null,
      from_api: true,
      history: [{ id: crypto.randomUUID(), date: nowIso, field: 'создание', oldValue: undefined, newValue: 'Заявка с сайта', comment: undefined, userId: 'public-form', userName: 'Форма с сайта' }],
    };
  } else {
    table = 'tickets';
    row = {
      type: clean.type || 'Вопрос',
      status: 'Новый запрос с формы',
      subject: clean.text ? String(clean.text).slice(0, 120) : 'Обращение с формы', // ТЗ v1.22.39: subject NOT NULL
      text: clean.text,
      contact_name: clean.contactName ?? null,
      contact_phone: clean.contactPhone ?? null,
      contact_email: clean.contactEmail ?? null,
      contact_prefs: Array.isArray(clean.contactPref) ? clean.contactPref : (clean.contactPref ? [clean.contactPref] : []),
      from_api: true,
      history: [],
    };
  }

  // ТЗ v1.22.22: дедупликация — если запись уже есть, НЕ сохраняем ничего и
  // честно говорим посетителю (подсказка в форме). Поставщик — по ИНН,
  // покупатель — по телефону или email. Сравнение последних 10 цифр телефона
  // работает независимо от форматирования. Формы редкие (5/10мин), выборка ок.
  if (table === 'suppliers' && clean.inn) {
    const innDigits = String(clean.inn).replace(/\D/g, '');
    if (innDigits.length >= 10) {
      const { data: cands } = await client.from('suppliers').select('id, inn').not('inn', 'is', null).is('deleted_at', null).limit(1000);
      if ((cands || []).some(c => String(c.inn || '').replace(/\D/g, '') === innDigits)) {
        return json({ error: 'Невозможно пройти регистрацию: такой поставщик уже есть на платформе' }, 409);
      }
    }
  }
  if (table === 'buyers' && (clean.phone || clean.email)) {
    const phKey = clean.phone ? String(clean.phone).replace(/\D/g, '').slice(-10) : '';
    const em = clean.email ? String(clean.email).trim().toLowerCase() : '';
    const { data: cands } = await client.from('buyers').select('id, phone, email')
      .or('phone.not.is.null,email.not.is.null')
      .is('deleted_at', null).limit(1000);
    const dup = (cands || []).some(c => {
      const cph = String(c.phone || '').replace(/\D/g, '').slice(-10);
      const cem = String(c.email || '').trim().toLowerCase();
      return (phKey.length >= 6 && cph === phKey) || (em && cem === em);
    });
    if (dup) {
      return json({ error: 'Невозможно пройти регистрацию: такой покупатель уже есть на платформе' }, 409);
    }
  }

  // ТЗ v1.22.18: если БД старее schema.sql (нет новых колонок), полный INSERT падает с 500 —
  // повторяем вставку ядром гарантированных колонок, заявка не теряется.
  const CORE_KEYS: Record<string, string[]> = {
    suppliers: ['type', 'trade_name', 'inn', 'city', 'contact_name', 'phone', 'email', 'website', 'contact_role', 'contact_prefs', 'product_groups', 'own_brands', 'services', 'status', 'source', 'from_api', 'history'], // ТЗ v1.22.41: +services (DBS переживает fallback)
    buyers: ['type', 'trade_name', 'inn', 'city', 'contact_name', 'phone', 'email', 'website', 'contact_role', 'contact_prefs', 'status', 'source', 'from_api', 'history'], // ТЗ v1.22.33: +website (переживает fallback)
    tickets: ['type', 'status', 'subject', 'text', 'contact_name', 'contact_phone', 'contact_email', 'from_api', 'history'], // ТЗ v1.22.39: subject NOT NULL
  };
  let savedId: string | null = null;
  const ins1 = await client.from(table).insert([row]).select('id');
  savedId = ins1.data?.[0]?.id ?? null;
  if (ins1.error) {
    // Уровень 1: ядро гарантированных колонок
    const coreRow = Object.fromEntries(Object.entries(row).filter(([k]) => (CORE_KEYS[table] || []).includes(k)));
    const ins2 = await client.from(table).insert([coreRow]).select('id');
    savedId = ins2.data?.[0]?.id ?? null;
    if (!ins2.error) {
      console.error('[public-form] full insert failed, saved core-only. Missing columns? Full error:', ins1.error.message);
    } else {
      // Уровень 2 (ТЗ v1.22.19): минимум без которого заявка бессмысленна
      const MIN_KEYS: Record<string, string[]> = {
        suppliers: ['type', 'trade_name', 'city', 'status', 'source'],
        buyers: ['type', 'trade_name', 'city', 'status', 'source'],
        tickets: ['type', 'status', 'subject', 'text'], // ТЗ v1.22.39
      };
      const minRow = Object.fromEntries(Object.entries(row).filter(([k]) => (MIN_KEYS[table] || []).includes(k)));
      const ins3 = await client.from(table).insert([minRow]).select('id');
      savedId = ins3.data?.[0]?.id ?? null;
      if (ins3.error) {
        console.error('[public-form] insert failed (all 3 levels):', ins3.error, '| core error:', ins2.error.message, '| full error:', ins1.error.message);
        // ТЗ v1.22.38: дебаг-режим — секрет PUBLIC_FORM_DEBUG=1 временно показывает точную ошибку Postgres
        if (Deno.env.get('PUBLIC_FORM_DEBUG') === '1') {
          return json({ error: 'Не удалось сохранить заявку', debug: String((ins3.error as { message?: string }).message || ins3.error) }, 500);
        }
        return json({ error: 'Не удалось сохранить заявку' }, 500);
      }
      console.error('[public-form] core insert failed, saved minimal-only. Missing columns? Core error:', ins2.error.message);
    }
  }
  // ТЗ v1.22.40: условие сервиса поиска НЕ создаётся автоматически при регистрации с формы.


  // Уведомления (ТЗ): Telegram + MAX + Email + личные чаты ответственных.
  // Ошибка любого канала не влияет на ответ посетителю формы.
  try {
    await sendNotifications(type, clean, settings as Record<string, unknown>);
  } catch (e) {
    console.error('[public-form] notify failed:', e);
  }

  return json({ success: true });
}

// Rate limiting (аудит): без него функцию можно флудить заявками с одного IP.
// In-memory бакет на инстанс: max 5 POST за 10 минут с одного IP. Для
// мульти-инстанс-нагрузки заменить на Upstash Redis. Лимитированному боту
// отвечаем фейковым успехом — не подсвечиваем, что его поймали.
const ipHits = new Map<string, number[]>();
const RL_WINDOW = 10 * 60 * 1000;
const RL_MAX = 5;
function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < RL_WINDOW);
  if (hits.length >= RL_MAX) { ipHits.set(ip, hits); return false; }
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear(); // страховка от раздувания памяти
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method === 'POST') {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      if (!rateLimitOk(ip)) return json({ error: 'Форма не доступна из-за частых запросов, попробуйте зайти позднее или обратиться в поддержку' }, 429); // ТЗ v1.22.31
    }
    if (req.method === 'GET') return await handleGetConfig(req);
    if (req.method === 'POST') return await handleSubmit(req);
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    // Детали ошибки — только в серверные логи. Клиенту нейтральный текст,
    // иначе текст исключения Postgres/кода утекает любому посетителю сайта.
    console.error('[public-form] unhandled error:', err);
    return json({ error: 'Внутренняя ошибка сервера. Попробуйте позже.' }, 500);
  }
});