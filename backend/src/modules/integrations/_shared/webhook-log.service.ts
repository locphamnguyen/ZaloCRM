// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * webhook-log.service.ts — Outbox pattern + idempotency (Eng review Issue 2, 3, 6).
 *
 * Webhook handler:
 *   1. Verify HMAC
 *   2. recordIngestion() → INSERT WebhookLog status='pending', return 200 ngay
 * Worker (outbox-worker.ts):
 *   1. pickPending() → status='processing'
 *   2. Call adapter.parseLead() → Graph API → NormalizedLead
 *   3. resolveListFromCampaign() → CustomerListId
 *   4. Insert CustomerListEntry
 *   5. markProcessed() OR markFailed() với exponential backoff
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import type { LeadSource } from './normalized-lead.schema.js';

export type WebhookLogStatus = 'pending' | 'processing' | 'processed' | 'failed';

/** Exponential backoff schedule (ms). attempts 0-indexed. */
const RETRY_DELAYS_MS = [
  10 * 1000,        // 10s sau attempt 1
  30 * 1000,        // 30s sau attempt 2
  2 * 60 * 1000,    // 2m sau attempt 3
  10 * 60 * 1000,   // 10m sau attempt 4
  60 * 60 * 1000,   // 1h sau attempt 5
];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

export interface RecordIngestionResult {
  /** WebhookLog.id mới tạo, hoặc id của row đã tồn tại (idempotency) */
  logId: string;
  /** True nếu là lần đầu (insert). False = duplicate (FB retry) → caller skip Graph API */
  isFirst: boolean;
}

/**
 * Insert ingest log với idempotency. Postgres unique constraint trên externalLeadId
 * sẽ chặn duplicate. Conflict → return existing id (caller return 200 ngay).
 *
 * @param input.externalLeadId — leadgen_id từ FB / lead_id từ TikTok / etc.
 * @param input.rawBody — payload nguyên văn (cho replay)
 * @param input.signature — HMAC header (audit)
 * @param input.orgId — null nếu chưa resolve được (early error stage)
 */
export async function recordIngestion(input: {
  source: LeadSource;
  externalLeadId: string;
  rawBody: unknown;
  signature?: string;
  orgId?: string | null;
}): Promise<RecordIngestionResult> {
  try {
    const log = await prisma.webhookLog.create({
      data: {
        orgId: input.orgId ?? null,
        source: input.source,
        externalLeadId: input.externalLeadId,
        rawBody: input.rawBody as object,
        signature: input.signature ?? null,
        status: 'pending',
      },
      select: { id: true },
    });
    return { logId: log.id, isFirst: true };
  } catch (err: unknown) {
    // Unique constraint conflict — duplicate webhook delivery
    const existing = await prisma.webhookLog.findUnique({
      where: { externalLeadId: input.externalLeadId },
      select: { id: true },
    });
    if (existing) {
      logger.info(`[webhook-log] Duplicate ${input.source} ${input.externalLeadId} (FB retry) → 200 no-op`);
      return { logId: existing.id, isFirst: false };
    }
    // Race or other error → rethrow
    throw err;
  }
}

/** Lấy 1 batch pending để worker process. FOR UPDATE SKIP LOCKED chống double-pickup. */
export async function pickPending(limit: number = 10): Promise<Array<{ id: string; source: string; externalLeadId: string; rawBody: unknown; attempts: number }>> {
  // Postgres advisory: SKIP LOCKED prevent multiple workers cùng pick 1 row
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; source: string; external_lead_id: string; raw_body: unknown; attempts: number }>>(
    `UPDATE webhook_logs
     SET status = 'processing'
     WHERE id IN (
       SELECT id FROM webhook_logs
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC
       LIMIT ${Math.max(1, Math.min(100, limit))}
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, source, external_lead_id, raw_body, attempts`,
  );
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    externalLeadId: r.external_lead_id,
    rawBody: r.raw_body,
    attempts: r.attempts,
  }));
}

export async function markProcessed(logId: string, createdEntryId: string): Promise<void> {
  await prisma.webhookLog.update({
    where: { id: logId },
    data: {
      status: 'processed',
      createdEntryId,
      processedAt: new Date(),
      errorMessage: null,
    },
  });
}

/**
 * Mark log failed với retry policy. Sau MAX_ATTEMPTS → status='failed' permanent.
 * Caller (worker) phải call function này trong catch block.
 */
export async function markFailedWithRetry(logId: string, errorMessage: string, attempts: number): Promise<{ willRetry: boolean; nextRetryAt: Date | null }> {
  const nextAttempt = attempts + 1;
  if (nextAttempt >= MAX_ATTEMPTS) {
    await prisma.webhookLog.update({
      where: { id: logId },
      data: {
        status: 'failed',
        attempts: nextAttempt,
        errorMessage: errorMessage.slice(0, 500),
        processedAt: new Date(),
      },
    });
    logger.error(`[webhook-log] Permanently failed ${logId} after ${nextAttempt} attempts: ${errorMessage}`);
    return { willRetry: false, nextRetryAt: null };
  }
  const delay = RETRY_DELAYS_MS[nextAttempt];
  const nextRetryAt = new Date(Date.now() + delay);
  await prisma.webhookLog.update({
    where: { id: logId },
    data: {
      status: 'pending', // back to pending for retry
      attempts: nextAttempt,
      nextRetryAt,
      errorMessage: errorMessage.slice(0, 500),
    },
  });
  logger.warn(`[webhook-log] Retry ${logId} attempt ${nextAttempt}/${MAX_ATTEMPTS} in ${delay / 1000}s: ${errorMessage}`);
  return { willRetry: true, nextRetryAt };
}

/** Find log by externalLeadId (for replay / admin debug UI Phase 2). */
export async function findByExternalLeadId(externalLeadId: string) {
  return prisma.webhookLog.findUnique({ where: { externalLeadId } });
}
