-- =============================================================================
-- Multi-Tenant Resource Sharing & Optimization Platform
-- University Campus Community — Complete Supabase PostgreSQL Schema
-- Version 2.0 — Full RBAC + Priority Booking Engine
-- =============================================================================
-- ARCHITECTURAL DECISIONS:
--   • tenant_id IS NULL  → Global resource created by Main Admin
--   • tenant_id IS SET   → Tenant-owned resource
--   • All RLS policies read the calling user's role from public.users
--     via Firebase UID (auth.uid() maps to firebase_uid in our users table)
--   • Priority integers: lower number = higher priority (Lecturer = 3, etc.)
--     Stored in role_priority_weight() helper so changes propagate everywhere
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 0.  EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for fast text search on resource names


-- ---------------------------------------------------------------------------
-- 1.  ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE role_type AS ENUM (
  'MAIN_ADMIN',       -- Level 1  – superuser
  'TENANT_ADMIN',     -- Level 2  – per-faculty admin
  'LECTURER',         -- Level 3
  'JUNIOR_LECTURER',  -- Level 4
  'STAFF',            -- Level 5
  'STUDENT'           -- Level 6  – lowest
);

CREATE TYPE resource_category AS ENUM (
  'HALL',       -- Lecture halls / seminar rooms
  'LAB',        -- Computer / science / engineering labs
  'EQUIPMENT'   -- Projectors, cameras, tools, etc.
);

CREATE TYPE booking_status AS ENUM (
  'PENDING',    -- Awaiting Tenant Admin approval (STAFF / STUDENT)
  'APPROVED',   -- Confirmed (auto for LECTURER / JUNIOR_LECTURER; manual for others)
  'REJECTED',   -- Explicitly rejected by admin
  'BUMPED',     -- Overridden by a higher-priority booking
  'COMPLETED',  -- Booking window has passed
  'CANCELLED'   -- Voluntarily cancelled by the booker
);

CREATE TYPE resource_status AS ENUM (
  'AVAILABLE',
  'UNDER_MAINTENANCE',
  'RETIRED'
);

CREATE TYPE notification_type AS ENUM (
  'BOOKING_CONFIRMED',
  'BOOKING_PENDING',
  'BOOKING_REJECTED',
  'BOOKING_BUMPED',
  'BOOKING_CANCELLED',
  'ALTERNATIVE_SLOT_SUGGESTED',
  'ROLE_CHANGED',
  'RESOURCE_UPDATED'
);


-- ---------------------------------------------------------------------------
-- 2.  HELPER: role priority weight
--     Returns the integer priority weight for a given role.
--     Lower number = higher priority (wins in conflict).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION role_priority_weight(r role_type)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE r
    WHEN 'MAIN_ADMIN'      THEN 1
    WHEN 'TENANT_ADMIN'    THEN 2
    WHEN 'LECTURER'        THEN 3
    WHEN 'JUNIOR_LECTURER' THEN 4
    WHEN 'STAFF'           THEN 5
    WHEN 'STUDENT'         THEN 6
    ELSE 99
  END;
$$;


-- ---------------------------------------------------------------------------
-- 3.  TENANTS
--     One row per Faculty / Department.
--     Main Admin creates these; Tenant Admins cannot insert here.
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT        NOT NULL,                        -- "Faculty of Engineering"
  slug          TEXT        NOT NULL UNIQUE,                 -- "foe" — used in API paths
  description   TEXT,
  logo_url      TEXT,
  settings      JSONB       NOT NULL DEFAULT '{}',           -- theme colours, booking windows, etc.
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by    UUID,                                        -- FK → users.id (set after table exists)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);


-- ---------------------------------------------------------------------------
-- 4.  USERS
--     One row per person. Linked to Firebase Auth via firebase_uid.
--     tenant_id IS NULL only for MAIN_ADMIN.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  firebase_uid  TEXT        NOT NULL UNIQUE,    -- maps to auth.uid() in RLS
  tenant_id     UUID        REFERENCES tenants(id) ON DELETE SET NULL,
  email         TEXT        NOT NULL UNIQUE,
  full_name     TEXT        NOT NULL,
  role          role_type   NOT NULL DEFAULT 'STUDENT',
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  avatar_url    TEXT,
  phone         TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}',  -- department, employee_id, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Back-fill the FK on tenants now that users exists
