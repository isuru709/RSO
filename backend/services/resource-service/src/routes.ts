/**
 * Resource Service Routes
 * 
 * CRUD for bookable resources (labs, lecture halls, equipment).
 * All operations are tenant-scoped.
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

export async function resourceRoutes(server: FastifyInstance): Promise<void> {
  const supabase = getSupabaseClient();

  // ========================================================================
  // GET /api/v1/resources — List resources (tenant-scoped, paginated)
  // ========================================================================
  server.get('/api/v1/resources', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { page = '1', limit = '20', type, status, search, is_bookable } = request.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase.from('resources').select('*', { count: 'exact' });

    // Tenant scoping — only tenant_admin sees their own tenant's resources
    // All other users (students, lecturers, staff, main_admin) see all resources
    if (request.user!.appRole === 'tenant_admin') {
      const tenantId = request.user!.tenantId;
      if (!tenantId || tenantId === 'null' || tenantId === 'undefined') {
        throw ApiError.forbidden('Your account has no tenant assigned. Please contact an admin.');
      }
      query = query.eq('tenant_id', tenantId);
    }

    if (type) query = query.eq('resource_type', type);
    if (status) query = query.eq('status', status);
    if (is_bookable !== undefined) query = query.eq('is_bookable', is_bookable === 'true');
    if (search) query = query.or(`name.ilike.%${search}%,location.ilike.%${search}%`);

    const { data, count, error } = await query
      .order('name')
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    sendPaginated(reply, data || [], count || 0, pageNum, limitNum);
  });

  // ========================================================================
  // GET /api/v1/resources/:id — Get single resource
  // ========================================================================
  server.get('/api/v1/resources/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('resources')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw ApiError.notFound('Resource');

    // Tenant check — only tenant_admin is restricted to their own tenant
    if (request.user!.appRole === 'tenant_admin' && data.tenant_id !== request.user!.tenantId) {
      throw ApiError.forbidden('This resource belongs to another faculty');
    }

    sendSuccess(reply, data);
  });

  // ========================================================================
  // POST /api/v1/resources — Create a resource
  // ========================================================================
  server.post('/api/v1/resources', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    let tenantId: string | null = request.user!.tenantId;
    if (request.user!.appRole === 'main_admin') {
      // Main admin can create campus-wide resources (null) or assign to a specific tenant
      tenantId = body.tenant_id ? (body.tenant_id as string) : null;
    }

    const { data, error } = await supabase
      .from('resources')
      .insert({
        tenant_id: tenantId,
        name: body.name,
        resource_type: body.resource_type,
        category: body.category,
        capacity: body.capacity,
        location: body.location,
        equipment_features: body.equipment_features,
        hourly_cost: body.hourly_cost,
        image_url: body.image_url,
        is_bookable: body.is_bookable ?? true,
        created_by: request.user!.sub,
      })
      .select()
      .single();

    if (error) throw error;

    logger.info({ resourceId: data.id, tenantId }, 'Resource created');
    sendSuccess(reply, data, 201);
  });

  // ========================================================================
  // PUT /api/v1/resources/:id — Update a resource
  // ========================================================================
  server.put('/api/v1/resources/:id', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Record<string, unknown>;

    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    // Verify resource belongs to user's tenant
    const { data: existing } = await supabase
      .from('resources')
      .select('tenant_id')
      .eq('id', id)
      .single();

    if (!existing) throw ApiError.notFound('Resource');
    if (request.user!.appRole !== 'main_admin' && existing.tenant_id !== request.user!.tenantId) {
      throw ApiError.forbidden('This resource belongs to another faculty');
    }

    const { data, error } = await supabase
      .from('resources')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    logger.info({ resourceId: id }, 'Resource updated');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // DELETE /api/v1/resources/:id — Retire a resource
  // ========================================================================
  server.delete('/api/v1/resources/:id', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('resources')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Resource');

    logger.info({ resourceId: id }, 'Resource deleted');
    sendSuccess(reply, { message: 'Resource deleted', resource: data });
  });

  // ========================================================================
  // GET /api/v1/resources/:id/availability — Check availability
  // ========================================================================
  server.get('/api/v1/resources/:id/availability', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { date } = request.query as { date?: string };

    const targetDate = date || new Date().toISOString().split('T')[0];
    const dayStart = `${targetDate}T00:00:00Z`;
    const dayEnd = `${targetDate}T23:59:59Z`;

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, title, start_time, end_time, status, booked_by')
      .eq('resource_id', id)
      .in('status', ['pending', 'approved'])
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .order('start_time');

    if (error) throw error;

    sendSuccess(reply, {
      resource_id: id,
      date: targetDate,
      bookings: bookings || [],
      total_bookings: bookings?.length || 0,
    });
  });
}
