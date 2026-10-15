-- ============================================================
-- ВСЕМЗАПЧАСТИ CRM — CLEAN INITIAL SCHEMA
-- Version: 1.18.34 baseline
-- Purpose: first installation into a brand-new Supabase project.
-- This file is NOT a historical migration file.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE public.suppliers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                TEXT NOT NULL,
  trade_name          TEXT NOT NULL,
  city                TEXT NOT NULL,
  address             TEXT,
  website             TEXT,
  inn                 TEXT,
  contact_role        TEXT,
  contact_name        TEXT NOT NULL,
  phone               TEXT NOT NULL,
  email               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'В работе',
  source              TEXT,
  contact_pref        TEXT,
  contact_prefs       JSONB NOT NULL DEFAULT '[]'::jsonb,
  warehouse_count     INTEGER NOT NULL DEFAULT 0,
  sku_count           INTEGER NOT NULL DEFAULT 0,
  warehouse_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_groups      TEXT[] NOT NULL DEFAULT '{}',
  own_brands          TEXT[] NOT NULL DEFAULT '{}',
  services            TEXT[] NOT NULL DEFAULT '{}',
  multi_warehouse     BOOLEAN NOT NULL DEFAULT FALSE,
  company_score       SMALLINT NOT NULL DEFAULT 5 CHECK (company_score BETWEEN 0 AND 10),
  category            TEXT NOT NULL DEFAULT 'C',
  comment             TEXT,
  scoring             JSONB,
  requisites          JSONB,
  multiWarehouse      BOOLEAN NOT NULL DEFAULT FALSE,
  service_search      JSONB NOT NULL DEFAULT '[]'::jsonb,
  service_access      JSONB,
  history             JSONB NOT NULL DEFAULT '[]'::jsonb,
  additional_contacts TEXT,
  additional_comment  TEXT,
  -- v1.30.39: ЭДО — оператор и ключ (колонки)
  edo_operator        TEXT,
  edo_token           TEXT,
  from_api            BOOLEAN NOT NULL DEFAULT FALSE,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_name    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE public.buyers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                TEXT NOT NULL,
  trade_name          TEXT NOT NULL,
  city                TEXT NOT NULL,
  address             TEXT,
  website             TEXT,
  inn                 TEXT,
  contact_role        TEXT,
  contact_name        TEXT NOT NULL,
  phone               TEXT NOT NULL,
  email               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'В работе',
  source              TEXT,
  contact_pref        TEXT,
  contact_prefs       JSONB NOT NULL DEFAULT '[]'::jsonb,
  locations_count     INTEGER NOT NULL DEFAULT 0,
  company_score       SMALLINT NOT NULL DEFAULT 5 CHECK (company_score BETWEEN 0 AND 10),
  category            TEXT NOT NULL DEFAULT 'C',
  comment             TEXT,
  scoring             JSONB,
  requisites          JSONB,
  history             JSONB NOT NULL DEFAULT '[]'::jsonb,
  additional_contacts TEXT,
  additional_comment  TEXT,
  from_api            BOOLEAN NOT NULL DEFAULT FALSE,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_name    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE public.tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL DEFAULT 'none',
  entity_id       UUID,
  entity_name     TEXT,
  title           TEXT NOT NULL,
  description     TEXT,
  due_date        DATE NOT NULL,
  task_status     TEXT NOT NULL DEFAULT 'Новая',
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  history         JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved_at     TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  priority        SMALLINT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 0 AND 5),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL DEFAULT 'Вопрос',
  category        TEXT,
  status          TEXT NOT NULL DEFAULT 'Новая',
  contact_pref    TEXT,
  contact_prefs   JSONB NOT NULL DEFAULT '[]'::jsonb,
  task_id         UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  priority        SMALLINT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 0 AND 5),
  subject         TEXT NOT NULL,
  text            TEXT NOT NULL,
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  entity_type     TEXT,
  entity_id       UUID,
  responsible_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_name TEXT,
  history         JSONB NOT NULL DEFAULT '[]'::jsonb,
  from_api        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE public.media_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  supplier_name       TEXT NOT NULL,
  ad_type_id          TEXT NOT NULL,
  ad_type_name        TEXT NOT NULL,
  duration_option_id  TEXT,
  duration_label      TEXT,
  price_per_month     INTEGER NOT NULL DEFAULT 0 CHECK (price_per_month >= 0),
  total_price         INTEGER NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  status              TEXT NOT NULL,
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL CHECK (end_date >= start_date),
  notes               TEXT,
  expanded_notes      TEXT,
  responsible_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_name    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE public.app_settings (
  id         TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  role       TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.user_access (
  user_id         TEXT PRIMARY KEY,
  supplier_types  TEXT[] NOT NULL DEFAULT '{}',
  supplier_cities TEXT[] NOT NULL DEFAULT '{}',
  buyer_types     TEXT[] NOT NULL DEFAULT '{}',
  buyer_cities    TEXT[] NOT NULL DEFAULT '{}',
  ticket_types    TEXT[] NOT NULL DEFAULT '{}',
  plan_cities     TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE public.app_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level      TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('debug','info','warn','error')),
  message    TEXT NOT NULL CHECK (length(message) <= 10000),
  stack      TEXT,
  page       TEXT,
  user_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_suppliers_status ON public.suppliers(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_suppliers_city ON public.suppliers(city) WHERE deleted_at IS NULL;
CREATE INDEX idx_suppliers_inn ON public.suppliers(inn) WHERE deleted_at IS NULL;
CREATE INDEX idx_suppliers_type_city_active ON public.suppliers(type, city) WHERE deleted_at IS NULL;
CREATE INDEX idx_suppliers_responsible ON public.suppliers(responsible_id) WHERE deleted_at IS NULL;

CREATE INDEX idx_buyers_status ON public.buyers(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_buyers_city ON public.buyers(city) WHERE deleted_at IS NULL;
CREATE INDEX idx_buyers_type_city_active ON public.buyers(type, city) WHERE deleted_at IS NULL;
CREATE INDEX idx_buyers_responsible ON public.buyers(responsible_id) WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_status ON public.tasks(task_status);
CREATE INDEX idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX idx_tasks_entity ON public.tasks(entity_type, entity_id);

CREATE INDEX idx_tickets_status ON public.tickets(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tickets_type_active ON public.tickets(type) WHERE deleted_at IS NULL;
CREATE INDEX idx_tickets_task_id ON public.tickets(task_id);

CREATE INDEX idx_media_status ON public.media_records(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_supplier ON public.media_records(supplier_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_end_date ON public.media_records(end_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_app_logs_created ON public.app_logs(created_at DESC);
CREATE INDEX idx_profiles_email ON public.profiles(email);

-- ============================================================
-- COMMON FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_employee()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, auth
AS $$
  SELECT COALESCE((
    SELECT bool_or(COALESCE(u->>'status', 'active') = 'active')
    FROM public.app_settings s,
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(s.settings->'users') = 'array'
                THEN s.settings->'users' ELSE '[]'::jsonb END
         ) u
    WHERE s.id = 'global'
      AND (
        u->>'id' = auth.uid()::text
        OR (
          u->>'email' IS NOT NULL
          AND u->>'email' = (SELECT email FROM public.profiles WHERE id = auth.uid())
        )
      )
  ), is_admin());
$$;

CREATE OR REPLACE FUNCTION public.has_section_permission(p_section TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, auth
AS $$
  SELECT COALESCE(bool_or(COALESCE((u->'permissions'->p_section)::boolean, false)), false)
  FROM public.app_settings s,
       jsonb_array_elements(
         CASE WHEN jsonb_typeof(s.settings->'users') = 'array'
              THEN s.settings->'users' ELSE '[]'::jsonb END
       ) u
  WHERE s.id = 'global'
    AND (
      u->>'id' = auth.uid()::text
      OR (
        u->>'email' IS NOT NULL
        AND u->>'email' = (SELECT email FROM public.profiles WHERE id = auth.uid())
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.access_supplier_types()
RETURNS TEXT[] LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public, auth
AS $$ SELECT COALESCE((SELECT supplier_types FROM public.user_access WHERE user_id = auth.uid()::text), '{}') $$;

CREATE OR REPLACE FUNCTION public.access_supplier_cities()
RETURNS TEXT[] LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public, auth
AS $$ SELECT COALESCE((SELECT supplier_cities FROM public.user_access WHERE user_id = auth.uid()::text), '{}') $$;

CREATE OR REPLACE FUNCTION public.access_buyer_types()
RETURNS TEXT[] LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public, auth
AS $$ SELECT COALESCE((SELECT buyer_types FROM public.user_access WHERE user_id = auth.uid()::text), '{}') $$;

CREATE OR REPLACE FUNCTION public.access_buyer_cities()
RETURNS TEXT[] LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public, auth
AS $$ SELECT COALESCE((SELECT buyer_cities FROM public.user_access WHERE user_id = auth.uid()::text), '{}') $$;

CREATE OR REPLACE FUNCTION public.access_ticket_types()
RETURNS TEXT[] LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public, auth
AS $$ SELECT COALESCE((SELECT ticket_types FROM public.user_access WHERE user_id = auth.uid()::text), '{}') $$;

-- ============================================================
-- AUTH / SETTINGS SYNCHRONIZATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, COALESCE(NEW.email, ''), 'manager')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_app_settings_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.settings IS NULL THEN
    NEW.settings := '{}'::jsonb;
  END IF;

  IF NOT is_admin() THEN
    NEW.settings := jsonb_set(
      NEW.settings,
      '{users}',
      COALESCE(OLD.settings -> 'users', '[]'::jsonb)
    );
    NEW.settings := jsonb_set(
      NEW.settings,
      '{dbLogs}',
      COALESCE(OLD.settings -> 'dbLogs', '[]'::jsonb)
    );
    NEW.settings := jsonb_set(
      NEW.settings,
      '{forms}',
      COALESCE(OLD.settings -> 'forms', '[]'::jsonb)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_user_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.settings ? 'users' THEN
    IF jsonb_typeof(NEW.settings->'users') <> 'array' THEN
      RAISE EXCEPTION 'settings.users должен быть JSON-массивом — синхронизация прав отклонена';
    END IF;

    UPDATE public.profiles AS p
    SET role = u->>'role'
    FROM jsonb_array_elements(NEW.settings->'users') AS u
    WHERE u->>'id' IS NOT NULL
      AND u->>'id' <> ''
      AND (p.id::text = u->>'id' OR p.email = u->>'email')
      AND p.role IS DISTINCT FROM u->>'role'
      AND u->>'role' IN ('admin', 'manager');

    DELETE FROM public.user_access;

    INSERT INTO public.user_access (
      user_id, supplier_types, supplier_cities,
      buyer_types, buyer_cities, ticket_types, plan_cities
    )
    SELECT
      u->>'id',
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(u->'access'->'supplierTypes')), '{}'),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(u->'access'->'supplierCities')), '{}'),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(u->'access'->'buyerTypes')), '{}'),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(u->'access'->'buyerCities')), '{}'),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(u->'access'->'ticketTypes')), '{}'),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(u->'access'->'planCities')), '{}')
    FROM jsonb_array_elements(NEW.settings->'users') AS u
    WHERE NULLIF(u->>'id', '') IS NOT NULL
      AND u->>'role' = 'manager'
      AND COALESCE(u->>'status', 'active') = 'active'
    ON CONFLICT (user_id) DO UPDATE SET
      supplier_types = EXCLUDED.supplier_types,
      supplier_cities = EXCLUDED.supplier_cities,
      buyer_types = EXCLUDED.buyer_types,
      buyer_cities = EXCLUDED.buyer_cities,
      ticket_types = EXCLUDED.ticket_types,
      plan_cities = EXCLUDED.plan_cities;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_settings_not_null_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.settings IS NULL THEN
    NEW.settings := '{}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_buyers_updated_at BEFORE UPDATE ON public.buyers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_tickets_updated_at BEFORE UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_media_updated_at BEFORE UPDATE ON public.media_records
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE TRIGGER trg_guard_app_settings
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_app_settings_update();

