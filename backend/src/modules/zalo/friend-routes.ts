// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * friend-routes.ts — REST API for Zalo friend management.
 * Ports openzca friend commands: queries, requests, management, privacy.
 * All routes scoped to /api/v1/zalo-accounts/:accountId/friends and require JWT auth.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { resolveAccount, checkAccess, handleError, getAccessibleZaloAccountIds } from './zalo-route-helpers.js';
import { getZaloScope } from './zalo-scope.js';
import { markFriendRequestSent } from './friend-event-handler.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { normalizePhone } from '../../shared/utils/phone.js';
import { FRIEND_INCLUDE_WITH_CONTACT, toFriendDto } from '../../shared/friend-serializer.js';
import { syncAccountFully } from './friend-sync-service.js';
import { zaloPool } from './zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';
import { createHash } from 'node:crypto';

// Phase metrics layer 2026-05-22: hash SĐT trước khi log để privacy + dedup.
function hashPhone(phone: string): string {
  return createHash('sha256').update(phone.trim()).digest('hex');
}

const BASE = '/api/v1/zalo-accounts/:accountId/friends';

export async function friendRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── DB-backed friend list (preferred over live for /friends UI) ───────────

  // GET .../friends-db?kind=...&page=1&limit=25&search=...&sortBy=recent|score-desc|score-asc|stuck
  app.get(`${BASE}-db`, { preHandler: requireGrant('friend', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const {
      kind = 'all',
      page = '1',
      limit = '25',
      search = '',
      sortBy = 'recent',
      statusId = '',
    } = request.query as { kind?: string; page?: string; limit?: string; search?: string; sortBy?: string; statusId?: string };
    const user = request.user!;
    if (!await checkAccess(request, reply, accountId, 'read')) return;
    try {
      await resolveAccount(accountId, user.orgId);

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));

      const where: any = { zaloAccountId: accountId, orgId: user.orgId };
      if (kind && kind !== 'all') where.relationshipKind = kind;
      // Filter theo Trạng thái KH per-nick (Friend.statusId). '' = tất cả.
      if (statusId) where.statusId = statusId;
      if (search.trim()) {
        const q = search.trim();
        // Phone fast path: normalize input canonical → exact match phoneNormalized
        // (indexed). Tránh OR contains nhiều variants chậm.
        const canonicalPhone = normalizePhone(q);
        const contactOr: Record<string, unknown>[] = [
          { fullName: { contains: q, mode: 'insensitive' } },
          { crmName:  { contains: q, mode: 'insensitive' } },
        ];
        if (canonicalPhone) contactOr.push({ phoneNormalized: { equals: canonicalPhone } });
        // Search Friend per-identity + Contact OR ở 1 wrapper.
        where.AND = [
          { OR: [
            { contact: { OR: contactOr } },
            { zaloUidInNick:   { equals: q } },
            { zaloGlobalId:    { equals: q } },
            { zaloUsername:    { equals: q } },
            { zaloDisplayName: { contains: q, mode: 'insensitive' } },
            { aliasInNick:     { contains: q, mode: 'insensitive' } },
          ] },
        ];
      }

      const orderBy = buildFriendOrderBy(sortBy);

      const [friends, total, countsRaw] = await Promise.all([
        prisma.friend.findMany({
          where,
          include: FRIEND_INCLUDE_WITH_CONTACT,
          orderBy,
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.friend.count({ where }),
        prisma.friend.groupBy({
          by: ['relationshipKind'],
          where: { zaloAccountId: accountId, orgId: user.orgId },
          _count: true,
        }),
      ]);

      const counts = Object.fromEntries(countsRaw.map((g) => [g.relationshipKind, g._count]));
      // PRIVACY 2026-06-11 (audit C7/H4): redact Friend row thuộc nick main non-owner
      // (blur preview tin/alias/danh tính Zalo + Contact PII nhúng).
      const { buildPrivacyContext, redactFriend } = await import('../privacy/redact.js');
      const privacyCtx = await buildPrivacyContext(request);
      return {
        friends: friends.map((f) => redactFriend(toFriendDto(f) as any, privacyCtx)),
        total,
        counts,
        page: pageNum,
        limit: limitNum,
      };
    } catch (err) {
      return handleError(reply, err, 'friends-db-list');
    }
  });

  // GET /api/v1/friends-db/all-nicks — cross-nick Friend list (mọi nick user có access)
  // Phục vụ FriendsView "Tất cả nick" mode. Flat per-pair: 1 KH × N nick chăm → N rows.
  app.get('/api/v1/friends-db/all-nicks', { preHandler: requireGrant('friend', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const {
      kind = 'all',
      page = '1',
      limit = '25',
      search = '',
      sortBy = 'recent',
      statusId = '',
    } = request.query as { kind?: string; page?: string; limit?: string; search?: string; sortBy?: string; statusId?: string };
    try {
      // Phase Zalo Account Mutation Gate 2026-05-27: migrate sang getZaloScope
      // (helper cũ getAccessibleZaloAccountIds chỉ ACL+owned, KHÔNG cascade dept.
      // Trưởng phòng giờ thấy friend nick cấp dưới).
      const scope = await getZaloScope(user.id, user.orgId, user.role);
      const accessibleIds = scope.accessibleIds;

      if (accessibleIds.length === 0) {
        return { friends: [], total: 0, counts: {}, page: 1, limit: parseInt(limit, 10) || 25 };
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));

      const where: any = {
        orgId: user.orgId,
        zaloAccountId: { in: accessibleIds },
      };
      if (kind && kind !== 'all') where.relationshipKind = kind;
      // Filter theo Trạng thái KH per-nick (Friend.statusId). '' = tất cả.
      if (statusId) where.statusId = statusId;
      if (search.trim()) {
        const q = search.trim();
        const canonicalPhone = normalizePhone(q);
        const contactOr: Record<string, unknown>[] = [
          { fullName: { contains: q, mode: 'insensitive' } },
          { crmName:  { contains: q, mode: 'insensitive' } },
        ];
        if (canonicalPhone) contactOr.push({ phoneNormalized: { equals: canonicalPhone } });
        where.AND = [
          { OR: [
            { contact: { OR: contactOr } },
            { zaloUidInNick:   { equals: q } },
            { zaloGlobalId:    { equals: q } },
            { zaloUsername:    { equals: q } },
            { zaloDisplayName: { contains: q, mode: 'insensitive' } },
            { aliasInNick:     { contains: q, mode: 'insensitive' } },
          ] },
        ];
      }

      const orderBy = buildFriendOrderBy(sortBy);

      const [friends, total, countsRaw] = await Promise.all([
        prisma.friend.findMany({
          where,
          include: FRIEND_INCLUDE_WITH_CONTACT,
          orderBy,
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.friend.count({ where }),
        prisma.friend.groupBy({
          by: ['relationshipKind'],
          where: { orgId: user.orgId, zaloAccountId: { in: accessibleIds } },
          _count: true,
        }),
      ]);

      const counts = Object.fromEntries(countsRaw.map((g) => [g.relationshipKind, g._count]));
      // PRIVACY 2026-06-11 (audit C7/H11): trưởng phòng cascade thấy nick main cấp dưới
      // qua getZaloScope → redact preview/alias/PII của Friend thuộc nick main non-owner.
      const { buildPrivacyContext, redactFriend } = await import('../privacy/redact.js');
      const privacyCtx = await buildPrivacyContext(request);
      return {
        friends: friends.map((f) => redactFriend(toFriendDto(f) as any, privacyCtx)),
        total,
        counts,
        page: pageNum,
        limit: limitNum,
        accessibleNicks: accessibleIds.length,
      };
    } catch (err) {
      return handleError(reply, err, 'friends-db-all-nicks');
    }
  });

  // POST .../friends-db/sync — manual force-refresh ("↻ Làm mới ngay" button).
  // Gọi syncAccountFully → 3 nhánh parallel (friends + aliases + labels) để
  // user bấm 1 nút catch tất cả update từ Zalo native app.
  // Cooldown 5s/account (áp ở friends branch) để chống spam.
  app.post(`${BASE}-db/sync`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    if (!await checkAccess(request, reply, accountId, 'chat')) return;
    try {
      const account = await resolveAccount(accountId, user.orgId);
      const result = await syncAccountFully(accountId, user.orgId, {
        trigger: 'manual',
        io: zaloPool.getIO(),
      });
      if (result.friends?.skipped === 'cooldown') {
        return reply.status(429).send({
          error: 'cooldown',
          message: 'Vừa đồng bộ xong, vui lòng thử lại sau vài giây',
        });
      }
      return {
        nickId: accountId,
        nickDisplayName: account.displayName,
        liveFriends: result.friends?.liveCount ?? 0,
        upsertedFriends: result.friends?.upsertedFriends ?? 0,
        createdContacts: result.friends?.createdContacts ?? 0,
        emittedCount: result.friends?.emittedCount ?? 0,
        aliasesUpdated: result.aliasesUpdated,
        labelsUpdated: result.labelsUpdated,
        errors: result.errors,
        durationMs: result.durationMs,
      };
    } catch (err) {
      return handleError(reply, err, 'friends-db-sync');
    }
  });

  // ── Friend Queries ────────────────────────────────────────────────────────

  // GET .../friends — list all friends
  app.get(BASE, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    if (!await checkAccess(request, reply, accountId, 'read')) return;
    try {
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getAllFriends(accountId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // GET .../friends/find?q=query — search user by phone/name
  app.get(`${BASE}/find`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const { q } = request.query as { q?: string };
    const user = request.user!;
    if (!q) return reply.status(400).send({ error: 'Query param q is required' });
    if (!await checkAccess(request, reply, accountId, 'read')) return;
    try {
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.findUser(accountId, q);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // POST .../friends/lookup-by-phone body {phone} — phone→UID discovery per nick.
  // Bản chất: cùng KH Zalo có UID khác nhau theo mỗi nick CRM nhìn. Muốn nhắn từ
  // nick A, phải tìm UID **A nhìn thấy** (zca-js findUser từ session của A).
  // Trả về uid + tên + avatar perspective của nick này → dùng cho ensure-by-uid.
  app.post(`${BASE}/lookup-by-phone`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const body = (request.body || {}) as { phone?: string };
    const user = request.user!;
    if (!body.phone) return reply.status(400).send({ error: 'phone required' });
    if (!await checkAccess(request, reply, accountId, 'read')) return;
    // Normalize: Zalo findUser nhận format không có + (e.g. 84xxx hoặc 0xxx ok cả 2).
    const phone = body.phone.replace(/[^\d]/g, '');
    if (phone.length < 9) return reply.status(400).send({ error: 'phone format invalid' });
    // Phase metrics layer 2026-05-22: log MỌI lookup attempt (kể cả lỗi)
    // dùng cho dashboard "Phone search today" + automation rate-limit.
    const phoneHash = hashPhone(phone);
    const logEvent = async (result: string, foundUid: string | null, errorCode: string | null) => {
      try {
        await prisma.phoneSearchEvent.create({
          data: {
            orgId: user.orgId,
            accountId,
            userId: user.id,
            phoneHash,
            result,
            foundUid,
            errorCode,
          },
        });
      } catch (e) {
        logger.warn(`[phone-search-log] failed: ${String(e)}`);
      }
    };

    try {
      await resolveAccount(accountId, user.orgId);
      const result = await zaloOps.findUser(accountId, phone);
      const u = (result as Record<string, unknown>) || {};
      const uid = String(u.uid || u.userId || '') || null;
      if (!uid) {
        await logEvent('no_zalo', null, null);
        return reply.send({ found: false, reason: 'no_zalo', detail: 'SĐT này không có Zalo' });
      }
      await logEvent('found_zalo', uid, null);
      return reply.send({
        found: true,
        uid,
        zaloName: String(u.zaloName || u.zalo_name || u.displayName || u.display_name || '') || null,
        username: String(u.username || '') || null,
        globalId: String(u.globalId || '') || null,
        avatar: String(u.avatar || '') || null,
        phone,
      });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      // ZaloApiError code 216 = no Zalo for phone (zca-js có thể throw thay vì trả empty)
      if (e?.code === 'NOT_CONNECTED' || e?.code === 'RATE_LIMITED') {
        await logEvent('rate_limited', null, e.code);
        // M55.3 2026-05-30: dịch message tiếng Việt sale-friendly thay tiếng Anh raw.
        // NOT_CONNECTED = nick CRM của sale chưa kết nối Zalo (không phải KH chặn).
        // userFriendly = label hiện toast nhỏ cho sale, detail = action message.
        const isNotConnected = e.code === 'NOT_CONNECTED';
        return reply.status(503).send({
          error: e.code,
          detail: isNotConnected
            ? 'Nick Zalo của anh chưa kết nối. Vào "Quản lý nick" để kết nối lại, hoặc chuyển sang chat nội bộ với KH.'
            : 'Nick đã bị Zalo chặn tạm thời (quá nhiều lượt tra cứu). Vui lòng thử lại sau vài phút.',
          userFriendly: isNotConnected
            ? 'KH chưa bật tìm kiếm Zalo công khai'
            : 'Đã đạt giới hạn tra cứu Zalo',
          suggestVirtualChat: isNotConnected,
        });
      }
      // Default: treat as not found (Zalo phổ biến throw cho phone lạ)
      await logEvent('no_zalo', null, e?.code ?? null);
      return reply.send({ found: false, reason: 'lookup_failed', detail: String(e?.message || err) });
    }
  });

  // GET .../friends/online — get online friends
  app.get(`${BASE}/online`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getFriendOnlines(accountId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // GET .../friends/recommendations — friend suggestions
  app.get(`${BASE}/recommendations`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getFriendRecommendations(accountId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // GET .../friends/aliases — all custom aliases (?count=N&page=P, default 100/1)
  app.get(`${BASE}/aliases`, async (request: FastifyRequest<{ Querystring: { count?: string; page?: string } }>, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    const count = Math.min(parseInt(request.query.count || '100') || 100, 1000);
    const page = Math.max(parseInt(request.query.page || '1') || 1, 1);
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getAliasList(accountId, count, page);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // ── Friend Requests ───────────────────────────────────────────────────────

  // GET .../friends/requests/sent — list sent friend requests
  // NOTE: Registered before :userId routes to avoid route conflicts
  app.get(`${BASE}/requests/sent`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getSentFriendRequests(accountId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // GET .../friends/requests/:userId/status — check request status with a user
  app.get(`${BASE}/requests/:userId/status`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getFriendRequestStatus(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // POST .../friends/requests — send friend request { userId, message? }
  app.post(`${BASE}/requests`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const { userId, message = '' } = request.body as { userId: string; message?: string };
    const user = request.user!;
    if (!userId) return reply.status(400).send({ error: 'userId is required' });
    if (!await checkAccess(request, reply, accountId, 'chat')) return;
    try {
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.sendFriendRequest(accountId, message, userId);
      await markFriendRequestSent(accountId, userId);
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // POST .../friends/requests/:userId/accept — accept incoming request
  // Per-nick UID resolution: 1 Contact có thể có nhiều Friend rows trong cùng 1 nick
  // (old friendship UID + new pending invite UID khác nhau — Zalo issue UID mới mỗi
  // lần re-request). Conv bind vào UID cũ nhưng accept phải target UID PENDING.
  // → Resolve actual pending UID qua Friend table trước khi gọi SDK.
  app.post(`${BASE}/requests/:userId/accept`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);

      // Bước 1: resolve actual pending UID. userId từ URL có thể là externalThreadId
      // của conv (= UID old friendship). Tìm Friend row pending_received cùng (nick, contact).
      let acceptUid = userId;
      let resolvedFrom: string | null = null;
      try {
        const convFriend = await prisma.friend.findUnique({
          where: { zaloAccountId_zaloUidInNick: { zaloAccountId: accountId, zaloUidInNick: userId } },
          select: { contactId: true, friendshipStatus: true },
        });
        // 2026-06-09 (anh báo "Tham số không hợp lệ"): nới resolve. UID từ URL có thể
        // là UID friendship CŨ, không phải UID lời mời PENDING. Nếu UID gốc KHÔNG phải
        // pending_received (gồm cả convFriend=null) → tìm pending sibling cùng nick để
        // accept đúng. Trước fix chỉ resolve khi convFriend tồn tại → bỏ sót case null.
        if (convFriend?.friendshipStatus !== 'pending_received') {
          const contactId = convFriend?.contactId;
          const pendingSibling = await prisma.friend.findFirst({
            where: {
              zaloAccountId: accountId,
              friendshipStatus: 'pending_received',
              zaloUidInNick: { not: userId },
              ...(contactId ? { contactId } : {}),
            },
            orderBy: { createdAt: 'desc' },
            select: { zaloUidInNick: true, id: true, contactId: true },
          });
          if (pendingSibling?.zaloUidInNick) {
            acceptUid = pendingSibling.zaloUidInNick;
            resolvedFrom = userId;
            logger.info(`[friend-op] Resolved pending UID for accept`, {
              accountId, originalUid: userId, actualUid: acceptUid,
              contactId: pendingSibling.contactId, siblingFriendId: pendingSibling.id,
            });
          }
        }
      } catch (resolveErr: any) {
        logger.warn(`[friend-op] UID resolve failed, using original`, { userId, err: resolveErr?.message });
      }

      // Bước 2: verify current state qua getFriendRequestStatus (diagnostic)
      let statusBefore: any = null;
      try {
        statusBefore = await zaloOps.getFriendRequestStatus(accountId, acceptUid);
        logger.info(`[friend-op] accept ${accountId}→${acceptUid} status:`, statusBefore);
      } catch (statusErr: any) {
        logger.warn(`[friend-op] getFriendRequestStatus failed before accept`, { accountId, acceptUid, err: statusErr?.message });
      }

      // Bước 3: thử acceptFriendRequest với UID đã resolve
      try {
        const data = await zaloOps.acceptFriendRequest(accountId, acceptUid);
        return { data, method: resolvedFrom ? 'accept-resolved' : 'accept', acceptUid, resolvedFrom };
      } catch (acceptErr: any) {
        const errMsg = String(acceptErr?.message || '');
        logger.warn(`[friend-op] acceptFriendRequest failed`, {
          accountId, acceptUid, originalUid: userId,
          errMsg, errCode: acceptErr?.code, statusBefore,
        });

        // Bước 4: fallback sendFriendRequest — Zalo SDK comment:
        // "222 if user has already sent you a friend request, your request will be
        //  treated as acceptance instead". Chỉ fallback khi statusBefore != is_friend.
        const shouldFallback = !statusBefore?.is_friend && (
          statusBefore?.is_requesting === 1 ||
          errMsg.includes('Tham số không hợp lệ') ||
          errMsg.includes('Invalid')
        );
        if (shouldFallback) {
          logger.info(`[friend-op] Falling back to sendFriendRequest`, { acceptUid });
          try {
            const data = await zaloOps.sendFriendRequest(accountId, '', acceptUid);
            return { data, method: 'send-as-accept', acceptUid, resolvedFrom };
          } catch (sendErr: any) {
            logger.error(`[friend-op] sendFriendRequest fallback also failed`, {
              accountId, acceptUid, err: sendErr?.message,
            });
            // 2026-06-09: báo lỗi NGƯỜI DÙNG HIỂU thay vì "Tham số không hợp lệ".
            return reply.status(409).send({
              error: 'Không chấp nhận được lời mời này — có thể khách đã rút lời mời, đã là bạn, hoặc lời mời đã hết hạn. Anh/chị thử tải lại trang rồi kiểm tra lại.',
              code: 'FRIEND_REQUEST_NOT_ACCEPTABLE',
            });
          }
        }
        if (statusBefore?.is_friend) {
          return reply.status(409).send({
            error: 'Khách này đã là bạn bè rồi — không cần chấp nhận lại.',
            code: 'ALREADY_FRIEND',
          });
        }
        return reply.status(409).send({
          error: 'Không chấp nhận được lời mời này — có thể khách đã rút lời mời hoặc lời mời đã hết hạn. Anh/chị thử tải lại trang.',
          code: 'FRIEND_REQUEST_NOT_ACCEPTABLE',
        });
      }
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // POST .../friends/requests/:userId/reject — reject incoming request
  // Per-nick UID: same resolution logic như /accept — conv UID có thể là old friendship,
  // pending invite trên Friend row sibling khác. Reject sai UID → "Tham số không hợp lệ".
  app.post(`${BASE}/requests/:userId/reject`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);

      let rejectUid = userId;
      try {
        const convFriend = await prisma.friend.findUnique({
          where: { zaloAccountId_zaloUidInNick: { zaloAccountId: accountId, zaloUidInNick: userId } },
          select: { contactId: true, friendshipStatus: true },
        });
        if (convFriend?.contactId && convFriend.friendshipStatus !== 'pending_received') {
          const pendingSibling = await prisma.friend.findFirst({
            where: {
              zaloAccountId: accountId,
              contactId: convFriend.contactId,
              friendshipStatus: 'pending_received',
              zaloUidInNick: { not: userId },
            },
            select: { zaloUidInNick: true },
          });
          if (pendingSibling?.zaloUidInNick) {
            rejectUid = pendingSibling.zaloUidInNick;
            logger.info(`[friend-op] Resolved pending UID for reject`, {
              accountId, originalUid: userId, actualUid: rejectUid,
            });
          }
        }
      } catch (resolveErr: any) {
        logger.warn(`[friend-op] UID resolve failed for reject`, { userId, err: resolveErr?.message });
      }

      const data = await zaloOps.rejectFriendRequest(accountId, rejectUid);
      return { data, rejectUid, originalUid: userId };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // DELETE .../friends/requests/:userId — cancel sent request
  app.delete(`${BASE}/requests/:userId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.cancelFriendRequest(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // ── Friend Management ─────────────────────────────────────────────────────

  // DELETE .../friends/:userId — remove friend
  app.delete(`${BASE}/:userId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.removeFriend(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // PUT .../friends/:userId/alias — set custom alias { alias }
  app.put(`${BASE}/:userId/alias`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const { alias } = request.body as { alias: string };
    const user = request.user!;
    if (!alias) return reply.status(400).send({ error: 'alias is required' });
    if (!await checkAccess(request, reply, accountId, 'chat')) return;
    try {
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.changeFriendAlias(accountId, alias, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // DELETE .../friends/:userId/alias — remove custom alias
  app.delete(`${BASE}/:userId/alias`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.removeFriendAlias(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // ── Privacy ───────────────────────────────────────────────────────────────

  // POST .../friends/:userId/block — block user
  app.post(`${BASE}/:userId/block`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.blockUser(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // DELETE .../friends/:userId/block — unblock user
  app.delete(`${BASE}/:userId/block`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.unblockUser(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // POST .../friends/:userId/block-feed — block user from viewing feed
  app.post(`${BASE}/:userId/block-feed`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.blockViewFeed(accountId, true, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // DELETE .../friends/:userId/block-feed — unblock user from viewing feed
  app.delete(`${BASE}/:userId/block-feed`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.blockViewFeed(accountId, false, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });
}

/**
 * Map sortBy query param → Prisma orderBy clause. Stable tie-break luôn cuối
 * (createdAt + id) để pagination không dao động giữa các page.
 *
 * Phase 6: thêm sort theo leadScore + stuckSince để FriendsView Score column sort được.
 */
function buildFriendOrderBy(sortBy: string): any[] {
  const tieBreak = [{ createdAt: 'desc' as const }, { id: 'asc' as const }];
  switch (sortBy) {
    case 'score-desc':
      return [{ leadScore: 'desc' as const }, ...tieBreak];
    case 'score-asc':
      return [{ leadScore: 'asc' as const }, ...tieBreak];
    case 'stuck':
      // Stuck KH lên đầu (oldest stuck first), KH không stuck xuống cuối.
      return [{ stuckSince: { sort: 'asc' as const, nulls: 'last' as const } }, ...tieBreak];
    case 'recent':
    default:
      return [
        { lastInboundAt: { sort: 'desc' as const, nulls: 'last' as const } },
        { lastOutboundAt: { sort: 'desc' as const, nulls: 'last' as const } },
        ...tieBreak,
      ];
  }
}
