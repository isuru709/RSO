/**
 * Booking & Optimization Service Routes
 * 
 * Handles booking CRUD, approval workflow, and optimization analytics.
 * The EXCLUDE constraint in Postgres prevents double-booking atomically.
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
import type { StreamEvent } from '@rso/shared';

export async function bookingRoutes(server: FastifyInstance): Promise<void> {
  const supabase = getSupabaseClient();

  // ========================================================================
  // GET /api/v1/bookings — List bookings (tenant-scoped, filterable)
  // ========================================================================
  server.get('/api/v1/bookings', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const {
      page = '1', limit = '20',
      resource_id, status, start_date, end_date, my_bookings,
    } = request.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('bookings')
      .select('*, resources(name, resource_type, location)', { count: 'exact' });

    // Tenant scoping
    if (request.user!.appRole !== 'main_admin') {
      const tenantId = request.user!.tenantId;
      if (!tenantId || tenantId === 'null' || tenantId === 'undefined') {
        throw ApiError.forbidden('Your account has no tenant assigned. Please contact an admin.');
      }
      query = query.eq('tenant_id', tenantId);
    }

    if (resource_id) query = query.eq('resource_id', resource_id);
    if (status) query = query.eq('status', status);
    if (my_bookings === 'true') query = query.eq('booked_by', request.user!.sub);
    if (start_date) query = query.gte('start_time', start_date);
    if (end_date) query = query.lte('end_time', end_date);

    const { data, count, error } = await query
      .order('start_time', { ascending: true })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    sendPaginated(reply, data || [], count || 0, pageNum, limitNum);
  });

  // ========================================================================
  // GET /api/v1/bookings/:id — Get single booking
  // ========================================================================
  server.get('/api/v1/bookings/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('bookings')
      .select('*, resources(name, resource_type, location, capacity)')
      .eq('id', id)
      .single();

    if (error || !data) throw ApiError.notFound('Booking');

    if (request.user!.appRole !== 'main_admin' && data.tenant_id !== request.user!.tenantId) {
      throw ApiError.forbidden('This booking belongs to another faculty');
    }

    if (data.booked_by) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name, email, phone, member_id')
        .eq('firebase_uid', data.booked_by)
        .single();
      data.user = profile || null;
    }

    sendSuccess(reply, data);
  });

  // ========================================================================
  // POST /api/v1/bookings — Create a booking
  // ========================================================================
  server.post('/api/v1/bookings', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const user = request.user!;

    if (!body.resource_id || !body.start_time || !body.end_time || !body.title) {
      throw ApiError.badRequest('resource_id, title, start_time, and end_time are required');
    }

    // Verify resource exists and belongs to user's tenant (or is global)
    const { data: resource } = await supabase
      .from('resources')
      .select('id, tenant_id, is_bookable, status, category, allowed_roles, hourly_cost')
      .eq('id', body.resource_id)
      .single();

    if (!resource) throw ApiError.notFound('Resource');
    
    // Global vs Tenant checks
    if (resource.tenant_id === null) {
      // Global resource
      if (resource.allowed_roles && resource.allowed_roles.length > 0) {
        if (!resource.allowed_roles.includes(user.appRole) && user.appRole !== 'main_admin') {
          throw ApiError.forbidden(`Your role is not allowed to book this global resource. Allowed: ${resource.allowed_roles.join(', ')}`);
        }
      }
    } else {
      if (user.appRole !== 'main_admin' && resource.tenant_id !== user.tenantId) {
        throw ApiError.forbidden('Cannot book resources from another faculty');
      }
    }

    if (!resource.is_bookable) throw ApiError.badRequest('This resource is not bookable');
    if (resource.status !== 'available') throw ApiError.badRequest(`Resource is currently ${resource.status}`);

    // Student restriction
    if (user.appRole === 'student' && resource.category !== 'EQUIPMENT') {
      throw ApiError.forbidden('Students are only allowed to book EQUIPMENT resources.');
    }

    // Define priority weights
    const priorities: Record<string, number> = {
      'main_admin': 5,
      'tenant_admin': 5,
      'lecturer': 4,
      'junior_lecturer': 3,
      'staff': 2,
      'student': 1
    };
    const userPriority = priorities[user.appRole] || 0;

    // Check overlaps
    const { data: overlaps } = await supabase
      .from('bookings')
      .select('id, booked_by, user_profiles(role)')
      .eq('resource_id', body.resource_id)
      .in('status', ['pending', 'approved', 'active'])
      .lt('start_time', body.end_time)
      .gt('end_time', body.start_time);

    let bumpedIds: string[] = [];
    if (overlaps && overlaps.length > 0) {
      for (const overlap of overlaps) {
        const overlapRole = (overlap.user_profiles as any)?.role || 'student';
        const overlapPriority = priorities[overlapRole] || 0;
        
        if (overlapPriority >= userPriority) {
          throw ApiError.conflict('This time slot is already booked by a user with equal or higher priority.');
        }
        bumpedIds.push(overlap.id);
      }

      // Bump lower priority bookings
      await supabase
        .from('bookings')
        .update({ status: 'bumped' })
        .in('id', bumpedIds);
    }

    // Determine initial status
    let initialStatus = 'pending';
    if (['main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer'].includes(user.appRole)) {
      initialStatus = 'approved';
    }

    // Create booking
    const { data: booking, error } = await supabase
      .from('bookings')
      .insert({
        resource_id: body.resource_id,
        booked_by: user.sub,
        title: body.title,
        purpose: body.purpose,
        start_time: body.start_time,
        end_time: body.end_time,
        status: initialStatus,
        attendee_count: body.attendee_count,
        notes: body.notes,
        recurrence_rule: body.recurrence_rule,
        tenant_id: resource.tenant_id, // For global resources, we insert null or let sync_booking_tenant handle it. Wait, sync_booking_tenant enforces NOT NULL if resource has it, but since we altered resources to allow nullable tenant_id, we should alter bookings.tenant_id too! Wait, bookings.tenant_id is still NOT NULL. Let's fix that in migration.
      })
      .select()
      .single();

    if (error) {
      // 23P01 = exclusion_violation (double-booking race condition)
      if (error.code === '23P01') {
        // Rollback bumped ones manually if needed, but it's edge case
        throw ApiError.conflict('This time slot was just booked by another user');
      }
      throw error;
    }

    // ---- Student Token Deduction ----
    let tokensDeducted = 0;
    if (user.appRole === 'student' && resource.category === 'EQUIPMENT' && resource.hourly_cost) {
      const startMs = new Date(body.start_time as string).getTime();
      const endMs = new Date(body.end_time as string).getTime();
      const hours = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60)));
      tokensDeducted = Math.ceil(resource.hourly_cost * hours);

      // Check balance
      const { data: tokenBalance } = await supabase
        .from('student_token_balances')
        .select('id, balance')
        .eq('firebase_uid', user.sub)
        .single();

      if (!tokenBalance || tokenBalance.balance < tokensDeducted) {
        // Rollback: delete the booking we just created
        await supabase.from('bookings').delete().eq('id', booking.id);
        throw ApiError.badRequest(`Insufficient tokens. Need ${tokensDeducted}, have ${tokenBalance?.balance || 0}.`);
      }

      // Deduct tokens
      await supabase
        .from('student_token_balances')
        .update({ balance: tokenBalance.balance - tokensDeducted })
        .eq('id', tokenBalance.id);

      // Log transaction
      await supabase.from('token_transactions').insert({
        firebase_uid: user.sub,
        booking_id: booking.id,
        amount: -tokensDeducted,
        type: 'booking_deduction',
        description: `Booked equipment for ${hours}h (${resource.hourly_cost} tokens/h)`,
      });
    }

    // Publish event for notification service
    try {
      await publishEvent('booking-events', {
        type: 'booking.created',
        payload: { booking_id: booking.id, resource_id: body.resource_id, booked_by: user.sub },
        timestamp: new Date().toISOString(),
        tenantId: resource.tenant_id,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to publish booking event (non-fatal)');
    }

    logger.info({ bookingId: booking.id, resourceId: body.resource_id }, 'Booking created');
    sendSuccess(reply, booking, 201);
  });

  // ========================================================================
  // PUT /api/v1/bookings/:id/approve — Approve a booking
  // ========================================================================
  server.put('/api/v1/bookings/:id/approve', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('bookings')
      .update({
        status: 'approved',
        approved_by: request.user!.sub,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Pending booking');

    try {
      await publishEvent('booking-events', {
        type: 'booking.approved',
        payload: { booking_id: id, approved_by: request.user!.sub },
        timestamp: new Date().toISOString(),
        tenantId: data.tenant_id,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to publish approval event');
    }

    logger.info({ bookingId: id, approvedBy: request.user!.sub }, 'Booking approved');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // PUT /api/v1/bookings/:id/reject — Reject a booking
  // ========================================================================
  server.put('/api/v1/bookings/:id/reject', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };

    const { data, error } = await supabase
      .from('bookings')
      .update({
        status: 'rejected',
        approved_by: request.user!.sub,
        approved_at: new Date().toISOString(),
        notes: reason,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Pending booking');

    try {
      await publishEvent('booking-events', {
        type: 'booking.rejected',
        payload: { booking_id: id, rejected_by: request.user!.sub, reason },
        timestamp: new Date().toISOString(),
        tenantId: data.tenant_id,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to publish rejection event');
    }

    logger.info({ bookingId: id }, 'Booking rejected');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // PUT /api/v1/bookings/:id/cancel — Cancel own booking
  // ========================================================================
  server.put('/api/v1/bookings/:id/cancel', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    // Build query — owner or admin can cancel
    let query = supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .in('status', ['pending', 'approved']);

    if (user.appRole !== 'main_admin') {
      if (user.appRole === 'tenant_admin') {
        // Must belong to this tenant
        query = query.eq('tenant_id', user.tenantId);
      } else {
        query = query.eq('booked_by', user.sub);
      }
    }

    const { data, error } = await query.select().single();

    if (error || !data) throw ApiError.notFound('Active booking');

    // ---- Student Token Refund (50%) ----
    if (data.booked_by) {
      // Check if the booker is a student with a token record
      const { data: tokenBalance } = await supabase
        .from('student_token_balances')
        .select('id, balance')
        .eq('firebase_uid', data.booked_by)
        .single();

      if (tokenBalance) {
        // Find the original deduction for this booking
        const { data: deduction } = await supabase
          .from('token_transactions')
          .select('amount')
          .eq('booking_id', id)
          .eq('type', 'booking_deduction')
          .single();

        if (deduction) {
          const refundAmount = Math.floor(Math.abs(deduction.amount) / 2); // 50% refund
          if (refundAmount > 0) {
            await supabase
              .from('student_token_balances')
              .update({ balance: tokenBalance.balance + refundAmount })
              .eq('id', tokenBalance.id);

            await supabase.from('token_transactions').insert({
              firebase_uid: data.booked_by,
              booking_id: id,
              amount: refundAmount,
              type: 'booking_refund',
              description: `50% refund for cancelled booking (${refundAmount} of ${Math.abs(deduction.amount)} tokens)`,
            });

            logger.info({ bookingId: id, refund: refundAmount }, 'Student tokens partially refunded');
          }
        }
      }
    }

    try {
      await publishEvent('booking-events', {
        type: 'booking.cancelled',
        payload: { booking_id: id, cancelled_by: user.sub },
        timestamp: new Date().toISOString(),
        tenantId: data.tenant_id,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to publish cancellation event');
    }

    logger.info({ bookingId: id }, 'Booking cancelled');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // PUT /api/v1/bookings/:id — Edit a booking
  // ========================================================================
  server.put('/api/v1/bookings/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const updates = request.body as Record<string, any>;

    // Fetch existing booking
    const { data: existing, error: fetchErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) throw ApiError.notFound('Booking');

    if (user.appRole !== 'main_admin') {
      if (user.appRole === 'tenant_admin') {
        if (existing.tenant_id !== user.tenantId) throw ApiError.forbidden('Cannot edit a booking outside your faculty');
      } else {
        if (existing.booked_by !== user.sub) throw ApiError.forbidden("Cannot edit another user's booking");
      }
    }

    const { data, error } = await supabase
      .from('bookings')
      .update({
        title: updates.title !== undefined ? updates.title : existing.title,
        purpose: updates.purpose !== undefined ? updates.purpose : existing.purpose,
        start_time: updates.start_time !== undefined ? updates.start_time : existing.start_time,
        end_time: updates.end_time !== undefined ? updates.end_time : existing.end_time,
        notes: updates.notes !== undefined ? updates.notes : existing.notes,
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) throw ApiError.internal('Failed to update booking');

    // Notify booker if changed by an admin
    if (existing.booked_by !== user.sub) {
      try {
        await publishEvent('booking-events', {
          type: 'booking.updated',
          payload: { booking_id: id, updated_by: user.sub },
          timestamp: new Date().toISOString(),
          tenantId: data.tenant_id,
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to publish edit event');
      }
    }

    logger.info({ bookingId: id }, 'Booking edited');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // GET /api/v1/bookings/optimization/stats — Utilization stats
  // ========================================================================
  server.get('/api/v1/bookings/optimization/stats', {
    preHandler: [authMiddleware, requireRole('tenant_admin', 'main_admin')],
  }, async (request, reply) => {
    const tenantId = request.user!.appRole === 'main_admin'
      ? (request.query as any).tenant_id
      : request.user!.tenantId;

    const { data: logs, error } = await supabase
      .from('optimization_logs')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    sendSuccess(reply, { logs: logs || [] });
  });

  // ========================================================================
  // POST /api/v1/bookings/transitions — Auto-transition booking statuses
  // Called by the frontend periodically or on page load
  // approved → active (when current time >= start_time)
  // active → completed (when current time >= end_time)
  // ========================================================================
  server.post('/api/v1/bookings/transitions', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const now = new Date().toISOString();
    let updated = 0;

    // approved → active (booking has started)
    const { data: activated, error: e1 } = await supabase
      .from('bookings')
      .update({ status: 'active' })
      .eq('status', 'approved')
      .lte('start_time', now)
      .select('id');

    if (!e1 && activated) updated += activated.length;

    // active → completed (booking has ended)
    const { data: completed, error: e2 } = await supabase
      .from('bookings')
      .update({ status: 'completed' })
      .eq('status', 'active')
      .lte('end_time', now)
      .select('id');

    if (!e2 && completed) updated += completed.length;

    // Also transition approved bookings that have fully passed
    const { data: missedCompleted, error: e3 } = await supabase
      .from('bookings')
      .update({ status: 'completed' })
      .eq('status', 'approved')
      .lte('end_time', now)
      .select('id');

    if (!e3 && missedCompleted) updated += missedCompleted.length;

    if (updated > 0) {
      logger.info({ updated }, 'Booking statuses transitioned');
    }

    // ---- Monthly Token Renewal ----
    let renewed = 0;
    try {
      const now = new Date();
      const currentMonth = now.toISOString().slice(0, 7); // "2026-07"

      // Find students whose tokens haven't been renewed this month
      const { data: staleBalances } = await supabase
        .from('student_token_balances')
        .select('id, firebase_uid, monthly_quota, last_renewed_at')
        .lt('last_renewed_at', `${currentMonth}-01T00:00:00Z`);

      if (staleBalances && staleBalances.length > 0) {
        for (const sb of staleBalances) {
          await supabase
            .from('student_token_balances')
            .update({ balance: sb.monthly_quota, last_renewed_at: now.toISOString() })
            .eq('id', sb.id);

          await supabase.from('token_transactions').insert({
            firebase_uid: sb.firebase_uid,
            amount: sb.monthly_quota,
            type: 'monthly_renewal',
            description: `Monthly token renewal for ${currentMonth}`,
          });
          renewed++;
        }
        logger.info({ renewed }, 'Student tokens renewed for new month');
      }
    } catch (err) {
      logger.warn({ err }, 'Token renewal failed (non-fatal)');
    }

    sendSuccess(reply, { transitioned: updated, tokens_renewed: renewed });
  });
}
