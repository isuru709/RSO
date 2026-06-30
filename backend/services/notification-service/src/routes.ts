/**
 * Notification Service Routes + Event Consumer
 * 
 * Listens to Redis Streams for booking events and creates
 * in-app notifications + sends emails via Resend.
 */

import { FastifyInstance } from 'fastify';
import {
  authMiddleware,
  getSupabaseClient,
  consumeEvents,
  createConsumerGroup,
  ApiError,
  sendSuccess,
  sendPaginated,
  logger,
} from '@rso/shared';
import type { StreamEvent } from '@rso/shared';

// ============================================================================
// Email sender (Resend)
// ============================================================================
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL || 'onboarding@resend.dev';

  if (!apiKey) {
    logger.warn('RESEND_API_KEY not set — skipping email');
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ err, to, subject }, 'Resend API error');
    } else {
      logger.info({ to, subject }, 'Email sent');
    }
  } catch (err) {
    logger.error({ err, to, subject }, 'Failed to send email');
  }
}

// ============================================================================
// Event Handler
// ============================================================================
async function handleBookingEvent(event: StreamEvent): Promise<void> {
  const supabase = getSupabaseClient();
  const { type, payload, tenantId } = event;

  logger.info({ type, payload }, 'Processing booking event');

  let recipientUid: string | undefined;
  let title: string;
  let body: string;
  let notificationType: string;

  switch (type) {
    case 'booking.created': {
      // Notify tenant admins about new booking
      const { data: admins } = await supabase
        .from('user_profiles')
        .select('firebase_uid, email')
        .eq('tenant_id', tenantId)
        .eq('role', 'tenant_admin');

      title = 'New Booking Request';
      body = `A new booking has been submitted and needs approval.`;
      notificationType = 'booking_created';

      for (const admin of admins || []) {
        await supabase.from('notifications').insert({
          tenant_id: tenantId,
          recipient: admin.firebase_uid,
          type: notificationType,
          title,
          body,
          payload: payload as any,
        });

        if (admin.email) {
          await sendEmail(admin.email, title, `<p>${body}</p>`);
        }
      }
      return;
    }

    case 'booking.approved': {
      recipientUid = await getBookingOwner(payload.booking_id as string);
      title = 'Booking Approved ✅';
      body = 'Your booking request has been approved.';
      notificationType = 'booking_approved';
      break;
    }

    case 'booking.rejected': {
      recipientUid = await getBookingOwner(payload.booking_id as string);
      const reason = payload.reason ? ` Reason: ${payload.reason}` : '';
      title = 'Booking Rejected ❌';
      body = `Your booking request has been rejected.${reason}`;
      notificationType = 'booking_rejected';
      break;
    }

    case 'booking.cancelled': {
      recipientUid = await getBookingOwner(payload.booking_id as string);
      title = 'Booking Cancelled';
      body = 'A booking has been cancelled.';
      notificationType = 'booking_cancelled';
      break;
    }

    case 'booking.updated': {
      recipientUid = await getBookingOwner(payload.booking_id as string);
      title = 'Booking Updated ✏️';
      body = 'Your booking has been modified by an administrator.';
      notificationType = 'booking_updated';
      break;
    }

    default:
      logger.debug({ type }, 'Unknown event type — skipping');
      return;
  }

  if (!recipientUid) return;

  // Create in-app notification
  await supabase.from('notifications').insert({
    tenant_id: tenantId,
    recipient: recipientUid,
    type: notificationType,
    title,
    body,
    payload: payload as any,
  });

  // Send email
  const { data: recipient } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('firebase_uid', recipientUid)
    .single();

  if (recipient?.email) {
    await sendEmail(recipient.email, title, `<p>${body}</p>`);
  }
}

async function getBookingOwner(bookingId: string): Promise<string | undefined> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('bookings')
    .select('booked_by')
    .eq('id', bookingId)
    .single();
  return data?.booked_by;
}

// ============================================================================
// Start Event Consumer
// ============================================================================
export function startEventConsumer(): void {
  consumeEvents(
    'booking-events',
    'notification-service',
    `notifier-${process.pid}`,
    handleBookingEvent,
    { blockMs: 5000, count: 10 },
  ).catch(err => {
    logger.error({ err }, 'Event consumer crashed');
  });

  logger.info('Notification event consumer started');
}

// ============================================================================
// HTTP Routes
// ============================================================================
export async function notificationRoutes(server: FastifyInstance): Promise<void> {
  const supabase = getSupabaseClient();

  // ========================================================================
  // GET /api/v1/notifications — Get own notifications
  // ========================================================================
  server.get('/api/v1/notifications', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { page = '1', limit = '20', unread_only } = request.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('recipient', request.user!.sub);

    if (unread_only === 'true') query = query.eq('is_read', false);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    sendPaginated(reply, data || [], count || 0, pageNum, limitNum);
  });

  // ========================================================================
  // PUT /api/v1/notifications/:id/read — Mark as read
  // ========================================================================
  server.put('/api/v1/notifications/:id/read', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('recipient', request.user!.sub)
      .select()
      .single();

    if (error || !data) throw ApiError.notFound('Notification');

    sendSuccess(reply, data);
  });

  // ========================================================================
  // PUT /api/v1/notifications/read-all — Mark all as read
  // ========================================================================
  server.put('/api/v1/notifications/read-all', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient', request.user!.sub)
      .eq('is_read', false);

    if (error) throw error;

    sendSuccess(reply, { message: 'All notifications marked as read' });
  });

  // ========================================================================
  // GET /api/v1/notifications/unread-count — Get unread count
  // ========================================================================
  server.get('/api/v1/notifications/unread-count', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient', request.user!.sub)
      .eq('is_read', false);

    if (error) throw error;

    sendSuccess(reply, { unread_count: count || 0 });
  });
}
