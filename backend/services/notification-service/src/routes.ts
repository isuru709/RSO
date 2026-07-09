/**
 * Notification Service Routes + Event Consumer
 * 
 * Listens to Redis Streams for booking, resource, and user events.
 * Creates in-app notifications + sends styled emails via Resend.
 * 
 * Email recipients:
 * - User: gets confirmation/notification about their own activity
 * - Tenant Admin: gets notified about all activity in their tenant
 * - Main Admin: gets notified about all system-wide activity
 */

import { FastifyInstance } from 'fastify';
import {
  authMiddleware,
  getSupabaseClient,
  consumeEvents,
  ApiError,
  sendSuccess,
  sendPaginated,
  logger,
} from '@rso/shared';
import type { StreamEvent } from '@rso/shared';

// ============================================================================
// Styled HTML Email Builder
// ============================================================================
function buildEmailHtml(opts: {
  title: string;
  greeting?: string;
  body: string;
  details?: { label: string; value: string }[];
  ctaText?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const detailsHtml = opts.details?.length
    ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;">
        ${opts.details.map(d => `
          <tr>
            <td style="padding:8px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;width:140px;">${d.label}</td>
            <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#1f2937;border-bottom:1px solid #f3f4f6;">${d.value}</td>
          </tr>
        `).join('')}
       </table>`
    : '';

  const ctaHtml = opts.ctaText && opts.ctaUrl
    ? `<a href="${opts.ctaUrl}" style="display:inline-block;padding:10px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;margin:16px 0;">${opts.ctaText}</a>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <!-- Header -->
    <div style="text-align:center;padding:20px 0;">
      <div style="display:inline-block;padding:8px 16px;background:linear-gradient(135deg,#7c3aed,#6366f1);border-radius:8px;">
        <span style="color:#fff;font-weight:700;font-size:16px;letter-spacing:0.5px;">🎓 CampusRSO</span>
      </div>
    </div>
    <!-- Card -->
    <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:32px 24px;margin-bottom:16px;">
      <h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">${opts.title}</h2>
      ${opts.greeting ? `<p style="margin:0 0 16px;font-size:14px;color:#6b7280;">${opts.greeting}</p>` : ''}
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151;">${opts.body}</p>
      ${detailsHtml}
      ${ctaHtml}
    </div>
    <!-- Footer -->
    <div style="text-align:center;padding:12px 0;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">
        ${opts.footer || 'This is an automated notification from CampusRSO. Please do not reply to this email.'}
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ============================================================================
// Email Sender (Resend)
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
// Helper: Get admin emails
// ============================================================================
async function getTenantAdminEmails(tenantId: string): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('role', 'tenant_admin');
  return (data || []).map(u => u.email).filter(Boolean);
}

async function getMainAdminEmails(): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('role', 'main_admin');
  return (data || []).map(u => u.email).filter(Boolean);
}

async function getUserEmail(uid: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('firebase_uid', uid)
    .single();
  return data?.email || null;
}

async function getTenantName(tenantId: string): Promise<string> {
  if (!tenantId || tenantId === 'system') return 'System';
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single();
  return data?.name || 'Unknown Faculty';
}

// ============================================================================
// Helper: Create in-app notification
// ============================================================================
async function createNotification(tenantId: string, recipient: string, type: string, title: string, body: string, payload: Record<string, unknown>) {
  const supabase = getSupabaseClient();
  await supabase.from('notifications').insert({
    tenant_id: tenantId !== 'system' ? tenantId : null,
    recipient,
    type,
    title,
    body,
    payload: payload as any,
  });
}

// ============================================================================
// Helper: Notify admins (both tenant + main)
// ============================================================================
async function notifyAdmins(tenantId: string, subject: string, emailHtml: string, notifType: string, notifTitle: string, notifBody: string, payload: Record<string, unknown>) {
  const supabase = getSupabaseClient();

  // Notify tenant admins
  if (tenantId && tenantId !== 'system') {
    const { data: tenantAdmins } = await supabase
      .from('user_profiles')
      .select('firebase_uid, email')
      .eq('tenant_id', tenantId)
      .eq('role', 'tenant_admin');

    for (const admin of tenantAdmins || []) {
      await createNotification(tenantId, admin.firebase_uid, notifType, notifTitle, notifBody, payload);
      if (admin.email) await sendEmail(admin.email, subject, emailHtml);
    }
  }

  // Notify main admins
  const { data: mainAdmins } = await supabase
    .from('user_profiles')
    .select('firebase_uid, email')
    .eq('role', 'main_admin');

  for (const admin of mainAdmins || []) {
    await createNotification(tenantId, admin.firebase_uid, notifType, `[System] ${notifTitle}`, notifBody, payload);
    if (admin.email) await sendEmail(admin.email, `[CampusRSO] ${subject}`, emailHtml);
  }
}

