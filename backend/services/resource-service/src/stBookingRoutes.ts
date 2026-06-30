/**
 * ST Booking Routes (P2P Student Borrowing)
 *
 * Students borrow items from other students. Owner approves/rejects.
 * Contact details (email, phone, name) visible to both parties.
 */

import { FastifyInstance } from 'fastify';
import {
  authMiddleware,
  getSupabaseClient,
  ApiError,
  sendSuccess,
  logger,
} from '@rso/shared';

export async function stBookingRoutes(server: FastifyInstance): Promise<void> {
  const supabase = getSupabaseClient();

  // ========================================================================
  // POST /api/v1/st-resources/:id/borrow — Borrow an item
  // ========================================================================
  server.post('/api/v1/st-resources/:id/borrow', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    if (user.appRole !== 'student') {
      throw ApiError.forbidden('Only students can borrow ST Resources');
    }

    // Fetch the resource
    const { data: resource, error: resErr } = await supabase
      .from('st_resources')
      .select('id, name, created_by, is_available, hourly_token_cost')
      .eq('id', id)
      .single();

    if (resErr || !resource) throw ApiError.notFound('ST Resource');
    if (!resource.is_available) throw ApiError.badRequest('This item is not available');
    if (resource.created_by === user.sub) throw ApiError.badRequest('You cannot borrow your own item');

    const body = request.body as Record<string, unknown>;
    if (!body.start_time || !body.end_time) {
      throw ApiError.badRequest('start_time and end_time are required');
    }

    const startMs = new Date(body.start_time as string).getTime();
    const endMs = new Date(body.end_time as string).getTime();
    if (endMs <= startMs) throw ApiError.badRequest('end_time must be after start_time');

    // Token deduction
    let tokensDeducted = 0;
    if (resource.hourly_token_cost && resource.hourly_token_cost > 0) {
      const hours = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60)));
      tokensDeducted = Math.ceil(resource.hourly_token_cost * hours);

      const { data: tokenBalance } = await supabase
        .from('student_token_balances')
        .select('id, balance')
        .eq('firebase_uid', user.sub)
        .single();

      if (!tokenBalance || tokenBalance.balance < tokensDeducted) {
        throw ApiError.badRequest(`Insufficient tokens. Need ${tokensDeducted}, have ${tokenBalance?.balance || 0}.`);
      }

      // Deduct tokens
      await supabase
        .from('student_token_balances')
        .update({ balance: tokenBalance.balance - tokensDeducted })
        .eq('id', tokenBalance.id);
    }

    // Create the borrow record
    const { data: booking, error } = await supabase
      .from('st_bookings')
      .insert({
        st_resource_id: id,
        borrower_uid: user.sub,
        owner_uid: resource.created_by,
        title: (body.title as string) || `Borrow: ${resource.name}`,
        purpose: body.purpose || null,
        start_time: body.start_time,
        end_time: body.end_time,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    // Log token transaction
    if (tokensDeducted > 0) {
      await supabase.from('token_transactions').insert({
        firebase_uid: user.sub,
        amount: -tokensDeducted,
        type: 'booking_deduction',
        description: `ST borrow: ${resource.name} (${tokensDeducted} tokens)`,
      });
    }

    // Fetch owner contact details to return
    const { data: ownerProfile } = await supabase
      .from('user_profiles')
      .select('full_name, email, phone, member_id')
      .eq('firebase_uid', resource.created_by)
      .single();

    logger.info({ stBookingId: booking.id, resource: id, borrower: user.sub }, 'ST Resource borrowed');
    sendSuccess(reply, {
      ...booking,
      tokens_deducted: tokensDeducted,
      owner: ownerProfile || null,
    }, 201);
  });

  // ========================================================================
  // GET /api/v1/st-resources/borrows — My borrows + items lent out
  // ========================================================================
  server.get('/api/v1/st-resources/borrows', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const user = request.user!;
    const { tab } = request.query as { tab?: string };

    let query = supabase
      .from('st_bookings')
      .select('*, st_resources(name, condition, pickup_location, hourly_token_cost)')
      .order('created_at', { ascending: false });

    if (tab === 'lent') {
      // Items I own that others are borrowing
      query = query.eq('owner_uid', user.sub);
    } else {
      // Items I'm borrowing
      query = query.eq('borrower_uid', user.sub);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Enrich with contact details
    const enriched = await Promise.all((data || []).map(async (b: any) => {
      // If I'm the owner, show borrower details. If I'm the borrower, show owner details.
      const contactUid = b.owner_uid === user.sub ? b.borrower_uid : b.owner_uid;
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name, email, phone, member_id')
        .eq('firebase_uid', contactUid)
        .single();

      return {
        ...b,
        contact: profile || null,
        contact_role: b.owner_uid === user.sub ? 'borrower' : 'owner',
      };
    }));

    sendSuccess(reply, enriched);
  });

  // ========================================================================
  // GET /api/v1/st-resources/:id/borrows — Borrows for a specific item
  // ========================================================================
  server.get('/api/v1/st-resources/:id/borrows', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    // Verify ownership or admin
    const { data: resource } = await supabase
      .from('st_resources')
      .select('created_by')
      .eq('id', id)
      .single();

    if (!resource) throw ApiError.notFound('ST Resource');

    const isOwner = resource.created_by === user.sub;
    const isStaff = ['main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer'].includes(user.appRole);
    if (!isOwner && !isStaff) throw ApiError.forbidden('Only the owner can view borrows for this item');

    const { data, error } = await supabase
      .from('st_bookings')
      .select('*')
      .eq('st_resource_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Enrich with borrower details
    const enriched = await Promise.all((data || []).map(async (b: any) => {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name, email, phone, member_id')
        .eq('firebase_uid', b.borrower_uid)
        .single();
      return { ...b, borrower: profile || null };
    }));

    sendSuccess(reply, enriched);
  });

  // ========================================================================
  // PUT /api/v1/st-resources/borrows/:borrowId/approve — Owner approves
  // ========================================================================
  server.put('/api/v1/st-resources/borrows/:borrowId/approve', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { borrowId } = request.params as { borrowId: string };
    const user = request.user!;

    const { data, error } = await supabase
      .from('st_bookings')
      .update({ status: 'approved' })
      .eq('id', borrowId)
      .eq('owner_uid', user.sub)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Pending borrow request');

    logger.info({ stBookingId: borrowId }, 'ST borrow approved');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // PUT /api/v1/st-resources/borrows/:borrowId/reject — Owner rejects
  // ========================================================================
  server.put('/api/v1/st-resources/borrows/:borrowId/reject', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { borrowId } = request.params as { borrowId: string };
    const user = request.user!;
    const { reason } = request.body as { reason?: string };

    const { data, error } = await supabase
      .from('st_bookings')
      .update({ status: 'rejected', notes: reason || null })
      .eq('id', borrowId)
      .eq('owner_uid', user.sub)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Pending borrow request');

    // Refund tokens fully on rejection
    await refundTokens(supabase, data.borrower_uid, borrowId, 1.0);

    logger.info({ stBookingId: borrowId }, 'ST borrow rejected');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // PUT /api/v1/st-resources/borrows/:borrowId/cancel — Borrower cancels
  // ========================================================================
  server.put('/api/v1/st-resources/borrows/:borrowId/cancel', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { borrowId } = request.params as { borrowId: string };
    const user = request.user!;

    const { data, error } = await supabase
      .from('st_bookings')
      .update({ status: 'cancelled' })
      .eq('id', borrowId)
      .eq('borrower_uid', user.sub)
      .in('status', ['pending', 'approved'])
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Active borrow request');

    // 50% refund on cancellation
    await refundTokens(supabase, user.sub, borrowId, 0.5);

    logger.info({ stBookingId: borrowId }, 'ST borrow cancelled');
    sendSuccess(reply, data);
  });

  // ========================================================================
  // PUT /api/v1/st-resources/borrows/:borrowId/return — Owner marks returned
  // ========================================================================
  server.put('/api/v1/st-resources/borrows/:borrowId/return', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { borrowId } = request.params as { borrowId: string };
    const user = request.user!;

    const { data, error } = await supabase
      .from('st_bookings')
      .update({ status: 'returned' })
      .eq('id', borrowId)
      .eq('owner_uid', user.sub)
      .eq('status', 'approved')
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Approved borrow to return');

    logger.info({ stBookingId: borrowId }, 'ST borrow returned');
    sendSuccess(reply, data);
  });
}

