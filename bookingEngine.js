// =============================================================================
// Booking & Priority Engine — Express.js / Node.js
// File: src/services/bookingEngine.js
//
// ARCHITECTURE DECISION:
//   This service runs with the Supabase SERVICE_ROLE key so it bypasses
//   all RLS policies. Access control is enforced HERE in application code,
//   after the Firebase JWT has been verified by the Auth Middleware.
//
//   Flow:
//     1. Auth Middleware validates Firebase JWT → attaches req.user
//     2. Route handler calls BookingEngine methods
//     3. BookingEngine enforces RBAC + priority logic
//     4. Supabase service client writes atomically
//     5. RabbitMQ event published → Notification Service consumes
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import amqplib from 'amqplib';

// ── Supabase service-role client (bypasses RLS) ──────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // never expose this to the client
);

// ── Priority weights (must mirror role_priority_weight() in SQL) ──────────────
const PRIORITY = {
  MAIN_ADMIN:      1,
  TENANT_ADMIN:    2,
  LECTURER:        3,
  JUNIOR_LECTURER: 4,
  STAFF:           5,
  STUDENT:         6,
};

// Roles that require Tenant Admin approval before APPROVED
const REQUIRES_APPROVAL = new Set(['STAFF', 'STUDENT']);

// Students may only book EQUIPMENT
const STUDENT_ALLOWED_CATEGORIES = new Set(['EQUIPMENT']);

// Grace period constant (hours). Bumping forbidden within this window.
// Also stored per-resource in resources.bump_grace_hours; we read that below.
const DEFAULT_GRACE_HOURS = 24;


// =============================================================================
// RABBITMQ PUBLISHER
// =============================================================================
let rabbitChannel = null;

async function getRabbitChannel() {
  if (rabbitChannel) return rabbitChannel;
  const conn = await amqplib.connect(process.env.RABBITMQ_URL);
  rabbitChannel = await conn.createChannel();
  // Durable exchanges survive broker restart
  await rabbitChannel.assertExchange('booking_events', 'topic', { durable: true });
  return rabbitChannel;
}

async function publishEvent(routingKey, payload) {
  try {
    const ch = await getRabbitChannel();
    ch.publish(
      'booking_events',
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true }
    );
  } catch (err) {
    console.error('[RabbitMQ] Failed to publish event:', routingKey, err.message);
    // Non-fatal: booking is already committed to DB
  }
}


// =============================================================================
// HELPERS
// =============================================================================

/**
 * Fetch the full user record from Supabase by firebase_uid.
 * Called after Auth Middleware to get DB role, tenant_id, etc.
 */
async function getUserByFirebaseUid(firebaseUid) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('firebase_uid', firebaseUid)
    .single();
  if (error || !data) throw new Error('User not found in database');
  return data;
}

/**
 * Fetch resource with validation.
 * Returns { resource } or throws an error with HTTP status attached.
 */
async function getResource(resourceId) {
  const { data, error } = await supabase
    .from('resources')
    .select('*')
    .eq('id', resourceId)
    .single();
  if (error || !data) {
    const err = new Error('Resource not found');
    err.status = 404;
    throw err;
  }
  return data;
}

/**
 * Write a row to audit_logs (fire-and-forget, errors are swallowed to not
 * block the main booking response).
 */
async function writeAuditLog(actor, action, table, targetId, oldData, newData) {
  supabase.from('audit_logs').insert({
    actor_id:     actor.id,
    actor_role:   actor.role,
    tenant_id:    actor.tenant_id,
    action,
    target_table: table,
    target_id:    targetId,
    old_data:     oldData,
    new_data:     newData,
  }).then(() => {}).catch(console.error);
}


// =============================================================================
// CORE BOOKING FUNCTION
// =============================================================================

/**
 * createBooking — the heart of the engine.
 *
 * @param {object} actor    - Full user row from DB (the person making the request)
 * @param {object} input    - { resource_id, start_time, end_time, title, notes, attendee_count }
 * @returns {object}        - { booking, bumped: [] }
 */
