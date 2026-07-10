/**
 * User Profile Service — Entry Point
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger, errorHandler } from '@rso/shared';
import { userRoutes } from './routes';

const server = Fastify({
  logger: false,
  ignoreTrailingSlash: true,
  bodyLimit: 5 * 1024 * 1024, // 5MB — base64 images are ~33% larger than raw bytes
});

server.register(cors, { origin: true });
server.setErrorHandler(errorHandler);

server.get('/health', async () => ({
  status: 'ok',
  service: 'user-service',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
}));

server.register(userRoutes);

const start = async () => {
  try {
    const port = parseInt(process.env.USER_SERVICE_PORT || '3002', 10);
    await server.listen({ port, host: '0.0.0.0' });
    logger.info({ port, service: 'user-service' }, 'User Profile Service started');
  } catch (err) {
    logger.error(err, 'User Profile Service failed to start');
    process.exit(1);
  }
};

start();
