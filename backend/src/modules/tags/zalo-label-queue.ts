// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-label-queue.ts — BullMQ serial enqueue per zaloAccountId.
 *
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║ STATUS: DEFER 2026-06-01 — CODE GIỮ DẰN DÀNH, CHƯA WIRE VÀO ROUTE ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * Lý do defer:
 * Anh review T-D 2026-06-01 verify lại race scenario:
 *   - HS Holding model: mỗi sale chăm nick riêng, KHÔNG share nick chăm KH
 *   - Race chỉ xảy ra khi 2+ sale CÙNG share quyền 1 nick + CÙNG assign tag
 *     cho 2 KH KHÁC NHAU trong window ~1-2s
 *   - Tần suất thực tế: 0 (chỉ internal/notify nick share, không chăm KH)
 *
 * Khi nào wire vào assign-thread:
 *   - Future scale có share-nick scenario (chia ca chăm KH chung)
 *   - Hoặc detect zaloAccountAccess.userId count > 1 ở runtime
 *
 * Logic ban đầu (T-D Codex /plan-eng-review M57):
 * Zalo SDK `updateLabels({labelData, version})` REPLACE WHOLE structure.
 * 2 concurrent assign cùng nick → 1 mất. DB $transaction KHÔNG protect remote.
 * Serial queue dedup jobId = `${zaloAccountId}:${labelId}:${threadId}`.
 *
 * Fallback: nếu REDIS_URL không có → log warning, skip queue.
 */

import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../../shared/utils/logger.js';

const QUEUE_NAME = 'zalo-label-mutate';

interface ZaloLabelJob {
  zaloAccountId: string;
  op: 'assign' | 'unassign';
  labelId: number;
  threadId: string;
}

let queue: Queue<ZaloLabelJob> | null = null;
let worker: Worker<ZaloLabelJob> | null = null;
let redisConn: Redis | null = null;

function getConn(): Redis | null {
  if (redisConn) return redisConn;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  redisConn = new Redis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
  return redisConn;
}

export function getZaloLabelQueue(): Queue<ZaloLabelJob> | null {
  if (queue) return queue;
  const conn = getConn();
  if (!conn) {
    logger.warn('[zalo-label-queue] REDIS_URL not set, queue disabled');
    return null;
  }
  queue = new Queue<ZaloLabelJob>(QUEUE_NAME, { connection: conn });
  return queue;
}

export async function enqueueZaloLabelMutate(payload: ZaloLabelJob): Promise<void> {
  const q = getZaloLabelQueue();
  if (!q) {
    logger.warn('[zalo-label-queue] enqueue skipped (no Redis): %j', payload);
    return;
  }
  const jobId = `${payload.zaloAccountId}:${payload.labelId}:${payload.threadId}`;
  await q.add('mutate', payload, {
    jobId, // dedup: cùng (account, label, thread) tại cùng thời điểm chỉ 1 job
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

/**
 * Worker handler — set bởi friend-sync-service hoặc bot worker.
 * Tham số: handler nhận ZaloLabelJob, call Zalo SDK updateLabels có
 * version check + retry.
 */
export function startZaloLabelWorker(
  handler: (job: Job<ZaloLabelJob>) => Promise<void>,
  opts?: { concurrency?: number }
): Worker<ZaloLabelJob> | null {
  if (worker) return worker;
  const conn = getConn();
  if (!conn) {
    logger.warn('[zalo-label-queue] worker not started (no Redis)');
    return null;
  }
  // Concurrency tổng = 1 per worker process, nhưng jobId dedup theo (account, label, thread)
  // → đảm bảo cùng nick + label + thread chỉ chạy 1 job tại 1 thời điểm
  worker = new Worker<ZaloLabelJob>(QUEUE_NAME, handler, {
    connection: conn,
    concurrency: opts?.concurrency ?? 4,
  });
  worker.on('completed', (job) => logger.debug('[zalo-label-queue] completed %s', job.id));
  worker.on('failed', (job, err) => logger.error('[zalo-label-queue] failed %s: %s', job?.id, err?.message));
  return worker;
}

export async function stopZaloLabelQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
  redisConn?.disconnect();
  redisConn = null;
}