ALTER TABLE tenants
  ADD CONSTRAINT fk_tenants_created_by
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_users_firebase_uid  ON users(firebase_uid);
CREATE INDEX idx_users_tenant_id     ON users(tenant_id);
CREATE INDEX idx_users_role          ON users(role);
CREATE INDEX idx_users_email         ON users USING GIN (email gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- 5.  RESOURCES
--     tenant_id IS NULL   → Global resource (Main Admin only)
--     tenant_id IS SET    → Tenant-owned resource
--
--     allowed_roles: only honoured when tenant_id IS NULL (global).
--       For tenant resources, access is determined solely by tenant membership.
--     auto_approve_roles: roles whose bookings on THIS resource are auto-approved,
--       regardless of the global STAFF/STUDENT → PENDING rule.
--       Main Admin can set this per-resource for finer control.
-- ---------------------------------------------------------------------------
CREATE TABLE resources (
  id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID              REFERENCES tenants(id) ON DELETE CASCADE,
                                        -- NULL = global
  name                TEXT              NOT NULL,
  description         TEXT,
  category            resource_category NOT NULL,
  capacity            INTEGER           CHECK (capacity > 0),
  location            TEXT,             -- "Building A, Room 204"
  status              resource_status   NOT NULL DEFAULT 'AVAILABLE',

  -- Global resource controls (ignored when tenant_id IS NOT NULL)
  allowed_roles       role_type[]       NOT NULL DEFAULT '{}',
                                        -- e.g. '{LECTURER,JUNIOR_LECTURER,STAFF}'
  auto_approve_roles  role_type[]       NOT NULL DEFAULT '{LECTURER,JUNIOR_LECTURER}',
                                        -- roles whose bookings skip PENDING state

  -- Booking window constraints (per resource)
  min_booking_minutes INTEGER           NOT NULL DEFAULT 30,
  max_booking_hours   INTEGER           NOT NULL DEFAULT 8,
  advance_booking_days INTEGER          NOT NULL DEFAULT 60,  -- how far ahead allowed

  -- Grace period: bumping forbidden within N hours of start_time
  bump_grace_hours    INTEGER           NOT NULL DEFAULT 24,

  image_url           TEXT,
  tags                TEXT[]            NOT NULL DEFAULT '{}',
  metadata            JSONB             NOT NULL DEFAULT '{}',
  created_by          UUID              NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- CONSTRAINT: Students can only be in allowed_roles if category = 'EQUIPMENT'
-- Enforced via CHECK + service layer validation.
ALTER TABLE resources
  ADD CONSTRAINT chk_student_equipment_only
  CHECK (
    NOT ('STUDENT' = ANY(allowed_roles)) OR category = 'EQUIPMENT'
  );

CREATE INDEX idx_resources_tenant_id ON resources(tenant_id);
CREATE INDEX idx_resources_category  ON resources(category);
CREATE INDEX idx_resources_status    ON resources(status);
CREATE INDEX idx_resources_name_trgm ON resources USING GIN (name gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- 6.  BOOKINGS
--     Covers both one-off and recurring (via recurring_rule_id).
--     Exclusion constraint prevents double-booking at the DB layer.
-- ---------------------------------------------------------------------------

-- Required for the EXCLUSION constraint below
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE bookings (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          REFERENCES tenants(id) ON DELETE CASCADE,
                                  -- NULL for global-resource bookings
  resource_id       UUID          NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id           UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Time window
  start_time        TIMESTAMPTZ   NOT NULL,
  end_time          TIMESTAMPTZ   NOT NULL,
  CHECK (end_time > start_time),

  -- Booking metadata
  status            booking_status NOT NULL DEFAULT 'PENDING',
  title             TEXT,          -- "CS3045 Lecture", "Lab practical"
  notes             TEXT,
  attendee_count    INTEGER        CHECK (attendee_count > 0),

  -- Priority snapshot (denormalised for audit — role may change later)
  booker_role       role_type     NOT NULL,
  priority_weight   INTEGER       NOT NULL,  -- snapshot of role_priority_weight at insert time

  -- Approval tracking
  approved_by       UUID          REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  rejected_reason   TEXT,

  -- Bump tracking
  bumped_by_booking UUID          REFERENCES bookings(id),  -- who bumped this
  bumped_at         TIMESTAMPTZ,

  -- Recurring linkage
  recurring_rule_id UUID,          -- FK added after recurring_rules table
  is_recurring_instance BOOLEAN   NOT NULL DEFAULT FALSE,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- -----------------------------------------------------------------------
  -- EXCLUSION CONSTRAINT — DB-level double-booking prevention.
  -- Two bookings on the same resource with overlapping times are rejected
  -- UNLESS one of them has status IN ('REJECTED','BUMPED','CANCELLED').
  -- Active statuses: PENDING, APPROVED, COMPLETED.
  -- -----------------------------------------------------------------------
  EXCLUDE USING GIST (
    resource_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status IN ('PENDING', 'APPROVED', 'COMPLETED'))
);

CREATE INDEX idx_bookings_resource_id   ON bookings(resource_id);
CREATE INDEX idx_bookings_user_id       ON bookings(user_id);
CREATE INDEX idx_bookings_tenant_id     ON bookings(tenant_id);
CREATE INDEX idx_bookings_status        ON bookings(status);
CREATE INDEX idx_bookings_start_time    ON bookings(start_time);
CREATE INDEX idx_bookings_time_range    ON bookings USING GIST (
  resource_id,
  tstzrange(start_time, end_time, '[)')
);


-- ---------------------------------------------------------------------------
-- 7.  RECURRING RULES
--     Stores the RRULE string (iCal RFC 5545 format) for recurring bookings.
--     The booking engine expands these into individual booking rows.
-- ---------------------------------------------------------------------------
CREATE TABLE recurring_rules (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        REFERENCES tenants(id) ON DELETE CASCADE,
  resource_id     UUID        NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rrule           TEXT        NOT NULL,  -- e.g. "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=13"
  booking_title   TEXT,
  notes           TEXT,
  start_time      TIME        NOT NULL,  -- time-of-day for each occurrence
  duration_minutes INTEGER    NOT NULL,
  effective_from  DATE        NOT NULL,
  effective_until DATE,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Back-fill FK on bookings
ALTER TABLE bookings
  ADD CONSTRAINT fk_bookings_recurring_rule
  FOREIGN KEY (recurring_rule_id) REFERENCES recurring_rules(id) ON DELETE SET NULL;

CREATE INDEX idx_recurring_rules_user_id     ON recurring_rules(user_id);
CREATE INDEX idx_recurring_rules_resource_id ON recurring_rules(resource_id);
CREATE INDEX idx_recurring_rules_tenant_id   ON recurring_rules(tenant_id);


-- ---------------------------------------------------------------------------
-- 8.  OPTIMIZATION LOGS
--     Written by the Booking & Optimization Engine (async, via RabbitMQ consumer).
--     Tracks utilization analytics, conflict events, and bump history.
-- ---------------------------------------------------------------------------
CREATE TYPE optim_event_type AS ENUM (
  'UNDERUTILIZATION_ALERT',  -- resource used < threshold% of available hours
  'DOUBLE_BOOKING_RESOLVED', -- conflict resolved by priority engine
  'BUMP_OCCURRED',           -- a lower-priority booking was bumped
  'PEAK_DEMAND_DETECTED',    -- many bookings on same resource same day
  'RESOURCE_IDLE',           -- resource had zero bookings for N days
  'BOOKING_PATTERN_DETECTED' -- same user books same slot repeatedly
);

CREATE TABLE optimization_logs (
  id              UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID              REFERENCES tenants(id) ON DELETE SET NULL,
  resource_id     UUID              REFERENCES resources(id) ON DELETE SET NULL,
  event_type      optim_event_type  NOT NULL,
  severity        TEXT              NOT NULL DEFAULT 'INFO'
                                    CHECK (severity IN ('INFO','WARN','CRITICAL')),
  payload         JSONB             NOT NULL DEFAULT '{}',
                                    -- flexible: contains booking_ids, utilization%, etc.
  resolved        BOOLEAN           NOT NULL DEFAULT FALSE,
  resolved_by     UUID              REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_optim_logs_tenant_id    ON optimization_logs(tenant_id);
CREATE INDEX idx_optim_logs_resource_id  ON optimization_logs(resource_id);
CREATE INDEX idx_optim_logs_event_type   ON optimization_logs(event_type);
CREATE INDEX idx_optim_logs_created_at   ON optimization_logs(created_at DESC);


-- ---------------------------------------------------------------------------
-- 9.  NOTIFICATIONS
--     Written by the Notification Service. Clients poll or subscribe via
--     Supabase Realtime (Postgres CDC on this table).
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id              UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id       UUID              REFERENCES tenants(id) ON DELETE SET NULL,
  type            notification_type NOT NULL,
  title           TEXT              NOT NULL,
  body            TEXT              NOT NULL,
  payload         JSONB             NOT NULL DEFAULT '{}',
                                    -- booking_id, suggested_slots, resource_name, etc.
  is_read         BOOLEAN           NOT NULL DEFAULT FALSE,
  sent_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  read_at         TIMESTAMPTZ
);

CREATE INDEX idx_notifications_user_id   ON notifications(user_id);
CREATE INDEX idx_notifications_tenant_id ON notifications(tenant_id);
CREATE INDEX idx_notifications_is_read   ON notifications(is_read);
CREATE INDEX idx_notifications_sent_at   ON notifications(sent_at DESC);


-- ---------------------------------------------------------------------------
-- 10. AUDIT LOG
--     Immutable append-only log for compliance. Written by service layer.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_role    role_type,
  tenant_id     UUID        REFERENCES tenants(id) ON DELETE SET NULL,
  action        TEXT        NOT NULL,  -- 'BOOKING_CREATED', 'ROLE_CHANGED', etc.
  target_table  TEXT        NOT NULL,
  target_id     UUID,
  old_data      JSONB,
  new_data      JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor_id   ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_tenant_id  ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_target_id  ON audit_logs(target_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);


-- ---------------------------------------------------------------------------
-- 11. UPDATED_AT TRIGGER (auto-maintained on all mutable tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON resources
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON recurring_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================================
-- SECTION B — ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- STRATEGY:
--   • A Supabase "authenticated" session carries the Firebase JWT.
--   • auth.uid() returns the firebase_uid string in that JWT.
--   • We expose two helper functions:
--       current_user_record()  → the full users row for the caller
--       current_user_role()    → the role_type enum for the caller
--       current_user_tenant()  → the tenant UUID for the caller
--   • MAIN_ADMIN bypasses all tenant isolation but NOT all RLS
--     (we still use RLS to log; real bypass uses service_role key server-side).
--   • Service-layer actions (booking engine, notification consumer) use the
--     Supabase SERVICE_ROLE key and bypass RLS entirely — this is intentional.
-- =============================================================================

-- Helper functions (SECURITY DEFINER so they run as postgres)
CREATE OR REPLACE FUNCTION current_user_record()
RETURNS users
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM users WHERE firebase_uid = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS role_type
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM users WHERE firebase_uid = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION current_user_tenant()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT tenant_id FROM users WHERE firebase_uid = auth.uid() LIMIT 1;
$$;

-- Enable RLS on all tables
ALTER TABLE tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimization_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       ENABLE ROW LEVEL SECURITY;


-- ── TENANTS ──────────────────────────────────────────────────────────────────

-- SELECT: Main Admin sees all; others see only their own tenant row.
CREATE POLICY "tenants_select" ON tenants FOR SELECT
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR id = current_user_tenant()
  );

-- INSERT: Main Admin only.
CREATE POLICY "tenants_insert" ON tenants FOR INSERT
  WITH CHECK (current_user_role() = 'MAIN_ADMIN');

-- UPDATE: Main Admin only.
CREATE POLICY "tenants_update" ON tenants FOR UPDATE
  USING (current_user_role() = 'MAIN_ADMIN');

-- DELETE: Main Admin only.
CREATE POLICY "tenants_delete" ON tenants FOR DELETE
  USING (current_user_role() = 'MAIN_ADMIN');


-- ── USERS ────────────────────────────────────────────────────────────────────

-- SELECT:
--   • Main Admin sees everyone.
--   • Tenant Admin sees all users in their tenant.
--   • Others see only themselves.
CREATE POLICY "users_select" ON users FOR SELECT
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR (current_user_role() = 'TENANT_ADMIN' AND tenant_id = current_user_tenant())
    OR firebase_uid = auth.uid()
  );

-- INSERT: Main Admin or Tenant Admin (for their tenant only).
CREATE POLICY "users_insert" ON users FOR INSERT
  WITH CHECK (
    current_user_role() = 'MAIN_ADMIN'
    OR (
      current_user_role() = 'TENANT_ADMIN'
      AND tenant_id = current_user_tenant()
      -- Tenant Admin cannot create MAIN_ADMIN or another TENANT_ADMIN
      AND role NOT IN ('MAIN_ADMIN', 'TENANT_ADMIN')
    )
  );

-- UPDATE:
--   • Main Admin: anything.
--   • Tenant Admin: only users in their tenant, cannot promote to MAIN_ADMIN.
--   • Others: only their own non-role fields (role changes blocked).
CREATE POLICY "users_update" ON users FOR UPDATE
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR (current_user_role() = 'TENANT_ADMIN' AND tenant_id = current_user_tenant())
    OR firebase_uid = auth.uid()
  )
  WITH CHECK (
    current_user_role() = 'MAIN_ADMIN'
    OR (
      current_user_role() = 'TENANT_ADMIN'
      AND tenant_id = current_user_tenant()
      AND role NOT IN ('MAIN_ADMIN', 'TENANT_ADMIN')
    )
    OR (
      firebase_uid = auth.uid()
      -- self-update: role must not change (service layer also enforces this)
      AND role = (SELECT role FROM users WHERE firebase_uid = auth.uid())
    )
  );

-- DELETE: Main Admin only.
CREATE POLICY "users_delete" ON users FOR DELETE
  USING (current_user_role() = 'MAIN_ADMIN');


-- ── RESOURCES ────────────────────────────────────────────────────────────────

-- SELECT:
--   • Main Admin: all resources.
--   • Tenant Admin / Lecturer / Junior Lecturer / Staff:
--       - Own tenant resources
--       - Global resources (tenant_id IS NULL) where their role is in allowed_roles
--   • Student:
--       - Own tenant EQUIPMENT resources
--       - Global EQUIPMENT resources where STUDENT is in allowed_roles
CREATE POLICY "resources_select" ON resources FOR SELECT
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR (
      -- Tenant resource belonging to user's tenant
      tenant_id IS NOT NULL
      AND tenant_id = current_user_tenant()
      AND (
        -- Students can only see EQUIPMENT
        current_user_role() != 'STUDENT'
        OR category = 'EQUIPMENT'
      )
    )
    OR (
      -- Global resource
      tenant_id IS NULL
      AND current_user_role() = ANY(allowed_roles)
      AND (
        current_user_role() != 'STUDENT'
        OR category = 'EQUIPMENT'
      )
    )
  );

-- INSERT:
--   • Main Admin: global resources (tenant_id IS NULL).
--   • Tenant Admin: tenant resources in their tenant only.
CREATE POLICY "resources_insert" ON resources FOR INSERT
  WITH CHECK (
    (current_user_role() = 'MAIN_ADMIN')
    OR (
      current_user_role() = 'TENANT_ADMIN'
      AND tenant_id = current_user_tenant()
      AND tenant_id IS NOT NULL
    )
  );

-- UPDATE:
--   • Main Admin: any resource.
--   • Tenant Admin: only their tenant's resources.
CREATE POLICY "resources_update" ON resources FOR UPDATE
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR (
      current_user_role() = 'TENANT_ADMIN'
      AND tenant_id = current_user_tenant()
    )
  );

