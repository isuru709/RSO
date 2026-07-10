-- ============================================================================
-- RSO Platform — Combined Database Migration
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor to set up the entire database.
-- This file matches the ACTUAL Supabase schema exactly.
-- ============================================================================


-- ============================================================================
-- 00001: Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ============================================================================
-- 00002: JWT Claim Helper Functions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_firebase_uid()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT auth.jwt() ->> 'sub';
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT auth.jwt() ->> 'app_role';
$$;

CREATE OR REPLACE FUNCTION public.is_main_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.current_app_role() = 'main_admin';
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.current_app_role() IN ('tenant_admin', 'main_admin');
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ============================================================================
-- 00003: Tenants (Faculties / Departments)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  contact_email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenants_select_all"
    ON public.tenants FOR SELECT TO authenticated USING (true);
CREATE POLICY "tenants_insert_admin"
    ON public.tenants FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.is_main_admin()));
CREATE POLICY "tenants_update_admin"
    ON public.tenants FOR UPDATE TO authenticated
    USING ((SELECT public.is_main_admin()));
CREATE POLICY "tenants_delete_admin"
    ON public.tenants FOR DELETE TO authenticated
    USING ((SELECT public.is_main_admin()));


-- ============================================================================
-- 00004: User Profiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  firebase_uid TEXT NOT NULL PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id),
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'student'
    CHECK (role IN ('main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer', 'staff', 'student')),
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  member_id TEXT,

  CONSTRAINT user_profiles_tenant_required CHECK (
    role = 'main_admin' OR tenant_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_up_firebase_uid ON public.user_profiles(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_up_tenant ON public.user_profiles(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_member_id
  ON public.user_profiles (tenant_id, member_id) WHERE member_id IS NOT NULL;

CREATE TRIGGER set_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_all"
    ON public.user_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_own"
    ON public.user_profiles FOR INSERT TO authenticated
    WITH CHECK (firebase_uid = (SELECT public.current_firebase_uid()));
CREATE POLICY "profiles_update_own_or_admin"
    ON public.user_profiles FOR UPDATE TO authenticated
    USING (
        firebase_uid = (SELECT public.current_firebase_uid())
        OR (SELECT public.is_tenant_admin())
    );


-- ============================================================================
-- 00005: Resources
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.resources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id),
  name TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  category TEXT,
  capacity INTEGER,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'maintenance', 'retired')),
  equipment_features JSONB NOT NULL DEFAULT '[]',
  hourly_cost NUMERIC(10,2) DEFAULT 0,
  image_url TEXT,
  is_bookable BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  allowed_roles TEXT[]
);

ALTER TABLE public.resources DROP CONSTRAINT IF EXISTS resources_category_check;
ALTER TABLE public.resources ADD CONSTRAINT resources_category_check CHECK (
    category IN ('HALL', 'LAB', 'EQUIPMENT')
);

CREATE INDEX IF NOT EXISTS idx_resources_tenant ON public.resources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_resources_type ON public.resources(resource_type);

CREATE TRIGGER set_resources_updated_at
  BEFORE UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resources_select_own_tenant"
    ON public.resources FOR SELECT TO authenticated
    USING (
        tenant_id = (SELECT public.current_tenant_id())
        OR tenant_id IS NULL
        OR (SELECT public.is_main_admin())
    );
CREATE POLICY "resources_insert_admin"
    ON public.resources FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.is_tenant_admin()));
CREATE POLICY "resources_insert_main_admin"
    ON public.resources FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.is_main_admin()));
CREATE POLICY "resources_update_admin"
    ON public.resources FOR UPDATE TO authenticated
    USING ((SELECT public.is_tenant_admin()));
CREATE POLICY "resources_update_main_admin"
    ON public.resources FOR UPDATE TO authenticated
    USING ((SELECT public.is_main_admin()))
    WITH CHECK ((SELECT public.is_main_admin()));
CREATE POLICY "resources_delete_admin"
    ON public.resources FOR DELETE TO authenticated
    USING ((SELECT public.is_tenant_admin()));
CREATE POLICY "resources_delete_main_admin"
    ON public.resources FOR DELETE TO authenticated
    USING ((SELECT public.is_main_admin()));


