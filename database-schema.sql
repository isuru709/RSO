-- ============================================================================
-- MULTI-TENANT CAMPUS RESOURCE SHARING & OPTIMIZATION PLATFORM
-- Supabase (PostgreSQL) Schema
-- ============================================================================
-- AUTHENTICATION MODEL
-- ----------------------------------------------------------------------------
-- This platform uses FIREBASE AUTH (not Supabase Auth) as the identity
-- provider. To make Supabase's Row Level Security work against Firebase
-- JWTs, the Supabase project must be configured with "Third-Party Auth"
-- pointed at your Firebase project (Dashboard -> Authentication ->
-- Third-Party Auth -> Add Firebase integration). Once configured, Supabase
-- trusts JWTs signed by Firebase and exposes their claims via auth.jwt().
--
-- Two Firebase Auth Custom Claims are REQUIRED on every user (set via the
-- Firebase Admin SDK, typically by the User Profile Service right after
-- signup, or by an onCreate Cloud Function):
--
--   1. role: "authenticated"
--      -> Mandatory. Supabase reads this exact claim to decide which
--         Postgres role (authenticated vs anon) executes the query.
--         Firebase does not set this by default, so YOU must set it.
--
--   2. tenant_id: "<uuid of the user's faculty>"
--      app_role:  "student" | "lecturer" | "tenant_admin" | "super_admin"
--      -> Custom claims used by every RLS policy below to scope data
--         to the caller's faculty and role.
--
-- IMPORTANT GOTCHA: Firebase UIDs are NOT valid UUIDs (they are ~28-char
-- alphanumeric strings). Supabase's built-in auth.uid() helper casts the
-- JWT "sub" claim to ::uuid and will ERROR on Firebase tokens. For this
-- reason every policy below uses auth.jwt() ->> 'sub' (as TEXT) instead
-- of auth.uid(), and user_profiles.firebase_uid is a TEXT primary key,
-- not a uuid.
--
-- DEFENSE IN DEPTH: Microservices connect using the Supabase service_role
-- key (which bypasses RLS) and enforce tenant scoping in application code.
-- RLS policies are still fully defined and enabled here as a second,
-- independent layer — if a service ever queries with a forwarded user JWT
-- instead of the service key (e.g. for direct client reads via PostgREST),
-- tenant isolation is enforced at the database level regardless of any
-- application-layer bug.
-- ============================================================================


-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
-- pgcrypto: gen_random_uuid() for primary keys
-- btree_gist: required for the EXCLUDE constraint that prevents double-booking
create extension if not exists pgcrypto;
create extension if not exists btree_gist;


