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
// 2026-06-13 (Sequence recode Đợt 1): GỬI BẤT CHẤP bạn/lạ — thiếu Friend row → ensureUidForPair
// (resolve UID qua SĐT). KH bật chặn tin lạ → set strangerBlocked + dừng riêng. Bỏ STUB_MODE.

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { zaloOps } from '../../../../shared/zalo-operations.js';
import { applyContactAggregateFromMessage, applyFriendAggregate } from '../../../contacts/contact-aggregate.js';
import { resolveBlockContent, type ResolvedMessage } from '../../blocks/resolve-block-content.js';
import { renderTemplate, renderTemplateDetailed, shiftStylesForRender } from '../../blocks/render-template.js';
import type { ActionContext, ActionResult } from '../types.js';
// Phase Media GĐ3 2026-06-11 — Đường B: zca-js KHÔNG nhận URL (readFile string như
// path), nên media trong Block phải DOWNLOAD về temp → gửi local path. Bug có sẵn:
// engine cũ gửi {url} string → zca-js readFile('http://...') fail.
import { downloadMediaToTemp } from '../../../chat/chat-media-helpers.js';
import { sendNativeVideo } from '../../../../shared/video-processor.js';
import { zaloPool } from '../../../zalo/zalo-pool.js';
// Fix realtime 2026-06-15 (anh báo): tin BOT gửi không tự hiện cột 3 + preview cột 2.
// send-message.ts lưu Message NHƯNG không emit 'chat:message' như POST handler tin tay →
// FE không biết tới khi reload. Echo về cũng bị message-handler suppress (return null).
// emitChatMessage = helper chuẩn (privacy redact + scope org) giống chat-routes.ts:1484.
import { emitChatMessage } from '../../../../shared/realtime/emit-chat.js';
// GĐ Block-media (2026-06-13): D4 vá tên file dùng chung với chat; D3 bump usageCount khi gửi media qua Block.
import { buildSendFileName } from '../../../media/media-routes.js';
import { bumpUsage } from '../../../media/media-service.js';

type ZaloStyle = { st: string; start: number; len: number };

// 2026-06-13: nhận diện lỗi "KH bật chặn tin người lạ" (anh đính chính — KHÔNG phải
// Zalo chặn toàn bộ). Quan sát: zalo:127 + message tiếng Việt "không thể nhận tin
// nhắn từ" / "người lạ". Match cả code lẫn message để không phụ thuộc 1 nguồn.
function isStrangerRejectError(code: string | undefined, msg: string): boolean {
  if (code === '127' || code === 'zalo:127') return true;
  const m = (msg || '').toLowerCase();
  return m.includes('nhận tin nhắn từ') || m.includes('người lạ') || m.includes('zalo:127');
}

// 2026-06-13: truy tên file thật từ Kho qua mediaAssetId (block file thường filename trống).
async function resolveMediaFilename(mediaAssetId: string | undefined, fallback: string | undefined): Promise<string> {
  if (fallback && fallback.trim()) return fallback.trim();
  if (!mediaAssetId) return '';
  try {
    const a = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId }, select: { originalFilename: true, name: true } });
    return (a?.originalFilename || a?.name || '').trim();
  } catch { return ''; }
}

