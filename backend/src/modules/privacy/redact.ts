// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * redact.ts — Phase Riêng Tư 2026-05-22
 *
 * Server-side redaction helpers. Áp dụng cho mọi endpoint trả KH content/PII
 * khi viewer KHÔNG own nick main + chưa unlock PIN.
 *
 * Anh chốt Q4: avatar KH blur CHỈ ở conv nick main (conv sub vẫn hiện đầy đủ).
 * Anh chốt Q6: nick name/avatar (sale) KHÔNG blur.
 * Anh chốt: metadata (count, score, KPI aggregate) KHÔNG blur, chỉ content.
 */
import { prisma } from '../../shared/database/prisma-client.js';

const BLUR_TOKEN = '▒'.repeat(8);

export interface PrivacyContext {
  /** Current user (viewer) — null = anonymous (shouldn't happen post-auth) */
  viewerUserId: string | null;
  /** Org của viewer — REQUIRED cho cross-tenant safety (codex review P2 #5) */
  orgId: string | null;
  /** True nếu viewer đã unlock PIN trong session hiện tại */
  privacyUnlocked: boolean;
}

/**
 * Decide: viewer có quyền xem content của 1 conv không?
 * - Sub-nick conv → always show.
 * - Main-nick conv → only owner + unlocked.
 */
export function canSeeConversationContent(
  conv: { zaloAccount: { privacyMode: string; ownerUserId: string } },
  ctx: PrivacyContext,
): boolean {
  if (conv.zaloAccount.privacyMode !== 'main') return true;
  const isOwner = conv.zaloAccount.ownerUserId === ctx.viewerUserId;
  return isOwner && ctx.privacyUnlocked;
}

/**
 * Redact 1 message — CODEX REVIEW P1 FIX: allowlist response, không spread.
 * Mọi field content-bearing đều replace bằng blur. Field metadata giữ.
 *
 * Allowlist field giữ (an toàn metadata):
 *   id, conversationId, senderType, sentAt, isDeleted, deletedAt, zaloMsgId, zaloMsgIdNum
 * Field BLUR:
 *   content, originalContent, contentType, attachments, quote, senderUid, senderName
 */
export function redactMessage(
  msg: any,
  conv: { zaloAccount: { privacyMode: string; ownerUserId: string } },
  ctx: PrivacyContext,
): any {
  if (canSeeConversationContent(conv, ctx)) return msg;
  // Allowlist: chỉ giữ field metadata an toàn
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderType: msg.senderType,
    sentAt: msg.sentAt,
    isDeleted: msg.isDeleted ?? false,
    deletedAt: msg.deletedAt ?? null,
    zaloMsgId: msg.zaloMsgId ?? null,
    zaloMsgIdNum: msg.zaloMsgIdNum?.toString?.() ?? null,
    editedAt: msg.editedAt ?? null,
    reactions: msg.reactions ?? [], // count metadata only
    albumKey: msg.albumKey ?? null,
    albumIndex: msg.albumIndex ?? null,
    albumTotal: msg.albumTotal ?? null,
    // BLUR all content-bearing fields
    content: BLUR_TOKEN,
    originalContent: msg.originalContent ? BLUR_TOKEN : null,
    contentType: 'text', // hide actual contentType (image/file leaks signal)
    attachments: [],
    quote: null,
    senderUid: null,
    senderName: null,
    redacted: true,
  };
}

/**
 * Redact conversation row (list view) — main-nick: blur preview text + lastMessage.
 */
export function redactConversationRow<T extends {
  lastMessageContent?: string | null;
  unreadCount?: number;
}>(
  conv: T & { zaloAccount: { privacyMode: string; ownerUserId: string } },
  ctx: PrivacyContext,
): T & { redacted?: boolean } {
  if (canSeeConversationContent(conv, ctx)) return conv;
  return {
    ...conv,
    lastMessageContent: BLUR_TOKEN,
    // unreadCount giữ — metadata, không leak content
    redacted: true,
  } as any;
}

/**
 * Decide: viewer có quyền xem PII của 1 Contact không?
 *
 * Q4 (anh chốt): contact PII blur NẾU có ít nhất 1 friend row thuộc main-nick non-owned.
 * CODEX REVIEW P2 #5: REQUIRE orgId trong context để tenant-safe.
 */
