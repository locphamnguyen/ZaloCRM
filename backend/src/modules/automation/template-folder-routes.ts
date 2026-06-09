// Mẫu tin nhắn 2026-06-09 — MessageTemplateFolder CRUD (copy y block-folder-routes).
//
// Folder nhóm Mẫu tin nhắn theo dự án/chức năng. visibility='public' → mọi sale org
// thấy/dùng; 'private' → chỉ ownerUserId. Phase 1 enforce parentId IS NULL (1 cấp).
//
// Quyền GỘP CHUNG resource 'block' (anh chốt 2026-06-09): tạo/sửa/xóa folder cần grant
// block.create/edit/delete — giống thư mục Khối. (Folder là cấu trúc chung của org nên
// vẫn gate bằng grant, KHÁC với mẫu lẻ riêng tư của sale.)

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { logger } from '../../shared/utils/logger.js';

const BASE = '/api/v1/automation/template-folders';

export async function templateFolderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List folders — visibility scoping: public (cả org) + private của chính mình.
  app.get(BASE, async (request: FastifyRequest) => {
    const user = request.user!;
    const folders = await prisma.messageTemplateFolder.findMany({
      where: {
        orgId: user.orgId,
        OR: [
          { visibility: 'public' },
          { visibility: 'private', ownerUserId: user.id },
        ],
      },
      orderBy: [{ visibility: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { templates: { where: { archivedAt: null } } } },
      },
    });
    return { folders };
  });

  // Create folder — cần grant block.create
  app.post(BASE, { preHandler: requireGrant('block', 'create') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;
      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }
      if (body.parentId != null) {
        return reply.status(400).send({ error: 'PARENT_NOT_ALLOWED', detail: 'Phase 1 chỉ hỗ trợ folder 1 cấp' });
      }

      const visibility = body.visibility === 'private' ? 'private' : 'public';
      const ownerUserId = visibility === 'private' ? user.id : null;

      const folder = await prisma.messageTemplateFolder.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          name: body.name.trim(),
          visibility,
          parentId: null,
          ownerUserId,
          createdById: user.id,
        },
      });
      return reply.status(201).send(folder);
    } catch (error) {
      logger.error('[template-folder] create error:', error);
      return reply.status(500).send({ error: 'Failed to create folder' });
    }
  });

  // Update folder (rename / change visibility)
  app.put(`${BASE}/:id`, { preHandler: requireGrant('block', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.messageTemplateFolder.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'folder not found' });

      if (body.parentId != null) {
        return reply.status(400).send({ error: 'PARENT_NOT_ALLOWED', detail: 'Phase 1 chỉ hỗ trợ folder 1 cấp' });
      }

      const updateData: Record<string, unknown> = {};
      if (typeof body.name === 'string') updateData.name = body.name.trim();
      if (body.visibility === 'public' || body.visibility === 'private') {
        updateData.visibility = body.visibility;
        updateData.ownerUserId = body.visibility === 'private' ? user.id : null;
      }

      const folder = await prisma.messageTemplateFolder.update({
        where: { id },
        data: updateData,
      });
      return folder;
    } catch (error) {
      logger.error('[template-folder] update error:', error);
      return reply.status(500).send({ error: 'Failed to update folder' });
    }
  });

  // Delete folder — only if empty. ?force=true detach templates (folderId=null).
  app.delete(`${BASE}/:id`, { preHandler: requireGrant('block', 'delete') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { force } = request.query as { force?: string };

      const existing = await prisma.messageTemplateFolder.findFirst({
        where: { id, orgId: user.orgId },
        include: { _count: { select: { templates: true, children: true } } },
      });
      if (!existing) return reply.status(404).send({ error: 'folder not found' });

      if (existing._count.templates > 0 || existing._count.children > 0) {
        if (force !== 'true') {
          return reply.status(409).send({
            error: 'folder not empty',
            detail: `${existing._count.templates} mẫu + ${existing._count.children} thư mục con. Dùng ?force=true để gỡ.`,
          });
        }
        await prisma.$transaction([
          prisma.messageTemplate.updateMany({ where: { folderId: id }, data: { folderId: null } }),
          prisma.messageTemplateFolder.updateMany({ where: { parentId: id }, data: { parentId: null } }),
        ]);
      }

      await prisma.messageTemplateFolder.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      logger.error('[template-folder] delete error:', error);
      return reply.status(500).send({ error: 'Failed to delete folder' });
    }
  });
}
