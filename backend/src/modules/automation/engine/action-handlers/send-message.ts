// Phase G full — send_message action handler (REAL Zalo SDK).
//
// 2026-06-06 (Approach A office-hours) — GỬI ĐỦ MỌI THÀNH PHẦN của Khối theo ĐÚNG
// THỨ TỰ + giữ FORMAT. Trước đây handler chỉ gửi 1 tin text đầu + 1 ảnh đầu (bug
// CRITICAL mất tin). Giờ:
//   1. resolveBlockContent(snapshot) → resolved[] (text/image/album/file/video) đúng thứ tự
//   2. Find Friend row (accepted hoặc stranger-allowed) → threadId; get-or-create Conversation
//   3. LOOP resolved[]: render template + gửi đúng SDK + persist Message + delay 1-3s giữa tin
//   4. Idempotent: gửi ít nhất 1 tin OK → success (retry không nên double-send — xem note)
//   5. Apply Contact + Friend aggregates (1 lần, theo tin cuối) cho /contacts dashboard
//
// Set AUTOMATION_STUB_MODE=true để test không chạm Zalo.

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { zaloOps } from '../../../../shared/zalo-operations.js';
import { applyContactAggregateFromMessage, applyFriendAggregate } from '../../../contacts/contact-aggregate.js';
import { resolveBlockContent, type ResolvedMessage } from '../../blocks/resolve-block-content.js';
import { renderTemplate } from '../../blocks/render-template.js';
import type { ActionContext, ActionResult } from '../types.js';
// Phase Media GĐ3 2026-06-11 — Đường B: zca-js KHÔNG nhận URL (readFile string như
// path), nên media trong Block phải DOWNLOAD về temp → gửi local path. Bug có sẵn:
// engine cũ gửi {url} string → zca-js readFile('http://...') fail.
import { downloadMediaToTemp } from '../../../chat/chat-media-helpers.js';
import { sendNativeVideo } from '../../../../shared/video-processor.js';
import { zaloPool } from '../../../zalo/zalo-pool.js';

const STUB_MODE = process.env.AUTOMATION_STUB_MODE === 'true';

type ZaloStyle = { st: string; start: number; len: number };

