/**
 * message-handler.ts — persists incoming Zalo messages to the database.
 * Called from zalo-pool's startListener on every 'message' / 'undo' event.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { emitWebhook } from '../api/webhook-service.js';
import { runAutomationRules } from '../automation/automation-service.js';
import { applyContactAggregateFromMessage, applyContactInteraction, applyFriendAggregate } from '../contacts/contact-aggregate.js';
import { onInboundMessage as onInboundScoring, onOutboundMessage as onOutboundScoring } from '../scoring/scoring-hooks.js';
import { syncReminderFromMessage } from '../contacts/reminder-sync.js';
import { uploadBuffer } from '../../shared/storage/minio-client.js';
import { config } from '../../config/index.js';
import { logEvent as logAutomationEvent } from '../automation/friend-invite/event-log-service.js';

export interface IncomingMessage {
  accountId: string;
  senderUid: string;
  senderName: string;       // zaloName (from cache or dName fallback)
  content: string;
  contentType: string;      // text, image, sticker, video, voice, gif, link, file
  msgId: string;
  cliMsgId?: string;        // Zalo client message id — cần cho api.undo (server check msgId+cliMsgId)
  timestamp: number;        // epoch ms
  isSelf: boolean;
  threadId: string;         // For user: contact UID. For group: group ID
  threadType: 'user' | 'group'; // user or group conversation
  recipientName?: string;   // For SELF user-thread msg: name of thread peer (resolved via getUserInfo)
  // Zalo toàn cục identifiers cho dedup (independent of viewer account).
  // Cho non-self: thuộc SENDER. Cho self: thuộc RECIPIENT (thread peer).
  contactGlobalId?: string;
  contactUsername?: string;
  // Per-identity (per-account) display name + avatar — lưu vào Friend.zaloDisplayName/AvatarUrl
  contactZaloDisplayName?: string;
  contactZaloAvatarUrl?: string;
  groupName?: string;       // group name if group message
  groupAvatarUrl?: string;  // group avatar URL from Zalo (via getGroupInfo.avt)
  groupMembersCount?: number; // total members in group
  attachments?: any[];
  quote?: unknown;
  albumKey?: string | null;
  albumIndex?: number | null;
  albumTotal?: number | null;
  isBackfill?: boolean;     // true for old_messages / sync backfill — skip automations
  // Anh chốt 2026-06-03 — Persist Zalo SDK TGroupMessage.mentions
  // Shape: [{ uid, pos, len, type }] — chỉ group có; user 1-1 null.
  mentions?: Array<{ uid: string; pos: number; len: number; type: 0 | 1 }>;
}

export interface HandleMessageResult {
  message: {
    id: string;
    conversationId: string;
    zaloMsgId: string | null;
    senderType: string;
    senderUid: string | null;
    senderName: string | null;
    content: string | null;
    contentType: string;
    attachments: any;
    albumKey: string | null;
    albumIndex: number | null;
    albumTotal: number | null;
    isDeleted: boolean;
    deletedAt: Date | null;
    sentAt: Date;
    repliedByUserId: string | null;
    createdAt: Date;
  };
  conversationId: string;
  orgId: string;
  contactId: string | null;
}

// ── v3.3 mirror inbound media — copy Zalo CDN URL về MinIO/S3/R2 ───────────
// Inbound image/video/voice/file/gif: tin từ Zalo có URL CDN expire ngắn.
// Mirror sang storage để bubble preview luôn-luôn-hiển-thị, không phụ thuộc CDN.

const MIRROR_CONTENT_TYPES = new Set(['image', 'video', 'file', 'gif', 'voice', 'audio']);
const MEDIA_URL_FIELDS = ['hdUrl', 'href', 'normalUrl', 'fileUrl', 'url', 'thumbUrl', 'thumb', 'thumbnail'] as const;

function safeParseJsonObject(value: string): Record<string, unknown> | null {
  if (!value.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isLocalStorageUrl(value: string): boolean {
  return value.startsWith(`${config.s3PublicUrl}/${config.s3Bucket}/`);
}

function isMirrorableUrl(value: unknown): value is string {
  return typeof value === 'string' &&
    /^https?:\/\//i.test(value) &&
    !isLocalStorageUrl(value);
}

function fileNameFromUrl(url: string, contentType: string, mimeType: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop() || '';
    if (last.includes('.')) return decodeURIComponent(last);
  } catch {
    // fall through
  }
  const ext = mimeTypeToExtension(mimeType) || contentTypeToExtension(contentType);
  return `zalo-${contentType || 'media'}${ext}`;
}

function mimeTypeToExtension(mimeType: string): string {
  const [base] = mimeType.split(';');
  switch (base.trim().toLowerCase()) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/webp': return '.webp';
    case 'image/gif': return '.gif';
    case 'video/mp4': return '.mp4';
    case 'video/quicktime': return '.mov';
    case 'video/webm': return '.webm';
    case 'audio/mpeg': return '.mp3';
    case 'audio/mp4': return '.m4a';
    case 'audio/ogg': return '.ogg';
    case 'application/pdf': return '.pdf';
    default: return '';
  }
}

function contentTypeToExtension(contentType: string): string {
  switch (contentType) {
    case 'image': return '.jpg';
    case 'video': return '.mp4';
    case 'gif': return '.gif';
    case 'voice':
    case 'audio': return '.mp3';
    default: return '';
  }
}

async function mirrorRemoteMediaUrl(url: string, contentType: string): Promise<string | null> {
  // 2026-06-11 FIX (ảnh từ Zalo Desktop mất hình): Zalo CDN hay trả 200 nhưng body RỖNG
  // (eventual consistency — ảnh vừa gửi chưa sẵn trên CDN). Trước đây upload buffer 0-byte
  // rồi REPLACE href gốc bằng URL MinIO hỏng → ảnh mất vĩnh viễn. Giờ: RETRY 1 lần sau 1.5s
  // để bắt bytes thật; nếu vẫn rỗng → throw để caller GIỮ URL Zalo gốc (khớp downloadMediaToTemp).
  let buffer: Buffer | null = null;
  let mimeType = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
    mimeType = response.headers.get('content-type')?.split(';')[0] || guessMimeType(url, contentType);
    if (buffer.length > 0) break;
  }
  if (!buffer || buffer.length === 0) throw new Error('empty response');
  const uploaded = await uploadBuffer(buffer, mimeType, fileNameFromUrl(url, contentType, mimeType));
  return uploaded.url;
}

function guessMimeType(url: string, contentType: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.gif')) return 'image/gif';
  if (lower.includes('.mp4')) return 'video/mp4';
  if (lower.includes('.mov')) return 'video/quicktime';
  if (lower.includes('.webm')) return 'video/webm';
  if (lower.includes('.pdf')) return 'application/pdf';
  if (contentType === 'image') return 'image/jpeg';
  if (contentType === 'gif') return 'image/gif';
  if (contentType === 'video') return 'video/mp4';
  if (contentType === 'voice' || contentType === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

async function mirrorInboundMediaContent(msg: IncomingMessage): Promise<string> {
  if (!MIRROR_CONTENT_TYPES.has(msg.contentType) || !msg.content) return msg.content || '';

  const parsed = safeParseJsonObject(msg.content);
  if (!parsed) {
    if (!isMirrorableUrl(msg.content)) return msg.content;
    try {
      return await mirrorRemoteMediaUrl(msg.content, msg.contentType) ?? msg.content;
    } catch (err) {
      logger.warn('[message-handler] inbound media mirror failed', {
        contentType: msg.contentType,
        url: msg.content,
        err: (err as Error).message,
      });
      return msg.content;
    }
  }

  const mirroredByUrl = new Map<string, string>();
  for (const field of MEDIA_URL_FIELDS) {
    const value = parsed[field];
    if (!isMirrorableUrl(value)) continue;
    try {
      const mirrored = mirroredByUrl.get(value) ?? await mirrorRemoteMediaUrl(value, msg.contentType);
      if (!mirrored) continue;
      mirroredByUrl.set(value, mirrored);
      parsed[field] = mirrored;
    } catch (err) {
      logger.warn('[message-handler] inbound media mirror failed', {
        contentType: msg.contentType,
        field,
        url: value,
        err: (err as Error).message,
      });
    }
  }

  const params = typeof parsed.params === 'string' ? safeParseJsonObject(parsed.params) : null;
  if (params) {
    for (const field of ['rawUrl', 'hd'] as const) {
      const value = params[field];
      if (!isMirrorableUrl(value)) continue;
      try {
        const mirrored = mirroredByUrl.get(value) ?? await mirrorRemoteMediaUrl(value, msg.contentType);
        if (!mirrored) continue;
        mirroredByUrl.set(value, mirrored);
        params[field] = mirrored;
      } catch (err) {
        logger.warn('[message-handler] inbound media params mirror failed', {
          contentType: msg.contentType,
          field,
          url: value,
          err: (err as Error).message,
        });
      }
    }
    parsed.params = JSON.stringify(params);
  }

  return JSON.stringify(parsed);
}

export async function handleIncomingMessage(
  msg: IncomingMessage,
): Promise<HandleMessageResult | null> {
  try {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: msg.accountId },
      // 2026-06-03 — fix M11 writer: thêm displayName + owner.fullName để
      // set Source Badge "👤 Sale CRM · {tên} 🔄" cho tin sync từ Zalo Real.
      select: {
        orgId: true,
        ownerUserId: true,
        displayName: true,
        owner: { select: { fullName: true } },
      },
    });
    if (!account) return null;

    const contactId = await upsertContact(msg, account.orgId);

    // Update lastActivity for lead scoring freshness
    if (contactId) {
      prisma.contact.update({
        where: { id: contactId },
        data: { lastActivity: new Date() },
      }).catch(() => {});
    }

    const conversation = await findOrCreateConversation(msg, account.orgId, contactId);

    const sentAt = new Date(msg.timestamp);

    // Dedup guard for self messages: if a self message exists in the last 30s, this is likely a selfListen echo of a CRM-sent message
    if (msg.isSelf && msg.msgId) {
      // For text: match by content. For attachments (image/video/file): match by contentType only —
      // CRM persists with our MinIO URL while Zalo echo carries Zalo CDN URL, so content strings differ.
      const isAttachment = msg.contentType && ['image', 'video', 'file'].includes(msg.contentType);
      const dupeWhere: any = {
        conversationId: conversation.id,
        senderType: 'self',
        sentAt: { gte: new Date(Date.now() - 30_000) },
      };
      if (isAttachment) {
        dupeWhere.contentType = msg.contentType;
        dupeWhere.zaloMsgId = null;
      } else {
        dupeWhere.content = msg.content || '';
      }
      const recentDupe = await prisma.message.findFirst({
        where: dupeWhere,
        orderBy: { sentAt: 'desc' },
        select: { id: true, zaloMsgId: true },
      });
      if (recentDupe) {
        if (!recentDupe.zaloMsgId && msg.msgId) {
          // Update cả zaloMsgIdNum để row CRM-sent giờ có numeric Snowflake → sort đúng
          const dupNum = /^\d+$/.test(msg.msgId) ? BigInt(msg.msgId) : null;
          await prisma.message.update({
            where: { id: recentDupe.id },
            data: { zaloMsgId: msg.msgId, zaloMsgIdNum: dupNum },
          }).catch(() => {});
        }
        // FIX 2026-05-21: row CRM-sent insert TRƯỚC khi nhận echo nên thiếu cliMsgId.
        // Echo về có cliMsgId → backfill vào row dupe để undo hoạt động.
        if (msg.cliMsgId) {
          await prisma.message.update({
            where: { id: recentDupe.id },
            data: { zaloCliMsgId: msg.cliMsgId },
          }).catch(() => {});
        }
        logger.debug(`[message-handler] Skipping self echo: ${isAttachment ? 'attachment' : 'content'} match within 30s`);
        return null;
      }
    }

    let message;
    try {
      // zaloMsgIdNum = numeric form của Snowflake — primary sort key match Zalo Web.
      // Parse fail → null (CRM-sent in-flight messages chưa có msgId).
      const zaloMsgIdNum = msg.msgId && /^\d+$/.test(msg.msgId) ? BigInt(msg.msgId) : null;
      // v3.3 mirror Zalo CDN → object storage (image/video/voice/file/gif)
      const storedContent = await mirrorInboundMediaContent(msg);
      // ── M11 Source Badge writer (Anh chốt 2026-06-02) ──
      // Tin sale gõ trên app Zalo (mobile/web) → SDK echo về CRM ở đây.
      // Set sentVia='user_native' + metadata.sender.syncedFromNative=true
      // để FE MessageSourceBadge.vue hiển thị "👤 Sale CRM · {tên} 🔄".
      // Tên sale = owner.fullName (chủ nick), fallback displayName của nick.
      // Tin từ KH (msg.isSelf=false) KHÔNG set sender — badge chỉ áp tin outbound.
      const m11SenderMeta = msg.isSelf
        ? {
            kind: 'user_native' as const,
            name:
              account.owner?.fullName ||
              account.displayName ||
              msg.senderName ||
              'Sale',
            syncedFromNative: true,
          }
        : undefined;
      message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          zaloMsgId: msg.msgId || null,
          zaloMsgIdNum,
          // 2026-05-21: cliMsgId Zalo client counter — cần cho api.undo
          zaloCliMsgId: msg.cliMsgId || null,
          senderType: msg.isSelf ? 'self' : 'contact',
          senderUid: msg.senderUid,
          senderName: msg.senderName || null,
          content: storedContent || '',
          contentType: msg.contentType || 'text',
          attachments: msg.attachments ?? [],
          quote: msg.quote ?? undefined,
          albumKey: msg.albumKey ?? null,
          albumIndex: msg.albumIndex ?? null,
          albumTotal: msg.albumTotal ?? null,
          sentAt,
          // M11 writer (Anh chốt 2026-06-02): sentVia='user_native' cho tin
          // sale gõ trên Zalo Real sync về. Mặc định sentVia='user' (legacy),
          // KH inbound KHÔNG cần set vì FE badge chỉ render tin outbound.
          ...(msg.isSelf && {
            sentVia: 'user_native',
            metadata: { sender: m11SenderMeta },
          }),
          // Anh chốt 2026-06-03: lưu mentions để FE render theo pos+len thay
          // vì đoán regex. SDK chỉ trả mentions cho group; user 1-1 null.
          ...(msg.mentions && msg.mentions.length > 0 && {
            mentions: msg.mentions,
          }),
        },
      });
    } catch (err: any) {
      // P2002 = unique constraint violation → duplicate zaloMsgId, skip silently.
      // 2026-05-21: trước khi skip, backfill cliMsgId vào row existing nếu chưa có
      // (case CRM-sent row insert TRƯỚC + listener echo về SAU mang cliMsgId thật).
      if (err?.code === 'P2002') {
        if (msg.cliMsgId && msg.msgId) {
          await prisma.message.updateMany({
            where: { zaloMsgId: msg.msgId, zaloCliMsgId: null },
            data: { zaloCliMsgId: msg.cliMsgId },
          }).catch(() => {});
        }
        logger.debug(`[message-handler] Skipping duplicate zaloMsgId=${msg.msgId} (cliMsgId backfill attempted)`);
        return null;
      }
      throw err;
    }

    await updateConversationAfterMessage(conversation.id, sentAt, msg.isSelf);

    // Update Contact aggregate fields (last*, total*) — fire-and-forget,
    // best-effort. Skipped for group threads inside the helper.
    const aggregateInput = {
      conversationId: conversation.id,
      message: {
        id: message.id,
        content: message.content,
        contentType: message.contentType,
        sentAt: message.sentAt,
        senderType: (msg.isSelf ? 'self' : 'contact') as 'self' | 'contact',
      },
      contactZaloDisplayName: msg.contactZaloDisplayName ?? null,
      contactZaloAvatarUrl: msg.contactZaloAvatarUrl ?? null,
    };
    void applyContactAggregateFromMessage(aggregateInput);
    void applyFriendAggregate(aggregateInput);

    // Phase 8 — Engagement daily aggregate hook (fire-and-forget).
    // Skip for group threads (only meaningful for 1-1 contact engagement).
    if (msg.threadType !== 'group' && contactId) {
      void (async () => {
        try {
          const { incrementDailyAggregate, messageEngagementInputs, parseCallMeta } =
            await import('../engagement/engagement-service.js');
          // hasQuote: KH dùng quote-reply (Zalo "trả lời tin nhắn") → quote payload non-null/non-empty
          const q = (msg as any).quote;
          const hasQuote = q !== undefined && q !== null
            && (typeof q !== 'object' || Object.keys(q).length > 0);
          // callMeta: tách missed vs connected từ content.params
          const callMeta = message.contentType === 'call'
            ? parseCallMeta(msg.content, msg.isSelf)
            : null;
          const signals = messageEngagementInputs(message.contentType, msg.isSelf, hasQuote, callMeta);

          // customerInitiated: KH nhắn trước trong ngày (chỉ khi inbound + chưa có activity nào hôm nay)
          let customerInitiated = false;
          if (!msg.isSelf) {
            const today = new Date(sentAt);
            const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
            const priorToday = await prisma.message.findFirst({
              where: {
                conversationId: conversation.id,
                sentAt: { gte: startOfDay, lt: sentAt },
                id: { not: message.id },
              },
              select: { id: true },
            });
            customerInitiated = !priorToday;
          }

          await incrementDailyAggregate({
            contactId,
            orgId: account.orgId,
            at: sentAt,
            inboundMsg: signals.inbound,
            outboundMsg: signals.outbound,
            mediaShare: signals.mediaShare,
            voiceMsg: signals.voiceMsg,
            call: signals.call,
            missedCall: signals.missedCall,
            quoteReply: signals.quoteReply,
            customerInitiated,
          });
        } catch (err) {
          // silent — engagement is best-effort
        }
      })();
    }

    // Phase 6 — Lead scoring hook (fire-and-forget).
    // Resolve friendId by (zaloAccountId, externalThreadId) sau aggregate đã chạy.
    // Nếu Friend chưa exist (lần đầu chat), aggregate sẽ tạo row → hook sẽ chạy ở message kế.
    if (msg.threadType !== 'group' && msg.threadId) {
      void (async () => {
        try {
          const friend = await prisma.friend.findUnique({
            where: {
              zaloAccountId_zaloUidInNick: {
                zaloAccountId: msg.accountId,
                zaloUidInNick: msg.threadId,
              },
            },
            select: { id: true, lastInboundAt: true, lastOutboundAt: true },
          });
          if (!friend) return;

          const content = String(message.content || '');
          const sentAtMs = message.sentAt.getTime();

          if (msg.isSelf) {
            // Outbound — chỉ check slow_response_self
            if (friend.lastInboundAt) {
              const secs = Math.max(0, (sentAtMs - friend.lastInboundAt.getTime()) / 1000);
              onOutboundScoring(account.orgId, friend.id, { responseSecondsFromLastInbound: secs });
            }
          } else {
            // Inbound — full keyword + engagement scoring
            const responseSecs = friend.lastOutboundAt
              ? Math.max(0, (sentAtMs - friend.lastOutboundAt.getTime()) / 1000)
              : null;
            const isVoiceOrCall =
              message.contentType === 'voice' ||
              message.contentType === 'audio' ||
              message.contentType === 'call';
            onInboundScoring(account.orgId, friend.id, content, {
              contentLength: content.length,
              isVoiceOrCall,
              responseSecondsFromLastOutbound: responseSecs,
            });
          }
        } catch {
          // silent — scoring is best-effort
        }
      })();
    }

    // Auto-sync Zalo reminder → Appointment (fire-and-forget, dedup theo externalRef)
    void syncReminderFromMessage({
      orgId: account.orgId,
      contactId,
      messageId: message.id,
      content: message.content,
      contentType: message.contentType,
      senderUid: msg.senderUid,
    });

    // Track first outbound contact date — set once when agent sends first message
    if (msg.isSelf && contactId) {
      prisma.contact.updateMany({
        where: { id: contactId, firstContactDate: null },
        data: { firstContactDate: new Date(msg.timestamp) },
      }).catch(() => {});
    }

    // Skip webhooks and automation for backfilled messages (old_messages / sync)
    if (msg.isBackfill) {
      return {
        message,
        conversationId: conversation.id,
        orgId: account.orgId,
        contactId,
      };
    }

    // Emit webhook for message event (fire-and-forget)
    emitWebhook(account.orgId, msg.isSelf ? 'message.sent' : 'message.received', {
      messageId: message.id,
      conversationId: conversation.id,
      senderUid: msg.senderUid,
      content: msg.content,
      contentType: msg.contentType,
      sentAt: message.sentAt,
    });

    if (!msg.isSelf) {
      const org = await prisma.organization.findUnique({
        where: { id: account.orgId },
        select: { id: true, name: true },
      });
      const contact = contactId
        ? await prisma.contact.findUnique({
            where: { id: contactId },
            select: { id: true, fullName: true, crmName: true, phone: true, status: true, source: true, assignedUserId: true },
          })
        : null;
      const conversationDetails = await prisma.conversation.findUnique({
        where: { id: conversation.id },
        select: { id: true, unreadCount: true, externalThreadId: true, threadType: true, zaloAccountId: true, contactId: true },
      });

      void runAutomationRules({
        trigger: 'message_received',
        orgId: account.orgId,
        org,
        contact,
        conversation: conversationDetails
          ? {
              id: conversationDetails.id,
              unreadCount: conversationDetails.unreadCount,
              threadId: conversationDetails.externalThreadId,
              threadType: conversationDetails.threadType,
              zaloAccountId: conversationDetails.zaloAccountId,
            }
          : null,
        message: { id: message.id, content: message.content, contentType: message.contentType, senderType: message.senderType },
      });

      // Wave 3 Event Log — customer_reply (KH trả lời, Mục tiêu dừng chuỗi).
      // Hook sau runAutomationRules để KHÔNG block phase chính. Filter 1-1 theo memory
      // feedback_crm_filter_1to1_not_group — bỏ qua group threads.
      //
      // BUG FIX 2026-06-08: dùng contactId CỦA CONVERSATION (nơi tin thật sự lưu), KHÔNG
      // dùng contactId từ upsertContact. Lý do: cùng 1 người Zalo có thể bị trùng thành
      // nhiều Contact (per-account UID / global_id lệch — xem memory reference_zalo_per_account_uid).
      // upsertContact resolve theo global_id → ra Contact A; nhưng findOrCreateConversation tìm
      // theo (nick, externalThreadId) → trả conversation cũ gắn Contact B, và tin nhắn lưu vào B.
      // CareSession gắn theo Contact của conversation (B). Nếu listener dùng A → tìm phiên cho A
      // → found=0 → không báo. Phải khớp với Contact mà tin nhắn + phiên thật sự thuộc về.
      const careContactId = conversationDetails?.contactId ?? contactId;
      if (
        careContactId &&
        conversationDetails?.threadType === 'user' &&
        message.contentType === 'text'
      ) {
        void (async () => {
          try {
            // ── CareSession 2026-06-07 (T3): lắng nghe qua PHIÊN, không tra outbox ──
            // Đọc phiên ĐANG MỞ cho (org, contact, nick) + lazy-close nguồn chết (D12).
            // Phiên = chân lý; bao được cả luồng gắn tay (outbox cũ chỉ thấy friend-request).
            const { findListeningSessionsForEvent, recordCustomerEventOnSession, buildCareEventId } =
              await import('../automation/care-session/care-session-service.js');
            const sessions = await findListeningSessionsForEvent({
              orgId: account.orgId,
              contactId: careContactId,
              nickId: msg.accountId,
              // Per-nick thread (2026-06-08): chỉ phiên của ĐÚNG hội thoại này (hoặc legacy null).
              externalThreadId: conversationDetails?.externalThreadId ?? null,
            });
            if (sessions.length === 0) return; // KH không trong phiên chăm sóc nào

            const contactDisplay =
              contact?.crmName?.trim() || contact?.fullName?.trim() || contact?.phone || 'KH';

            // Idempotency gate per phiên (reply 2 lần / Zalo gửi trùng → chỉ xử lý 1).
            const eventId = buildCareEventId({
              nickId: msg.accountId,
              contactId: careContactId,
              eventType: 'reply',
              providerId: message.id,
            });

            // Xử lý từng phiên (khách có thể ở nhiều phiên — đa Mục tiêu / gắn tay).
            for (const session of sessions) {
              const isNew = await recordCustomerEventOnSession({
                sessionId: session.id,
                eventId,
                eventType: 'reply',
                payload: {
                  messageId: message.id,
                  conversationId: conversation.id,
                  contentPreview: (message.content ?? '').slice(0, 120),
                },
              });
              if (!isNew) continue; // dup → bỏ qua phiên này

              const triggerId = session.sourceTriggerId;

              // CareSession 2026-06-07 (anh chốt): ghi pause vào PHIÊN để trang Phiên
              // chăm sóc hiển thị "💬 vừa trả lời" + "⏸ chạy lại sau X giờ". pausedUntil
              // = now + pauseOnActivityHours (đồng bộ Redis pause flag set bên dưới).
              try {
                let pauseHours = 24;
                if (triggerId) {
                  const tg = await prisma.automationTrigger.findUnique({
                    where: { id: triggerId },
                    select: { pauseOnActivityHours: true },
                  });
                  if (tg?.pauseOnActivityHours && tg.pauseOnActivityHours > 0) pauseHours = tg.pauseOnActivityHours;
                }
                await prisma.careSession.update({
                  where: { id: session.id },
                  data: {
                    lastReplyAt: new Date(),
                    pausedUntil: new Date(Date.now() + pauseHours * 3600_000),
                  },
                });
              } catch (e) {
                logger.warn(`[message-handler] update care-session pause failed session=${session.id}`);
              }

              // T5 — Guard log: CHỈ ghi AutomationEventLog(triggerId) cho Monitor khi
              // trigger ĐANG nghe (active+paused). Trigger chết → KHÔNG ghi rác (chỉ Phiên).
              // findListeningSessionsForEvent đã lazy-close phiên nguồn chết → tới đây
              // session.triggerState ∈ [active,paused,null]. null = gắn tay (không log Monitor).
              if (triggerId && session.triggerState != null) {
                void logAutomationEvent({
                  orgId: account.orgId,
                  triggerId,
                  contactId: careContactId,
                  nickId: msg.accountId,
                  eventType: 'customer_reply',
                  eventPriority: 'urgent',
                  summary: `🔥 ${contactDisplay} vừa trả lời chuỗi bám đuổi — Mục tiêu dừng`,
                  metadata: {
                    messageId: message.id,
                    conversationId: conversation.id,
                    contentPreview: (message.content ?? '').slice(0, 120),
                    careSessionId: session.id,
                  },
                });

                // FE chip "🛑 KH reply" — queueStatus per-trigger (chỉ khi có trigger).
                try {
                  await prisma.triggerQueueEntry.updateMany({
                    where: {
                      triggerId,
                      contactId: careContactId,
                      queueStatus: {
                        notIn: ['customer_reply', 'customer_block', 'converted_lead', 'cancelled'],
                      },
                    },
                    data: { queueStatus: 'customer_reply' },
                  });
                } catch (updErr) {
                  logger.warn('[message-handler] customer_reply entry update failed:', updErr);
                }
              }

              // Dừng chuỗi + báo sale khi khách reply.
              //   - Cancel BullMQ steps + pause flag: CHỈ khi phiên có trigger (chuỗi đang gửi).
              //   - dispatchCareNotify (BÁO SALE): cho MỌI phiên — kể cả phiên GẮN TAY
              //     (sourceTriggerId=null, chỉ-theo-dõi). Anh chốt 2026-06-08: khách chat tay
              //     được "ghim" theo dõi → trả lời (dù chậm) vẫn phải báo sale.
              try {
                let triggerName: string | null = session.triggerName ?? null;

                // Phần dừng chuỗi tự động — chỉ phiên có trigger mới có gì để dừng.
                if (triggerId) {
                  const trigger = await prisma.automationTrigger.findUnique({
                    where: { id: triggerId },
                    select: { pauseOnActivityHours: true, name: true },
                  });
                  if (trigger?.name) triggerName = trigger.name;
                  const { cancelPendingStepsForContact, setContactPauseFlag } = await import(
                    '../automation/queues/event-hooks.js'
                  );
                  await setContactPauseFlag(triggerId, careContactId, trigger?.pauseOnActivityHours ?? 24);
                  const { removed } = await cancelPendingStepsForContact(triggerId, careContactId);
                  if (removed > 0) {
                    logger.info(`[message-handler] customer_reply paused + cancelled ${removed} BullMQ step(s) for contact=${careContactId}`);
                  }
                }

                // Notify KHẨN sale chủ nick — "KH đang nhắn, vào trả lời ngay" (mọi phiên).
                const nickOwner = await prisma.zaloAccount.findUnique({
                  where: { id: msg.accountId },
                  select: { ownerUserId: true, displayName: true },
                });
                // ownerUserId ưu tiên chủ nick; phiên gắn tay nick chưa gán chủ → dùng owner phiên.
                const notifyOwnerId = nickOwner?.ownerUserId ?? session.ownerUserId;
                if (notifyOwnerId) {
                  // T10c — bắn notify 3 đích (owner/manager/group) + privacy.
                  // Lấy tên sale (cho đích nhóm "KH của [sale]"). notifyChannels đọc từ ORG.
                  const saleUser = await prisma.user.findUnique({
                    where: { id: notifyOwnerId },
                    select: { fullName: true },
                  });
                  const { dispatchCareNotify } = await import(
                    '../automation/care-session/care-session-service.js'
                  );
                  await dispatchCareNotify({
                    orgId: account.orgId,
                    eventType: 'reply',
                    eventKey: 'reply',
                    eventId,
                    ownerUserId: notifyOwnerId,
                    contactId: careContactId,
                    contactName: contact?.fullName ?? contact?.crmName ?? contactDisplay,
                    contactPhone: contact?.phone ?? '',
                    contentPreview: message.content ?? '',
                    saleName: saleUser?.fullName ?? '',
                    triggerId, // null cho phiên gắn tay → template "theo dõi tay"
                    triggerName, // null cho phiên gắn tay
                  });
                }
              } catch (err) {
                logger.warn('[message-handler] stop sequence on reply failed:', err);
              }
            }
          } catch (err) {
            logger.warn('[message-handler] customer_reply care-session handling failed:', err);
          }
        })();
      }

      // Phase 7 — emit AutomationEvent for engine triggers.
      // Detect first_message_received (contact has 0 prior inbound msgs from this nick)
      // and emit text-content payload so keyword_match triggers can filter.
      void (async () => {
        try {
          const { automationEventBus } = await import('../automation/engine/event-bus.js');
          // Count prior inbound messages from this contact to determine "first message"
          const priorInbound = contactId
            ? await prisma.message.count({
                where: {
                  conversationId: conversation.id,
                  senderType: 'contact',
                  id: { not: message.id },
                },
              })
            : 1;
          const isFirstMessage = priorInbound === 0;

          const basePayload = {
            messageId: message.id,
            conversationId: conversation.id,
            content: message.content ?? '',
            contentType: message.contentType,
            zaloAccountId: msg.accountId,
          };

          // Always emit generic message_received
          automationEventBus.emit({
            type: 'message_received',
            orgId: account.orgId,
            occurredAt: new Date(),
            contactId: contactId ?? undefined,
            payload: basePayload,
          });

          // Emit first_message_received only on the actual first inbound
          if (isFirstMessage && contactId) {
            automationEventBus.emit({
              type: 'first_message_received',
              orgId: account.orgId,
              occurredAt: new Date(),
              contactId,
              payload: basePayload,
            });
          }

          // Emit keyword_match if content non-empty (engine's eventFilter handles keyword matching)
          if (message.content && message.contentType === 'text' && contactId) {
            automationEventBus.emit({
              type: 'keyword_match',
              orgId: account.orgId,
              occurredAt: new Date(),
              contactId,
              payload: basePayload,
            });
          }
        } catch {
          // engine not loaded — silent
        }
      })();
    }

    // ── Fix 2026-06-03 (Anh báo): socket realtime thiếu senderResolved ──
    // Trước fix: socket emit chỉ có message raw (senderName, senderUid) →
    // FE pill tím KHÔNG render → đợi reload page mới gọi GET /messages có
    // resolver mới có pill. Giờ resolve ngay khi handle inbound message.
    // Chỉ resolve cho tin INBOUND (contact). Self-messages không cần pill.
    let senderResolved: any = null;
    if (!msg.isSelf && msg.senderUid) {
      try {
        const [internalNick, contactByUid, friend] = await Promise.all([
          prisma.zaloAccount.findFirst({
            where: { orgId: account.orgId, zaloUid: msg.senderUid },
            select: {
              displayName: true,
              ownerUserId: true,
              owner: { select: { id: true, fullName: true } },
            },
          }),
          prisma.contact.findFirst({
            where: { orgId: account.orgId, zaloUid: msg.senderUid },
            select: { crmName: true, fullName: true },
          }),
          prisma.friend.findFirst({
            where: { orgId: account.orgId, zaloUidInNick: msg.senderUid },
            select: { aliasInNick: true, zaloDisplayName: true },
          }),
        ]);
        const crmName = contactByUid?.crmName ?? friend?.aliasInNick ?? null;
        const zaloName = msg.senderName ?? friend?.zaloDisplayName ?? contactByUid?.fullName ?? null;
        const displayName = crmName ?? zaloName ?? 'Người lạ';
        senderResolved = {
          senderDisplayName: displayName,
          senderCrmName: crmName,
          senderZaloName: zaloName,
          senderIsInternalNick: !!internalNick,
          senderInternalNickLabel: internalNick?.displayName ?? null,
          senderInternalNickOwner: internalNick?.owner?.fullName ?? null,
          senderInternalNickOwnerId: internalNick?.owner?.id ?? internalNick?.ownerUserId ?? null,
          senderCase: internalNick ? 'B' : 'A',
        };
      } catch (resolveErr) {
        logger.warn('[message-handler] senderResolved lookup failed:', resolveErr);
      }
    }

    return {
      message: { ...message, senderResolved } as any,
      conversationId: conversation.id,
      orgId: account.orgId,
      contactId,
    };
  } catch (err) {
    logger.error('[message-handler] handleIncomingMessage error:', err);
    return null;
  }
}

// Upsert contact — handles both user and group conversations
async function upsertContact(msg: IncomingMessage, orgId: string): Promise<string | null> {
  // Group messages: create/update a "contact" record representing the group
  if (msg.threadType === 'group') {
    const groupUid = msg.threadId;
    let groupContact = await prisma.contact.findFirst({
      where: { zaloUid: groupUid, orgId },
      select: { id: true, fullName: true },
    });

    if (!groupContact) {
      groupContact = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: groupUid,
          fullName: msg.groupName || 'Nhóm',
          metadata: { isGroup: true },
        },
        select: { id: true, fullName: true },
      });
      // Emit webhook for new contact created
      emitWebhook(orgId, 'contact.created', { contactId: groupContact.id, fullName: groupContact.fullName });
    } else if (msg.groupName && groupContact.fullName !== msg.groupName) {
      await prisma.contact.update({
        where: { id: groupContact.id },
        data: { fullName: msg.groupName },
      });
    }
    return groupContact.id;
  }

  // For self messages on user threads, the contact is the thread recipient (threadId = contact UID).
  // recipientName được listener resolve qua getUserInfo(threadId) — đảm bảo contact mới có tên thật
  // thay vì 'Unknown' khi anh chủ động chat với người lạ.
  const contactUid = msg.isSelf ? msg.threadId : msg.senderUid;
  const contactName = msg.isSelf ? (msg.recipientName || '') : msg.senderName;
  const globalId = msg.contactGlobalId || '';
  const username = msg.contactUsername || '';

  // Lookup chain (theo policy hard-match anh chốt: globalId / username / phone / uid):
  //  1. By zaloGlobalId — silver bullet, identical across viewer accounts
  //  2. By zaloUsername — Zalo handle (t_xxx) cũng toàn cục
  //  3. By zaloUid (per-account) — fallback khi global identifiers chưa resolve
  //  4. Create new contact
  let contact: { id: string; fullName: string | null; zaloGlobalId: string | null; zaloUid: string | null } | null = null;
  if (globalId) {
    contact = await prisma.contact.findFirst({
      where: { orgId, zaloGlobalId: globalId },
      select: { id: true, fullName: true, zaloGlobalId: true, zaloUid: true },
    });
  }
  if (!contact && username) {
    contact = await prisma.contact.findFirst({
      where: { orgId, zaloUsername: username },
      select: { id: true, fullName: true, zaloGlobalId: true, zaloUid: true },
    });
  }
  if (!contact) {
    contact = await prisma.contact.findFirst({
      where: { orgId, zaloUid: contactUid },
      select: { id: true, fullName: true, zaloGlobalId: true, zaloUid: true },
    });
  }

  if (!contact) {
    const created = await prisma.contact.create({
      data: {
        id: randomUUID(),
        orgId,
        zaloUid: contactUid,
        zaloGlobalId: globalId || null,
        zaloUsername: username || null,
        fullName: contactName || 'Unknown',
      },
      select: { id: true, fullName: true, zaloGlobalId: true, zaloUid: true },
    });
    contact = created;
    emitWebhook(orgId, 'contact.created', { contactId: contact.id, fullName: contact.fullName });
  } else {
    // Backfill globalId/username nếu vừa resolve được, hoặc cập nhật fullName từ Unknown.
    const patch: { zaloGlobalId?: string; zaloUsername?: string; fullName?: string; zaloUid?: string } = {};
    if (globalId && contact.zaloGlobalId !== globalId) patch.zaloGlobalId = globalId;
    if (username) patch.zaloUsername = username;
    // Nếu contact match qua globalId nhưng zaloUid khác (đang được nhìn từ account khác) —
    // KHÔNG ghi đè zaloUid (mỗi account thấy 1 UID; conversation bind theo externalThreadId riêng).
    // Chỉ set zaloUid khi đang null.
    if (!contact.zaloUid && contactUid) patch.zaloUid = contactUid;
    if (contactName && contact.fullName !== contactName && contact.fullName === 'Unknown') {
      patch.fullName = contactName;
    }
    if (Object.keys(patch).length > 0) {
      await prisma.contact.update({ where: { id: contact.id }, data: patch });
    }
  }

  return contact.id;
}

// Find or create conversation — externalThreadId = threadId for both user and group
async function findOrCreateConversation(
  msg: IncomingMessage,
  orgId: string,
  contactId: string | null,
) {
  const externalThreadId = msg.threadId;

  const existing = await prisma.conversation.findFirst({
    where: { zaloAccountId: msg.accountId, externalThreadId },
    select: { id: true, groupName: true, groupAvatarUrl: true, groupMembersCount: true },
  });

  if (existing) {
    // Update group metadata if changed (sync mới hơn so với DB)
    if (msg.threadType === 'group') {
      const updates: { groupName?: string; groupAvatarUrl?: string; groupMembersCount?: number } = {};
      if (msg.groupName && msg.groupName !== existing.groupName) updates.groupName = msg.groupName;
      if (msg.groupAvatarUrl && msg.groupAvatarUrl !== existing.groupAvatarUrl) updates.groupAvatarUrl = msg.groupAvatarUrl;
      if (msg.groupMembersCount != null && msg.groupMembersCount !== existing.groupMembersCount) {
        updates.groupMembersCount = msg.groupMembersCount;
      }
      if (Object.keys(updates).length) {
        await prisma.conversation.update({ where: { id: existing.id }, data: updates });
      }
    }
    return { id: existing.id };
  }

  return prisma.conversation.create({
    data: {
      id: randomUUID(),
      orgId,
      zaloAccountId: msg.accountId,
      contactId: msg.threadType === 'user' ? contactId : contactId,
      threadType: msg.threadType,
      externalThreadId,
      groupName: msg.threadType === 'group' ? msg.groupName : null,
      groupAvatarUrl: msg.threadType === 'group' ? msg.groupAvatarUrl : null,
      groupMembersCount: msg.threadType === 'group' ? msg.groupMembersCount : null,
      lastMessageAt: new Date(msg.timestamp),
      unreadCount: msg.isSelf ? 0 : 1,
      isReplied: msg.isSelf,
    },
    select: { id: true },
  });
}

// Update conversation metadata after a new message
async function updateConversationAfterMessage(
  conversationId: string,
  sentAt: Date,
  isSelf: boolean,
): Promise<void> {
  const updateData: any = { lastMessageAt: sentAt };
  if (isSelf) {
    updateData.isReplied = true;
    updateData.unreadCount = 0;
  } else {
    updateData.unreadCount = { increment: 1 };
    updateData.isReplied = false;
  }
  await prisma.conversation.update({ where: { id: conversationId }, data: updateData });
}

/**
 * Soft-delete a message by its Zalo references. Zalo undo event reference tin gốc qua
 * 2 id song song — match cái nào ra trước thì update.
 *   globalMsgIdNum: server-side Snowflake (match Message.zaloMsgIdNum BigInt)
 *   cliMsgIdNum:    client-side counter (match Message.zaloMsgId String hoặc zaloMsgIdNum)
 * Phải dùng `OR` vì Zalo có lúc chỉ trả 1 trong 2 (vd undo tin do nick khác gửi → chỉ globalMsgId).
 */