// ============================================================================
// Booking Owner Helper
// ============================================================================
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
// Event Handlers
// ============================================================================

async function handleBookingEvent(event: StreamEvent): Promise<void> {
  const { type, payload, tenantId } = event;
  logger.info({ type, payload }, 'Processing booking event');

  const tenantName = await getTenantName(tenantId);

  switch (type) {
    case 'booking.created': {
      // 1. Notify the user who created the booking
      const userEmail = await getUserEmail(payload.booked_by as string);
      if (userEmail) {
        const html = buildEmailHtml({
          title: 'Booking Submitted ✅',
          greeting: 'Your booking request has been submitted successfully.',
          body: 'Your booking is now pending approval. You will receive an email once it has been reviewed.',
          details: [
            { label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) },
          ],
        });
        await sendEmail(userEmail, 'Booking Submitted — CampusRSO', html);
      }

      // 2. Notify in-app for the user
      if (payload.booked_by) {
        await createNotification(tenantId, payload.booked_by as string, 'booking_created', 'Booking Submitted', 'Your booking request has been submitted and is pending approval.', payload);
      }

      // 3. Notify tenant admins + main admins
      const adminHtml = buildEmailHtml({
        title: 'New Booking Request',
        body: `A new booking has been submitted in <strong>${tenantName}</strong> and needs your approval.`,
        details: [
          { label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) },
          { label: 'Faculty', value: tenantName },
        ],
      });
      await notifyAdmins(tenantId, `New Booking Request — ${tenantName}`, adminHtml, 'booking_created', 'New Booking Request', 'A new booking has been submitted and needs approval.', payload);
      return;
    }

    case 'booking.approved': {
      const uid = await getBookingOwner(payload.booking_id as string);
      if (!uid) return;

      // Notify user
      const userEmail = await getUserEmail(uid);
      const html = buildEmailHtml({
        title: 'Booking Approved ✅',
        greeting: 'Great news!',
        body: 'Your booking request has been approved. You can now use the resource at your scheduled time.',
        details: [
          { label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) },
        ],
      });
      await createNotification(tenantId, uid, 'booking_approved', 'Booking Approved ✅', 'Your booking request has been approved.', payload);
      if (userEmail) await sendEmail(userEmail, 'Booking Approved — CampusRSO', html);

      // Notify admins
      const adminHtml = buildEmailHtml({
        title: 'Booking Approved',
        body: `A booking has been approved in <strong>${tenantName}</strong>.`,
        details: [{ label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) }, { label: 'Faculty', value: tenantName }],
      });
      await notifyAdmins(tenantId, `Booking Approved — ${tenantName}`, adminHtml, 'booking_approved', 'Booking Approved', 'A booking has been approved.', payload);
      return;
    }

    case 'booking.rejected': {
      const uid = await getBookingOwner(payload.booking_id as string);
      if (!uid) return;

      const reason = payload.reason ? ` Reason: ${payload.reason}` : '';
      const userEmail = await getUserEmail(uid);
      const html = buildEmailHtml({
        title: 'Booking Rejected ❌',
        body: `Unfortunately, your booking request has been rejected.${reason}`,
        details: [
          { label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) },
          ...(payload.reason ? [{ label: 'Reason', value: payload.reason as string }] : []),
        ],
      });
      await createNotification(tenantId, uid, 'booking_rejected', 'Booking Rejected ❌', `Your booking request has been rejected.${reason}`, payload);
      if (userEmail) await sendEmail(userEmail, 'Booking Rejected — CampusRSO', html);

      // Notify admins
      const adminHtml = buildEmailHtml({
        title: 'Booking Rejected',
        body: `A booking has been rejected in <strong>${tenantName}</strong>.${reason}`,
        details: [{ label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) }, { label: 'Faculty', value: tenantName }],
      });
      await notifyAdmins(tenantId, `Booking Rejected — ${tenantName}`, adminHtml, 'booking_rejected', 'Booking Rejected', `A booking has been rejected.${reason}`, payload);
      return;
    }

    case 'booking.cancelled': {
      const uid = await getBookingOwner(payload.booking_id as string);
      if (!uid) return;

      const userEmail = await getUserEmail(uid);
      const html = buildEmailHtml({
        title: 'Booking Cancelled',
        body: 'A booking has been cancelled.',
        details: [
          { label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) },
        ],
      });
      await createNotification(tenantId, uid, 'booking_cancelled', 'Booking Cancelled', 'A booking has been cancelled.', payload);
      if (userEmail) await sendEmail(userEmail, 'Booking Cancelled — CampusRSO', html);

      // Notify admins
      const adminHtml = buildEmailHtml({
        title: 'Booking Cancelled',
        body: `A booking has been cancelled in <strong>${tenantName}</strong>.`,
        details: [{ label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) }, { label: 'Faculty', value: tenantName }],
      });
      await notifyAdmins(tenantId, `Booking Cancelled — ${tenantName}`, adminHtml, 'booking_cancelled', 'Booking Cancelled', 'A booking has been cancelled.', payload);
      return;
    }

    case 'booking.updated': {
      const uid = await getBookingOwner(payload.booking_id as string);
      if (!uid) return;

      const userEmail = await getUserEmail(uid);
      const html = buildEmailHtml({
        title: 'Booking Updated ✏️',
        body: 'Your booking has been modified by an administrator.',
        details: [
          { label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) },
        ],
      });
      await createNotification(tenantId, uid, 'booking_updated', 'Booking Updated ✏️', 'Your booking has been modified by an administrator.', payload);
      if (userEmail) await sendEmail(userEmail, 'Booking Updated — CampusRSO', html);

      // Notify admins
      const adminHtml = buildEmailHtml({
        title: 'Booking Updated',
        body: `A booking has been updated in <strong>${tenantName}</strong>.`,
        details: [{ label: 'Booking ID', value: (payload.booking_id as string).slice(0, 8) }, { label: 'Faculty', value: tenantName }],
      });
      await notifyAdmins(tenantId, `Booking Updated — ${tenantName}`, adminHtml, 'booking_updated', 'Booking Updated', 'A booking has been updated.', payload);
      return;
    }

    default:
      logger.debug({ type }, 'Unknown booking event type — skipping');
  }
}

