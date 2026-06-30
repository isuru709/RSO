# Supabase + Firebase Third-Party Auth Setup Guide

This guide documents how to configure Supabase to trust Firebase Auth tokens, enabling Row Level Security policies to work with Firebase JWTs.

## Prerequisites

- A Supabase project (project ID: `jpdotxyhemgkwlnlyhpz`)
- A Firebase project (project ID: `university-rso`)

---

## Step 1: Configure Third-Party Auth in Supabase

1. Go to [Supabase Dashboard → Authentication](https://supabase.com/dashboard/project/jpdotxyhemgkwlnlyhpz/auth/providers)
2. Click **"Third-Party Auth"** in the left sidebar (under Authentication)
3. Click **"Add Firebase"** (or "Add a new provider" → Firebase)
4. Enter your Firebase Project ID: `university-rso`
5. Click **"Save"**

> [!IMPORTANT]
> After this step, Supabase will trust JWTs signed by Firebase and expose their claims via `auth.jwt()`. This is what makes all our RLS policies work.

---

## Step 2: Apply Database Migrations

The database schema is split into 9 ordered migration files in `/supabase/migrations/`.

### Option A: Automated (via script)

```bash
# Set environment variables
$env:SUPABASE_SERVICE_ROLE_KEY = "your_service_role_key"
npx tsx scripts/run-migrations.ts
```

### Option B: Manual (via Supabase Dashboard SQL Editor)

1. Go to [Supabase SQL Editor](https://supabase.com/dashboard/project/jpdotxyhemgkwlnlyhpz/sql/new)
2. Run each migration file **in order**:

| Order | File | What It Creates |
|-------|------|-----------------|
| 1 | `00001_extensions.sql` | `pgcrypto`, `btree_gist` extensions |
| 2 | `00002_jwt_helpers.sql` | JWT claim functions (`current_firebase_uid()`, etc.) |
| 3 | `00003_tenants.sql` | `tenants` table + trigger |
| 4 | `00004_user_profiles.sql` | `user_profiles` table + indexes + trigger |
| 5 | `00005_resources.sql` | `resources` table + indexes + trigger |
| 6 | `00006_bookings.sql` | `bookings` table + EXCLUDE constraint + triggers |
| 7 | `00007_optimization_logs.sql` | `optimization_logs` table + indexes |
| 8 | `00008_notifications.sql` | `notifications` table + indexes |
| 9 | `00009_rls_policies.sql` | RLS enabled on all tables + all policies |

3. For each file: paste the SQL content into the editor and click **"Run"**

---

## Step 3: Verify Schema

After applying all migrations, verify:

1. **Table Editor**: Go to [Table Editor](https://supabase.com/dashboard/project/jpdotxyhemgkwlnlyhpz/editor) — you should see 6 tables:
   - `tenants`
   - `user_profiles`
   - `resources`
   - `bookings`
   - `optimization_logs`
   - `notifications`

2. **RLS Status**: Each table should show "RLS enabled" (lock icon) in the Table Editor

3. **Functions**: Go to Database → Functions — you should see:
   - `current_firebase_uid()`
   - `current_tenant_id()`
   - `current_app_role()`
   - `is_super_admin()`
   - `is_tenant_admin()`
   - `set_updated_at()`
   - `sync_booking_tenant()`

---

## Step 4: Required Firebase Custom Claims

For RLS to work correctly, every Firebase user MUST have these custom claims set (via the Firebase Admin SDK):

```json
{
  "role": "authenticated",
  "tenant_id": "<uuid of the user's faculty>",
  "app_role": "student | lecturer | tenant_admin | super_admin"
}
```

### Why `role: "authenticated"` is required

Supabase reads the `role` claim from the JWT to decide which Postgres role executes the query. Firebase does NOT set this by default. Without it, queries will execute as `anon` and no RLS policies for `authenticated` will match.

### Why `auth.uid()` is NOT used

Firebase UIDs are ~28-character alphanumeric strings (e.g., `AbCdEf123456GhIjKlMnOp789`), NOT valid UUIDs. Supabase's `auth.uid()` casts the JWT `sub` to `::uuid`, which would error. Instead, all our policies use:

```sql
auth.jwt() ->> 'sub'  -- returns TEXT, works with Firebase UIDs
```

This is wrapped in the helper function `current_firebase_uid()`.

---

## Troubleshooting

### "permission denied for schema public"
- Ensure you're using the `service_role` key (not the `anon` key) for migration execution

### RLS policies not matching
- Verify the Firebase user has `role: "authenticated"` in their custom claims
- Verify the `tenant_id` claim is a valid UUID string (not `null` or empty)
- Check that Third-Party Auth is correctly configured in the Supabase dashboard

### "exclusion_violation" (23P01) errors
- This is **expected behavior** — it means the EXCLUDE constraint is preventing a double-booking
- The booking service should catch this and return a 409 Conflict response
