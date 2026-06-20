// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * emit-chat.ts — Privacy realtime emit helper (2026-06-11)
 *
 * GỐC RỄ vá lỗ "socket chat:message phát nội dung thật của nick Riêng tư xuống mọi
 * client, FE chỉ blur" (audit 2026-06-11, finding C1/C2/C8/C9/realtime-socket).
 *
 * Nguyên tắc:
 *   1. KHÔNG bao giờ `io.emit` bare (broadcast toàn cục → rò cross-tenant). Luôn
 *      scope theo room `org:${orgId}`.
 *   2. Với nick privacyMode==='main' (Riêng tư): KHÔNG gửi nội dung thật ra room org.
 *      - Room `org:${orgId}` nhận bản ĐÃ redactMessage (content/attachments/quote/
 *        senderName blur, redacted:true).
 *      - Chính chủ (ownerUserId) NẾU đang có phiên mở khóa OTP active → nhận thêm bản
 *        THẬT ở room riêng `user:${ownerUserId}` (per-recipient mượt — anh chốt
 *        2026-06-11). FE ưu tiên bản thật khi nhận trùng id.
 *      - Owner CHƯA unlock → chỉ nhận bản mờ realtime; mở khóa xong tin mới sẽ thật,
 *        tin cũ fetch HTTP (đã gate).
 *   3. Với nick 'sub' (Thường): emit nguyên bản tới room org.
 *
 * Lưu ý: socket-auth.ts join sẵn cả `org:${orgId}` lẫn `user:${userId}`.
 */
import type { Server } from 'socket.io';
import { redactMessage, type PrivacyContext } from '../../modules/privacy/redact.js';
import { hasActivePrivacySession } from '../../modules/privacy/session-service.js';
import { logger } from '../utils/logger.js';

export interface EmitChatConv {
  zaloAccount: { privacyMode: string; ownerUserId: string | null };
}

export interface EmitChatArgs {
  io: Server | undefined | null;
  orgId: string;
  accountId: string;
  conversationId: string;
  /** Message object đã serialize-safe (BigInt → string). */
  message: any;
  /** privacyMode + ownerUserId của nick (để quyết định redact). */
  privacyMode: string;
  ownerUserId: string | null;
  /** Field phụ kèm theo event (vd mentions) — optional. */
  extra?: Record<string, unknown>;
}

/**
 * Emit 'chat:message' an toàn theo privacy. Thay cho mọi `io.emit('chat:message', ...)`.
 */
export async function emitChatMessage(args: EmitChatArgs): Promise<void> {
  const { io, orgId, accountId, conversationId, message, privacyMode, ownerUserId, extra } = args;
  if (!io) return;

  const basePayload = { accountId, conversationId, ...(extra ?? {}) };
  const conv: EmitChatConv = { zaloAccount: { privacyMode, ownerUserId } };

  // Nick Thường → emit nguyên bản tới room org (đã chặn cross-tenant).
  if (privacyMode !== 'main') {
    io.to(`org:${orgId}`).emit('chat:message', {
      ...basePayload,
      message,
      _privacyMeta: { privacyMode, ownerUserId },
    });
    return;
  }

  // Nick Riêng tư → room org nhận bản ĐÃ redact (không bao giờ có content thật).
  const redactCtx: PrivacyContext = {
    viewerUserId: null,
    orgId,
    privacyUnlocked: false,
  };
  const redacted = redactMessage(message, conv as any, redactCtx);
  io.to(`org:${orgId}`).emit('chat:message', {
    ...basePayload,
    message: redacted,
    _privacyMeta: { privacyMode, ownerUserId },
  });

  // Chính chủ đã mở khóa OTP → nhận bản THẬT ở room riêng (per-recipient mượt).
  if (ownerUserId) {
    try {
      const unlocked = await hasActivePrivacySession(ownerUserId);
      if (unlocked) {
        io.to(`user:${ownerUserId}`).emit('chat:message', {
          ...basePayload,
          message, // bản thật
          _privacyMeta: { privacyMode, ownerUserId },
        });
      }
    } catch (err) {
      // Không để lỗi check session làm rớt emit chính (room org đã nhận bản mờ).
      logger.warn('[emit-chat] check owner unlock failed:', err);
    }
  }
}
