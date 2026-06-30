-- ============================================================================
-- Migration 00006: Bookings Table
-- ============================================================================
-- Reservations against a resource. tenant_id is intentionally DENORMALIZED
-- onto this table for RLS/index performance. The sync_booking_tenant()
-- trigger always recomputes tenant_id server-side from the resource.
--
-- The bookings_no_overlap EXCLUDE constraint is the source of truth for
-- conflict prevention — the optimization engine should treat a 23P01
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
  'Reservations against a resource. The bookings_no_overlap EXCLUDE constraint is the source of truth for conflict prevention — the optimization engine should treat a 23P01 (exclusion_violation) error as "slot unavailable" and respond accordingly.';
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
