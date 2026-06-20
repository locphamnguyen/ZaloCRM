// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * contact-aggregate.ts — keep Contact's last-message + counter fields fresh.
 *
 * Called from every place a Message row is created (inbound listener, manual
 * send, automation send, sticker/link/card send) and on undo events.
 *
 * Two semantics:
 *  - last* fields use set-if-newer (idempotent under re-delivery, correct
 *    under out-of-order processing).
 *  - total* counters increment unconditionally — caller MUST only invoke
 *    once per actually-created Message row (i.e. after a successful create
 *    that did not hit the dedup path).
 */
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { counterDelta, deriveRelationshipKind } from '../zalo/friend-event-handler.js';
import { logActivity } from '../activity/activity-logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { ensureContactCollaborator } from './contact-scope.js';

const PREVIEW_LIMIT = 200;

const CONTENT_TYPE_LABEL: Record<string, string> = {
  image: '📷 Hình ảnh',
  file: '📎 File đính kèm',
  sticker: '🎴 Nhãn dán',
  voice: '🎤 Tin nhắn thoại',
  video: '🎥 Video',
  gif: '🎞️ GIF',
  link: '🔗 Liên kết',
  contact_card: '👤 Danh thiếp',
  location: '📍 Vị trí',
};

function makePreview(content: string | null, contentType: string): string | null {
  const trimmed = content?.trim();
  if (trimmed) return trimmed.slice(0, PREVIEW_LIMIT);
  return CONTENT_TYPE_LABEL[contentType] ?? null;
}

export interface AggregateMessageInput {
  conversationId: string;
  message: {
    id: string;
    content: string | null;
    contentType: string;
    sentAt: Date;
    senderType: 'self' | 'contact';
  };
  /** For self/outbound: the CRM user who triggered the send (if known). */
  outboundUserId?: string | null;
  /** Snapshot tên Zalo của KH nhìn từ nick này (lưu vào Friend.zaloDisplayName). */
  contactZaloDisplayName?: string | null;
  /** Snapshot avatar Zalo của KH nhìn từ nick này (Friend.zaloAvatarUrl). */
  contactZaloAvatarUrl?: string | null;
}

/**
 * Update Contact.last{Inbound,Outbound}* and increment counters after a
 * Message row was just created. Skips group conversations and missing
 * contactId. Errors are logged, not thrown — aggregate update is best-effort.
 */
export async function applyContactAggregateFromMessage(
  args: AggregateMessageInput,
): Promise<void> {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { contactId: true, zaloAccountId: true, threadType: true },
    });
    if (!conv?.contactId) return;
    if (conv.threadType === 'group') return;

    const { message } = args;
    const sentAt = message.sentAt;
    const preview = makePreview(message.content, message.contentType);
    const isInbound = message.senderType === 'contact';
    const contactId = conv.contactId;

    // ── First inbound/outbound detection ──────────────────────────────────
    // Đọc counter trước khi increment để biết tin nhắn này có phải đầu tiên không.
    // Best-effort: nếu fail thì skip log, KHÔNG block main flow.
    let isFirstInbound = false;
    let isFirstOutbound = false;
    try {
      const counters = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { totalInbound: true, totalOutbound: true, orgId: true },
      });
      if (counters) {
        isFirstInbound = isInbound && counters.totalInbound === 0;
        isFirstOutbound = !isInbound && counters.totalOutbound === 0;
        if (isFirstInbound) {
          logActivity({
            orgId: counters.orgId,
            systemSource: 'message_sync',
            action: 'first_inbound',
            entityType: 'contact',
            entityId: contactId,
            details: { messageId: message.id, sentAt, preview },
          });
        }
        if (isFirstOutbound) {
          logActivity({
            orgId: counters.orgId,
            userId: args.outboundUserId || null,
            systemSource: args.outboundUserId ? undefined : 'message_sync',
            action: 'first_outbound',
            entityType: 'contact',
            entityId: contactId,
            details: { messageId: message.id, sentAt, preview },
          });
        }
      }
    } catch {
      // Silent — log không được block aggregate
    }

    if (isInbound) {
      // Conditional set-if-newer for last inbound fields
      await prisma.contact.updateMany({
        where: {
          id: contactId,
          OR: [
            { lastInboundAt: null },
            { lastInboundAt: { lt: sentAt } },
          ],
        },
        data: {
          lastInboundAt: sentAt,
          lastInboundMessageId: message.id,
          lastInboundPreview: preview,
          lastInboundType: message.contentType,
        },
      });
      // Counter (unconditional — caller dedups on creation)
      await prisma.contact.update({
        where: { id: contactId },
        data: { totalInbound: { increment: 1 } },
      });
    } else {
      await prisma.contact.updateMany({
        where: {
          id: contactId,
          OR: [
            { lastOutboundAt: null },
            { lastOutboundAt: { lt: sentAt } },
          ],
        },
        data: {
          lastOutboundAt: sentAt,
          lastOutboundMessageId: message.id,
          lastOutboundPreview: preview,
          lastOutboundType: message.contentType,
          lastOutboundByUserId: args.outboundUserId ?? undefined,
          lastOutboundByZaloAccountId: conv.zaloAccountId,
        },
      });
      await prisma.contact.update({
        where: { id: contactId },
        data: { totalOutbound: { increment: 1 } },
      });
    }
  } catch (err) {
    logger.warn(`[contact-aggregate] apply failed for conv=${args.conversationId}:`, err);
  }
}

