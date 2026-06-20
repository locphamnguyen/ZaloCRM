// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * crm-tag-group-routes.ts — CRUD cho CrmTagGroup + list w/ tags counts.
 *
 * Read-only enforcement với group managedBy='zalo_sync': sale không được tạo
 * tag mới trong group đó, không được rename group, không xoá. Tag bên trong
 * cũng read-only — xem crm-tag-routes.ts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

export async function crmTagGroupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/crm-tag-groups — list all groups (kèm tag counts) ───────
  app.get('/api/v1/crm-tag-groups', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const groups = await prisma.crmTagGroup.findMany({
        where: { orgId: user.orgId, archivedAt: null },
        include: {
          _count: { select: { tags: true } },
          zaloAccount: { select: { id: true, displayName: true, phone: true, avatarUrl: true } },
        },
        orderBy: [{ managedBy: 'asc' }, { order: 'asc' }, { name: 'asc' }],
      });
      return { groups };
    } catch (err) {
      logger.error('[crm-tag-groups] List error:', err);
      return reply.status(500).send({ error: 'Failed to list groups' });
    }
  });

  // ── POST /api/v1/crm-tag-groups — user-defined group ────────────────────
  app.post('/api/v1/crm-tag-groups', async (request: FastifyRequest<{ Body: { name: string; order?: number } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const name = (request.body?.name || '').trim();
      if (!name) return reply.status(400).send({ error: 'name required' });

      const existing = await prisma.crmTagGroup.findUnique({
        where: { orgId_name: { orgId: user.orgId, name } },
      });
      if (existing) return reply.status(409).send({ error: 'Group đã tồn tại' });

      const group = await prisma.crmTagGroup.create({
        data: {
          orgId: user.orgId,
          name,
          order: request.body?.order ?? 0,
          // managedBy=null = user-defined; zaloAccountId=null
        },
      });
      return reply.status(201).send({ group });
    } catch (err) {
      logger.error('[crm-tag-groups] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create group' });
    }
  });

  // ── PATCH /api/v1/crm-tag-groups/:id — rename / reorder. Block zalo_sync. ─
  app.patch('/api/v1/crm-tag-groups/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Body: { name?: string; order?: number };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const group = await prisma.crmTagGroup.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
      });
      if (!group) return reply.status(404).send({ error: 'Group not found' });
      if (group.managedBy === 'zalo_sync') {
        return reply.status(403).send({
          error: 'Group này được đồng bộ từ Zalo. Đổi tên/màu trên Zalo app, hệ thống tự cập nhật.',
        });
      }
      const data: { name?: string; order?: number } = {};
      if (request.body.name !== undefined) data.name = request.body.name.trim();
      if (request.body.order !== undefined) data.order = request.body.order;
      const updated = await prisma.crmTagGroup.update({ where: { id: group.id }, data });
      return { group: updated };
    } catch (err) {
      logger.error('[crm-tag-groups] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update group' });
    }
  });

  // ── DELETE /api/v1/crm-tag-groups/:id — block zalo_sync ─────────────────
  app.delete('/api/v1/crm-tag-groups/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const group = await prisma.crmTagGroup.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
      });
      if (!group) return reply.status(404).send({ error: 'Group not found' });
      if (group.managedBy === 'zalo_sync') {
        return reply.status(403).send({
          error: 'Group Zalo không thể xoá — bị quản lý tự động bởi sync.',
        });
      }
      // Soft delete để giữ history
      await prisma.crmTagGroup.update({
        where: { id: group.id },
        data: { archivedAt: new Date() },
      });
      return { ok: true };
    } catch (err) {
      logger.error('[crm-tag-groups] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete group' });
    }
  });
}
