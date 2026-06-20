// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M1 — BullMQ Redis connection shared (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// Single ioredis client cho tất cả BullMQ queues + workers + Bull Board.
// KHÁC với src/shared/redis-client.ts (general-purpose cache, lazyConnect):
// connection này dedicated cho BullMQ — maxRetriesPerRequest=null (yêu cầu BullMQ),
// enableReadyCheck=false (BullMQ workers recommendation).
//
// AOF persistence: Redis container chạy `--appendonly yes --appendfsync everysec`
// (docker-compose.yml). Verify POC spike 5/5 PASS 2026-06-01.

import { Redis } from 'ioredis';
import { logger } from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';

let connectionInstance: Redis | null = null;
let connectionFailed = false;

function createConnection(): Redis {
  const redis = new Redis(REDIS_URL, {
    // BullMQ v5 requirement — never timeout single request
    maxRetriesPerRequest: null,
    // BullMQ workers recommendation
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy(times: number): number | null {
      if (times > 100) {
        logger.error(`[bullmq-redis] giving up after ${times} retry attempts`);
        connectionFailed = true;
        return null;
      }
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
  });

  redis.on('connect', () => {
    logger.info(`[bullmq-redis] connected to ${REDIS_URL.replace(/:[^@]*@/, ':***@')}`);
    connectionFailed = false;
  });

  redis.on('error', (err: Error) => {
    if (!connectionFailed) {
      logger.error(`[bullmq-redis] error: ${err.message}`);
    }
  });

  redis.on('close', () => {
    logger.warn('[bullmq-redis] connection closed');
  });

  return redis;
}

export function getBullMQRedis(): Redis {
  if (!connectionInstance) {
    connectionInstance = createConnection();
  }
  return connectionInstance;
}

export function isBullMQRedisHealthy(): boolean {
  return !connectionFailed && connectionInstance?.status === 'ready';
}

export async function closeBullMQRedis(): Promise<void> {
  if (connectionInstance) {
    logger.info('[bullmq-redis] closing connection...');
    await connectionInstance.quit();
    connectionInstance = null;
  }
}