CREATE TRIGGER trg_sync_user_access
AFTER INSERT OR UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.sync_user_access();

CREATE TRIGGER app_settings_not_null_trigger
BEFORE INSERT OR UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.app_settings_not_null_guard();

-- ============================================================
-- INITIAL SETTINGS ROW
-- ============================================================

INSERT INTO public.app_settings (id, settings)
VALUES ('global', '{}'::jsonb);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile" ON public.profiles
FOR SELECT TO authenticated
USING (id = auth.uid() OR is_admin());

CREATE POLICY "Users read own access" ON public.user_access
FOR SELECT TO authenticated
USING (is_admin() OR user_id = auth.uid()::text);

CREATE POLICY "Read suppliers by access" ON public.suppliers
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND is_active_employee()
  AND (
    is_admin()
    OR (
      has_section_permission('suppliers')
      AND (cardinality(access_supplier_types()) = 0 OR type = ANY(access_supplier_types()))
      AND (cardinality(access_supplier_cities()) = 0 OR city = ANY(access_supplier_cities()))
    )
  )
);

CREATE POLICY "Read buyers by access" ON public.buyers
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND is_active_employee()
  AND (
    is_admin()
    OR (
      has_section_permission('buyers')
      AND (cardinality(access_buyer_types()) = 0 OR type = ANY(access_buyer_types()))
      AND (cardinality(access_buyer_cities()) = 0 OR city = ANY(access_buyer_cities()))
    )
  )
);

