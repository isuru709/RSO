/**
 * Booking & Optimization Service — Entry Point
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger, errorHandler } from '@rso/shared';
import { bookingRoutes } from './routes';

const server = Fastify({ logger: false, ignoreTrailingSlash: true });

server.register(cors, { origin: true });
server.setErrorHandler(errorHandler);

server.get('/health', async () => ({
  status: 'ok',
  service: 'booking-service',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
}));

server.register(bookingRoutes);

const start = async () => {
  try {
    const port = parseInt(process.env.BOOKING_SERVICE_PORT || '3004', 10);
    await server.listen({ port, host: '0.0.0.0' });
    logger.info({ port, service: 'booking-service' }, 'Booking & Optimization Service started');
  } catch (err) {
    logger.error(err, 'Booking Service failed to start');
    process.exit(1);
  }
};

start();