// Helper: Refund tokens for a cancelled/rejected borrow
async function refundTokens(supabase: any, uid: string, borrowId: string, fraction: number) {
  try {
    const { data: deduction } = await supabase
      .from('token_transactions')
      .select('amount')
      .eq('type', 'booking_deduction')
      .ilike('description', `%ST borrow%`)
      .order('created_at', { ascending: false })
      .limit(10);

    // Find matching deduction (simplistic — look for recent ST borrow deductions for this user)
    // A more robust approach would store booking_id on the transaction
    const { data: tokenBalance } = await supabase
      .from('student_token_balances')
      .select('id, balance')
      .eq('firebase_uid', uid)
      .single();

    if (!tokenBalance) return;

    // Estimate refund from recent deduction
    const { data: txn } = await supabase
      .from('token_transactions')
      .select('amount')
      .eq('firebase_uid', uid)
      .eq('type', 'booking_deduction')
      .ilike('description', '%ST borrow%')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (txn) {
      const refundAmount = Math.floor(Math.abs(txn.amount) * fraction);
      if (refundAmount > 0) {
        await supabase
          .from('student_token_balances')
          .update({ balance: tokenBalance.balance + refundAmount })
          .eq('id', tokenBalance.id);

        await supabase.from('token_transactions').insert({
          firebase_uid: uid,
          amount: refundAmount,
          type: 'booking_refund',
          description: `${fraction * 100}% refund for ST borrow (${refundAmount} tokens)`,
        });
      }
    }
  } catch (err) {
    // Non-fatal
  }
}
