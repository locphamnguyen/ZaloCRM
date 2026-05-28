/**
 * Zalo account management routes.
 * All endpoints require authentication via authMiddleware.
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { getZaloScope, canManageAccount } from './zalo-scope.js';

export async function zaloRoutes(app: FastifyInstance): Promise<void> {
  // All routes in this plugin require auth
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/zalo-accounts — list accounts with live status from pool
  // RBAC scoped 2026-05-22: chỉ trả nicks user được phép xem (xem getZaloScope).
  app.get('/api/v1/zalo-accounts', async (request) => {
    const user = request.user!;
    const userId = (user as any).userId ?? user.id;
    const scope = await getZaloScope(userId, user.orgId, user.role);

    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId, id: { in: scope.accessibleIds } },
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        ownerUserId: true,
        proxyUrl: true,
        lastConnectedAt: true,
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
      const account = await prisma.$transaction(async (tx) => {
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
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      // Fire-and-forget — QR delivered via Socket.IO
      zaloPool.loginQR(id, account.proxyUrl).catch(() => {
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
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
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

  // DELETE /api/v1/zalo-accounts/:id — archive (soft-delete) or purge+archive
  // Query param ?purge=true → wipe sessionData + clear zaloUid so re-connect creates fresh nick
  app.delete<{ Params: { id: string }; Querystring: { purge?: string } }>(
    '/api/v1/zalo-accounts/:id',
    async (request, reply) => {
      const { id } = request.params;
      const purge = request.query.purge === 'true';
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      zaloPool.disconnect(id);
      if (purge) {
        await prisma.zaloAccount.update({
          where: { id },
          data: { status: 'disconnected', archivedAt: new Date(), purged: true, sessionData: Prisma.DbNull, zaloUid: null },
        });
      } else {
        await prisma.zaloAccount.update({
          where: { id },
          data: { status: 'disconnected', archivedAt: new Date() },
        });
      }

      return reply.status(204).send();
    },
  );

  // GET /api/v1/zalo-accounts/:id/status — live status from pool
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/status',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, status: true },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      return { accountId: id, liveStatus: zaloPool.getStatus(id) };
    },
  );

  // PUT /api/v1/zalo-accounts/:id/proxy — update proxy config
  app.put<{ Params: { id: string }; Body: { proxyUrl: string | null } }>(
    '/api/v1/zalo-accounts/:id/proxy',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;
      const { proxyUrl } = request.body ?? {};

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

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
