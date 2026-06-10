/**
 * Zalo account management routes.
 * All endpoints require authentication via authMiddleware.
 */
import type { FastifyInstance } from 'fastify';
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
  app.post<{ Body: { displayName?: string; proxyUrl?: string } }>(
    '/api/v1/zalo-accounts',
    async (request, reply) => {
      const user = request.user!;
      const { displayName, proxyUrl } = request.body ?? {};

      if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
        return reply.status(400).send({ error: 'Invalid proxy URL format. Use: http://[user:pass@]host:port' });
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
  app.delete<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id',
    async (request, reply) => {
      const { id } = request.params;
      const gate = await requireAccountManagement(request, reply, id);
      if (!gate) return reply;

      // Stop listener trước (nick archived không cần kết nối nữa).
      zaloPool.disconnect(id);
      // 2026-06-10 ROOT CAUSE "nick kẹt qr_pending": nick archived VẪN giữ zalo_uid (unique)
      // → khi quét QR lại / thêm lại CÙNG tài khoản Zalo, nick mới lấy uid thật rồi update →
      // đụng unique constraint zalo_uid với nick archived → updateAccountDB fail → kẹt.
      // Fix: GIẢI PHÓNG zalo_uid (set null) khi soft-delete. Dữ liệu (conv/friend) key theo
      // zaloAccountId (id) nên null uid KHÔNG mất dữ liệu; chỉ nhả khoá uid cho nick mới claim.
      await prisma.zaloAccount.update({
        where: { id },
        data: { archivedAt: new Date(), status: 'disconnected', zaloUid: null },
      });
      // Log lifecycle 2026-06-10: xác nhận soft-delete chạy (debug "xoá không được").
      request.log?.info?.(`[zalo:${id}] soft-deleted (archivedAt set, status=disconnected, zaloUid freed, listener stopped)`);

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

      // Trùng nick đã kết nối trong org? (cảnh báo, vẫn cho tiếp)
      const existing = await prisma.zaloAccount.findFirst({
        where: { orgId: user.orgId, phone: normalized, archivedAt: null },
        select: { id: true, displayName: true, owner: { select: { fullName: true } } },
      });

      try {
        const { zaloOps } = await import('../../shared/zalo-operations.js');
        const found = await zaloOps.findUser(sysNick.id, normalized);
        if (!found || !(found as any).uid) {
          return { available: true, found: false, message: 'Số này chưa có Zalo (vẫn có thể quét QR nếu chắc chắn)' };
        }
        const u = found as any;
        return {
          available: true,
          found: true,
          info: {
            zaloUid: u.uid ?? null,
            displayName: u.display_name ?? u.zalo_name ?? u.username ?? null,
            avatarUrl: u.avatar ?? null,
            phone: normalized,
          },
          duplicate: existing
            ? { displayName: existing.displayName, owner: existing.owner?.fullName ?? null }
            : null,
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
