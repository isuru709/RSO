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
  'Operational intelligence trail from the optimization engine. Visible only to tenant_admin/super_admin via RLS — this is internal analytics, not user-facing data.';

create index idx_optimization_logs_tenant_id on public.optimization_logs (tenant_id);
create index idx_optimization_logs_resource_id on public.optimization_logs (resource_id);
create index idx_optimization_logs_type on public.optimization_logs (log_type);
create index idx_optimization_logs_created_at on public.optimization_logs (created_at desc);
