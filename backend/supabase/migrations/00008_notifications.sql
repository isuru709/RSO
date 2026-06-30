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
