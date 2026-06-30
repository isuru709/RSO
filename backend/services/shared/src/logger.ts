/**
 * Structured Logger — Pino-based with correlation ID support
 */

import pino from 'pino';

// Check if pino-pretty is available (it's a devDependency, not in Docker)
let hasPinoPretty = false;
try { require.resolve('pino-pretty'); hasPinoPretty = true; } catch {}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: hasPinoPretty
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
  base: {
    service: process.env.SERVICE_NAME || 'unknown',
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.ip,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});

/**
 * Create a child logger with a correlation/request ID.
 * Usage: const reqLog = createRequestLogger(request.headers['x-request-id']);
 */
export function createRequestLogger(requestId?: string) {
  return logger.child({ requestId: requestId || 'no-request-id' });
}

export type Logger = pino.Logger;
