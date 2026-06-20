// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * receiver.ts — Cầu Telegram chiều RA (Phase 2): sale gõ trong topic Telegram → khách Zalo nhận.
 *
 * Long-poll getUpdates → với mỗi tin sale gõ trong 1 topic đã map → resolve về (nick, hội thoại)
 * → gửi qua zaloOps.sendMessage (tái dùng pool, KHÔNG phiên thứ 2) → tạo row CRM (senderType=self,
 * đánh dấu bridge). Echo selfListen của Zalo sẽ bị P2002 dedup theo zaloMsgId trong message-handler
 * (return TRƯỚC publishMessagePersisted) → KHÔNG re-forward, KHÔNG loop. Thêm set msgId in-memory
 * phòng hờ cho inbound forwarder.
 *
 * Phase 2 = TEXT. Media-từ-Telegram (tải file Telegram → gửi Zalo) = Phase 2.5. Phân quyền theo
 * Telegram-user↔CRM-user (checkZaloAccess) = Phase 3; giờ thành viên group = quyền (owner kiểm soát group).
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { zaloOps } from '../../../../shared/zalo-operations.js';
import { getUpdates, sendMessage, downloadTelegramFile, cleanupTempFile, type TgMessageUpdate } from './telegram-api.js';
import { emitChatMessage } from '../../../../shared/realtime/emit-chat.js';
import { zaloPool } from '../../../zalo/zalo-pool.js';
import { redeemLinkCode, getLinkedUser } from './link.js';
import { hasZaloAccess } from '../../../zalo/zalo-access-middleware.js';

// Rút thông tin media từ tin Telegram → file_id + cách gửi Zalo + TÊN GỐC (Zalo hiển thị theo tên này).
function extractMedia(
  m: NonNullable<TgMessageUpdate['message']>,
): { fileId: string; kind: 'image' | 'file'; filename: string } | null {
  if (m.photo && m.photo.length) return { fileId: m.photo[m.photo.length - 1]!.file_id, kind: 'image', filename: 'photo.jpg' };
  if (m.sticker) return { fileId: m.sticker.file_id, kind: 'image', filename: 'sticker.webp' };
  if (m.document) return { fileId: m.document.file_id, kind: 'file', filename: m.document.file_name || 'file' };
  if (m.video) return { fileId: m.video.file_id, kind: 'file', filename: m.video.file_name || 'video.mp4' };
  if (m.voice) return { fileId: m.voice.file_id, kind: 'file', filename: 'voice.ogg' };
  if (m.audio) return { fileId: m.audio.file_id, kind: 'file', filename: m.audio.file_name || 'audio.mp3' };
  return null;
}

let running = false;
let offset = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// msgId cầu vừa gửi → inbound forwarder bỏ qua echo (phòng hờ; chính yếu là P2002 dedup).
const bridgeSentMsgIds = new Map<string, number>(); // zaloMsgId → expiry ms

export function wasSentByBridge(zaloMsgId: string | null | undefined): boolean {
  if (!zaloMsgId) return false;
  const exp = bridgeSentMsgIds.get(zaloMsgId);
  if (!exp) return false;
  if (Date.now() > exp) {
    bridgeSentMsgIds.delete(zaloMsgId);
    return false;
  }
  return true;
}

function markBridgeSent(zaloMsgId: string): void {
  bridgeSentMsgIds.set(zaloMsgId, Date.now() + 120_000);
  if (bridgeSentMsgIds.size > 500) {
    const now = Date.now();
    for (const [k, exp] of bridgeSentMsgIds) if (now > exp) bridgeSentMsgIds.delete(k);
  }
}

export function startTelegramReceiver(): void {
  if (running) return;
  running = true;
  void pollLoop();
  logger.info('[telegram-bridge] receiver BẬT — long-poll getUpdates (chiều ra).');
}

export function stopTelegramReceiver(): void {
  running = false;
}

