-- ============================================================================
-- Migration 00001: Extensions
-- ============================================================================
-- pgcrypto: gen_random_uuid() for primary keys
-- btree_gist: required for the EXCLUDE constraint that prevents double-booking
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;
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
-- ============================================================================
-- Migration 00003: Tenants Table
-- ============================================================================
-- One row per faculty/department/college. This is the root of the
-- multi-tenancy model â€” every other tenant-scoped table carries a
-- tenant_id foreign key back to this table.
-- ============================================================================

create table public.tenants (
    id              uuid primary key default gen_random_uuid(),
    name            text not null,
    code            text not null,                 -- short code, e.g. 'FOC', 'FOE'
    slug            text not null,                  -- url-safe identifier
    description     text,
    contact_email   text,
    is_active       boolean not null default true,
    settings        jsonb not null default '{}'::jsonb,  -- e.g. working hours, booking lead-time rules
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint tenants_code_unique unique (code),
    constraint tenants_slug_unique unique (slug)
);

comment on table public.tenants is
  'Root tenant entity (a university faculty/department). All other domain tables are scoped to a tenant_id to guarantee data isolation between faculties.';

create trigger trg_tenants_updated_at
    before update on public.tenants
    for each row execute function public.set_updated_at();
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
  'Matches the "sub" claim of the Firebase ID token. Intentionally TEXT, not uuid â€” Firebase UIDs are not UUID-formatted.';

create index idx_user_profiles_tenant_id on public.user_profiles (tenant_id);
create index idx_user_profiles_role on public.user_profiles (role);

create trigger trg_user_profiles_updated_at
    before update on public.user_profiles
    for each row execute function public.set_updated_at();
-- ============================================================================
-- Migration 00005: Resources Table
-- ============================================================================
-- Bookable physical assets: lecture halls, labs, projectors, etc. Owned by
-- exactly one tenant.
-- ============================================================================

create table public.resources (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references public.tenants(id) on delete restrict,
    name                text not null,
    resource_type       text not null,
    category            text,
    capacity            integer,
    location            text,                       -- building / floor / room number
    status              text not null default 'available',
    equipment_features  jsonb not null default '{}'::jsonb,  -- e.g. {"projector": true, "ac": true}
    hourly_cost         numeric(10, 2),
    image_url           text,
    is_bookable         boolean not null default true,
    created_by          text references public.user_profiles(firebase_uid) on delete set null,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint resources_type_check check (
        resource_type in ('lecture_hall', 'lab', 'equipment', 'meeting_room', 'other')
    ),
    constraint resources_status_check check (
        status in ('available', 'maintenance', 'retired', 'reserved')
    ),
    constraint resources_capacity_positive check (capacity is null or capacity > 0)
);

comment on table public.resources is
  'Bookable assets owned by a single tenant. status drives bookability independently of is_bookable (e.g. a hall can be temporarily "maintenance" without changing its long-term booking policy).';

create index idx_resources_tenant_id on public.resources (tenant_id);
create index idx_resources_tenant_status on public.resources (tenant_id, status);
create index idx_resources_type on public.resources (resource_type);

create trigger trg_resources_updated_at
    before update on public.resources
    for each row execute function public.set_updated_at();
-- ============================================================================
-- Migration 00006: Bookings Table
-- ============================================================================
-- Reservations against a resource. tenant_id is intentionally DENORMALIZED
-- onto this table for RLS/index performance. The sync_booking_tenant()
-- trigger always recomputes tenant_id server-side from the resource.
--
-- The bookings_no_overlap EXCLUDE constraint is the source of truth for
-- conflict prevention â€” the optimization engine should treat a 23P01
-- (exclusion_violation) error as "slot unavailable" and respond with 409.
-- ============================================================================