-- ============================================================================
-- 2. JWT CLAIM HELPER FUNCTIONS
-- ============================================================================
-- Centralizing claim extraction means every RLS policy reads claims the
-- same way, and if the claim shape ever changes we edit it in one place.
-- Marked STABLE (not VOLATILE) so the planner can cache results within a
-- single statement, and wrapped in `select ...` calls inside policies
-- (per Supabase's documented RLS performance guidance) so Postgres
-- evaluates them once per statement instead of once per row.

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
-- 3. TABLE: tenants
-- ----------------------------------------------------------------------------
-- One row per faculty/department/college. This is the root of the
-- multi-tenancy model — every other tenant-scoped table carries a
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
-- 4. TABLE: user_profiles
-- ----------------------------------------------------------------------------
-- Mirrors Firebase Auth users into Postgres so we can join business data
-- (role, tenant, bookings) against them. firebase_uid is the JWT "sub"
-- claim and is therefore TEXT, not uuid (see header note above).
--
-- super_admin is a PLATFORM-level role (e.g. central IT) that is not
-- bound to a single faculty, so tenant_id is nullable for that role only.
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


-- ============================================================================
-- 5. TABLE: resources
-- ----------------------------------------------------------------------------
-- Bookable physical assets: lecture halls, labs, projectors, etc. Owned by
-- exactly one tenant (a faculty cannot share raw resource rows with another
-- faculty — cross-faculty sharing, if ever needed, would be modeled as an
-- explicit "resource_shares" table rather than relaxing this boundary).
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
-- 6. TABLE: bookings
-- ----------------------------------------------------------------------------
-- Reservations against a resource. tenant_id is intentionally DENORMALIZED
-- onto this table (rather than only being reachable via resource_id ->
-- resources.tenant_id) for two reasons:
--   1. Performance: RLS policies and indexes can filter directly on
--      bookings.tenant_id without a join to resources on every row check.
--   2. Security: it lets us write a simple, fast RLS predicate. The risk
--      of denormalization (a client sending a tenant_id that doesn't match
--      the resource's real tenant) is closed by the trigger below, which
--      always recomputes tenant_id server-side from the resource.
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
    -- Instead of relying on application-level locking, Postgres itself
    -- guarantees no two PENDING or APPROVED bookings for the same
    -- resource can have overlapping time ranges. This is atomic and
    -- race-condition-proof even under concurrent requests from the
    -- Booking & Optimization Engine's multiple container replicas.
    -- Cancelled/rejected/completed bookings are excluded so history
    -- doesn't block new reservations.
    constraint bookings_no_overlap exclude using gist (
        resource_id with =,
        tstzrange(start_time, end_time, '[)') with &&
    ) where (status in ('pending', 'approved'))
);

comment on table public.bookings is
  'Reservations against a resource. The bookings_no_overlap EXCLUDE constraint is the source of truth for conflict prevention — the optimization engine should treat a 23P01 (exclusion_violation) error as "slot unavailable" and respond accordingly, rather than re-implementing overlap checks in application code.';
comment on column public.bookings.tenant_id is
  'Denormalized from resources.tenant_id for RLS/index performance. Always kept in sync by trg_sync_booking_tenant — never trust a client-supplied value for this column.';

create index idx_bookings_tenant_id on public.bookings (tenant_id);
create index idx_bookings_resource_id on public.bookings (resource_id);
create index idx_bookings_booked_by on public.bookings (booked_by);
create index idx_bookings_tenant_time on public.bookings (tenant_id, start_time, end_time);
create index idx_bookings_status on public.bookings (status);

create trigger trg_bookings_updated_at
    before update on public.bookings
    for each row execute function public.set_updated_at();

-- Server-side enforcement: bookings.tenant_id is ALWAYS derived from the
-- resource being booked, never trusted from client input. This closes off
-- a potential RLS bypass where a malicious client could attach a booking
-- to a foreign tenant_id while pointing at a real resource_id.
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
-- 7. TABLE: optimization_logs
-- ----------------------------------------------------------------------------
-- Output of the Booking & Optimization Engine's analysis jobs: under-
-- utilized resources, automatically resolved double-booking attempts,
-- nightly utilization scans, etc. Written exclusively by the backend
-- service (service_role key) — never directly by end users.
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
  'Operational intelligence trail from the optimization engine. Visible only to tenant_admin/super_admin via RLS — this is internal analytics, not user-facing data.';

create index idx_optimization_logs_tenant_id on public.optimization_logs (tenant_id);
create index idx_optimization_logs_resource_id on public.optimization_logs (resource_id);
create index idx_optimization_logs_type on public.optimization_logs (log_type);
create index idx_optimization_logs_created_at on public.optimization_logs (created_at desc);


-- ============================================================================
-- 8. TABLE: notifications
-- ----------------------------------------------------------------------------
-- Persisted record of notifications dispatched by the Notification Service
-- (booking approvals, conflict alerts, reminders). The service itself
-- sends the actual email/push/SMS; this table is the in-app inbox + audit
-- trail.
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


-- ============================================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================================
alter table public.tenants            enable row level security;
alter table public.user_profiles      enable row level security;
alter table public.resources          enable row level security;
alter table public.bookings           enable row level security;
alter table public.optimization_logs  enable row level security;
alter table public.notifications      enable row level security;

-- ----------------------------------------------------------------------------
-- 9.1 tenants
-- A user may read their own faculty's record. Faculty creation/editing is a
-- platform-admin operation, handled by the Tenant Service via service_role
-- (which bypasses RLS) — so no INSERT/UPDATE/DELETE policy is granted to
-- the authenticated role at all; those operations simply have no policy
-- to match and are denied by default.
-- ----------------------------------------------------------------------------
create policy "tenants_select_own_or_super_admin"
    on public.tenants
    for select
    to authenticated
    using (
        id = (select public.current_tenant_id())
        or (select public.is_super_admin())
    );

-- ----------------------------------------------------------------------------
-- 9.2 user_profiles
-- Visibility: a user always sees their own profile; tenant_admins/super_admins
-- additionally see every profile within their own tenant (needed to manage
-- staff/students and approve bookings). Faculty A admins can never see
-- Faculty B users.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 9.3 resources
-- THE CORE TENANT-ISOLATION GUARANTEE: every operation is gated on
-- resources.tenant_id matching the caller's tenant_id claim. A Faculty A
-- user's JWT can never satisfy a Faculty B row's predicate, regardless of
-- what resource_id they guess or request.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 9.4 bookings
-- SELECT is opened to the whole tenant (everyone needs to see the shared
-- calendar to know what's free) but strictly scoped to tenant_id, so
-- Faculty A never sees Faculty B's reservations. Writes are scoped to the
-- caller's own bookings, with tenant_admins able to approve/reject any
-- booking inside their faculty.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 9.5 optimization_logs
-- Internal analytics — only visible to admins of the owning tenant.
-- No INSERT/UPDATE/DELETE policy is granted to `authenticated` at all:
-- only the Booking & Optimization Engine (using service_role, which
-- bypasses RLS entirely) is allowed to write these rows.
-- ----------------------------------------------------------------------------
create policy "optimization_logs_select_tenant_admin"
    on public.optimization_logs
    for select
    to authenticated
    using (
        (select public.is_tenant_admin())
        and tenant_id = (select public.current_tenant_id())
    );

-- ----------------------------------------------------------------------------
-- 9.6 notifications
-- A user only ever sees their own notifications. They may mark their own
-- notifications as read, but cannot edit the content. Inserts are
-- service_role-only (Notification Service), same pattern as above.
-- ----------------------------------------------------------------------------
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


-- ============================================================================
-- 10. OPTIONAL — FIREBASE PROJECT GUARD (self-hosted Supabase only)
-- ----------------------------------------------------------------------------
-- Firebase Auth signs tokens with a SHARED key set across all Firebase
-- projects. On Supabase's hosted platform, tokens from Firebase project
-- IDs you haven't explicitly registered are already rejected before they
-- reach Postgres, so this step is optional there. If you ever self-host
-- the Supabase stack, add this guard, which Supabase auto-generates as
-- public.is_supabase_or_firebase_project_jwt() once you configure the
-- Third-Party Auth integration:
--
--   create policy "restrict_to_registered_projects"
--       on <table_name>
--       as restrictive
--       to authenticated
--       using ((select public.is_supabase_or_firebase_project_jwt()) is true);
--
-- Apply this to every table above, plus Storage buckets and Realtime
-- channels, if/when self-hosting.
-- ============================================================================


-- ============================================================================
-- 11. (OPTIONAL) DEV/TEST SEED DATA — do not run against production
-- ============================================================================
-- insert into public.tenants (name, code, slug, contact_email) values
--     ('Faculty of Computing',   'FOC', 'computing',   'admin@foc.example.edu'),
--     ('Faculty of Engineering', 'FOE', 'engineering', 'admin@foe.example.edu');
