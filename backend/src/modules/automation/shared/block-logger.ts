// ════════════════════════════════════════════════════════════════════════
// Block Logger — ghi "vì sao không gửi" có CHỐNG FLOOD (2026-06-18)
// ════════════════════════════════════════════════════════════════════════
//
// 1 HÀM DÙNG CHUNG (CL-1 eng-review) cho mọi cửa chặn: worker bám đuổi + guards +
// luồng kết bạn. Gói toàn bộ "khoá Redis SET NX + ghi event" → sửa logic 1 nơi.
//
// CHỐNG FLOOD: defer/skip lặp rất nhiều lần (mỗi lần worker wake). Marker Redis SET NX
// đảm bảo 1 ĐỢT chặn / 1 khách / 1 nhóm-lý-do = 1 dòng log (không đẻ trăm dòng).
//
// ⚠️ NV-1 (lỗi tiếng nói ngoài bắt được): logBlockOnce PHẢI đi kèm clearBlockMarker,
// gọi ở MỌI đường resume / "gửi bước tiếp ngay" / reset-quota. Thiếu → sau khi chạy
// lại OK, lần chặn KẾ cùng lý do trong TTL bị NUỐT log → tái diễn "âm thầm fail".
//
//   logBlockOnce ── SET evtlog:block:{trig}:{contact}:{category} 1 NX EX <ttl>
//        │              ├─ OK (chưa có marker)  → logEvent(blocked/skipped) + ghi category
//        │              └─ null (marker đã có)  → BỎ QUA (đợt này đã ghi rồi)
//   clearBlockMarker ─ DEL mọi evtlog:block:{trig}:{contact}:* (theo danh sách category)
//                      → đợt chặn mới sau resume sẽ ghi log mới
//
// Liên quan: block-reason-catalog.ts (câu chữ + category), event-log-service.ts (logEvent),
// queues/redis-connection.ts (getBullMQRedis).

import type { Redis } from 'ioredis';
import { logger } from '../../../shared/utils/logger.js';
import { getBullMQRedis } from '../queues/redis-connection.js';
import { logEvent } from '../friend-invite/event-log-service.js';
import {
  resolveBlockReason,
  ALL_BLOCK_CATEGORIES,
  type BlockCategory,
} from './block-reason-catalog.js';

const KEY_PREFIX = 'evtlog:block';
const MIN_TTL_SECONDS = 60;
const SKIP_TTL_SECONDS = 3600; // lý do skip-hẳn không có nextRunAt → khoá 1h

function markerKey(triggerId: string, contactId: string, category: BlockCategory): string {
  return `${KEY_PREFIX}:${triggerId}:${contactId}:${category}`;
}

export interface LogBlockOnceInput {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId?: string | null;
  /** Raw code từ worker/guard (vd 'outside_hour_window', 'quota_capped', 'sequence_disabled'). */
  reason: string;
  /** Thời điểm dự kiến chạy lại (defer) — dùng tính TTL marker + hiện trên log. */
  nextRunAt?: Date | null;
  /** Thông tin phụ ghi vào metadata (vd nickName, stepIdx). */
  extra?: Record<string, unknown>;
  /** Inject Redis để test; mặc định dùng BullMQ Redis. */
  redis?: Redis;
}

/**
 * Ghi 1 sự kiện "bị chặn/bỏ qua" CÓ CHỐNG FLOOD. Fire-and-forget (không throw).
 * Trả `true` nếu ĐÃ ghi dòng mới, `false` nếu bỏ qua (marker còn sống) — chủ yếu cho test.
 */
export async function logBlockOnce(input: LogBlockOnceInput): Promise<boolean> {
  try {
    const info = resolveBlockReason(input.reason);
    const redis = input.redis ?? getBullMQRedis();
    const key = markerKey(input.triggerId, input.contactId, info.category);

    // TTL: defer có nextRunAt → tới lúc chạy lại (tối thiểu 60s); skip-hẳn → cố định 1h.
    let ttl = SKIP_TTL_SECONDS;
    if (input.nextRunAt) {
      const secs = Math.ceil((input.nextRunAt.getTime() - Date.now()) / 1000);
      ttl = Math.max(secs, MIN_TTL_SECONDS);
    } else if (info.kind === 'defer') {
      ttl = MIN_TTL_SECONDS;
    }

    // SET NX: chỉ ghi event khi marker CHƯA có (dedupe 1 đợt/lý do/khách).
    const ok = await redis.set(key, '1', 'EX', ttl, 'NX');
    if (ok !== 'OK') return false; // marker đã tồn tại → đợt này đã ghi rồi

    const eventType = info.kind === 'skip' ? 'sequence_step_skipped' : 'sequence_step_blocked';
    void logEvent({
      orgId: input.orgId,
      triggerId: input.triggerId,
      contactId: input.contactId,
      nickId: input.nickId ?? null,
      eventType,
      eventPriority: info.priority >= 85 ? 'warning' : 'info',
      summary: info.label,
      category: info.category,
      metadata: {
        reason: input.reason,
        hint: info.hint,
        kind: info.kind,
        nextRunAt: input.nextRunAt ? input.nextRunAt.toISOString() : null,
        ...(input.extra ?? {}),
      },
    });
    return true;
  } catch (err) {
    // Best-effort: không bao giờ phá flow worker.
    logger.warn(
      `[block-logger] logBlockOnce failed trigger=${input.triggerId} contact=${input.contactId} reason=${input.reason}:`,
      err,
    );
    return false;
  }
}

/**
 * XOÁ mọi marker chặn của 1 khách trong 1 trigger (NV-1). Gọi khi luồng chạy lại:
 * resume cron, nút "Gửi bước tiếp ngay", reset quota. Để đợt chặn MỚI sau đó ghi log mới.
 * Xoá theo danh sách category cố định (≤ ~13 key) → 1 lệnh DEL, KHÔNG SCAN keyspace.
 */
export async function clearBlockMarker(
  triggerId: string,
  contactId: string,
  opts?: { redis?: Redis; category?: BlockCategory },
): Promise<void> {
  try {
    const redis = opts?.redis ?? getBullMQRedis();
    const keys = opts?.category
      ? [markerKey(triggerId, contactId, opts.category)]
      : ALL_BLOCK_CATEGORIES.map((c) => markerKey(triggerId, contactId, c));
    await redis.del(...keys);
  } catch (err) {
    logger.warn(
      `[block-logger] clearBlockMarker failed trigger=${triggerId} contact=${contactId}:`,
      err,
    );
  }
}
