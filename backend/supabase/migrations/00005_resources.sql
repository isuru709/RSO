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