async function handleSystemEvent(event: StreamEvent): Promise<void> {
  const { type, payload, tenantId } = event;
  logger.info({ type, payload }, 'Processing system event');

  const tenantName = await getTenantName(tenantId);

  switch (type) {
    // ── Resource Events ───────────────────────────────────────────────────
    case 'resource.created': {
      const role = payload.created_by_role as string;
      const resourceName = payload.name as string || 'Unknown';

      // Notify the creator
      if (payload.created_by) {
        const userEmail = await getUserEmail(payload.created_by as string);
        const html = buildEmailHtml({
          title: 'Resource Created ✅',
          greeting: 'Your resource has been created successfully.',
          body: `The resource <strong>${resourceName}</strong> is now available in CampusRSO.`,
          details: [
            { label: 'Resource', value: resourceName },
            { label: 'Category', value: (payload.category as string) || 'General' },
            { label: 'Faculty', value: tenantName },
          ],
        });
        await createNotification(tenantId, payload.created_by as string, 'resource_created', 'Resource Created', `Your resource "${resourceName}" has been created.`, payload);
        if (userEmail) await sendEmail(userEmail, 'Resource Created — CampusRSO', html);
      }

      // Notify admins
      const adminHtml = buildEmailHtml({
        title: 'New Resource Added',
        body: `A new resource <strong>${resourceName}</strong> has been added${role === 'student' ? ' by a student (ST Resource)' : ''} in <strong>${tenantName}</strong>.`,
        details: [
          { label: 'Resource', value: resourceName },
          { label: 'Category', value: (payload.category as string) || 'General' },
          { label: 'Faculty', value: tenantName },
        ],
      });
      await notifyAdmins(tenantId, `New Resource — ${tenantName}`, adminHtml, 'resource_created', 'New Resource Added', `Resource "${resourceName}" has been added.`, payload);
      return;
    }

    case 'resource.updated': {
      const resourceName = payload.name as string || 'Unknown';

      // Notify admins only (updates are typically admin actions)
      const adminHtml = buildEmailHtml({
        title: 'Resource Updated',
        body: `The resource <strong>${resourceName}</strong> has been updated in <strong>${tenantName}</strong>.`,
        details: [
          { label: 'Resource', value: resourceName },
          { label: 'Faculty', value: tenantName },
        ],
      });
      await notifyAdmins(tenantId, `Resource Updated — ${tenantName}`, adminHtml, 'resource_updated', 'Resource Updated', `Resource "${resourceName}" has been updated.`, payload);
      return;
    }

    case 'resource.deleted': {
      const resourceName = payload.name as string || 'Unknown';

      // Notify admins
      const adminHtml = buildEmailHtml({
        title: 'Resource Deleted ⚠️',
        body: `The resource <strong>${resourceName}</strong> has been deleted from <strong>${tenantName}</strong>.`,
        details: [
          { label: 'Resource', value: resourceName },
          { label: 'Faculty', value: tenantName },
        ],
      });
      await notifyAdmins(tenantId, `Resource Deleted — ${tenantName}`, adminHtml, 'resource_deleted', 'Resource Deleted', `Resource "${resourceName}" has been deleted.`, payload);
      return;
    }

    // ── User Events ───────────────────────────────────────────────────────
    case 'user.signup': {
      const email = payload.email as string;
      const fullName = payload.full_name as string || 'New User';
      const tName = payload.tenant_name as string || tenantName;

      // Welcome email to user
      if (email) {
        const html = buildEmailHtml({
          title: 'Welcome to CampusRSO! 🎉',
          greeting: `Hello ${fullName},`,
          body: 'Your account has been created successfully. You can now browse resources, create bookings, and share student resources with your peers.',
          details: [
            { label: 'Faculty', value: tName },
            { label: 'Role', value: 'Student' },
          ],
          footer: 'Welcome aboard! If you have any questions, contact your faculty admin.',
        });
        await sendEmail(email, 'Welcome to CampusRSO! 🎉', html);
      }

      // Notify admins
      const adminHtml = buildEmailHtml({
        title: 'New User Registered',
        body: `<strong>${fullName}</strong> (${email}) has joined <strong>${tName}</strong>.`,
        details: [
          { label: 'Name', value: fullName },
          { label: 'Email', value: email },
          { label: 'Faculty', value: tName },
        ],
      });
      await notifyAdmins(tenantId, `New User — ${tName}`, adminHtml, 'user_signup', 'New User Registered', `${fullName} has joined ${tName}.`, payload);
      return;
    }

    case 'user.role_changed': {
      const email = payload.email as string;
      const fullName = payload.full_name as string || 'User';
      const newRole = (payload.new_role as string)?.replace('_', ' ') || 'unknown';

      // Notify the affected user
      if (email) {
        const html = buildEmailHtml({
          title: 'Your Role Has Been Updated',
          greeting: `Hello ${fullName},`,
          body: `Your role has been changed to <strong>${newRole}</strong>. This change takes effect immediately.`,
          details: [
            { label: 'New Role', value: newRole },
            { label: 'Faculty', value: tenantName },
          ],
        });
        await sendEmail(email, 'Role Updated — CampusRSO', html);
      }

      // In-app notification to user
      if (payload.uid) {
        await createNotification(tenantId, payload.uid as string, 'user_role_changed', 'Role Updated', `Your role has been changed to ${newRole}.`, payload);
      }

      // Notify admins
      const adminHtml = buildEmailHtml({
        title: 'User Role Changed',
        body: `<strong>${fullName}</strong>'s role has been changed to <strong>${newRole}</strong> in <strong>${tenantName}</strong>.`,
        details: [
          { label: 'User', value: `${fullName} (${email})` },
          { label: 'New Role', value: newRole },
          { label: 'Faculty', value: tenantName },
        ],
      });
      await notifyAdmins(tenantId, `Role Change — ${tenantName}`, adminHtml, 'user_role_changed', 'User Role Changed', `${fullName}'s role changed to ${newRole}.`, payload);
      return;
    }

    case 'user.banned': {
      const email = payload.email as string;
      const fullName = payload.full_name as string || 'User';
      const reason = payload.reason as string || 'No reason provided';

      // Notify the banned user
      if (email) {
        const html = buildEmailHtml({
          title: 'Account Suspended ⚠️',
          greeting: `Hello ${fullName},`,
          body: 'Your CampusRSO account has been suspended by an administrator. You will not be able to access the system until your account is reactivated.',
          details: [
            { label: 'Reason', value: reason },
          ],
          footer: 'If you believe this was a mistake, please contact your faculty administrator.',
        });
        await sendEmail(email, 'Account Suspended — CampusRSO', html);
      }

      // In-app notification (they won't see it until unbanned, but it's recorded)
      if (payload.uid) {
        await createNotification(tenantId, payload.uid as string, 'user_banned', 'Account Suspended', `Your account has been suspended. Reason: ${reason}`, payload);
      }

      // Notify tenant admins
      const adminHtml = buildEmailHtml({
        title: 'User Suspended',
        body: `<strong>${fullName}</strong> (${email}) has been suspended in <strong>${tenantName}</strong>.`,
        details: [
          { label: 'User', value: `${fullName} (${email})` },
          { label: 'Reason', value: reason },
          { label: 'Faculty', value: tenantName },
        ],
      });
      await notifyAdmins(tenantId, `User Suspended — ${tenantName}`, adminHtml, 'user_banned', 'User Suspended', `${fullName} has been suspended.`, payload);
      return;
    }

    case 'user.unbanned': {
      const email = payload.email as string;
      const fullName = payload.full_name as string || 'User';

      // Notify the user
      if (email) {
        const html = buildEmailHtml({
          title: 'Account Reactivated ✅',
          greeting: `Hello ${fullName},`,
          body: 'Your CampusRSO account has been reactivated. You can now log in and use all features again.',
        });
        await sendEmail(email, 'Account Reactivated — CampusRSO', html);
      }

      if (payload.uid) {
        await createNotification(tenantId, payload.uid as string, 'user_unbanned', 'Account Reactivated', 'Your account has been reactivated.', payload);
      }

      // Notify tenant admins
      const adminHtml = buildEmailHtml({
        title: 'User Reactivated',
        body: `<strong>${fullName}</strong> (${email}) has been reactivated in <strong>${tenantName}</strong>.`,
        details: [
          { label: 'User', value: `${fullName} (${email})` },
          { label: 'Faculty', value: tenantName },
        ],
      });
      await notifyAdmins(tenantId, `User Reactivated — ${tenantName}`, adminHtml, 'user_unbanned', 'User Reactivated', `${fullName} has been reactivated.`, payload);
      return;
    }

    case 'user.deleted': {
      const email = payload.email as string;
      const fullName = payload.full_name as string || 'User';

      // Notify admins (user is already deleted, can't receive email)
      const adminHtml = buildEmailHtml({
        title: 'User Account Deleted',
        body: `<strong>${fullName}</strong> (${email}) has been removed from <strong>${tenantName}</strong>.`,
        details: [
          { label: 'User', value: `${fullName} (${email})` },
          { label: 'Faculty', value: tenantName },
        ],
      });
      await notifyAdmins(tenantId, `User Deleted — ${tenantName}`, adminHtml, 'user_deleted', 'User Deleted', `${fullName} has been removed.`, payload);
      return;
    }

    default:
      logger.debug({ type }, 'Unknown system event type — skipping');
  }
}

// ============================================================================
// Start Event Consumers
// ============================================================================
export function startBookingEventConsumer(): void {
  consumeEvents(
    'booking-events',
    'notification-service',
    `notifier-booking-${process.pid}`,
    handleBookingEvent,
    { blockMs: 5000, count: 10 },
  ).catch(err => {
    logger.error({ err }, 'Booking event consumer crashed');
  });

  logger.info('Booking event consumer started');
}

export function startSystemEventConsumer(): void {
  consumeEvents(
    'system-events',
    'notification-service',
    `notifier-system-${process.pid}`,
    handleSystemEvent,
    { blockMs: 5000, count: 10 },
  ).catch(err => {
    logger.error({ err }, 'System event consumer crashed');
  });

  logger.info('System event consumer started');
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
