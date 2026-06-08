// ════════════════════════════════════════════════════════════════════════
// CareSession — Gửi thông báo tới NHÓM Zalo — 2026-06-07 (T10c/T10d)
// ════════════════════════════════════════════════════════════════════════
//
// Anh chốt: gửi nhóm = gửi user-to-user (nick hệ thống đã ở trong nhóm) →
// sendMessage(groupThreadId, threadType=1). SDK đã support (zalo-operations.ts:243),
// 4 chỗ code đã gửi nhóm. KHÔNG bị rate-limit (tin trong nhóm như tin bạn bè).
//
// Dùng nick gửi hệ thống của org (Organization.systemNotifyZaloAccountId). UID nhóm
// nhìn từ góc nick gửi → admin nhập tay ở Settings (internalNotifyGroupThreadId).

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { zaloPool } from '../../zalo/zalo-pool.js';

// Anti-spam dedup theo dedupeKey (Redis short TTL) — chống gửi nhóm trùng khi đa phiên.
const groupDedup = new Set<string>();

/**
 * Gửi 1 thông báo tới nhóm Zalo qua nick hệ thống.
 * @returns true nếu đã gửi, false nếu skip (dedup / thiếu cấu hình).
 */
export async function sendGroupNotification(args: {
  orgId: string;
  groupThreadId: string;
  content: string;
  dedupeKey?: string;
}): Promise<boolean> {
  // Dedup trong-process ngắn (đa phiên cùng eventId → 1 tin nhóm).
  if (args.dedupeKey) {
    if (groupDedup.has(args.dedupeKey)) return false;
    groupDedup.add(args.dedupeKey);
    // Tự dọn sau 30s (tránh memory leak).
    setTimeout(() => groupDedup.delete(args.dedupeKey!), 30_000);
  }

  const org = await prisma.organization.findUnique({
    where: { id: args.orgId },
    select: { systemNotifyZaloAccountId: true },
  });
  if (!org?.systemNotifyZaloAccountId) {
    logger.warn(`[group-notify] org=${args.orgId} chưa cấu hình nick gửi hệ thống`);
    return false;
  }

  const api = zaloPool.getApi(org.systemNotifyZaloAccountId);
  if (!api) {
    logger.warn(`[group-notify] nick gửi hệ thống chưa connected (org=${args.orgId})`);
    return false;
  }

  try {
    // threadType=1 = group. KHÔNG check rate-limit (tin nhóm không bị Zalo bóp).
    await api.sendMessage(
      { msg: args.content } as Parameters<typeof api.sendMessage>[0],
      args.groupThreadId,
      1,
    );
    // Lưu audit SystemNotification (channel=zalo, type group).
    await prisma.systemNotification.create({
      data: {
        id: randomUUID(),
        orgId: args.orgId,
        type: 'care_group',
        title: 'Báo cáo nhóm',
        content: args.content,
        priority: 'normal',
        senderZaloAccountId: org.systemNotifyZaloAccountId,
        targetUserId: org.systemNotifyZaloAccountId, // group: dùng nick gửi làm placeholder
        channel: 'zalo',
        status: 'sent',
        sentAt: new Date(),
      },
    });
    logger.info(`[group-notify] sent to group=${args.groupThreadId} org=${args.orgId}`);
    return true;
  } catch (err) {
    logger.warn(`[group-notify] send failed group=${args.groupThreadId}: ${(err as Error).message}`);
    return false;
  }
}
