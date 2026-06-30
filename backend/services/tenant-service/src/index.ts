/**
 * Tenant Service — Entry Point
 * 
 * Manages faculty/department CRUD. Only super_admins can create tenants;
 * tenant_admins can update their own. Reads are scoped by role.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger, errorHandler } from '@rso/shared';
import { tenantRoutes } from './routes';

const server = Fastify({
  logger: false,
  ignoreTrailingSlash: true,
});

// Plugins
server.register(cors, { origin: true });

// Error handler
server.setErrorHandler(errorHandler);

// Health check (unauthenticated — used by Docker + Nginx)
server.get('/health', async () => ({
  status: 'ok',
  service: 'tenant-service',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
}));

// Register tenant routes
server.register(tenantRoutes);

const start = async () => {
  try {
    const port = parseInt(process.env.TENANT_SERVICE_PORT || '3001', 10);
    await server.listen({ port, host: '0.0.0.0' });
    logger.info({ port, service: 'tenant-service' }, 'Tenant Service started');
  } catch (err) {
    logger.error(err, 'Tenant Service failed to start');
    process.exit(1);
  }
};

start();
