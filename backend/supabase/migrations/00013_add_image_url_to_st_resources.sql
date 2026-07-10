-- ============================================================
-- Add image_url column to st_resources table
-- ============================================================

ALTER TABLE st_resources ADD COLUMN IF NOT EXISTS image_url TEXT;