-- DELETE:
--   • Main Admin: any resource.
--   • Tenant Admin: only their tenant's resources.
CREATE POLICY "resources_delete" ON resources FOR DELETE
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR (
      current_user_role() = 'TENANT_ADMIN'
      AND tenant_id = current_user_tenant()
    )
  );


-- ── BOOKINGS ─────────────────────────────────────────────────────────────────

-- SELECT:
--   • Main Admin: all bookings.
--   • Tenant Admin: all bookings in their tenant.
--   • Lecturer / Junior Lecturer / Staff / Student: own bookings only.
--     (Lecturers do NOT see other people's bookings — privacy by default.
--      The booking UI shows "slot taken" for a resource without revealing who.)
CREATE POLICY "bookings_select" ON bookings FOR SELECT
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR (
      current_user_role() = 'TENANT_ADMIN'
      AND tenant_id = current_user_tenant()
    )
    OR user_id = (SELECT id FROM users WHERE firebase_uid = auth.uid())
  );

-- INSERT: any authenticated user — service layer validates category/role rules.
-- The booking engine (service role) does the real enforcement; this just gates
-- basic auth.
CREATE POLICY "bookings_insert" ON bookings FOR INSERT
  WITH CHECK (
    -- Must be inserting a booking for themselves
    user_id = (SELECT id FROM users WHERE firebase_uid = auth.uid())
    OR current_user_role() IN ('MAIN_ADMIN', 'TENANT_ADMIN')
  );

