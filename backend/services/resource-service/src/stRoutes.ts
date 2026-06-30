/**
 * ST Resource Routes
 * 
 * CRUD for Student Shared Resources (separate table: st_resources).
 * Students can create/edit/delete their own. Lecturers/admins can manage any.
 */

import { FastifyInstance } from 'fastify';
import {
  authMiddleware,
  getSupabaseClient,
  ApiError,
  sendSuccess,
  logger,
} from '@rso/shared';

export async function stResourceRoutes(server: FastifyInstance): Promise<void> {
  const supabase = getSupabaseClient();

  // ========================================================================
  // GET /api/v1/st-resources — List all ST resources
  // ========================================================================
  server.get('/api/v1/st-resources', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { search, mine, available } = request.query as Record<string, string>;

    let query = supabase.from('st_resources').select('*').order('created_at', { ascending: false });

    if (mine === 'true') {
      query = query.eq('created_by', request.user!.sub);
    }
    if (available === 'true') {
      query = query.eq('is_available', true);
    }
    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    sendSuccess(reply, data || []);
  });

  // ========================================================================
  // GET /api/v1/st-resources/:id — Get single ST resource
  // ========================================================================
  server.get('/api/v1/st-resources/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('st_resources')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw ApiError.notFound('ST Resource');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // POST /api/v1/st-resources — Create (students only)
  // ========================================================================
  server.post('/api/v1/st-resources', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const user = request.user!;

    if (user.appRole !== 'student') {
      throw ApiError.forbidden('Only students can share ST Resources');
    }

    const body = request.body as Record<string, unknown>;

    const { data, error } = await supabase
      .from('st_resources')
      .insert({
        name: body.name,
        description: body.description || null,
        item_type: body.item_type || 'other',
        condition: body.condition || 'good',
        pickup_location: body.pickup_location || null,
        hourly_token_cost: body.hourly_token_cost ? parseInt(body.hourly_token_cost as string) : 0,
        is_available: true,
        created_by: user.sub,
      })
      .select()
      .single();

    if (error) throw error;

    logger.info({ stResourceId: data.id, student: user.sub }, 'ST Resource created');
    sendSuccess(reply, data, 201);
  });

  // ========================================================================
  // PUT /api/v1/st-resources/:id — Update
  // Owner student, lecturers, jr. lecturers, admins
  // ========================================================================
  server.put('/api/v1/st-resources/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const updates = request.body as Record<string, unknown>;

    // Fetch existing
    const { data: existing } = await supabase
      .from('st_resources')
      .select('created_by')
      .eq('id', id)
      .single();

    if (!existing) throw ApiError.notFound('ST Resource');

    // Permission check
    const canEdit = user.sub === existing.created_by ||
      ['main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer'].includes(user.appRole);
    if (!canEdit) throw ApiError.forbidden('You cannot edit this resource');

    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    const { data, error } = await supabase
      .from('st_resources')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    logger.info({ stResourceId: id }, 'ST Resource updated');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // DELETE /api/v1/st-resources/:id — Delete
  // Owner student, lecturers, jr. lecturers, admins
  // ========================================================================
  server.delete('/api/v1/st-resources/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const { data: existing } = await supabase
      .from('st_resources')
      .select('created_by')
      .eq('id', id)
      .single();

    if (!existing) throw ApiError.notFound('ST Resource');

    const canDelete = user.sub === existing.created_by ||
      ['main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer'].includes(user.appRole);
    if (!canDelete) throw ApiError.forbidden('You cannot delete this resource');

    const { data, error } = await supabase
      .from('st_resources')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('ST Resource');

    logger.info({ stResourceId: id }, 'ST Resource deleted');
    sendSuccess(reply, { message: 'ST Resource deleted', resource: data });
  });
}
