// Phase G full — send_message action handler (REAL Zalo SDK).
//
// Flow:
//   1. Read blockSnapshot.textVariants — pick one randomly
//   2. Find Friend row for (assignedNickId, contactId)
//      - must be friendshipStatus='accepted' (or 'pending_sent' if user replied first)
//      - extract zaloUidInNick → threadId
//   3. Get or create Conversation with (zaloAccountId, externalThreadId)
//   4. zaloOps.sendMessage(nickId, threadId, threadType=0, { msg: text })
//   5. Persist Message row with senderType='self', zaloMsgId from response
//   6. Apply Contact + Friend aggregates so /contacts dashboard updates
//
// Worker handles ZaloAccount.lastMessageSentAt update on success.
// Attachments support deferred — text-only for now (logs a warning if present).
//
// Set AUTOMATION_STUB_MODE=true to revert to stub for safe testing.

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { zaloOps } from '../../../../shared/zalo-operations.js';
import { applyContactAggregateFromMessage, applyFriendAggregate } from '../../../contacts/contact-aggregate.js';
import type { ActionContext, ActionResult } from '../types.js';

const STUB_MODE = process.env.AUTOMATION_STUB_MODE === 'true';

export async function sendMessageHandler(ctx: ActionContext): Promise<ActionResult> {
  const snap = ctx.blockSnapshot as {
    textVariants?: string[];
    attachments?: Array<{ kind: string; url: string; caption?: string; thumbnailUrl?: string; altText?: string }>;
  };

  if (!Array.isArray(snap.textVariants) || snap.textVariants.length === 0) {
    return {
      outcome: 'failure',
      errorCode: 'BAD_SNAPSHOT',
      errorMessage: 'blockSnapshot.textVariants empty',
      retryable: false,
    };
  }
  if (!ctx.assignedNickId) {
    return {
      outcome: 'failure',
      errorCode: 'NO_NICK',
      errorMessage: 'assignedNickId required for send_message',
      retryable: false,
    };
  }

  const text = snap.textVariants[Math.floor(Math.random() * snap.textVariants.length)];
  const attachments = Array.isArray(snap.attachments) ? snap.attachments : [];

  if (STUB_MODE) {
    logger.info(`[send-message STUB] would send "${text.slice(0, 40)}..." + ${attachments.length} attachment(s) from nick ${ctx.assignedNickId} to contact ${ctx.contactId}`);
    return {
      outcome: 'success',
      data: { stub: true, textUsed: text, attachmentCount: attachments.length },
    };
  }

  // ── Real impl ───────────────────────────────────────────────────────────

  // Step 1: find Friend row to get threadId (= zaloUidInNick) and verify status
  const friend = await prisma.friend.findFirst({
    where: {
      zaloAccountId: ctx.assignedNickId,
      contactId: ctx.contactId,
      orgId: ctx.orgId,
    },
    select: {
      id: true,
      zaloUidInNick: true,
      friendshipStatus: true,
      hasConversation: true,
    },
  });
  if (!friend) {
    return {
      outcome: 'failure',
      errorCode: 'NO_FRIEND_ROW',
      errorMessage: 'No Friend row for (nick, contact) — chat trước khi sequence gửi message',
      retryable: false,
    };
  }
  // FIX A5: send_message restricted to friendshipStatus='accepted' ONLY.
  // Previously allowed pending_sent/pending_received/none which Zalo policy
  // either silently drops or marks as spam. send_message is for confirmed
  // friends; cold-message via 'none' should use request_friend action instead.
  // Exception: 'pending_sent' with hasConversation=true (KH đã reply qua stranger
  // window) — Zalo allows that path. Worker check below.
  if (friend.friendshipStatus !== 'accepted') {
    if (friend.friendshipStatus === 'pending_sent' && friend.hasConversation) {
      // Allow: KH replied while friend req pending — Zalo allows continued chat
      logger.info(`[send-message] proceeding with pending_sent + hasConversation for contact=${ctx.contactId}`);
    } else {
      return {
        outcome: 'failure',
        errorCode: 'FRIENDSHIP_NOT_ACCEPTED',
        errorMessage: `Friend status '${friend.friendshipStatus}' không cho phép gửi tin (cần 'accepted')`,
        retryable: false,
      };
    }
  }

  const threadId = friend.zaloUidInNick;
  const threadType = 0; // 0 = user, 1 = group (only user supported)

  // Step 2: get-or-create Conversation
  let conversation = await prisma.conversation.findUnique({
    where: { zaloAccountId_externalThreadId: { zaloAccountId: ctx.assignedNickId, externalThreadId: threadId } },
    select: { id: true },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        orgId: ctx.orgId,
        zaloAccountId: ctx.assignedNickId,
        externalThreadId: threadId,
        threadType: 'user',
        contactId: ctx.contactId,
      },
      select: { id: true },
    });
  }

  // Step 3: send via Zalo SDK — dispatch based on first attachment kind.
  // FIX B1: previously attachments were logged-warn and dropped (text-only).
  // Now supports image/video/file via dedicated zaloOps methods.
  let sdkResult: Record<string, unknown>;
  try {
    if (attachments.length > 0) {
      const first = attachments[0];
      const url = first.url;
      const caption = first.caption || text;
      let raw: unknown;
      if (first.kind === 'image') {
        // zaloOps.sendImage expects attachment object array
        raw = await zaloOps.sendImage(ctx.assignedNickId, threadId, threadType, [{ url, caption }]);
      } else if (first.kind === 'video') {
        // Video: zaloOps.sendVideo({ videoUrl, thumbnailUrl, msg })
        raw = await zaloOps.sendVideo(ctx.assignedNickId, threadId, threadType, {
          videoUrl: url,
          thumbnailUrl: first.thumbnailUrl ?? url,
          msg: caption,
        });
      } else if (first.kind === 'file') {
        // sendFile expects file path array. If URL is http, the worker can't fetch
        // server-side without download — currently passes URL string as path.
        // Zalo SDK behavior: file path must exist on the running server.
        // TODO: download URL → temp file for non-filesystem URLs.
        raw = await zaloOps.sendFile(ctx.assignedNickId, threadId, threadType, [url], null, caption);
      } else if (first.kind === 'link') {
        // Link card uses sendLink with link payload
        raw = await zaloOps.sendLink(ctx.assignedNickId, threadId, threadType, { href: url, title: caption, desc: text });
      } else {
        // Unknown kind: fall back to text-only with URL appended
        raw = await zaloOps.sendMessage(ctx.assignedNickId, threadId, threadType, { msg: `${text}\n${url}` });
      }
      sdkResult = (raw as Record<string, unknown>) || {};
    } else {
      const raw = await zaloOps.sendMessage(ctx.assignedNickId, threadId, threadType, { msg: text });
      sdkResult = (raw as Record<string, unknown>) || {};
    }
  } catch (err: any) {
    const code = err?.code as string | undefined;
    const msg = err?.message ?? String(err);
    if (code === 'RATE_LIMITED') {
      return { outcome: 'failure', errorCode: 'RATE_LIMITED', errorMessage: msg, retryable: true };
    }
    if (code === 'NOT_CONNECTED') {
      return { outcome: 'failure', errorCode: 'NOT_CONNECTED', errorMessage: msg, retryable: true };
    }
    return {
      outcome: 'failure',
      errorCode: 'SEND_MESSAGE_FAILED',
      errorMessage: msg,
      retryable: false,
    };
  }

  // Step 4: extract zaloMsgId for dedup with self-listen echo
  const sr = sdkResult as { message?: { msgId?: number | string } | null; msgId?: number | string };
  const rawId = sr?.message?.msgId ?? sr?.msgId ?? '';
  const zaloMsgId = String(rawId || '');

  // Step 5: persist outbound Message row
  // contentType reflects attachment kind for proper UI rendering
  const persistContentType = attachments.length > 0
    ? (attachments[0].kind === 'image' ? 'image'
       : attachments[0].kind === 'video' ? 'video'
       : attachments[0].kind === 'file' ? 'file'
       : attachments[0].kind === 'link' ? 'link'
       : 'text')
    : 'text';
  const persistContent = attachments.length > 0
    ? JSON.stringify({ text, attachments })
    : text;

  let messageRow: { id: string; content: string | null; contentType: string; sentAt: Date };
  try {
    messageRow = await prisma.message.create({
      data: {
        id: randomUUID(),
        conversationId: conversation.id,
        zaloMsgId: zaloMsgId || null,
        senderType: 'self',
        senderUid: '',
        senderName: 'Bot-Auto',
        content: persistContent,
        contentType: persistContentType,
        sentAt: new Date(),
      },
      select: { id: true, content: true, contentType: true, sentAt: true },
    });
  } catch (err) {
    logger.error(`[send-message] message persistence failed (Zalo send succeeded):`, err);
    // SDK already sent — return success with warning so retry doesn't double-send
    return {
      outcome: 'success',
      data: { zaloMsgId, textUsed: text, persistenceFailed: true },
    };
  }

  // Step 6: apply aggregates (Contact + Friend lastOutbound counters)
  const aggInput = {
    conversationId: conversation.id,
    message: {
      id: messageRow.id,
      content: messageRow.content,
      contentType: messageRow.contentType,
      sentAt: messageRow.sentAt,
      senderType: 'self' as const,
    },
    outboundUserId: null, // automation-sent, not user-attributed
  };
  void applyContactAggregateFromMessage(aggInput);
  void applyFriendAggregate(aggInput);

  logger.info(`[send-message] sent from nick=${ctx.assignedNickId} to contact=${ctx.contactId}, msgId=${zaloMsgId}`);
  return {
    outcome: 'success',
    data: {
      zaloMsgId,
      textUsed: text,
      conversationId: conversation.id,
      messageId: messageRow.id,
    },
  };
}
