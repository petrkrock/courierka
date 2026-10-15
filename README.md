# ВСЕМЗАПЧАСТИ — ДОСТАВКА (vzdelivery)

Отдельная программа сервиса доставки (DBO), выделенная из CRM vzcrm v1.30.38.
Тот же стек и та же механика данных, своя база Supabase и свой вход.

## Стек

Vite 5 · React 18 · TypeScript · Tailwind CSS · Supabase (Postgres + Auth + Realtime + Storage) · PWA

## Функции

- **Доставки** — задания на доставку (создание, статусы, объёмы, массовые смены)
- **Возвраты**, **Документы**, **Финансы** — учётные вкладки модуля
- **Города доставки** — таблица город × поставщик, графики, МКП
- **Маршруты самовывоза** — маршруты с остановками, днями недели, историей
- **Поставщики** — список поставщиков доставки, карточка с анкетой договора DBO,
  выдача/отзыв доступа в ЛК (токен + PIN, `/d/<token>`), «Новый поставщик»
- **Настройки** — пользователи/роли/фильтры, города, операторы, тарифы
  (сервис/за город), статусы договоров и заданий, контент ЛК, справочники

## Быстрый старт (prod)

1. **Новый проект Supabase** — отдельный от CRM (своя база).
2. В **SQL Editor** выполнить целиком `supabase/schema.sql`.
3. **Storage** → убедиться, что бакет `lk-assets` создан (политика — публичный, создаётся схемой).
4. Скопировать `.env.example` → `.env`, вписать `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`
   (Supabase Dashboard → Project Settings → API).
5. ```bash
   npm install
   npm run build        # → dist/ (любой статический хостинг)
   ```

## Первый администратор

1. Supabase Dashboard → Authentication → Add user → создать себя (email + пароль).
2. SQL Editor:
   ```sql
   update profiles set role = 'admin' where id = '<ваш-auth-uuid>';
   insert into app_settings (id, settings) values ('global', '{}')
   on conflict (id) do nothing;
   ```
3. Зайти в программу под своим логином. Настройки → Пользователи → создать остальных
   (требует развёрнутой Edge Function, см. ниже).

## Edge Function create-manager

Настройки → Пользователи создают реальные Supabase Auth-аккаунты через Edge Function:

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy create-manager
```

## Демо-режим (без сервера, только локально)

В `.env` добавить `VITE_DEMO_MODE=true`. Вход: `admin@vz.tech` / `admin123`.
Данные живут только в localStorage браузера. Не включать в проде.

## Архитектура (как в CRM, обрезано до доставки)

| Слой | Файл | Что делает |
|---|---|---|
| Кэш | `src/lib/store.ts` | offline-first: localStorage, debounce-push 1.5с в Supabase, дифф по сущностям, grace-window 5 мин, лог синка |
| Данные | `src/lib/supabase.ts` | CRUD suppliers, settings-блоб (sanitize паролей, защита от затирания), realtime-подписки, pull/push snapshot |
| Вход | `src/lib/auth.ts` | сессия 7 дней, перепроверка по `settings.users` (уволен → мгновенный выход), роли admin/manager |
| Realtime | `src/lib/realtime.ts` | зеркалит suppliers + app_settings в кэш без эха |
| UI | `src/pages/delivery/*`, `src/pages/SettingsPage.tsx` | перенос логики CRM 1:1 |

Сущности: `suppliers` (таблица) + всё остальное — внутри `app_settings.settings`
(маршруты, тарифы, города, задания, операторы, контент ЛК, пользователи).

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `VITE_SUPABASE_URL` | URL проекта Supabase |
| `VITE_SUPABASE_ANON_KEY` | anon/public key |
| `VITE_DEMO_MODE` | локальный демо-режим без сервера |

## Доработка

Код чистый, без лишних зависимостей — все CRM-сущности (покупатели, задачи, тикеты,
медиа, лиды, база знаний, план/факт, аналитика) удалены. Добавление нового раздела:
тип в `src/types`, константы в `src/constants`, пункт в `navConfig.ts`, страница в
`src/pages`, роут в `App.tsx`, гард `canAccess(...)`.
