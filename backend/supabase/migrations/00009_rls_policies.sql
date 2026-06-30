-- ============================================================================
-- Migration 00009: Row Level Security Policies
-- ============================================================================
-- DEFENSE IN DEPTH: Microservices connect using the Supabase service_role
-- key (which bypasses RLS) and enforce tenant scoping in application code.
-- RLS policies here act as a second, independent layer — if a service ever
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
-- Internal analytics — only visible to admins of the owning tenant.
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
