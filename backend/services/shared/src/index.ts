/**
 * @rso/shared — Common utilities for the Campus RSO Platform
 *
 * This package is consumed by all microservices and provides:
 * - Firebase JWT verification middleware
 * - Supabase client wrapper (service_role)
 * - Redis client + Streams helpers
 * - Standard error/response envelope
 * - Structured logging (pino)
 * - RBAC role guard
 * - Shared TypeScript types
 *
 * Built once, imported everywhere via npm workspaces.
 */

export { authMiddleware, optionalAuth } from './auth-middleware';
export { getSupabaseClient, resetSupabaseClient } from './supabase-client';
export { getRedisClient, publishEvent, createConsumerGroup, consumeEvents, closeRedis } from './redis-client';
export { errorHandler, ApiError, sendSuccess, sendPaginated } from './error-handler';
export { logger, createRequestLogger } from './logger';
export type { Logger } from './logger';
export { requireRole, requireOwnTenant } from './role-guard';
export * from './types';