CREATE POLICY "Read tasks by access" ON public.tasks
FOR SELECT TO authenticated
USING (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR has_section_permission('tasks')));

CREATE POLICY "Read tickets by access" ON public.tickets
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND is_active_employee()
  AND (
    is_admin()
    OR (
      has_section_permission('support')
      AND (cardinality(access_ticket_types()) = 0 OR type = ANY(access_ticket_types()))
    )
  )
);

CREATE POLICY "Read media by access" ON public.media_records
FOR SELECT TO authenticated
USING (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR has_section_permission('media')));

CREATE POLICY "Active employees read settings" ON public.app_settings
FOR SELECT TO authenticated
USING (is_active_employee());

CREATE POLICY "Authenticated insert suppliers" ON public.suppliers
FOR INSERT TO authenticated
WITH CHECK (
  is_active_employee()
  AND (is_admin() OR has_section_permission('suppliers'))
  AND created_by = auth.uid()
);

CREATE POLICY "Authenticated insert buyers" ON public.buyers
FOR INSERT TO authenticated
WITH CHECK (
  is_active_employee()
  AND (is_admin() OR has_section_permission('buyers'))
  AND created_by = auth.uid()
);

CREATE POLICY "Authenticated insert tasks" ON public.tasks
FOR INSERT TO authenticated
WITH CHECK (is_active_employee() AND (is_admin() OR has_section_permission('tasks')));

