## v1.30.43 — ЛК поставщика: оператор, карточка менеджера, сетка счётчиков, MARKET

- Настройки → ЛК Поставщик: новая под-вкладка «Оператор» (первая в меню) — создание
  оператора/персонального менеджера как в v1.30.38: имя, телефон, email, аватар
  (Storage lk-assets), связь с пользователем CRM, MAX-ссылка; список с удалением.
  Хранилище — settings.lkOperators (тип LkOperator), сид-миграция вне гейта.
- ЛК поставщика, дашборд: возвращена карточка «Персональный менеджер» — показывает
  оператора (аватар, имя, телефон, email, чат MAX), если не настроен — окно
  «Персональный менеджер не настроен». Данные приходят ключом lkOperator из
  supplier-service (поиск по responsible_id).
- Дашборд, счётчики: сетка 5 в ряд (xl:grid-cols-5 вместо 6).
- Кабинет, «Активные сервисы продаж»: FBS → MARKET.
- Порядок под-вкладок ЛК в настройках: Оператор → Дашборд → Банеры → Новости →
  Приветствия → Ссылки офер (ссылки сразу после Приветствия).

Файлы: types, store, SettingsPage, SupplierServicePage, supplier-service/index.ts.
SQL: не требуется. Деплой: supplier-service → сборка фронта.

## v1.30.42 — ЛК поставщика: дашборд возвращён, доставочный функционал с дашборда убран

Срез фичи доставки ошибочно удалил из ЛК поставщика дашборд, кросс-докинг и продвижение
целиком. Восстановлено (версия 1.30.38): дашборд (приветствие, ВЗ ЧАТ, сводка анкеты,
проценка, МАРКЕТ, продвижение, склады, действия), вкладки «Кросс-докинг» и «Продвижение».

С дашборда удалён только доставочный функционал: карточка менеджера доставки, стат
«Городов доставки», строка «Доставка» со ссылкой «Договор» и кнопкой «Активировать»,
модалка активации. Edge function supplier-service снова не отдаёт delivery/deliveryCities
(edoFields-защита 1.30.40 сохранена).

Файлы: SupplierServicePage.tsx, supplier-service/index.ts. SQL: не требуется.
Деплой: `supabase functions deploy supplier-service --no-verify-jwt` → сборка фронта.

## v1.30.41 — Hotfix: удалена остаточная модалка тарифа в ЛК поставщика

В SupplierServicePage после среза фичи остался JSX-блок tariffModal (состояние было
удалено, блок нет) — сборка падала «tariffModal is not defined». Блок вырезан,
проведён полный аудит: висячих идентификаторов нет, баланс чисто.

Файлы: src/pages/supplier-service/SupplierServicePage.tsx. SQL: не требуется.

## v1.30.40 — Hotfix: устойчивость к миграции ЭДО (404 ЛК и синхрон)

- Edge function supplier-service: колонки edo_operator/edo_token вынесены из основного
  SELECT findSupplierByToken в отдельный запрос с фолбэком (урок ТЗ v1.23.36) — ЛК
  больше не падает с 404, если SQL-миграция ещё не прогнана.
- supabase.ts: защита всех точек записи suppliers/buyers (create/update/пакетный push) —
  при ошибке об отсутствии колонок edo_* пакет вырезается от этих ключей и запрос
  повторяется один раз; синхрон больше не умирает целиком до прогона SQL.
- Таблицы Поставщики/Покупатели: «ответственный» под датой показывается даже если
  серверное responsible_name пустое — фолбэк-lookup имени из users по responsibleId.

SQL: не требуется (миграция ЭДО — из v1.30.39, см. ниже; порядок: SQL → deploy
supplier-service → сборка фронта). Файлы: supplier-service/index.ts, supabase.ts,
SuppliersPage.tsx, BuyersPage.tsx.

# MIGRATION — история версий ВСЕМЗАПЧАСТИ CRM

## v1.30.39 — Удаление сервиса доставки (полный срез фичи)

Фича «Доставка» (DBO) удалена полностью — код, настройки, типы, документация.

Файлы:
- Удалены: src/pages/delivery/ (DeliveryPage.tsx, DeliverySupplierCardPage.tsx).
- Изменены: App.tsx (роуты), navConfig.ts, types/index.ts, store.ts, constants/index.ts,
  supabase.ts, supabase/schema.sql, AnalyticsPage.tsx, SettingsPage.tsx (секция «Доставка»,
  вкладка «Персональный менеджер» ЛК), SupplierCardPage.tsx (вкладка «Доставка (DBO)»),
  SupplierServicePage.tsx (раздел «Доставка» ЛК /s/), supabase/functions/supplier-service/index.ts.

Что перенесено:
- ЭДО: поля edoOperator/edoToken перенесены из delivery_contract на верхний уровень Supplier
  и на колонки suppliers.edo_operator / suppliers.edo_token (маппинг обе стороны).
- Сервис проценки (DBS), склады, условия ТК (deliverySchedule/deliveryTime складов) — без
  изменений, не являются частью удалённой фичи.

SQL для боевой базы (выполнить в указанном порядке):
```sql
-- 1. ЭДО: новые колонки + миграция данных из delivery_contract
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS edo_operator TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS edo_token TEXT;
UPDATE suppliers SET edo_operator = COALESCE(edo_operator, delivery_contract->>'edoOperator')
  WHERE delivery_contract ? 'edoOperator';
UPDATE suppliers SET edo_token = COALESCE(edo_token, delivery_contract->>'edoToken')
  WHERE delivery_contract ? 'edoToken';
-- 2. Удаление колонок доставки
ALTER TABLE suppliers DROP COLUMN IF EXISTS delivery_access;
ALTER TABLE suppliers DROP COLUMN IF EXISTS delivery_contract;
-- 3. Чистка ключей доставки в настройках (app_settings, JSONB)
UPDATE app_settings
SET settings = settings
  - 'deliveryCities' - 'deliveryOperators' - 'deliveryContractStatuses'
  - 'deliveryTaskStatuses' - 'deliveryServiceTariffs' - 'deliveryCityTariffs'
  - 'deliveryRoutes' - 'deliveryCityMinSuppliers' - 'deliveryCityRows'
  - 'deliveryTasks' - 'deliveryCitySchedules'
WHERE id = 'global';
-- 4. Удаление системного сервиса DBO из справочника сервисов
UPDATE app_settings
SET settings = jsonb_set(settings, '{supplierServices}', (
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  FROM jsonb_array_elements(settings->'supplierServices') elem
  WHERE elem->>'name' <> 'DBO'
))
WHERE id = 'global';
```

Деплой: SQL → `supabase functions deploy supplier-service --no-verify-jwt` → сборка фронта → monitor-server (без изменений).

