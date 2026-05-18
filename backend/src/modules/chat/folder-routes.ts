/**
 * folder-routes.ts — Account Folder CRUD cho Inbox Triage Filter (Phase 6+).
 *
 * Folder = gom 2-3 ZaloAccount thành 1 "thư mục" per-user.
 * UI Cột 1 Smax-style flat list: mỗi folder hiện composite avatar + name + count.
 *
 * Endpoints:
 *   GET    /api/v1/account-folders          — list folder của user, kèm members
 *   POST   /api/v1/account-folders          — tạo folder + assign members
 *   PUT    /api/v1/account-folders/:id      — đổi tên/màu/order
 *   DELETE /api/v1/account-folders/:id      — xoá folder (cascade members)
 *   PUT    /api/v1/account-folders/:id/members — replace toàn bộ members
 *   POST   /api/v1/account-folders/reorder  — drag-drop sắp xếp
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

export async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /account-folders ────────────────────────────────────────────────
  app.get('/api/v1/account-folders', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const folders = await prisma.accountFolder.findMany({
        where: { userId: user.id, orgId: user.orgId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          members: {
            include: {
              zaloAccount: {
                select: {
                  id: true,
                  zaloUid: true,
                  displayName: true,
                  avatarUrl: true,
                  status: true,
                },
              },
            },
          },
        },
      });

      // Hydrate counts per folder (unread + total conv)
      const folderIds = folders.map((f) => f.id);
      const counts: Record<string, { unread: number; total: number }> = {};

      for (const f of folders) {
        const accountIds = f.members.map((m) => m.zaloAccountId);
        if (accountIds.length === 0) {
          counts[f.id] = { unread: 0, total: 0 };
          continue;
        }
        // Lấy aggregate cho tất cả account trong folder
        const [unreadCount, totalCount] = await Promise.all([
          prisma.conversation.count({
            where: {
              orgId: user.orgId,
              zaloAccountId: { in: accountIds },
              unreadCount: { gt: 0 },
            },
          }),
          prisma.conversation.count({
            where: { orgId: user.orgId, zaloAccountId: { in: accountIds } },
          }),
        ]);
        counts[f.id] = { unread: unreadCount, total: totalCount };
      }

      return {
        folders: folders.map((f) => ({
          id: f.id,
          name: f.name,
          color: f.color,
          sortOrder: f.sortOrder,
          members: f.members.map((m) => m.zaloAccount),
          unreadCount: counts[f.id]?.unread ?? 0,
          totalCount: counts[f.id]?.total ?? 0,
          createdAt: f.createdAt,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'GET account-folders failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── POST /account-folders ───────────────────────────────────────────────
  app.post('/api/v1/account-folders', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as { name: string; color?: string; accountIds?: string[] };
      if (!body.name || !body.name.trim()) {
        return reply.status(400).send({ error: 'name_required' });
      }

      // Check duplicate (unique [userId, name])
      const dupe = await prisma.accountFolder.findFirst({
        where: { userId: user.id, name: body.name.trim() },
      });
      if (dupe) return reply.status(409).send({ error: 'duplicate_name' });

      // Calculate next sortOrder (last + 1)
      const last = await prisma.accountFolder.findFirst({
        where: { userId: user.id },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const nextOrder = (last?.sortOrder ?? -1) + 1;

      const folder = await prisma.accountFolder.create({
        data: {
          orgId: user.orgId,
          userId: user.id,
          name: body.name.trim(),
          color: body.color || '#6366F1',
          sortOrder: nextOrder,
        },
      });

      // Bulk insert members
      if (body.accountIds && body.accountIds.length > 0) {
        await prisma.accountFolderMember.createMany({
          data: body.accountIds.map((accountId) => ({
            folderId: folder.id,
            zaloAccountId: accountId,
          })),
          skipDuplicates: true,
        });
      }

      return reply.status(201).send(folder);
    } catch (err) {
      logger.error({ err }, 'POST account-folders failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── PUT /account-folders/:id ────────────────────────────────────────────
  app.put<{ Params: { id: string } }>(
    '/api/v1/account-folders/:id',
    async (request, reply) => {
      try {
        const user = request.user!;
        const body = request.body as {
          name?: string;
          color?: string;
          sortOrder?: number;
        };

        const folder = await prisma.accountFolder.findUnique({
          where: { id: request.params.id },
        });
        if (!folder || folder.userId !== user.id) {
          return reply.status(404).send({ error: 'folder_not_found' });
        }

        const updated = await prisma.accountFolder.update({
          where: { id: request.params.id },
          data: {
            name: body.name?.trim() ?? undefined,
            color: body.color ?? undefined,
            sortOrder: body.sortOrder ?? undefined,
          },
        });
        return updated;
      } catch (err) {
        logger.error({ err }, 'PUT account-folder failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );

  // ── DELETE /account-folders/:id ─────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/api/v1/account-folders/:id',
    async (request, reply) => {
      try {
        const user = request.user!;
        const folder = await prisma.accountFolder.findUnique({
          where: { id: request.params.id },
        });
        if (!folder || folder.userId !== user.id) {
          return reply.status(404).send({ error: 'folder_not_found' });
        }
        await prisma.accountFolder.delete({ where: { id: request.params.id } });
        return reply.status(204).send();
      } catch (err) {
        logger.error({ err }, 'DELETE account-folder failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );

  // ── PUT /account-folders/:id/members — replace toàn bộ ─────────────────
  app.put<{ Params: { id: string } }>(
    '/api/v1/account-folders/:id/members',
    async (request, reply) => {
      try {
        const user = request.user!;
        const body = request.body as { accountIds: string[] };
        if (!Array.isArray(body.accountIds)) {
          return reply.status(400).send({ error: 'accountIds_required' });
        }

        const folder = await prisma.accountFolder.findUnique({
          where: { id: request.params.id },
        });
        if (!folder || folder.userId !== user.id) {
          return reply.status(404).send({ error: 'folder_not_found' });
        }

        // Replace strategy: delete all + insert
        await prisma.$transaction([
          prisma.accountFolderMember.deleteMany({
            where: { folderId: request.params.id },
          }),
          ...(body.accountIds.length > 0
            ? [
                prisma.accountFolderMember.createMany({
                  data: body.accountIds.map((accountId) => ({
                    folderId: request.params.id,
                    zaloAccountId: accountId,
                  })),
                  skipDuplicates: true,
                }),
              ]
            : []),
        ]);

        return { ok: true, count: body.accountIds.length };
      } catch (err) {
        logger.error({ err }, 'PUT folder members failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );

  // ── POST /account-folders/reorder ────────────────────────────────────────
  app.post('/api/v1/account-folders/reorder', async (request, reply) => {
    try {
      const user = request.user!;
      const body = request.body as { folderIds: string[] };
      if (!Array.isArray(body.folderIds)) {
        return reply.status(400).send({ error: 'folderIds_required' });
      }

      // Apply order
      await prisma.$transaction(
        body.folderIds.map((id, idx) =>
          prisma.accountFolder.update({
            where: { id },
            data: { sortOrder: idx },
          })
        )
      );

      return { ok: true };
    } catch (err) {
      logger.error({ err }, 'POST folder reorder failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });
}
