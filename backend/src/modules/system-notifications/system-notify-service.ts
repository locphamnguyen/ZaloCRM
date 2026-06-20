// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { getBullMQRedis } from '../../shared/queue/redis-connection.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { normalizePhone } from '../../shared/utils/phone.js';

// ════════════════════════════════════════════════════════════════════════
// resolveUidBySenderFindUser — NGUỒN UID DUY NHẤT, đúng góc nhìn nick gửi.
// 2026-06-10 (CEO-review): bỏ resolveBidirectionalUid (UID global/chéo nick →
// bẫy per-account UID → gửi nhầm "Song Hào"/"Văn Vỹ"). Dùng đúng cơ chế luồng
// TẠO USER bằng SĐT đã chạy đúng: nick gửi tự findUser(phone) → UID per-viewer.
//
// Verify đối chiếu tên: sau khi có UID, đối chiếu tên Zalo trả về vs tên user
// đích. Lệch hẳn → trả mismatch để caller CHẶN, không gửi liều.
// ════════════════════════════════════════════════════════════════════════

function extractUidFromFind(findResult: unknown): string | null {
  const r = findResult as Record<string, unknown> | null;
  const uid = String(r?.uid || r?.userId || '') || null;
  return uid;
}

function extractNameFromFind(findResult: unknown): string | null {
  const r = (findResult as Record<string, unknown>) || {};
  return (
    String(r.zaloName || r.zalo_name || r.displayName || r.display_name || r.name || '') || null
  );
}

/**
 * Chuẩn hóa tên để so khớp lỏng: bỏ dấu cách, lowercase, bỏ dấu tiếng Việt.
 * Dùng cho verify đối chiếu — KHÔNG để false-mismatch vì khác hoa/thường/dấu.
 */
