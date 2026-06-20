// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * internal-contact-handshake-hook.ts — Phase Internal Contact 2-method 2026-05-23.
 *
 * Khi friend_event hook bắn `accepted` với (zaloAccountId, zaloUidInNick):
 *   - Check xem có SystemNotifyRecipient nào đang ở state pending_friend_request không
 *     mà thread khớp.
 *   - Có hai trường hợp:
 *     1. Cách 1: zaloAccountId = nick OWN A của sale, target = nick Hệ Thống S.
 *        → Friend table sẽ có row (A, uidS_from_A) — không có recipient match.
 *        Đồng thời S cũng sẽ chạy applyFriendTransition khi accept → (S, uidA_from_S),
 *        match đúng recipient.
 *     2. Cách 2: zaloAccountId = nick Hệ Thống S, target = personal phone UID.
 *        → Match recipient.threadIdInSenderView trực tiếp.
 *
 * Match → generate verify code, gửi tin verify, update status='pending_user_confirm'.
 */
import { createHash, randomInt } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';

const VERIFY_CODE_TTL_MS = 30 * 60 * 1000;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateVerifyCode(): string {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

function buildVerifyMessage(code: string): string {
  return `Mã xác nhận thiết lập nhận thông báo hệ thống: ${code}\n\nGõ lại mã 4 số này trên CRM để hoàn tất. Mã hết hạn sau 30 phút.`;
}

export async function onFriendAcceptedForInternalContact(args: {
  orgId: string;
  zaloAccountId: string;
  zaloUidInNick: string;
}) {
  // Chỉ care khi nick chính là sender system hiện tại của org
  const org = await prisma.organization.findUnique({
    where: { id: args.orgId },
    select: { systemNotifyZaloAccountId: true },
  });
  if (!org?.systemNotifyZaloAccountId || org.systemNotifyZaloAccountId !== args.zaloAccountId) {
    return;
  }

  // Tìm recipient đang chờ accept với threadIdInSenderView = uid này
  const recipient = await prisma.systemNotifyRecipient.findFirst({
    where: {
      senderZaloAccountId: args.zaloAccountId,
      threadIdInSenderView: args.zaloUidInNick,
      status: 'pending_friend_request',
    },
  });
  if (!recipient) return;

  // Generate + send verify code
  const code = generateVerifyCode();
  const api = zaloPool.getApi(args.zaloAccountId);
  if (!api) {
    logger.warn(`[internal-contact-hook] sender ${args.zaloAccountId} not in pool, skipping verify send`);
    return;
  }
  try {
    await api.sendMessage({ msg: buildVerifyMessage(code) }, args.zaloUidInNick, 0);
  } catch (err: any) {
    logger.warn(`[internal-contact-hook] sendVerifyCode failed: ${err?.message || err}`);
    return;
  }

  await prisma.systemNotifyRecipient.update({
    where: { id: recipient.id },
    data: {
      status: 'pending_user_confirm',
      verifyCode: hashCode(code),
      verifyCodeExpiresAt: new Date(Date.now() + VERIFY_CODE_TTL_MS),
      verifyAttempts: 0,
      lastVerifiedAt: new Date(),
      error: null,
    },
  });
  logger.info(`[internal-contact-hook] sent verify code to user=${recipient.targetUserId} uid=${args.zaloUidInNick}`);
}
