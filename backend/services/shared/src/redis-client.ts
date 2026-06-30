/**
 * Redis Client + Streams Helpers
 * 
 * Provides a shared Redis connection and helper functions for
 * Redis Streams (pub/sub replacement for inter-service events).
 */

import Redis from 'ioredis';
import { logger } from './logger';
import type { StreamEvent } from './types';

let redisClient: Redis | null = null;

/**
 * Returns a singleton Redis client.
 */
export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      logger.warn({ attempt: times, delay }, 'Redis reconnecting...');
      return delay;
    },
    lazyConnect: false,
  });

  redisClient.on('connect', () => {
    logger.info({ url }, 'Redis connected');
  });

  redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });

  return redisClient;
}

/**
 * Publish an event to a Redis Stream.
 * 
 * @param stream - Stream name (e.g., 'booking-events')
 * @param event - The event payload
 * @returns The stream entry ID
 */
export async function publishEvent(stream: string, event: StreamEvent): Promise<string> {
  const redis = getRedisClient();
  const id = await redis.xadd(
    stream,
    '*', // Auto-generate ID
    'type', event.type,
    'payload', JSON.stringify(event.payload),
    'timestamp', event.timestamp || new Date().toISOString(),
    'tenantId', event.tenantId,
  );
  logger.debug({ stream, type: event.type, id }, 'Event published');
  return id as string;
}

/**
 * Create a consumer group on a stream (idempotent).
 * 
 * @param stream - Stream name
 * @param group - Consumer group name
 */
export async function createConsumerGroup(stream: string, group: string): Promise<void> {
  const redis = getRedisClient();
  try {
    await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    logger.info({ stream, group }, 'Consumer group created');
  } catch (err: any) {
    if (err.message?.includes('BUSYGROUP')) {
      // Group already exists — this is fine
      logger.debug({ stream, group }, 'Consumer group already exists');
    } else {
      throw err;
    }
  }
}

/**
 * Consume events from a Redis Stream using a consumer group.
 * Runs in a loop, calling the handler for each event.
 * 
 * @param stream - Stream name
 * @param group - Consumer group name
 * @param consumer - Consumer name (unique per instance)
 * @param handler - Async function to process each event
 * @param options - Configuration options
 */
export async function consumeEvents(
  stream: string,
  group: string,
  consumer: string,
  handler: (event: StreamEvent) => Promise<void>,
  options: { blockMs?: number; count?: number } = {},
): Promise<void> {
  const redis = getRedisClient();
  const { blockMs = 5000, count = 10 } = options;

  await createConsumerGroup(stream, group);

  logger.info({ stream, group, consumer }, 'Starting event consumer');

  while (true) {
    try {
      const results = await redis.xreadgroup(
        'GROUP', group, consumer,
        'COUNT', count,
        'BLOCK', blockMs,
        'STREAMS', stream, '>',
      );

      if (!results) continue;

      for (const result of results as any[]) {
        const entries = result[1] as [string, string[]][];
        for (const [id, fields] of entries) {
          // Parse fields array into object
          const fieldMap: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            fieldMap[fields[i]] = fields[i + 1];
          }

          const event: StreamEvent = {
            id,
            type: fieldMap.type,
            payload: JSON.parse(fieldMap.payload || '{}'),
            timestamp: fieldMap.timestamp,
            tenantId: fieldMap.tenantId,
          };

          try {
            await handler(event);
            // Acknowledge the message
            await redis.xack(stream, group, id);
          } catch (err) {
            logger.error({ err, stream, id, type: event.type }, 'Event handler error');
            // Don't ack — message will be retried
          }
        }
      }
    } catch (err) {
      logger.error({ err, stream, group }, 'Consumer loop error');
      // Wait before retrying
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

/**
 * Gracefully close the Redis connection.
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}
