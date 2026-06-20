// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * notify-dedup.service.ts — Dedup notify storm (Eng review Issue 7).
 *
 * Lần đầu Unrouted từ campaign X → INSERT row + send Zalo notify + counter=1.
 * Subsequent trong 24h → counter++ (no send).
 * After 24h → row expired, next event reset cycle.
 *
 * Sử dụng: anh typo key trong tên campaign → 500 lead Unrouted → 1 Zalo notify
 * thay vì 500.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface NotifyDedupResult {
  /** True = lần đầu (caller phải send notify thật). False = đã trong window. */
  shouldSend: boolean;
  counter: number;
}

/**
 * Atomic check & increment. Postgres unique constraint handle race condition.
 *
 * @param orgId — multi-tenant scope
 * @param notifyKey — vd "unrouted:campaign:12345" hoặc "token-expired:page:67890"
 */
export async function checkAndIncrementNotify(orgId: string, notifyKey: string): Promise<NotifyDedupResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEDUP_WINDOW_MS);

  // Atomic upsert. Nếu row tồn tại + chưa expire → increment counter, no send.
  // Nếu row tồn tại + expired → reset (delete + insert new).
  // Nếu chưa có → insert, shouldSend=true.

  try {
    // Try insert first
    await prisma.notifyDedupState.create({
      data: { orgId, notifyKey, counter: 1, firstSentAt: now, lastSeenAt: now, expiresAt },
    });
    return { shouldSend: true, counter: 1 };
  } catch (err: unknown) {
    // Unique constraint conflict → row exists. Check if expired.
    const existing = await prisma.notifyDedupState.findUnique({
      where: { orgId_notifyKey: { orgId, notifyKey } },
    });
    if (!existing) {
      // Race: row vừa được delete bởi GC worker → retry insert
      logger.warn(`[notify-dedup] Race: row gone after conflict. Retry insert ${notifyKey}`);
      await prisma.notifyDedupState.create({
        data: { orgId, notifyKey, counter: 1, firstSentAt: now, lastSeenAt: now, expiresAt },
      });
      return { shouldSend: true, counter: 1 };
    }

    if (existing.expiresAt.getTime() < now.getTime()) {
      // Expired → reset
      const reset = await prisma.notifyDedupState.update({
        where: { id: existing.id },
        data: { counter: 1, firstSentAt: now, lastSeenAt: now, expiresAt },
      });
      return { shouldSend: true, counter: reset.counter };
    }

    // Within window → increment counter, no send
    const updated = await prisma.notifyDedupState.update({
      where: { id: existing.id },
      data: { counter: { increment: 1 }, lastSeenAt: now },
    });
    return { shouldSend: false, counter: updated.counter };
  }
}

/** GC worker — xoá row expired để table không grow vô tận. Gọi từ cron 1h/lần. */
export async function gcExpiredNotifyStates(): Promise<number> {
  const result = await prisma.notifyDedupState.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) logger.debug(`[notify-dedup] GC removed ${result.count} expired rows`);
  return result.count;
}