// D3 (2026-06-13): gom mediaAssetId từ 1 ResolvedMessage media (image/video/file + album per-item)
// để bump usageCount sau khi gửi. text/friend_request → [].
function collectMediaAssetIds(m: ResolvedMessage): string[] {
  const p = m.payload as Record<string, unknown>;
  if (m.messageType === 'album') {
    const items = (p.items as Array<{ mediaAssetId?: string }>) ?? [];
    return items.map((it) => it.mediaAssetId).filter((x): x is string => !!x);
  }
  if (m.messageType === 'image' || m.messageType === 'video' || m.messageType === 'file') {
    return p.mediaAssetId ? [p.mediaAssetId as string] : [];
  }
  return [];
}

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

  // ── Real impl (2026-06-13: bỏ STUB_MODE — code chết test, anh chốt recode dứt điểm) ──

  // Step 1: find Friend row to get threadId (= zaloUidInNick) and verify status
  let friend = await prisma.friend.findFirst({
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
      strangerBlocked: true,
    },
  });

  // 2026-06-13 (Sequence recode Đợt 1 — gửi bất chấp): KHÔNG fail cứng NO_FRIEND_ROW.
  // Thiếu Friend row (KH lạ) → ensureUidForPair: resolve UID qua SĐT + tạo Friend row,
  // rồi gửi vào hộp người lạ (allowStrangerMessage). Tái dùng SEQ-C1, không enqueue mù.
  if (!friend) {
    const { ensureUidForPair } = await import('../ensure-uid.js');
    const r = await ensureUidForPair({ orgId: ctx.orgId, nickId: ctx.assignedNickId, contactId: ctx.contactId });
    if (!r.ok) {
      // Lỗi resolve UID (no_phone/no_zalo/capped/offline) → fail rõ, retry tùy loại.
      return {
        outcome: 'failure',
        errorCode: r.code === 'LOOKUP_CAPPED' || r.code === 'NOT_CONNECTED' ? 'RATE_LIMITED' : 'NO_FRIEND_ROW',
        errorMessage: r.detail,
        retryable: r.code === 'LOOKUP_CAPPED' || r.code === 'NOT_CONNECTED',
      };
    }
    friend = await prisma.friend.findFirst({
      where: { zaloAccountId: ctx.assignedNickId, contactId: ctx.contactId, orgId: ctx.orgId },
      select: { id: true, zaloUidInNick: true, friendshipStatus: true, hasConversation: true, strangerBlocked: true },
    });
    if (!friend) {
      return { outcome: 'failure', errorCode: 'NO_FRIEND_ROW', errorMessage: 'Friend row vừa tạo không đọc lại được', retryable: true };
    }
  }

  // KH đã từng bật chặn tin người lạ → DỪNG riêng cặp này, không thử gửi lại (spam lỗi).
  if (friend.strangerBlocked) {
    return {
      outcome: 'failure',
      errorCode: 'STRANGER_BLOCKED',
      errorMessage: 'Khách bật chế độ không nhận tin người lạ — cần kết bạn trước mới bám đuổi được.',
      retryable: false,
    };
  }
  // 2026-06-13 (Sequence recode Đợt 1 — GỬI BẤT CHẤP, FIX code-review #1+#4):
  //   - Đường sequence/manual bám đuổi MẶC ĐỊNH cho gửi bất chấp bạn/lạ (anh chốt trụ
  //     cột 2). KHÔNG còn phụ thuộc runtimeRules.allowStrangerMessage (bug cũ: sequence
  //     manual không set cờ → KH lạ status='none' fail FRIENDSHIP_NOT_ACCEPTED → gửi-bất-
  //     chấp chết). allowStranger bật khi đây là đường automation (ctx.sequenceMeta có).
  //   - NHƯNG chặn cứng 'blocked'/'removed'/'rejected' (KH đã CHẶN/XÓA nick — code-review
  //     #4): nick-selector cũ lọc OR[accepted|pending+chat] ngầm loại các status này;
  //     filter strangerBlocked mới là cờ KHÁC → phải chặn lại ở đây.
  const HOSTILE_STATUSES = new Set(['blocked', 'removed', 'rejected']);
  if (HOSTILE_STATUSES.has(friend.friendshipStatus)) {
    return {
      outcome: 'failure',
      errorCode: 'FRIENDSHIP_HOSTILE',
      errorMessage: `Khách đã ${friend.friendshipStatus === 'blocked' ? 'chặn' : friend.friendshipStatus === 'removed' ? 'xóa kết bạn' : 'từ chối'} nick này — không bám đuổi được.`,
      retryable: false,
    };
  }

  // allowStranger: đường automation (sequenceMeta) hoặc rules bật cờ → gửi vào hộp lạ.
  const allowStranger =
    !!ctx.sequenceMeta ||
    (ctx.rulesSnapshot as { allowStrangerMessage?: boolean } | undefined)?.allowStrangerMessage === true;

  if (friend.friendshipStatus !== 'accepted' && !allowStranger) {
    // Không phải automation + không bật cờ + chưa accepted → giữ chặn cũ (gửi tay lẻ).
    if (!(friend.friendshipStatus === 'pending_sent' && friend.hasConversation)) {
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

  // FIX code-review #1 (tầng 2): KH chưa accepted + gửi bất chấp → payload PHẢI kèm
  // allowStrangerMessage:true để Zalo nhận vào hộp "tin nhắn từ người lạ" (giống
  // sendStrangerFollowUp event-hooks.ts:260). Thiếu cờ → Zalo thả tin (success giả).
  const sendStranger = allowStranger && friend.friendshipStatus !== 'accepted';

  // Step 2: get-or-create Conversation
  // Lấy kèm privacyMode + ownerUserId của nick → emitChatMessage realtime đúng privacy.
  let conversation = await prisma.conversation.findUnique({
    where: { zaloAccountId_externalThreadId: { zaloAccountId: ctx.assignedNickId, externalThreadId: threadId } },
    select: { id: true, zaloAccount: { select: { privacyMode: true, ownerUserId: true } } },
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
      select: { id: true, zaloAccount: { select: { privacyMode: true, ownerUserId: true } } },
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
        // D6 (2026-06-13): GIỮ format khi có biến — dịch offset style theo giá trị thật (an toàn,
        // không đếm mù). shiftStylesForRender trả null nếu biến cắt ngang vùng style → fallback bỏ style.
        const { rendered, values } = await renderTemplateDetailed(m.payload.text, ctx.contactId, ctx.assignedNickId);
        const rawStyles: ZaloStyle[] = Array.isArray(m.payload.styles) ? m.payload.styles : [];
        const shifted = rawStyles.length ? shiftStylesForRender(m.payload.text, rawStyles, values) : rawStyles;
        const styles: ZaloStyle[] = (shifted as ZaloStyle[] | null) ?? [];
        const msgPayload: Record<string, unknown> = { msg: rendered };
        const useStyles = styles.length > 0;
        if (useStyles) msgPayload.styles = styles;
        if (sendStranger) msgPayload.allowStrangerMessage = true; // FIX #1 tầng 2: vào hộp người lạ
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
        // 2026-06-13 (Zalo mất tên file): filename block thường TRỐNG → truy tên thật từ Kho qua
        // mediaAssetId trước khi suy đuôi (không rơi về URL-hash).
        const realName = await resolveMediaFilename(m.payload.mediaAssetId, m.payload.filename);
        const sendName = buildSendFileName(
          { name: realName, originalFilename: realName || null },
          { mimeType: m.payload.mimeType ?? '', publicUrl: m.payload.url },
        );
        const tmp = await downloadMediaToTemp({ url: m.payload.url, filename: sendName }, 'file');
        tmpCleanups.push(tmp.cleanup);
        const raw = await zaloOps.sendFile(ctx.assignedNickId, threadId, threadType, [tmp.path], null, caption);
        sdkResult = (raw as Record<string, unknown>) || {};
        persistContent = JSON.stringify({ text: caption, attachments: [{ kind: 'file', url: m.payload.url, filename: sendName, caption }] });
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
      // 2026-06-13: KH tự bật "không nhận tin người lạ" (anh đính chính — KHÔNG phải Zalo
      // chặn toàn bộ). Zalo trả zalo:127 / message chứa "nhận tin nhắn từ" / "người lạ".
      // → đánh dấu Friend.strangerBlocked + DỪNG riêng cặp này (không spam lỗi lặp).
      if (isStrangerRejectError(code, msg)) {
        await prisma.friend
          .update({
            where: { zaloAccountId_zaloUidInNick: { zaloAccountId: ctx.assignedNickId, zaloUidInNick: threadId } },
            data: { strangerBlocked: true, strangerBlockedAt: new Date() },
          })
          .catch((e) => logger.warn(`[send-message] set strangerBlocked failed: ${(e as Error).message}`));
        logger.info(`[send-message] KH bật chặn tin người lạ — dừng sequence riêng contact=${ctx.contactId} nick=${ctx.assignedNickId}`);
        return {
          outcome: 'failure',
          errorCode: 'STRANGER_BLOCKED',
          errorMessage: 'Khách bật chế độ không nhận tin người lạ — cần kết bạn trước mới bám đuổi được.',
          retryable: false,
        };
      }
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
        select: {
          id: true, content: true, contentType: true, sentAt: true,
          // FIX realtime: emit cần đủ field FE render (badge tự động, phân biệt self).
          senderType: true, senderName: true, sentVia: true, zaloMsgId: true,
          conversationId: true, metadata: true,
        },
      });
    } catch (err) {
      logger.error(`[send-message] persist tin ${i + 1} lỗi (Zalo đã gửi):`, err);
    }

    // FIX realtime 2026-06-15 (anh báo): EMIT 'chat:message' để cột 3 hiện tin + cột 2
    // update preview NGAY (không cần reload). Giống POST handler tin tay. Fire-and-forget:
    // emit lỗi KHÔNG được làm rớt việc gửi (tin đã sang Zalo + đã lưu DB rồi).
    //
    // CHỈ emit cho TEXT: echo text về bị message-handler suppress theo content-match (return
    // null) → emit ở đây là DUY NHẤT, không trùng. Media (image/video/file) lưu zaloMsgId
    // KHÔNG null → echo claim-placeholder trượt → echo-path tự insert + emit riêng; nếu emit
    // cả ở đây sẽ ra 2 tin. Tin bám đuổi chủ yếu là text; media để echo-path xử như cũ.
    if (lastMessageRow && persistContentType === 'text') {
      try {
        const io = zaloPool.getIO();
        await emitChatMessage({
          io,
          orgId: ctx.orgId,
          accountId: ctx.assignedNickId,
          conversationId: conversation.id,
          // zaloMsgIdNum đã serialize-safe: select không lấy BigInt → set null cho FE.
          message: { ...lastMessageRow, zaloMsgIdNum: null },
          privacyMode: conversation.zaloAccount?.privacyMode ?? 'sub',
          ownerUserId: conversation.zaloAccount?.ownerUserId ?? null,
        });
      } catch (emitErr) {
        logger.warn(`[send-message] emit realtime lỗi (tin vẫn đã gửi+lưu): ${(emitErr as Error)?.message}`);
      }
    }
    sentCount++;
    // D3 (2026-06-13): gửi media qua Block thành công → bump usageCount để sale đo ảnh/file nào
    // hiệu quả (giống gửi từ kho). Fire-and-forget, KHÔNG chặn flow. text/friend_request bỏ qua.
    for (const aid of collectMediaAssetIds(m)) {
      bumpUsage(aid).catch((e) => logger.warn(`[send-message] bumpUsage ${aid} lỗi: ${(e as Error)?.message}`));
    }
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
