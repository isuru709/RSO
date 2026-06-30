-- ============================================================
-- ST Bookings (Student P2P Borrowing)
-- Lightweight booking table for student-shared resources.
-- Separate from main bookings table (no tenant scoping needed).
-- ============================================================

CREATE TABLE IF NOT EXISTS st_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  st_resource_id UUID NOT NULL REFERENCES st_resources(id) ON DELETE CASCADE,
  borrower_uid TEXT NOT NULL REFERENCES user_profiles(firebase_uid) ON DELETE CASCADE,
  owner_uid TEXT NOT NULL REFERENCES user_profiles(firebase_uid) ON DELETE CASCADE,
  title TEXT NOT NULL,
  purpose TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'returned')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT st_bookings_time_order CHECK (end_time > start_time),
  CONSTRAINT st_bookings_no_self_borrow CHECK (borrower_uid != owner_uid)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_st_bookings_resource ON st_bookings(st_resource_id);
CREATE INDEX IF NOT EXISTS idx_st_bookings_borrower ON st_bookings(borrower_uid);
CREATE INDEX IF NOT EXISTS idx_st_bookings_owner ON st_bookings(owner_uid);
CREATE INDEX IF NOT EXISTS idx_st_bookings_status ON st_bookings(status);

-- Auto-update trigger
CREATE TRIGGER set_st_bookings_updated_at
  BEFORE UPDATE ON st_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE st_bookings ENABLE ROW LEVEL SECURITY;

-- Borrower and owner can view their own bookings
CREATE POLICY "st_bookings_select_own"
    ON st_bookings FOR SELECT TO authenticated
    USING (
        borrower_uid = (SELECT public.current_firebase_uid())
        OR owner_uid = (SELECT public.current_firebase_uid())
    );

-- Staff/admins can view all
CREATE POLICY "st_bookings_select_staff"
    ON st_bookings FOR SELECT TO authenticated
    USING (
        (SELECT public.is_tenant_admin())
        OR public.current_app_role() IN ('lecturer', 'junior_lecturer')
    );

-- Students can insert (borrow)
CREATE POLICY "st_bookings_insert"
    ON st_bookings FOR INSERT TO authenticated
    WITH CHECK (borrower_uid = (SELECT public.current_firebase_uid()));

-- Borrower or owner can update (approve/reject/cancel/return)
CREATE POLICY "st_bookings_update"
    ON st_bookings FOR UPDATE TO authenticated
    USING (
        borrower_uid = (SELECT public.current_firebase_uid())
        OR owner_uid = (SELECT public.current_firebase_uid())
        OR (SELECT public.is_tenant_admin())
    );
