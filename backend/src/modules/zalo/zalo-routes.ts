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

      // Check trùng phía SERVER (Anh chốt 2026-06-11) — phòng FE bỏ qua bước check-phone
      // hoặc 2 sale quét cùng lúc. Chặn đẻ record qr_pending rác + chặn gán sai chủ.
      // Chỉ chạy khi có phone hợp lệ (FE gửi kèm sau bước nhập SĐT). Không phone → giữ
      // hành vi cũ (tạo record, fix ② sẽ dọn rác nếu quét trúng uid trùng).
      const rawPhone = (request.body?.phone ?? '').trim();
      const phone = rawPhone ? rawPhone.replace(/[\s.\-()]/g, '') : '';
      if (phone) {
        const dup = await prisma.zaloAccount.findFirst({
          where: { orgId: user.orgId, phone, archivedAt: null },
          select: { id: true, displayName: true, status: true, ownerUserId: true, owner: { select: { fullName: true } } },
        });
        if (dup) {
          if (dup.ownerUserId === userId) {
            // Nick của chính mình → KHÔNG đẻ record mới, trả lại record cũ để FE reconnect/login.
            return reply.status(200).send({ ...dup, reused: true });
          }
          // Nick người khác → chặn, hướng chủ tổ chức chuyển giao (fix ③).
          return reply.status(409).send({
            error: 'account_owned_by_other',
            code: 'account_owned_by_other',
            message: `Nick này đang do ${dup.owner?.fullName ?? 'nhân viên khác'} quản lý. Liên hệ chủ tổ chức để chuyển giao.`,
            owner: dup.owner?.fullName ?? null,
          });
        }
      }

      // FIX CORE nick trùng (Anh chốt 2026-06-12) — chặn TỪ GỐC việc đẻ 2 record cùng
      // 1 tài khoản Zalo → tranh chấp session (KICKOUT_BY_WORKER) → loop QR vô tận.
      // ROOT: check theo phone phía trên BỎ SÓT ghost cũ KHÔNG có phone (tạo trước khi có
      // logic lưu phone, hoặc sale bỏ qua bước nhập SĐT). Owner connect lại → đẻ record MỚI
      // có UID, record GHOST cũ (qr_pending, chưa UID) vẫn nằm đó → pool giữ cả 2 → đá nhau.
      // FIX: TÁI DÙNG ghost qr_pending CHƯA CONNECT của chính owner (zaloUid=null = chưa
      // phải nick thật) thay vì tạo mới. Nick chưa có UID thì login vào record cũ là đúng;
      // gộp luôn phone mới nhập vào ghost để lần sau check-by-phone bắt được.
      const ghost = await prisma.zaloAccount.findFirst({
        where: {
          orgId: user.orgId,
          ownerUserId: userId,
          zaloUid: null,            // chưa từng connect thành công → chưa phải nick thật
          status: 'qr_pending',
          archivedAt: null,
        },
        orderBy: { createdAt: 'asc' },  // tái dùng ghost CŨ NHẤT (dọn rác tồn lâu nhất)
        select: { id: true, displayName: true, status: true, ownerUserId: true },
      });
      if (ghost) {
        // Cập nhật phone/displayName mới nhập (nếu có) vào ghost rồi trả về để FE login.
        const reused = await prisma.zaloAccount.update({
          where: { id: ghost.id },
          data: {
            ...(phone ? { phone } : {}),
            ...(displayName ? { displayName } : {}),
            ...(proxyUrl !== undefined ? { proxyUrl: proxyUrl ?? null } : {}),
          },
          select: { id: true, displayName: true, status: true, ownerUserId: true, phone: true },
        });
        return reply.status(200).send({ ...reused, reused: true, reusedGhost: true });
      }

      // FIX 2026-05-22 Bug A: tạo nick + auto-insert ZaloAccountAccess cho owner.
      // Trước: owner KHÔNG hiện trong crew list (frontend đọc crew từ access table).
      // Giờ: atomic create cả 2 trong tx, owner mặc định permission='admin'.
      const account = await tenantTransaction(async (tx) => {
        const acc = await tx.zaloAccount.create({
          data: {
            orgId: user.orgId,
            ownerUserId: user.id,
            displayName: displayName ?? null,
            proxyUrl: proxyUrl ?? null,
            // Lưu phone đã nhập ở bước check (Anh chốt 2026-06-11) — để check trùng
            // ổn định + đối chiếu sau khi quét QR (fix ②). Null nếu sale bỏ qua check.
            phone: phone || null,
            status: 'qr_pending',
          },
        });
        await tx.zaloAccountAccess.create({
          data: { zaloAccountId: acc.id, userId: user.id, permission: 'admin' },
        });
        return acc;
      });

      return reply.status(201).send(account);
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
        select: { sessionData: true, proxyUrl: true },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
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
  // ?purge=true → "Xoá khỏi CRM": ngoài archive còn xoá sessionData + nhả zaloUid.
  //   Kết nối lại CÙNG tài khoản Zalo sẽ tạo nick CRM MỚI (dữ liệu CRM mới) vì uid đã nhả.
  // ?purge=false (mặc định) → chỉ ẩn: GIỮ sessionData + zaloUid để kết nối lại nguyên vẹn.
  app.delete<{ Params: { id: string }; Querystring: { purge?: string } }>(
    '/api/v1/zalo-accounts/:id',
    async (request, reply) => {
      const { id } = request.params;
      const purge = request.query.purge === 'true';
      const gate = await requireAccountManagement(request, reply, id);
      if (!gate) return reply;

      // Stop listener trước (nick archived không cần kết nối nữa).
      zaloPool.disconnect(id);
      if (purge) {
        // Wipe phiên + nhả uid → re-connect tạo nick mới. Dữ liệu conv/friend key theo
        // zaloAccountId (id) nên null uid KHÔNG mất dữ liệu; chỉ nhả khoá uid cho nick mới claim.
        await prisma.zaloAccount.update({
          where: { id },
          data: { archivedAt: new Date(), status: 'disconnected', zaloUid: null, sessionData: Prisma.DbNull },
        });
      } else {
        // Chỉ ẩn — giữ sessionData + zaloUid để kết nối lại nguyên vẹn.
        await prisma.zaloAccount.update({
          where: { id },
          data: { archivedAt: new Date(), status: 'disconnected' },
        });
      }
      // Log lifecycle 2026-06-10: xác nhận soft-delete chạy (debug "xoá không được").
      request.log?.info?.(`[zalo:${id}] soft-deleted (purge=${purge}, archivedAt set, status=disconnected, listener stopped)`);

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
      await prisma.zaloAccount.update({ where: { id }, data: { archivedAt: null } });
      return { message: 'Account restored — kết nối lại bằng QR/reconnect nếu cần' };
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
        const existing = await prisma.zaloAccount.findFirst({
          where: {
            orgId: user.orgId,
            archivedAt: null,
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
          },
          // zaloUid match đáng tin hơn phone → ưu tiên record đã có uid.
          orderBy: { zaloUid: { sort: 'desc', nulls: 'last' } },
        });

        let duplicate: {
          accountId: string;
          displayName: string | null;
          status: string;
          ownedByMe: boolean;
          owner: string | null;
        } | null = null;
        if (existing) {
          duplicate = {
            accountId: existing.id,
            displayName: existing.displayName,
            status: existing.status,
            ownedByMe: existing.ownerUserId === userId,
            owner: existing.owner?.fullName ?? null,
          };
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
