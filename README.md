# ВСЕМЗАПЧАСТИ CRM (vzcrm)

CRM-система для управления поставщиками, покупателями, лидами, задачами, поддержкой,
медиа-размещениями, планом/фактом и базой знаний. Веб-приложение (SPA + PWA):
десктоп, планшет, мобильный. Русскоязычный интерфейс, роли «Администратор» и «Менеджер»
(с подтипами дашбордов **МОП** — продажи/покупатели и **МОЗ** — закупки/поставщики).

> Текущая версия: **1.30.43**

---

## Стек технологий

| Слой | Технологии |
|---|---|
| Фронтенд | React 18 + TypeScript, Vite 5, Tailwind CSS 3, Recharts, lucide-react |
| PWA | vite-plugin-pwa (service worker, офлайн-оболочка, автообновление) |
| Состояние | `src/lib/store.ts` (собственный store с версионированием + localStorage + демо-режим) |
| Бэкенд | **Supabase**: PostgreSQL 15 + Row Level Security, Supabase Auth (GoTrue, JWT), Edge Functions (Deno), Storage |
| Мониторинг | `server/monitor-server.js` (Node, без фреймворков): SPA + защищённое API серверных метрик для раздела «Сервер» |
| Деплой | Vercel (вариант А) или свой сервер: Nginx + PM2 (вариант Б) |

## Архитектура

```
┌─────────────┐   HTTPS    ┌──────────────────────── Supabase Cloud ────────────────────────┐
│  Браузер    │ ─────────► │ PostgreSQL (RLS, 30+ политик)  Auth (JWT)  Storage (knowledge) │
│ React SPA   │  anon key  │ Edge Functions: public-form, create-manager, update-manager,   │
│ (PWA, кэш)  │            │                supplier-service, checko, monitor-proxy         │
└─────────────┘            └────────────────────────────────────────────────────────────────┘
       ▲ same-origin (вариант Б)
┌──────┴──────┐  service_role key живёт ТОЛЬКО здесь (.env сервера, в браузер не попадает)
│ Nginx → PM2 │
│ monitor-    │  Раздаёт dist/ (SPA-fallback) и /api/* мониторинга (проверка JWT + роль admin)
│ server.js   │
└─────────────┘
```

**Поток данных:** фронтенд хранит рабочее состояние в памяти + localStorage и синхронизирует
его с Supabase (таблицы `suppliers`, `buyers`, `tasks`, `tickets`, `media_records`,
`market_volumes`; справочники и пользователи — в JSONB-таблице `app_settings`).
Права менеджеров (тип дашборда, база План/Факт, база лидов, города, фильтры разделов)
хранятся в профиле пользователя внутри `app_settings` — миграции БД под них не нужны.

**Модель безопасности:**
- Доступ к данным — через PostgREST с anon key; все таблицы закрыты **Row Level Security**,
  политики проверяют JWT и роль (`profiles`, `user_access`).
- Административные операции (создание/бан менеджеров) — через Edge Functions с
  `verify_jwt` и проверкой роли admin внутри функции.
- Service-role ключ используется только серверным `monitor-server.js`.
- Публичная форма заявок — отдельная Edge Function с rate limit и honeypot-защитой.

## Структура проекта

```
├── index.html                  # SPA-точка входа
├── src/
│   ├── main.tsx, App.tsx       # bootstrap и роутинг (lazy-загрузка страниц)
│   ├── components/             # layout (шапка/меню), ui/, ErrorBoundary
│   ├── pages/                  # Dashboard, ManagerDashboardPage (МОП/МОЗ),
│   │                           # suppliers, buyers, leads, tasks, support, media,
│   │                           # analytics, planfact, knowledge, settings, server…
│   ├── lib/                    # store.ts, auth.ts (RBAC), supabase.ts (синк),
│   │                           # env.ts (переменные окружения), utils.ts, format.ts
│   ├── types/index.ts          # все интерфейсы (Supplier, Buyer, Task, Ticket, …)
│   └── constants/index.ts      # справочные константы
├── supabase/
│   ├── schema.sql              # вся схема БД: таблицы, RLS, политики, триггеры,
│   │                           # индексы, storage-бакет knowledge (для чистовика)
│   └── functions/              # 7 Edge Functions (Deno)
├── server/monitor-server.js    # прод-сервер: статика + API мониторинга (PM2/Nginx)
├── .env.example                # шаблон переменных окружения
└── vite.config.ts              # PWA, chunk-сплиттинг, dev-proxy
```

## Роли и доступ

- **Администратор** — полный доступ, главный дашборд, аналитика, настройки, база данных,
  серверный мониторинг, предпросмотр дашбордов менеджеров.
- **Менеджер (МОП)** — дашборд МОП, покупатели (в закреплённых городах), задачи, поддержка,
  база лидов (покупатели), база знаний, План/Факт (база «покупатели», read-only).
  Видит только записи, закреплённые за ним, и записи без ответственного.
- **Менеджер (МОЗ)** — дашборд МОЗ, поставщики, медиа сервис, задачи, поддержка,
  база лидов (поставщики), база знаний, План/Факт (база «поставщики», read-only).
  Та же модель видимости «мои + без ответственного».

Настройка прав: **Настройки → Пользователи → (карандаш) → «Доступ к разделам»**.

---

# РАЗВЁРТЫВАНИЕ

## Вариант А. Облако: Vercel + Supabase (рекомендуется)

### Шаг 1. Подготовьте Supabase
1. Зайдите на https://supabase.com → **New project** (регион eu-central-1, задайте пароль БД).
2. Откройте **SQL Editor** → **New query** → вставьте **всё содержимое** `supabase/schema.sql`
   → **Run**. Создаются таблицы, RLS-политики, триггеры, индексы и storage-бакет `knowledge`.
