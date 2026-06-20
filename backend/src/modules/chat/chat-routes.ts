// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { DISPLAYABLE_NICK_WHERE } from '../zalo/zalo-scope.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { emitChatMessage } from '../../shared/realtime/emit-chat.js';
import { applyContactAggregateFromMessage, applyFriendAggregate } from '../contacts/contact-aggregate.js';
import { normalizePhone } from '../../shared/utils/phone.js';
// M53 2026-05-30 — AI Trợ Lý cho Virtual Chat (KH no-Zalo)
import { triggerVirtualChatAiReply } from '../ai/ai-virtual-chat-service.js';
// M55 2026-05-30 — Auto-attach collaborator khi sale gửi tin virtual conv
import { attachContactCollaboratorByUser } from '../contacts/contact-scope.js';
// Fix 2026-06-03 — M11 optimistic badge cache (Anh báo "Sale CRM · Staff")
import { getUserFullName } from './chat-helpers.js';
// 2026-06-07 — Gửi Khối Marketing thẳng vào hội thoại (cột 4 tab Automation).
import { zaloOps } from '../../shared/zalo-operations.js';
import { sendNativeVideo } from '../../shared/video-processor.js';
import { downloadMediaToTemp, extractZaloMsgId } from './chat-media-helpers.js';
import { resolveBlockContent } from '../../shared/ee-registry/automation.js';
import { renderTemplate, renderTemplateDetailed, shiftStylesForRender } from '../../shared/ee-registry/automation.js';
// GĐ Block-media (2026-06-13): D4 vá tên file dùng chung; D3 bump usageCount khi gửi media qua Block.
import { buildSendFileName } from '../media/media-routes.js';
import { bumpUsage } from '../media/media-service.js';
import { getOwnerScope } from '../rbac/owner-scope.js';
import { blockVisibilityWhere } from '../../shared/ee-registry/automation.js';

type QueryParams = Record<string, string>;

// 2026-06-13: media gửi từ Block thường chỉ có url+mediaAssetId, THIẾU tên/mime/size. Truy Kho
// qua mediaAssetId lấy đủ → Zalo + CRM hiện đúng. Trả {} nếu không có id/không tìm thấy.
// (CRM message-bubble.vue getFileInfo CẦN đủ name+href+size(number)+mime!=rỗng+!image → mới
//  hiện file-card; thiếu mime rỗng → rơi về text '🔗 url'. Vậy mime/size phải có thật.)
async function resolveMediaMeta(
  mediaAssetId: string | undefined,
  fallback: { filename?: string; mimeType?: string; sizeBytes?: number },
): Promise<{ name: string; mime: string; size: number }> {
  let name = (fallback.filename ?? '').trim();
  let mime = (fallback.mimeType ?? '').trim();
  let size = fallback.sizeBytes ?? 0;
  if ((!name || !mime || !size) && mediaAssetId) {
    try {
      const a = await prisma.mediaAsset.findUnique({
        where: { id: mediaAssetId },
        select: { originalFilename: true, name: true, blobs: { where: { variantType: 'original' }, take: 1, select: { mimeType: true, sizeBytes: true } } },
      });
      if (a) {
        if (!name) name = (a.originalFilename || a.name || '').trim();
        if (!mime) mime = (a.blobs[0]?.mimeType || '').trim();
        if (!size) size = a.blobs[0]?.sizeBytes ?? 0;
      }
    } catch { /* giữ fallback */ }
  }
  return { name, mime, size };
}

function mapReplyMsgType(contentType: string): string {
  if (contentType === 'text') return 'webchat';
  if (contentType === 'image') return 'photo';
  if (contentType === 'file') return 'file';
  if (contentType === 'video') return 'video';
  if (contentType === 'voice') return 'voice';
  if (contentType === 'sticker') return 'sticker';
  if (contentType === 'gif') return 'gif';
  if (contentType === 'link') return 'link';
  if (contentType === 'location') return 'location';
  if (contentType === 'contact_card') return 'card';
  if (contentType === 'bank_transfer') return 'bank';
  if (contentType === 'call') return 'call';
  if (contentType === 'qr_code') return 'qr';
  if (contentType === 'reminder') return 'remind';
  if (contentType === 'poll') return 'poll';
  if (contentType === 'note') return 'note';
  if (contentType === 'forwarded') return 'forward';
  return contentType;
}

function buildReplyQuote(message: {
  zaloMsgId: string | null;
  senderUid: string | null;
  content: string | null;
  contentType: string;
  sentAt: Date;
}) {
  if (!message.zaloMsgId || !message.senderUid) return null;
  let quoteContent = message.content ?? '';
  if (['image', 'video', 'file'].includes(message.contentType) && quoteContent.startsWith('{')) {
    try {
      const p = JSON.parse(quoteContent);
      if (message.contentType === 'image') quoteContent = '[Hình ảnh]';
      else if (message.contentType === 'video') quoteContent = '[Video]';
      else quoteContent = `[Tệp] ${p.name || ''}`.trim();
    } catch {
      quoteContent = `[${message.contentType}]`;
    }
  }
  return {
    content: quoteContent,
    msgType: mapReplyMsgType(message.contentType),
    propertyExt: {},
    uidFrom: message.senderUid,
    msgId: message.zaloMsgId,
    cliMsgId: message.zaloMsgId,
    ts: String(message.sentAt.getTime()),
    ttl: 0,
  };
}