export async function createBooking(actor, input) {
  const { resource_id, start_time, end_time, title, notes, attendee_count } = input;

  const startDt = new Date(start_time);
  const endDt   = new Date(end_time);

  // ── 1. Basic input validation ──────────────────────────────────────────────
  if (isNaN(startDt) || isNaN(endDt))
    throw Object.assign(new Error('Invalid date format'), { status: 400 });
  if (endDt <= startDt)
    throw Object.assign(new Error('end_time must be after start_time'), { status: 400 });
  if (startDt < new Date())
    throw Object.assign(new Error('Cannot book in the past'), { status: 400 });

  // ── 2. Load resource ───────────────────────────────────────────────────────
  const resource = await getResource(resource_id);

  if (resource.status !== 'AVAILABLE')
    throw Object.assign(new Error(`Resource is ${resource.status}`), { status: 409 });

  // ── 3. RBAC: can this role access this resource? ───────────────────────────
  // 3a. Student category restriction
  if (actor.role === 'STUDENT' && !STUDENT_ALLOWED_CATEGORIES.has(resource.category)) {
    throw Object.assign(
      new Error('Students may only book EQUIPMENT resources'),
      { status: 403 }
    );
  }

  // 3b. Tenant isolation
  if (resource.tenant_id !== null) {
    // Tenant-owned resource — user must belong to the same tenant
    if (
      actor.role !== 'MAIN_ADMIN' &&
      actor.tenant_id !== resource.tenant_id
    ) {
      throw Object.assign(
        new Error('You do not have access to this resource'),
        { status: 403 }
      );
    }
  } else {
    // Global resource — check allowed_roles array
    if (
      actor.role !== 'MAIN_ADMIN' &&
      !resource.allowed_roles.includes(actor.role)
    ) {
      throw Object.assign(
        new Error('Your role is not permitted to book this global resource'),
        { status: 403 }
      );
    }
  }

  // 3c. Advance booking limit
  const advanceDays = (startDt - new Date()) / (1000 * 60 * 60 * 24);
  if (advanceDays > resource.advance_booking_days) {
    throw Object.assign(
      new Error(`Bookings can only be made up to ${resource.advance_booking_days} days in advance`),
      { status: 400 }
    );
  }

  // 3d. Duration limits
  const durationMins = (endDt - startDt) / (1000 * 60);
  if (durationMins < resource.min_booking_minutes) {
    throw Object.assign(
      new Error(`Minimum booking duration is ${resource.min_booking_minutes} minutes`),
      { status: 400 }
    );
  }
  if (durationMins > resource.max_booking_hours * 60) {
    throw Object.assign(
      new Error(`Maximum booking duration is ${resource.max_booking_hours} hours`),
      { status: 400 }
    );
  }

  // ── 4. Determine initial booking status ───────────────────────────────────
  // LECTURER / JUNIOR_LECTURER → APPROVED immediately (unless resource overrides)
  // STAFF / STUDENT            → PENDING (Tenant Admin must approve)
  // MAIN_ADMIN / TENANT_ADMIN  → APPROVED immediately
  let initialStatus = REQUIRES_APPROVAL.has(actor.role) ? 'PENDING' : 'APPROVED';

  // Resource-level auto-approve override
  if (resource.auto_approve_roles.includes(actor.role)) {
    initialStatus = 'APPROVED';
  }

  // ── 5. Conflict detection ──────────────────────────────────────────────────
  const { data: overlapping, error: overlapErr } = await supabase.rpc(
    'find_overlapping_bookings',
    {
      p_resource_id: resource_id,
      p_start_time:  startDt.toISOString(),
      p_end_time:    endDt.toISOString(),
    }
  );
  if (overlapErr) throw new Error('Overlap check failed: ' + overlapErr.message);

  const bumpedBookings = [];

  if (overlapping && overlapping.length > 0) {
    const actorWeight = PRIORITY[actor.role];

    for (const existing of overlapping) {
      const existingWeight = existing.priority_weight;

      // ── Case A: Actor has EQUAL or LOWER priority → reject ────────────────
      if (actorWeight >= existingWeight) {
        // Suggest alternative slots before returning the 409
        const alternativeSlots = await getAlternativeSlots(
          resource_id, startDt, durationMins
        );

        const err = Object.assign(
          new Error('Time slot is already taken by a user with equal or higher priority'),
          {
            status: 409,
            code:   'SLOT_CONFLICT',
            conflicting_booking_id: existing.id,
            alternative_slots: alternativeSlots,
          }
        );
        throw err;
      }

      // ── Case B: Actor has HIGHER priority → check grace period ────────────
      const graceHours = resource.bump_grace_hours ?? DEFAULT_GRACE_HOURS;
      const hoursUntilStart = (new Date(existing.start_time) - new Date()) / (1000 * 60 * 60);

      if (hoursUntilStart < graceHours) {
        throw Object.assign(
          new Error(
            `Cannot override a booking less than ${graceHours} hours before it starts. ` +
            `The existing booking starts in ${Math.round(hoursUntilStart)} hours.`
          ),
          { status: 409, code: 'GRACE_PERIOD_VIOLATION' }
        );
      }

      // ── Case C: Valid bump — mark existing booking as BUMPED ───────────────
      bumpedBookings.push(existing);
    }
  }

  // ── 6. Atomically: bump old bookings + insert new booking ──────────────────
  // We do this in sequence with the service-role client (bypasses RLS).
  // The EXCLUSION constraint in the DB is the ultimate safety net.

  const now = new Date().toISOString();

  // Temporarily release the exclusive time slots by marking them BUMPED
  // BEFORE inserting the new booking, so the exclusion constraint doesn't fire.
  for (const bumped of bumpedBookings) {
    const { error } = await supabase
      .from('bookings')
      .update({
        status:    'BUMPED',
        bumped_at: now,
        updated_at: now,
      })
      .eq('id', bumped.id);
    if (error) throw new Error('Failed to bump booking: ' + error.message);
  }

  // Insert the new booking
  const { data: newBooking, error: insertError } = await supabase
    .from('bookings')
    .insert({
      tenant_id:       resource.tenant_id ?? actor.tenant_id,
      resource_id,
      user_id:         actor.id,
      start_time:      startDt.toISOString(),
      end_time:        endDt.toISOString(),
      status:          initialStatus,
      title:           title ?? null,
      notes:           notes ?? null,
      attendee_count:  attendee_count ?? null,
      booker_role:     actor.role,
      priority_weight: PRIORITY[actor.role],
    })
    .select()
    .single();

  if (insertError) {
    // If insert fails, attempt to roll back the BUMPED statuses
    await rollbackBumpedBookings(bumpedBookings.map(b => b.id));
    throw new Error('Booking insert failed: ' + insertError.message);
  }

  // ── 7. Write audit log ─────────────────────────────────────────────────────
  writeAuditLog(actor, 'BOOKING_CREATED', 'bookings', newBooking.id, null, newBooking);

  // ── 8. Publish events to RabbitMQ ─────────────────────────────────────────

  // New booking event
  await publishEvent('booking.created', {
    booking_id:  newBooking.id,
    resource_id,
    user_id:     actor.id,
    tenant_id:   newBooking.tenant_id,
    status:      initialStatus,
    start_time:  startDt.toISOString(),
    end_time:    endDt.toISOString(),
    created_at:  now,
  });

  // Pending approval event (for Tenant Admin)
  if (initialStatus === 'PENDING') {
    await publishEvent('booking.pending_approval', {
      booking_id:  newBooking.id,
      resource_id,
      user_id:     actor.id,
      tenant_id:   newBooking.tenant_id,
      booker_role: actor.role,
      start_time:  startDt.toISOString(),
    });
  }

  // Bump events — one per bumped booking
  for (const bumped of bumpedBookings) {
    const alternativeSlots = await getAlternativeSlots(
      resource_id,
      new Date(bumped.start_time),
      (new Date(bumped.end_time) - new Date(bumped.start_time)) / 60000
    );

    await publishEvent('booking.bumped', {
      bumped_booking_id:    bumped.id,
      bumped_user_id:       bumped.user_id,
      bumping_booking_id:   newBooking.id,
      bumping_user_role:    actor.role,
      resource_id,
      tenant_id:            bumped.tenant_id,
      original_start_time:  bumped.start_time,
      original_end_time:    bumped.end_time,
      alternative_slots:    alternativeSlots,
    });

    // Log the bump for the Optimization Engine
    await supabase.from('optimization_logs').insert({
      tenant_id:   bumped.tenant_id,
      resource_id,
      event_type:  'BUMP_OCCURRED',
      severity:    'WARN',
      payload: {
        bumped_booking_id:  bumped.id,
        bumped_user_id:     bumped.user_id,
        bumped_user_role:   bumped.booker_role,
        bumping_user_id:    actor.id,
        bumping_user_role:  actor.role,
        bumping_booking_id: newBooking.id,
      },
    });
  }

  return {
    booking: newBooking,
    bumped:  bumpedBookings.map(b => b.id),
  };
}


