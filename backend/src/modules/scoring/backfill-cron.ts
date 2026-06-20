// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * scoring/backfill-cron.ts — Backfill Friend.leadScore từ ActivityLog cũ.
 *
 * Vấn đề: Phase 6 ship 16/05/2026. Friends tạo TRƯỚC ngày này không có
 * score (leadScore=0). Sale mở chat thấy KH cũ điểm 0 → mất tin.
 *
 * Giải pháp: chunked cron tick mỗi 5 phút, mỗi tick xử lý 100 friend chưa có
 * scoreUpdatedAt. Replay ActivityLog (msg/appointment/...) qua applySignalsToFriend
 * để tích lũy score.
 *
 * Chunked vì:
 *   - 50 nick × 3,000 friend = 150,000 row. 1 lần all-at-once = timeout DB
 *     và spam log với 150k score_change events.
 *   - Spread qua nhiều giờ → less write pressure, dễ rollback khi sai.
 *
 * Job tự động shutdown khi không còn friend nào cần backfill (idempotent stop).
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { applySignalsToFriend } from './score-engine.js';
import { detectSignalsFromMessage } from './signal-detector.js';

const CHUNK_SIZE = 100;
const LOOKBACK_DAYS = 90;
const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 phút

let backfillTimer: NodeJS.Timeout | null = null;
let inFlight = false;

export interface BackfillResult {
  processed: number;
  signalsApplied: number;
  remaining: number;
  done: boolean;
}

/**
 * Chạy 1 tick backfill: pick 100 friend không có scoreUpdatedAt + có message 90 ngày qua,
 * replay signals cho từng friend.
 */
export async function runBackfillTick(): Promise<BackfillResult> {
  if (inFlight) {
    return { processed: 0, signalsApplied: 0, remaining: -1, done: false };
  }
  inFlight = true;
  const start = Date.now();
  let processed = 0;
  let signalsApplied = 0;

  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    // Pick 100 friend chưa có score, có ít nhất 1 inbound trong 90 ngày
    const candidates = await prisma.friend.findMany({
      where: {
        scoreUpdatedAt: null,
        lastInboundAt: { gte: since },
      },
      select: {
        id: true,
        orgId: true,
        contactId: true,
        zaloAccountId: true,
        statusRef: { select: { name: true } },
      },
      take: CHUNK_SIZE,
      orderBy: { lastInboundAt: 'desc' },
    });

    if (candidates.length === 0) {
      logger.info('[backfill-cron] Không còn friend cần backfill, stopping');
      stopBackfillCron();
      return { processed: 0, signalsApplied: 0, remaining: 0, done: true };
    }

    for (const f of candidates) {
      try {
        const applied = await withTenant(f.orgId, async () => {
          // Replay từ message inbound gần đây (limit 50 msg/friend để tránh quá tải)
          const conv = await prisma.conversation.findFirst({
            where: { orgId: f.orgId, zaloAccountId: f.zaloAccountId, contactId: f.contactId },
            select: { id: true },
          });
          if (!conv) {
            // Mark friend đã scan để không pick lại
            await prisma.friend.update({
              where: { id: f.id },
              data: { scoreUpdatedAt: new Date() },
            });
            return 0;
          }

          const messages = await prisma.message.findMany({
            where: { conversationId: conv.id, senderType: 'contact' },
            select: { content: true, sentAt: true },
            orderBy: { sentAt: 'desc' },
            take: 50,
          });

          let appliedCount = 0;
          for (const m of messages) {
            if (!m.content) continue;
            const signals = await detectSignalsFromMessage(f.orgId, m.content, f.statusRef?.name ?? null);
            if (signals.length > 0) {
              await applySignalsToFriend(f.id, f.orgId, signals, 'backfill');
              appliedCount += signals.length;
            }
          }

          // Stamp scoreUpdatedAt nếu chưa có signals nào apply (tránh re-pick)
          const updated = await prisma.friend.findUnique({
            where: { id: f.id },
            select: { scoreUpdatedAt: true },
          });
          if (!updated?.scoreUpdatedAt) {
            await prisma.friend.update({
              where: { id: f.id },
              data: { scoreUpdatedAt: new Date() },
            });
          }
          return appliedCount;
        });
        signalsApplied += applied;
        processed++;
      } catch (err) {
        logger.warn({ err, friendId: f.id }, '[backfill-cron] skip friend');
      }
    }

    const remaining = await prisma.friend.count({
      where: { scoreUpdatedAt: null, lastInboundAt: { gte: since } },
    });

    logger.info(
      { processed, signalsApplied, remaining, ms: Date.now() - start },
      '[backfill-cron] tick done'
    );

    return { processed, signalsApplied, remaining, done: remaining === 0 };
  } catch (err) {
    logger.error({ err }, '[backfill-cron] tick failed');
    return { processed, signalsApplied, remaining: -1, done: false };
  } finally {
    inFlight = false;
  }
}

/**
 * Start backfill cron — chạy mỗi 5 phút. Tự stop khi không còn friend cần backfill.
 */
export function startBackfillCron(): void {
  if (backfillTimer) return;
  logger.info('[backfill-cron] starting (tick mỗi 5 phút, chunk 100 friend)');
  // Chạy 1 lần ngay sau boot 1 phút (để cho DB warm up trước)
  setTimeout(() => {
    void runBackfillTick();
  }, 60_000);
  backfillTimer = setInterval(() => {
    void runBackfillTick();
  }, TICK_INTERVAL_MS);
}

export function stopBackfillCron(): void {
  if (backfillTimer) {
    clearInterval(backfillTimer);
    backfillTimer = null;
    logger.info('[backfill-cron] stopped');
  }
}