export interface InteractionInput {
  conversationId: string;
  type: string;          // message_recalled / reaction_* / typing / read_receipt / ...
  occurredAt: Date;
  payload?: Record<string, unknown>;
}

/**
 * Update Contact.lastInteraction* on a non-message event (recall, reaction, …).
 * Set-if-newer semantics. Best-effort.
 */
export async function applyContactInteraction(args: InteractionInput): Promise<void> {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { contactId: true, threadType: true },
    });
    if (!conv?.contactId) return;
    if (conv.threadType === 'group') return;

    await prisma.contact.updateMany({
      where: {
        id: conv.contactId,
        OR: [
          { lastInteractionAt: null },
          { lastInteractionAt: { lt: args.occurredAt } },
        ],
      },
      data: {
        lastInteractionAt: args.occurredAt,
        lastInteractionType: args.type,
        // Prisma's JSON column rejects `unknown`-typed records; cast for write.
        lastInteractionPayload: (args.payload ?? undefined) as any,
      },
    });
  } catch (err) {
    logger.warn(`[contact-aggregate] interaction apply failed conv=${args.conversationId}:`, err);
  }
}

/**
 * On every persisted message with a 1-1 conversation, ensure Friend row exists
 * (creating chatting_stranger if it's the first message and no friendship was
 * established) and update per-pair aggregates. Best-effort.
 *
 * Counter rules:
 *   - new Friend row from stranger chat → chattingNicksCount += 1
 *   - existing Friend with hasConversation flipping false→true → recompute
 *     relationshipKind (e.g. ghost stays ghost; pending_friend stays pending_friend)
 *
 * Per-pair aggregate:
 *   - lastInboundAt/lastOutboundAt: set-if-newer
 *   - totalInbound/totalOutbound: increment
 *   - firstMessageAt: set if null
 */