// =============================================================================
// APPROVAL FUNCTION (Tenant Admin action)
// =============================================================================

/**
 * approveBooking — Tenant Admin or Main Admin approves a PENDING booking.
 */
export async function approveBooking(actor, bookingId) {
  // Load booking
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (error || !booking)
    throw Object.assign(new Error('Booking not found'), { status: 404 });

  if (booking.status !== 'PENDING')
    throw Object.assign(
      new Error(`Booking is already ${booking.status}`),
      { status: 409 }
    );

  // RBAC: only Tenant Admin (same tenant) or Main Admin
  if (
    actor.role !== 'MAIN_ADMIN' &&
    !(actor.role === 'TENANT_ADMIN' && actor.tenant_id === booking.tenant_id)
  ) {
    throw Object.assign(new Error('Not authorised to approve this booking'), { status: 403 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from('bookings')
    .update({
      status:      'APPROVED',
      approved_by: actor.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (updateErr) throw new Error('Approval failed: ' + updateErr.message);

  writeAuditLog(actor, 'BOOKING_APPROVED', 'bookings', bookingId, { status: 'PENDING' }, { status: 'APPROVED' });

  await publishEvent('booking.approved', {
    booking_id:  bookingId,
    user_id:     booking.user_id,
    resource_id: booking.resource_id,
    tenant_id:   booking.tenant_id,
    approved_by: actor.id,
    start_time:  booking.start_time,
  });

  return updated;
}


// =============================================================================
// REJECTION FUNCTION
// =============================================================================

export async function rejectBooking(actor, bookingId, reason) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (error || !booking)
    throw Object.assign(new Error('Booking not found'), { status: 404 });

  if (!['PENDING', 'APPROVED'].includes(booking.status))
    throw Object.assign(new Error(`Cannot reject a ${booking.status} booking`), { status: 409 });

  if (
    actor.role !== 'MAIN_ADMIN' &&
    !(actor.role === 'TENANT_ADMIN' && actor.tenant_id === booking.tenant_id)
  ) {
    throw Object.assign(new Error('Not authorised to reject this booking'), { status: 403 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from('bookings')
    .update({
      status:          'REJECTED',
      rejected_reason: reason ?? 'No reason provided',
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (updateErr) throw new Error('Rejection failed: ' + updateErr.message);

  writeAuditLog(actor, 'BOOKING_REJECTED', 'bookings', bookingId, { status: booking.status }, { status: 'REJECTED' });

  await publishEvent('booking.rejected', {
    booking_id:  bookingId,
    user_id:     booking.user_id,
    resource_id: booking.resource_id,
    tenant_id:   booking.tenant_id,
    reason:      reason,
  });

  return updated;
}


// =============================================================================
// CANCELLATION (self-service)
// =============================================================================

export async function cancelBooking(actor, bookingId) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (error || !booking)
    throw Object.assign(new Error('Booking not found'), { status: 404 });

  // Only the booking owner, Tenant Admin (same tenant), or Main Admin can cancel
  if (
    actor.id !== booking.user_id &&
    actor.role !== 'MAIN_ADMIN' &&
    !(actor.role === 'TENANT_ADMIN' && actor.tenant_id === booking.tenant_id)
  ) {
    throw Object.assign(new Error('Not authorised to cancel this booking'), { status: 403 });
  }

  if (['CANCELLED', 'COMPLETED', 'REJECTED'].includes(booking.status))
    throw Object.assign(new Error(`Booking is already ${booking.status}`), { status: 409 });

  const { data: updated, error: updateErr } = await supabase
    .from('bookings')
    .update({ status: 'CANCELLED' })
    .eq('id', bookingId)
    .select()
    .single();

  if (updateErr) throw new Error('Cancellation failed: ' + updateErr.message);

  writeAuditLog(actor, 'BOOKING_CANCELLED', 'bookings', bookingId, { status: booking.status }, { status: 'CANCELLED' });

  await publishEvent('booking.cancelled', {
    booking_id:  bookingId,
    user_id:     booking.user_id,
    resource_id: booking.resource_id,
    tenant_id:   booking.tenant_id,
    cancelled_by: actor.id,
  });

  return updated;
}


// =============================================================================
// ROLE MANAGEMENT (Main Admin only)
// =============================================================================

export async function changeUserRole(actor, targetUserId, newRole) {
  if (actor.role !== 'MAIN_ADMIN')
    throw Object.assign(new Error('Only Main Admin can change roles'), { status: 403 });

  const { data: target, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', targetUserId)
    .single();

  if (error || !target)
    throw Object.assign(new Error('Target user not found'), { status: 404 });

  const { data: updated, error: updateErr } = await supabase
    .from('users')
    .update({ role: newRole })
    .eq('id', targetUserId)
    .select()
    .single();

  if (updateErr) throw new Error('Role update failed: ' + updateErr.message);

  writeAuditLog(actor, 'ROLE_CHANGED', 'users', targetUserId,
    { role: target.role }, { role: newRole }
  );

  await publishEvent('user.role_changed', {
    user_id:   targetUserId,
    old_role:  target.role,
    new_role:  newRole,
    changed_by: actor.id,
  });

  return updated;
}


// =============================================================================
// ALTERNATIVE SLOT SUGGESTION
// =============================================================================

/**
 * Fetches up to 5 available slots near the requested time on the same day,
 * expanding to +/- days if needed. Called both on conflict rejection and
 * on BUMPED notification payloads.
 */
async function getAlternativeSlots(resourceId, nearTime, durationMins, maxResults = 5) {
  try {
    // Try the same day first, then ±1 day
    const dates = [
      new Date(nearTime),
      new Date(nearTime.getTime() + 86400000),
      new Date(nearTime.getTime() - 86400000),
    ].map(d => d.toISOString().split('T')[0]);

    const allSlots = [];
    for (const date of dates) {
      if (allSlots.length >= maxResults) break;
      const { data } = await supabase.rpc('get_available_slots', {
        p_resource_id:   resourceId,
        p_date:          date,
        p_duration_mins: Math.round(durationMins),
        p_max_results:   maxResults - allSlots.length,
      });
      if (data) allSlots.push(...data);
    }
    return allSlots.slice(0, maxResults);
  } catch {
    return [];  // Non-fatal; suggestions are best-effort
  }
}


// =============================================================================
// ROLLBACK HELPER
// =============================================================================

async function rollbackBumpedBookings(bookingIds) {
  if (!bookingIds.length) return;
  await supabase
    .from('bookings')
    .update({ status: 'APPROVED', bumped_at: null })
    .in('id', bookingIds);
}


// =============================================================================
// EXPRESS ROUTE HANDLER
// File: src/routes/bookings.js
// =============================================================================

import express from 'express';
import { verifyFirebaseToken } from '../middleware/authMiddleware.js';
import {
  createBooking,
  approveBooking,
  rejectBooking,
  cancelBooking,
  changeUserRole,
} from '../services/bookingEngine.js';

const router = express.Router();

// All booking routes require a valid Firebase JWT
router.use(verifyFirebaseToken);

// ── POST /api/bookings ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const actor = await getUserByFirebaseUid(req.user.uid);
    const result = await createBooking(actor, req.body);

    const statusCode = result.booking.status === 'PENDING' ? 202 : 201;
    return res.status(statusCode).json({
      success: true,
      data:    result.booking,
      meta: {
        status:  result.booking.status,
        bumped:  result.bumped,
        message: result.booking.status === 'PENDING'
          ? 'Booking submitted and awaiting Tenant Admin approval.'
          : 'Booking confirmed.',
      },
    });
  } catch (err) {
    return res.status(err.status ?? 500).json({
      success: false,
      error:   err.message,
      code:    err.code ?? 'BOOKING_ERROR',
      ...(err.alternative_slots && { alternative_slots: err.alternative_slots }),
    });
  }
});

// ── PATCH /api/bookings/:id/approve ──────────────────────────────────────────
router.patch('/:id/approve', async (req, res) => {
  try {
    const actor   = await getUserByFirebaseUid(req.user.uid);
    const booking = await approveBooking(actor, req.params.id);
    return res.status(200).json({ success: true, data: booking });
  } catch (err) {
    return res.status(err.status ?? 500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/bookings/:id/reject ───────────────────────────────────────────
router.patch('/:id/reject', async (req, res) => {
  try {
    const actor   = await getUserByFirebaseUid(req.user.uid);
    const booking = await rejectBooking(actor, req.params.id, req.body.reason);
    return res.status(200).json({ success: true, data: booking });
  } catch (err) {
    return res.status(err.status ?? 500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/bookings/:id/cancel ───────────────────────────────────────────
router.patch('/:id/cancel', async (req, res) => {
  try {
    const actor   = await getUserByFirebaseUid(req.user.uid);
    const booking = await cancelBooking(actor, req.params.id);
    return res.status(200).json({ success: true, data: booking });
  } catch (err) {
    return res.status(err.status ?? 500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/users/:id/role ─────────────────────────────────────────────────
router.patch('/users/:id/role', async (req, res) => {
  try {
    const actor   = await getUserByFirebaseUid(req.user.uid);
    const updated = await changeUserRole(actor, req.params.id, req.body.role);
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return res.status(err.status ?? 500).json({ success: false, error: err.message });
  }
});

export default router;


// =============================================================================
// AUTH MIDDLEWARE
// File: src/middleware/authMiddleware.js
// =============================================================================

import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  });
}

/**
 * verifyFirebaseToken
 * Validates the Bearer token in Authorization header.
 * Attaches the decoded token to req.user.
 * Sets req.user.tenant_id from the custom claim if present.
 */
export async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired Firebase token' });
  }
}


// =============================================================================
// NOTIFICATION SERVICE CONSUMER
// File: src/consumers/notificationConsumer.js
// Consumes RabbitMQ events and writes to the notifications table.
// Supabase Realtime then pushes these to the connected client.
// =============================================================================

import amqplib from 'amqplib';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EVENT_HANDLER_MAP = {
  'booking.created':         handleBookingCreated,
  'booking.pending_approval': handlePendingApproval,
  'booking.approved':        handleBookingApproved,
  'booking.rejected':        handleBookingRejected,
  'booking.bumped':          handleBookingBumped,
  'booking.cancelled':       handleBookingCancelled,
  'user.role_changed':       handleRoleChanged,
};

export async function startNotificationConsumer() {
  const conn    = await amqplib.connect(process.env.RABBITMQ_URL);
  const channel = await conn.createChannel();
  await channel.assertExchange('booking_events', 'topic', { durable: true });

  const q = await channel.assertQueue('notification_service', { durable: true });
  await channel.bindQueue(q.queue, 'booking_events', '#');  // subscribe to all events
  channel.prefetch(10);

  console.log('[NotificationConsumer] Listening for events...');

  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    const routingKey = msg.fields.routingKey;
    const payload    = JSON.parse(msg.content.toString());

    const handler = EVENT_HANDLER_MAP[routingKey];
    if (handler) {
      try {
        await handler(payload);
        channel.ack(msg);
      } catch (err) {
        console.error(`[NotificationConsumer] Handler failed for ${routingKey}:`, err.message);
        channel.nack(msg, false, true);  // requeue
      }
    } else {
      channel.ack(msg);  // unknown event, discard
    }
  });
}

async function insertNotification(userId, tenantId, type, title, body, payload = {}) {
  await supabase.from('notifications').insert({
    user_id:   userId,
    tenant_id: tenantId,
    type,
    title,
    body,
    payload,
  });
}

async function handleBookingBumped(payload) {
  const { bumped_user_id, tenant_id, resource_id, alternative_slots,
          original_start_time, bumping_user_role } = payload;

  const slotsText = alternative_slots?.length
    ? `Available alternatives: ${alternative_slots.map(s =>
        `${new Date(s.slot_start).toLocaleString()} – ${new Date(s.slot_end).toLocaleString()}`
      ).join(', ')}`
    : 'Please check the system for available times.';

  await insertNotification(
    bumped_user_id,
    tenant_id,
    'BOOKING_BUMPED',
    'Your booking has been overridden',
    `A ${bumping_user_role} has claimed your booking slot for ${new Date(original_start_time).toLocaleString()}. ` +
    slotsText,
    { resource_id, alternative_slots, original_start_time }
  );
}

async function handlePendingApproval(payload) {
  // Notify all Tenant Admins in this tenant
  const { data: admins } = await supabase
    .from('users')
    .select('id')
    .eq('tenant_id', payload.tenant_id)
    .eq('role', 'TENANT_ADMIN');

  for (const admin of (admins ?? [])) {
    await insertNotification(
      admin.id,
      payload.tenant_id,
      'BOOKING_PENDING',
      'Booking approval required',
      `A ${payload.booker_role} has submitted a booking request for ${new Date(payload.start_time).toLocaleString()}.`,
      { booking_id: payload.booking_id, resource_id: payload.resource_id }
    );
  }
}

async function handleBookingCreated(payload) {
  await insertNotification(
    payload.user_id,
    payload.tenant_id,
    'BOOKING_CONFIRMED',
    'Booking confirmed',
    `Your booking for ${new Date(payload.start_time).toLocaleString()} has been confirmed.`,
    { booking_id: payload.booking_id, resource_id: payload.resource_id }
  );
}

async function handleBookingApproved(payload) {
  await insertNotification(
    payload.user_id,
    payload.tenant_id,
    'BOOKING_CONFIRMED',
    'Booking approved',
    `Your booking request for ${new Date(payload.start_time).toLocaleString()} has been approved.`,
    { booking_id: payload.booking_id }
  );
}

async function handleBookingRejected(payload) {
  await insertNotification(
    payload.user_id,
    payload.tenant_id,
    'BOOKING_REJECTED',
    'Booking rejected',
    `Your booking was rejected. ${payload.reason ? 'Reason: ' + payload.reason : ''}`,
    { booking_id: payload.booking_id }
  );
}

async function handleBookingCancelled(payload) {
  await insertNotification(
    payload.user_id,
    payload.tenant_id,
    'BOOKING_CANCELLED',
    'Booking cancelled',
    'Your booking has been cancelled.',
    { booking_id: payload.booking_id }
  );
}

async function handleRoleChanged(payload) {
  await insertNotification(
    payload.user_id,
    null,
    'ROLE_CHANGED',
    'Your role has been updated',
    `Your system role has been changed to ${payload.new_role}.`,
    { old_role: payload.old_role, new_role: payload.new_role }
  );
}
