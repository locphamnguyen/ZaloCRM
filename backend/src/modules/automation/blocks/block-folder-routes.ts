// Phase 7 — BlockFolder CRUD routes.
//
// Folders organize Blocks (pattern smax.ai: KB BÁM ĐUỔI, PHÚ, THÀNH, NGỌC...).
// `ownerNickId` optional binding to a ZaloAccount — when set, engine prefers
// dispatch via that nick for blocks under this folder.
// `ownerUserId` optional binding to a sale User — folder cá nhân.
// Nested via `parentId` (1-level deep recommended; UI may flatten beyond 2).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma, tenantTransaction } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { logger } from '../../../shared/utils/logger.js';

const BASE = '/api/v1/automation/block-folders';

export async function blockFolderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List folders — 2026-06-04: visibility scoping
  // Public folders: mọi sale org thấy
  // Private folders: chỉ ownerUserId thấy
  app.get(BASE, async (request: FastifyRequest) => {
    const user = request.user!;
    const folders = await prisma.blockFolder.findMany({
      where: {
        orgId: user.orgId,
        OR: [
          { visibility: 'public' },
          { visibility: 'private', ownerUserId: user.id },
        ],
      },
      orderBy: [
        { visibility: 'asc' }, // 'private' < 'public' alphabet, nhưng UI sort theo section sau
        { name: 'asc' },
      ],
      include: {
        _count: { select: { blocks: { where: { archivedAt: null } } } },
      },
    });
    return { folders };
  });

  // Create folder — RBAC 2026-06-09: cần grant block.create
  app.post(BASE, { preHandler: requireGrant('block', 'create') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;
      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }

      // 2026-06-04: Phase 1 enforce parentId IS NULL (1 cấp). Anh chốt: folder = chức năng + visibility, không nested.
      if (body.parentId != null) {
        return reply.status(400).send({ error: 'PARENT_NOT_ALLOWED', detail: 'Phase 1 chỉ hỗ trợ folder 1 cấp' });
      }

      // 2026-06-04: visibility = 'public' | 'private'. Default 'public'.
      const visibility = body.visibility === 'private' ? 'private' : 'public';
      // Private folder phải có ownerUserId (chính sale tạo)
      const ownerUserId = visibility === 'private' ? user.id : (body.ownerUserId ?? null);

      const folder = await prisma.blockFolder.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          name: body.name.trim(),
          visibility,
          parentId: null, // enforced
          ownerNickId: body.ownerNickId ?? null,
          ownerUserId,
          createdById: user.id,
        },
      });
      return reply.status(201).send(folder);
    } catch (error) {
      logger.error('[block-folder] create error:', error);
      return reply.status(500).send({ error: 'Failed to create folder' });
    }
  });

  // Update folder (rename / re-parent / change owner binding)
  app.put(`${BASE}/:id`, { preHandler: requireGrant('block', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.blockFolder.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'folder not found' });

      // 2026-06-04 Phase 1: reject parentId != null
      if (body.parentId != null) {
        return reply.status(400).send({ error: 'PARENT_NOT_ALLOWED', detail: 'Phase 1 chỉ hỗ trợ folder 1 cấp' });
      }

      const updateData: Record<string, unknown> = {};
      if (typeof body.name === 'string') updateData.name = body.name.trim();
      if (body.visibility === 'public' || body.visibility === 'private') {
        updateData.visibility = body.visibility;
        // Đổi sang private → set ownerUserId = current user nếu chưa có
        if (body.visibility === 'private') {
          updateData.ownerUserId = user.id;
        } else {
          updateData.ownerUserId = null;
        }
      }
      if (body.ownerNickId !== undefined) updateData.ownerNickId = body.ownerNickId;

      const folder = await prisma.blockFolder.update({
        where: { id },
        data: updateData,
      });
      return folder;
    } catch (error) {
      logger.error('[block-folder] update error:', error);
      return reply.status(500).send({ error: 'Failed to update folder' });
    }
  });

  // Delete folder — only if empty (no blocks, no children).
  // Admin override via ?force=true cascades blocks to parentId.
  app.delete(`${BASE}/:id`, { preHandler: requireGrant('block', 'delete') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { force } = request.query as { force?: string };

      const existing = await prisma.blockFolder.findFirst({
        where: { id, orgId: user.orgId },
        include: {
          _count: { select: { blocks: true, children: true } },
        },
      });
      if (!existing) return reply.status(404).send({ error: 'folder not found' });

      if (existing._count.blocks > 0 || existing._count.children > 0) {
        if (force !== 'true') {
          return reply.status(409).send({
            error: 'folder not empty',
            detail: `${existing._count.blocks} block(s) + ${existing._count.children} child folder(s). Use ?force=true to cascade-detach.`,
          });
        }
        // Force: detach blocks and child folders (set their parent/folder to null)
        await tenantTransaction(async (tx) => {
          await tx.block.updateMany({ where: { folderId: id }, data: { folderId: null } });
          await tx.blockFolder.updateMany({ where: { parentId: id }, data: { parentId: null } });
        });
      }

      await prisma.blockFolder.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      logger.error('[block-folder] delete error:', error);
      return reply.status(500).send({ error: 'Failed to delete folder' });
    }
  });
}