CREATE POLICY "Authenticated insert tickets" ON public.tickets
FOR INSERT TO authenticated
WITH CHECK (is_active_employee() AND (is_admin() OR has_section_permission('support')));

CREATE POLICY "Authenticated insert media" ON public.media_records
FOR INSERT TO authenticated
WITH CHECK (is_active_employee() AND (is_admin() OR has_section_permission('media')));

CREATE POLICY "Authorized update suppliers" ON public.suppliers
FOR UPDATE TO authenticated
USING (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('suppliers') AND (cardinality(access_supplier_types()) = 0 OR type = ANY(access_supplier_types())) AND (cardinality(access_supplier_cities()) = 0 OR city = ANY(access_supplier_cities())))))
WITH CHECK (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('suppliers') AND (cardinality(access_supplier_types()) = 0 OR type = ANY(access_supplier_types())) AND (cardinality(access_supplier_cities()) = 0 OR city = ANY(access_supplier_cities())))));

CREATE POLICY "Authorized update buyers" ON public.buyers
FOR UPDATE TO authenticated
USING (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('buyers') AND (cardinality(access_buyer_types()) = 0 OR type = ANY(access_buyer_types())) AND (cardinality(access_buyer_cities()) = 0 OR city = ANY(access_buyer_cities())))))
WITH CHECK (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('buyers') AND (cardinality(access_buyer_types()) = 0 OR type = ANY(access_buyer_types())) AND (cardinality(access_buyer_cities()) = 0 OR city = ANY(access_buyer_cities())))));

CREATE POLICY "Authorized update tasks" ON public.tasks
FOR UPDATE TO authenticated
USING (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('tasks'))))
WITH CHECK (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('tasks'))));