// Cooldown cho POST /conversations/:id/touch-profile — tránh spam Zalo SDK.
// Profile (gender / phone / birthday) hiếm đổi → 5min cooldown đủ.
const profileTouchCooldown = new Map<string, number>();
const PROFILE_TOUCH_COOLDOWN_MS = 5 * 60_000;

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── Conversation filter counts (unread, unreplied, total) ───────────────
  // NOTE: Must be registered BEFORE /api/v1/conversations/:id to avoid route conflict
  app.get('/api/v1/conversations/counts', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { accountId = '', tab = '', threadType = '' } = request.query as QueryParams;

    // T5-A (YC2): nick đã XÓA-có-uid vẫn hiện hội thoại (đọc-only) → DISPLAYABLE thay archivedAt:null.
    const baseWhere: any = { orgId: user.orgId, deletedAt: null, zaloAccount: DISPLAYABLE_NICK_WHERE };
    if (accountId) baseWhere.zaloAccountId = accountId;
    if (tab) baseWhere.tab = tab;
    // 2026-06-11 — đếm theo cùng key tab như list: Cá nhân/Nhóm (threadType) loại
    // trừ hội thoại đã chuyển sang Ưu tiên (tab=other) → mặc định tab=main nếu
    // không truyền tab. Sidebar cột 1 + mini-count cột 2 đồng bộ con số theo tab.
    if (threadType === 'user' || threadType === 'group') {
      baseWhere.threadType = threadType;
      if (!tab) baseWhere.tab = 'main';
    }

    // Phase Contact Scope Hybrid 2026-05-27: scope qua getZaloScope (gỡ legacy
    // 'role===member' bypass — user legacy admin nhưng RBAC group Sale vẫn bị scope).
    const { getZaloScope } = await import('../zalo/zalo-scope.js');
    const zScope = await getZaloScope(user.id, user.orgId, user.role);
    if (!zScope.isOrgAdmin) {
      // T6-consumer (YC2): XEM dùng displayableIds (gồm nick xóa-có-uid đọc-only).
      const displayableIds = zScope.displayableIds;
      if (accountId && displayableIds.includes(accountId)) {
        baseWhere.zaloAccountId = accountId;
      } else {
        baseWhere.zaloAccountId = { in: displayableIds };
      }
    }

    // otherUnread: số hội thoại CHƯA ĐỌC trong tab Ưu tiên (tab=other) — KHÔNG phụ
    // thuộc tab/threadType đang chọn (tab Ưu tiên cần biết badge đậm dù đang ở tab
    // khác). Tái dùng scope zalo ở baseWhere (org + accessible nicks), bỏ tab/threadType.
    const otherScopeWhere: any = { orgId: user.orgId, deletedAt: null, tab: 'other', unreadCount: { gt: 0 } };
    if (baseWhere.zaloAccountId) otherScopeWhere.zaloAccountId = baseWhere.zaloAccountId;

    const [unread, unreplied, total, otherUnread] = await Promise.all([
      prisma.conversation.count({ where: { ...baseWhere, unreadCount: { gt: 0 } } }),
      prisma.conversation.count({ where: { ...baseWhere, isReplied: false } }),
      prisma.conversation.count({ where: baseWhere }),
      prisma.conversation.count({ where: otherScopeWhere }),
    ]);

    return { unread, unreplied, total, otherUnread };
  });

  // ── Event counts cho badge cột 1 (sinh nhật 7d / hẹn 24h / quá hạn) ──────
  // 2026-06-08 (anh chốt) — badge đếm THẬT thay hardcode 0. Đếm số KH (Contact)
  // distinct, scope org + zalo access. Phải đăng ký TRƯỚC /conversations/:id.
  app.get('/api/v1/conversations/event-counts', async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.user!;
    const { folderId = '', accountId = '', tab = '', threadType = '' } = request.query as QueryParams;

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // 2026-06-11 (anh chốt) — badge cột 1 đếm theo CÙNG key tab đang chọn.
    //   tab Cá nhân/Chính/Ưu tiên → lọc các con số theo hộp tương ứng.
    //   tab Nhóm (threadType=group) → 3 badge "Tin nhắn" (chưa rep/bot/sale) VÔ NGHĨA
    //     (nhóm không có "sale đã trả lời") → FE ẩn, BE trả 0 cho chắc.
    // Dịch sang bộ lọc Conversation: Cá nhân/Nhóm = threadType + (mặc định tab=main);
    // Chính/Ưu tiên = tab. Birthday/Lịch hẹn: đếm Contact CÓ hội thoại khớp bộ lọc này.
    const isGroupTab = threadType === 'group';
    // Điều kiện tab áp lên alias cv (conversations) trong raw SQL.
    let convTabSql = Prisma.empty;
    if (tab === 'main' || tab === 'other') {
      convTabSql = Prisma.sql`AND cv.tab = ${tab}`;
    } else if (threadType === 'user' || threadType === 'group') {
      // Cá nhân/Nhóm: loại trừ Ưu tiên (tab=other), giữ hộp Chính.
      convTabSql = Prisma.sql`AND cv."threadType" = ${threadType} AND cv.tab = 'main'`;
    }

    // FIX 2026-06-09 (Anh báo): badge "Tin nhắn" (chưa trả lời / bot / sale đã trả lời)
    // PHẢI thỏa CẢ 2 tầng (khớp logic sidebar-tags):
    //   Tầng 1 — getZaloScope: nick user ĐƯỢC QUYỀN xem.
    //   Tầng 2 — Phạm vi xem (picker): folderId / accountId user đang chọn trên màn hình.
    // Phạm vi xem GIAO với quyền. Trước đây chỉ lọc org_id → user 1 nick vẫn đếm
    // tin TOÀN org (246/96 ảo); và bỏ qua picker → chọn 1 nick vẫn ra cả scope.
    const { getZaloScope } = await import('../zalo/zalo-scope.js');
    const zScope = await getZaloScope(user.id, user.orgId, user.role);

    // 1) Phạm vi xem từ picker: folder → members; accountId → 1 nick; else → null (mọi nick).
    let scopedAccountIds: string[] | null = null;
    if (folderId) {
      const folder = await prisma.accountFolder.findUnique({
        where: { id: folderId },
        include: { members: { select: { zaloAccountId: true } } },
      });
      scopedAccountIds = folder && folder.userId === user.id
        ? folder.members.map((m) => m.zaloAccountId)
        : []; // folder không thuộc user → rỗng
    } else if (accountId) {
      scopedAccountIds = [accountId];
    }

    // 2) Giao phạm vi xem với quyền (getZaloScope). Ra danh sách nick cuối cùng.
    //    null = "mọi nick"; với admin + mọi nick → không giới hạn (effective rỗng + flag).
    let effectiveAccountIds: string[];
    if (scopedAccountIds !== null) {
      effectiveAccountIds = zScope.isOrgAdmin
        ? scopedAccountIds
        : scopedAccountIds.filter((id) => zScope.accessibleIds.includes(id));
    } else {
      effectiveAccountIds = zScope.isOrgAdmin ? [] : zScope.accessibleIds;
    }
    const noNickRestriction = scopedAccountIds === null && zScope.isOrgAdmin;

    // 3) Dựng điều kiện SQL: admin+mọi-nick → không lọc; có danh sách → IN; rỗng → FALSE (đếm 0).
    const nickScopeSql =
      noNickRestriction
        ? Prisma.empty
        : effectiveAccountIds.length > 0
          ? Prisma.sql`AND cv.zalo_account_id IN (${Prisma.join(effectiveAccountIds)})`
          : Prisma.sql`AND FALSE`;

    const [birthdayRows, apptSoonRows, apptOverdueRows, replyStateRows] = await Promise.all([
      // Sinh nhật 7 ngày tới — so ngày/tháng (bỏ năm, wrap qua năm mới).
      // 2026-06-11 — đếm Contact DISTINCT CÓ hội thoại khớp tab + nick scope đang xem
      // (trước đây đếm toàn org, không theo tab). EXISTS join conversations cv.
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(DISTINCT ct.id)::bigint AS n
        FROM contacts ct
        JOIN conversations cv ON cv.contact_id = ct.id AND cv.deleted_at IS NULL
        WHERE ct.org_id = ${user.orgId}
          AND ct.birth_date IS NOT NULL
          AND to_char(ct.birth_date, 'MM-DD') = ANY (
            SELECT to_char(generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '7 day', INTERVAL '1 day'), 'MM-DD')
          )
          ${convTabSql}
          ${nickScopeSql}
      `,
      // Lịch hẹn scheduled trong 24h tới (distinct Contact, theo tab + nick scope).
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(DISTINCT ct.id)::bigint AS n
        FROM contacts ct
        JOIN conversations cv ON cv.contact_id = ct.id AND cv.deleted_at IS NULL
        JOIN appointments ap ON ap.contact_id = ct.id
        WHERE ct.org_id = ${user.orgId}
          AND ap.status = 'scheduled'
          AND ap.appointment_date >= ${now} AND ap.appointment_date <= ${in24h}
          ${convTabSql}
          ${nickScopeSql}
      `,
      // Hẹn scheduled đã quá giờ (distinct Contact, theo tab + nick scope).
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(DISTINCT ct.id)::bigint AS n
        FROM contacts ct
        JOIN conversations cv ON cv.contact_id = ct.id AND cv.deleted_at IS NULL
        JOIN appointments ap ON ap.contact_id = ct.id
        WHERE ct.org_id = ${user.orgId}
          AND ap.status = 'scheduled'
          AND ap.appointment_date < ${now}
          ${convTabSql}
          ${nickScopeSql}
      `,
      // 2026-06-09 — Badge đếm nhóm "Tin nhắn" (user vs bot). Chỉ 1-1 (threadType='user').
      // Mốc khách nhắn cuối tính PER-CONVERSATION từ messages (KHÔNG dùng Contact.lastInboundAt
      // — aggregate cross-nick gây sai khi 1 KH nhiều nick). Khớp 100% logic filter ở GET list.
      //   unanswered  = không có tin self nào sau mốc khách cuối
      //   sale_replied= có tin sale thật sau mốc khách cuối
      //   bot_no_sale = có tin self sau mốc nhưng không có sale thật → chỉ bot
      // 3 badge "Tin nhắn" chỉ có nghĩa với chat 1-1 → ở tab Nhóm trả 0 (FE cũng ẩn).
      // Tab Cá nhân/Chính/Ưu tiên: lọc theo convTabSql (đã gồm threadType=user khi cần).
      isGroupTab
        ? Promise.resolve([{ unanswered: 0n, sale_replied: 0n, bot_no_sale: 0n }])
        : prisma.$queryRaw<Array<{ unanswered: bigint; sale_replied: bigint; bot_no_sale: bigint }>>`
        SELECT
          COUNT(*) FILTER (WHERE agg.last_self IS NULL OR agg.last_self < agg.last_inbound)::bigint AS unanswered,
          COUNT(*) FILTER (WHERE agg.last_sale IS NOT NULL AND agg.last_sale >= agg.last_inbound)::bigint AS sale_replied,
          COUNT(*) FILTER (
            WHERE agg.last_self IS NOT NULL AND agg.last_self >= agg.last_inbound
              AND (agg.last_sale IS NULL OR agg.last_sale < agg.last_inbound)
          )::bigint AS bot_no_sale
        FROM conversations cv
        JOIN LATERAL (
          SELECT MAX(m.sent_at) FILTER (WHERE m.sender_type = 'contact') AS last_inbound,
                 MAX(m.sent_at) FILTER (
                   WHERE m.sender_type = 'self' AND m.sent_via IN ('user','user_native')
                 ) AS last_sale,
                 MAX(m.sent_at) FILTER (WHERE m.sender_type = 'self') AS last_self
          FROM messages m WHERE m.conversation_id = cv.id
        ) agg ON TRUE
        WHERE cv.org_id = ${user.orgId}
          AND cv."threadType" = 'user'
          AND cv.deleted_at IS NULL
          AND agg.last_inbound IS NOT NULL
          ${tab === 'other' ? Prisma.sql`AND cv.tab = 'other'` : Prisma.sql`AND cv.tab = 'main'`}
          ${nickScopeSql}
      `,
    ]);

    return {
      birthday: Number(birthdayRows[0]?.n ?? 0),
      appointmentSoon: Number(apptSoonRows[0]?.n ?? 0),
      appointmentOverdue: Number(apptOverdueRows[0]?.n ?? 0),
      // Nhóm "Tin nhắn" (0 khi tab Nhóm)
      msgUnanswered: Number(replyStateRows[0]?.unanswered ?? 0),
      msgBotNoSale: Number(replyStateRows[0]?.bot_no_sale ?? 0),
      msgSaleReplied: Number(replyStateRows[0]?.sale_replied ?? 0),
    };
  });

  // ── Sidebar tags theo Phạm vi xem (anh chốt 2026-06-09) ─────────────────
  // crmTags = tag CRM đang DÙNG THẬT ở Friend.crmTagsPerNick (per-nick), distinct.
  // zaloTags = ZaloLabel của các nick trong scope (ALL / folder / 1 nick).
  // Scope nick: folderId → members; accountId → 1 nick; else → mọi nick accessible.
  // Phải đăng ký TRƯỚC /conversations/:id.
  app.get('/api/v1/conversations/sidebar-tags', async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.user!;
    const { folderId = '', accountId = '' } = request.query as QueryParams;
    // 2026-06-20 (anh báo: tag cột 2 phải theo PHẠM VI XEM cột 1, không lấy toàn hệ thống):
    // nhận danh sách nick đang xem (accountIds=csv) → chỉ gom tag của các nick đó.
    const accountIdsCsv = String((request.query as { accountIds?: string }).accountIds ?? '');

    // 1) Resolve danh sách zaloAccountId theo scope.
    let scopedAccountIds: string[] | null = null; // null = mọi nick accessible
    if (folderId) {
      const folder = await prisma.accountFolder.findUnique({
        where: { id: folderId },
        include: { members: { select: { zaloAccountId: true } } },
      });
      if (folder && folder.userId === user.id) {
        scopedAccountIds = folder.members.map((m) => m.zaloAccountId);
      } else {
        scopedAccountIds = []; // folder không thuộc user → rỗng
      }
    } else if (accountIdsCsv) {
      scopedAccountIds = accountIdsCsv.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (accountId) {
      scopedAccountIds = [accountId];
    }

    // 2) Áp zalo access scope (sale chỉ thấy nick mình được cấp).
    const { getZaloScope } = await import('../zalo/zalo-scope.js');
    const zScope = await getZaloScope(user.id, user.orgId, user.role);
    let effectiveAccountIds: string[];
    if (scopedAccountIds !== null) {
      effectiveAccountIds = zScope.isOrgAdmin
        ? scopedAccountIds
        : scopedAccountIds.filter((id) => zScope.accessibleIds.includes(id));
    } else {
      effectiveAccountIds = zScope.isOrgAdmin ? [] : zScope.accessibleIds; // [] = không giới hạn (admin)
    }
    // Admin + ALL → effectiveAccountIds rỗng nghĩa là "mọi nick" (không filter theo account).
    const restrictByAccount = !(scopedAccountIds === null && zScope.isOrgAdmin);

    // 3) crmTags — distinct Friend.crmTagsPerNick của các nick trong scope.
    const friendWhere: any = { orgId: user.orgId };
    if (restrictByAccount) {
      friendWhere.zaloAccountId = effectiveAccountIds.length > 0 ? { in: effectiveAccountIds } : 'NO_MATCH';
    }
    const friends = await prisma.friend.findMany({
      where: friendWhere,
      select: { crmTagsPerNick: true },
    });
    const crmTagSet = new Map<string, string>(); // cleanName → cleanName (dedup)
    for (const f of friends) {
      const arr = Array.isArray(f.crmTagsPerNick) ? (f.crmTagsPerNick as string[]) : [];
      for (const raw of arr) {
        if (typeof raw !== 'string' || !raw.trim()) continue;
        const clean = raw.startsWith('🔵 ') ? raw.slice(3) : raw; // strip mirror prefix
        crmTagSet.set(clean, clean);
      }
    }
    const crmTags = [...crmTagSet.keys()].sort((a, b) => a.localeCompare(b, 'vi'));

    // 4) zaloTags — ZaloLabel của các nick trong scope, distinct theo text (giữ màu đầu tiên).
    const labelWhere: any = { orgId: user.orgId };
    if (restrictByAccount) {
      labelWhere.zaloAccountId = effectiveAccountIds.length > 0 ? { in: effectiveAccountIds } : 'NO_MATCH';
    }
    const labels = await prisma.zaloLabel.findMany({
      where: labelWhere,
      select: { text: true, color: true, emoji: true },
      orderBy: { offset: 'asc' },
    });
    const zaloTagMap = new Map<string, { name: string; color: string; emoji: string | null }>();
    for (const l of labels) {
      const name = (l.text || '').trim();
      if (!name) continue;
      if (!zaloTagMap.has(name)) zaloTagMap.set(name, { name, color: l.color, emoji: l.emoji });
    }
    const zaloTags = [...zaloTagMap.values()];

    return { crmTags, zaloTags };
  });

  // ── List conversations (paginated, filterable) ──────────────────────────
  app.get('/api/v1/conversations', { preHandler: requireGrant('conversation', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const {
      page = '1',
      limit = '50',
      search = '',
      accountId = '',          // single — backward compat
      accountIds = '',          // CSV — multi-nick support (preferred)
      // Filter params
      unread = '',
      unreplied = '',
      from = '',
      to = '',
      dateFrom = '',            // alias cho FilterRail
      dateTo = '',
      tags = '',
      tab = '',
      threadType = '',          // user | group
      // Mới — Contact level
      statusId = '',
      assignedUserId = '',
      hasZalo = '',             // true | false | unknown
      scoreMin = '',
      scoreMax = '',
      // Mới — Friend level (per-pair aggregate)
      relationshipKindAny = '', // CSV: friend,pending_friend,chatting_stranger,ghost
      // Phase 6+ — Inbox Triage Filter params
      folderId = '',            // AccountFolder ID — translate sang accountIds
      sortMode = '',            // 'unread-first' | 'recent' (default recent)
      autoTagsAny = '',         // CSV: active,stuck,cold,ready,atrisk,rewarmed,frozen
      stuck = '',               // 'true' → friends.some.stuckSince != null
      ready = '',               // 'true' → score >= 80
      zaloLabels = '',          // CSV: filter by Zalo Real labels
      engagementPattern = '',   // Phase 8 — CSV: hot,champion,stable,cooling,cold
      // 2026-06-08 — Cột 1 sidebar deep filter (trước đây BE bỏ qua → "nút chết").
      stages = '',              // CSV statusId: lọc theo Trạng thái KH (Status table)
      stuckDuration = '',       // '>3d'|'>7d'|'>14d'|'>30d' → Friend.stuckSince cũ hơn ngưỡng
      lastMessageWithin = '',   // '24h'|'7d'|'30d'|'>30d' → Conversation.lastMessageAt
      customerWaitingReply = '',// 'true' → KH nhắn sau cùng (lastInboundAt > lastOutboundAt)
      saleWaitingReply = '',    // 'true' → Sale nhắn sau cùng (lastOutboundAt >= lastInboundAt)
      birthdayWithin7d = '',    // 'true' → Contact.birthDate rơi vào 7 ngày tới (theo ngày/tháng)
      appointmentWithin24h = '',// 'true' → có Appointment scheduled trong 24h tới
      appointmentOverdue = '',  // 'true' → có Appointment scheduled đã quá giờ
      // 2026-06-09 (anh chốt) — Nhóm lọc "Tin nhắn" (user vs bot), radio 1-of-3.
      // Xét TỪ LƯỢT KHÁCH NHẮN CUỐI (Contact.lastInboundAt) trở đi:
      //   'unanswered'  → tin cuối là khách, chưa ai (cả bot) trả lời (= isReplied=false)
      //   'bot_no_sale' → sau lastInboundAt CHỈ có bot, KHÔNG có tin sale thật
      //   'sale_replied'→ có tin sale thật (self + user/user_native) sau lastInboundAt
      messageReplyState = '',
    } = request.query as QueryParams;

    // T5-A (YC2): hội thoại nick đã XÓA-có-uid hiện lại (đọc-only) → DISPLAYABLE thay archivedAt:null.
    const where: any = { orgId: user.orgId, deletedAt: null, zaloAccount: DISPLAYABLE_NICK_WHERE };
    if (tab) where.tab = tab;
    if (threadType === 'user' || threadType === 'group') {
      where.threadType = threadType;
      // 2026-06-11 — Loại trừ lẫn nhau với tab "Ưu tiên" (tab=other): tab Cá nhân /
      // Nhóm CHỈ hiện hội thoại ở hộp Chính (tab=main). Hội thoại đã chuyển sang
      // Ưu tiên không còn xuất hiện ở Cá nhân/Nhóm nữa (anh chốt). Nếu FE gửi kèm
      // tab riêng thì tôn trọng tab đó (không ép).
      if (!tab) where.tab = 'main';
    }

    // Phase 6+ — folderId translate sang accountIds (override accountId/accountIds nếu set)
    let folderAccountIds: string[] | null = null;
    if (folderId) {
      const folder = await prisma.accountFolder.findUnique({
        where: { id: folderId },
        include: { members: { select: { zaloAccountId: true } } },
      });
      if (folder && folder.userId === user.id) {
        folderAccountIds = folder.members.map((m) => m.zaloAccountId);
      }
    }

    // accountIds CSV ưu tiên hơn accountId single (multi-nick FE).
    // folderAccountIds (Phase 6+ folder filter) override nếu có.
    let accountIdList: string[] = [];
    if (folderAccountIds !== null) {
      accountIdList = folderAccountIds;
    } else {
      accountIdList = accountIds
        ? accountIds.split(',').map(s => s.trim()).filter(Boolean)
        : accountId ? [accountId] : [];
    }
    if (accountIdList.length === 1) where.zaloAccountId = accountIdList[0];
    else if (accountIdList.length > 1) where.zaloAccountId = { in: accountIdList };
    else if (folderAccountIds !== null && folderAccountIds.length === 0) {
      // Folder rỗng (chưa add nick nào) → return empty list
      where.zaloAccountId = 'EMPTY_FOLDER_NO_MATCH';
    }

    // Contact-level filter — gộp vào where.contact nested
    const contactWhere: Record<string, unknown> = {};
    if (search) {
      contactWhere.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { crmName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }
    if (statusId) contactWhere.statusId = statusId;
    if (assignedUserId) contactWhere.assignedUserId = assignedUserId;
    if (hasZalo === 'true') contactWhere.hasZalo = true;
    else if (hasZalo === 'false') contactWhere.hasZalo = false;
    else if (hasZalo === 'unknown') contactWhere.hasZalo = null;
    if (scoreMin || scoreMax) {
      const range: { gte?: number; lte?: number } = {};
      if (scoreMin) range.gte = Number(scoreMin) || 0;
      if (scoreMax) range.lte = Number(scoreMax) || 100;
      contactWhere.leadScore = range;
    }
    if (tags) {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        // Tag filter check CẢ 3 nguồn (theo mergedTags FE):
        //   1. Contact.tags (org-level CRM tags)
        //   2. Friend.crmTagsPerNick (per-pair CRM tags, kèm 🔵 Zalo-mirrored)
        //   3. Friend.zaloLabels (Zalo Real native labels, sync 2-way)
        // Trước đây chỉ check Contact.tags → user thấy tag "MKT HS" ở chip bar
        // (qua mergedTags) nhưng filter không match KH có tag chỉ ở Friend level.
        //
        // Strip "🔵 " prefix khi compare zaloLabels.name vì FE render với prefix
        // nhưng backend zaloLabels lưu name gốc.
        const cleanTagList = tagList.map((t) => t.replace(/^🔵\s+/, ''));
        const tagSourceOR: Array<Record<string, unknown>> = [
          { tags: { array_contains: tagList } },
          {
            friends: {
              some: {
                OR: [
                  { crmTagsPerNick: { array_contains: tagList } },
                  ...cleanTagList.map((name) => ({
                    zaloLabels: { array_contains: [{ name }] },
                  })),
                ],
              },
            },
          },
        ];
        // Combine với search OR (nếu có) qua AND wrapper — tránh overwrite.
        if (contactWhere.OR) {
          contactWhere.AND = [
            { OR: contactWhere.OR as Record<string, unknown>[] },
            { OR: tagSourceOR },
          ];
          delete contactWhere.OR;
        } else {
          contactWhere.OR = tagSourceOR;
        }
      }
    }
    // KH có ít nhất 1 Friend với kind trong list (Friend level filter)
    if (relationshipKindAny) {
      const kinds = relationshipKindAny.split(',').map(s => s.trim()).filter(Boolean);
      if (kinds.length > 0) contactWhere.friends = { some: { relationshipKind: { in: kinds } } };
    }
    // Phase 8 — Engagement pattern filter (1+ pattern from heatmap classification)
    if (engagementPattern) {
      const patterns = engagementPattern.split(',').map((s) => s.trim()).filter(Boolean);
      if (patterns.length === 1) contactWhere.engagementPattern = patterns[0];
      else if (patterns.length > 1) contactWhere.engagementPattern = { in: patterns };
    }
    if (Object.keys(contactWhere).length > 0) where.contact = contactWhere;

    // Advanced filters
    if (unread === 'true') where.unreadCount = { gt: 0 };
    if (unreplied === 'true') where.isReplied = false;

    // Phase 6+ Quick Pills filters — apply qua Contact + Friend
    // Stuck → có ít nhất 1 Friend với stuckSince != null
    if (stuck === 'true') {
      const existingFriends = (contactWhere.friends as any) || {};
      const someClause = existingFriends.some || {};
      contactWhere.friends = {
        some: { ...someClause, stuckSince: { not: null } },
      };
    }
    // Ready → Contact aggregate leadScore >= 80 (đã cover bởi scoreMin nếu set, đây là shortcut)
    if (ready === 'true') {
      const existingLeadScore = (contactWhere.leadScore as any) || {};
      contactWhere.leadScore = { ...existingLeadScore, gte: 80 };
    }
    // Auto-tags filter — Friend có autoTags chứa bất kỳ tag nào trong list
    if (autoTagsAny) {
      const tagList = autoTagsAny.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        const existingFriends = (contactWhere.friends as any) || {};
        const someClause = existingFriends.some || {};
        // Postgres JSON array_contains_any cần or-chain hoặc raw SQL.
        // Workaround: union per tag (vẫn dùng `some` với OR).
        const orConditions = tagList.map((tag) => ({ autoTags: { array_contains: [tag] } }));
        contactWhere.friends = {
          some: { ...someClause, OR: orConditions },
        };
      }
    }
    // Zalo Labels filter — Friend có zaloLabels chứa label name
    if (zaloLabels) {
      const labelList = zaloLabels.split(',').map((t) => t.trim()).filter(Boolean);
      if (labelList.length > 0) {
        const existingFriends = (contactWhere.friends as any) || {};
        const someClause = existingFriends.some || {};
        // zaloLabels là JSONB array of {id,name,color,emoji}. Dùng @> containment
        // (Prisma array_contains với object element) — match SQL: zalo_labels @> '[{"name":X}]'.
        // KHÔNG dùng path+array_contains combo (broken pattern, return 0 results).
        const orConditions = labelList.map((name) => ({
          zaloLabels: { array_contains: [{ name }] },
        }));
        contactWhere.friends = {
          some: { ...someClause, OR: orConditions },
        };
      }
    }

    // ════════════ 2026-06-08 — Cột 1 sidebar deep filter (nút trước đây "chết") ════════════

    // ── Stage pipeline → Trạng thái KH thật (Status table, anh chốt 2026-06-08) ──
    // FE gửi CSV statusId (không phải nhãn cứng Nóng/Ấm/Lạnh). Lọc Contact.statusId.
    if (stages) {
      const statusIds = stages.split(',').map((s) => s.trim()).filter(Boolean);
      if (statusIds.length === 1) contactWhere.statusId = statusIds[0];
      else if (statusIds.length > 1) contactWhere.statusId = { in: statusIds };
    }

    // ── Stuck duration → Friend.stuckSince cũ hơn ngưỡng N ngày ──
    if (stuckDuration) {
      const days = stuckDuration === '>3d' ? 3 : stuckDuration === '>7d' ? 7
        : stuckDuration === '>14d' ? 14 : stuckDuration === '>30d' ? 30 : 0;
      if (days > 0) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const existingFriends = (contactWhere.friends as any) || {};
        const someClause = existingFriends.some || {};
        contactWhere.friends = {
          some: { ...someClause, stuckSince: { not: null, lte: cutoff } },
        };
      }
    }

    // ── Cờ chờ-reply: dùng Conversation.isReplied làm proxy chuẩn ──
    // isReplied=false = tin cuối là của KH, sale chưa rep → "KH chờ sale reply".
    // isReplied=true  = tin cuối là của sale, đang đợi KH    → "Sale chờ KH reply".
    // (Prisma không so trực tiếp 2 cột lastInboundAt/lastOutboundAt; isReplied đã
    //  được maintain đúng ngữ nghĩa này ở message ingest pipeline.)
    if (customerWaitingReply === 'true' && saleWaitingReply !== 'true') {
      where.isReplied = false;
    } else if (saleWaitingReply === 'true' && customerWaitingReply !== 'true') {
      where.isReplied = true;
    }
    // Cả hai cùng bật = không lọc (mọi hội thoại đều thuộc 1 trong 2) → bỏ qua.

    // ── Sinh nhật 7 ngày tới (so ngày/tháng, bỏ năm, wrap qua năm mới) ──
    // Prisma where thuần không so ngày-tháng bỏ năm → raw query lấy contactId.
    if (birthdayWithin7d === 'true') {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM contacts
        WHERE org_id = ${user.orgId}
          AND birth_date IS NOT NULL
          AND (
            to_char(birth_date, 'MM-DD') = ANY (
              SELECT to_char(generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '7 day', INTERVAL '1 day'), 'MM-DD')
            )
          )
      `;
      const ids = rows.map((r) => r.id);
      contactWhere.id = ids.length > 0 ? { in: ids } : { in: ['__NO_BIRTHDAY_MATCH__'] };
    }

    // ── Lịch hẹn 24h tới / quá hạn → Appointment scheduled (relation some) ──
    if (appointmentWithin24h === 'true') {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const existingAppt = (contactWhere.appointments as any) || {};
      const someClause = existingAppt.some || {};
      contactWhere.appointments = {
        some: { ...someClause, status: 'scheduled', appointmentDate: { gte: now, lte: in24h } },
      };
    }
    if (appointmentOverdue === 'true') {
      const now = new Date();
      const existingAppt = (contactWhere.appointments as any) || {};
      const someClause = existingAppt.some || {};
      contactWhere.appointments = {
        some: { ...someClause, status: 'scheduled', appointmentDate: { lt: now } },
      };
    }

    // Re-apply contactWhere nếu đã modify trên (stuck/ready/tags)
    if (Object.keys(contactWhere).length > 0) where.contact = contactWhere;

    // ── 2026-06-09 (anh chốt) — Nhóm lọc "Tin nhắn" (user vs bot), radio 1-of-3 ──
    // Xét mốc KHÁCH NHẮN CUỐI CỦA CHÍNH CONVERSATION này (KHÔNG dùng Contact.lastInboundAt
    // vì đó là aggregate cross-nick — 1 KH nhiều nick thì mốc đó thuộc nick khác → sai).
    // Mốc = MAX(sent_at WHERE sender_type='contact') trong conv. Sale thật = self +
    // sentVia user/user_native; Bot = self + automation/ai_assistant/system.
    //   unanswered  = KHÔNG có tin self nào sau mốc khách cuối (chưa ai trả lời)
    //   bot_no_sale = có tin self sau mốc, NHƯNG không có tin sale thật nào → chỉ bot
    //   sale_replied= có tin sale thật sau mốc khách cuối
    // D8: conv phải có ít nhất 1 tin khách (lastInbound IS NOT NULL).
    if (messageReplyState === 'unanswered' || messageReplyState === 'bot_no_sale' || messageReplyState === 'sale_replied') {
      try {
        const stateRows = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT cv.id
          FROM conversations cv
          JOIN LATERAL (
            SELECT MAX(m.sent_at) FILTER (WHERE m.sender_type = 'contact') AS last_inbound,
                   MAX(m.sent_at) FILTER (
                     WHERE m.sender_type = 'self' AND m.sent_via IN ('user','user_native')
                   ) AS last_sale,
                   MAX(m.sent_at) FILTER (WHERE m.sender_type = 'self') AS last_self
            FROM messages m WHERE m.conversation_id = cv.id
          ) agg ON TRUE
          WHERE cv.org_id = ${user.orgId}
            AND cv."threadType" = 'user'
            AND cv.deleted_at IS NULL
            AND agg.last_inbound IS NOT NULL
            AND (
              ${messageReplyState}::text = 'unanswered'  AND (agg.last_self IS NULL OR agg.last_self < agg.last_inbound)
              OR ${messageReplyState}::text = 'sale_replied' AND agg.last_sale IS NOT NULL AND agg.last_sale >= agg.last_inbound
              OR ${messageReplyState}::text = 'bot_no_sale' AND agg.last_self IS NOT NULL AND agg.last_self >= agg.last_inbound
                   AND (agg.last_sale IS NULL OR agg.last_sale < agg.last_inbound)
            )
        `;
        const ids = stateRows.map((r) => r.id);
        where.id = ids.length > 0 ? { in: ids } : { in: ['__NO_MSG_REPLY_STATE_MATCH__'] };
      } catch (err) {
        logger.warn('[conversations] messageReplyState raw query failed, bỏ qua filter:', err);
      }
    }

    // ── Tin nhắn cuối (lastMessageWithin) → Conversation.lastMessageAt gte mốc ──
    // Ghép cùng where.lastMessageAt với date range bên dưới (cùng field).
    if (lastMessageWithin) {
      const ms = lastMessageWithin === '24h' ? 24 * 3600e3
        : lastMessageWithin === '7d' ? 7 * 24 * 3600e3
        : lastMessageWithin === '30d' ? 30 * 24 * 3600e3 : 0;
      if (ms > 0) {
        where.lastMessageAt = { ...(where.lastMessageAt || {}), gte: new Date(Date.now() - ms) };
      } else if (lastMessageWithin === '>30d') {
        // Im lặng > 30 ngày: lastMessageAt cũ hơn 30 ngày.
        where.lastMessageAt = { ...(where.lastMessageAt || {}), lte: new Date(Date.now() - 30 * 24 * 3600e3) };
      }
    }

    // Date range — accept cả from/to legacy lẫn dateFrom/dateTo mới
    const dFrom = dateFrom || from;
    const dTo = dateTo || to;
    if (dFrom || dTo) {
      where.lastMessageAt = {};
      if (dFrom) {
        const d = new Date(dFrom);
        if (!isNaN(d.getTime())) where.lastMessageAt.gte = d;
      }
      if (dTo) {
        const d = new Date(dTo + 'T23:59:59.999Z');
        if (!isNaN(d.getTime())) where.lastMessageAt.lte = d;
      }
      if (Object.keys(where.lastMessageAt).length === 0) delete where.lastMessageAt;
    }

    // Phase Contact Scope Hybrid 2026-05-27: scope qua getZaloScope (gỡ legacy
    // 'role===member' bypass — user legacy admin nhưng RBAC group Sale vẫn bị scope).
    const { getZaloScope: _getZScope } = await import('../zalo/zalo-scope.js');
    const zScope2 = await _getZScope(user.id, user.orgId, user.role);
    if (!zScope2.isOrgAdmin) {
      // T6-consumer (YC2): danh sách hội thoại dùng displayableIds (gồm nick xóa-có-uid).
      const displayableIds = zScope2.displayableIds;
      if (accountIdList.length > 0) {
        const allowed = accountIdList.filter(id => displayableIds.includes(id));
        where.zaloAccountId = allowed.length === 1 ? allowed[0] : { in: allowed };
      } else {
        where.zaloAccountId = { in: displayableIds };
      }
    }

    // Sort mode — Phase 6+ "Chưa đọc lên trên" vs "Mới nhất lên trên"
    // unread-first: composite [unreadCount > 0 DESC, lastMessageAt DESC]
    // Recent (default): [lastMessageAt DESC]
    // 2026-05-28: nulls: 'last' để conv chưa có message thật KHÔNG pin top
    // (ensure-conversation từ Lead Pool / Friend click tạo conv với lastMessageAt=null).
    const orderByClause: any =
      sortMode === 'unread-first'
        ? [{ unreadCount: 'desc' }, { lastMessageAt: { sort: 'desc', nulls: 'last' } }]
        : { lastMessageAt: { sort: 'desc', nulls: 'last' } };

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          // M-tier (2026-05-21): narrow contact select — chỉ field LIST view cần.
          // Detail fields (gender/totals/birthDate/lastOutboundAt/autoTags/priorityScore...)
          // sẽ được preserve qua FE merge logic (use-chat.ts mergeConversation):
          // existing.contact deep-merge với incoming.contact để KHÔNG mất detail
          // đã load từ /conversations/:id. Trước fix: ~50 field/row × 100 rows = payload bloat.
          contact: {
            select: {
              id: true,
              fullName: true,
              crmName: true,
              avatarUrl: true,
              phone: true,
              zaloUid: true,
              hasZalo: true,
              tags: true,
              leadScore: true,
              engagementPattern: true,
              engagementScore: true,
              engagementTrend: true,
              statusId: true,
              assignedUserId: true,
              priorityScore: true,
              // M55 2026-05-30 — Cùng chăm indicator cho ConversationList cột 2
              // (avatar stack +N). Limit 5 để tránh payload bloat ở list view.
              contactAccess: {
                select: {
                  role: true,
                  user: { select: { id: true, fullName: true, email: true } },
                },
                orderBy: { createdAt: 'asc' },
                take: 5,
              },
              // 2026-06-20 (anh báo: badge "Cùng chăm" hiện 5 cache ≠ số thật khi click):
              // SỐ CHÍNH XÁC qua _count (không bị cap take:5) → badge khớp detail + sau reload.
              _count: { select: { contactAccess: true } },
            },
          },
          zaloAccount: { select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, privacyMode: true, ownerUserId: true, archivedAt: true } },
          pins: { select: { id: true } },
          messages: {
            take: 1,
            // Primary sort by Zalo Snowflake numeric (match 100% Zalo Web), sentAt fallback
            // cho CRM-sent in-flight messages chưa nhận echo zaloMsgId.
            orderBy: [{ zaloMsgIdNum: { sort: 'desc', nulls: 'last' } }, { sentAt: 'desc' }],
            select: { id: true, zaloMsgId: true, senderUid: true, senderName: true, content: true, contentType: true, senderType: true, sentAt: true, isDeleted: true, editedAt: true, reactions: { select: { emoji: true, reactorId: true, reactorName: true, reactorSource: true } } },
          },
        },
        orderBy: orderByClause,
        skip: (parseInt(page) - 1) * Math.min(parseInt(limit), 200),
        take: Math.min(parseInt(limit), 200),
      }),
      prisma.conversation.count({ where }),
    ]);

    // Batch fetch Friend records cho user threads để FE biết friendship state.
    // QUAN TRỌNG: lookup theo (zaloAccountId × zaloUidInNick = conv.externalThreadId)
    // — đây là unique key cho Friend row. KHÔNG dùng (accountId × contactId) vì cùng
    // contact có thể có nhiều Friend rows cùng account (per-nick UID khác nhau từ
    // session reset). Mỗi conv bind đúng 1 friend row qua externalThreadId.
    // Dedup userPairs trước friend.findMany — list 100 rows có thể có conv trùng
    // (account, uid) khi seed legacy. OR-clause với pair trùng → planner duplicate
    // index scan (M-tier optimization 2026-05-21).
    const userPairsRaw = conversations
      .filter(c => c.threadType === 'user' && c.contactId && c.externalThreadId)
      .map(c => ({ zaloAccountId: c.zaloAccountId, zaloUidInNick: c.externalThreadId! }));
    const pairKeys = new Set<string>();
    const userPairs: typeof userPairsRaw = [];
    for (const p of userPairsRaw) {
      const key = `${p.zaloAccountId}:${p.zaloUidInNick}`;
      if (!pairKeys.has(key)) {
        pairKeys.add(key);
        userPairs.push(p);
      }
    }
    let friendMap = new Map<string, {
      id: string;
      relationshipKind: string; friendshipStatus: string;
      becameFriendAt: Date | null; firstMessageAt: Date | null;
      updatedAt: Date;
      crmTagsPerNick: unknown;
      zaloLabels: unknown;               // 2026-06-06: [{id,name,color}] tag Zalo Real native
      aliasInNick: string | null;        // ui-phase5: "Tên gợi nhớ" Zalo sync 2-way
      // Per-pair counter (FE header cột 3 đọc — fix bug 235/198 revert 0/0)
      totalInbound: number;
      totalOutbound: number;
      lastInboundAt: Date | null;
      lastOutboundAt: Date | null;
      // Phase 6+ score + auto-tag display
      leadScore: number;
      autoTags: unknown;
      stuckSince: Date | null;
      statusName: string | null;
      statusColor: string | null;
    }>();
    if (userPairs.length) {
      const friends = await prisma.friend.findMany({
        where: { OR: userPairs.map(p => ({ AND: [{ zaloAccountId: p.zaloAccountId }, { zaloUidInNick: p.zaloUidInNick }] })) },
        select: {
          id: true,                            // Friend.id để FE fetch /scoring/:friendId/breakdown
          zaloAccountId: true, contactId: true,
          zaloUidInNick: true,                 // dùng làm map key
          relationshipKind: true, friendshipStatus: true,
          becameFriendAt: true, firstMessageAt: true,
          updatedAt: true,                     // last status change — dùng cho pendingDaysLabel
          crmTagsPerNick: true,                // per-pair CRM tags (kèm Zalo-mirrored "🔵 X")
          zaloLabels: true,                    // 2026-06-06: tag Zalo Real native {id,name,color} —
                                               // cột 2 render tag Zalo từ đây (màu CHUẨN = zalo_labels.color)
          aliasInNick: true,                   // "Tên gợi nhớ" Zalo, sync 2-way (ui-phase5)
          // ── Per-pair counter ─────────────────────────────────────────────
          // KHÔNG include trước đây gây bug: header MessageThread cột 3 đọc
          // friendship.totalInbound/Outbound → list refresh override conv →
          // counter rớt về 0/0 (vì ?? 0 fallback). Detail endpoint /:id có,
          // list endpoint thiếu → race khi fetchConversations() chạy sau
          // selectConversation. Fix: select + map ra response cho stable.
          totalInbound: true,
          totalOutbound: true,
          lastInboundAt: true,
          lastOutboundAt: true,
          // Phase 6+ — Score + auto-tags + stuck cho render badge trong conv list
          leadScore: true,
          autoTags: true,
          stuckSince: true,
          statusId: true,
          statusRef: { select: { name: true, color: true } },
        },
      });
      // Map key = (accountId × zaloUidInNick) khớp với conv.externalThreadId
      // → mỗi conv lấy ĐÚNG friend row của thread đó, không dedup nhầm KH có nhiều UID.
      friendMap = new Map(friends.map(f => [`${f.zaloAccountId}:${f.zaloUidInNick}`, {
        id: f.id,
        relationshipKind: f.relationshipKind,
        friendshipStatus: f.friendshipStatus,
        becameFriendAt: f.becameFriendAt,
        firstMessageAt: f.firstMessageAt,
        updatedAt: f.updatedAt,
        crmTagsPerNick: f.crmTagsPerNick,
        zaloLabels: f.zaloLabels,            // 2026-06-06: tag Zalo Real {id,name,color} màu chuẩn cho cột 2
        aliasInNick: f.aliasInNick,          // ui-phase5
        // Per-pair counter — header chat cột 3 dùng (fix bug 235/198 → 0/0)
        totalInbound: f.totalInbound,
        totalOutbound: f.totalOutbound,
        lastInboundAt: f.lastInboundAt,
        lastOutboundAt: f.lastOutboundAt,
        // Phase 6+ score + auto-tag display data
        leadScore: f.leadScore,
        autoTags: f.autoTags,
        stuckSince: f.stuckSince,
        statusName: f.statusRef?.name ?? null,
        statusColor: f.statusRef?.color ?? null,
      }]));
    }

    // PRIVACY REDACT 2026-05-22 — apply redactConversationRow + redactMessage
    // cho preview text ở cột 2 khi conv thuộc nick privacy='main' + non-owner.
    const { buildPrivacyContext, redactConversationRow, redactMessage } = await import('../privacy/redact.js');
    const privacyCtx = await buildPrivacyContext(request);

    return {
      conversations: conversations.map((c) => {
        const base = {
          ...c,
          isPinned: c.pins.length > 0,
          friendship: c.contactId && c.externalThreadId
            ? friendMap.get(`${c.zaloAccountId}:${c.externalThreadId}`) || null
            : null,
        };
        const redactedConv = redactConversationRow(base as any, privacyCtx);
        // Cũng redact preview message (snippet cuối trong messages[0])
        if ((redactedConv as any).messages?.length && (redactedConv as any).redacted) {
          (redactedConv as any).messages = (redactedConv as any).messages.map((m: any) =>
            redactMessage(m, c as any, privacyCtx),
          );
        }
        return redactedConv;
      }),
      total,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 200),
    };
  });

  // ── Get single conversation ──────────────────────────────────────────────
  app.get('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        contact: {
          include: {
            // M55 2026-05-30 — Full collaborators cho ChatContactPanel + header tooltip.
            // Detail view nên KHÔNG limit (1 KH thường <10 sale chăm).
            contactAccess: {
              select: {
                role: true,
                source: true,
                createdAt: true,
                user: { select: { id: true, fullName: true, email: true } },
              },
              orderBy: { createdAt: 'asc' },
              take: 20,
            },
            // 2026-06-20: số chính xác (khớp badge cột 2) — cùng nguồn _count.
            _count: { select: { contactAccess: true } },
          },
        },
        // PRIVACY 2026-06-11: cần privacyMode + ownerUserId để gate redact.
        // T11-BE (YC2): + archivedAt → FE badge "Đã xóa" + banner + khóa ô soạn tin.
        zaloAccount: { select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true, privacyMode: true, ownerUserId: true, archivedAt: true } },
        pins: { select: { id: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    // PRIVACY 2026-06-11 — SCOPE GUARD: endpoint này trước đây thiếu cả scope lẫn redact
    // (audit C4). Chặn user ngoài quyền đọc chi tiết hội thoại của nick người khác.
    const { getZaloScope } = await import('../zalo/zalo-scope.js');
    const scope = await getZaloScope(user.id, user.orgId, user.role);
    // T6-consumer (YC2): mở chi tiết dùng displayableIds (nick xóa-có-uid đọc-only). Gửi gate riêng (T7).
    if (!scope.isOrgAdmin && !scope.displayableIds.includes(conversation.zaloAccountId)) {
      return reply.status(403).send({ error: 'Bạn không có quyền xem hội thoại này', code: 'not_in_scope' });
    }

    // Friend per-pair info — counters + leadScore + status RIÊNG cặp (nick, KH).
    // Header chat phải dùng per-pair counter (KHÔNG dùng contact.totalInbound aggregate
    // — đó là tổng across-nicks, conv mới chưa có msg = 0 mới đúng).
    let friendship: {
      id: string;
      relationshipKind: string;
      friendshipStatus: string;
      hasConversation: boolean;
      becameFriendAt: Date | null;
      firstMessageAt: Date | null;
      updatedAt: Date;
      totalInbound: number;
      totalOutbound: number;
      leadScore: number;
      statusRef: { id: string; name: string; color: string | null; order: number } | null;
      zaloLabels: unknown;
      crmTagsPerNick: unknown;
      autoTags: unknown;
      aliasInNick: string | null;
    } | null = null;
    if (conversation.threadType === 'user' && conversation.contactId && conversation.externalThreadId) {
      const f = await prisma.friend.findUnique({
        where: { zaloAccountId_zaloUidInNick: { zaloAccountId: conversation.zaloAccountId, zaloUidInNick: conversation.externalThreadId } },
        select: {
          id: true,
          relationshipKind: true,
          friendshipStatus: true,
          hasConversation: true,
          becameFriendAt: true,
          firstMessageAt: true,
          updatedAt: true,
          totalInbound: true,
          totalOutbound: true,
          leadScore: true,
          statusRef: { select: { id: true, name: true, color: true, order: true } },
          zaloLabels: true,
          crmTagsPerNick: true,
          autoTags: true, // FIX 2026-06-18: detail thiếu autoTags → mở chat rebuild tag
                          // mất auto-tag (vd "Hoạt động"). List có autoTags; thêm để parity.
          aliasInNick: true,
        },
      });
      friendship = f;
    }

    // PRIVACY 2026-06-11 — redact PII contact + alias friend nếu nick main & viewer
    // không phải chính chủ đã unlock (audit C4: trước đây trả full PII).
    const { buildPrivacyContext, canSeeConversationContent, redactContact, redactFriend } =
      await import('../privacy/redact.js');
    const privacyCtx = await buildPrivacyContext(request);
    let outContact: any = conversation.contact;
    let outFriendship: any = friendship;
    if (!canSeeConversationContent(conversation as any, privacyCtx)) {
      if (outContact) outContact = redactContact(outContact, privacyCtx);
      if (outFriendship) {
        outFriendship = redactFriend(
          { ...outFriendship, zaloAccount: { privacyMode: conversation.zaloAccount.privacyMode, ownerUserId: conversation.zaloAccount.ownerUserId } } as any,
          privacyCtx,
        );
      }
    }

    return {
      ...conversation,
      contact: outContact,
      isPinned: conversation.pins.length > 0,
      friendship: outFriendship,
    };
  });

  // ── POST /conversations/:id/touch-profile — pull profile từ Zalo SDK on conv click.
  //    Lý do: upsertContact lúc msg đầu chỉ set fullName + zaloUid, KHÔNG fill gender /
  //    phone / birthday. Khi user click conv, gọi getUserInfo() lấy fresh profile và
  //    upsert những field còn NULL trong DB (KHÔNG ghi đè giá trị sale đã chỉnh).
  //    Cooldown 5min per conv để không spam SDK.
  app.post('/api/v1/conversations/:id/touch-profile', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conv = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, contactId: true, zaloAccountId: true, externalThreadId: true, threadType: true },
    });
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' });
    if (conv.threadType !== 'user' || !conv.contactId || !conv.externalThreadId) {
      return { ok: true, skipped: true, reason: 'group_or_no_contact' };
    }

    // Cooldown
    const last = profileTouchCooldown.get(conv.id) || 0;
    if (Date.now() - last < PROFILE_TOUCH_COOLDOWN_MS) {
      return { ok: true, skipped: true, reason: 'cooldown' };
    }
    profileTouchCooldown.set(conv.id, Date.now());

    const api = zaloPool.getApi(conv.zaloAccountId);
    if (!api || typeof api.getUserInfo !== 'function') {
      return { ok: true, skipped: true, reason: 'account_disconnected' };
    }

    try {
      const result = await api.getUserInfo(conv.externalThreadId);
      const profiles = result?.changed_profiles || {};
      const profile = profiles[conv.externalThreadId] || profiles[`${conv.externalThreadId}_0`] || null;
      if (!profile) return { ok: true, skipped: true, reason: 'no_profile' };

      // Extract SDK fields
      const sdkGender: number = Number(profile.gender ?? -1); // 0=male, 1=female, -1=unknown
      const sdkPhone: string = String(profile.phoneNumber || '').trim();
      const sdkSdob: string = String(profile.sdob || '').trim(); // YYYY-MM-DD
      const sdkIsFr: number = Number(profile.isFr ?? 0);
      const sdkZaloName: string = String(profile.zaloName || profile.zalo_name || profile.displayName || '').trim();
      const sdkAvatar: string = String(profile.avatar || '').trim();
      const sdkGlobalId: string = String(profile.globalId || '').trim();
      const sdkUsername: string = String(profile.username || '').trim();

      // Read current Contact to decide which fields to fill (don't overwrite manual edits)
      const contact = await prisma.contact.findUnique({
        where: { id: conv.contactId },
        select: { gender: true, phone: true, birthDate: true, hasZalo: true, zaloGlobalId: true, zaloUsername: true },
      });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      // Build patch: only fields currently NULL/empty
      const contactPatch: Record<string, unknown> = {};
      if (!contact.gender && sdkGender >= 0) {
        contactPatch.gender = sdkGender === 1 ? 'female' : 'male';
      }
      if (!contact.phone && sdkPhone) contactPatch.phone = sdkPhone;
      if (!contact.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(sdkSdob)) {
        contactPatch.birthDate = new Date(sdkSdob);
      }
      // hasZalo: luôn refresh (cheap, SDK authoritative)
      if (sdkIsFr === 1 && contact.hasZalo !== true) contactPatch.hasZalo = true;
      // globalId / username: backfill nếu chưa có
      if (!contact.zaloGlobalId && sdkGlobalId) contactPatch.zaloGlobalId = sdkGlobalId;
      if (!contact.zaloUsername && sdkUsername) contactPatch.zaloUsername = sdkUsername;

      if (Object.keys(contactPatch).length > 0) {
        try {
          await prisma.contact.update({ where: { id: conv.contactId }, data: contactPatch });
        } catch (err: any) {
          // Wave 1.5-B: unique constraint conflict trên (orgId, zaloGlobalId) — stub Contact
          // đụng canonical Contact đã có. Merge stub INTO canonical thay vì throw lên user.
          if (err?.code === 'P2002' && sdkGlobalId) {
            const canonical = await prisma.contact.findFirst({
              where: { orgId: user.orgId, zaloGlobalId: sdkGlobalId, mergedInto: null, id: { not: conv.contactId } },
              select: { id: true },
            });
            if (canonical) {
              // narrow: conv.contactId đã được guard non-null ở L625; capture vào const để
              // giữ narrowing trong async closure bên dưới.
              const stubContactId = conv.contactId;
              logger.info(`[touch-profile] Conflict → merging stub ${stubContactId} INTO canonical ${canonical.id} via globalId=${sdkGlobalId}`);
              // Re-point Conversation + Friend + Outbox + Appointment to canonical.
              // 2026-06-12: bỏ updateMany AutomationTask (bảng đã drop — không có hàng
              // để re-point; Message.automationTaskId là string jobId BullMQ, không FK
              // tới contact nên không cần đụng khi merge).
              await tenantTransaction(async (tx) => {
                await tx.conversation.updateMany({ where: { contactId: stubContactId }, data: { contactId: canonical.id } });
                await tx.friend.updateMany({ where: { contactId: stubContactId }, data: { contactId: canonical.id } });
                await tx.friendRequestOutbox.updateMany({ where: { contactId: stubContactId }, data: { contactId: canonical.id } });
                await tx.customerListEntry.updateMany({ where: { contactId: stubContactId }, data: { contactId: canonical.id } });
                await tx.contact.update({ where: { id: stubContactId }, data: { mergedInto: canonical.id, phoneNormalized: null, phone: null, updatedAt: new Date() } });
              });
              return { ok: true, merged: true, intoContactId: canonical.id };
            }
          }
          throw err;
        }
      }

      // Friend snapshot: zaloDisplayName + zaloAvatarUrl — per-pair, luôn refresh
      const friendPatch: Record<string, unknown> = {};
      if (sdkZaloName) friendPatch.zaloDisplayName = sdkZaloName;
      if (sdkAvatar) friendPatch.zaloAvatarUrl = sdkAvatar;
      if (Object.keys(friendPatch).length > 0) {
        await prisma.friend.updateMany({
          where: { zaloAccountId: conv.zaloAccountId, zaloUidInNick: conv.externalThreadId },
          data: friendPatch,
        });
      }

      // ── Counter integrity reconcile — recount totalInbound / totalOutbound từ Message table
      //    nếu drift với counter hiện tại. applyContactAggregate đôi khi miss (race / dedup
      //    edge case / silent error). Cheap query với index conversation_id → ~10-50ms.
      const counterRows = await prisma.$queryRaw<Array<{ actual_in: bigint; actual_out: bigint; stored_in: number; stored_out: number }>>`
        SELECT
          COUNT(*) FILTER (WHERE m.sender_type = 'contact') AS actual_in,
          COUNT(*) FILTER (WHERE m.sender_type = 'self') AS actual_out,
          c.total_inbound AS stored_in,
          c.total_outbound AS stored_out
        FROM contacts c
        LEFT JOIN conversations cv ON cv.contact_id = c.id
        LEFT JOIN messages m ON m.conversation_id = cv.id
        WHERE c.id = ${conv.contactId}
        GROUP BY c.id
      `;
      let counterReconciled = false;
      if (counterRows.length > 0) {
        const row = counterRows[0];
        const actualIn = Number(row.actual_in);
        const actualOut = Number(row.actual_out);
        if (actualIn !== row.stored_in || actualOut !== row.stored_out) {
          await prisma.contact.update({
            where: { id: conv.contactId },
            data: { totalInbound: actualIn, totalOutbound: actualOut },
          });
          counterReconciled = true;
          logger.info(`[touch-profile] Counter drift fixed contact=${conv.contactId}: in ${row.stored_in}→${actualIn}, out ${row.stored_out}→${actualOut}`);
        }
      }

      return {
        ok: true,
        contactPatched: Object.keys(contactPatch),
        friendPatched: Object.keys(friendPatch),
        counterReconciled,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Touch profile failed';
      logger.warn(`[touch-profile] conv=${conv.id}: ${msg}`);
      // Reset cooldown nếu fail để lần sau retry sớm
      profileTouchCooldown.delete(conv.id);
      return { ok: false, error: msg };
    }
  });

  // ── List messages for a conversation (paginated, newest first) ──────────
  app.get('/api/v1/conversations/:id/messages', {
    preHandler: requireZaloAccess('read'),
    // Privacy phase integration: main-nick conv content sẽ bị redact ▒▒▒▒ ở middleware Privacy
    config: { contentClass: 'content' as const, rbacResource: 'conversation' as const, rbacAction: 'access' as const },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50' } = request.query as QueryParams;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: {
        id: true,
        // 2026-06-20: displayName+avatar của NICK để hiển thị reaction do sale thả qua CRM
        // theo DANH TÍNH NICK ZALO (anh chốt: không hiện email tài khoản sale CRM).
        zaloAccount: { select: { privacyMode: true, ownerUserId: true, displayName: true, avatarUrl: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    // Phase Riêng Tư 2026-05-22: redact content nếu conv main-nick + viewer không own + chưa unlock
    const { buildPrivacyContext, redactMessage } = await import('../privacy/redact.js');
    const privacyCtx = await buildPrivacyContext(request);

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        // Primary sort by Zalo Snowflake (zaloMsgIdNum) — match Zalo Web order.
        // sentAt fallback chỉ kick in cho row chưa có zaloMsgIdNum (CRM in-flight).
        orderBy: [{ zaloMsgIdNum: { sort: 'desc', nulls: 'last' } }, { sentAt: 'desc' }],
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        select: {
          id: true,
          zaloMsgId: true,
          zaloMsgIdNum: true, // FE primary sort key (string format vì BigInt → JSON via serializer)
          senderUid: true,
          senderName: true,
          content: true,
          contentType: true,
          senderType: true,
          sentAt: true,
          isDeleted: true,
          // Edit audit (2026-05-21) — FE render badge "(đã sửa)" + tooltip nội dung gốc
          originalContent: true,
          editedAt: true,
          // Read receipts (Wave 1+2 2026-05-21) — FE render tick xám / tick xanh
          deliveredAt: true,
          seenAt: true,
          quote: true,
          attachments: true,
          albumKey: true,
          albumIndex: true,
          albumTotal: true,
          reactions: { select: { emoji: true, reactorId: true, reactorName: true, reactorSource: true } },
          // M55 2026-05-30 — sender attribution cho multi-sale cùng chăm.
          // Tin self (sale gửi qua CRM) lưu repliedByUserId — FE render mini avatar
          // tên sale phía trên bubble khi sale khác (không phải mình) gửi.
          repliedByUserId: true,
          repliedBy: { select: { id: true, fullName: true, email: true } },
          // M55: isLocal/metadata cho virtual chat (đã có sẵn nhưng chưa expose)
          isLocal: true,
          metadata: true,
          // M11 Source Badge (Anh chốt 2026-06-02) — fix 2026-06-03:
          // FE MessageSourceBadge.vue cần sentVia để phân loại 5 variant
          // (user/user_native/automation/ai_assistant/system). Thiếu field
          // này → fallback senderName='Staff' khiến badge hiện sai.
          sentVia: true,
          // Anh chốt 2026-06-03 — mentions persist từ Zalo SDK:
          // FE dùng pos+len bôi đúng 100%, không cần đoán regex.
          mentions: true,
        },
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

    const ordered = messages.reverse();

    // ── INBOUND sender name resolver (Anh chốt 2026-06-03) ─────────────────
    // 3 case Anh chốt:
    //   A. Nick lẻ ngoài hệ thống:
    //      - Có Contact.crmName → hiện "Chị Lan · Lan Nguyen" (crmName + zalo)
    //      - Không có crmName → hiện tên Zalo thật
    //   B. Nick có owner trong org (sale khác): hiện "Tuan HS · Sale: Anh Tuấn"
    //   C. senderUid null → senderResolved=null, FE skip render
    // 3 batch query song song (0 N+1). Tên ưu tiên: crmName → aliasInNick → senderName.
    const inboundUids = Array.from(
      new Set(
        ordered
          .filter((m) => m.senderType === 'contact' && m.senderUid)
          .map((m) => m.senderUid as string),
      ),
    );
    let resolverMaps: {
      internalNicks: Map<string, { displayName: string | null; ownerId: string | null; ownerFullName: string | null }>;
      contacts: Map<string, { id: string; crmName: string | null; fullName: string | null }>;
      friends: Map<string, { aliasInNick: string | null; zaloDisplayName: string | null }>;
    } = { internalNicks: new Map(), contacts: new Map(), friends: new Map() };

    if (inboundUids.length > 0) {
      const [internalNickRows, contactRows, friendRows] = await Promise.all([
        prisma.zaloAccount.findMany({
          where: { orgId: user.orgId, zaloUid: { in: inboundUids } },
          select: {
            zaloUid: true,
            displayName: true,
            ownerUserId: true,
            owner: { select: { id: true, fullName: true } },
          },
        }),
        prisma.contact.findMany({
          where: { orgId: user.orgId, zaloUid: { in: inboundUids } },
          select: { id: true, zaloUid: true, crmName: true, fullName: true },
        }),
        prisma.friend.findMany({
          where: {
            orgId: user.orgId,
            zaloUidInNick: { in: inboundUids },
          },
          select: { zaloUidInNick: true, aliasInNick: true, zaloDisplayName: true },
        }),
      ]);
      for (const r of internalNickRows) {
        if (r.zaloUid) {
          resolverMaps.internalNicks.set(r.zaloUid, {
            displayName: r.displayName,
            ownerId: r.owner?.id ?? r.ownerUserId,
            ownerFullName: r.owner?.fullName ?? null,
          });
        }
      }
      for (const r of contactRows) {
        if (r.zaloUid) {
          resolverMaps.contacts.set(r.zaloUid, {
            id: r.id,
            crmName: r.crmName,
            fullName: r.fullName,
          });
        }
      }
      for (const r of friendRows) {
        resolverMaps.friends.set(r.zaloUidInNick, {
          aliasInNick: r.aliasInNick,
          zaloDisplayName: r.zaloDisplayName,
        });
      }
    }

    function resolveSender(msg: typeof ordered[number]) {
      if (msg.senderType !== 'contact' || !msg.senderUid) return null;
      const internal = resolverMaps.internalNicks.get(msg.senderUid);
      const contact = resolverMaps.contacts.get(msg.senderUid);
      const friend = resolverMaps.friends.get(msg.senderUid);
      const crmName = contact?.crmName ?? friend?.aliasInNick ?? null;
      const zaloName = msg.senderName ?? friend?.zaloDisplayName ?? contact?.fullName ?? null;
      const displayName = crmName ?? zaloName ?? 'Người lạ';
      return {
        senderDisplayName: displayName,
        senderCrmName: crmName,
        senderZaloName: zaloName,
        senderIsInternalNick: !!internal,
        senderInternalNickLabel: internal?.displayName ?? null,
        senderInternalNickOwner: internal?.ownerFullName ?? null,
        senderInternalNickOwnerId: internal?.ownerId ?? null,
        senderCase: internal ? 'B' : 'A',
      };
    }

    // 2026-06-20 (anh báo popup cảm xúc chỉ hiện "Người dùng"/email): resolve người thả → tên+avatar.
    //  - reactor 'zalo' → Friend.zaloUidInNick (của nick) → aliasInNick/zaloDisplayName + zaloAvatarUrl
    //    (Zalo event NHÓM không kèm tên → reactor_name rỗng → bắt buộc tra).
    //  - reactor 'crm'  → DANH TÍNH NICK ZALO của hội thoại (anh chốt: KHÔNG hiện email sale CRM —
    //    cảm xúc sale thả qua CRM gửi đi DƯỚI nick này, khách thấy nick thả).
    // Batch Friend 0 N+1, chỉ chạy khi có reaction zalo.
    const nickName = conversation.zaloAccount?.displayName || null;
    const nickAvatar = conversation.zaloAccount?.avatarUrl || null;
    const reactorZaloUids = new Set<string>();
    for (const m of ordered) {
      for (const rx of ((m as { reactions?: Array<{ reactorId: string; reactorSource: string | null }> }).reactions || [])) {
        if (rx.reactorId && rx.reactorSource !== 'crm') reactorZaloUids.add(rx.reactorId);
      }
    }
    const reactorMap = new Map<string, { name: string | null; avatar: string | null }>();
    if (reactorZaloUids.size > 0) {
      const frx = await prisma.friend.findMany({
        where: { orgId: user.orgId, zaloUidInNick: { in: [...reactorZaloUids] } },
        select: { zaloUidInNick: true, aliasInNick: true, zaloDisplayName: true, zaloAvatarUrl: true },
      });
      for (const f of frx) {
        if (!reactorMap.has(f.zaloUidInNick)) {
          reactorMap.set(f.zaloUidInNick, { name: f.aliasInNick || f.zaloDisplayName || null, avatar: f.zaloAvatarUrl || null });
        }
      }
    }

    const redacted = ordered.map((m) => {
      const r = redactMessage(m as any, conversation as any, privacyCtx);
      // PRIVACY 2026-06-11 (audit H1): senderResolved (tên/crmName/alias KH) gán SAU
      // redactMessage → KHÔNG gán cho tin đã redact, nếu không cấp trên vẫn đọc được
      // DANH SÁCH tên KH riêng tư dù nội dung đã mờ.
      const isRedacted = (r as any).redacted === true;
      // Enrich reaction reactor: tên + avatar resolved (tin redact → ẩn danh tính, giữ emoji/count).
      const rawReactions = ((r as { reactions?: Array<{ emoji: string; reactorId: string; reactorName: string | null; reactorSource: string | null }> }).reactions) || [];
      const enrichedReactions = rawReactions.map((rx) => {
        if (isRedacted) return { ...rx, reactorName: null, reactorAvatar: null };
        if (rx.reactorSource === 'crm') {
          // Sale thả qua CRM → hiện DANH TÍNH NICK ZALO (không phải email tài khoản sale).
          return { ...rx, reactorName: nickName || rx.reactorName || null, reactorAvatar: nickAvatar };
        }
        const hit = reactorMap.get(rx.reactorId);
        return { ...rx, reactorName: rx.reactorName || hit?.name || null, reactorAvatar: hit?.avatar || null };
      });
      // BigInt zaloMsgIdNum → string cho JSON serialize
      return {
        ...r,
        reactions: enrichedReactions,
        zaloMsgIdNum: (r as any).zaloMsgIdNum?.toString() ?? null,
        senderResolved: isRedacted ? null : resolveSender(m),
      };
    });
    return { messages: redacted, total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Send message ─────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    // 2026-05-21: thêm `styles` cho Zalo RTF (bold/italic/underline/strikethrough).
    // Format: [{st: 'b'|'i'|'u'|'s', start: number, len: number}, ...]
    // FE extract từ Tiptap editor JSON, BE pass thẳng vào api.sendMessage.
    const { content, replyMessageId, styles, echoId: echoIdRaw, clientMessageId } = request.body as {
      content: string;
      replyMessageId?: string;
      styles?: Array<{ st: string; start: number; len: number }>;
      echoId?: string;
      clientMessageId?: string;
    };

    if (!content?.trim()) return reply.status(400).send({ error: 'Content required' });

    // 2026-06-15 IDEMPOTENCY: app outbox offline retry → khách nhận tin trùng.
    // echoId (uuid app tự sinh) dedup TRƯỚC khi gửi Zalo. Field chính `echoId`,
    // fallback `clientMessageId` cho app cũ. Null khi không gửi → backward compat.
    const echoId = (typeof echoIdRaw === 'string' && echoIdRaw.trim())
      ? echoIdRaw.trim()
      : (typeof clientMessageId === 'string' && clientMessageId.trim() ? clientMessageId.trim() : null);

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    // T7 (YC2 2026-06-20): CHẶN GỬI qua nick ĐÃ XÓA (archivedAt) — kể cả hội thoại ảo. Đặt
    // TRƯỚC isVirtual + TRƯỚC mọi nhánh tạo Message. Sau T5/T6 hội thoại nick xóa hiện lại
    // (đọc-only) → guard này chặn sale gửi nhầm. Nick chưa-kết-nối (status) để nhánh gửi thật lo.
    if (conversation.zaloAccount.archivedAt) {
      return reply.status(409).send({
        error: 'Nick này đã bị xóa — chỉ xem lại lịch sử, không gửi được. Kết nối lại nick để tiếp tục.',
        code: 'NICK_ARCHIVED',
      });
    }

    // Fix 2026-06-03 (optimistic badge): lookup User.fullName cho metadata.sender
    // → socket emit ngay sau khi insert message có đủ tên sale → FE hiện badge
    // "Sale CRM · {tên}" đúng ngay, KHÔNG đợi reload page. Cache 5 phút.
    const userFullName = await getUserFullName(user.id);

    // ── M53 2026-05-30: Virtual conversation gate ──────────────────────────
    // KH no-Zalo có conversation ảo trong /chat. Tin nhắn lưu thẳng DB, KHÔNG qua Zalo SDK.
    // Skip rate-limit + privacy check + SDK send. Anh chốt Approach A — sale dùng làm nhật ký.
    if (conversation.isVirtual) {
      try {
        const localMsgId = `local:${randomUUID()}`;
        const message = await prisma.message.create({
          data: {
            id: randomUUID(),
            conversationId: id,
            zaloMsgId: localMsgId, // synthetic — né NULL collision trên @@unique([conversationId, zaloMsgId])
            zaloMsgIdNum: null,
            senderType: 'self',
            senderUid: conversation.zaloAccount.zaloUid || '',
            senderName: 'Staff',
            content,
            contentType: 'text',
            sentAt: new Date(),
            repliedByUserId: user.id,
            isLocal: true,
            sentVia: 'user',
            // Fix 2026-06-03 (Anh báo): optimistic badge "Sale CRM · Staff"
            metadata: {
              sender: { kind: 'user_crm', name: await getUserFullName(user.id) },
            },
          },
          include: { repliedBy: { select: { id: true, fullName: true, email: true } } },
        });

        await prisma.conversation.update({
          where: { id },
          data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
        });

        const safeMessage = { ...message, zaloMsgIdNum: null as string | null };
        const io = (app as any).io as Server;
        // PRIVACY 2026-06-11: qua emit-chat (redact + scope org). Virtual conv vẫn
        // theo privacy của nick để nhất quán (kèm cờ _virtual).
        await emitChatMessage({
          io,
          orgId: user.orgId,
          accountId: conversation.zaloAccountId,
          conversationId: id,
          message: safeMessage,
          privacyMode: conversation.zaloAccount.privacyMode,
          ownerUserId: conversation.zaloAccount.ownerUserId,
          extra: { _virtual: true },
        });

        // M53 AI Trợ Lý — fire-and-forget, KHÔNG block response
        void triggerVirtualChatAiReply(
          { conversationId: id, triggerMessageId: message.id, orgId: user.orgId },
          io,
        );

        // M55 2026-05-30 — Auto-attach collaborator khi sale gửi tin virtual.
        // Sale chăm KH qua chat = counter "Cùng chăm" +1 (idempotent).
        // Fire-and-forget, không block response.
        if (conversation.contactId) {
          void attachContactCollaboratorByUser({
            orgId: user.orgId,
            contactId: conversation.contactId,
            userId: user.id,
            source: 'virtual_chat_message',
          });
        }

        return safeMessage;
      } catch (err) {
        logger.error('[chat] Virtual message save error:', err);
        return reply.status(500).send({ error: 'Failed to save virtual message' });
      }
    }
    // ── END M53 Virtual gate ───────────────────────────────────────────────

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // PRIVACY GUARD 2026-05-22: nick privacy='main' → chỉ chính chủ (owner) gửi được
    // qua UI. Bot/automation đi qua zaloPool trực tiếp (không qua route này) → vẫn OK.
    if (conversation.zaloAccount.privacyMode === 'main') {
      const senderUserId = (user as any).userId ?? user.id;
      if (conversation.zaloAccount.ownerUserId !== senderUserId) {
        return reply.status(403).send({
          error: 'Nick này đang bật Riêng tư — chỉ chính chủ mới gửi tin nhắn được. Vui lòng nhờ chủ nick gửi.',
          code: 'PRIVACY_LOCKED',
        });
      }
    }

    // Rate limit check — prevent account blocking
    const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) {
      return reply.status(429).send({ error: limits.reason });
    }

    try {
      // 2026-06-15 IDEMPOTENCY pre-check: nếu echoId đã tồn tại cho conversation này
      // → tin đã gửi Zalo thành công ở lần trước (app retry vì mất response). KHÔNG
      // gửi lại → trả về tin cũ (cùng shape) kèm echoId, coi như success.
      if (echoId) {
        const existing = await prisma.message.findUnique({
          where: { conversationId_clientEchoId: { conversationId: id, clientEchoId: echoId } },
          include: { repliedBy: { select: { id: true, fullName: true, email: true } } },
        });
        if (existing) {
          return {
            ...existing,
            zaloMsgIdNum: existing.zaloMsgIdNum?.toString() ?? null,
            echoId,
          };
        }
      }

      const threadId = conversation.externalThreadId || '';
      // zca-js sendMessage(message, threadId, type) — type: 0=User, 1=Group
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      let quote: ReturnType<typeof buildReplyQuote> | null = null;
      if (replyMessageId) {
        const replyMessage = await prisma.message.findFirst({
          where: { id: replyMessageId, conversationId: id },
          select: { zaloMsgId: true, senderUid: true, content: true, contentType: true, sentAt: true },
        });
        if (!replyMessage) {
          return reply.status(404).send({ error: 'Reply message not found' });
        }
        quote = buildReplyQuote(replyMessage);
        if (!quote) {
          return reply.status(400).send({ error: 'Reply message is missing remote ids' });
        }
      }

      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      // 2026-05-21 RTF: nếu có styles từ FE rich-text-editor → pass vào zca-js MessageContent.
      // zca-js sendMessage signature: { msg, styles?, quote?, ... } → Zalo server encode + broadcast format.
      const sendPayload: Record<string, unknown> = { msg: content };
      if (Array.isArray(styles) && styles.length > 0) {
        sendPayload.styles = styles;
      }
      if (quote) sendPayload.quote = quote;
      const sendResult = await instance.api.sendMessage(sendPayload, threadId, threadType);
      // zca-js trả về { message: { msgId } | null, attachment: [{ msgId }] }
      // Extract zaloMsgId từ message (text) hoặc attachment[0] (media) để dedup với selfListen
      const sr = sendResult as unknown as { message?: { msgId?: number | string } | null; attachment?: Array<{ msgId?: number | string }> };
      const rawId = sr?.message?.msgId ?? sr?.attachment?.[0]?.msgId ?? '';
      const zaloMsgId = String(rawId || '');
      if (!zaloMsgId) {
        logger.warn(`[chat] sendMessage không trả msgId — shape=${JSON.stringify(sendResult).slice(0, 200)}`);
      }

      // 2026-05-21 RTF: nếu có styles → lưu content dạng JSON rich (matches Zalo echo format)
      // + contentType='rich' để special-message-renderer render đúng bold/italic. Listener echo
      // sau dedup sẽ update content theo Zalo echo (cùng shape) → vẫn đẹp.
      const hasStyles = Array.isArray(styles) && styles.length > 0;
      const persistedContent = hasStyles
        ? JSON.stringify({ title: content, action: 'rtf', params: JSON.stringify({ styles }) })
        : content;
      const persistedContentType = hasStyles ? 'rich' : 'text';

      // ── Fix 2026-06-03 (Anh báo bug optimistic Sale CRM · Staff) ──
      // Set metadata.sender.name = user.fullName (M11 explicit) để socket
      // emit có đủ data → FE render badge "Sale CRM · {tên}" đúng ngay
      // optimistic, KHÔNG cần đợi reload page.
      // Include repliedBy relation trong response → defense in depth nếu
      // FE đọc theo repliedBy.fullName.
      let message;
      try {
        message = await prisma.message.create({
          data: {
            id: randomUUID(),
            conversationId: id,
            zaloMsgId: zaloMsgId || null,
            zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
            senderType: 'self',
            senderUid: conversation.zaloAccount.zaloUid || '',
            senderName: 'Staff',
            content: persistedContent,
            contentType: persistedContentType,
            quote: quote ?? undefined,
            sentAt: new Date(),
            repliedByUserId: user.id,
            sentVia: 'user',
            // 2026-06-15 IDEMPOTENCY: lưu echoId để dedup retry lần sau (null nếu app cũ).
            clientEchoId: echoId,
            metadata: {
              sender: { kind: 'user_crm', name: await getUserFullName(user.id) },
            },
          },
          include: { repliedBy: { select: { id: true, fullName: true, email: true } } },
        });
      } catch (createErr) {
        // 2026-06-15 IDEMPOTENCY RACE: 2 request cùng echoId chạy ~đồng thời → create
        // thứ 2 ném P2002 (unique violation conversationId_clientEchoId). Đã gửi Zalo
        // rồi nhưng tin đã được request kia lưu → query lại tin đó & trả về, KHÔNG 500.
        if (echoId && (createErr as { code?: string })?.code === 'P2002') {
          const winner = await prisma.message.findUnique({
            where: { conversationId_clientEchoId: { conversationId: id, clientEchoId: echoId } },
            include: { repliedBy: { select: { id: true, fullName: true, email: true } } },
          });
          if (winner) {
            return {
              ...winner,
              zaloMsgIdNum: winner.zaloMsgIdNum?.toString() ?? null,
              echoId,
            };
          }
        }
        throw createErr;
      }

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const aggInput = {
        conversationId: id,
        message: {
          id: message.id,
          content: message.content,
          contentType: message.contentType,
          sentAt: message.sentAt,
          senderType: 'self' as const,
        },
        outboundUserId: user.id,
      };
      void applyContactAggregateFromMessage(aggInput);
      void applyFriendAggregate(aggInput);

      // FIX 2026-05-21: BigInt zaloMsgIdNum không serialize được trong socket.io + JSON.
      // Cast trước khi emit + return.
      // 2026-06-15 IDEMPOTENCY: kèm echoId vào response + socket payload (chat:message)
      // để app khớp tin optimistic. null khi app cũ không gửi echoId.
      const safeMessage = { ...message, zaloMsgIdNum: message.zaloMsgIdNum?.toString() ?? null, echoId };
      const io = (app as any).io as Server;
      // PRIVACY 2026-06-11: redact server-side + scope org (emit-chat). Nick main →
      // room org nhận bản mờ, chính chủ đã unlock nhận bản thật ở room riêng.
      await emitChatMessage({
        io,
        orgId: user.orgId,
        accountId: conversation.zaloAccountId,
        conversationId: id,
        message: safeMessage,
        privacyMode: conversation.zaloAccount.privacyMode,
        ownerUserId: conversation.zaloAccount.ownerUserId,
        // 2026-06-15 IDEMPOTENCY: echoId ở top-level payload (ngoài message) để app
        // khớp tin optimistic kể cả khi message bị redact (nick Riêng tư).
        ...(echoId ? { extra: { echoId } } : {}),
      });

      return safeMessage;
    } catch (err) {
      logger.error('[chat] Send message error:', err);
      // 2026-06-09 (anh báo "Máy chủ lỗi" khi gửi tin): phân biệt lỗi ZALO nghiệp vụ
      // (vd "người này chặn không nhận tin từ người lạ") với lỗi hệ thống thật.
      // Lỗi Zalo có message tiếng Việt sẵn → trả 422 + message thật để sale HIỂU
      // (KHÔNG còn toast 500 "Máy chủ lỗi" che mất lý do). Lỗi khác giữ 500.
      const e = err as { name?: string; message?: string };
      const isZaloError =
        e?.name === 'ZaloApiError' ||
        e?.name === 'ZcaApiError' ||
        /ZaloApiError|ZcaApiError/.test(String(e?.name || '')) ||
        /chặn không nhận tin|người lạ|chưa thể gửi tin|Tham số không hợp lệ/i.test(String(e?.message || ''));
      if (isZaloError && e?.message) {
        return reply.status(422).send({ error: e.message, code: 'ZALO_SEND_REJECTED' });
      }
      return reply.status(500).send({ error: 'Không gửi được tin nhắn, vui lòng thử lại' });
    }
  });

  // ── Gửi cả 1 Khối Marketing vào hội thoại (cột 4 tab Automation) 2026-06-07 ──
  // Sale chọn Khối → gửi ĐỦ MỌI THÀNH PHẦN (text/image/album/file/video) theo ĐÚNG
  // THỨ TỰ, giữ rich-text styles, render {gender}/{name}/{sale}, có delay 0.8–2.5s
  // giữa các tin (chống Zalo coi spam). Tái dùng đường media đã chứng minh ở forward:
  // tải URL về tmp → đưa LOCAL PATH cho zca-js (attachments cần path, không nhận URL).
  //
  // KHÔNG idempotent: sale có thể gửi lại Khối. Chống double-send: FE disable nút khi
  // đang gửi; BE break khi gửi dở (đã gửi ≥1 tin mà tin sau lỗi → KHÔNG retry). KHÔNG
  // được bọc route này bằng retry kiểu BullMQ.
  app.post('/api/v1/conversations/:id/send-block', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { blockId } = (request.body ?? {}) as { blockId?: string };
    if (!blockId || typeof blockId !== 'string') {
      return reply.status(400).send({ error: 'blockId required' });
    }

    // ── Gate 1: load conversation ──────────────────────────────────────────
    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    // ── Gate 2: virtual conv = KH no-Zalo → không dispatch SDK được ────────
    if (conversation.isVirtual) {
      return reply.status(400).send({ error: 'Không thể gửi Khối vào hội thoại ảo (KH chưa có Zalo)' });
    }

    // ── Gate 3: nick đã kết nối ────────────────────────────────────────────
    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // ── Gate 4: privacy (nick 'main' chỉ chính chủ gửi) ────────────────────
    if (conversation.zaloAccount.privacyMode === 'main') {
      const senderUserId = (user as any).userId ?? user.id;
      if (conversation.zaloAccount.ownerUserId !== senderUserId) {
        return reply.status(403).send({
          error: 'Nick này đang bật Riêng tư — chỉ chính chủ mới gửi tin nhắn được. Vui lòng nhờ chủ nick gửi.',
          code: 'PRIVACY_LOCKED',
        });
      }
    }

    // ── Gate 5: rate-limit up-front (per-tin vẫn check trong zaloOps.exec) ──
    const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) {
      return reply.status(429).send({ error: limits.reason });
    }

    // ── Gate 6: load + authorize block (owner-scope như block-list) ────────
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'block',
    });
    const block = await prisma.block.findFirst({
      // 2026-06-18: lọc theo THƯ MỤC công khai/riêng tư (blockVisibilityWhere) — KHÔNG theo
      // người tạo (applyOwnerScope cũ) → sale gửi được khối CÔNG KHAI do người khác tạo,
      // nhưng vẫn KHÔNG gửi được khối riêng tư của người khác. Đồng bộ với màn chọn khối.
      where: { id: blockId, orgId: user.orgId, archivedAt: null, ...blockVisibilityWhere(ownerScope, user.id) },
    });
    if (!block) return reply.status(404).send({ error: 'block not found' });
    if (block.actionType !== 'send_message') {
      return reply.status(422).send({
        error: 'UNSUPPORTED_BLOCK',
        detail: 'Chỉ Khối gửi tin (send_message) mới gửi được từ chat',
      });
    }

    // ── Resolve Khối → danh sách tin theo ĐÚNG THỨ TỰ (module dùng chung) ──
    const resolveResult = resolveBlockContent('send_message', block.content as Record<string, unknown>);
    if (!resolveResult.ok || resolveResult.resolved.length === 0) {
      return reply.status(422).send({ error: resolveResult.error ?? 'BLOCK_EMPTY', detail: resolveResult.detail });
    }
    const resolved = resolveResult.resolved;
    if (resolved.length > 20) {
      return reply.status(422).send({ error: 'TOO_MANY_COMPONENTS', detail: 'Khối tối đa 20 thành phần khi gửi từ chat' });
    }

    const threadId = conversation.externalThreadId || '';
    const threadType = conversation.threadType === 'group' ? 1 : 0;
    const contactId = conversation.contactId;
    const zaloAccountId = conversation.zaloAccountId;
    const userFullName = await getUserFullName(user.id);
    const io = (app as any).io as Server;
    // Bubble hiện như tin sale bình thường; attribution Khối trong metadata.detail/blockId.
    const senderMeta = {
      sender: { kind: 'user_crm' as const, name: userFullName, detail: `Khối: ${block.name}`, blockId: block.id },
    };

    // ── STUB QA: không chạm Zalo, log chuỗi resolved đã render ─────────────
    if (process.env.AUTOMATION_STUB_MODE === 'true') {
      const seq = resolved.map((m) => m.messageType).join(' → ');
      logger.info(`[send-block STUB] would send ${resolved.length} tin (${seq}) từ nick=${zaloAccountId} → conv=${id} block="${block.name}"`);
      return { ok: true, sentCount: resolved.length, totalMessages: resolved.length, partial: false, errors: [], stub: true };
    }

    // Render caption media (có thể chứa {name}) — helper nhỏ.
    const renderCaption = (cap?: string) =>
      cap && contactId ? renderTemplate(cap, contactId, zaloAccountId) : Promise.resolve(cap ?? '');

    // 2026-06-13 (anh báo timeout): gửi Khối media mất >30s (nhiều tin + delay chống spam + tải
    // media + video retry) → FE axios timeout 30s báo lỗi DÙ đã gửi xong. Anh chốt: GỬI NỀN — trả về
    // NGAY {accepted}, vòng gửi chạy detached. Tin vẫn hiện live qua socket (emitChatMessage mỗi tin).
    // Lỗi từng tin chỉ log (không có HTTP response để trả). Gate validation phía trên VẪN đồng bộ.
    void (async () => {
    let sentCount = 0;
    const errors: Array<{ index: number; type: string; message: string }> = [];
    let lastMessageRow: { id: string; content: string | null; contentType: string; sentAt: Date } | null = null;

    for (let i = 0; i < resolved.length; i++) {
      const m = resolved[i];
      if (i > 0) await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 1700))); // 0.8–2.5s

      const cleanups: Array<() => Promise<void>> = [];
      // 1 component → 1+ tin cần persist. Album = N ảnh gửi riêng từng cái (mỗi cái
      // 1 zaloMsgId riêng → tránh đụng @@unique([conversationId, zaloMsgId])).
      // content lưu THEO shape chat UI native render: image {href,thumb,size},
      // file {href,name,size,mime}, video {href,thumb,...} (khớp chat-attachment-routes).
      // album*: gom N ảnh album thành 1 cụm trong CRM (message-bubble gom theo albumKey).
      const toPersist: Array<{ sdkResult: unknown; content: string; contentType: string; albumKey?: string; albumIndex?: number; albumTotal?: number }> = [];
      try {
        if (m.messageType === 'text') {
          // D6 (2026-06-13): GIỮ format khi có biến — dịch offset style theo giá trị thật (an toàn).
          const rawStyles = Array.isArray(m.payload.styles) ? m.payload.styles : [];
          let rendered = m.payload.text;
          let styles = rawStyles;
          if (contactId) {
            const det = await renderTemplateDetailed(m.payload.text, contactId, zaloAccountId);
            rendered = det.rendered;
            styles = rawStyles.length ? (shiftStylesForRender(m.payload.text, rawStyles, det.values) ?? []) : rawStyles;
          }
          const useStyles = styles.length > 0;
          const sendPayload: Record<string, unknown> = { msg: rendered };
          if (useStyles) sendPayload.styles = styles;
          const sdkResult = await zaloOps.sendMessage(zaloAccountId, threadId, threadType, sendPayload, io);
          toPersist.push({
            sdkResult,
            content: useStyles
              ? JSON.stringify({ title: rendered, action: 'rtf', params: JSON.stringify({ styles }) })
              : rendered,
            contentType: useStyles ? 'rich' : 'text',
          });
        } else if (m.messageType === 'image') {
          const caption = await renderCaption(m.payload.caption);
          const dl = await downloadMediaToTemp({ url: m.payload.url }, 'image');
          cleanups.push(dl.cleanup);
          const sdkResult = await zaloOps.sendFile(zaloAccountId, threadId, threadType, [dl.path], io, caption);
          toPersist.push({
            sdkResult,
            content: JSON.stringify({ href: m.payload.url, thumb: m.payload.url, size: 0 }),
            contentType: 'image',
          });
        } else if (m.messageType === 'album') {
          // D2 (2026-06-13): THỐNG NHẤT với automation — gửi GỘP 1 cụm album (sendImage nhiều path)
          // thay vì từng ảnh lẻ, để khách thấy GIỐNG nhau dù gửi tay hay tự động. Cap 12 ảnh/lần.
          const allItems = m.payload.items.slice(0, 12);
          if (m.payload.items.length > 12) {
            logger.warn(`[send-block] album ${m.payload.items.length} ảnh > 12 — chỉ gửi 12 ảnh đầu (giới hạn SDK).`);
          }
          const paths: string[] = [];
          for (const it of allItems) {
            const dl = await downloadMediaToTemp({ url: it.url }, 'image');
            cleanups.push(dl.cleanup);
            paths.push(dl.path);
          }
          const albumCaption = await renderCaption(allItems[0]?.caption);
          const sdkResult = await zaloOps.sendImage(zaloAccountId, threadId, threadType, paths, io, albumCaption);
          // Khách nhận 1 cụm album (gửi gộp). CRM render mỗi ảnh = 1 Message {href,thumb} NHƯNG gắn
          // albumKey/albumIndex/albumTotal để message-bubble GOM lại thành 1 album (MessageThread:2302).
          // sdkResult gắn ảnh đầu (lấy zaloMsgId), ảnh sau để trống id.
          const albumKey = randomUUID();
          allItems.forEach((it, k) => {
            toPersist.push({
              sdkResult: k === 0 ? sdkResult : {},
              content: JSON.stringify({ href: it.url, thumb: it.url, size: 0 }),
              contentType: 'image',
              albumKey, albumIndex: k, albumTotal: allItems.length,
            });
          });
        } else if (m.messageType === 'video') {
          const caption = await renderCaption(m.payload.caption);
          const dl = await downloadMediaToTemp({ url: m.payload.url }, 'video');
          cleanups.push(dl.cleanup);
          let sdkResult: unknown;
          try {
            sdkResult = await sendNativeVideo({ api: instance.api as any, threadId, threadType, videoPath: dl.path });
          } catch (vErr) {
            logger.warn('[send-block] native video lỗi, fallback sendFile:', vErr);
            sdkResult = await zaloOps.sendFile(zaloAccountId, threadId, threadType, [dl.path], io, caption);
          }
          const thumb = m.payload.thumbnailUrl ?? m.payload.url;
          toPersist.push({
            sdkResult,
            content: JSON.stringify({ href: m.payload.url, thumb, thumbUrl: thumb, thumbnail: thumb, size: 0 }),
            contentType: 'video',
          });
        } else if (m.messageType === 'file') {
          const caption = await renderCaption(m.payload.caption);
          // 2026-06-13: block file thường chỉ có url+mediaAssetId → truy Kho lấy đủ tên+mime+size.
          const meta = await resolveMediaMeta(m.payload.mediaAssetId, { filename: m.payload.filename, mimeType: m.payload.mimeType, sizeBytes: m.payload.sizeBytes });
          // D4: suy tên+đuôi đúng (buildSendFileName) — tránh khách nhận file .bin.
          const sendName = buildSendFileName(
            { name: meta.name, originalFilename: meta.name || null },
            { mimeType: meta.mime, publicUrl: m.payload.url },
          );
          const dl = await downloadMediaToTemp({ url: m.payload.url, filename: sendName }, 'file');
          cleanups.push(dl.cleanup);
          const sdkResult = await zaloOps.sendFile(zaloAccountId, threadId, threadType, [dl.path], io, caption);
          toPersist.push({
            sdkResult,
            // name+mime+size đủ → CRM message-bubble getFileInfo hiện file-card (không rơi về '🔗 url').
            // mime trống → ép octet-stream (vẫn !=rỗng + !image → getFileInfo nhận).
            content: JSON.stringify({ href: m.payload.url, name: sendName, size: meta.size || 0, mime: meta.mime || 'application/octet-stream' }),
            contentType: 'file',
          });
        } else {
          continue; // friend_request / update_status không áp dụng cho send_message block
        }

        for (const p of toPersist) {
          const zaloMsgId = extractZaloMsgId(p.sdkResult);
          const created = await prisma.message.create({
            data: {
              id: randomUUID(),
              conversationId: id,
              zaloMsgId: zaloMsgId || null,
              zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
              senderType: 'self',
              senderUid: conversation.zaloAccount.zaloUid || '',
              senderName: 'Staff',
              content: p.content,
              contentType: p.contentType,
              sentAt: new Date(),
              repliedByUserId: user.id,
              sentVia: 'user',
              metadata: senderMeta,
              // album: gom N ảnh thành 1 cụm trong CRM (message-bubble gom theo albumKey).
              ...(p.albumKey ? { albumKey: p.albumKey, albumIndex: p.albumIndex, albumTotal: p.albumTotal } : {}),
            },
            select: { id: true, content: true, contentType: true, sentAt: true, zaloMsgId: true, zaloMsgIdNum: true, senderType: true, senderUid: true, senderName: true, conversationId: true, repliedByUserId: true, sentVia: true, metadata: true, albumKey: true, albumIndex: true, albumTotal: true },
          });
          lastMessageRow = { id: created.id, content: created.content, contentType: created.contentType, sentAt: created.sentAt };
          sentCount++;

          const safeMessage = { ...created, zaloMsgIdNum: created.zaloMsgIdNum?.toString() ?? null };
          // PRIVACY 2026-06-11: redact + scope org (emit-chat).
          await emitChatMessage({
            io,
            orgId: user.orgId,
            accountId: zaloAccountId,
            conversationId: id,
            message: safeMessage,
            privacyMode: conversation.zaloAccount.privacyMode,
            ownerUserId: conversation.zaloAccount.ownerUserId,
          });
        }
        // D3 (2026-06-13): gửi media qua Khối (gửi tay) → bump usageCount để đo ảnh/file hiệu quả.
        // Fire-and-forget, không chặn. album: bump từng item; image/video/file: 1 id.
        {
          const p = m.payload as Record<string, unknown>;
          const ids: string[] = m.messageType === 'album'
            ? ((p.items as Array<{ mediaAssetId?: string }>) ?? []).map((it) => it.mediaAssetId).filter((x): x is string => !!x)
            : (m.messageType === 'image' || m.messageType === 'video' || m.messageType === 'file') && p.mediaAssetId
              ? [p.mediaAssetId as string]
              : [];
          for (const aid of ids) bumpUsage(aid).catch(() => {});
        }
      } catch (err: any) {
        const code = err?.code as string | undefined;
        const msg = err?.message ?? String(err);
        errors.push({ index: i, type: m.messageType, message: msg });
        // GỬI NỀN: không còn HTTP response để trả lỗi → chỉ LOG + dừng (tin đã stream live qua socket;
        // FE đã nhận {accepted} từ trước). Lỗi tin đầu = không gửi được gì, sale gửi lại được.
        logger.warn(`[send-block] tin ${i + 1}/${resolved.length} (${m.messageType}) lỗi [${code ?? '?'}]: ${msg} — dừng (đã gửi ${sentCount} tin)`);
        break;
      } finally {
        for (const c of cleanups) await c().catch(() => {});
      }
    }

    if (sentCount === 0) {
      logger.warn(`[send-block] KHÔNG gửi được tin nào (conv=${id} block="${block.name}") errors=${JSON.stringify(errors)}`);
      return; // thoát IIFE nền — FE đã nhận {accepted}, lỗi này chỉ log.
    }

    // Cập nhật aggregate (theo tin cuối) + bump usage Khối.
    if (lastMessageRow) {
      try {
        await prisma.conversation.update({
          where: { id },
          data: { lastMessageAt: lastMessageRow.sentAt, isReplied: true, unreadCount: 0 },
        });
      } catch (err) {
        logger.warn(`[send-block] conversation aggregate update failed (conv=${id}):`, err);
      }
      const aggInput = {
        conversationId: id,
        message: {
          id: lastMessageRow.id,
          content: lastMessageRow.content,
          contentType: lastMessageRow.contentType,
          sentAt: lastMessageRow.sentAt,
          senderType: 'self' as const,
        },
        outboundUserId: user.id,
      };
      void applyContactAggregateFromMessage(aggInput);
      void applyFriendAggregate(aggInput);
    }
    // Bump cả usageCount (tổng) + manualSendCount (RIÊNG gửi tay, không tính automation).
    void prisma.block.update({
      where: { id: block.id },
      data: {
        lastUsedAt: new Date(),
        usageCount: { increment: 1 },
        manualSendCount: { increment: 1 },
        lastManualSentAt: new Date(),
      },
    }).catch((err) => logger.warn(`[send-block] bump usage failed: ${err}`));

    logger.info(`[send-block] sent ${sentCount}/${resolved.length} tin từ nick=${zaloAccountId} → conv=${id} block="${block.name}"`);
    })().catch((err) => logger.error(`[send-block] vòng gửi nền lỗi: ${err?.message ?? err}`));

    // GỬI NỀN: trả về NGAY (không chờ vòng gửi) → FE báo "đang gửi", tin hiện live qua socket,
    // KHÔNG bao giờ timeout. totalMessages để FE hiển thị tiến độ mong đợi.
    return { ok: true, accepted: true, totalMessages: resolved.length };
  });

  // ── Upload image(s) and send qua Zalo (paste image / nút Gửi ảnh) ────────
  app.post('/api/v1/conversations/:id/upload-image', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });
    if (!conversation.externalThreadId) return reply.status(400).send({ error: 'No external thread ID' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

    const path = await import('node:path');
    const os = await import('node:os');
    const fs = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');

    const tmpFiles: string[] = [];
    try {
      const parts = (request as unknown as { parts(): AsyncIterable<{ type: string; file: NodeJS.ReadableStream; filename: string }> }).parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.file) {
          const safeName = (part.filename || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
          const tmpPath = path.join(os.tmpdir(), `zalo-upload-${randomUUID()}-${safeName}`);
          await pipeline(part.file, fs.createWriteStream(tmpPath));
          tmpFiles.push(tmpPath);
        }
      }
      if (!tmpFiles.length) return reply.status(400).send({ error: 'No files uploaded' });

      const threadType = conversation.threadType === 'group' ? 1 : 0;
      zaloRateLimiter.recordSend(conversation.zaloAccountId);

      // Bước 1: upload lên Zalo CDN trước để lấy URLs thật (hdUrl/normalUrl/thumbUrl)
      // Phải làm trước vì sendMessage chỉ trả {msgId}, không lộ URLs.
      const uploadResults = await instance.api.uploadAttachment(tmpFiles, conversation.externalThreadId, threadType);

      // Bước 2: send message — zca-js sẽ re-upload (chấp nhận để có URLs đúng từ bước 1)
      const sendResult = await instance.api.sendMessage(
        { msg: '', attachments: tmpFiles },
        conversation.externalThreadId,
        threadType,
      );

      // zca-js trả { message, attachment: [{msgId}, ...] } — match với uploadResults theo index
      const sr = sendResult as unknown as {
        message?: { msgId?: number | string } | null;
        attachment?: Array<{ msgId?: number | string }>;
      };

      // Tạo Message rows với URLs thật từ uploadResults
      const createdMessages = [];
      for (let i = 0; i < uploadResults.length; i++) {
        const up = uploadResults[i] as unknown as {
          fileType: 'image' | 'video' | 'others';
          hdUrl?: string; normalUrl?: string; thumbUrl?: string;
          fileUrl?: string; fileName?: string; totalSize?: number;
          width?: number; height?: number;
        };
        const zaloMsgId = String(sr.attachment?.[i]?.msgId || '');

        let content: string;
        let contentType: string;
        if (up.fileType === 'image') {
          content = JSON.stringify({
            hdUrl: up.hdUrl || up.normalUrl || '',
            href: up.normalUrl || up.hdUrl || '',
            thumb: up.thumbUrl || up.normalUrl || '',
            thumbUrl: up.thumbUrl || '',
            normalUrl: up.normalUrl || '',
            width: up.width, height: up.height,
          });
          contentType = 'image';
        } else if (up.fileType === 'video') {
          content = JSON.stringify({ href: up.fileUrl || '', fileName: up.fileName, totalSize: up.totalSize });
          contentType = 'video';
        } else {
          content = JSON.stringify({ href: up.fileUrl || '', fileName: up.fileName, totalSize: up.totalSize });
          contentType = 'file';
        }

        const msg = await prisma.message.create({
          data: {
            id: randomUUID(),
            conversationId: id,
            zaloMsgId: zaloMsgId || null,
            zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
            senderType: 'self',
            senderUid: conversation.zaloAccount.zaloUid || '',
            senderName: 'Staff',
            content,
            contentType,
            sentAt: new Date(),
            repliedByUserId: user.id,
            sentVia: 'user',
            // Fix 2026-06-03 (Anh báo): optimistic badge "Sale CRM · Staff"
            metadata: {
              sender: { kind: 'user_crm', name: await getUserFullName(user.id) },
            },
          },
          include: { repliedBy: { select: { id: true, fullName: true, email: true } } },
        });
        createdMessages.push(msg);
      }

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      for (const m of createdMessages) {
        // PRIVACY 2026-06-11: redact + scope org (emit-chat).
        await emitChatMessage({
          io,
          orgId: user.orgId,
          accountId: conversation.zaloAccountId,
          conversationId: id,
          message: m,
          privacyMode: conversation.zaloAccount.privacyMode,
          ownerUserId: conversation.zaloAccount.ownerUserId,
        });
      }

      return { success: true, count: tmpFiles.length, messages: createdMessages };
    } catch (err) {
      logger.error('[chat] Upload image error:', err);
      return reply.status(500).send({ error: 'Upload failed', detail: String(err) });
    } finally {
      // Cleanup tmp files
      for (const f of tmpFiles) {
        fs.promises.unlink(f).catch(() => { /* ignore */ });
      }
    }
  });

  // ── Mark conversation as read ────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/mark-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { unreadCount: 0 },
    });

    return { success: true };
  });

  // ── POST /chat/send-handoff ─ gửi tin nội bộ giữa 2 nick CRM (sale-to-sale). 2026-05-22 ─
  // Dùng cho tab "🎯 CRM" widget "Đồng đội cùng chăm KH": sale A (đang online nick X)
  // nhắn nick chính (target nick) của sale B đang cùng chăm KH này.
  //
  // Body: { senderZaloAccountId, targetUserId, content }
  // Response: { success: true, zaloMsgId, targetNickName, targetZaloUidInSenderView }
  //
  // CỐT LÕI per-nick UID trap (memory ref):
  //   Zalo UID là per-account perspective. ZaloAccount.zaloUid của Evo Sport là UID
  //   Evo Sport tự xưng. Khi Thành Phạm gọi sendMessage(threadId=Evo-Sport-uid),
  //   Zalo trả "Tham số không hợp lệ" vì sender không nhìn thấy threadId ấy.
  //   Phải dùng Friend.zaloUidInNick (perspective sender → target identity).
  //
  // Lookup chain:
  //   1. targetUserId → các ZaloAccount của user (ưu tiên main)
  //   2. Mỗi target nick lấy phone → normalize
  //   3. Tìm Contact phoneNormalized match trong org → Friend per (sender, contact)
  //   4. Dùng Friend.zaloUidInNick làm threadId → sendMessage
  //   5. Nếu không có match → báo lỗi rõ "sender chưa kết bạn nick target"
  app.post('/api/v1/chat/send-handoff', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = request.body as { senderZaloAccountId?: string; targetUserId?: string; content?: string };
    if (!body.senderZaloAccountId) return reply.status(400).send({ error: 'senderZaloAccountId required' });
    if (!body.targetUserId) return reply.status(400).send({ error: 'targetUserId required' });
    if (!body.content?.trim()) return reply.status(400).send({ error: 'content required' });
    if (body.content.length > 2000) return reply.status(400).send({ error: 'Tin quá dài (tối đa 2000 ký tự)' });

    // Verify sender nick thuộc cùng org + user có access
    const senderNick = await prisma.zaloAccount.findFirst({
      where: { id: body.senderZaloAccountId, orgId: user.orgId },
      select: { id: true, ownerUserId: true, status: true, displayName: true },
    });
    if (!senderNick) return reply.status(404).send({ error: 'Sender nick not found' });

    if (!['owner', 'admin'].includes(user.role)) {
      const access = await prisma.zaloAccountAccess.findFirst({
        where: { zaloAccountId: senderNick.id, userId: user.id },
        select: { permission: true },
      });
      const isOwnerOfNick = senderNick.ownerUserId === user.id;
      if (!access && !isOwnerOfNick) {
        return reply.status(403).send({ error: 'Không có quyền gửi từ nick này' });
      }
    }

    const instance = zaloPool.getInstance(senderNick.id);
    if (!instance?.api) {
      return reply.status(400).send({ error: 'Nick gửi chưa kết nối Zalo — vui lòng đăng nhập lại nick này' });
    }

    // Lấy danh sách nick của target sale, ưu tiên main, có zaloUid + phone
    const targetNicks = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId, ownerUserId: body.targetUserId, zaloUid: { not: null } },
      orderBy: [{ privacyMode: 'asc' }, { lastConnectedAt: 'desc' }],
      select: { id: true, zaloUid: true, displayName: true, phone: true },
    });

    if (!targetNicks.length) {
      return reply.status(404).send({ error: 'Sale target chưa có nick Zalo đăng nhập CRM' });
    }

    // 2-tier lookup để có threadId hợp lệ (per-nick UID perspective):
    //   Tier 1 — Friend.zaloUidInNick (sender đã kết bạn target qua Zalo)
    //   Tier 2 — instance.api.findUser(phone) (sender chưa kết bạn, Zalo SDK resolve UID
    //            cho perspective của sender. Tốn 1 Zalo API call nhưng OK vì handoff
    //            không phải hot path.)
    let threadId: string | null = null;
    let targetNickName: string | null = null;
    let lookupVia: 'friend' | 'findUser' | null = null;
    for (const tn of targetNicks) {
      const phone = normalizePhone(tn.phone);
      if (!phone) continue;

      // Tier 1: đã kết bạn → dùng Friend.zaloUidInNick (clean, không tốn Zalo API)
      const friend = await prisma.friend.findFirst({
        where: {
          orgId: user.orgId,
          zaloAccountId: senderNick.id,
          contact: { phoneNormalized: phone },
        },
        select: { zaloUidInNick: true },
      });
      if (friend?.zaloUidInNick) {
        threadId = friend.zaloUidInNick;
        targetNickName = tn.displayName;
        lookupVia = 'friend';
        break;
      }

      // Tier 2: chưa kết bạn → findUser(phone) qua Zalo SDK
      try {
        const found = await (instance.api as unknown as { findUser?: (p: string) => Promise<{ uid?: string | number } | null> }).findUser?.(phone);
        const uid = found?.uid != null ? String(found.uid) : null;
        if (uid) {
          threadId = uid;
          targetNickName = tn.displayName;
          lookupVia = 'findUser';
          break;
        }
      } catch (e: unknown) {
        logger.warn(`[chat/send-handoff] findUser fail phone=${phone}: ${(e as Error).message}`);
      }
    }

    if (!threadId) {
      return reply.status(404).send({
        error: `Không tìm được nick Zalo của sale target — nick target có thể chưa có số điện thoại hoặc Zalo chặn search. Vui lòng kết bạn thủ công trước.`,
      });
    }

    // Rate-limit gating
    const limits = await zaloRateLimiter.checkLimits(senderNick.id);
    if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

    try {
      zaloRateLimiter.recordSend(senderNick.id);
      const sendResult = await instance.api.sendMessage({ msg: body.content }, threadId, 0);
      const sr = sendResult as unknown as { message?: { msgId?: number | string } | null };
      const zaloMsgId = String(sr?.message?.msgId ?? '');
      // Listener echo sẽ tự lưu Message + Conversation vào DB qua message-handler
      return {
        success: true,
        zaloMsgId,
        targetNickName,
        targetZaloUidInSenderView: threadId,
        lookupVia,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[chat/send-handoff] failed: ${msg}`);
      return reply.status(500).send({ error: 'Gửi tin nội bộ thất bại — ' + msg });
    }
  });

  // ── Move conversation to a different tab (main / other) ────────────────
  app.patch('/api/v1/conversations/:id/tab', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { tab } = request.body as { tab: string };

    if (!tab || !['main', 'other'].includes(tab)) {
      return reply.status(400).send({ error: 'tab must be "main" or "other"' });
    }

    const updated = await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { tab },
    });

    if (updated.count === 0) return reply.status(404).send({ error: 'Conversation not found' });
    return { success: true, tab };
  });

  // ── Soft-delete (ẩn) đoạn hội thoại từ cột 2 ───────────────────────────────
  // 2026-06-11 (anh chốt) — xóa MỀM: set deletedAt, KHÔNG xóa Message vật lý.
  // Hội thoại biến mất khỏi list/count nhưng có thể khôi phục (POST .../restore).
  // Scope orgId + requireZaloAccess('chat') để tránh xóa chéo tenant/nick (privacy).
  app.delete('/api/v1/conversations/:id', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const updated = await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    if (updated.count === 0) return reply.status(404).send({ error: 'Conversation not found' });
    return { success: true };
  });

  // Khôi phục hội thoại đã ẩn (dự phòng — chưa gắn UI, để có đường khôi phục).
  app.post('/api/v1/conversations/:id/restore', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const updated = await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { deletedAt: null },
    });

    if (updated.count === 0) return reply.status(404).send({ error: 'Conversation not found' });
    return { success: true };
  });
}
