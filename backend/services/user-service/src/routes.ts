/**
 * User Profile Service Routes
 * 
 * Manages user profiles, signup flow, and role management.
 * Syncs Firebase custom claims on role changes.
 */

import { FastifyInstance } from 'fastify';
import {
  authMiddleware,
  requireRole,
  getSupabaseClient,
  ApiError,
  sendSuccess,
  sendPaginated,
  logger,
} from '@rso/shared';
import { initFirebaseAdmin } from './firebase-admin';
import { setUserClaims, updateUserRole, clearUserClaims, getUserClaims } from './firebase-claims';

export async function userRoutes(server: FastifyInstance): Promise<void> {
  const supabase = getSupabaseClient();

  // Initialize Firebase Admin SDK on route registration
  initFirebaseAdmin();

  // ========================================================================
  // GET /api/v1/users/check-tenant/:code — Validate tenant code before signup
  // ========================================================================
  server.get('/api/v1/users/check-tenant/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, name, is_active')
      .eq('code', code)
      .single();

    if (error || !tenant) {
      throw ApiError.notFound('Faculty code is invalid. Please check your faculty code.');
    }
    if (!tenant.is_active) {
      throw ApiError.badRequest('This faculty is currently inactive.');
    }
    
    sendSuccess(reply, { valid: true, tenant_name: tenant.name });
  });

  // ========================================================================
  // POST /api/v1/users/signup — Create user profile + set Firebase claims
  // ========================================================================
  server.post('/api/v1/users/signup', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const user = request.user!;
    const { tenant_code, full_name, phone, member_id } = request.body as {
      tenant_code: string;
      full_name?: string;
      phone?: string;
      member_id?: string;
    };

    if (!tenant_code) {
      throw ApiError.badRequest('tenant_code is required to join a faculty');
    }

    // Look up tenant by code
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, name, is_active')
      .eq('code', tenant_code)
      .single();

    if (tenantErr || !tenant) throw ApiError.notFound('Faculty with that code');
    if (!tenant.is_active) throw ApiError.badRequest('This faculty is currently inactive');

    // Check if profile already exists
    const { data: existing } = await supabase
      .from('user_profiles')
      .select('firebase_uid')
      .eq('firebase_uid', user.sub)
      .single();

    if (existing) throw ApiError.conflict('User profile already exists');

    // Create profile
    const { data: profile, error: profileErr } = await supabase
      .from('user_profiles')
      .insert({
        firebase_uid: user.sub,
        tenant_id: tenant.id,
        email: user.email || '',
        full_name: full_name || user.email?.split('@')[0] || '',
        phone: phone || null,
        member_id: member_id || null,
        role: 'student', // Default role on signup
      })
      .select()
      .single();

    if (profileErr) throw profileErr;

    // Create token balance for new student
    await supabase.from('student_token_balances').insert({
      firebase_uid: user.sub,
      tenant_id: tenant.id,
      balance: 100,
      monthly_quota: 100,
    });

    // Log initial token grant
    await supabase.from('token_transactions').insert({
      firebase_uid: user.sub,
      amount: 100,
      type: 'monthly_renewal',
      description: 'Initial token allocation on signup',
    });

    // Set Firebase custom claims
    await setUserClaims(user.sub, tenant.id, 'student');

    logger.info({ uid: user.sub, tenantId: tenant.id }, 'User signed up');
    sendSuccess(reply, {
      profile,
      claims_set: true,
      message: 'Profile created. Call getIdToken(true) to refresh your token.',
    }, 201);
  });

  // ========================================================================
  // POST /api/v1/users/register — Admin creates a new user account
  // ========================================================================
  server.post('/api/v1/users/register', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { getAuth } = await import('firebase-admin/auth');
    const admin = request.user!;
    const { email, password, full_name, role, member_id, phone, tenant_id } = request.body as {
      email: string;
      password: string;
      full_name: string;
      role?: string;
      member_id?: string;
      phone?: string;
      tenant_id?: string;
    };

    if (!email || !password || !full_name) {
      throw ApiError.badRequest('email, password, and full_name are required');
    }
    if (password.length < 6) {
      throw ApiError.badRequest('Password must be at least 6 characters');
    }

    // Determine tenant
    let targetTenantId = tenant_id || admin.tenantId;
    // If main_admin and no valid tenant, use the first active tenant
    if (!targetTenantId || targetTenantId === 'null' || targetTenantId === 'undefined') {
      const { data: firstTenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single();
      if (firstTenant) targetTenantId = firstTenant.id;
    }

    // Verify tenant exists
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('id', targetTenantId)
      .single();

    if (!tenant) throw ApiError.notFound('Tenant. Please create a faculty/tenant first.');

    // Create Firebase user
    let firebaseUser;
    try {
      firebaseUser = await getAuth().createUser({
        email,
        password,
        displayName: full_name,
      });
    } catch (err: any) {
      if (err.code === 'auth/email-already-exists') {
        throw ApiError.conflict('A user with this email already exists');
      }
      throw err;
    }

    const userRole = role || 'student';

    // Create Supabase profile
    const { data: profile, error: profileErr } = await supabase
      .from('user_profiles')
      .insert({
        firebase_uid: firebaseUser.uid,
        tenant_id: tenant.id,
        email,
        full_name,
        phone: phone || null,
        member_id: member_id || null,
        role: userRole,
      })
      .select()
      .single();

    if (profileErr) {
      // Rollback Firebase user
      try { await getAuth().deleteUser(firebaseUser.uid); } catch {}
      throw profileErr;
    }

    // Set Firebase claims
    await setUserClaims(firebaseUser.uid, tenant.id, userRole as any);

    logger.info({ uid: firebaseUser.uid, createdBy: admin.sub }, 'User registered by admin');
    sendSuccess(reply, profile, 201);
  });

  // ========================================================================
  // GET /api/v1/users/me — Get own profile
  // ========================================================================
  server.get('/api/v1/users/me', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*, tenants(name, code, slug)')
      .eq('firebase_uid', request.user!.sub)
      .single();

    if (error || !data) throw ApiError.notFound('User profile');

    sendSuccess(reply, data);
  });

  // ========================================================================
  // GET /api/v1/users — List users in tenant (paginated)
  // ========================================================================
  server.get('/api/v1/users', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { page = '1', limit = '20', role, search, tenant_id } = request.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase.from('user_profiles').select('*', { count: 'exact' });

    // Tenant scoping — main_admin sees all users unless filtering by tenant
    if (request.user!.appRole === 'main_admin') {
      // Only filter by tenant if explicitly requested
      if (tenant_id && tenant_id !== 'null' && tenant_id !== 'undefined') {
        query = query.eq('tenant_id', tenant_id);
      }
      // Otherwise: no tenant filter — show all users
    } else {
      // Non-super admins: always scoped to their own tenant
      const tid = request.user!.tenantId;
      if (tid && tid !== 'null' && tid !== 'undefined') {
        query = query.eq('tenant_id', tid);
      }
    }

    if (role) query = query.eq('role', role);
    if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    sendPaginated(reply, data || [], count || 0, pageNum, limitNum);
  });

  // ========================================================================
  // GET /api/v1/users/:uid — Get a specific user
  // ========================================================================
  server.get('/api/v1/users/:uid', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const user = request.user!;

    // Users can view themselves; admins can view anyone in their tenant
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('firebase_uid', uid)
      .single();

    if (error || !data) throw ApiError.notFound('User');

    // Check access
    if (uid !== user.sub && user.appRole !== 'main_admin') {
      if (user.appRole !== 'tenant_admin' || data.tenant_id !== user.tenantId) {
        throw ApiError.forbidden('You can only view users in your own faculty');
      }
    }

    sendSuccess(reply, data);
  });

  // ========================================================================
  // PUT /api/v1/users/:uid — Update user profile
  // ========================================================================
  server.put('/api/v1/users/:uid', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const user = request.user!;

    // Users can update themselves; tenant_admins can update anyone in their tenant
    if (uid !== user.sub && user.appRole !== 'main_admin') {
      if (user.appRole !== 'tenant_admin') {
        throw ApiError.forbidden('You can only update your own profile');
      }
    }

    const updates = request.body as Record<string, unknown>;
    // Prevent changing immutable fields
    delete updates.firebase_uid;
    delete updates.created_at;
    delete updates.tenant_id; // Can't switch tenants via this endpoint

    // Non-admins can't change their own role
    if (uid === user.sub && user.appRole !== 'main_admin') {
      delete updates.role;
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('firebase_uid', uid)
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('User');

    logger.info({ uid, updatedBy: user.sub }, 'User profile updated');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // PUT /api/v1/users/:uid/role — Change a user's role and/or tenant (admin only)
  // ========================================================================
  server.put('/api/v1/users/:uid/role', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const { role, tenant_id } = request.body as { role: string; tenant_id?: string };

    if (!role) throw ApiError.badRequest('role is required');

    const validRoles = ['student', 'lecturer', 'tenant_admin', 'staff'];
    if (request.user!.appRole !== 'main_admin') {
      // Tenant admins can't create main_admins
      if (role === 'main_admin') throw ApiError.forbidden('Only main_admin can assign main_admin role');
    } else {
      validRoles.push('main_admin');
    }

    if (!validRoles.includes(role)) {
      throw ApiError.badRequest(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
    }

    // Get current user to verify access and current tenant
    const { data: currentUser, error: userErr } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('firebase_uid', uid)
      .single();

    if (userErr || !currentUser) throw ApiError.notFound('User');

    if (request.user!.appRole !== 'main_admin') {
      if (currentUser.tenant_id !== request.user!.tenantId) {
         throw ApiError.forbidden('Cannot modify users outside your faculty');
      }
      if (tenant_id && tenant_id !== request.user!.tenantId) {
         throw ApiError.forbidden('Cannot assign user to a different faculty');
      }
    }

    // Determine final tenant_id
    const finalTenantId = tenant_id !== undefined ? tenant_id : currentUser.tenant_id;
    
    if (role !== 'main_admin' && (!finalTenantId || finalTenantId === 'null' || finalTenantId === 'undefined')) {
      throw ApiError.badRequest('A valid tenant is required for all roles except main_admin');
    }

    // Update in Supabase
    const updateData: any = { role };
    if (tenant_id !== undefined) {
      updateData.tenant_id = tenant_id === 'null' ? null : tenant_id;
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('firebase_uid', uid)
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('User');

    // Sync Firebase custom claims
    if (tenant_id !== undefined) {
      const { setUserClaims } = await import('./firebase-claims');
      await setUserClaims(uid, data.tenant_id, role as any);
    } else {
      const { updateUserRole } = await import('./firebase-claims');
      await updateUserRole(uid, role as any);
    }

    logger.info({ uid, newRole: role, newTenant: data.tenant_id, changedBy: request.user!.sub }, 'User role/tenant changed');
    sendSuccess(reply, {
      profile: data,
      claims_updated: true,
      message: 'Role updated. User must call getIdToken(true) to refresh.',
    });
  });

  // ========================================================================
  // DELETE /api/v1/users/:uid — Delete user account
  // Admin can delete anyone; users can delete themselves
  // ========================================================================
  server.delete('/api/v1/users/:uid', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const user = request.user!;

    // Authorization: self or admin
    if (uid !== user.sub && user.appRole !== 'main_admin' && user.appRole !== 'tenant_admin') {
      throw ApiError.forbidden('You can only delete your own account');
    }

    // Security check: tenant_admin can only delete users in their own tenant
    if (uid !== user.sub && user.appRole === 'tenant_admin') {
      const { data: targetUser } = await supabase
        .from('user_profiles')
        .select('tenant_id, role')
        .eq('firebase_uid', uid)
        .single();
        
      if (!targetUser) throw ApiError.notFound('User');
      if (targetUser.tenant_id !== user.tenantId) {
        throw ApiError.forbidden('You can only delete users in your own faculty');
      }
      if (targetUser.role === 'main_admin') {
        throw ApiError.forbidden('You cannot delete a main_admin');
      }
    }

    // First: delete or nullify user's bookings (FK constraint)
    await supabase
      .from('bookings')
      .delete()
      .eq('booked_by', uid)
      .in('status', ['pending', 'cancelled', 'rejected']);

    // Update remaining bookings (approved/active/completed) to remove booked_by reference
    // Actually, just delete all bookings for this user to avoid FK issues
    await supabase
      .from('bookings')
      .delete()
      .eq('booked_by', uid);

    // Delete profile from Supabase
    const { data, error } = await supabase
      .from('user_profiles')
      .delete()
      .eq('firebase_uid', uid)
      .select()
      .single();

    if (error) {
      logger.error({ uid, error: error.message }, 'Failed to delete user profile');
      throw ApiError.internal(`Failed to delete user: ${error.message}`);
    }
    if (!data) throw ApiError.notFound('User');

    // Delete from Firebase Auth
    try {
      const { getAuth } = await import('firebase-admin/auth');
      await getAuth().deleteUser(uid);
    } catch (err: any) {
      logger.warn({ uid, error: err.message }, 'Failed to delete Firebase user (may not exist)');
    }

    logger.info({ uid, deletedBy: user.sub }, 'User account deleted');
    sendSuccess(reply, { message: 'User account deleted' });
  });

  // ========================================================================
  // POST /api/v1/users/:uid/avatar — Upload avatar image (base64)
  // ========================================================================
  server.post('/api/v1/users/:uid/avatar', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const user = request.user!;

    // Authorization: self or admin
    if (uid !== user.sub && user.appRole !== 'main_admin' && user.appRole !== 'tenant_admin') {
      throw ApiError.forbidden('You can only update your own avatar');
    }

    const { image, filename } = request.body as { image: string; filename: string };
    if (!image) throw ApiError.badRequest('image (base64) is required');

    const ext = (filename || 'avatar.jpg').split('.').pop()?.toLowerCase() || 'jpg';
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    if (!allowed.includes(ext)) {
      throw ApiError.badRequest(`File type .${ext} not allowed. Use: ${allowed.join(', ')}`);
    }

    // Decode base64
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      throw ApiError.badRequest('File too large. Max 5MB');
    }

    const fileName = `${uid}_${Date.now()}.${ext}`;
    const uploadDir = '/app/uploads/avatars';
    const { mkdir, writeFile } = await import('fs/promises');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(`${uploadDir}/${fileName}`, buffer);

    const avatarUrl = `/uploads/avatars/${fileName}`;

    // Update user profile
    await supabase
      .from('user_profiles')
      .update({ avatar_url: avatarUrl })
      .eq('firebase_uid', uid);

    logger.info({ uid, avatarUrl }, 'Avatar uploaded');
    sendSuccess(reply, { avatar_url: avatarUrl });
  });

  // ========================================================================
  // GET /api/v1/users/me/tokens — Get own token balance & recent transactions
  // ========================================================================
  server.get('/api/v1/users/me/tokens', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const uid = request.user!.sub;

    const { data: balance } = await supabase
      .from('student_token_balances')
      .select('*')
      .eq('firebase_uid', uid)
      .single();

    if (!balance) {
      return sendSuccess(reply, { balance: null, transactions: [] });
    }

    const { data: transactions } = await supabase
      .from('token_transactions')
      .select('*')
      .eq('firebase_uid', uid)
      .order('created_at', { ascending: false })
      .limit(20);

    sendSuccess(reply, { balance, transactions: transactions || [] });
  });

  // ========================================================================
  // PUT /api/v1/users/tokens/bulk — Admin: set monthly quota for ALL students
  // ========================================================================
  server.put('/api/v1/users/tokens/bulk', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { monthly_quota, reset_balance } = request.body as { monthly_quota: number; reset_balance?: boolean };

    if (!monthly_quota || monthly_quota < 0) {
      throw ApiError.badRequest('monthly_quota must be a positive number');
    }

    const user = request.user!;
    let query = supabase.from('student_token_balances').update({
      monthly_quota,
      ...(reset_balance ? { balance: monthly_quota } : {}),
    });

    // Tenant admin only updates their own tenant's students
    if (user.appRole === 'tenant_admin') {
      query = query.eq('tenant_id', user.tenantId);
    }

    const { error, count } = await query.select('id');
    if (error) throw error;

    logger.info({ monthly_quota, reset_balance, updatedBy: user.sub }, 'Bulk token update');
    sendSuccess(reply, { message: `Updated ${count || 0} students`, monthly_quota });
  });

  // ========================================================================
  // PUT /api/v1/users/:uid/tokens — Admin: adjust a specific student's tokens
  // ========================================================================
  server.put('/api/v1/users/:uid/tokens', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const { balance, monthly_quota } = request.body as { balance?: number; monthly_quota?: number };

    const updates: Record<string, any> = {};
    if (balance !== undefined) updates.balance = balance;
    if (monthly_quota !== undefined) updates.monthly_quota = monthly_quota;

    if (Object.keys(updates).length === 0) {
      throw ApiError.badRequest('Provide balance or monthly_quota to update');
    }

    const { data, error } = await supabase
      .from('student_token_balances')
      .update(updates)
      .eq('firebase_uid', uid)
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Student token balance');

    // Log admin adjustment
    await supabase.from('token_transactions').insert({
      firebase_uid: uid,
      amount: balance !== undefined ? balance - (data.balance || 0) : 0,
      type: 'admin_adjustment',
      description: `Adjusted by admin ${request.user!.sub}`,
    });

    logger.info({ uid, updates, adjustedBy: request.user!.sub }, 'Student tokens adjusted');
    sendSuccess(reply, data);
  });
}
