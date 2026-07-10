/**
 * Resource Service — Entry Point
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger, errorHandler } from '@rso/shared';
import { resourceRoutes } from './routes';
import { stResourceRoutes } from './stRoutes';
import { stBookingRoutes } from './stBookingRoutes';

const server = Fastify({
  logger: false,
  ignoreTrailingSlash: true,
  bodyLimit: 5 * 1024 * 1024, // 5MB — base64 images are ~33% larger than raw bytes
});

server.register(cors, { origin: true });
server.setErrorHandler(errorHandler);

server.get('/health', async () => ({
  status: 'ok',
  service: 'resource-service',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
}));

server.register(resourceRoutes);
server.register(stResourceRoutes);
server.register(stBookingRoutes);

const start = async () => {
  try {
    const port = parseInt(process.env.RESOURCE_SERVICE_PORT || '3003', 10);
    await server.listen({ port, host: '0.0.0.0' });
    logger.info({ port, service: 'resource-service' }, 'Resource Service started');
  } catch (err) {
    logger.error(err, 'Resource Service failed to start');
    process.exit(1);
  }
};

start();