create table public.bookings (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references public.tenants(id) on delete restrict,
    resource_id         uuid not null references public.resources(id) on delete restrict,
    booked_by           text not null references public.user_profiles(firebase_uid) on delete restrict,
    title               text not null,
    purpose             text,
    start_time          timestamptz not null,
    end_time            timestamptz not null,
    status              text not null default 'pending',
    approved_by         text references public.user_profiles(firebase_uid) on delete set null,
    approved_at         timestamptz,
    recurrence_rule     text,                       -- iCal RRULE string for recurring bookings
    parent_booking_id   uuid references public.bookings(id) on delete cascade,
    attendee_count      integer,
    notes               text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint bookings_status_check check (
        status in ('pending', 'approved', 'rejected', 'cancelled', 'completed')
    ),
    constraint bookings_time_order_check check (end_time > start_time),
    constraint bookings_attendee_positive check (attendee_count is null or attendee_count >= 0),

    -- ------------------------------------------------------------------
    -- DOUBLE-BOOKING PREVENTION (the core "optimization" guarantee)
    -- ------------------------------------------------------------------
    -- Postgres itself guarantees no two PENDING or APPROVED bookings for
    -- the same resource can have overlapping time ranges. This is atomic
    -- and race-condition-proof even under concurrent requests.
    constraint bookings_no_overlap exclude using gist (
        resource_id with =,
        tstzrange(start_time, end_time, '[)') with &&
    ) where (status in ('pending', 'approved'))
);

comment on table public.bookings is
  'Reservations against a resource. The bookings_no_overlap EXCLUDE constraint is the source of truth for conflict prevention â€” the optimization engine should treat a 23P01 (exclusion_violation) error as "slot unavailable" and respond accordingly.';
comment on column public.bookings.tenant_id is
  'Denormalized from resources.tenant_id for RLS/index performance. Always kept in sync by trg_sync_booking_tenant â€” never trust a client-supplied value for this column.';

create index idx_bookings_tenant_id on public.bookings (tenant_id);
create index idx_bookings_resource_id on public.bookings (resource_id);
create index idx_bookings_booked_by on public.bookings (booked_by);
create index idx_bookings_tenant_time on public.bookings (tenant_id, start_time, end_time);
create index idx_bookings_status on public.bookings (status);

create trigger trg_bookings_updated_at
    before update on public.bookings
    for each row execute function public.set_updated_at();

-- Server-side enforcement: bookings.tenant_id is ALWAYS derived from the
-- resource being booked, never trusted from client input.
create or replace function public.sync_booking_tenant()
returns trigger
language plpgsql
as $$
begin
    select tenant_id into new.tenant_id
    from public.resources
    where id = new.resource_id;

    if new.tenant_id is null then
        raise exception 'Resource % does not exist', new.resource_id;
    end if;

    return new;
end;
$$;

create trigger trg_sync_booking_tenant
    before insert or update of resource_id on public.bookings
    for each row execute function public.sync_booking_tenant();
-- ============================================================================
-- Migration 00007: Optimization Logs Table
-- ============================================================================
-- Output of the Booking & Optimization Engine's analysis jobs: under-
-- utilized resources, automatically resolved double-booking attempts,
-- nightly utilization scans, etc.
-- Written exclusively by the backend service (service_role key).
-- ============================================================================

create table public.optimization_logs (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references public.tenants(id) on delete cascade,
    resource_id         uuid references public.resources(id) on delete set null,
    related_booking_id  uuid references public.bookings(id) on delete set null,
    log_type            text not null,
    utilization_rate    numeric(5, 2),              -- percentage, e.g. 37.50
    severity            text not null default 'info',
    details             jsonb not null default '{}'::jsonb,
    resolved            boolean not null default false,
    resolved_at         timestamptz,
    created_at          timestamptz not null default now(),

    constraint optimization_logs_type_check check (
        log_type in (
            'underutilization', 'double_booking_resolved',
            'auto_cancelled', 'utilization_report', 'conflict_detected'
        )
    ),
    constraint optimization_logs_severity_check check (
        severity in ('info', 'warning', 'critical')
    )
);

comment on table public.optimization_logs is
  'Operational intelligence trail from the optimization engine. Visible only to tenant_admin/super_admin via RLS â€” this is internal analytics, not user-facing data.';

