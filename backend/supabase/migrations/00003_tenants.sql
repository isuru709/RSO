-- ============================================================================
-- Migration 00003: Tenants Table
-- ============================================================================
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
