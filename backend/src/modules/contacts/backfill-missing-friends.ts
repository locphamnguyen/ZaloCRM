// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * backfill-missing-friends.ts — Tạo Friend row thiếu cho mọi Conversation.
 *
 * Use case: sau merge cũ (PR 2c trước đó) bị delete Friend duplicate khi 2 Friend
 * cùng (zaloAccountId, contactId) — vì unique constraint cũ. Conversation tồn tại
 * nhưng không còn Friend tương ứng → UI expand chỉ thấy 2 nick dù badge "Đa nick (3)".
 *
 * Đã drop unique([zaloAccountId, contactId]). Script này tạo Friend cho mỗi
 * Conversation user-thread không có Friend matching (zaloAccountId, zaloUidInNick).
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface MissingFriendBackfillResult {
  conversationsScanned: number;
  friendsCreated: number;
}

export async function backfillMissingFriends(): Promise<MissingFriendBackfillResult> {
  // Chỉ xét user thread (group conversations không có per-pair Friend semantic).
  const conversations = await prisma.conversation.findMany({
    where: { threadType: 'user', contactId: { not: null }, externalThreadId: { not: null } },
    select: {
      id: true, orgId: true, zaloAccountId: true, contactId: true, externalThreadId: true,
      lastMessageAt: true,
    },
  });

  const result: MissingFriendBackfillResult = { conversationsScanned: conversations.length, friendsCreated: 0 };

  for (const conv of conversations) {
    const exists = await prisma.friend.findFirst({
      where: { zaloAccountId: conv.zaloAccountId, zaloUidInNick: conv.externalThreadId! },
      select: { id: true },
    });
    if (exists) continue;

    // Resolve default status cho org
    const defaultStatus = await prisma.status.findFirst({
      where: { orgId: conv.orgId, isDefault: true },
      select: { id: true },
    });

    try {
      await prisma.friend.create({
        data: {
          orgId: conv.orgId,
          contactId: conv.contactId!,
          zaloAccountId: conv.zaloAccountId,
          zaloUidInNick: conv.externalThreadId!,
          hasConversation: true,
          // Conservative: chưa rõ relationshipKind, fallback 'chatting_stranger'
          relationshipKind: 'chatting_stranger',
          friendshipStatus: 'none',
          firstMessageAt: conv.lastMessageAt,
          statusId: defaultStatus?.id ?? null,
          leadScore: 0,
        },
      });
      result.friendsCreated++;
    } catch (err) {
      logger.warn(`[backfill-friends] create failed for conv ${conv.id}:`, err);
    }
  }

  logger.info(`[backfill-missing-friends] scanned=${result.conversationsScanned} created=${result.friendsCreated}`);
  return result;
}