-- UPDATE:
--   • Main Admin: any booking.
--   • Tenant Admin: bookings in their tenant (for approval/rejection/bump).
--   • Others: own bookings only (e.g. cancellation).
CREATE POLICY "bookings_update" ON bookings FOR UPDATE
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR (
      current_user_role() = 'TENANT_ADMIN'
      AND tenant_id = current_user_tenant()
    )
    OR user_id = (SELECT id FROM users WHERE firebase_uid = auth.uid())
  );

-- DELETE: Main Admin only (soft-deletes preferred via status = 'CANCELLED').
CREATE POLICY "bookings_delete" ON bookings FOR DELETE
  USING (current_user_role() = 'MAIN_ADMIN');


-- ── OPTIMIZATION LOGS ────────────────────────────────────────────────────────

CREATE POLICY "optim_logs_select" ON optimization_logs FOR SELECT
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR (
      current_user_role() = 'TENANT_ADMIN'
      AND tenant_id = current_user_tenant()
    )
  );

-- Only service role (backend) inserts optimization logs — no client policy needed.


-- ── NOTIFICATIONS ────────────────────────────────────────────────────────────

CREATE POLICY "notifications_select" ON notifications FOR SELECT
  USING (user_id = (SELECT id FROM users WHERE firebase_uid = auth.uid())
         OR current_user_role() = 'MAIN_ADMIN');

