-- ============================================================================
-- Migration: Student Token System
-- ============================================================================
-- Adds token balance tracking and transaction audit log for students.
-- Students receive 100 tokens monthly to book equipment resources.
-- ============================================================================

-- 1. Student Token Balances
create table if not exists public.student_token_balances (
  id uuid default gen_random_uuid() primary key,
  firebase_uid text not null unique,
  tenant_id uuid references public.tenants(id),
  balance integer not null default 100,
  monthly_quota integer not null default 100,
  last_renewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast lookup by user
create index if not exists idx_token_balances_uid on public.student_token_balances(firebase_uid);

-- Auto-update updated_at
create trigger set_token_balances_updated_at
  before update on public.student_token_balances
  for each row execute function public.set_updated_at();

-- 2. Token Transactions (audit log)
create table if not exists public.token_transactions (
  id uuid default gen_random_uuid() primary key,
  firebase_uid text not null,
  booking_id uuid references public.bookings(id) on delete set null,
  amount integer not null,
  type text not null check (type in ('monthly_renewal', 'booking_deduction', 'booking_refund', 'admin_adjustment')),
  description text,
  created_at timestamptz not null default now()
);

-- Index for fetching user's recent transactions
create index if not exists idx_token_transactions_uid on public.token_transactions(firebase_uid, created_at desc);

-- 3. Backfill: Create token balances for existing students
insert into public.student_token_balances (firebase_uid, tenant_id, balance, monthly_quota)
select up.firebase_uid, up.tenant_id, 100, 100
from public.user_profiles up
where up.role = 'student'
  and not exists (
    select 1 from public.student_token_balances stb where stb.firebase_uid = up.firebase_uid
  );