// Delay ngẫu nhiên giữa các tin trong cùng 1 Khối (chống Zalo coi spam / burst-limit).
// Giống broadcast-fire-worker randomDelay. 0.8–2.5s.
const SEND_GAP_MIN_MS = 800;
const SEND_GAP_MAX_MS = 2500;
function sendGapMs(): number {
  return SEND_GAP_MIN_MS + Math.floor(Math.random() * (SEND_GAP_MAX_MS - SEND_GAP_MIN_MS));
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function sendMessageHandler(ctx: ActionContext): Promise<ActionResult> {
  const snap = ctx.blockSnapshot as {
    // Shape MỚI (BlockEditorDialog rich-text): components[] với defaultVariant {text, styles}
    components?: Array<Record<string, unknown>>;
    // Shape CŨ (legacy): textVariants string[] + attachments
    textVariants?: string[];
    attachments?: Array<{ kind: string; url: string; caption?: string; thumbnailUrl?: string; altText?: string }>;
  };

  if (!ctx.assignedNickId) {
    return {
      outcome: 'failure',
      errorCode: 'NO_NICK',
      errorMessage: 'assignedNickId required for send_message',
      retryable: false,
    };
  }

  // ── Resolve Khối → danh sách tin theo ĐÚNG THỨ TỰ (module dùng chung) ──
  // 2026-06-06 — loop ĐỦ components (text/image/album/file/video) + giữ styles.
  const resolveResult = resolveBlockContent('send_message', snap as Record<string, unknown>);
  if (!resolveResult.ok || resolveResult.resolved.length === 0) {
    return {
      outcome: 'failure',
      errorCode: 'BAD_SNAPSHOT',
      errorMessage: resolveResult.detail ?? 'blockSnapshot không có nội dung gửi được',
      retryable: false,
    };
  }
  const messages: ResolvedMessage[] = resolveResult.resolved;

  if (STUB_MODE) {
    const summary = messages.map((m) => m.messageType).join(' → ');
    logger.info(`[send-message STUB] would send ${messages.length} tin (${summary}) from nick ${ctx.assignedNickId} to contact ${ctx.contactId}`);
    return {
      outcome: 'success',
      data: { stub: true, messageCount: messages.length, sequence: messages.map((m) => m.messageType) },
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
  //
  // Phase Friend Invite 2026-05-28 — `allowStrangerMessage` flag in rulesSnapshot
  // bypass FRIENDSHIP_NOT_ACCEPTED check cho friend-invite sequences (KH reject vẫn
  // bám đuổi vào tin nhắn lạ). Anh chốt SKIP safeguard, cap 300 tin lạ/nick/ngày.
  const allowStranger =
    (ctx.rulesSnapshot as { allowStrangerMessage?: boolean } | undefined)?.allowStrangerMessage ===
    true;

  if (friend.friendshipStatus !== 'accepted') {
    if (allowStranger) {
      logger.info(
        `[send-message] stranger mode: friend.status='${friend.friendshipStatus}' allowed by sequence rules for contact=${ctx.contactId}`,
      );
      // proceed — tin sẽ vào "Tin nhắn từ người lạ" của KH
    } else if (friend.friendshipStatus === 'pending_sent' && friend.hasConversation) {
      // Allow: KH replied while friend req pending — Zalo allows continued chat
      logger.info(`[send-message] proceeding with pending_sent + hasConversation for contact=${ctx.contactId}`);
    } else {
      return {
        outcome: 'failure',
        errorCode: 'FRIENDSHIP_NOT_ACCEPTED',
        errorMessage: `Friend status '${friend.friendshipStatus}' không cho phép gửi tin (cần 'accepted' hoặc bật allowStrangerMessage)`,
        retryable: false,
      };
    }
  }

  const threadId = friend.zaloUidInNick;
  const threadType = 0; // 0 = user, 1 = group (only user supported)
  // (Render template {gender}/{name}/{sale} thực hiện PER-TIN trong loop ở Step 3.)

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

  // Source attribution — UI chat hiển thị badge "⚙️ Tự động · {sequence} · Bước N/M".
  // Format khớp MessageSourceBadge.vue: metadata.sender = { kind, name, detail, sequenceId, stepIdx }.
  const sm = ctx.sequenceMeta;
  const senderMeta = sm
    ? {
        kind: 'bot_automation',
        name: sm.sequenceName,
        detail: `Bước ${sm.stepIdx + 1}/${sm.totalSteps}`,
        sequenceId: sm.sequenceId,
        stepIdx: sm.stepIdx,
      }
    : { kind: 'bot_automation', name: 'Tự động' };

  // Step 3: LOOP gửi tuần tự từng tin trong Khối (ĐÚNG THỨ TỰ + delay giữa tin).
  let sentCount = 0;
  let lastMessageRow: { id: string; content: string | null; contentType: string; sentAt: Date } | null = null;
  let lastZaloMsgId = '';

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i > 0) await sleep(sendGapMs());

    let sdkResult: Record<string, unknown> = {};
    let persistContent: string;
    let persistContentType = 'text';
    // Đường B: dọn temp media sau khi gửi (download URL → local path cho zca-js).
    const tmpCleanups: Array<() => Promise<void>> = [];

    try {
      if (m.messageType === 'text') {
        const rendered = await renderTemplate(m.payload.text, ctx.contactId, ctx.assignedNickId);
        const hadTemplateVar = m.payload.text.includes('{');
        const styles: ZaloStyle[] = Array.isArray(m.payload.styles) ? m.payload.styles : [];
        const msgPayload: Record<string, unknown> = { msg: rendered };
        const useStyles = !hadTemplateVar && styles.length > 0;
        if (useStyles) msgPayload.styles = styles;
        const raw = await zaloOps.sendMessage(ctx.assignedNickId, threadId, threadType, msgPayload);
        sdkResult = (raw as Record<string, unknown>) || {};
        persistContent = useStyles
          ? JSON.stringify({ title: rendered, action: 'rtf', params: JSON.stringify({ styles }) })
          : rendered;
        persistContentType = 'text';
      } else if (m.messageType === 'image') {
        const caption = m.payload.caption ? await renderTemplate(m.payload.caption, ctx.contactId, ctx.assignedNickId) : '';
        // Đường B: download URL → local path (zca-js readFile path, KHÔNG nhận url).
        // sendImage (KHÔNG sendFile) → temp có đuôi .webp → Zalo nhận ẢNH INLINE, không phải file.
        const tmp = await downloadMediaToTemp({ url: m.payload.url }, 'image');
        tmpCleanups.push(tmp.cleanup);
        const raw = await zaloOps.sendImage(ctx.assignedNickId, threadId, threadType, [tmp.path], null, caption);
        sdkResult = (raw as Record<string, unknown>) || {};
        persistContent = JSON.stringify({ text: caption, attachments: [{ kind: 'image', url: m.payload.url, caption }] });
        persistContentType = 'image';
      } else if (m.messageType === 'album') {
        // S4 edge case: giới hạn ≤12 ảnh/lần tránh quá tải SDK Zalo (như endpoint gửi tay).
        const allItems = m.payload.items.map((it) => ({ url: it.url, caption: it.caption ?? '' }));
        const items = allItems.slice(0, 12);
        if (allItems.length > 12) {
          logger.warn(`[automation] album ${allItems.length} ảnh > 12 — chỉ gửi 12 ảnh đầu (giới hạn SDK).`);
        }
        // download tất cả ảnh album về temp rồi gửi 1 lần (attachments nhiều path).
        const paths: string[] = [];
        for (const it of items) {
          const tmp = await downloadMediaToTemp({ url: it.url }, 'image');
          tmpCleanups.push(tmp.cleanup);
          paths.push(tmp.path);
        }
        const raw = await zaloOps.sendImage(ctx.assignedNickId, threadId, threadType, paths, null, items[0]?.caption ?? '');
        sdkResult = (raw as Record<string, unknown>) || {};
        persistContent = JSON.stringify({ text: '', attachments: items.map((it) => ({ kind: 'image', url: it.url, caption: it.caption })) });
        persistContentType = 'image';
      } else if (m.messageType === 'video') {
        const caption = m.payload.caption ? await renderTemplate(m.payload.caption, ctx.contactId, ctx.assignedNickId) : '';
        const tmp = await downloadMediaToTemp({ url: m.payload.url }, 'video');
        tmpCleanups.push(tmp.cleanup);
        // video: ưu tiên sendNativeVideo (local path), fallback sendFile.
        const inst = zaloPool.getInstance(ctx.assignedNickId);
        let raw: unknown;
        try {
          if (!inst?.api) throw new Error('nick not connected');
          raw = await sendNativeVideo({ api: inst.api as any, videoPath: tmp.path, threadId, threadType: threadType as 0 | 1, message: caption });
        } catch {
          raw = await zaloOps.sendFile(ctx.assignedNickId, threadId, threadType, [tmp.path], null, caption);
        }
        sdkResult = (raw as Record<string, unknown>) || {};
        persistContent = JSON.stringify({ text: caption, attachments: [{ kind: 'video', url: m.payload.url, caption }] });
        persistContentType = 'video';
      } else if (m.messageType === 'file') {
        const caption = m.payload.caption ? await renderTemplate(m.payload.caption, ctx.contactId, ctx.assignedNickId) : '';
        const tmp = await downloadMediaToTemp({ url: m.payload.url, filename: m.payload.filename }, 'file');
        tmpCleanups.push(tmp.cleanup);
        const raw = await zaloOps.sendFile(ctx.assignedNickId, threadId, threadType, [tmp.path], null, caption);
        sdkResult = (raw as Record<string, unknown>) || {};
        persistContent = JSON.stringify({ text: caption, attachments: [{ kind: 'file', url: m.payload.url, filename: m.payload.filename, caption }] });
        persistContentType = 'file';
      } else {
        continue;
      }
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const msg = err?.message ?? String(err);
      if (sentCount > 0) {
        logger.warn(`[send-message] tin ${i + 1}/${messages.length} (${m.messageType}) lỗi sau khi đã gửi ${sentCount} tin: ${msg} — dừng, không retry`);
        break;
      }
      if (code === 'RATE_LIMITED') return { outcome: 'failure', errorCode: 'RATE_LIMITED', errorMessage: msg, retryable: true };
      if (code === 'NOT_CONNECTED') return { outcome: 'failure', errorCode: 'NOT_CONNECTED', errorMessage: msg, retryable: true };
      return { outcome: 'failure', errorCode: 'SEND_MESSAGE_FAILED', errorMessage: msg, retryable: false };
    } finally {
      // Dọn temp media (Đường B) — chạy dù gửi OK hay lỗi.
      for (const c of tmpCleanups) await c().catch(() => {});
    }

    const sr = sdkResult as { message?: { msgId?: number | string } | null; msgId?: number | string };
    const zaloMsgId = String(sr?.message?.msgId ?? sr?.msgId ?? '');
    lastZaloMsgId = zaloMsgId;
    try {
      lastMessageRow = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          zaloMsgId: zaloMsgId || null,
          zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
          senderType: 'self',
          senderUid: '',
          senderName: 'Bot-Auto',
          content: persistContent,
          contentType: persistContentType,
          sentAt: new Date(),
          sentVia: 'automation',
          // metadata.sender → badge "⚙️ Tự động · {sequence} · Bước N/M" trong UI chat.
          metadata: { sender: senderMeta },
        },
        select: { id: true, content: true, contentType: true, sentAt: true },
      });
    } catch (err) {
      logger.error(`[send-message] persist tin ${i + 1} lỗi (Zalo đã gửi):`, err);
    }
    sentCount++;
  }

  if (sentCount === 0) {
    return { outcome: 'failure', errorCode: 'SEND_MESSAGE_FAILED', errorMessage: 'không gửi được tin nào', retryable: false };
  }

  // Step 5.5: update Conversation aggregate (theo tin cuối) + Step 6 aggregates.
  if (lastMessageRow) {
    try {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: lastMessageRow.sentAt, isReplied: true, unreadCount: 0 },
      });
    } catch (err) {
      logger.warn(`[send-message] conversation aggregate update failed (conv=${conversation.id}):`, err);
    }

    const aggInput = {
      conversationId: conversation.id,
      message: {
        id: lastMessageRow.id,
        content: lastMessageRow.content,
        contentType: lastMessageRow.contentType,
        sentAt: lastMessageRow.sentAt,
        senderType: 'self' as const,
      },
      outboundUserId: null,
    };
    void applyContactAggregateFromMessage(aggInput);
    void applyFriendAggregate(aggInput);
  }

  logger.info(`[send-message] sent ${sentCount}/${messages.length} tin từ nick=${ctx.assignedNickId} → contact=${ctx.contactId}`);
  return {
    outcome: 'success',
    data: {
      sentCount,
      totalMessages: messages.length,
      zaloMsgId: lastZaloMsgId,
      conversationId: conversation.id,
      messageId: lastMessageRow?.id,
    },
  };
}
