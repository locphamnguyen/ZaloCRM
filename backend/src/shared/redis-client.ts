/**
 * redis-client.ts — Optional Redis connection.
 * Returns null when REDIS_URL is not set (in-memory fallback mode).
 */
import { Redis } from 'ioredis';
import { logger } from './utils/logger.js';

export type RedisClient = Redis;

let redisInstance: Redis | null = null;
let initialized = false;

export async function getRedis(): Promise<Redis | null> {
  if (initialized) return redisInstance;
  initialized = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.info('[redis] REDIS_URL not set — using in-memory mode');
    return null;
  }

  try {
    redisInstance = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 200, 3000),
      lazyConnect: true,
    });
    await redisInstance.connect();
    logger.info('[redis] Connected to %s', url.replace(/\/\/.*@/, '//*:*@'));
    return redisInstance;
  } catch (err) {
    logger.warn('[redis] Connection failed, falling back to in-memory: %s', (err as Error).message);
    redisInstance = null;
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
  initialized = false;
}
