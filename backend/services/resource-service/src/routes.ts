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
  publishEvent,
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
  // Students can only create ST_RESOURCE; admins can create any type.
  // ========================================================================
  server.post('/api/v1/resources', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const user = request.user!;

    // Permission check
    const allowedCreators = ['main_admin', 'tenant_admin', 'student'];
    if (!allowedCreators.includes(user.appRole)) {
      throw ApiError.forbidden('You do not have permission to create resources');
    }

    // Students can ONLY create ST_RESOURCE
    if (user.appRole === 'student') {
      if (body.category !== 'ST_RESOURCE' || body.resource_type !== 'student_resource') {
        throw ApiError.forbidden('Students can only create Student Shared Resources (ST Resource)');
      }
    }

    let tenantId: string | null = user.tenantId;
    if (user.appRole === 'main_admin') {
      tenantId = body.tenant_id ? (body.tenant_id as string) : null;
    }

    const { data, error } = await supabase
      .from('resources')
      .insert({
        tenant_id: tenantId,
        name: body.name,
        resource_type: body.resource_type,
        category: body.category,
        capacity: body.capacity || 1,
        location: body.location,
        equipment_features: body.equipment_features,
        hourly_cost: body.hourly_cost,
        image_url: body.image_url,
        is_bookable: body.is_bookable ?? true,
        created_by: user.sub,
      })
      .select()
      .single();

    if (error) throw error;

    // Publish event for notification service
    try {
      await publishEvent('system-events', {
        type: 'resource.created',
        payload: { resource_id: data.id, name: data.name, category: data.category, created_by: user.sub, created_by_role: user.appRole },
        timestamp: new Date().toISOString(),
        tenantId: tenantId || 'system',
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to publish resource.created event (non-fatal)');
    }

    logger.info({ resourceId: data.id, tenantId, category: body.category }, 'Resource created');
    sendSuccess(reply, data, 201);
  });

  // ========================================================================
  // PUT /api/v1/resources/:id — Update a resource
  // ST_RESOURCE: owner student + lecturers + jr. lecturers + admins can edit
  // Other resources: only admins can edit
  // ========================================================================
  server.put('/api/v1/resources/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Record<string, unknown>;
    const user = request.user!;

    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    // Fetch existing resource
    const { data: existing } = await supabase
      .from('resources')
      .select('tenant_id, category, created_by')
      .eq('id', id)
      .single();

    if (!existing) throw ApiError.notFound('Resource');

    // Permission logic
    if (existing.category === 'ST_RESOURCE') {
      // ST Resource: owner student, lecturers, jr. lecturers, or admins can edit
      const canEdit = user.sub === existing.created_by ||
        ['main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer'].includes(user.appRole);
      if (!canEdit) throw ApiError.forbidden('You cannot edit this student resource');
      // Students cannot change the category away from ST_RESOURCE
      if (user.appRole === 'student') {
        delete updates.category;
        delete updates.resource_type;
      }
    } else {
      // Regular resources: only admins
      if (!['main_admin', 'tenant_admin'].includes(user.appRole)) {
        throw ApiError.forbidden('Only admins can edit this resource');
      }
      if (user.appRole !== 'main_admin' && existing.tenant_id !== user.tenantId) {
        throw ApiError.forbidden('This resource belongs to another faculty');
      }
    }

    const { data, error } = await supabase
      .from('resources')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Publish event for notification service
    try {
      await publishEvent('system-events', {
        type: 'resource.updated',
        payload: { resource_id: id, name: data.name, updated_by: user.sub },
        timestamp: new Date().toISOString(),
        tenantId: existing.tenant_id || 'system',
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to publish resource.updated event (non-fatal)');
    }

    logger.info({ resourceId: id }, 'Resource updated');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // DELETE /api/v1/resources/:id — Delete a resource
  // ST_RESOURCE: owner student + lecturers + jr. lecturers + admins
  // Other resources: only admins
  // ========================================================================
  server.delete('/api/v1/resources/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    // Fetch resource to check permissions
    const { data: existing } = await supabase
      .from('resources')
      .select('category, created_by')
      .eq('id', id)
      .single();

    if (!existing) throw ApiError.notFound('Resource');

    if (existing.category === 'ST_RESOURCE') {
      const canDelete = user.sub === existing.created_by ||
        ['main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer'].includes(user.appRole);
      if (!canDelete) throw ApiError.forbidden('You cannot delete this student resource');
    } else {
      if (!['main_admin', 'tenant_admin'].includes(user.appRole)) {
        throw ApiError.forbidden('Only admins can delete this resource');
      }
    }

    const { data, error } = await supabase
      .from('resources')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Resource');

    // Publish event for notification service
    try {
      await publishEvent('system-events', {
        type: 'resource.deleted',
        payload: { resource_id: id, name: data.name, deleted_by: user.sub },
        timestamp: new Date().toISOString(),
        tenantId: data.tenant_id || 'system',
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to publish resource.deleted event (non-fatal)');
    }

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
