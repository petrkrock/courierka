-- ============================================================
-- SCHEMA — ВСЕМЗАПЧАСТИ ДОСТАВКА (отдельная программа, сервис DBO)
--
-- Выполнить ОДИН раз в SQL Editor отдельного проекта Supabase.
-- Таблицы и поля suppliers совпадают с CRM — программа читает/пишет
-- те же колонки (delivery_access, delivery_contract, service_access, ...).
-- ============================================================

create extension if not exists pgcrypto;

-- ── PROFILES: профиль для каждого пользователя Supabase Auth ──
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'manager' check (role in ('admin', 'manager')),
  status text not null default 'active' check (status in ('active', 'blocked', 'fired')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create or replace function public.is_active_employee()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

-- Доступ к разделу: у админа всегда есть; у менеджера — если разрешён в app_settings
create or replace function public.has_section_permission(section text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce((
    select (s.settings->'users') is not null and exists (
      select 1 from jsonb_array_elements(s.settings->'users') u
      where lower(u->>'email') = lower((select email from auth.users where id = auth.uid()))
        and coalesce((u->'permissions'->>section)::boolean, false)
        and coalesce(u->>'status', 'active') = 'active'
    )
    from app_settings s where s.id = 'global'
  ), false);
$$;

-- ── SUPPLIERS: поставщики (поля совпадают с CRM) ──
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'Поставщик/склад',
  trade_name text not null,
  city text not null default '',
  address text,
  website text,
  inn text,
  contact_role text not null default 'менеджер',
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  status text not null default 'Новый',
  source text,
  contact_pref text,
  contact_prefs text[] not null default '{}',
  warehouse_count integer,
  sku_count integer,
  warehouse_locations jsonb not null default '[]',
  product_groups text[] not null default '{}',
  own_brands text[] not null default '{}',
  services text[] not null default '{}',
  company_score numeric not null default 5,
  category text check (category in ('A','B','C')),
  comment text,
  scoring jsonb,
  requisites jsonb,
  service_search jsonb not null default '[]',
  service_access jsonb,
  -- Доставка (DBO) — доступ к ЛК доставки по ссылке /d/<token>. СВОЯ настройка, с DBS не связана.
  delivery_access jsonb,
  -- Доставка (DBO) — данные анкеты договора из раздела Доставка
  delivery_contract jsonb,
  history jsonb not null default '[]',
  additional_contacts text,
  additional_comment text,
  from_api boolean not null default false,
  created_by uuid references profiles (id),
  responsible_id uuid references profiles (id),
  responsible_name text,
  multiwarehouse boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table suppliers enable row level security;

create or replace function public.access_supplier_types()
returns text[] language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then '{}'::text[] else coalesce((
    select array_agg(x) from app_settings s, jsonb_array_elements_text(
      (select u->'access'->'supplierTypes' from jsonb_array_elements(s.settings->'users') u
       where lower(u->>'email') = lower((select email from auth.users where id = auth.uid())) limit 1
    )) as t(x) from app_settings s where s.id = 'global' limit 1
  ), '{}'::text[]) end;
$$;

create or replace function public.access_supplier_cities()
returns text[] language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then '{}'::text[] else coalesce((
    select array_agg(x) from app_settings s, jsonb_array_elements_text(
      (select u->'access'->'supplierCities' from jsonb_array_elements(s.settings->'users') u
       where lower(u->>'email') = lower((select email from auth.users where id = auth.uid())) limit 1
    )) as t(x) from app_settings s where s.id = 'global' limit 1
  ), '{}'::text[]) end;
$$;

-- Только активные сотрудники видят поставщиков (с учётом фильтров менеджера по типу/городу)
create policy suppliers_select on suppliers for select to authenticated
  using (public.is_active_employee()
    and (public.access_supplier_types() = '{}' or type = any(public.access_supplier_types()))
    and (public.access_supplier_cities() = '{}' or city = any(public.access_supplier_cities())));

create policy suppliers_insert on suppliers for insert to authenticated
  with check (public.is_active_employee() and public.has_section_permission('delivery'));

create policy suppliers_update on suppliers for update to authenticated
  using (public.is_active_employee() and public.has_section_permission('delivery'))
  with check (public.is_active_employee() and public.has_section_permission('delivery'));

create policy suppliers_delete on suppliers for delete to authenticated
  using (public.is_active_employee() and public.is_admin());

-- ── APP_SETTINGS: единый JSONB-блоб настроек (id = 'global') ──
create table if not exists app_settings (
  id text primary key,
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

-- Настройки читают все активные сотрудники, пишет — кто имеет доступ к разделу.
-- ВАЖНО: внутри settings.users НЕ хранить plaintext-пароли — приложение их вырезает (sanitizeSettings).
create policy app_settings_select on app_settings for select to authenticated
  using (public.is_active_employee());

create policy app_settings_update on app_settings for update to authenticated
  using (public.is_active_employee() and public.has_section_permission('delivery'))
  with check (public.is_active_employee() and public.has_section_permission('delivery'));

create policy app_settings_insert on app_settings for insert to authenticated
  with check (public.is_active_employee() and public.has_section_permission('delivery'));

-- Первый администратор сможет создать строку настроек до появления profiles —
-- временная политика: insert разрешён любому аутентифицированному, пока строки нет.
create policy app_settings_insert_bootstrap on app_settings for insert to authenticated
  with check (id = 'global' and not exists (select 1 from app_settings where id = 'global'));

-- ── USER_ACCESS: фильтры видимости менеджеров ──
create table if not exists user_access (
  user_id uuid primary key references profiles (id) on delete cascade,
  supplier_types text[] not null default '{}',
  supplier_cities text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table user_access enable row level security;

create policy user_access_select on user_access for select to authenticated
  using (public.is_active_employee());

-- ── APP_LOGS: журнал действий (опционально, пишется приложением) ──
create table if not exists app_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id),
  user_name text,
  action text not null,
  entity text,
  entity_id text,
  created_at timestamptz not null default now()
);

alter table app_logs enable row level security;

create policy app_logs_select on app_logs for select to authenticated
  using (public.is_active_employee() and public.is_admin());

create policy app_logs_insert on app_logs for insert to authenticated
  with check (public.is_active_employee());

-- ── Триггер updated_at ──
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists suppliers_touch on suppliers;
create trigger suppliers_touch before update on suppliers
  for each row execute function public.touch_updated_at();

drop trigger if exists app_settings_touch on app_settings;
create trigger app_settings_touch before update on app_settings
  for each row execute function public.touch_updated_at();

-- ── Автосоздание профиля при регистрации в Supabase Auth ──
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, status)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), 'manager', 'active')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Realtime: транслируем изменения всем подключённым клиентам ──
alter publication supabase_realtime add table suppliers;
alter publication supabase_realtime add table app_settings;

-- ── Storage: публичный бакет для ассетов ЛК (баннер, аватары операторов) ──
insert into storage.buckets (id, name, public)
values ('lk-assets', 'lk-assets', true)
on conflict (id) do nothing;
