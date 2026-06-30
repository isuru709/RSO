/**
 * RBAC Role Guard — Fastify preHandler hook
 * 
 * Checks that the authenticated user has one of the required roles.
 * Must be used AFTER authMiddleware has populated request.user.
 * 
 * Usage:
 *   server.get('/admin', { preHandler: [authMiddleware, requireRole('tenant_admin', 'super_admin')] }, handler);
 */

import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import type { AppRole } from './types';

/**
 * Returns a Fastify preHandler that rejects the request with 403
 * if the user's app_role is not in the allowed list.
 * 
 * @param allowedRoles - One or more roles that may access the endpoint
 */
export function requireRole(...allowedRoles: AppRole[]) {
  return function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void {
    const user = request.user;

    if (!user) {
      reply.code(401).send({
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication is required',
        },
      });
      return;
    }

    if (!allowedRoles.includes(user.appRole)) {
      reply.code(403).send({
        success: false,
        error: {
          code: 'INSUFFICIENT_ROLE',
          message: `This action requires one of: ${allowedRoles.join(', ')}`,
        },
      });
      return;
    }

    done();
  };
}

/**
 * Tenant guard — ensures the request targets the user's own tenant.
 * Super admins bypass this check.
 * 
 * Reads tenant_id from: request.params.tenantId or request.body.tenant_id
 */
export function requireOwnTenant() {
  return function tenantGuard(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void {
    const user = request.user;

    if (!user) {
      reply.code(401).send({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication is required' },
      });
      return;
    }

    // Super admins can access any tenant
    if (user.appRole === 'main_admin') {
      done();
      return;
    }

    // Extract tenant_id from request
    const params = request.params as Record<string, string>;
    const body = request.body as Record<string, unknown> | undefined;
    const requestTenantId = params?.tenantId || body?.tenant_id;

    if (requestTenantId && requestTenantId !== user.tenantId) {
      reply.code(403).send({
        success: false,
        error: {
          code: 'CROSS_TENANT_ACCESS',
          message: 'You can only access resources within your own faculty',
        },
      });
      return;
    }

    done();
  };
}