export async function shouldRedactContactPii(
  contactId: string,
  ctx: PrivacyContext,
): Promise<boolean> {
  if (!ctx.orgId) {
    // Defensive: no org context = unsafe, default redact
    return true;
  }
  const offending = await prisma.friend.findFirst({
    where: {
      orgId: ctx.orgId,
      contactId,
      zaloAccount: {
        orgId: ctx.orgId,
        privacyMode: 'main',
        ownerUserId: ctx.viewerUserId ? { not: ctx.viewerUserId } : undefined,
      },
    },
    select: { id: true },
  });
  return !!offending;
}

/**
 * Batch: trả Set các contactId "phạm" — tức có ≥1 Friend row thuộc nick main mà
 * viewer KHÔNG phải owner-đã-unlock. Dùng cho list/search endpoint để redact PII
 * mà KHÔNG gọi shouldRedactContactPii từng contact (tránh N+1). 1 query duy nhất.
 *
 * 2026-06-11 (audit Đợt 2). Fail-closed: thiếu orgId → coi như tất cả phạm.
 */
export async function buildOffendingContactIds(
  contactIds: string[],
  ctx: PrivacyContext,
): Promise<Set<string>> {
  if (!ctx.orgId) return new Set(contactIds); // không có org context → redact hết
  if (contactIds.length === 0) return new Set();
  const rows = await prisma.friend.findMany({
    where: {
      orgId: ctx.orgId,
      contactId: { in: contactIds },
      zaloAccount: {
        orgId: ctx.orgId,
        privacyMode: 'main',
        // Owner-đã-unlock → nick của mình không "phạm". Nếu chưa unlock thì kể cả
        // nick mình cũng phạm (chưa mở khóa thì chưa xem).
        ownerUserId: ctx.privacyUnlocked && ctx.viewerUserId ? { not: ctx.viewerUserId } : undefined,
      },
    },
    select: { contactId: true },
  });
  return new Set(rows.map((r) => r.contactId).filter((id): id is string => !!id));
}

/**
 * Redact Contact (KH cấp Cha) — Anh chốt 2026-06-11 (CEO review): CHỈ tin nhắn được
 * bảo mật. Contact Cha KHÔNG chứa tin nhắn → KHÔNG che gì ở cấp Cha (tên/SĐT/email/
 * avatar = danh tính KH = tài sản công ty, luôn hiện cho người có quyền xem).
 *
 * Việc duy nhất còn lại: map friends[] qua redactFriend để PREVIEW TIN NHẮN trong
 * từng friend con (thuộc nick riêng tư) vẫn được blur. PII Cha trả NGUYÊN.
 *
 * Trước đây strip toàn bộ PII Cha (fullName=BLUR...) → over-blur, che mất danh tính
 * KH công ty cho cả sale khác. Giờ bỏ hẳn.
 */
export function redactContact(contact: any, ctx?: PrivacyContext): any {
  const friends = Array.isArray(contact.friends) && ctx
    ? contact.friends.map((f: any) =>
        f?.zaloAccount ? redactFriend(f, ctx) : f,
      )
    : (contact.friends ?? []);
  // Mở PII Cha (tên/SĐT/avatar = danh tính KH). NHƯNG preview tin nhắn ở cấp Cha được
  // aggregate từ tin nhắn friend (contact-aggregate.ts) → CÓ THỂ là tin nhắn nick riêng
  // tư → VẪN PHẢI blur (nguyên tắc: chỉ tin nhắn bảo mật). Chỉ áp khi contact "phạm"
  // (route chỉ gọi redactContact cho contact có friend nick riêng tư non-owned).
  const hasMsgPreview = contact.lastInboundPreview != null || contact.lastOutboundPreview != null;
  return {
    ...contact,
    friends,
    ...(hasMsgPreview
      ? {
          lastInboundPreview: contact.lastInboundPreview != null ? BLUR_TOKEN : contact.lastInboundPreview,
          lastOutboundPreview: contact.lastOutboundPreview != null ? BLUR_TOKEN : contact.lastOutboundPreview,
          redacted: true,
        }
      : {}),
  };
}