function normalizeNameForCompare(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu
    .replace(/đ/gi, 'd')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Đối chiếu tên UID trả về vs tên user đích. Khớp nếu một bên chứa "last word"
 * của bên kia (vd "Nguyễn Văn Đức" ↔ "Văn Đức Hs Holding" → khớp qua "duc"/"vanduc").
 * Trả true = khớp (an toàn gửi), false = LỆCH (nghi nhầm người).
 */
export function nameLooksMatched(zaloName: string | null, userName: string | null): boolean {
  const a = normalizeNameForCompare(zaloName);
  const b = normalizeNameForCompare(userName);
  if (!a || !b) return false; // thiếu dữ liệu → coi như chưa verify được (không pass mù)
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // so "last word" (tên gọi) — tên VN thường gọi bằng từ cuối
  const lastWord = (s: string) => (s.trim().split(/\s+/).pop() || '');
  const la = normalizeNameForCompare(lastWord(zaloName || ''));
  const lb = normalizeNameForCompare(lastWord(userName || ''));
  if (la && lb && (a.includes(lb) || b.includes(la))) return true;
  return false;
}

export interface UidResolveOutcome {
  uid: string | null;
  zaloName: string | null;
  nameMatched: boolean;
  result: 'found' | 'no_zalo' | 'lookup_failed';
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Tìm UID của SĐT theo GÓC NHÌN nick gửi (senderId). Đây là cơ chế DUY NHẤT
 * được tin để xác định đích gửi tin nội bộ. Không dùng UID global, không chéo nick.
 *
 * @param senderId  zaloAccount.id của nick gửi thông báo hệ thống
 * @param phone     SĐT của user đích (raw, sẽ normalize)
 * @param userName  tên user đích — để verify đối chiếu (optional, có thì verify)
 */
export async function resolveUidBySenderFindUser(
  senderId: string,
  phone: string | null,
  userName?: string | null,
): Promise<UidResolveOutcome> {
  const normalized = normalizePhone(phone) || (phone ?? '');
  if (!normalized) {
    return { uid: null, zaloName: null, nameMatched: false, result: 'no_zalo', errorCode: 'NO_PHONE', errorMessage: 'User chưa có SĐT để tìm UID' };
  }
  try {
    const res = await zaloOps.findUser(senderId, normalized);
    const uid = extractUidFromFind(res);
    if (!uid) {
      return { uid: null, zaloName: null, nameMatched: false, result: 'no_zalo', errorCode: 'UID_EMPTY', errorMessage: 'SĐT không có tài khoản Zalo' };
    }
    const zaloName = extractNameFromFind(res);
    const nameMatched = userName ? nameLooksMatched(zaloName, userName) : true;
    return { uid, zaloName, nameMatched, result: 'found', errorCode: null, errorMessage: null };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return { uid: null, zaloName: null, nameMatched: false, result: 'lookup_failed', errorCode: e?.code ?? null, errorMessage: e?.message || String(err) };
  }
}

// ════════════════════════════════════════════════════════════════════════
// T8 2026-06-07 (eng-review D7): tin nội bộ KHÔNG bị rate-limit của Zalo.
// Anh chốt: gửi tới nick ĐÃ KẾT BẠN + nhóm → Zalo KHÔNG bóp (300/ngày chỉ áp
// gửi NGƯỜI LẠ). Code cũ áp nhầm checkLimits('message') cap 200/ngày → nick hệ
// thống chạm trần ngừng báo. Bỏ rate-limit, thay bằng CAP CHỐNG-SPAM: chặn burst
// LỖI (vd loop lỗi 15-20 tin/vài giây tới cùng đích) — bảo vệ nick khỏi spam tự
// gây, KHÔNG phải giới hạn nghiệp vụ.
// ════════════════════════════════════════════════════════════════════════
const ANTISPAM_WINDOW_MS = 10_000; // 10s
const ANTISPAM_MAX_IN_WINDOW = 15; // >15 tin/10s tới cùng đích = nghi spam lỗi

/**
 * Anti-spam gate: đếm số tin tới cùng (sender, thread) trong cửa sổ ngắn.
 * Trả false (chặn) nếu vượt ngưỡng — chống loop lỗi, KHÔNG phải rate-limit Zalo.
 */
async function antiSpamAllow(senderId: string, threadId: string): Promise<boolean> {
  try {
    const redis = getBullMQRedis();
    const key = `notify-antispam:${senderId}:${threadId}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, ANTISPAM_WINDOW_MS);
    }
    if (count > ANTISPAM_MAX_IN_WINDOW) {
      logger.warn(
        `[system-notify] ANTI-SPAM chặn: ${count} tin/${ANTISPAM_WINDOW_MS}ms tới thread=${threadId} (nghi loop lỗi)`,
      );
      return false;
    }
    return true;
  } catch {
    return true; // lỗi Redis → an toàn: vẫn gửi (không chặn nghiệp vụ)
  }
}

// 2026-06-04 (Anh chốt) — định dạng Zalo: styled text + urgency cờ Khẩn.
// st khớp zca-js TextStyle (b/i/u/c_*/f_*). urgency 0=Default 1=Important 2=Urgent.
export interface ZaloTextStyle {
  start: number;
  len: number;
  st: string;
}

export type RecipientStatus = 'ready' | 'missing_system_sender' | 'missing_internal_contact' | 'missing_internal_phone' | 'sender_disconnected' | 'uid_not_found' | 'lookup_failed' | 'invalid';

interface ResolveResult {
  recipient: any;
  status: RecipientStatus;
  senderZaloAccountId: string | null;
  internalContactZaloAccountId: string | null;
  conversationId: string | null;
  threadIdInSenderView: string | null;
  error: string | null;
}

interface SendToUserInput {
  orgId: string;
  targetUserId: string;
  type: string;
  title: string;
  content: string;
  priority?: 'low' | 'normal' | 'high';
  // 2026-06-04 — khi có styles: content ĐÃ chứa tiêu đề ở dòng đầu (StyleBuilder),
  // KHÔNG ghép title nữa (tránh lặp). urgency đẩy cờ Khẩn native Zalo.
  styles?: ZaloTextStyle[];
  urgency?: 0 | 1 | 2;
  // T8 2026-06-07 (D7): đích nhận — 'user' (1-1, mặc định) | 'group' (nhóm Zalo).
  // Gửi nhóm = sendMessage(threadId, threadType=1). SDK đã support (4 chỗ code dùng).
  recipientType?: 'user' | 'group';
}

function extractZaloMsgId(sendResult: unknown): string | null {
  const sr = sendResult as { message?: { msgId?: number | string } | null; attachment?: Array<{ msgId?: number | string }> };
  const rawId = sr?.message?.msgId ?? sr?.attachment?.[0]?.msgId ?? null;
  return rawId == null || rawId === '' ? null : String(rawId);
}

function buildMessage(
  title: string,
  content: string,
  priority: string,
  hasStyles: boolean,
) {
  // 2026-06-04 — khi có styles, content ĐÃ chứa tiêu đề (StyleBuilder dòng đầu) →
  // gửi content nguyên vẹn. KHÔNG thêm prefix [KHẨN] (urgency đã đẩy cờ Khẩn native,
  // và title styled đã đỏ/đậm) → fix bug "[KHẨN] [KHẨN]" lặp 2 lần.
  if (hasStyles) return content.trim();
  // Path cũ (no-zalo / send-error text thuần): giữ prefix [KHẨN] cho high.
  const prefix = priority === 'high' ? '[KHẨN] ' : '';
  return `${prefix}${title}\n${content}`.trim();
}

export async function resolveSystemNotifyRecipient(orgId: string, targetUserId: string): Promise<ResolveResult> {
  const [org, targetUser] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { systemNotifyZaloAccountId: true },
    }),
    prisma.user.findFirst({
      where: { id: targetUserId, orgId },
      select: { id: true, phone: true, internalContactZaloAccountId: true },
    }),
  ]);

  const senderId = org?.systemNotifyZaloAccountId ?? null;
  const internalId = targetUser?.internalContactZaloAccountId ?? null;
  let status: RecipientStatus = 'invalid';
  let error: string | null = null;
  let conversationId: string | null = null;
  let threadIdInSenderView: string | null = null;
  let existingRecipient: { threadIdInSenderView: string | null; conversationId: string | null } | null = null;

  if (senderId) {
    existingRecipient = await prisma.systemNotifyRecipient.findUnique({
      where: { targetUserId_senderZaloAccountId: { targetUserId, senderZaloAccountId: senderId } },
      select: { threadIdInSenderView: true, conversationId: true },
    });
    threadIdInSenderView = existingRecipient?.threadIdInSenderView ?? null;
    conversationId = existingRecipient?.conversationId ?? null;
  }

  // 2026-06-10 (CEO-review): status theo cơ chế MỚI — dựa trên ĐÃ CÓ UID
  // (threadIdInSenderView, từ luồng tạo user / Check Live) chứ KHÔNG dựa "đã chọn
  // nick nội bộ" (cơ chế cũ đã bỏ). targetUser.phone là SĐT để Check Live.
  if (!targetUser) {
    error = 'User không tồn tại trong org';
  } else if (!senderId) {
    status = 'missing_system_sender';
    error = 'Org chưa chọn nick gửi thông báo hệ thống';
  } else {
    const sender = await prisma.zaloAccount.findFirst({
      where: { id: senderId, orgId },
      select: { id: true, status: true },
    });

    if (!sender) {
      status = 'missing_system_sender';
      error = 'Nick gửi hệ thống không tồn tại trong org';
    } else if (!threadIdInSenderView) {
      // Chưa có UID — phân biệt do thiếu SĐT hay chưa Check Live
      status = targetUser.phone ? 'missing_internal_contact' : 'missing_internal_phone';
      error = targetUser.phone
        ? 'Chưa Check Live để tìm UID (bấm "Check Live" hoặc "Check hàng loạt")'
        : 'Nhân viên chưa có SĐT để tìm UID';
    } else if (sender.status !== 'connected') {
      status = 'sender_disconnected';
      error = 'Nick gửi hệ thống đang offline';
    } else {
      status = 'ready';
      error = null;
    }
  }

  const recipient = await prisma.systemNotifyRecipient.upsert({
    where: {
      targetUserId_senderZaloAccountId: {
        targetUserId,
        senderZaloAccountId: senderId ?? '',
      },
    },
    create: {
      id: randomUUID(),
      orgId,
      targetUserId,
      senderZaloAccountId: senderId,
      internalContactZaloAccountId: internalId,
      conversationId,
      threadIdInSenderView,
      status,
      error,
      lastVerifiedAt: new Date(),
    },
    update: {
      internalContactZaloAccountId: internalId,
      conversationId,
      threadIdInSenderView,
      status,
      error,
      lastVerifiedAt: new Date(),
    },
  });

  return { recipient, status, senderZaloAccountId: senderId, internalContactZaloAccountId: internalId, conversationId, threadIdInSenderView, error };
}

export async function sendSystemNotificationToUser(input: SendToUserInput) {
  const priority = input.priority ?? 'normal';
  const resolved = await resolveSystemNotifyRecipient(input.orgId, input.targetUserId);
  const notification = await prisma.systemNotification.create({
    data: {
      id: randomUUID(),
      orgId: input.orgId,
      type: input.type,
      title: input.title,
      content: input.content,
      priority,
      senderZaloAccountId: resolved.senderZaloAccountId,
      targetUserId: input.targetUserId,
      internalContactZaloAccountId: resolved.internalContactZaloAccountId,
      recipientId: resolved.recipient.id,
      conversationId: resolved.conversationId,
      channel: resolved.status === 'ready' ? 'zalo' : 'crm_panel',
      status: 'pending',
      error: resolved.error,
    },
  });

  if (resolved.status !== 'ready' || !resolved.senderZaloAccountId || !resolved.threadIdInSenderView) {
    return prisma.systemNotification.update({
      where: { id: notification.id },
      data: { status: 'failed', channel: 'crm_panel', error: resolved.error ?? 'Recipient chưa sẵn sàng' },
    });
  }

  // T8 2026-06-07 (D7): tin nội bộ tới nick ĐÃ KẾT BẠN/nhóm KHÔNG bị Zalo bóp →
  // BỎ checkLimits('message') (cap 200/ngày sai bản chất). Thay bằng anti-spam gate
  // chống loop lỗi (burst >15 tin/10s cùng đích).
  const spamOk = await antiSpamAllow(resolved.senderZaloAccountId, resolved.threadIdInSenderView);
  if (!spamOk) {
    return prisma.systemNotification.update({
      where: { id: notification.id },
      data: { status: 'failed', channel: 'crm_panel', error: 'Anti-spam: quá nhiều tin tới cùng đích trong 10s' },
    });
  }

  try {
    const api = zaloPool.getApi(resolved.senderZaloAccountId);
    if (!api) throw new Error('Nick gửi hệ thống chưa connected trong Zalo pool');

    const hasStyles = Array.isArray(input.styles) && input.styles.length > 0;
    const msg = buildMessage(input.title, input.content, priority, hasStyles);
    // 2026-06-04 — payload Zalo: styles (định dạng chữ) + urgency (cờ Khẩn).
    // zca-js nhận MessageContent { msg, styles?, urgency? }. Cast cục bộ để khỏi
    // import enum zca-js (giá trị st/urgency đã khớp 1:1).
    const messageContent: Record<string, unknown> = { msg };
    if (hasStyles) messageContent.styles = input.styles;
    if (input.urgency && input.urgency > 0) messageContent.urgency = input.urgency;
    // T8: threadType 0=user (mặc định) | 1=group. SDK đã support (zalo-operations.ts:243).
    const threadType = input.recipientType === 'group' ? 1 : 0;
    const sendResult = await api.sendMessage(
      messageContent as Parameters<typeof api.sendMessage>[0],
      resolved.threadIdInSenderView,
      threadType,
    );
    const zaloMsgId = extractZaloMsgId(sendResult);
    const now = new Date();

    let conversationId = resolved.conversationId;
    if (!conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: { orgId: input.orgId, zaloAccountId: resolved.senderZaloAccountId, externalThreadId: resolved.threadIdInSenderView, threadType: 'user' },
        select: { id: true },
      });
      conversationId = conversation?.id ?? null;
    }

    if (conversationId) {
      await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId,
          zaloMsgId,
          zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
          senderType: 'self',
          senderUid: resolved.senderZaloAccountId,
          senderName: 'System',
          content: msg,
          contentType: 'text',
          sentAt: now,
          sentVia: 'system',
        },
      });
      await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now, isReplied: true } });
    }

    return prisma.systemNotification.update({
      where: { id: notification.id },
      data: { status: 'sent', channel: 'zalo', zaloMsgId, conversationId, sentAt: now, error: null },
    });
  } catch (err: any) {
    logger.warn(`[system-notify] send failed target=${input.targetUserId}: ${err?.message || err}`);
    return prisma.systemNotification.update({
      where: { id: notification.id },
      data: { status: 'failed', channel: 'crm_panel', error: err?.message || String(err) },
    });
  }
}
