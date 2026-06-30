-- ============================================================================
-- Migration 00002: JWT Claim Helper Functions
-- ============================================================================
-- Centralizing claim extraction means every RLS policy reads claims the
-- same way, and if the claim shape ever changes we edit it in one place.
-- Marked STABLE so the planner can cache results within a single statement.
-- ============================================================================

create or replace function public.current_firebase_uid()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'sub';
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'app_role';
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select public.current_app_role() = 'super_admin';
$$;

create or replace function public.is_tenant_admin()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('tenant_admin', 'super_admin');
$$;

-- Generic updated_at maintenance trigger, reused by every table below.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