create index idx_optimization_logs_tenant_id on public.optimization_logs (tenant_id);
create index idx_optimization_logs_resource_id on public.optimization_logs (resource_id);
create index idx_optimization_logs_type on public.optimization_logs (log_type);
create index idx_optimization_logs_created_at on public.optimization_logs (created_at desc);
-- ============================================================================
-- Migration 00008: Notifications Table
-- ============================================================================
-- Persisted record of notifications dispatched by the Notification Service.
-- This is the in-app inbox + audit trail.
-- ============================================================================

create table public.notifications (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    recipient       text not null references public.user_profiles(firebase_uid) on delete cascade,
    type            text not null,
    title           text not null,
    body            text,
    payload         jsonb not null default '{}'::jsonb,
    is_read         boolean not null default false,
    created_at      timestamptz not null default now()
);

comment on table public.notifications is
  'In-app notification inbox, written by the Notification Service after consuming events from the message broker.';

create index idx_notifications_recipient_unread on public.notifications (recipient, is_read);
create index idx_notifications_tenant_id on public.notifications (tenant_id);
-- Add 'active' to bookings status check constraint
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check 
    CHECK (status IN ('pending', 'approved', 'active', 'rejected', 'cancelled', 'completed'));

-- Also update the exclude constraint to include 'active' status
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap 
    EXCLUDE USING gist (
        resource_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
    ) WHERE (status IN ('pending', 'approved', 'active'));
-- ============================================================================
-- Migration 00009: Row Level Security Policies
-- ============================================================================
-- DEFENSE IN DEPTH: Microservices connect using the Supabase service_role
-- key (which bypasses RLS) and enforce tenant scoping in application code.
-- RLS policies here act as a second, independent layer â€” if a service ever
-- queries with a forwarded user JWT (e.g. for direct client reads via
-- PostgREST), tenant isolation is enforced at the database level.
-- ============================================================================


-- Enable RLS on all tables
alter table public.tenants            enable row level security;
alter table public.user_profiles      enable row level security;
alter table public.resources          enable row level security;
alter table public.bookings           enable row level security;
alter table public.optimization_logs  enable row level security;
alter table public.notifications      enable row level security;


-- ============================================================================
-- 9.1 tenants
-- A user may read their own faculty's record. Faculty creation/editing is
-- handled by the Tenant Service via service_role (which bypasses RLS).
-- ============================================================================
create policy "tenants_select_own_or_super_admin"
    on public.tenants
    for select
    to authenticated
    using (
        id = (select public.current_tenant_id())
        or (select public.is_super_admin())
    );


-- ============================================================================
-- 9.2 user_profiles
-- Visibility: a user always sees their own profile; tenant_admins/super_admins
-- additionally see every profile within their own tenant.
-- ============================================================================
create policy "user_profiles_select_self_or_tenant_admin"
    on public.user_profiles
    for select
    to authenticated
    using (
        firebase_uid = (select public.current_firebase_uid())
        or (
            (select public.is_tenant_admin())
            and tenant_id = (select public.current_tenant_id())
        )
        or (select public.is_super_admin())
    );

create policy "user_profiles_insert_self"
    on public.user_profiles
    for insert
    to authenticated
    with check (
        firebase_uid = (select public.current_firebase_uid())
        and tenant_id = (select public.current_tenant_id())
    );

create policy "user_profiles_update_self_or_tenant_admin"
    on public.user_profiles
    for update
    to authenticated
    using (
        firebase_uid = (select public.current_firebase_uid())
        or (
            (select public.is_tenant_admin())
            and tenant_id = (select public.current_tenant_id())
        )
    )
    with check (
        tenant_id = (select public.current_tenant_id())
    );

create policy "user_profiles_delete_tenant_admin"
    on public.user_profiles
    for delete
    to authenticated
    using (
        (select public.is_tenant_admin())
        and tenant_id = (select public.current_tenant_id())
    );


-- ============================================================================
-- 9.3 resources
-- THE CORE TENANT-ISOLATION GUARANTEE: every operation is gated on
-- resources.tenant_id matching the caller's tenant_id claim.
-- ============================================================================
create policy "resources_select_own_tenant"
    on public.resources
    for select
    to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        or (select public.is_super_admin())
    );

