-- ============================================================
-- ST Resources (Student Shared Resources) Table
-- Separate table for student-listed items
-- ============================================================

CREATE TABLE IF NOT EXISTS st_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  item_type TEXT NOT NULL DEFAULT 'other',
  condition TEXT DEFAULT 'good',
  pickup_location TEXT,
  hourly_token_cost INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  created_by TEXT NOT NULL REFERENCES user_profiles(firebase_uid) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_st_resources_created_by ON st_resources(created_by);
CREATE INDEX IF NOT EXISTS idx_st_resources_available ON st_resources(is_available);

-- Auto-update trigger
CREATE TRIGGER set_st_resources_updated_at
  BEFORE UPDATE ON st_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE st_resources ENABLE ROW LEVEL SECURITY;

-- Everyone can view all ST resources
CREATE POLICY "st_resources_select_all"
    ON st_resources FOR SELECT TO authenticated USING (true);

-- Students can insert their own resources
CREATE POLICY "st_resources_insert_own"
    ON st_resources FOR INSERT TO authenticated
    WITH CHECK (created_by = (SELECT public.current_firebase_uid()));

-- Owner or staff can update
CREATE POLICY "st_resources_update_owner_or_staff"
    ON st_resources FOR UPDATE TO authenticated
    USING (
        created_by = (SELECT public.current_firebase_uid())
        OR (SELECT public.is_tenant_admin())
        OR public.current_app_role() IN ('lecturer', 'junior_lecturer')
    );

-- Owner or staff can delete
CREATE POLICY "st_resources_delete_owner_or_staff"
    ON st_resources FOR DELETE TO authenticated
    USING (
        created_by = (SELECT public.current_firebase_uid())
        OR (SELECT public.is_tenant_admin())
        OR public.current_app_role() IN ('lecturer', 'junior_lecturer')
    );
