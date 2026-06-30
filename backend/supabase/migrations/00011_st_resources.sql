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
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast owner lookups
CREATE INDEX IF NOT EXISTS idx_st_resources_created_by ON st_resources(created_by);
CREATE INDEX IF NOT EXISTS idx_st_resources_available ON st_resources(is_available);
