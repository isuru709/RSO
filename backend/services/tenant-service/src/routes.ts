/**
 * Tenant Service Routes
 * 
 * CRUD operations for tenants (faculties/departments).
 * All write operations require main_admin or tenant_admin role.
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

export async function tenantRoutes(server: FastifyInstance): Promise<void> {
  const supabase = getSupabaseClient();

  // ========================================================================
  // GET /api/v1/tenants — List all tenants (paginated)
  // ========================================================================
  server.get('/api/v1/tenants', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { page = '1', limit = '20', search, is_active } = request.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('tenants')
      .select('*', { count: 'exact' });

    // Filters
    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
    }
    if (is_active !== undefined) {
      query = query.eq('is_active', is_active === 'true');
    }

    // Tenant-scoped: non-main_admin users only see their own tenant
    if (request.user!.appRole !== 'main_admin') {
      query = query.eq('id', request.user!.tenantId);
    }

    const { data, count, error } = await query
      .order('name')
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    sendPaginated(reply, data || [], count || 0, pageNum, limitNum);
  });

  // ========================================================================
  // GET /api/v1/tenants/:id — Get single tenant
  // ========================================================================
  server.get('/api/v1/tenants/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Non-main_admin can only see their own tenant
    if (request.user!.appRole !== 'main_admin' && id !== request.user!.tenantId) {
      throw ApiError.forbidden('You can only view your own faculty');
    }

    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw ApiError.notFound('Tenant');

    sendSuccess(reply, data);
  });

  // ========================================================================
  // POST /api/v1/tenants — Create a new tenant
  // ========================================================================
  server.post('/api/v1/tenants', {
    preHandler: [authMiddleware, requireRole('main_admin')],
  }, async (request, reply) => {
    const { name, code, slug, description, contact_email, settings } = request.body as {
      name: string;
      code: string;
      slug: string;
      description?: string;
      contact_email?: string;
      settings?: Record<string, unknown>;
    };

    if (!name || !code || !slug) {
      throw ApiError.badRequest('name, code, and slug are required');
    }

    const { data, error } = await supabase
      .from('tenants')
      .insert({ name, code, slug, description, contact_email, settings })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw ApiError.conflict(`A tenant with this code or slug already exists`, error.details);
      }
      throw error;
    }

    logger.info({ tenantId: data.id, code }, 'Tenant created');
    sendSuccess(reply, data, 201);
  });

  // ========================================================================
  // PUT /api/v1/tenants/:id — Update a tenant
  // ========================================================================
  server.put('/api/v1/tenants/:id', {
    preHandler: [authMiddleware, requireRole('main_admin', 'tenant_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Tenant admins can only update their own tenant
    if (request.user!.appRole === 'tenant_admin' && id !== request.user!.tenantId) {
      throw ApiError.forbidden('You can only update your own faculty');
    }

    const updates = request.body as Record<string, unknown>;
    // Prevent changing immutable fields
    delete updates.id;
    delete updates.created_at;

    const { data, error } = await supabase
      .from('tenants')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Tenant');

    logger.info({ tenantId: id }, 'Tenant updated');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // DELETE /api/v1/tenants/:id — Soft-delete (deactivate) a tenant
  // ========================================================================
  server.delete('/api/v1/tenants/:id', {
    preHandler: [authMiddleware, requireRole('main_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Soft-delete: set is_active = false
    const { data, error } = await supabase
      .from('tenants')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Tenant');

    logger.info({ tenantId: id }, 'Tenant deactivated');
    sendSuccess(reply, { message: 'Tenant deactivated', tenant: data });
  });

  // ========================================================================
  // GET /api/v1/tenants/:id/stats — Tenant statistics
  // ========================================================================
  server.get('/api/v1/tenants/:id/stats', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    if (request.user!.appRole === 'tenant_admin' && id !== request.user!.tenantId) {
      throw ApiError.forbidden('You can only view stats for your own faculty');
    }

    // Parallel queries for stats
    const [usersResult, resourcesResult, bookingsResult] = await Promise.all([
      supabase.from('user_profiles').select('role', { count: 'exact' }).eq('tenant_id', id),
      supabase.from('resources').select('status', { count: 'exact' }).eq('tenant_id', id),
      supabase.from('bookings').select('status', { count: 'exact' }).eq('tenant_id', id),
    ]);

    sendSuccess(reply, {
      tenant_id: id,
      users: { total: usersResult.count || 0 },
      resources: { total: resourcesResult.count || 0 },
      bookings: { total: bookingsResult.count || 0 },
    });
  });
}