create policy "resources_insert_tenant_admin"
    on public.resources
    for insert
    to authenticated
    with check (
        tenant_id = (select public.current_tenant_id())
        and (select public.is_tenant_admin())
    );

create policy "resources_update_tenant_admin"
    on public.resources
    for update
    to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and (select public.is_tenant_admin())
    )
    with check (
        tenant_id = (select public.current_tenant_id())
    );

create policy "resources_delete_tenant_admin"
    on public.resources
    for delete
    to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and (select public.is_tenant_admin())
    );


-- ============================================================================
-- 9.4 bookings
-- SELECT is opened to the whole tenant (everyone needs to see the shared
-- calendar). Writes are scoped to the caller's own bookings, with
-- tenant_admins able to approve/reject any booking inside their faculty.
-- ============================================================================
create policy "bookings_select_own_tenant"
    on public.bookings
    for select
    to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        or (select public.is_super_admin())
    );

create policy "bookings_insert_own_tenant"
    on public.bookings
    for insert
    to authenticated
    with check (
        booked_by = (select public.current_firebase_uid())
        and exists (
            select 1 from public.resources r
            where r.id = resource_id
              and r.tenant_id = (select public.current_tenant_id())
        )
    );

create policy "bookings_update_owner_or_tenant_admin"
    on public.bookings
    for update
    to authenticated
    using (
        (
            booked_by = (select public.current_firebase_uid())
            and tenant_id = (select public.current_tenant_id())
        )
        or (
            (select public.is_tenant_admin())
            and tenant_id = (select public.current_tenant_id())
        )
    )
    with check (
        tenant_id = (select public.current_tenant_id())
    );

create policy "bookings_delete_owner_or_tenant_admin"
    on public.bookings
    for delete
    to authenticated
    using (
        (
            booked_by = (select public.current_firebase_uid())
            and tenant_id = (select public.current_tenant_id())
        )
        or (
            (select public.is_tenant_admin())
            and tenant_id = (select public.current_tenant_id())
        )
    );


-- ============================================================================
-- 9.5 optimization_logs
-- Internal analytics â€” only visible to admins of the owning tenant.
-- No INSERT/UPDATE/DELETE policy: only service_role writes these.
-- ============================================================================
create policy "optimization_logs_select_tenant_admin"
    on public.optimization_logs
    for select
    to authenticated
    using (
        (select public.is_tenant_admin())
        and tenant_id = (select public.current_tenant_id())
    );


-- ============================================================================
-- 9.6 notifications
-- A user only sees their own notifications. They may mark as read but
-- cannot edit content. Inserts are service_role-only.
-- ============================================================================
create policy "notifications_select_own"
    on public.notifications
    for select
    to authenticated
    using (recipient = (select public.current_firebase_uid()));

create policy "notifications_update_mark_read_own"
    on public.notifications
    for update
    to authenticated
    using (recipient = (select public.current_firebase_uid()))
    with check (recipient = (select public.current_firebase_uid()));
-- Add member_id column to user_profiles
-- This stores the university member ID (e.g., 230571F, 220553T)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS member_id TEXT;

-- Add unique constraint on member_id (within same tenant)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_member_id
  ON public.user_profiles (tenant_id, member_id)
  WHERE member_id IS NOT NULL;

-- Add description column if missing
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS description TEXT;
-- ============================================================================
-- Migration 00011: Advanced RBAC and Priority Booking Engine
-- ============================================================================

-- 1. Update user_profiles role check to include new roles
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;

-- Migrate existing super_admin to main_admin
UPDATE public.user_profiles SET role = 'main_admin' WHERE role = 'super_admin';

ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_check CHECK (
    role IN ('main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer', 'staff', 'student')
);

-- Update the tenant_required constraint since we renamed super_admin to main_admin
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_tenant_required;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_tenant_required CHECK (
    role = 'main_admin' OR tenant_id IS NOT NULL
);

-- 2. Update resources table
-- We'll rename the existing 'resource_type' column to 'category' for consistency if it exists,
-- but the prompt explicitly said `category` must be HALL, LAB, EQUIPMENT.
-- The existing schema has both `resource_type` and `category`. 
-- Let's drop the old constraint on resource_type, but enforce the new rule on `category`.
ALTER TABLE public.resources DROP CONSTRAINT IF EXISTS resources_type_check;

