// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * crm-tag-routes.ts — CRUD cho CrmTag (system-level tag definitions).
 *
 * CrmTag là master list của tag CRM (vd "vip", "hot_lead", "quan_tâm"). Settings page
 * cho phép admin CRUD + reorder + assign category + color. Contact.tags JSON array
 * vẫn lưu tag NAME (string) — match với CrmTag.name. Free-text vẫn được phép
 * (legacy data trước khi có table này), nhưng UI suggest từ master list.
 *
 * Usage count được recompute on-demand qua GET /crm-tags?recount=1.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

/* ── Read-only enforcement cho Zalo-managed tags ──────────────────────────
 * Tag được sync tự động từ Zalo SDK (managedBy='zalo_sync', sourceZaloLabelId
 * set). User KHÔNG được sửa name/color/emoji/delete trong CRM — phải đổi trên
 * app Zalo, sync sẽ tự cập nhật. Escape hatch: header `X-Override-Managed: true`
 * (chỉ owner/admin) cho trường hợp admin cần fix data integrity.
 */
const MANAGED_BY_ZALO = 'zalo_sync';
const MSG_READ_ONLY = 'Tag này được đồng bộ từ Zalo. Đổi/gỡ trên app Zalo, hệ thống sẽ tự cập nhật.';

function hasOverride(request: FastifyRequest): boolean {
  const user = request.user;
  if (!user) return false;
  const headerVal = request.headers['x-override-managed'];
  const headerStr = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  return headerStr === 'true' && (user.role === 'owner' || user.role === 'admin');
}

