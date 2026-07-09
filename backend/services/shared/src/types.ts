/**
 * Shared TypeScript Types
 */

// ============================================================================
// Auth / Claims
// ============================================================================
export type AppRole = 'main_admin' | 'tenant_admin' | 'lecturer' | 'junior_lecturer' | 'staff' | 'student';

export interface UserClaims {
  sub: string;          // Firebase UID
  email?: string;
  tenantId: string | null;
  appRole: AppRole;
  isBanned?: boolean;
}

// ============================================================================
// API Response Envelope
// ============================================================================
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// Resource Types
// ============================================================================
export type ResourceCategory = 'HALL' | 'LAB' | 'EQUIPMENT';
export type ResourceStatus = 'available' | 'maintenance' | 'retired' | 'reserved';

// ============================================================================
// Booking Types
// ============================================================================
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'bumped' | 'cancelled' | 'completed' | 'active';

// ============================================================================
// Optimization Log Types
// ============================================================================
export type LogType = 'underutilization' | 'double_booking_resolved' | 'auto_cancelled' | 'utilization_report' | 'conflict_detected';
export type Severity = 'info' | 'warning' | 'critical';

// ============================================================================
// Event Types (Redis Streams)
// ============================================================================
export interface StreamEvent {
  id?: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
  tenantId: string;
}

export type BookingEventType = 
  | 'booking.created'
  | 'booking.approved'
  | 'booking.rejected'
  | 'booking.cancelled'
  | 'booking.updated'
  | 'booking.conflict_detected';

export type ResourceEventType =
  | 'resource.underutilized'
  | 'resource.created'
  | 'resource.updated'
  | 'resource.deleted';

export type UserEventType =
  | 'user.signup'
  | 'user.banned'
  | 'user.unbanned'
  | 'user.deleted'
  | 'user.role_changed';

export type OptimizationEventType =
  | 'optimization.scan';

// ============================================================================
// Fastify Augmentation
// ============================================================================
declare module 'fastify' {
  interface FastifyRequest {
    user?: UserClaims;
  }
}