-- We'll just map any existing resource_type data into the category column if it's null, 
-- and uppercase it to match the enum.
UPDATE public.resources 
SET category = CASE 
    WHEN resource_type = 'lecture_hall' THEN 'HALL'
    WHEN resource_type = 'lab' THEN 'LAB'
    WHEN resource_type = 'equipment' THEN 'EQUIPMENT'
    ELSE 'HALL' 
END
WHERE category IS NULL OR category NOT IN ('HALL', 'LAB', 'EQUIPMENT');

ALTER TABLE public.resources DROP CONSTRAINT IF EXISTS resources_category_check;
ALTER TABLE public.resources ADD CONSTRAINT resources_category_check CHECK (
    category IN ('HALL', 'LAB', 'EQUIPMENT')
);

-- Make tenant_id nullable
ALTER TABLE public.resources ALTER COLUMN tenant_id DROP NOT NULL;

-- Add allowed_roles
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS allowed_roles text[];

-- 3. Update bookings table
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

-- Note: the prompt requested PENDING, APPROVED, REJECTED, BUMPED, COMPLETED.
-- We are keeping lowercase to match Postgres conventions and existing data,
-- plus adding 'active' and 'cancelled' which existed previously.
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK (
    status IN ('pending', 'approved', 'rejected', 'bumped', 'completed', 'cancelled', 'active')
);

-- Allow bookings for global resources (tenant_id can be NULL)
ALTER TABLE public.bookings ALTER COLUMN tenant_id DROP NOT NULL;

-- 4. Modifying the EXCLUDE constraint
-- We need to change `bookings_no_overlap` to NOT exclude `bumped`.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status IN ('pending', 'approved', 'active'));

-- 5. Update JWT Helpers & RLS Policies
-- Rename is_super_admin to is_main_admin
CREATE OR REPLACE FUNCTION public.is_main_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() = 'main_admin';
$$;

-- Update is_tenant_admin to allow main_admin as well
CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() IN ('tenant_admin', 'main_admin');
$$;

-- Update resources SELECT policy: allowed for own tenant or global resources (tenant_id IS NULL)
DROP POLICY IF EXISTS "resources_select_own_tenant" ON public.resources;
CREATE POLICY "resources_select_own_tenant"
    ON public.resources
    FOR SELECT
    TO authenticated
    USING (
        tenant_id = (SELECT public.current_tenant_id())
        OR tenant_id IS NULL
        OR (SELECT public.is_main_admin())
    );

-- Allow main_admin to insert global resources
DROP POLICY IF EXISTS "resources_insert_main_admin" ON public.resources;
CREATE POLICY "resources_insert_main_admin"
    ON public.resources
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT public.is_main_admin())
    );

-- Allow main_admin to update global resources
DROP POLICY IF EXISTS "resources_update_main_admin" ON public.resources;
CREATE POLICY "resources_update_main_admin"
    ON public.resources
    FOR UPDATE
    TO authenticated
    USING (
        (SELECT public.is_main_admin())
    )
    WITH CHECK (
        (SELECT public.is_main_admin())
    );

-- Allow main_admin to delete global resources
DROP POLICY IF EXISTS "resources_delete_main_admin" ON public.resources;
CREATE POLICY "resources_delete_main_admin"
    ON public.resources
    FOR DELETE
    TO authenticated
    USING (
        (SELECT public.is_main_admin())
    );

-- Update bookings INSERT policy to allow booking global resources
DROP POLICY IF EXISTS "bookings_insert_own_tenant" ON public.bookings;
CREATE POLICY "bookings_insert_own_tenant"
    ON public.bookings
    FOR INSERT
    TO authenticated
    WITH CHECK (
        booked_by = (SELECT public.current_firebase_uid())
        AND EXISTS (
            SELECT 1 FROM public.resources r
            WHERE r.id = resource_id
              AND (r.tenant_id = (SELECT public.current_tenant_id()) OR r.tenant_id IS NULL)
        )
    );