3. **Authentication → Providers**: включите Email (подтверждение письма — по желанию).
4. Создайте первого администратора: **Authentication → Add user → Create new user**
   (email + пароль). Затем в **Table Editor → profiles** убедитесь, что у него `role = admin`
   (триггер `handle_new_auth_user` создаёт запись автоматически; роль по умолчанию `manager` —
   при необходимости поправьте вручную один раз).

### Шаг 2. Deploy Edge Functions
```bash
npm i -g supabase
supabase login
supabase link --project-ref <ВАШ_PROJECT_REF>
supabase functions deploy public-form
supabase functions deploy create-manager
supabase functions deploy update-manager
supabase functions deploy supplier-service
supabase functions deploy checko
supabase functions deploy monitor-proxy
supabase functions deploy telegram-bot   # если используете
```
Секреты функций (Supabase Dashboard → **Edge Functions → Manage secrets**):
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `MAX_BOT_TOKEN`, `MAX_CHAT_ID`,
`RESEND_API_KEY`, `NOTIFY_EMAIL`, `NOTIFY_EMAIL_FROM`, `APP_ORIGINS` (CORS-allowlist для create-manager / update-manager).

### Шаг 3. Залейте код на Vercel
1. Пушните репозиторий на GitHub/GitLab.
2. https://vercel.com → **Add New → Project** → импортируйте репозиторий.
3. Framework: **Vite** (определится автоматически), build: `npm run build`, output: `dist`.

### Шаг 4. Переменные окружения (Vercel → Project → Settings → Environment Variables)
```
VITE_SUPABASE_URL        = https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY   = <anon public key из Supabase → Settings → API>
```
(Ключи берутся в Supabase: **Project Settings → API**. Именно **anon public**, НЕ service_role.)

### Шаг 5. Деплой
**Deployments → Redeploy**. Через ~1 минуту приложение живёт на `https://<проект>.vercel.app`.
Зайдите под админом, проверьте: Пользователи, Дашборд, План/Факт, загрузку файлов в Базу знаний.

---

## Вариант Б. Свой сервер (Ubuntu 22.04/24.04 + Nginx + PM2)

### Шаг 1. Системные зависимости
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx
sudo npm i -g pm2
node -v   # v22.x
```

### Шаг 2. Код и сборка
```bash
sudo mkdir -p /var/www/crm && sudo chown $USER:$USER /var/www/crm
git clone <ВАШ_РЕПОЗИТОРИЙ> /var/www/crm
cd /var/www/crm
cp .env.example .env          # и заполните (см. таблицу ниже)
npm ci
npm run build                 # появится dist/
```

### Шаг 3. Переменные окружения (`/var/www/crm/.env`)
```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
PORT=3000
PM2_APP_NAME=crm
SUPABASE_SERVICE_ROLE_KEY=<service_role key — ТОЛЬКО на сервере>
NGINX_ERROR_LOG=/var/log/nginx/error.log
NGINX_ACCESS_LOG=/var/log/nginx/access.log
```
Supabase-бэкенд берём облачный (шаги 1–2 варианта А) — собственная PostgreSQL-машина
не нужна: вся БД/Auth/Functions живут в Supabase, сервер раздаёт только фронт и мониторинг.

### Шаг 4. Запуск через PM2 (автозапуск)
```bash
cd /var/www/crm
pm2 start server/monitor-server.js --name crm
pm2 save
sudo pm2 startup systemd -u $USER --hp $HOME   # автозапуск при перезагрузке ОС
curl -I http://127.0.0.1:3000                  # проверка
```

### Шаг 5. Nginx
```bash
sudo nano /etc/nginx/sites-available/crm
```
```nginx
server {
    listen 80;
    server_name crm.вашдомен.ru;
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Шаг 6. HTTPS (Let's Encrypt)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.вашдомен.ru
```

### Шаг 7. Обновления
```bash
cd /var/www/crm
git pull
npm ci && npm run build
pm2 restart crm
```

---

## Переменные окружения (шпаргалка)

| Переменная | Где | Назначение |
|---|---|---|
| `VITE_SUPABASE_URL` | Vercel / `.env` | URL проекта Supabase |
| `VITE_SUPABASE_ANON_KEY` | Vercel / `.env` | anon public ключ (безопасен для браузера) |
| `SUPABASE_SERVICE_ROLE_KEY` | **только сервер** `.env` | полный доступ; используется monitor-server.js для проверки JWT админа |
| `PORT` | сервер `.env` | порт monitor-server.js (по умолчанию 3000) |
| `TELEGRAM_BOT_TOKEN` и др. | Secrets Edge Functions | уведомления о заявках с форм |

## Демо-режим (без сервера)
```bash
cp .env.example .env   # VITE_SUPABASE_* оставить пустыми
# в .env: VITE_DEMO_MODE=true
npm run dev
```
Вход: `admin@admin.com` / `admin123`. Данные — только в localStorage браузера.

## Резервное копирование и диагностика
- Бэкап БД: Supabase Dashboard → Database → Backups (плановые) либо
  `supabase db dump` (CLI).
- Логи приложения: `pm2 logs crm` (вариант Б); Vercel → Logs (вариант А).
- Раздел **«Сервер»** в CRM (только главный админ): статус PM2, логи PM2/Nginx,
  срок SSL-сертификата, перезапуск — работает только в варианте Б.

## Лицензия
Внутренний продукт. Все права у правообладателя.
