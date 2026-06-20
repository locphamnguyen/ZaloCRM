// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Zalo account management routes.
 * All endpoints require authentication via authMiddleware.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { getZaloScope, canManageAccount, requireAccountManagement, requireAccountVisible } from './zalo-scope.js';

export async function zaloRoutes(app: FastifyInstance): Promise<void> {
  // All routes in this plugin require auth
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/zalo-accounts — list accounts with live status from pool
  // RBAC scoped 2026-05-22: chỉ trả nicks user được phép xem (xem getZaloScope).
  app.get('/api/v1/zalo-accounts', async (request) => {
    const user = request.user!;
    const userId = (user as any).userId ?? user.id;
    const scope = await getZaloScope(userId, user.orgId, user.role);
    // 2026-06-09: mặc định ẩn nick đã xóa mềm. ?includeArchived=true → admin xem lại để khôi phục.
    const includeArchived = (request.query as Record<string, string>)?.includeArchived === 'true';

    const accounts = await prisma.zaloAccount.findMany({
      where: {
        orgId: user.orgId,
        id: { in: scope.accessibleIds },
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        ownerUserId: true,
        proxyUrl: true,
        privacyMode: true,
        lastConnectedAt: true,
        archivedAt: true,
        createdAt: true,
        owner: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Merge live status from pool; mask proxy credentials; thêm canManage flag
    return accounts.map((a) => ({
      ...a,
      proxyUrl: a.proxyUrl ? maskProxyUrl(a.proxyUrl) : null,
      hasProxy: !!a.proxyUrl,
      liveStatus: zaloPool.getStatus(a.id),
      canManage: canManageAccount(a.ownerUserId, userId, user.role),
      isOwnedByMe: a.ownerUserId === userId,
    }));
  });

  // POST /api/v1/zalo-accounts — create a new account record
  app.post<{ Body: { displayName?: string; proxyUrl?: string; phone?: string } }>(
    '/api/v1/zalo-accounts',
    async (request, reply) => {
      const user = request.user!;
      const { displayName, proxyUrl } = request.body ?? {};
      const userId = (user as any).userId ?? user.id;

      if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
        return reply.status(400).send({ error: 'Invalid proxy URL format. Use: http://[user:pass@]host:port' });
      }

      const rawPhone = (request.body?.phone ?? '').trim();
      const phone = rawPhone ? rawPhone.replace(/[\s.\-()]/g, '') : '';

      // FIX 1 nick-ghost (Anh chốt 2026-06-13): GỘP check-trùng + reuse-ghost + create vào
      // 1 TRANSACTION (trước là 3 query RỜI → 2 POST song song cùng owner/phone đều thấy
      // "không trùng" → đẻ 2 record). Dùng isolationLevel='Serializable' để 2 tx ghi xung
      // đột thì 1 bị abort (P2034) → retry 1 lần → record thứ 2 thấy ghost của record thứ 1.
      // Đóng cả khe phone=null (transaction thường không serialize được nhánh này).
      // Transaction trả discriminated result; reply xử lý SAU tx (không nhét reply giữa tx).
      //
      // Giữ NGUYÊN 3 hành vi cũ (Anh dặn tránh trùng chức năng):
      //   • phone trùng nick mình  → 200 reused
      //   • phone trùng nick khác  → 409 account_owned_by_other (fix ③)
      //   • reuse ghost qr_pending → 200 reusedGhost (fix CORE 2026-06-12)
      type CreateResult =
        | { kind: 'dup_self'; rec: any }
        | { kind: 'dup_other'; ownerName: string | null }
        | { kind: 'reused_ghost'; rec: any }
        | { kind: 'created'; rec: any };

      const runCreate = (): Promise<CreateResult> =>
        tenantTransaction(async (tx): Promise<CreateResult> => {
          // (1) Check trùng phone (chỉ khi có phone hợp lệ).
          if (phone) {
            const dup = await tx.zaloAccount.findFirst({
              where: { orgId: user.orgId, phone, archivedAt: null },
              select: { id: true, displayName: true, status: true, ownerUserId: true, owner: { select: { fullName: true } } },
            });
            if (dup) {
              if (dup.ownerUserId === userId) return { kind: 'dup_self', rec: dup };
              return { kind: 'dup_other', ownerName: dup.owner?.fullName ?? null };
            }
          }

          // (2) Reuse ghost qr_pending chưa connect của chính owner (zaloUid=null).
          const ghost = await tx.zaloAccount.findFirst({
            where: { orgId: user.orgId, ownerUserId: userId, zaloUid: null, status: 'qr_pending', archivedAt: null },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          if (ghost) {
            const reused = await tx.zaloAccount.update({
              where: { id: ghost.id },
              data: {
                ...(phone ? { phone } : {}),
                ...(displayName ? { displayName } : {}),
                ...(proxyUrl !== undefined ? { proxyUrl: proxyUrl ?? null } : {}),
              },
              select: { id: true, displayName: true, status: true, ownerUserId: true, phone: true },
            });
            return { kind: 'reused_ghost', rec: reused };
          }

          // (3) Tạo nick mới + auto-insert ZaloAccountAccess (owner permission='admin').
          const acc = await tx.zaloAccount.create({
            data: {
              orgId: user.orgId,
              ownerUserId: user.id,
              displayName: displayName ?? null,
              proxyUrl: proxyUrl ?? null,
              phone: phone || null,
              status: 'qr_pending',
            },
          });
          await tx.zaloAccountAccess.create({
            data: { zaloAccountId: acc.id, userId: user.id, permission: 'admin' },
          });
          return { kind: 'created', rec: acc };
        }, { isolationLevel: 'Serializable' });

      let result: CreateResult;
      try {
        result = await runCreate();
      } catch (err) {
        // P2034 = serialization conflict (2 POST race). Retry 1 lần — lần 2 thấy record
        // của lần 1 → đi nhánh reuse/dup thay vì tạo trùng.
        if ((err as { code?: string })?.code === 'P2034') {
          result = await runCreate();
        } else {
          throw err;
        }
      }

      switch (result.kind) {
        case 'dup_self':
          return reply.status(200).send({ ...result.rec, reused: true });
        case 'dup_other':
          return reply.status(409).send({
            error: 'account_owned_by_other',
            code: 'account_owned_by_other',
            message: `Nick này đang do ${result.ownerName ?? 'nhân viên khác'} quản lý. Liên hệ chủ tổ chức để chuyển giao.`,
            owner: result.ownerName,
          });
        case 'reused_ghost':
          return reply.status(200).send({ ...result.rec, reused: true, reusedGhost: true });
        case 'created':
          return reply.status(201).send(result.rec);
      }
    },
  );

  // POST /api/v1/zalo-accounts/:id/login — initiate QR login
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/login',
    async (request, reply) => {
      const { id } = request.params;
      // Phase Zalo Account Mutation Gate 2026-05-27: chỉ owner-of-nick + org admin
      // mới được trigger QR login (chặn take-over qua endpoint mutation).
      const gate = await requireAccountManagement(request, reply, id);
      if (!gate) return reply;
      // Load lại để có proxyUrl
      const account = await prisma.zaloAccount.findUnique({
        where: { id },
        select: { proxyUrl: true },
      });
      // Fire-and-forget — QR delivered via Socket.IO
      zaloPool.loginQR(id, account?.proxyUrl ?? null).catch(() => {
        // errors are emitted via socket; no need to crash here
      });

      return { message: 'QR login initiated — subscribe to account:' + id + ' socket room' };
    },
  );

  // POST /api/v1/zalo-accounts/:id/reconnect — force reconnect using saved session
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/reconnect',
    async (request, reply) => {
      const { id } = request.params;
      // Phase Zalo Account Mutation Gate 2026-05-27: gate take-over reconnect.
      const gate = await requireAccountManagement(request, reply, id);
      if (!gate) return reply;
      const account = await prisma.zaloAccount.findUnique({
        where: { id },
        select: { sessionData: true, proxyUrl: true, disconnectReason: true },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      // T3 (YC1 2026-06-20): nick NGẮT THỦ CÔNG (manual) → session cũ đã đóng, reconnect ngầm
      // sẽ bị zalo-pool skip IM LẶNG → caller nhận 200 giả → wizard nhảy "done" sai. Trả 409
      // needsQR để FE chuyển sang QUÉT QR MỚI. (Nick passive/null vẫn reconnect ngầm bình thường.)
      if (account.disconnectReason === 'manual') {
        return reply.status(409).send({
          error: 'needs_qr',
          needsQR: true,
          message: 'Nick này đã ngắt thủ công — vui lòng quét QR mới để đăng nhập lại.',
        });
      }

      const session = account.sessionData as {
        cookie: any;
        imei: string;
        userAgent: string;
      } | null;

      if (!session?.imei) {
        return reply.status(400).send({ error: 'No saved session — please login with QR first' });
      }

      // Fire-and-forget — result emitted via Socket.IO
      zaloPool.reconnect(id, session, account.proxyUrl).catch(() => {});

      return { message: 'Reconnect initiated' };
    },
  );

  // DELETE /api/v1/zalo-accounts/:id — XÓA MỀM (2026-06-09, Anh chốt).
  // Trước: hard delete + cascade (mất Conversation/Message/Friend/Log...). NGUY HIỂM.
  // Giờ: set archivedAt = now() → ẩn khỏi danh sách nhưng GIỮ toàn bộ dữ liệu trong DB.
  // Listener stop, health-check bỏ qua nick archived (không reconnect).
  // RBAC: requireAccountManagement đã chặn — owner-of-nick + admin (sale chỉ xóa nick mình).
  //
  // T10 (YC2 2026-06-20): BỎ tùy chọn ?purge. Xóa nick = LUÔN chỉ ẩn-mềm, GIỮ NGUYÊN
  // zaloUid + sessionData → tin nhắn KHÔNG mất + kết nối lại ĐÚNG nick này tự khôi phục
  // (revive qua T8/T9b, KHÔNG tạo record mới). Nhả uid (purge) sinh nick mới mồ côi → đã gỡ.
  app.delete<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id',
    async (request, reply) => {
      const { id } = request.params;
      const gate = await requireAccountManagement(request, reply, id);
      if (!gate) return reply;
      const user = request.user!;

      // Stop listener trước (nick archived không cần kết nối nữa).
      zaloPool.disconnect(id);
      // Chỉ ẩn — GIỮ sessionData + zaloUid để kết nối lại nguyên vẹn (revive). KHÔNG nhả uid.
      // T13: ghi archivedById = ai bấm xóa (tab "Nick đã xóa" hiện người xóa).
      await prisma.zaloAccount.update({
        where: { id },
        data: { archivedAt: new Date(), status: 'disconnected', archivedById: user.id },
      });
      request.log?.info?.(`[zalo:${id}] soft-deleted by ${user.id} (archivedAt set, GIỮ uid+session để revive)`);

      return reply.status(204).send();
    },
  );

  // POST /api/v1/zalo-accounts/:id/restore — khôi phục nick đã xóa mềm (admin).
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/restore',
    async (request, reply) => {
      const { id } = request.params;
      const gate = await requireAccountManagement(request, reply, id);
      if (!gate) return reply;
      // T13: khôi phục → bỏ ẩn + clear người-xóa. Nick về danh sách active (disconnected) →
      // bấm "Kết nối lại" để quét QR online lại.
      await prisma.zaloAccount.update({ where: { id }, data: { archivedAt: null, archivedById: null } });
      return { message: 'Account restored — kết nối lại bằng QR/reconnect nếu cần' };
    },
  );

  // GET /api/v1/zalo-accounts/archived — T13 (2026-06-21): tab "Nick đã xóa".
  // Admin/chủ tổ chức → mọi nick đã ẩn của org; sale thường → chỉ nick đã xóa của MÌNH.
  // Trả kèm số liệu (hội thoại/bạn) + người xóa + chủ nick + loại (khôi-phục-được vs thẻ ma).
  app.get('/api/v1/zalo-accounts/archived', async (request, reply) => {
    const user = request.user;
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    const isAdmin = user.role === 'owner' || user.role === 'admin';
    const rows = await prisma.zaloAccount.findMany({
      where: {
        orgId: user.orgId,
        archivedAt: { not: null },
        ...(isAdmin ? {} : { ownerUserId: user.id }),
      },
      select: {
        id: true, displayName: true, avatarUrl: true, zaloUid: true, phone: true,
        ownerUserId: true, archivedAt: true, archivedById: true, lastConnectedAt: true, disconnectReason: true,
        owner: { select: { fullName: true, email: true } },
        _count: { select: { conversations: true, friends: true } },
      },
      orderBy: { archivedAt: 'desc' },
    });
    // Resolve tên người xóa (batch, 0 N+1).
    const archiverIds = [...new Set(rows.map((r) => r.archivedById).filter((x): x is string => !!x))];
    const archivers = archiverIds.length
      ? await prisma.user.findMany({ where: { id: { in: archiverIds } }, select: { id: true, fullName: true, email: true } })
      : [];
    const archiverMap = new Map(archivers.map((u) => [u.id, u.fullName || u.email]));
    return {
      accounts: rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        zaloUid: r.zaloUid,
        phone: r.phone,
        ownerName: r.owner?.fullName || r.owner?.email || null,
        archivedAt: r.archivedAt,
        lastConnectedAt: r.lastConnectedAt,
        disconnectReason: r.disconnectReason,
        // null = hệ thống tự dọn (thẻ ma) hoặc xóa trước khi có field.
        archivedByName: r.archivedById ? (archiverMap.get(r.archivedById) || 'Không rõ') : null,
        conversations: r._count.conversations,
        friends: r._count.friends,
        // có uid = đã từng login → khôi phục được; uid null = thẻ ma (chỉ xóa hẳn).
        revivable: !!r.zaloUid,
      })),
    };
  });

  // DELETE /api/v1/zalo-accounts/:id/purge-empty — T13: XÓA HẲN thẻ ma RỖNG (0 hội thoại + 0 bạn).
  // An toàn cascade vì không có data để mất. Nick còn dữ liệu → CHẶN (chỉ khôi phục).
  app.delete<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/purge-empty',
    async (request, reply) => {
      const { id } = request.params;
      const gate = await requireAccountManagement(request, reply, id);
      if (!gate) return reply;
      const acc = await prisma.zaloAccount.findUnique({
        where: { id },
        select: { archivedAt: true, _count: { select: { conversations: true, friends: true } } },
      });
      if (!acc) return reply.status(404).send({ error: 'not_found' });
      if (!acc.archivedAt) {
        return reply.status(400).send({ error: 'not_archived', message: 'Chỉ xóa hẳn nick đã ẩn (đã xóa mềm).' });
      }
      if (acc._count.conversations > 0 || acc._count.friends > 0) {
        return reply.status(409).send({ error: 'has_data', message: 'Nick còn dữ liệu (hội thoại/bạn bè) — không xóa hẳn được, chỉ khôi phục.' });
      }
      zaloPool.disconnect(id);
      await prisma.zaloAccountAccess.deleteMany({ where: { zaloAccountId: id } });
      await prisma.zaloAccount.delete({ where: { id } }); // cascade dọn friendshipAttempts rỗng
      request.log?.info?.(`[zalo:${id}] purged (thẻ ma rỗng, 0 conv/0 friend) by ${request.user?.id}`);
      return { message: 'Đã xóa hẳn nick (thẻ ma rỗng).' };
    },
  );

  // POST /api/v1/zalo-accounts/check-phone — Bước 1 luồng kết nối mới (Anh chốt 2026-06-09).
  // Dùng NICK HỆ THỐNG (organization.systemNotifyZaloAccountId) findUser(SĐT) → trả info
  // để sale XÁC NHẬN đúng nick trước khi quét QR. FALLBACK: nick hệ thống chưa cấu hình /
  // disconnect → trả {available:false} để FE cho sale BỎ QUA Check, quét QR thẳng.
  app.post<{ Body: { phone?: string } }>(
    '/api/v1/zalo-accounts/check-phone',
    async (request, reply) => {
      const user = request.user!;
      const phone = (request.body?.phone ?? '').trim();
      // Validate SĐT VN cơ bản (10 số, đầu 0 hoặc +84).
      const normalized = phone.replace(/[\s.\-()]/g, '');
      if (!/^(0|\+84)\d{9}$/.test(normalized)) {
        return reply.status(400).send({ error: 'invalid_phone', message: 'Số điện thoại không hợp lệ' });
      }

      // Lấy nick hệ thống của org.
      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { systemNotifyZaloAccountId: true, systemNotifyNick: { select: { id: true, status: true } } },
      });
      const sysNick = org?.systemNotifyNick;
      if (!sysNick || sysNick.status !== 'connected') {
        // Fallback: không kiểm tra được → FE cho quét QR thẳng.
        return { available: false, reason: 'system_nick_unavailable' };
      }

      try {
        const { zaloOps } = await import('../../shared/zalo-operations.js');
        const found = await zaloOps.findUser(sysNick.id, normalized);
        if (!found || !(found as any).uid) {
          return { available: true, found: false, message: 'Số này chưa có Zalo (vẫn có thể quét QR nếu chắc chắn)' };
        }
        const u = found as any;
        const foundUid: string | null = u.uid ?? null;

        // Bước check trùng (Anh chốt 2026-06-11) — phân loại theo CHỦ SỞ HỮU để FE
        // hướng đúng hành động, chặn record qr_pending rác:
        //   • match nick CỦA CHÍNH MÌNH  → reuse: FE gọi reconnect/login trên record cũ
        //   • match nick NGƯỜI KHÁC      → block: báo rõ chủ, hướng chủ tổ chức chuyển giao
        //   • chưa có                    → tạo nick mới như cũ
        // Match ưu tiên zaloUid (định danh thật của nick), fallback phone (số chưa từng quét QR).
        const userId = (user as any).userId ?? user.id;
        // T1+T9b (YC2 2026-06-20): BỎ `archivedAt: null` → tìm CẢ nick đã xóa mềm để FE biết
        // (revive). orderBy ưu tiên nick CÒN SỐNG (archivedAt nulls-first) → nếu có cả nick sống
        // lẫn nick xóa cùng uid (ca trùng), trả nick SỐNG (đang chạy, không revive nhầm).
        const existing = await prisma.zaloAccount.findFirst({
          where: {
            orgId: user.orgId,
            OR: [
              ...(foundUid ? [{ zaloUid: foundUid }] : []),
              { phone: normalized },
            ],
          },
          select: {
            id: true,
            displayName: true,
            status: true,
            ownerUserId: true,
            owner: { select: { id: true, fullName: true } },
            disconnectReason: true,
            archivedAt: true,
            zaloUid: true,
          },
          orderBy: [
            { archivedAt: { sort: 'asc', nulls: 'first' } }, // nick sống (null) trước nick xóa
            { zaloUid: { sort: 'desc', nulls: 'last' } },     // rồi mới tới record đã có uid
          ],
        });

        let duplicate: {
          accountId: string;
          displayName: string | null;
          status: string;
          ownedByMe: boolean;
          owner: string | null;
          disconnectReason: string | null;
          archived: boolean;
        } | null = null;
        let reviveAccountId: string | null = null;
        if (existing) {
          const isArchived = existing.archivedAt !== null;
          const ownedByMe = existing.ownerUserId === userId;
          duplicate = {
            accountId: existing.id,
            displayName: existing.displayName,
            status: existing.status,
            ownedByMe,
            owner: existing.owner?.fullName ?? null,
            disconnectReason: existing.disconnectReason ?? null, // T1: FE phân biệt manual/passive
            archived: isArchived,                                 // T1: boolean (KHÔNG trả raw Date)
          };
          // T9b + 2026-06-21: nick CỦA CHÍNH MÌNH + khớp theo UID (định danh thật) mà KHÔNG đang
          // 'connected' (đã xóa / disconnected / qr_pending / manual) → FE login QR THẲNG trên id
          // cũ (POST /:id/login) → revive đúng record cũ, KHÔNG tạo nick mới (giữ uid + tin nhắn).
          // Trước chỉ archived → nick disconnected (session chết) rơi vào reconnect ngầm báo ảo.
          // KHÔNG revive theo phone-only (uid rỗng = bản ma/khác người dùng cũ số đó).
          if (ownedByMe && !!foundUid && existing.zaloUid === foundUid && existing.status !== 'connected') {
            reviveAccountId = existing.id;
          }
        }

        return {
          available: true,
          found: true,
          info: {
            zaloUid: foundUid,
            displayName: u.display_name ?? u.zalo_name ?? u.username ?? null,
            avatarUrl: u.avatar ?? null,
            phone: normalized,
          },
          duplicate,
          reviveAccountId,
        };
      } catch (err) {
        request.log?.warn?.({ err }, '[check-phone] findUser failed');
        // Lỗi gọi Zalo → fallback cho quét QR thẳng.
        return { available: false, reason: 'lookup_failed' };
      }
    },
  );

  // GET /api/v1/zalo-accounts/:id/status — live status from pool
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/status',
    async (request, reply) => {
      const { id } = request.params;
      // Phase Zalo Account Mutation Gate 2026-05-27: read endpoint cũng scope
      // (read OK cho trưởng phòng qua dept-cascade).
      const gate = await requireAccountVisible(request, reply, id);
      if (!gate) return reply;

      return { accountId: id, liveStatus: zaloPool.getStatus(id) };
    },
  );

  // PUT /api/v1/zalo-accounts/:id/proxy — update proxy config
  app.put<{ Params: { id: string }; Body: { proxyUrl: string | null } }>(
    '/api/v1/zalo-accounts/:id/proxy',
    async (request, reply) => {
      const { id } = request.params;
      const { proxyUrl } = request.body ?? {};
      // Phase Zalo Account Mutation Gate 2026-05-27 CRITICAL: chặn MITM —
      // proxy set bởi non-owner có thể chặn toàn bộ traffic Zalo của nick.
      const gate = await requireAccountManagement(request, reply, id);
      if (!gate) return reply;

      if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
        return reply.status(400).send({ error: 'Invalid proxy URL format. Use: http://[user:pass@]host:port' });
      }

      await prisma.zaloAccount.update({
        where: { id },
        data: { proxyUrl: proxyUrl ?? null },
      });

      return { message: 'Proxy updated', hasProxy: !!proxyUrl };
    },
  );

  // PUT /api/v1/zalo-accounts/:id/phone — sửa SĐT THỦ CÔNG cho nick (anh hỏi 2026-06-21:
  // nick nhập trước chưa xác minh SĐT → bổ sung sau). Verify trùng Zalo/tên trước khi lưu:
  //   • khớp UID (nick đã login + uid của SĐT trùng) HOẶC khớp TÊN → lưu (đã xác minh).
  //   • lookup được nhưng KHÁC uid/tên, hoặc số chưa có Zalo, hoặc không tra được → 409 needsConfirm
  //     (cảnh báo); chỉ lưu khi body.force=true. Để trống phone → xóa SĐT (cho luôn).
  app.put<{ Params: { id: string }; Body: { phone?: string; force?: boolean } }>(
    '/api/v1/zalo-accounts/:id/phone',
    async (request, reply) => {
      const { id } = request.params;
      const gate = await requireAccountManagement(request, reply, id);
      if (!gate) return reply;

      const force = request.body?.force === true;
      const phone = (request.body?.phone ?? '').trim().replace(/[\s.\-()]/g, '');
      if (!phone) {
        await prisma.zaloAccount.update({ where: { id }, data: { phone: null } });
        return { saved: true, message: 'Đã xóa SĐT.' };
      }
      if (!/^(0|\+?84)\d{8,10}$/.test(phone)) {
        return reply.status(400).send({ error: 'invalid_phone', message: 'Số điện thoại không hợp lệ.' });
      }

      const nick = await prisma.zaloAccount.findUnique({
        where: { id }, select: { zaloUid: true, displayName: true, orgId: true },
      });
      if (!nick) return reply.status(404).send({ error: 'not_found' });

      // Tra SĐT trên Zalo qua nick hệ thống (như check-phone) để xác minh danh tính.
      let resolved: { uid: string | null; name: string | null } | null = null;
      try {
        const org = await prisma.organization.findUnique({
          where: { id: nick.orgId },
          select: { systemNotifyNick: { select: { id: true, status: true } } },
        });
        const sysNick = org?.systemNotifyNick;
        if (sysNick && sysNick.status === 'connected') {
          const { zaloOps } = await import('../../shared/zalo-operations.js');
          const found = (await zaloOps.findUser(sysNick.id, phone)) as { uid?: string; display_name?: string; zalo_name?: string; username?: string } | null;
          resolved = found?.uid
            ? { uid: String(found.uid), name: found.display_name ?? found.zalo_name ?? found.username ?? null }
            : { uid: null, name: null };
        }
      } catch { /* lookup lỗi → resolved=null (không xác minh được) */ }

      const norm = (s: string | null) => (s ?? '').trim().toLowerCase();
      const uidMatch = !!resolved?.uid && !!nick.zaloUid && resolved.uid === nick.zaloUid;
      const nameMatch = !!resolved?.name && norm(resolved.name) === norm(nick.displayName);

      if (uidMatch || nameMatch) {
        await prisma.zaloAccount.update({ where: { id }, data: { phone } });
        return { saved: true, verified: true, matchedBy: uidMatch ? 'uid' : 'name', message: 'Đã lưu SĐT (khớp Zalo).' };
      }
      if (!force) {
        const why = resolved === null
          ? 'Không tra được Zalo (nick hệ thống chưa kết nối) để xác minh.'
          : resolved.uid === null
            ? 'Số này CHƯA đăng ký Zalo.'
            : `Số này trên Zalo là "${resolved.name ?? 'người khác'}" — KHÁC tên nick "${nick.displayName ?? ''}".`;
        return reply.status(409).send({ saved: false, needsConfirm: true, resolved, message: why });
      }
      await prisma.zaloAccount.update({ where: { id }, data: { phone } });
      return { saved: true, verified: false, message: 'Đã lưu SĐT (chưa xác minh).' };
    },
  );
}

/** Mask proxy URL credentials for safe display */
function maskProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return '****';
  }
}

/** Validate proxy URL format: http(s)://[user:pass@]host:port */
function isValidProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname;
  } catch {
    return false;
  }
}
