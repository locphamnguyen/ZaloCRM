// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Zalo account access control routes — manage per-user permissions on Zalo accounts.
 * Permission levels: read (view messages), chat (send messages), admin (manage account).
 * All write operations require owner/admin role.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';
import { getIo } from '../../shared/event-buffer.js';

const VALID_PERMISSIONS = ['read', 'chat', 'admin'] as const;
type Permission = (typeof VALID_PERMISSIONS)[number];

/**
 * Báo cho user bị ảnh hưởng (grant/đổi/gỡ quyền) qua socket → client tự refetch
 * danh sách nick + rớt nick khỏi UI NGAY, không cần F5. Phát tới room `user:${userId}`.
 * action: 'granted' | 'updated' | 'revoked'.
 */
function notifyAccessChanged(userId: string, zaloAccountId: string, action: string, permission: string | null): void {
  getIo()?.to(`user:${userId}`).emit('zalo:access-changed', { zaloAccountId, action, permission });
}

export async function zaloAccessRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/zalo-accounts/:id/access — list users with access to this account
  app.get('/api/v1/zalo-accounts/:id/access', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const account = await prisma.zaloAccount.findFirst({ where: { id, orgId: user.orgId } });
    if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

    const accessList = await prisma.zaloAccountAccess.findMany({
      where: { zaloAccountId: id },
      include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return { access: accessList };
  });

  // POST /api/v1/zalo-accounts/:id/access — grant access { userId, permission } (owner/admin only)
  app.post(
    '/api/v1/zalo-accounts/:id/access',
    {
      preHandler: async (req: FastifyRequest, rep: FastifyReply) => {
        // FIX 2026-05-22 Bug B: owner của nick được cấp/sửa/xóa quyền.
        // Trước: chỉ legacy role='owner'|'admin' (org-wide) — sale không phải owner-of-nick → 403.
        const user = (req as any).user;
        if (!user) return rep.status(401).send({ error: 'unauthorized' });
        // 1. Legacy admin/owner org-wide → cho qua
        if (user.role === 'owner' || user.role === 'admin') return;
        // 2. Owner của chính nick → cho qua
        const { id } = req.params as { id: string };
        const account = await prisma.zaloAccount.findFirst({
          where: { id, orgId: user.orgId },
          select: { ownerUserId: true },
        });
        if (!account) return rep.status(404).send({ error: 'Zalo account not found' });
        if (account.ownerUserId === (user.userId ?? user.id)) return;
        return rep.status(403).send({ error: 'Chỉ owner của nick hoặc admin org mới quản lý quyền truy cập' });
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { userId, permission = 'read' } = request.body as { userId: string; permission?: string };

      if (!userId) return reply.status(400).send({ error: 'userId là bắt buộc' });
      if (!VALID_PERMISSIONS.includes(permission as Permission)) {
        return reply.status(400).send({ error: 'permission phải là read, chat hoặc admin' });
      }

      const account = await prisma.zaloAccount.findFirst({ where: { id, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      const targetUser = await prisma.user.findFirst({ where: { id: userId, orgId: user.orgId } });
      if (!targetUser) return reply.status(404).send({ error: 'User not found in org' });

      try {
        const access = await prisma.zaloAccountAccess.create({
          data: { id: randomUUID(), zaloAccountId: id, userId, permission },
          include: { user: { select: { id: true, fullName: true, email: true } } },
        });
        logger.info(`Zalo access granted: ${targetUser.email} → account ${id} (${permission}) by ${user.email}`);
        notifyAccessChanged(userId, id, 'granted', permission);
        return reply.status(201).send(access);
      } catch {
        // Unique constraint violation — access already exists
        return reply.status(409).send({ error: 'User đã có quyền truy cập tài khoản này' });
      }
    },
  );

  // PUT /api/v1/zalo-accounts/:id/access/:accessId — update permission (owner/admin only)
  app.put(
    '/api/v1/zalo-accounts/:id/access/:accessId',
    {
      preHandler: async (req: FastifyRequest, rep: FastifyReply) => {
        // FIX 2026-05-22 Bug B: owner của nick được cấp/sửa/xóa quyền.
        // Trước: chỉ legacy role='owner'|'admin' (org-wide) — sale không phải owner-of-nick → 403.
        const user = (req as any).user;
        if (!user) return rep.status(401).send({ error: 'unauthorized' });
        // 1. Legacy admin/owner org-wide → cho qua
        if (user.role === 'owner' || user.role === 'admin') return;
        // 2. Owner của chính nick → cho qua
        const { id } = req.params as { id: string };
        const account = await prisma.zaloAccount.findFirst({
          where: { id, orgId: user.orgId },
          select: { ownerUserId: true },
        });
        if (!account) return rep.status(404).send({ error: 'Zalo account not found' });
        if (account.ownerUserId === (user.userId ?? user.id)) return;
        return rep.status(403).send({ error: 'Chỉ owner của nick hoặc admin org mới quản lý quyền truy cập' });
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id, accessId } = request.params as { id: string; accessId: string };
      const { permission } = request.body as { permission: string };

      if (!VALID_PERMISSIONS.includes(permission as Permission)) {
        return reply.status(400).send({ error: 'permission phải là read, chat hoặc admin' });
      }

      const account = await prisma.zaloAccount.findFirst({ where: { id, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      try {
        const access = await prisma.zaloAccountAccess.update({
          where: { id: accessId, zaloAccountId: id },
          data: { permission },
          include: { user: { select: { id: true, fullName: true, email: true } } },
        });
        logger.info(`Zalo access updated: accessId ${accessId} → ${permission} by ${user.email}`);
        notifyAccessChanged(access.userId, id, 'updated', permission);
        return access;
      } catch {
        return reply.status(404).send({ error: 'Access record not found' });
      }
    },
  );

  // DELETE /api/v1/zalo-accounts/:id/access/:accessId — revoke access (owner/admin only)
  app.delete(
    '/api/v1/zalo-accounts/:id/access/:accessId',
    {
      preHandler: async (req: FastifyRequest, rep: FastifyReply) => {
        // FIX 2026-05-22 Bug B: owner của nick được cấp/sửa/xóa quyền.
        // Trước: chỉ legacy role='owner'|'admin' (org-wide) — sale không phải owner-of-nick → 403.
        const user = (req as any).user;
        if (!user) return rep.status(401).send({ error: 'unauthorized' });
        // 1. Legacy admin/owner org-wide → cho qua
        if (user.role === 'owner' || user.role === 'admin') return;
        // 2. Owner của chính nick → cho qua
        const { id } = req.params as { id: string };
        const account = await prisma.zaloAccount.findFirst({
          where: { id, orgId: user.orgId },
          select: { ownerUserId: true },
        });
        if (!account) return rep.status(404).send({ error: 'Zalo account not found' });
        if (account.ownerUserId === (user.userId ?? user.id)) return;
        return rep.status(403).send({ error: 'Chỉ owner của nick hoặc admin org mới quản lý quyền truy cập' });
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id, accessId } = request.params as { id: string; accessId: string };

      const account = await prisma.zaloAccount.findFirst({ where: { id, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      try {
        const deleted = await prisma.zaloAccountAccess.delete({ where: { id: accessId, zaloAccountId: id } });
        logger.info(`Zalo access revoked: accessId ${accessId} by ${user.email}`);
        notifyAccessChanged(deleted.userId, id, 'revoked', null);
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: 'Access record not found' });
      }
    },
  );
}
