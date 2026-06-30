/**
 * Firebase JWT Auth Middleware for Fastify
 * 
 * Verifies the Firebase ID token from the Authorization header,
 * extracts custom claims, and attaches them to request.user.
 * 
 * Usage:
 *   server.addHook('onRequest', authMiddleware);
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { logger } from './logger';
import type { UserClaims, AppRole } from './types';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Firebase Admin initialization (once per process)
// ============================================================================
let firebaseInitialized = false;

function ensureFirebaseInit(): void {
  if (firebaseInitialized || getApps().length > 0) {
    firebaseInitialized = true;
    return;
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || path.resolve(process.cwd(), 'config', 'firebase-service-account.json');

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Firebase service account not found at: ${serviceAccountPath}`);
  }

  const sa = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
  initializeApp({ credential: cert(sa) });
  firebaseInitialized = true;
  logger.info('Firebase Admin SDK initialized');
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Auth middleware — Verifies Firebase JWT and populates request.user.
 * 
 * Expects: `Authorization: Bearer <firebase-id-token>`
 * 
 * On success: request.user is populated with UserClaims.
 * On failure: 401 response with error details.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({
      success: false,
      error: {
        code: 'AUTH_MISSING_TOKEN',
        message: 'Authorization header with Bearer token is required',
      },
    });
    return;
  }

  const token = authHeader.slice(7); // Remove 'Bearer '

  try {
    ensureFirebaseInit();
    const decoded: DecodedIdToken = await getAuth().verifyIdToken(token);

    // Extract custom claims
    request.user = {
      sub: decoded.uid,
      email: decoded.email,
      tenantId: decoded.tenant_id || null,
      appRole: (decoded.app_role as AppRole) || 'student',
    };

    logger.debug(
      { uid: decoded.uid, tenantId: request.user.tenantId, role: request.user.appRole },
      'Token verified'
    );
  } catch (err: any) {
    const code = err.code || 'AUTH_INVALID_TOKEN';
    const message = code === 'auth/id-token-expired'
      ? 'Token has expired — client must refresh'
      : code === 'auth/argument-error'
        ? 'Malformed token'
        : 'Invalid or expired token';

    logger.warn({ err: err.message, code: err.code, stack: err.stack, fullErr: err }, 'Token verification failed detailed');

    reply.code(401).send({
      success: false,
      error: { code, message },
    });
  }
}

/**
 * Optional auth — populates request.user if token present, but
 * does NOT reject requests without a token.
 */
export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return;

  try {
    ensureFirebaseInit();
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
    request.user = {
      sub: decoded.uid,
      email: decoded.email,
      tenantId: decoded.tenant_id || null,
      appRole: (decoded.app_role as AppRole) || 'student',
    };
  } catch {
    // Silently ignore — user will be undefined
  }
}