export async function applyFriendAggregate(args: AggregateMessageInput): Promise<void> {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { contactId: true, zaloAccountId: true, threadType: true, orgId: true, externalThreadId: true },
    });
    if (!conv?.contactId) return;
    if (conv.threadType === 'group') return;
    if (!conv.externalThreadId) return;

    const { message } = args;
    const sentAt = message.sentAt;
    const isInbound = message.senderType === 'contact';
    // Phase Contact Scope Hybrid 2026-05-27 — per-pair preview cho list KH render
    // theo "view của riêng nick này". Reuse logic makePreview() (line 35).
    const preview = makePreview(message.content, message.contentType);

    // Deferred socket emits — collect inside transaction, flush after commit
    // để tránh emit khi rollback. Mỗi entry sẽ thành 1 'friend:updated' socket event.
    const emitQueue: Array<{
      friendId: string;
      contactId: string;
      zaloAccountId: string;
      orgId: string;
      patch: Record<string, unknown>;
    }> = [];

    await tenantTransaction(async (tx) => {
      // Friend identity = (zaloAccountId, zaloUidInNick) — externalThreadId của conversation
      // chính là zaloUidInNick (UID per-account của khách qua nick này).
      const existing = await tx.friend.findUnique({
        where: {
          zaloAccountId_zaloUidInNick: {
            zaloAccountId: conv.zaloAccountId,
            zaloUidInNick: conv.externalThreadId!,
          },
        },
      });

      // B8 fix — Backfill Contact.fullName từ "Unknown" stub khi message inbound
      // mang theo zaloDisplayName. Stub tạo bởi friend-event-handler khi
      // pending_received event đến (KH gửi mời) không có name → Contact stuck "Unknown".
      // Message đầu tiên KH gửi sau khi accept → backfill name (kèm avatar nếu thiếu).
      // GUARD blur (anh báo 2026-06-15): không backfill tên nếu display chứa ▒ (đã-blur).
      if (isInbound && args.contactZaloDisplayName && !args.contactZaloDisplayName.includes('▒') && conv.contactId) {
        const c = await tx.contact.findUnique({
          where: { id: conv.contactId },
          select: { fullName: true, avatarUrl: true },
        });
        if (c && (c.fullName === 'Unknown' || c.fullName === null || c.fullName === '')) {
          await tx.contact.update({
            where: { id: conv.contactId },
            data: {
              fullName: args.contactZaloDisplayName,
              ...(args.contactZaloAvatarUrl && !c.avatarUrl
                ? { avatarUrl: args.contactZaloAvatarUrl }
                : {}),
            },
          });
        }
      }

      if (!existing) {
        // No Friend row yet — this is the first message exchanged.
        // Create as chatting_stranger (no friendship_event has fired).
        const newFriendId = randomUUID();
        await tx.friend.create({
          data: {
            id: newFriendId,
            orgId: conv.orgId,
            contactId: conv.contactId!,
            zaloAccountId: conv.zaloAccountId,
            zaloUidInNick: conv.externalThreadId!,
            // Snapshot per-identity tên + avatar Zalo của KH (chỉ set khi inbound,
            // vì self message senderName là của chính sale chứ không phải KH).
            zaloDisplayName: isInbound ? (args.contactZaloDisplayName || null) : null,
            zaloAvatarUrl: isInbound ? (args.contactZaloAvatarUrl || null) : null,
            friendshipStatus: 'none',
            hasConversation: true,
            relationshipKind: 'chatting_stranger',
            firstMessageAt: sentAt,
            lastInboundAt:  isInbound  ? sentAt : null,
            lastOutboundAt: !isInbound ? sentAt : null,
            totalInbound:   isInbound  ? 1 : 0,
            totalOutbound: !isInbound ? 1 : 0,
            // Phase Contact Scope Hybrid 2026-05-27 — preview per-pair từ message đầu tiên
            lastInboundPreview:    isInbound  ? preview            : null,
            lastInboundType:       isInbound  ? message.contentType : null,
            lastInboundMessageId:  isInbound  ? message.id          : null,
            lastOutboundPreview:   !isInbound ? preview             : null,
            lastOutboundType:      !isInbound ? message.contentType : null,
            lastOutboundMessageId: !isInbound ? message.id          : null,
          },
        });
        await tx.contact.update({
          where: { id: conv.contactId! },
          data: { chattingNicksCount: { increment: 1 } },
        });
        // Emit 'friend:updated' sau transaction (deferred — gắn vào emitQueue)
        emitQueue.push({
          friendId: newFriendId,
          contactId: conv.contactId!,
          zaloAccountId: conv.zaloAccountId,
          orgId: conv.orgId,
          patch: {
            relationshipKind: 'chatting_stranger',
            hasConversation: true,
            firstMessageAt: sentAt,
            ...(isInbound && args.contactZaloDisplayName ? { zaloDisplayName: args.contactZaloDisplayName } : {}),
            ...(isInbound && args.contactZaloAvatarUrl ? { zaloAvatarUrl: args.contactZaloAvatarUrl } : {}),
          },
        });
        return;
      }

      // Row exists. Update aggregates + flip hasConversation if needed.
      const updates: any = {};
      if (isInbound) {
        if (!existing.lastInboundAt || existing.lastInboundAt < sentAt) {
          updates.lastInboundAt = sentAt;
          // Phase Contact Scope Hybrid 2026-05-27 — per-pair preview set-if-newer
          updates.lastInboundPreview = preview;
          updates.lastInboundType = message.contentType;
          updates.lastInboundMessageId = message.id;
        }
        updates.totalInbound = { increment: 1 };
        // Refresh per-identity Zalo display name + avatar (KH có thể đổi tên).
        if (args.contactZaloDisplayName && args.contactZaloDisplayName !== existing.zaloDisplayName) {
          updates.zaloDisplayName = args.contactZaloDisplayName;
        }
        if (args.contactZaloAvatarUrl && args.contactZaloAvatarUrl !== existing.zaloAvatarUrl) {
          updates.zaloAvatarUrl = args.contactZaloAvatarUrl;
        }
      } else {
        if (!existing.lastOutboundAt || existing.lastOutboundAt < sentAt) {
          updates.lastOutboundAt = sentAt;
          updates.lastOutboundPreview = preview;
          updates.lastOutboundType = message.contentType;
          updates.lastOutboundMessageId = message.id;
        }
        updates.totalOutbound = { increment: 1 };
      }
      if (!existing.firstMessageAt) updates.firstMessageAt = sentAt;

      let counterDeltas: ReturnType<typeof counterDelta> | null = null;
      if (!existing.hasConversation) {
        updates.hasConversation = true;
        const newKind = deriveRelationshipKind(existing.friendshipStatus, true);
        if (newKind !== existing.relationshipKind) {
          updates.relationshipKind = newKind;
          counterDeltas = counterDelta(existing.relationshipKind as any, newKind);
        }
      }

      await tx.friend.update({
        where: { id: existing.id },
        data: updates,
      });

      if (counterDeltas && (counterDeltas.accepted || counterDeltas.pending || counterDeltas.chatting)) {
        await tx.contact.update({
          where: { id: conv.contactId! },
          data: {
            acceptedNicksCount: { increment: counterDeltas.accepted },
            pendingNicksCount:  { increment: counterDeltas.pending },
            chattingNicksCount: { increment: counterDeltas.chatting },
          },
        });
      }

      // Emit 'friend:updated' chỉ khi có Identity drift hoặc kind change.
      // KHÔNG emit cho mỗi message (totalInbound increment + lastInboundAt) để
      // tránh spam — FE đã refetch chat list qua channel khác (chat:message).
      const patchForEmit: Record<string, unknown> = {};
      if (updates.zaloDisplayName) patchForEmit.zaloDisplayName = updates.zaloDisplayName;
      if (updates.zaloAvatarUrl)   patchForEmit.zaloAvatarUrl   = updates.zaloAvatarUrl;
      if (updates.relationshipKind) patchForEmit.relationshipKind = updates.relationshipKind;
      if (updates.hasConversation) patchForEmit.hasConversation = updates.hasConversation;
      if (Object.keys(patchForEmit).length > 0) {
        emitQueue.push({
          friendId: existing.id,
          contactId: conv.contactId!,
          zaloAccountId: conv.zaloAccountId,
          orgId: conv.orgId,
          patch: patchForEmit,
        });
      }
    });

    // Phase Contact Scope Hybrid 2026-05-27 — ensure sale (owner của nick này) là
    // collaborator của Contact để sale thấy KH trong tab Khách hàng. Best-effort.
    await ensureContactCollaborator({
      orgId: conv.orgId,
      contactId: conv.contactId,
      zaloAccountId: conv.zaloAccountId,
    });

    // Flush deferred socket emits AFTER transaction commit (avoid emitting on rollback)
    if (emitQueue.length > 0) {
      const io = zaloPool.getIO();
      if (io) {
        for (const ev of emitQueue) {
          io.to(`org:${ev.orgId}`).emit('friend:updated', {
            friendId: ev.friendId,
            contactId: ev.contactId,
            zaloAccountId: ev.zaloAccountId,
            patch: ev.patch,
          });
        }
      }
    }
  } catch (err) {
    logger.warn(`[friend-aggregate] apply failed conv=${args.conversationId}:`, err);
  }
}

