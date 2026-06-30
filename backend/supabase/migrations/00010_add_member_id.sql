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