async function pollLoop(): Promise<void> {
  // Drain update cũ lúc boot (offset=-1 lấy update mới nhất) → tránh re-gửi tin Telegram
  // cũ sau restart. Đánh đổi: reply gửi LÚC bridge down sẽ bị bỏ (an toàn hơn double-send).
  const initial = await getUpdates(-1, 0);
  if (initial && initial.length > 0) offset = initial[initial.length - 1]!.update_id + 1;

  let consecutiveFails = 0;
  while (running) {
    const updates = await getUpdates(offset, 25);
    if (updates === null) {
      // Long-poll tới Telegram chập chờn → backoff tăng dần (2s → tối đa 15s) rồi retry.
      consecutiveFails++;
      await sleep(Math.min(2000 * consecutiveFails, 15_000));
      continue;
    }
    consecutiveFails = 0;
    for (const u of updates) {
      offset = u.update_id + 1;
      try {
        await processUpdate(u);
      } catch (err) {
        logger.warn(`[telegram-bridge] processUpdate lỗi: ${String(err)}`);
      }
    }
  }
}

async function processUpdate(u: TgMessageUpdate): Promise<void> {
  const m = u.message;
  if (!m) return;
  if (m.from?.is_bot) return; // bỏ tin của bot

  // /link <mã> — gắn tài khoản Telegram ↔ user CRM (Phase 3.1). Xử ở bất kỳ chat nào.
  if (m.text && m.text.trim().toLowerCase().startsWith('/link')) {
    const linkChatId = String(m.chat.id);
    const code = m.text.trim().split(/\s+/)[1] || '';
    const ok = code ? await redeemLinkCode(code, String(m.from?.id ?? '')) : false;
    await sendMessage(
      linkChatId,
      ok
        ? '✅ Đã liên kết tài khoản Telegram với CRM. Giờ bạn gửi tin được.'
        : '⚠️ Cú pháp: /link [mã lấy ở CRM]. Mã sai hoặc đã hết hạn.',
      m.message_thread_id,
    );
    return;
  }
  if (!m.message_thread_id) return; // tin ngoài topic (General) → bỏ

  const chatId = String(m.chat.id);
  const topic = await prisma.telegramTopicMap.findFirst({
    where: { telegramChatId: chatId, telegramTopicId: m.message_thread_id },
    select: { conversationId: true },
  });
  if (!topic) return;

  const conv = await prisma.conversation.findUnique({
    where: { id: topic.conversationId },
    select: {
      id: true,
      zaloAccountId: true,
      externalThreadId: true,
      threadType: true,
      zaloAccount: {
        select: {
          status: true,
          orgId: true,
          privacyMode: true,
          ownerUserId: true,
          telegramBridge: { select: { enabled: true } },
        },
      },
    },
  });
  if (!conv || !conv.externalThreadId) return;
  if (!conv.zaloAccount.telegramBridge?.enabled) return;
  // (Phase 3: checkZaloAccess theo Telegram-user↔CRM-user. Phase 2: thành viên group = quyền.)

  const threadType: 0 | 1 = conv.threadType === 'group' ? 1 : 0;

  // Nick phải đang connected mới gửi được.
  if (conv.zaloAccount.status !== 'connected') {
    await sendMessage(chatId, '⚠️ Nick Zalo đang mất kết nối — chưa gửi được, thử lại sau.', m.message_thread_id);
    return;
  }

  // RBAC (Phase 3.2): tài khoản Telegram phải đã /link + có quyền chat nick (ZaloAccountAccess).
  const linked = await getLinkedUser(String(m.from?.id ?? ''));
  if (!linked) {
    await sendMessage(chatId, '⚠️ Chưa liên kết. Lấy mã ở CRM rồi gõ: /link [mã].', m.message_thread_id);
    return;
  }
  const crmUser = await prisma.user.findUnique({
    where: { id: linked.userId },
    select: { role: true, orgId: true, fullName: true },
  });
  const allowed = crmUser
    ? await hasZaloAccess({
        userId: linked.userId,
        orgId: crmUser.orgId,
        role: crmUser.role,
        zaloAccountId: conv.zaloAccountId,
        minPermission: 'chat',
      })
    : false;
  if (!allowed) {
    await sendMessage(chatId, '⚠️ Bạn không có quyền chat nick Zalo này.', m.message_thread_id);
    return;
  }
  const senderCrmName = crmUser?.fullName || m.from?.first_name || m.from?.username || 'Sale';

  // ── Phase 2.5: MEDIA từ Telegram → Zalo ──
  // Tải file Telegram về temp → gửi qua zaloOps (cần local path). KHÔNG tạo row: echo
  // selfListen sẽ tạo row với media THẬT (Zalo CDN→minio), forwarder bỏ qua (markBridgeSent).
  const media = extractMedia(m);
  if (media) {
    const tmp = await downloadTelegramFile(media.fileId, media.filename);
    if (!tmp) {
      await sendMessage(chatId, '⚠️ Không tải được file từ Telegram để gửi Zalo.', m.message_thread_id);
      return;
    }
    try {
      const caption = m.caption || '';
      const sendResult =
        media.kind === 'image'
          ? await zaloOps.sendImage(conv.zaloAccountId, conv.externalThreadId, threadType, [tmp], null, caption)
          : await zaloOps.sendFile(conv.zaloAccountId, conv.externalThreadId, threadType, [tmp], null, caption);
      const sr = sendResult as { message?: { msgId?: number | string } | null; attachment?: Array<{ msgId?: number | string }> };
      const zaloMsgId = String(sr?.message?.msgId ?? sr?.attachment?.[0]?.msgId ?? '');
      if (zaloMsgId) markBridgeSent(zaloMsgId);
    } catch (err) {
      logger.warn(`[telegram-bridge] gửi media Zalo lỗi (conv=${conv.id}): ${String(err)}`);
      await sendMessage(chatId, '⚠️ Gửi media sang Zalo thất bại.', m.message_thread_id);
    } finally {
      await cleanupTempFile(tmp);
    }
    return; // media xong
  }

  if (!m.text) return; // không media + không text → bỏ
  const text = m.text;

  try {
    const sendResult = await zaloOps.sendMessage(conv.zaloAccountId, conv.externalThreadId, threadType, { msg: text }, null);
    const sr = sendResult as { message?: { msgId?: number | string } | null; attachment?: Array<{ msgId?: number | string }> };
    const zaloMsgId = String(sr?.message?.msgId ?? sr?.attachment?.[0]?.msgId ?? '');
    if (zaloMsgId) markBridgeSent(zaloMsgId);

    // Tạo row CRM (self, đánh dấu bridge) → hiện trong chat CRM + echo bị P2002 dedup.
    const senderName = senderCrmName;
    try {
      const created = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: conv.id,
          zaloMsgId: zaloMsgId || null,
          zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
          senderType: 'self',
          content: text,
          contentType: 'text',
          sentAt: new Date(),
          sentVia: 'bridge',
          metadata: { sender: { kind: 'bridge', name: senderName, via: 'telegram' } },
        },
      });
      await prisma.conversation
        .update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), isReplied: true } })
        .catch(() => {});
      // Realtime: đẩy tin lên UI chat CRM ngay (khỏi refresh) — cùng helper với chat web.
      await emitChatMessage({
        io: zaloPool.getIO(),
        orgId: conv.zaloAccount.orgId,
        accountId: conv.zaloAccountId,
        conversationId: conv.id,
        message: created,
        privacyMode: conv.zaloAccount.privacyMode,
        ownerUserId: conv.zaloAccount.ownerUserId,
      }).catch(() => {});
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') {
        logger.warn(`[telegram-bridge] tạo row lỗi: ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`[telegram-bridge] gửi Zalo lỗi (conv=${conv.id}): ${String(err)}`);
    await sendMessage(chatId, '⚠️ Gửi sang Zalo thất bại. Anh/chị thử lại nhé.', m.message_thread_id);
  }
}
