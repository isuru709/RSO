-- ============================================================================
-- Migration 00004: User Profiles Table
-- ============================================================================
-- Mirrors Firebase Auth users into Postgres so we can join business data
-- (role, tenant, bookings) against them. firebase_uid is the JWT "sub"
-- claim and is therefore TEXT, not uuid (Firebase UIDs are ~28-char
-- alphanumeric strings, not UUID-formatted).
-- ============================================================================

create table public.user_profiles (
    firebase_uid    text primary key,
    tenant_id       uuid references public.tenants(id) on delete restrict,
    email           text not null,
    full_name       text,
    phone           text,
    role            text not null default 'student',
    avatar_url      text,
    is_active       boolean not null default true,
    metadata        jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint user_profiles_email_unique unique (email),
    constraint user_profiles_role_check check (
        role in ('super_admin', 'tenant_admin', 'lecturer', 'student', 'staff')
    ),
    -- Every role except super_admin MUST belong to exactly one faculty.
    constraint user_profiles_tenant_required check (
        role = 'super_admin' or tenant_id is not null
    )
);

comment on table public.user_profiles is
  'Application-side mirror of Firebase Auth users. role drives in-app RBAC and must be kept in sync with the app_role custom claim issued on the Firebase JWT.';
comment on column public.user_profiles.firebase_uid is
  'Matches the "sub" claim of the Firebase ID token. Intentionally TEXT, not uuid — Firebase UIDs are not UUID-formatted.';

create index idx_user_profiles_tenant_id on public.user_profiles (tenant_id);
create index idx_user_profiles_role on public.user_profiles (role);

create trigger trg_user_profiles_updated_at
    before update on public.user_profiles
    for each row execute function public.set_updated_at();
