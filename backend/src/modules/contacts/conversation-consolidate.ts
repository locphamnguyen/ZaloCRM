// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * conversation-consolidate.ts — Gộp HỘI THOẠI bị XÉ (2026-06-22, anh chốt).
 *
 * Bối cảnh (RCA docs/rca-chat-split-conversation-20260622.md): cùng 1 người Zalo, 1 nick
 * có thể thấy NHIỀU UID (per-account UID drift) → nhiều conversation cho cùng (contact, nick).
 * Sau mergeContacts (gộp contact theo globalId), các conversation đó dồn về 1 contact nhưng
 * VẪN tách rời (unique theo (nick, externalThreadId)) → tin nhắn xé, UI mở 1 cái → "Chưa có tin".
 *
 * Hàm này gộp: với mỗi (contact, nick) có >1 conversation → chọn CANONICAL (nhiều tin nhất,
 * tie → cũ nhất), dời message + FK phụ về canonical, XÓA conversation rỗng còn lại.
 * Idempotent. Dùng cho mergeContacts (A1) + script dọn data (A3).
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface ConsolidateResult {
  groups: number;        // số (nick) có >1 conversation đã gộp
  conversationsRemoved: number;
  messagesMoved: number;
}

/**
 * Gộp các conversation trùng (cùng nick) của 1 contact về 1 canonical mỗi nick.
 * KHÔNG throw cho từng nhóm — lỗi 1 nhóm không chặn nhóm khác (log + tiếp).
 */
export async function consolidateContactConversations(contactId: string): Promise<ConsolidateResult> {
  const result: ConsolidateResult = { groups: 0, conversationsRemoved: 0, messagesMoved: 0 };

  // Đếm message mỗi conversation → chọn canonical. Gom theo nick (zaloAccountId).
  const convs = await prisma.conversation.findMany({
    where: { contactId },
    select: { id: true, zaloAccountId: true, createdAt: true, _count: { select: { messages: true } } },
  });
  const byNick = new Map<string, typeof convs>();
  for (const c of convs) {
    const arr = byNick.get(c.zaloAccountId) ?? [];
    arr.push(c);
    byNick.set(c.zaloAccountId, arr);
  }

  for (const [nickId, group] of byNick) {
    if (group.length < 2) continue;
    // Canonical = nhiều tin nhất, tie → cũ nhất (createdAt asc).
    group.sort((a, b) =>
      b._count.messages - a._count.messages ||
      a.createdAt.getTime() - b.createdAt.getTime());
    const canonical = group[0];
    const others = group.slice(1);
    try {
      for (const dup of others) {
        const moved = await mergeOneConversation(dup.id, canonical.id);
        result.messagesMoved += moved;
        result.conversationsRemoved += 1;
      }
      result.groups += 1;
      logger.info(`[conv-consolidate] contact=${contactId} nick=${nickId} → canonical=${canonical.id}, gộp ${others.length} conv (${result.messagesMoved} tin)`);
    } catch (err) {
      logger.error(`[conv-consolidate] contact=${contactId} nick=${nickId} gộp lỗi:`, err);
    }
  }
  return result;
}

/**
 * Dời TOÀN BỘ của conversation `fromId` → `toId` rồi XÓA `fromId`.
 * - messages: dời, BỎ QUA tin trùng zaloMsgId đã có ở canonical (unique (conversationId, zaloMsgId)).
 * - media_usage_events / ai_suggestions / system_notify_recipients / system_notifications: dời (append-only).
 * - pinned_conversations: dedup (xóa của fromId nếu toId đã pin, ngược lại dời).
 * - telegram_topic_maps: unique conversationId → xóa của fromId (cầu Telegram off prod).
 * Trả số message đã dời.
 */
async function mergeOneConversation(fromId: string, toId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    // 1. Dời message KHÔNG trùng zaloMsgId (giữ unique). Trả số dòng dời.
    const movedRows = await tx.$executeRaw`
      UPDATE messages m
      SET conversation_id = ${toId}
      WHERE m.conversation_id = ${fromId}
        AND (
          m.zalo_msg_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM messages t WHERE t.conversation_id = ${toId} AND t.zalo_msg_id = m.zalo_msg_id
          )
        )
    `;
    // 2. Tin trùng zaloMsgId còn sót ở fromId (đã có bản ở canonical) → xóa (an toàn, là bản dup).
    await tx.$executeRaw`DELETE FROM messages WHERE conversation_id = ${fromId}`;

    // 3. FK phụ (append-only / nullable) → dời thẳng.
    await tx.mediaUsageEvent.updateMany({ where: { conversationId: fromId }, data: { conversationId: toId } }).catch(() => {});
    await tx.aiSuggestion.updateMany({ where: { conversationId: fromId }, data: { conversationId: toId } }).catch(() => {});
    await tx.systemNotifyRecipient.updateMany({ where: { conversationId: fromId }, data: { conversationId: toId } }).catch(() => {});
    await tx.systemNotification.updateMany({ where: { conversationId: fromId }, data: { conversationId: toId } }).catch(() => {});

    // 4. Pinned (unique conversationId): dedup.
    const toPinned = await tx.pinnedConversation.findFirst({ where: { conversationId: toId }, select: { id: true } });
    if (toPinned) await tx.pinnedConversation.deleteMany({ where: { conversationId: fromId } }).catch(() => {});
    else await tx.pinnedConversation.updateMany({ where: { conversationId: fromId }, data: { conversationId: toId } }).catch(() => {});

    // 5. Telegram topic map (unique conversationId): cầu off prod → xóa của fromId.
    await tx.telegramTopicMap.deleteMany({ where: { conversationId: fromId } }).catch(() => {});

    // 6. Xóa conversation rỗng (messages đã dời/xóa hết → onDelete Cascade không còn gì để xóa).
    await tx.conversation.delete({ where: { id: fromId } });

    return Number(movedRows);
  });
}