/**
 * One-shot historical backfill: recompute lastInbound/Outbound timestamps and
 * counters from existing Message rows for an org. Skips preview/messageId
 * (those will be filled by new messages going forward). Idempotent.
 */
/**
 * One-shot backfill of Friend rows from historical Conversations + FriendshipAttempt.
 *
 * Strategy:
 *   1. INSERT Friend(chatting_stranger) for every distinct (nick × KH) pair that has
 *      a 1-1 conversation. Use Conversation.lastMessageAt as firstMessageAt fallback.
 *   2. UPDATE Friend.friendshipStatus from FriendshipAttempt where state=accepted/rejected/sent.
 *   3. Recompute Friend.relationshipKind from (friendshipStatus, hasConversation).
 *   4. Recompute Contact counters (acceptedNicksCount, pendingNicksCount, chattingNicksCount).
 *
 * Idempotent — uses ON CONFLICT DO NOTHING for the insert.
 */
export async function backfillFriendsFromHistory(orgId: string): Promise<{
  friendsCreated: number;
  contactsCountersUpdated: number;
}> {
  // Step 1: insert Friend rows from conversations (only 1-1 with contact_id)
  const friendsCreated = await prisma.$executeRaw`
    INSERT INTO friends (
      id, org_id, contact_id, zalo_account_id, zalo_uid_in_nick,
      friendship_status, has_conversation, relationship_kind,
      first_message_at, total_inbound, total_outbound,
      last_inbound_at, last_outbound_at, created_at, updated_at
    )
    SELECT
      gen_random_uuid()::text,
      conv.org_id,
      conv.contact_id,
      conv.zalo_account_id,
      COALESCE(c.zalo_uid, ''),
      'none',
      true,
      'chatting_stranger',
      MIN(m.sent_at),
      COUNT(*) FILTER (WHERE m.sender_type = 'contact')::int,
      COUNT(*) FILTER (WHERE m.sender_type = 'self')::int,
      MAX(m.sent_at) FILTER (WHERE m.sender_type = 'contact'),
      MAX(m.sent_at) FILTER (WHERE m.sender_type = 'self'),
      NOW(),
      NOW()
    FROM conversations conv
    JOIN contacts c ON c.id = conv.contact_id
    LEFT JOIN messages m ON m.conversation_id = conv.id AND m.is_deleted = false
    WHERE conv.org_id = ${orgId}
      AND conv.contact_id IS NOT NULL
      AND conv."threadType" = 'user'
    GROUP BY conv.org_id, conv.contact_id, conv.zalo_account_id, c.zalo_uid
    ON CONFLICT (zalo_account_id, contact_id) DO NOTHING
  `;

  // Step 2: update Friend with FriendshipAttempt outcomes (accepted/rejected/sent)
  await prisma.$executeRaw`
    UPDATE friends f
       SET friendship_status = CASE fa.state
             WHEN 'accepted' THEN 'accepted'
             WHEN 'rejected' THEN 'rejected'
             WHEN 'sent'     THEN 'pending_sent'
             ELSE f.friendship_status
           END,
           became_friend_at = CASE WHEN fa.state = 'accepted' THEN fa.decided_at ELSE f.became_friend_at END,
           zalo_uid_in_nick = COALESCE(NULLIF(f.zalo_uid_in_nick, ''), fa.zalo_uid_found, '')
      FROM friendship_attempts fa
     WHERE fa.zalo_account_id = f.zalo_account_id
       AND fa.contact_id      = f.contact_id
       AND f.org_id            = ${orgId}
       AND fa.state IN ('accepted','rejected','sent')
  `;

  // Step 3: recompute relationship_kind from (friendship_status, has_conversation)
  await prisma.$executeRaw`
    UPDATE friends f
       SET relationship_kind = CASE
             WHEN f.friendship_status = 'accepted' THEN 'friend'
             WHEN f.friendship_status IN ('pending_sent','pending_received') THEN 'pending_friend'
             WHEN f.friendship_status IN ('rejected','removed','blocked') THEN 'ghost'
             WHEN f.has_conversation = true THEN 'chatting_stranger'
             ELSE 'none'
           END
     WHERE f.org_id = ${orgId}
  `;

  // Step 4: recompute Contact counters from Friend rows
  const contactsCountersUpdated = await prisma.$executeRaw`
    WITH counts AS (
      SELECT contact_id,
             COUNT(*) FILTER (WHERE relationship_kind = 'friend')::int             AS accepted_n,
             COUNT(*) FILTER (WHERE relationship_kind = 'pending_friend')::int     AS pending_n,
             COUNT(*) FILTER (WHERE relationship_kind = 'chatting_stranger')::int  AS chatting_n
        FROM friends
       WHERE org_id = ${orgId}
       GROUP BY contact_id
    )
    UPDATE contacts c
       SET accepted_nicks_count = counts.accepted_n,
           pending_nicks_count  = counts.pending_n,
           chatting_nicks_count = counts.chatting_n
      FROM counts
     WHERE c.id = counts.contact_id
       AND c.org_id = ${orgId}
  `;

  return {
    friendsCreated: Number(friendsCreated),
    contactsCountersUpdated: Number(contactsCountersUpdated),
  };
}