CREATE POLICY "notifications_update" ON notifications FOR UPDATE
  USING (user_id = (SELECT id FROM users WHERE firebase_uid = auth.uid()));


-- ── AUDIT LOGS ───────────────────────────────────────────────────────────────

CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT
  USING (
    current_user_role() = 'MAIN_ADMIN'
    OR (
      current_user_role() = 'TENANT_ADMIN'
      AND tenant_id = current_user_tenant()
    )
  );


-- =============================================================================
-- SECTION C — STORED PROCEDURES FOR BOOKING ENGINE
-- =============================================================================
-- These run SERVER-SIDE via the Supabase service-role client (bypasses RLS).
-- The Node.js booking controller calls these via rpc().
-- =============================================================================

-- ---------------------------------------------------------------------------
-- C-1.  find_overlapping_bookings
--       Returns all active bookings for a resource that overlap a time window.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_overlapping_bookings(
  p_resource_id UUID,
  p_start_time  TIMESTAMPTZ,
  p_end_time    TIMESTAMPTZ
)
RETURNS SETOF bookings
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM bookings
  WHERE resource_id = p_resource_id
    AND status IN ('PENDING', 'APPROVED', 'COMPLETED')
    AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ORDER BY priority_weight ASC;  -- highest priority first
$$;


-- ---------------------------------------------------------------------------
-- C-2.  get_available_slots
--       Returns N available time slots for a resource on a given date,
--       used by the Notification Service to suggest alternatives.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_available_slots(
  p_resource_id    UUID,
  p_date           DATE,
  p_duration_mins  INTEGER,
  p_max_results    INTEGER DEFAULT 5
)
RETURNS TABLE(slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_slot_start TIMESTAMPTZ;
  v_slot_end   TIMESTAMPTZ;
  v_count      INTEGER := 0;
  v_step       INTERVAL := '30 minutes';
  v_day_start  TIMESTAMPTZ := p_date::TIMESTAMPTZ + '07:00'::INTERVAL;
  v_day_end    TIMESTAMPTZ := p_date::TIMESTAMPTZ + '22:00'::INTERVAL;
BEGIN
  v_slot_start := v_day_start;
  WHILE v_slot_start < v_day_end AND v_count < p_max_results LOOP
    v_slot_end := v_slot_start + (p_duration_mins || ' minutes')::INTERVAL;
    IF NOT EXISTS (
      SELECT 1 FROM bookings
      WHERE resource_id = p_resource_id
        AND status IN ('PENDING','APPROVED')
        AND tstzrange(start_time, end_time, '[)') && tstzrange(v_slot_start, v_slot_end, '[)')
    ) THEN
      slot_start := v_slot_start;
      slot_end   := v_slot_end;
      v_count    := v_count + 1;
      RETURN NEXT;
    END IF;
    v_slot_start := v_slot_start + v_step;
  END LOOP;
END;
$$;


-- ---------------------------------------------------------------------------
-- C-3.  complete_past_bookings
--       Run periodically (cron / pg_cron) to mark APPROVED bookings whose
--       end_time has passed as COMPLETED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_past_bookings()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE bookings
  SET status = 'COMPLETED', updated_at = NOW()
  WHERE status = 'APPROVED'
    AND end_time < NOW();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


-- ---------------------------------------------------------------------------
-- C-4.  calculate_resource_utilization
--       Returns utilization percentage for a resource over a date range.
--       Used by the Optimization Engine.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_resource_utilization(
  p_resource_id UUID,
  p_from        DATE,
  p_to          DATE
)
RETURNS NUMERIC(5,2)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_total_available_mins NUMERIC;
  v_total_booked_mins    NUMERIC;
  v_days                 INTEGER;
BEGIN
  v_days := p_to - p_from + 1;
  -- Assume 15 available hours per day (07:00–22:00)
  v_total_available_mins := v_days * 15 * 60;

  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0)
  INTO v_total_booked_mins
  FROM bookings
  WHERE resource_id = p_resource_id
    AND status IN ('APPROVED', 'COMPLETED')
    AND start_time::DATE BETWEEN p_from AND p_to;

  IF v_total_available_mins = 0 THEN RETURN 0; END IF;
  RETURN ROUND((v_total_booked_mins / v_total_available_mins) * 100, 2);
END;
$$;


-- =============================================================================
-- SECTION D — SEED DATA (Development / First Run)
-- =============================================================================
-- Creates one Main Admin user placeholder.
-- Replace 'YOUR_FIREBASE_UID_HERE' with the actual Firebase UID after first login.
-- =============================================================================

INSERT INTO users (firebase_uid, email, full_name, role, tenant_id)
VALUES (
  'YOUR_FIREBASE_UID_HERE',
  'admin@university.edu',
  'System Main Admin',
  'MAIN_ADMIN',
  NULL
)
ON CONFLICT (firebase_uid) DO NOTHING;

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