export async function handleMessageUndo(
  accountId: string,
  refs: { globalMsgIdNum: bigint | null; cliMsgIdNum: bigint | null },
): Promise<string[]> {
  try {
    const orWhere: Array<Record<string, unknown>> = [];
    if (refs.globalMsgIdNum) orWhere.push({ zaloMsgIdNum: refs.globalMsgIdNum });
    if (refs.cliMsgIdNum) {
      // cliMsgId có thể nằm ở zaloCliMsgId (column mới 2026-05-21) hoặc zaloMsgIdNum cũ
      orWhere.push({ zaloCliMsgId: refs.cliMsgIdNum.toString() });
      orWhere.push({ zaloMsgIdNum: refs.cliMsgIdNum });
      orWhere.push({ zaloMsgId: refs.cliMsgIdNum.toString() });
    }
    if (orWhere.length === 0) return [];

    const recalledAt = new Date();

    // Fetch rows TRƯỚC khi update để biết id để emit socket sau.
    const affected = await prisma.message.findMany({
      where: { OR: orWhere, isDeleted: false },
      select: { id: true, conversationId: true, zaloMsgId: true },
    });
    if (affected.length === 0) {
      logger.warn(
        `[message-handler] Undo: no message matched (account=${accountId}, globalMsgId=${refs.globalMsgIdNum}, cliMsgId=${refs.cliMsgIdNum})`,
      );
      return [];
    }

    await prisma.message.updateMany({
      where: { id: { in: affected.map((m) => m.id) } },
      data: { isDeleted: true, deletedAt: recalledAt },
    });

    for (const m of affected) {
      void applyContactInteraction({
        conversationId: m.conversationId,
        type: 'message_recalled',
        occurredAt: recalledAt,
        payload: { messageId: m.id, zaloMsgId: m.zaloMsgId },
      });
    }

    logger.info(
      `[message-handler] Undo ${affected.length} message(s) (account=${accountId}, globalMsgId=${refs.globalMsgIdNum}) → ${affected.map((m) => m.id).join(',')}`,
    );
    return affected.map((m) => m.id);
  } catch (err) {
    logger.error('[message-handler] handleMessageUndo error:', err);
    return [];
  }
}