-- ============================================================================
-- 00006: Bookings
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id),
  resource_id UUID NOT NULL REFERENCES public.resources(id),
  booked_by TEXT NOT NULL,
  title TEXT NOT NULL,
  purpose TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'bumped', 'completed', 'cancelled', 'active')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  recurrence_rule TEXT,
  parent_booking_id UUID,
  attendee_count INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bookings_time_check CHECK (end_time > start_time),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status IN ('pending', 'approved', 'active'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_resource ON public.bookings(resource_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON public.bookings(booked_by);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant ON public.bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_time ON public.bookings(start_time, end_time);

CREATE TRIGGER set_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings_select_own_tenant"
    ON public.bookings FOR SELECT TO authenticated
    USING (
        tenant_id = (SELECT public.current_tenant_id())
        OR booked_by = (SELECT public.current_firebase_uid())
        OR (SELECT public.is_main_admin())
    );
CREATE POLICY "bookings_insert_own_tenant"
    ON public.bookings FOR INSERT TO authenticated
    WITH CHECK (
        booked_by = (SELECT public.current_firebase_uid())
        AND EXISTS (
            SELECT 1 FROM public.resources r
            WHERE r.id = resource_id
              AND (r.tenant_id = (SELECT public.current_tenant_id()) OR r.tenant_id IS NULL)
        )
    );
CREATE POLICY "bookings_update_own_or_admin"
    ON public.bookings FOR UPDATE TO authenticated
    USING (
        booked_by = (SELECT public.current_firebase_uid())
        OR (SELECT public.is_tenant_admin())
    );
CREATE POLICY "bookings_delete_admin"
    ON public.bookings FOR DELETE TO authenticated
    USING ((SELECT public.is_tenant_admin()));


-- ============================================================================
-- 00007: Optimization Logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.optimization_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  resource_id UUID,
  related_booking_id UUID,
  log_type TEXT NOT NULL,
  utilization_rate NUMERIC,
  severity TEXT NOT NULL DEFAULT 'info',
  details JSONB NOT NULL DEFAULT '{}',
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opt_logs_tenant ON public.optimization_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opt_logs_booking ON public.optimization_logs(related_booking_id);

ALTER TABLE public.optimization_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opt_logs_select_admin"
    ON public.optimization_logs FOR SELECT TO authenticated
    USING (
        tenant_id = (SELECT public.current_tenant_id())
        OR (SELECT public.is_main_admin())
    );
CREATE POLICY "opt_logs_insert_service"
    ON public.optimization_logs FOR INSERT TO authenticated
    WITH CHECK (true);


-- ============================================================================
-- 00008: Notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  recipient TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifs_user ON public.notifications(recipient);
CREATE INDEX IF NOT EXISTS idx_notifs_tenant ON public.notifications(tenant_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifs_select_own"
    ON public.notifications FOR SELECT TO authenticated
    USING (recipient = (SELECT public.current_firebase_uid()));
CREATE POLICY "notifs_insert_service"
    ON public.notifications FOR INSERT TO authenticated
    WITH CHECK (true);
CREATE POLICY "notifs_update_own"
    ON public.notifications FOR UPDATE TO authenticated
    USING (recipient = (SELECT public.current_firebase_uid()));


-- ============================================================================
-- 00009: Student Token System
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.student_token_balances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  tenant_id UUID REFERENCES public.tenants(id),
  balance INTEGER NOT NULL DEFAULT 100,
  monthly_quota INTEGER NOT NULL DEFAULT 100,
  last_renewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_balances_uid ON public.student_token_balances(firebase_uid);

CREATE TRIGGER set_token_balances_updated_at
  BEFORE UPDATE ON public.student_token_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.token_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('monthly_renewal', 'booking_deduction', 'booking_refund', 'admin_adjustment')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_transactions_uid ON public.token_transactions(firebase_uid, created_at DESC);

-- Backfill: Create token balances for existing students
INSERT INTO public.student_token_balances (firebase_uid, tenant_id, balance, monthly_quota)
SELECT up.firebase_uid, up.tenant_id, 100, 100
FROM public.user_profiles up
WHERE up.role = 'student'
  AND NOT EXISTS (
    SELECT 1 FROM public.student_token_balances stb WHERE stb.firebase_uid = up.firebase_uid
  );


-- ============================================================================
-- 00010: ST Resources (Student Shared Resources)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.st_resources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  item_type TEXT NOT NULL DEFAULT 'other',
  condition TEXT DEFAULT 'good',
  pickup_location TEXT,
  hourly_token_cost INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  created_by TEXT NOT NULL REFERENCES user_profiles(firebase_uid) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_st_resources_created_by ON public.st_resources(created_by);
CREATE INDEX IF NOT EXISTS idx_st_resources_available ON public.st_resources(is_available);

CREATE TRIGGER set_st_resources_updated_at
  BEFORE UPDATE ON public.st_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.st_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "st_resources_select_all"
    ON public.st_resources FOR SELECT TO authenticated USING (true);
CREATE POLICY "st_resources_insert_student"
    ON public.st_resources FOR INSERT TO authenticated
    WITH CHECK (created_by = (SELECT public.current_firebase_uid()));
CREATE POLICY "st_resources_update_owner_or_admin"
    ON public.st_resources FOR UPDATE TO authenticated
    USING (
        created_by = (SELECT public.current_firebase_uid())
        OR (SELECT public.is_tenant_admin())
        OR public.current_app_role() IN ('lecturer', 'junior_lecturer')
    );
CREATE POLICY "st_resources_delete_owner_or_admin"
    ON public.st_resources FOR DELETE TO authenticated
    USING (
        created_by = (SELECT public.current_firebase_uid())
        OR (SELECT public.is_tenant_admin())
        OR public.current_app_role() IN ('lecturer', 'junior_lecturer')
    );

ALTER TABLE st_resources ADD COLUMN IF NOT EXISTS image_url TEXT;