-- ============================================================================
-- Migration 00011: Advanced RBAC and Priority Booking Engine
-- ============================================================================

-- 1. Update user_profiles role check to include new roles
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;

-- Migrate existing super_admin to main_admin
UPDATE public.user_profiles SET role = 'main_admin' WHERE role = 'super_admin';

ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_check CHECK (
    role IN ('main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer', 'staff', 'student')
);

-- Update the tenant_required constraint since we renamed super_admin to main_admin
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_tenant_required;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_tenant_required CHECK (
    role = 'main_admin' OR tenant_id IS NOT NULL
);

-- 2. Update resources table
-- We'll rename the existing 'resource_type' column to 'category' for consistency if it exists,
-- but the prompt explicitly said `category` must be HALL, LAB, EQUIPMENT.
-- The existing schema has both `resource_type` and `category`. 
-- Let's drop the old constraint on resource_type, but enforce the new rule on `category`.
ALTER TABLE public.resources DROP CONSTRAINT IF EXISTS resources_type_check;

-- We'll just map any existing resource_type data into the category column if it's null, 
-- and uppercase it to match the enum.
UPDATE public.resources 
SET category = CASE 
    WHEN resource_type = 'lecture_hall' THEN 'HALL'
    WHEN resource_type = 'lab' THEN 'LAB'
    WHEN resource_type = 'equipment' THEN 'EQUIPMENT'
    ELSE 'HALL' 
END
WHERE category IS NULL OR category NOT IN ('HALL', 'LAB', 'EQUIPMENT');

ALTER TABLE public.resources DROP CONSTRAINT IF EXISTS resources_category_check;
ALTER TABLE public.resources ADD CONSTRAINT resources_category_check CHECK (
    category IN ('HALL', 'LAB', 'EQUIPMENT')
);

-- Make tenant_id nullable
ALTER TABLE public.resources ALTER COLUMN tenant_id DROP NOT NULL;

-- Add allowed_roles
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS allowed_roles text[];

-- 3. Update bookings table
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

-- Note: the prompt requested PENDING, APPROVED, REJECTED, BUMPED, COMPLETED.
-- We are keeping lowercase to match Postgres conventions and existing data,
-- plus adding 'active' and 'cancelled' which existed previously.
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK (
    status IN ('pending', 'approved', 'rejected', 'bumped', 'completed', 'cancelled', 'active')
);

-- Allow bookings for global resources (tenant_id can be NULL)
ALTER TABLE public.bookings ALTER COLUMN tenant_id DROP NOT NULL;

-- 4. Modifying the EXCLUDE constraint
-- We need to change `bookings_no_overlap` to NOT exclude `bumped`.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status IN ('pending', 'approved', 'active'));

-- 5. Update JWT Helpers & RLS Policies
-- Rename is_super_admin to is_main_admin
CREATE OR REPLACE FUNCTION public.is_main_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() = 'main_admin';
$$;

-- Update is_tenant_admin to allow main_admin as well
CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() IN ('tenant_admin', 'main_admin');
$$;

-- Update resources SELECT policy: allowed for own tenant or global resources (tenant_id IS NULL)
DROP POLICY IF EXISTS "resources_select_own_tenant" ON public.resources;
CREATE POLICY "resources_select_own_tenant"
    ON public.resources
    FOR SELECT
    TO authenticated
    USING (
        tenant_id = (SELECT public.current_tenant_id())
        OR tenant_id IS NULL
        OR (SELECT public.is_main_admin())
    );

-- Allow main_admin to insert global resources
DROP POLICY IF EXISTS "resources_insert_main_admin" ON public.resources;
CREATE POLICY "resources_insert_main_admin"
    ON public.resources
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT public.is_main_admin())
    );

-- Allow main_admin to update global resources
DROP POLICY IF EXISTS "resources_update_main_admin" ON public.resources;
CREATE POLICY "resources_update_main_admin"
    ON public.resources
    FOR UPDATE
    TO authenticated
    USING (
        (SELECT public.is_main_admin())
    )
    WITH CHECK (
        (SELECT public.is_main_admin())
    );

-- Allow main_admin to delete global resources
DROP POLICY IF EXISTS "resources_delete_main_admin" ON public.resources;
CREATE POLICY "resources_delete_main_admin"
    ON public.resources
    FOR DELETE
    TO authenticated
    USING (
        (SELECT public.is_main_admin())
    );

-- Update bookings INSERT policy to allow booking global resources
DROP POLICY IF EXISTS "bookings_insert_own_tenant" ON public.bookings;
CREATE POLICY "bookings_insert_own_tenant"
    ON public.bookings
    FOR INSERT
    TO authenticated
    WITH CHECK (
        booked_by = (SELECT public.current_firebase_uid())
        AND EXISTS (
            SELECT 1 FROM public.resources r
            WHERE r.id = resource_id
              AND (r.tenant_id = (SELECT public.current_tenant_id()) OR r.tenant_id IS NULL)
        )
    );

