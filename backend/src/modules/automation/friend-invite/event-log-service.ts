// Wave 3 Event Log Service 2026-05-30 — append-only feed cho mọi automation event.
//
// Hai hàm export:
//   - logEvent(input): insert 1 row fire-and-forget (no throw). Mọi caller (worker /
//     event handler / message handler) chỉ cần `void logEvent({...})` — service tự
//     swallow error vào logger.warn.
//   - cleanupOldEvents(): xoá row created_at < NOW() - 30 days. Gọi từ cron daily
//     06:00 VN (TODO Ngày 5: wire vào app.ts startup hoặc cron module).
//
// Anti-pattern em ĐỪNG làm:
//   - throw từ logEvent — sẽ phá flow chính (worker / handler). Always swallow.
//   - log đồng bộ với caller blocking — luôn fire-and-forget bằng `void`.
//   - log row khi triggerId không khả dụng — bỏ qua (event không thuộc Mục tiêu).

import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

export type EventPriority = 'info' | 'warning' | 'urgent';

// Mã sự kiện chuẩn — đồng bộ với migration comment + FE filter chip.
// Khi add mới, update CẢ 3 chỗ: type này / FE typedef / migration COMMENT.
export type EventType =
  | 'friend_sent'
  | 'friend_accepted'
  | 'friend_rejected'
  | 'welcome_sent'
  | 'welcome_blocked'
  | 'sequence_step_sent'
  | 'customer_reply'
  | 'customer_block'
  | 'nick_disconnected'
  | 'nick_resume'
  | 'validate_done'
  | 'sweeper_action'
  // BE T4 2026-05-30 — cron flip draft→active theo scheduledAt (friend-invite).
  | 'scheduled_activated'
  // 2026-05-30 22:46 — KH đã là bạn nick từ trước, skip friend_request, vào bám đuổi luôn.
  | 'friend_already';

export interface LogEventInput {
  orgId: string;
  triggerId: string;
  taskId?: string | null;
  contactId?: string | null;
  nickId?: string | null;
  eventType: EventType;
  eventPriority?: EventPriority;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Insert 1 event log row. Fire-and-forget, no throw.
 *
 * Caller pattern (đúng):
 *   void logEvent({ orgId, triggerId, eventType: 'friend_sent', summary: '...' });
 *
 * Caller pattern (sai — sẽ block worker nếu DB chậm):
 *   await logEvent({...});  // ❌
 */
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    if (!input.orgId || !input.triggerId || !input.eventType || !input.summary) {
      logger.warn('[event-log] missing required fields, skipping insert', {
        orgId: !!input.orgId,
        triggerId: !!input.triggerId,
        eventType: input.eventType,
        hasSummary: !!input.summary,
      });
      return;
    }

    // Truncate summary defensively (DB column = TEXT, but UI render ~200 chars).
    const summary = input.summary.length > 500
      ? input.summary.slice(0, 497) + '...'
      : input.summary;

    await prisma.automationEventLog.create({
      data: {
        orgId: input.orgId,
        triggerId: input.triggerId,
        taskId: input.taskId ?? null,
        contactId: input.contactId ?? null,
        nickId: input.nickId ?? null,
        eventType: input.eventType,
        eventPriority: input.eventPriority ?? 'info',
        summary,
        // Prisma JSON nullable: dùng Prisma.JsonNull để insert null thay vì undefined.
        metadata: input.metadata == null
          ? Prisma.JsonNull
          : (input.metadata as Prisma.InputJsonValue),
      },
    });
  } catch (err) {
    // Swallow — event log is best-effort. Caller flow MUST not break if logging fails.
    logger.warn(
      `[event-log] insert failed for trigger=${input.triggerId} type=${input.eventType}:`,
      err,
    );
  }
}

/**
 * Cleanup row > N days (default 30). Gọi từ cron daily 03:00 VN
 * (cron-event-scheduler.ts — registered Day 5 Wave 3).
 * Returns số row đã xoá để cron log.
 *
 * @param days số ngày giữ lại. Mặc định 30 (retention policy hiện tại).
 */
export async function cleanupOldEvents(days = 30): Promise<{ deletedCount: number }> {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  try {
    const result = await prisma.automationEventLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    logger.info(
      `[event-log] cleanupOldEvents deleted=${result.count} cutoff=${cutoff.toISOString()} days=${safeDays}`,
    );
    return { deletedCount: result.count };
  } catch (err) {
    logger.error('[event-log] cleanupOldEvents failed:', err);
    return { deletedCount: 0 };
  }
}
