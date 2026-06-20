// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * status-routes.ts — CRUD cho Status (Trạng thái KH) per-org.
 * Settings UI dùng để add/edit/delete/reorder status custom.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

interface StatusBody {
  name?: string;
  order?: number;
  color?: string | null;
  isTerminal?: boolean;
  isDefault?: boolean;
}

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List all statuses for org, ordered ascending
  app.get('/api/v1/settings/statuses', async (request: FastifyRequest) => {
    const user = request.user!;
    const statuses = await prisma.status.findMany({
      where: { orgId: user.orgId },
      orderBy: { order: 'asc' },
    });
    return { statuses };
  });

  // Create
  app.post('/api/v1/settings/statuses', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body || {}) as StatusBody;
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    try {
      const created = await prisma.status.create({
        data: {
          orgId: user.orgId,
          name: body.name.trim(),
          order: body.order ?? 0,
          color: body.color ?? null,
          isTerminal: body.isTerminal ?? false,
          isDefault: body.isDefault ?? false,
        },
      });
      // Nếu set isDefault=true, clear isDefault các status khác
      if (created.isDefault) {
        await prisma.status.updateMany({
          where: { orgId: user.orgId, id: { not: created.id }, isDefault: true },
          data: { isDefault: false },
        });
      }
      return reply.send(created);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return reply.status(409).send({ error: 'Status name đã tồn tại' });
      }
      logger.error('[status] create error:', err);
      return reply.status(500).send({ error: 'Failed to create status' });
    }
  });

  // Update
  app.put('/api/v1/settings/statuses/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as StatusBody;
    const existing = await prisma.status.findFirst({ where: { id, orgId: user.orgId } });
    if (!existing) return reply.status(404).send({ error: 'Status not found' });
    try {
      const updated = await prisma.status.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.order !== undefined ? { order: body.order } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.isTerminal !== undefined ? { isTerminal: body.isTerminal } : {}),
          ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        },
      });
      if (body.isDefault === true) {
        await prisma.status.updateMany({
          where: { orgId: user.orgId, id: { not: id }, isDefault: true },
          data: { isDefault: false },
        });
      }
      return reply.send(updated);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return reply.status(409).send({ error: 'Status name đã tồn tại' });
      }
      logger.error('[status] update error:', err);
      return reply.status(500).send({ error: 'Failed to update status' });
    }
  });

  // Reorder (bulk update order)
  app.post('/api/v1/settings/statuses/reorder', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { items } = (request.body || {}) as { items?: Array<{ id: string; order: number }> };
    if (!Array.isArray(items)) return reply.status(400).send({ error: 'items array required' });
    try {
      await tenantTransaction(async (tx) => {
        for (const it of items) {
          await tx.status.updateMany({
            where: { id: it.id, orgId: user.orgId },
            data: { order: it.order },
          });
        }
      });
      return reply.send({ updated: items.length });
    } catch (err) {
      logger.error('[status] reorder error:', err);
      return reply.status(500).send({ error: 'Failed to reorder' });
    }
  });

  // Delete (block nếu đang được contact dùng)
  app.delete('/api/v1/settings/statuses/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const existing = await prisma.status.findFirst({ where: { id, orgId: user.orgId } });
    if (!existing) return reply.status(404).send({ error: 'Status not found' });
    const inUse = await prisma.contact.count({ where: { statusId: id, orgId: user.orgId, mergedInto: null } });
    if (inUse > 0) {
      return reply.status(400).send({ error: `Status đang được ${inUse} contact dùng. Reassign trước khi xóa.`, inUse });
    }
    await prisma.status.delete({ where: { id } });
    return reply.send({ deleted: true });
  });
}