export async function backfillContactAggregates(orgId: string): Promise<{
  messagesUpdated: number;
  appointmentsUpdated: number;
}> {
  // Update message aggregates (inbound/outbound counters + last timestamps)
  const messagesUpdated = await prisma.$executeRaw`
    WITH msg_agg AS (
      SELECT
        conv.contact_id                                                  AS contact_id,
        COUNT(*) FILTER (WHERE m.sender_type = 'contact')::int           AS total_inbound,
        COUNT(*) FILTER (WHERE m.sender_type = 'self')::int              AS total_outbound,
        MAX(m.sent_at)  FILTER (WHERE m.sender_type = 'contact')         AS last_inbound_at,
        MAX(m.sent_at)  FILTER (WHERE m.sender_type = 'self')            AS last_outbound_at
      FROM messages m
      JOIN conversations conv ON conv.id = m.conversation_id
      WHERE conv.org_id = ${orgId}
        AND conv.contact_id IS NOT NULL
        AND conv."threadType" = 'user'
        AND m.is_deleted = false
      GROUP BY conv.contact_id
    )
    UPDATE contacts c
       SET total_inbound    = msg_agg.total_inbound,
           total_outbound   = msg_agg.total_outbound,
           last_inbound_at  = msg_agg.last_inbound_at,
           last_outbound_at = msg_agg.last_outbound_at
      FROM msg_agg
     WHERE c.id = msg_agg.contact_id
       AND c.org_id = ${orgId}
  `;

  // Update appointments counter independently (a contact may have appts without messages)
  const appointmentsUpdated = await prisma.$executeRaw`
    WITH appt_agg AS (
      SELECT contact_id, COUNT(*)::int AS total_appt
        FROM appointments
       WHERE org_id = ${orgId}
       GROUP BY contact_id
    )
    UPDATE contacts c
       SET total_appointments = appt_agg.total_appt
      FROM appt_agg
     WHERE c.id = appt_agg.contact_id
       AND c.org_id = ${orgId}
  `;

  return {
    messagesUpdated: Number(messagesUpdated),
    appointmentsUpdated: Number(appointmentsUpdated),
  };
}
