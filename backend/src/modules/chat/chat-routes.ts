/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { applyContactAggregateFromMessage, applyFriendAggregate } from '../contacts/contact-aggregate.js';

type QueryParams = Record<string, string>;

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
    const { accountId = '', tab = '' } = request.query as QueryParams;

    const baseWhere: any = { orgId: user.orgId };
    if (accountId) baseWhere.zaloAccountId = accountId;
    if (tab) baseWhere.tab = tab;

    // Members can only see conversations from Zalo accounts they have access to
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.zaloAccountAccess.findMany({
        where: { userId: user.id },
        select: { zaloAccountId: true },
      });
      const accessibleIds = accessibleAccounts.map((a) => a.zaloAccountId);
      // Intersect with user-selected account filter if present
      if (accountId && accessibleIds.includes(accountId)) {
        baseWhere.zaloAccountId = accountId;
      } else {
        baseWhere.zaloAccountId = { in: accessibleIds };
      }
    }

    const [unread, unreplied, total] = await Promise.all([
      prisma.conversation.count({ where: { ...baseWhere, unreadCount: { gt: 0 } } }),
      prisma.conversation.count({ where: { ...baseWhere, isReplied: false } }),
      prisma.conversation.count({ where: baseWhere }),
    ]);

    return { unread, unreplied, total };
  });

  // ── List conversations (paginated, filterable) ──────────────────────────
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
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
    } = request.query as QueryParams;

    const where: any = { orgId: user.orgId };
    if (tab) where.tab = tab;
    if (threadType === 'user' || threadType === 'group') where.threadType = threadType;

    // accountIds CSV ưu tiên hơn accountId single (multi-nick FE)
    const accountIdList = accountIds
      ? accountIds.split(',').map(s => s.trim()).filter(Boolean)
      : accountId ? [accountId] : [];
    if (accountIdList.length === 1) where.zaloAccountId = accountIdList[0];
    else if (accountIdList.length > 1) where.zaloAccountId = { in: accountIdList };

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
      if (tagList.length > 0) contactWhere.tags = { array_contains: tagList };
    }
    // KH có ít nhất 1 Friend với kind trong list (Friend level filter)
    if (relationshipKindAny) {
      const kinds = relationshipKindAny.split(',').map(s => s.trim()).filter(Boolean);
      if (kinds.length > 0) contactWhere.friends = { some: { relationshipKind: { in: kinds } } };
    }
    if (Object.keys(contactWhere).length > 0) where.contact = contactWhere;

    // Advanced filters
    if (unread === 'true') where.unreadCount = { gt: 0 };
    if (unreplied === 'true') where.isReplied = false;

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

    // Members can only see conversations from Zalo accounts they have access to
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.zaloAccountAccess.findMany({
        where: { userId: user.id },
        select: { zaloAccountId: true },
      });
      const accessibleIds = accessibleAccounts.map((a) => a.zaloAccountId);
      // Intersect requested account list với accessible
      if (accountIdList.length > 0) {
        const allowed = accountIdList.filter(id => accessibleIds.includes(id));
        where.zaloAccountId = allowed.length === 1 ? allowed[0] : { in: allowed };
      } else {
        where.zaloAccountId = { in: accessibleIds };
      }
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          // Contact: full include thay vì select hẹp — tránh race khi list refresh
          // overwrite mất gender/totals/birthDate/... đã load ở /conversations/:id detail.
          contact: true,
          zaloAccount: { select: { id: true, displayName: true, avatarUrl: true, zaloUid: true } },
          pins: { select: { id: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { id: true, zaloMsgId: true, senderUid: true, senderName: true, content: true, contentType: true, senderType: true, sentAt: true, isDeleted: true, reactions: { select: { emoji: true, reactorId: true } } },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (parseInt(page) - 1) * Math.min(parseInt(limit), 200),
        take: Math.min(parseInt(limit), 200),
      }),
      prisma.conversation.count({ where }),
    ]);

    // Batch fetch Friend records cho user threads để FE biết friendship state
    const userPairs = conversations
      .filter(c => c.threadType === 'user' && c.contactId)
      .map(c => ({ zaloAccountId: c.zaloAccountId, contactId: c.contactId! }));
    let friendMap = new Map<string, {
      relationshipKind: string; friendshipStatus: string;
      becameFriendAt: Date | null; firstMessageAt: Date | null;
      crmTagsPerNick: unknown;
    }>();
    if (userPairs.length) {
      const friends = await prisma.friend.findMany({
        where: { OR: userPairs.map(p => ({ AND: [{ zaloAccountId: p.zaloAccountId }, { contactId: p.contactId }] })) },
        select: {
          zaloAccountId: true, contactId: true,
          relationshipKind: true, friendshipStatus: true,
          becameFriendAt: true, firstMessageAt: true,
          crmTagsPerNick: true,                // per-pair CRM tags (kèm Zalo-mirrored "🔵 X")
        },
      });
      friendMap = new Map(friends.map(f => [`${f.zaloAccountId}:${f.contactId}`, {
        relationshipKind: f.relationshipKind,
        friendshipStatus: f.friendshipStatus,
        becameFriendAt: f.becameFriendAt,
        firstMessageAt: f.firstMessageAt,
        crmTagsPerNick: f.crmTagsPerNick,
      }]));
    }

    return {
      conversations: conversations.map((c) => ({
        ...c,
        isPinned: c.pins.length > 0,
        friendship: c.contactId ? friendMap.get(`${c.zaloAccountId}:${c.contactId}`) || null : null,
      })),
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
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true } },
        pins: { select: { id: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

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
      totalInbound: number;
      totalOutbound: number;
      leadScore: number;
      statusRef: { id: string; name: string; color: string | null; order: number } | null;
      zaloLabels: unknown;
      crmTagsPerNick: unknown;
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
          totalInbound: true,
          totalOutbound: true,
          leadScore: true,
          statusRef: { select: { id: true, name: true, color: true, order: true } },
          zaloLabels: true,
          crmTagsPerNick: true,
        },
      });
      friendship = f;
    }

    return { ...conversation, isPinned: conversation.pins.length > 0, friendship };
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
        await prisma.contact.update({ where: { id: conv.contactId }, data: contactPatch });
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
  app.get('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50' } = request.query as QueryParams;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { sentAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        select: {
          id: true,
          zaloMsgId: true,
          senderUid: true,
          senderName: true,
          content: true,
          contentType: true,
          senderType: true,
          sentAt: true,
          isDeleted: true,
          quote: true,
          attachments: true,
          albumKey: true,
          albumIndex: true,
          albumTotal: true,
          reactions: { select: { emoji: true, reactorId: true } },
        },
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

    return { messages: messages.reverse(), total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Send message ─────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { content, replyMessageId } = request.body as { content: string; replyMessageId?: string };

    if (!content?.trim()) return reply.status(400).send({ error: 'Content required' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // Rate limit check — prevent account blocking
    const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) {
      return reply.status(429).send({ error: limits.reason });
    }

    try {
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
      const sendResult = await instance.api.sendMessage(quote ? { msg: content, quote } : { msg: content }, threadId, threadType);
      // zca-js trả về { message: { msgId } | null, attachment: [{ msgId }] }
      // Extract zaloMsgId từ message (text) hoặc attachment[0] (media) để dedup với selfListen
      const sr = sendResult as unknown as { message?: { msgId?: number | string } | null; attachment?: Array<{ msgId?: number | string }> };
      const rawId = sr?.message?.msgId ?? sr?.attachment?.[0]?.msgId ?? '';
      const zaloMsgId = String(rawId || '');
      if (!zaloMsgId) {
        logger.warn(`[chat] sendMessage không trả msgId — shape=${JSON.stringify(sendResult).slice(0, 200)}`);
      }

      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          zaloMsgId: zaloMsgId || null,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content,
          contentType: 'text',
          quote: quote ?? undefined,
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
      });

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

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err) {
      logger.error('[chat] Send message error:', err);
      return reply.status(500).send({ error: 'Failed to send message' });
    }
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
            senderType: 'self',
            senderUid: conversation.zaloAccount.zaloUid || '',
            senderName: 'Staff',
            content,
            contentType,
            sentAt: new Date(),
            repliedByUserId: user.id,
          },
        });
        createdMessages.push(msg);
      }

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      for (const m of createdMessages) {
        io?.emit('chat:message', { accountId: conversation.zaloAccountId, message: m, conversationId: id });
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
}