CREATE POLICY "Authorized update tickets" ON public.tickets
FOR UPDATE TO authenticated
USING (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('support') AND (cardinality(access_ticket_types()) = 0 OR type = ANY(access_ticket_types())))))
WITH CHECK (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('support') AND (cardinality(access_ticket_types()) = 0 OR type = ANY(access_ticket_types())))));

CREATE POLICY "Authorized update media_records" ON public.media_records
FOR UPDATE TO authenticated
USING (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('media'))))
WITH CHECK (deleted_at IS NULL AND is_active_employee() AND (is_admin() OR (has_section_permission('media'))));

CREATE POLICY "Admin update settings" ON public.app_settings
FOR UPDATE TO authenticated
USING (is_active_employee() AND is_admin() AND id = 'global')
WITH CHECK (is_active_employee() AND is_admin() AND id = 'global');

CREATE POLICY "Admin insert settings" ON public.app_settings
FOR INSERT TO authenticated
WITH CHECK (is_active_employee() AND is_admin() AND id = 'global');

CREATE POLICY "Admin delete suppliers" ON public.suppliers
FOR DELETE TO authenticated
USING (is_active_employee() AND is_admin());
CREATE POLICY "Admin delete buyers" ON public.buyers
FOR DELETE TO authenticated
USING (is_active_employee() AND is_admin());
CREATE POLICY "Admin delete tasks" ON public.tasks
FOR DELETE TO authenticated
USING (is_active_employee() AND is_admin());
CREATE POLICY "Admin delete tickets" ON public.tickets
FOR DELETE TO authenticated
USING (is_active_employee() AND is_admin());
CREATE POLICY "Admin delete media" ON public.media_records
FOR DELETE TO authenticated
USING (is_active_employee() AND is_admin());

CREATE POLICY "Authenticated insert app_logs" ON public.app_logs
FOR INSERT TO authenticated
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Admin read app_logs" ON public.app_logs
FOR SELECT TO authenticated
USING (is_admin());

-- ============================================================
-- STORAGE: KNOWLEDGE BASE
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge', 'knowledge', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- v1.30.0: публичный бакет для ассетов ЛК поставщика (баннер дашборда, аватары операторов) —
-- читается анонимно (ЛК без авторизации), пишут только авторизованные пользователи CRM.
INSERT INTO storage.buckets (id, name, public)
VALUES ('lk-assets', 'lk-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read lk-assets" ON storage.objects
FOR SELECT TO anon, authenticated
USING (bucket_id = 'lk-assets');

CREATE POLICY "Auth upload lk-assets" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'lk-assets');

CREATE POLICY "Auth update lk-assets" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'lk-assets')
WITH CHECK (bucket_id = 'lk-assets');

CREATE POLICY "Auth delete lk-assets" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'lk-assets');

CREATE POLICY "Active employees read knowledge files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'knowledge' AND is_active_employee());
CREATE POLICY "Authenticated upload to knowledge" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'knowledge' AND is_active_employee());

CREATE POLICY "Active employees update knowledge files" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'knowledge' AND is_active_employee())
WITH CHECK (bucket_id = 'knowledge' AND is_active_employee());

CREATE POLICY "Admin delete knowledge files" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'knowledge' AND is_active_employee() AND is_admin());

-- ============================================================
-- REALTIME
-- ============================================================

ALTER TABLE public.suppliers REPLICA IDENTITY FULL;
ALTER TABLE public.buyers REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.tickets REPLICA IDENTITY FULL;
ALTER TABLE public.media_records REPLICA IDENTITY FULL;
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;

DO $$
DECLARE
  t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['suppliers','buyers','tasks','tickets','media_records','app_settings'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ============================================================
-- FUNCTION EXECUTION PRIVILEGES
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_active_employee() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_employee() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_section_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_section_permission(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.access_supplier_types() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.access_supplier_types() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.access_supplier_cities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.access_supplier_cities() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.access_buyer_types() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.access_buyer_types() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.access_buyer_cities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.access_buyer_cities() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.access_ticket_types() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.access_ticket_types() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_access() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_app_settings_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_settings_not_null_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;

-- Explicit table privileges for the Data API role used by the frontend.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.suppliers,
  public.buyers,
  public.tasks,
  public.tickets,
  public.media_records,
  public.app_settings,
  public.app_logs
TO authenticated;

-- ============================================================
-- END
-- ============================================================