/**
 * Redact Friend row — Anh chốt 2026-06-11 (qua CEO review): CHỈ tin nhắn được bảo mật.
 * Tên/avatar/SĐT/UID/định danh KH LUÔN hiện (tài sản công ty, không phải bí mật cá nhân).
 * Privacy che DUY NHẤT preview tin nhắn (lastInbound/OutboundPreview) — nội dung trao đổi.
 *
 * Trước đây (audit C7/H4/H11) blur cả tên/avatar/PII → gây over-blur, che mất danh tính
 * KH công ty cho cả sale khác đang chăm. Giờ nới: chỉ giữ blur 2 preview tin nhắn.
 *
 * Fail-closed: nếu privacyMode undefined (select thiếu) → coi như main → redact preview.
 */
export function redactFriend<T extends {
  aliasInNick?: string | null;
  zaloUidInNick?: string | null;
}>(
  friend: T & { zaloAccount?: { privacyMode?: string; ownerUserId?: string | null } | null },
  ctx: PrivacyContext,
): T & { redacted?: boolean } {
  const pm = friend.zaloAccount?.privacyMode;
  // Nick 'sub' (Thường) rõ ràng → không blur. Mọi trường hợp còn lại (main HOẶC
  // undefined do select thiếu) → đi tiếp để fail-closed.
  if (pm === 'sub') return friend;
  if (pm === 'main' || pm === undefined) {
    const isOwner = !!ctx.viewerUserId && friend.zaloAccount?.ownerUserId === ctx.viewerUserId;
    if (pm === 'main' && isOwner && ctx.privacyUnlocked) return friend;
    const f = friend as any;
    // CHỈ blur PREVIEW TIN NHẮN. Tên/avatar/SĐT/UID/định danh KH + Contact PII giữ NGUYÊN.
    // Nếu không có preview nào để blur → trả friend nguyên (không gắn cờ redacted thừa).
    const hasMsgPreview = f.lastInboundPreview != null || f.lastOutboundPreview != null;
    if (!hasMsgPreview) return friend;
    return {
      ...friend,
      // Preview tin nhắn — KHÔNG để lộ nội dung trao đổi (cờ redacted → FE blur mờ qua PrivateBlur).
      lastInboundPreview: f.lastInboundPreview != null ? BLUR_TOKEN : f.lastInboundPreview,
      lastOutboundPreview: f.lastOutboundPreview != null ? BLUR_TOKEN : f.lastOutboundPreview,
      redacted: true,
    } as any;
  }
  return friend;
}

/**
 * Build PrivacyContext từ Fastify request — đọc cookie + resolve session.
 * Inject as preHandler hoặc gọi inline trong handler.
 */
export async function buildPrivacyContext(request: any): Promise<PrivacyContext> {
  const user = request.user;
  if (!user) return { viewerUserId: null, orgId: null, privacyUnlocked: false };
  const viewerUserId = user.userId ?? user.id;
  const orgId = user.orgId ?? null;

  const cookies = parseCookies(request.headers.cookie);
  const token = cookies.priv_session;
  if (!token) return { viewerUserId, orgId, privacyUnlocked: false };

  const { resolveSession } = await import('./session-service.js');
  const session = await resolveSession(token);
  return {
    viewerUserId,
    orgId,
    privacyUnlocked: !!session && session.userId === viewerUserId,
  };
}

function parseCookies(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    }),
  );
}

/** Hằng số export cho test + frontend reference */
export const PRIVACY_BLUR_TOKEN = BLUR_TOKEN;

/**
 * GUARD chống "blur ăn vào data" (anh báo 2026-06-15): tên KH bị ghi đè bằng ▒▒▒▒.
 * Privacy blur dùng ký tự ▒ (U+2592) để CHE HIỂN THỊ. Nếu giá trị đã-blur bị LƯU NGƯỢC
 * vào DB (vd UI gửi PATCH fullName = "▒▒▒▒" mà user thấy trên màn hình) → mất tên thật.
 * Mọi đường ghi fullName/crmName PHẢI gọi guard này TỪ CHỐI giá trị chứa ▒.
 *
 * @returns true nếu giá trị BỊ NHIỄM blur (chứa ≥1 ký tự ▒) → caller phải từ chối ghi.
 */
export function isBlurContaminated(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.includes('▒'); // U+2592 — ký tự blur, KHÔNG bao giờ là tên thật hợp lệ
}