export async function crmTagRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/crm-tags — list tất cả tags của org ─────────────────────
  // ?recount=1 → recompute usageCount từ Contact.tags JSON (chậm hơn, dùng khi cần fresh).
  app.get('/api/v1/crm-tags', async (request: FastifyRequest<{ Querystring: { recount?: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;

      // Optional recount: scan toàn bộ Contact.tags + map vào CrmTag.usageCount
      if (request.query.recount === '1') {
        const contacts = await prisma.contact.findMany({
          where: { orgId: user.orgId },
          select: { tags: true },
        });
        const counts = new Map<string, number>();
        for (const c of contacts) {
          const arr = Array.isArray(c.tags) ? (c.tags as string[]) : [];
          for (const tag of arr) counts.set(tag, (counts.get(tag) || 0) + 1);
        }
        const allTags = await prisma.crmTag.findMany({ where: { orgId: user.orgId } });
        await Promise.all(
          allTags.map(t => prisma.crmTag.update({
            where: { id: t.id },
            data: { usageCount: counts.get(t.name) || 0 },
          })),
        );
        // Auto-create "orphan" tags (used in Contact.tags but not defined in CrmTag)
        const definedNames = new Set(allTags.map(t => t.name));
        const orphans = [...counts.keys()].filter(n => !definedNames.has(n) && n.trim());
        if (orphans.length) {
          await prisma.crmTag.createMany({
            data: orphans.map((name, idx) => ({
              orgId: user.orgId,
              name,
              color: '#90A4AE',
              order: 1000 + idx,
              usageCount: counts.get(name) || 0,
              category: 'Khác',
              description: 'Auto-imported từ Contact.tags',
            })),
            skipDuplicates: true,
          });
        }
      }

      const tags = await prisma.crmTag.findMany({
        where: { orgId: user.orgId },
        orderBy: [{ category: 'asc' }, { order: 'asc' }, { name: 'asc' }],
      });
      return { tags };
    } catch (err) {
      logger.error('[crm-tags] List error:', err);
      return reply.status(500).send({ error: 'Failed to list crm tags' });
    }
  });

  // ── POST /api/v1/crm-tags — create ──────────────────────────────────────
  app.post('/api/v1/crm-tags', async (request: FastifyRequest<{
    Body: { name: string; color?: string; emoji?: string; description?: string; category?: string; groupId?: string };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const name = (request.body?.name || '').trim();
      if (!name) return reply.status(400).send({ error: 'name required' });
      if (name.length > 60) return reply.status(400).send({ error: 'name quá dài' });

      const existing = await prisma.crmTag.findUnique({
        where: { orgId_name: { orgId: user.orgId, name } },
      });
      if (existing) return reply.status(409).send({ error: 'Tag đã tồn tại' });

      // ── Guard: không cho tạo tag thủ công trong Zalo-sync group ─────────
      // (chỉ syncLabelsForAccount mới được tạo trong group này — bảo toàn 1-1
      // ZaloLabel ↔ CrmTag invariant). Override allowed cho admin/owner.
      if (request.body.groupId && !hasOverride(request)) {
        const group = await prisma.crmTagGroup.findFirst({
          where: { id: request.body.groupId, orgId: user.orgId },
          select: { managedBy: true },
        });
        if (group?.managedBy === MANAGED_BY_ZALO) {
          return reply.status(403).send({
            error: 'Không thể tạo tag trong nhóm Zalo. Tạo trên app Zalo, hệ thống tự đồng bộ về.',
          });
        }
      }

      const maxOrder = await prisma.crmTag.aggregate({
        where: { orgId: user.orgId },
        _max: { order: true },
      });

      const tag = await prisma.crmTag.create({
        data: {
          orgId: user.orgId,
          name,
          color: request.body.color || '#90A4AE',
          emoji: request.body.emoji || null,
          description: request.body.description || null,
          category: request.body.category || null,
          groupId: request.body.groupId || null,
          order: (maxOrder._max.order || 0) + 1,
        },
      });
      return reply.status(201).send({ tag });
    } catch (err) {
      logger.error('[crm-tags] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create crm tag' });
    }
  });

  // ── PATCH /api/v1/crm-tags/:id ──────────────────────────────────────────
  app.patch('/api/v1/crm-tags/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Body: { name?: string; color?: string; emoji?: string | null; description?: string | null; category?: string | null; order?: number; isActive?: boolean };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const tag = await prisma.crmTag.findFirst({ where: { id: request.params.id, orgId: user.orgId } });
      if (!tag) return reply.status(404).send({ error: 'Tag not found' });

      // ── Guard: Zalo-managed tag chỉ cho phép edit `order` (drag reorder trong UI).
      // Mọi field khác (name/color/emoji/description) phải đổi trên app Zalo. ──
      const body = request.body;
      if (tag.managedBy === MANAGED_BY_ZALO && !hasOverride(request)) {
        const allowedFields = ['order'];
        const attemptedFields = Object.keys(body).filter(k => body[k as keyof typeof body] !== undefined);
        const blockedFields = attemptedFields.filter(f => !allowedFields.includes(f));
        if (blockedFields.length) {
          return reply.status(403).send({
            error: MSG_READ_ONLY,
            blockedFields,
          });
        }
      }
      const data: Record<string, unknown> = {};
      if (body.color !== undefined) data.color = body.color;
      if (body.emoji !== undefined) data.emoji = body.emoji;
      if (body.description !== undefined) data.description = body.description;
      if (body.category !== undefined) data.category = body.category;
      if (body.order !== undefined) data.order = body.order;
      if (body.isActive !== undefined) data.isActive = body.isActive;

      // M57 Wave 5: route này (CrmTag rename/delete) sẽ bị remove khi Wave 5 drop
      // legacy CrmTag table. Tag v2 (Tag model) là source of truth — rename = update
      // Tag.name definition only, KHÔNG scan Contact.tags. Hiện giữ legacy logic để
      // không break UI cũ trong dual-write window Wave 3-4.
      // Đổi tên → phải update Contact.tags references để giữ consistency
      if (body.name && body.name.trim() !== tag.name) {
        const newName = body.name.trim();
        const conflict = await prisma.crmTag.findUnique({
          where: { orgId_name: { orgId: user.orgId, name: newName } },
        });
        if (conflict) return reply.status(409).send({ error: 'Tag mới đã tồn tại' });
        data.name = newName;

        // Rename trong Contact.tags JSON arrays
        const contacts = await prisma.contact.findMany({
          where: { orgId: user.orgId, tags: { array_contains: tag.name } },
          select: { id: true, tags: true },
        });
        await Promise.all(contacts.map(c => {
          const arr = Array.isArray(c.tags) ? (c.tags as string[]).map(t => t === tag.name ? newName : t) : [];
          return prisma.contact.update({ where: { id: c.id }, data: { tags: arr } });
        }));
      }

      const updated = await prisma.crmTag.update({ where: { id: tag.id }, data });
      return { tag: updated };
    } catch (err) {
      logger.error('[crm-tags] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update crm tag' });
    }
  });

  // ── DELETE /api/v1/crm-tags/:id ─────────────────────────────────────────
  // Body { removeFromContacts?: boolean } — true thì strip khỏi Contact.tags trên toàn org.
  app.delete('/api/v1/crm-tags/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Body?: { removeFromContacts?: boolean };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const tag = await prisma.crmTag.findFirst({ where: { id: request.params.id, orgId: user.orgId } });
      if (!tag) return reply.status(404).send({ error: 'Tag not found' });

      // ── Guard: KHÔNG cho xoá Zalo-managed tag. Phải xoá trên app Zalo → sync
      // sẽ tự archive. Override cho phép admin/owner force delete (vd cleanup orphan). ──
      if (tag.managedBy === MANAGED_BY_ZALO && !hasOverride(request)) {
        return reply.status(403).send({
          error: 'Tag Zalo-sync không thể xoá thủ công. Xoá trên app Zalo, hệ thống tự archive.',
        });
      }

      if (request.body?.removeFromContacts) {
        const contacts = await prisma.contact.findMany({
          where: { orgId: user.orgId, tags: { array_contains: tag.name } },
          select: { id: true, tags: true },
        });
        await Promise.all(contacts.map(c => {
          const arr = Array.isArray(c.tags) ? (c.tags as string[]).filter(t => t !== tag.name) : [];
          return prisma.contact.update({ where: { id: c.id }, data: { tags: arr } });
        }));
      }

      await prisma.crmTag.delete({ where: { id: tag.id } });
      return { ok: true };
    } catch (err) {
      logger.error('[crm-tags] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete crm tag' });
    }
  });

  // ── POST /api/v1/crm-tags/reorder — bulk reorder ────────────────────────
  // Body: { ids: string[] } — thứ tự mới, index trong array = order value.
  app.post('/api/v1/crm-tags/reorder', async (request: FastifyRequest<{ Body: { ids: string[] } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const ids = request.body?.ids || [];
      const tags = await prisma.crmTag.findMany({
        where: { id: { in: ids }, orgId: user.orgId },
        select: { id: true },
      });
      const validIds = new Set(tags.map(t => t.id));
      await Promise.all(
        ids.filter(id => validIds.has(id)).map((id, idx) =>
          prisma.crmTag.update({ where: { id }, data: { order: idx } }),
        ),
      );
      return { ok: true };
    } catch (err) {
      logger.error('[crm-tags] Reorder error:', err);
      return reply.status(500).send({ error: 'Failed to reorder' });
    }
  });
}
