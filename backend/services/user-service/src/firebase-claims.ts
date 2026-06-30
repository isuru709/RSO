/**
 * Firebase Custom Claims Helper
 * 
 * Sets the required custom claims on a Firebase user that Supabase RLS
 * policies depend on. Must be called after user signup and on role changes.
 * 
 * Claims set:
 *   - role: "authenticated" (required by Supabase to use the 'authenticated' Postgres role)
 *   - tenant_id: UUID string of the user's faculty
 *   - app_role: "student" | "lecturer" | "tenant_admin" | "main_admin"
 */

import { getAuth } from 'firebase-admin/auth';

export type AppRole = 'student' | 'lecturer' | 'tenant_admin' | 'main_admin' | 'staff';

export interface UserClaims {
  role: 'authenticated';
  tenant_id: string;
  app_role: AppRole;
}

/**
 * Set custom claims on a Firebase user.
 * 
 * After calling this, the client MUST call `getIdToken(true)` to pick up
 * the new claims on their next request.
 * 
 * @param uid - Firebase user UID (the "sub" claim)
 * @param tenantId - UUID of the tenant (faculty) the user belongs to
 * @param appRole - Application role for RBAC
 * @throws Will throw if the Firebase Admin SDK cannot reach Firebase servers
 */
export async function setUserClaims(
  uid: string,
  tenantId: string,
  appRole: AppRole,
): Promise<void> {
  const claims: UserClaims = {
    role: 'authenticated',  // Supabase requires this exact value
    tenant_id: tenantId,
    app_role: appRole,
  };

  await getAuth().setCustomUserClaims(uid, claims);
}

/**
 * Get the current custom claims for a Firebase user.
 * Useful for verifying claims were set correctly.
 * 
 * @param uid - Firebase user UID
 * @returns The user's custom claims, or an empty object if none set
 */
export async function getUserClaims(uid: string): Promise<Partial<UserClaims>> {
  const user = await getAuth().getUser(uid);
  return (user.customClaims as Partial<UserClaims>) || {};
}

/**
 * Update only the app_role claim (e.g., promoting a student to lecturer).
 * Preserves existing tenant_id and role claims.
 * 
 * @param uid - Firebase user UID
 * @param newRole - The new application role
 */
export async function updateUserRole(uid: string, newRole: AppRole): Promise<void> {
  const existing = await getUserClaims(uid);
  
  if (!existing.tenant_id) {
    throw new Error(`User ${uid} has no tenant_id claim — cannot update role without it`);
  }

  await setUserClaims(uid, existing.tenant_id, newRole);
}

/**
 * Remove all custom claims from a Firebase user.
 * Used when deactivating a user or revoking access.
 * 
 * @param uid - Firebase user UID
 */
export async function clearUserClaims(uid: string): Promise<void> {
  await getAuth().setCustomUserClaims(uid, {});
}
