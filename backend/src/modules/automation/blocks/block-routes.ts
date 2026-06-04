// Phase 7 — Block CRUD routes.
//
// Block = atomic content/action unit. CENTRAL ENTITY — referenced by:
//   - AutomationSequence.steps[].blockId  (many-to-many via JSON)
//   - AutomationBroadcast.blockId         (FK 1:1)
//   - AutomationTrigger.blockId           (FK 0..1)
//
// content shape varies by actionType (see ./types.ts).
// archivedAt = soft delete (engine still honors snapshots inside running tasks).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireRole } from '../../auth/role-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import { getOwnerScope, applyOwnerScope } from '../../rbac/owner-scope.js';
import { automationTaskStub as _automationTaskStub } from '../engine/_automation-task-stub.js';
import {
  isSupportedActionType,
  validateBlockContent,
  type BlockActionType,
} from './types.js';

const BASE = '/api/v1/automation/blocks';

export async function blockRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List blocks — supports filter by channel, actionType, folderId, archived.
  app.get(BASE, async (request: FastifyRequest) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = { orgId: user.orgId };
    if (q.channel) where.channel = q.channel;
    if (q.actionType) where.actionType = q.actionType;
    if (q.folderId) where.folderId = q.folderId;
    if (q.includeArchived !== 'true') where.archivedAt = null;
    if (q.ownerNickId) where.ownerNickId = q.ownerNickId;
    // 2026-06-04: filter theo tag dự án/mục đích (multi). q.tags=#SunshineQ7,#VIP → array contains.
    if (q.tags) {
      const tagList = q.tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) where.tagIds = { hasSome: tagList };
    }
    // Phase Marketing Scope 2026-05-27: sale chỉ thấy block mình tạo;
    // manager thấy block của subordinate; admin thấy tất cả.
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'block',
    });
    Object.assign(where, applyOwnerScope(ownerScope));

    const blocks = await prisma.block.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: Math.min(Number(q.limit) || 100, 500),
      include: {
        folder: { select: { id: true, name: true, visibility: true } }, // 2026-06-04 include visibility
        ownerNick: { select: { id: true, displayName: true } },
      },
    });
    return { blocks };
  });

  // Get one block (full content)
  app.get(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    // Phase Marketing Scope 2026-05-27: assert ownership trước khi trả content
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'block',
    });
    const where: any = { id, orgId: user.orgId };
    Object.assign(where, applyOwnerScope(ownerScope));
    const block = await prisma.block.findFirst({
      where,
      include: {
        folder: { select: { id: true, name: true } },
        ownerNick: { select: { id: true, displayName: true } },
      },
    });
    if (!block) return reply.status(404).send({ error: 'block not found' });
    return block;
  });

  // Create block
  app.post(BASE, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }
      if (!isSupportedActionType(body.actionType)) {
        return reply.status(400).send({
          error: `actionType '${body.actionType}' not supported in phase 7. Supported: request_friend, send_message, update_status`,
        });
      }

      const contentValidation = validateBlockContent(body.actionType as BlockActionType, body.content);
      if (!contentValidation.ok) {
        return reply.status(400).send({ error: 'content invalid', detail: contentValidation.error });
      }

      // Optional FK validation
      if (body.folderId) {
        const folder = await prisma.blockFolder.findFirst({
          where: { id: body.folderId, orgId: user.orgId },
          select: { id: true },
        });
        if (!folder) return reply.status(400).send({ error: 'folder not found' });
      }
      if (body.ownerNickId) {
        // Phase Zalo Account Mutation Gate 2026-05-27: ownerNickId phải nằm
        // trong scope của user create — chặn sale phòng A bind block trên nick
        // sale phòng B → block sẽ chạy automation trên nick lạ.
        const { getZaloScope } = await import('../../zalo/zalo-scope.js');
        const scope = await getZaloScope(user.id, user.orgId, user.role);
        if (!scope.isOrgAdmin && !scope.accessibleIds.includes(body.ownerNickId)) {
          return reply.status(403).send({
            error: 'Bạn không có quyền dùng nick này làm ownerNick',
            code: 'owner_nick_not_in_scope',
          });
        }
        const nick = await prisma.zaloAccount.findFirst({
          where: { id: body.ownerNickId, orgId: user.orgId },
          select: { id: true },
        });
        if (!nick) return reply.status(400).send({ error: 'ownerNick not found' });
      }

      const block = await prisma.block.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          folderId: body.folderId ?? null,
          name: body.name.trim(),
          channel: body.channel ?? 'zalo_user',
          actionType: body.actionType,
          content: body.content,
          ownerNickId: body.ownerNickId ?? null,
          isShared: body.isShared ?? true,
          createdById: user.id,
        },
      });
      return reply.status(201).send(block);
    } catch (error) {
      logger.error('[block] create error:', error);
      return reply.status(500).send({ error: 'Failed to create block' });
    }
  });

  // Update block — content edits create a NEW snapshot reference at task-enroll
  // time, so running tasks keep their frozen content (anh chốt Q1 snapshot rule).
  app.put(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, actionType: true, archivedAt: true },
      });
      if (!existing) return reply.status(404).send({ error: 'block not found' });
      if (existing.archivedAt) {
        return reply.status(409).send({ error: 'block is archived; unarchive first' });
      }

      // If actionType changes, revalidate content against NEW actionType.
      const effectiveActionType = (body.actionType ?? existing.actionType) as BlockActionType;
      if (body.actionType !== undefined && !isSupportedActionType(body.actionType)) {
        return reply.status(400).send({ error: `actionType '${body.actionType}' not supported` });
      }
      if (body.content !== undefined) {
        const v = validateBlockContent(effectiveActionType, body.content);
        if (!v.ok) return reply.status(400).send({ error: 'content invalid', detail: v.error });
      }

      // Phase Zalo Account Mutation Gate 2026-05-27: validate ownerNickId in scope khi update
      if (body.ownerNickId) {
        const { getZaloScope } = await import('../../zalo/zalo-scope.js');
        const scope = await getZaloScope(user.id, user.orgId, user.role);
        if (!scope.isOrgAdmin && !scope.accessibleIds.includes(body.ownerNickId)) {
          return reply.status(403).send({
            error: 'Bạn không có quyền dùng nick này làm ownerNick',
            code: 'owner_nick_not_in_scope',
          });
        }
      }
      const block = await prisma.block.update({
        where: { id },
        data: {
          name: body.name?.trim(),
          folderId: body.folderId === null ? null : body.folderId ?? undefined,
          channel: body.channel ?? undefined,
          actionType: body.actionType ?? undefined,
          content: body.content ?? undefined,
          ownerNickId: body.ownerNickId === null ? null : body.ownerNickId ?? undefined,
          isShared: body.isShared ?? undefined,
        },
      });
      return block;
    } catch (error) {
      logger.error('[block] update error:', error);
      return reply.status(500).send({ error: 'Failed to update block' });
    }
  });

  // Archive (soft delete) — running tasks unaffected because they hold their
  // own blockSnapshot. New enrollments cannot pick this block.
  app.post(`${BASE}/:id/archive`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'block not found' });

      const block = await prisma.block.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      return block;
    } catch (error) {
      logger.error('[block] archive error:', error);
      return reply.status(500).send({ error: 'Failed to archive block' });
    }
  });

  // Unarchive
  app.post(`${BASE}/:id/unarchive`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'block not found' });

      const block = await prisma.block.update({
        where: { id },
        data: { archivedAt: null },
      });
      return block;
    } catch (error) {
      logger.error('[block] unarchive error:', error);
      return reply.status(500).send({ error: 'Failed to unarchive block' });
    }
  });

  // Hard delete — only allowed if zero references (sequences/broadcasts/triggers/tasks).
  // Otherwise force user to archive instead.
  app.delete(`${BASE}/:id`, { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'block not found' });

      // Check references (sequences via JSON steps, broadcasts via FK, triggers via FK)
      const [broadcastRef, triggerRef, taskRef] = await Promise.all([
        prisma.automationBroadcast.count({ where: { blockId: id, orgId: user.orgId } }),
        prisma.automationTrigger.count({ where: { blockId: id, orgId: user.orgId } }),
        ((prisma as any).automationTask ?? _automationTaskStub).count({ where: { currentBlockId: id, orgId: user.orgId } }),
      ]);

      if (broadcastRef + triggerRef + taskRef > 0) {
        return reply.status(409).send({
          error: 'block in use',
          detail: `Referenced by ${broadcastRef} broadcast(s), ${triggerRef} trigger(s), ${taskRef} task(s). Archive instead.`,
        });
      }

      // NOTE: sequences reference via JSON steps[].blockId — Prisma cannot count
      // these efficiently. Engine validates at sequence-load time and surfaces a
      // warning in /sequences list. Force the user through archive workflow to
      // be safe.

      await prisma.block.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      logger.error('[block] delete error:', error);
      return reply.status(500).send({ error: 'Failed to delete block' });
    }
  });

  // Duplicate block (clones content, appends "(copy)" to name)
  app.post(`${BASE}/:id/duplicate`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const source = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!source) return reply.status(404).send({ error: 'block not found' });

      const copy = await prisma.block.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          folderId: source.folderId,
          name: `${source.name} (copy)`,
          channel: source.channel,
          actionType: source.actionType,
          content: source.content as object,
          ownerNickId: source.ownerNickId,
          isShared: source.isShared,
          createdById: user.id,
        },
      });
      return reply.status(201).send(copy);
    } catch (error) {
      logger.error('[block] duplicate error:', error);
      return reply.status(500).send({ error: 'Failed to duplicate block' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Anh chốt 2026-06-04 — Khối Phase 1 MVP B+C Hybrid
  // ═══════════════════════════════════════════════════════════════════════

  // GET /me/blocks/recent — last 5 Khối user dùng (cho Chat picker tab "Gần đây")
  // Reviewer R10: dùng Block.lastUsedAt thay vì tạo BlockUsageLog table (scope creep)
  app.get('/api/v1/me/blocks/recent', async (request: FastifyRequest) => {
    const user = request.user!;
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'block',
    });
    const where: Record<string, unknown> = {
      orgId: user.orgId,
      archivedAt: null,
      lastUsedAt: { not: null },
    };
    Object.assign(where, applyOwnerScope(ownerScope));
    const blocks = await prisma.block.findMany({
      where,
      orderBy: { lastUsedAt: 'desc' },
      take: 5,
      include: {
        folder: { select: { id: true, name: true, visibility: true } },
      },
    });
    return { blocks };
  });

  // POST /blocks/:id/resolve-for-send — engine call: pick random variant + return raw payload
  // Use case: BullMQ worker / Chat composer "📤 Gửi luôn" cần payload ready để dispatch.
  // Reviewer R5: nếu textVariants[] + defaultVariant đều empty → 422 BLOCK_EMPTY_TEXT
  app.post(`${BASE}/:id/resolve-for-send`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const block = await prisma.block.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null },
      });
      if (!block) return reply.status(404).send({ error: 'block not found' });

      const content = block.content as Record<string, unknown>;
      const resolved: Array<{ messageType: string; payload: unknown }> = [];

      if (block.actionType === 'request_friend') {
        const greetings = Array.isArray(content?.greetingVariants) ? content.greetingVariants as string[] : [];
        if (greetings.length === 0) {
          return reply.status(422).send({ error: 'BLOCK_EMPTY_TEXT', detail: 'Khối không có biến thể lời chào nào' });
        }
        const pick = greetings[Math.floor(Math.random() * greetings.length)];
        resolved.push({ messageType: 'friend_request', payload: { greeting: pick } });
      } else if (block.actionType === 'send_message') {
        const components = Array.isArray(content?.components) ? content.components as Array<Record<string, unknown>> : [];
        // Legacy shape fallback: { textVariants: string[], attachments: [...] }
        const legacyTextVariants = Array.isArray(content?.textVariants) ? content.textVariants as string[] : null;
        const legacyAttachments = Array.isArray(content?.attachments) ? content.attachments as Array<Record<string, unknown>> : null;
        if (components.length === 0 && !legacyTextVariants && !legacyAttachments) {
          return reply.status(422).send({ error: 'BLOCK_EMPTY_TEXT', detail: 'Khối chưa có thành phần nào' });
        }
        if (legacyTextVariants && legacyTextVariants.length > 0) {
          const pick = legacyTextVariants[Math.floor(Math.random() * legacyTextVariants.length)];
          resolved.push({ messageType: 'text', payload: { text: pick } });
        }
        for (const c of components) {
          if (c.kind === 'text') {
            const def = c.defaultVariant as Record<string, unknown> | undefined;
            const variants = Array.isArray(c.variants) ? c.variants as Array<Record<string, unknown>> : [];
            const pool = [def, ...variants].filter((v) => v && typeof (v as any).text === 'string' && (v as any).text.length > 0);
            if (pool.length === 0) continue;
            const pick = pool[Math.floor(Math.random() * pool.length)] as Record<string, unknown>;
            resolved.push({ messageType: 'text', payload: { text: pick.text, styles: pick.styles ?? null } });
          } else if (c.kind === 'image') {
            resolved.push({ messageType: 'image', payload: { url: c.url, caption: c.caption } });
          } else if (c.kind === 'album') {
            resolved.push({ messageType: 'album', payload: { items: c.items } });
          } else if (c.kind === 'file') {
            resolved.push({ messageType: 'file', payload: { url: c.url, filename: c.filename, sizeBytes: c.sizeBytes, mimeType: c.mimeType } });
          } else if (c.kind === 'video') {
            resolved.push({ messageType: 'video', payload: { url: c.url, thumbnailUrl: c.thumbnailUrl, durationSec: c.durationSec } });
          }
        }
        if (legacyAttachments) {
          for (const a of legacyAttachments) {
            resolved.push({ messageType: String(a.kind), payload: a });
          }
        }
      } else if (block.actionType === 'update_status') {
        resolved.push({ messageType: 'update_status', payload: content });
      }

      // Bump lastUsedAt + usageCount (fire-and-forget)
      void prisma.block.update({
        where: { id: block.id },
        data: { lastUsedAt: new Date(), usageCount: { increment: 1 } },
      }).catch((err) => logger.warn(`[block] bump lastUsedAt failed: ${err}`));

      return { blockId: block.id, blockName: block.name, actionType: block.actionType, resolved };
    } catch (error) {
      logger.error('[block] resolve-for-send error:', error);
      return reply.status(500).send({ error: 'Failed to resolve block' });
    }
  });

  // POST /blocks/from-composer — snapshot composer state thành Block (Approach C)
  // Reviewer R4: reject upload pending, strip emoji shortcodes, reject reply/quote, cap 20 components.
  app.post(`${BASE}/from-composer`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as {
        name?: string;
        folderId?: string;
        tagIds?: string[];
        components?: Array<Record<string, unknown>>;
      };
      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }
      if (!Array.isArray(body.components) || body.components.length === 0) {
        return reply.status(400).send({ error: 'components empty' });
      }
      if (body.components.length > 20) {
        return reply.status(400).send({ error: 'Too many components (max 20)' });
      }

      // Validate components — reject pending upload, reject reply/quote
      const cleanComponents: Array<Record<string, unknown>> = [];
      for (const c of body.components) {
        if ((c as any).uploadState === 'pending' || (c as any).uploadState === 'uploading') {
          return reply.status(400).send({ error: 'Có thành phần chưa upload xong, vui lòng đợi.' });
        }
        if ((c as any).kind === 'reply' || (c as any).kind === 'quote') {
          continue; // Phase 1 defer (Q5)
        }
        const validKinds = ['text', 'image', 'album', 'file', 'video'];
        if (!validKinds.includes(String((c as any).kind))) continue;
        if ((c as any).kind === 'album' && Array.isArray((c as any).items) && (c as any).items.length > 10) {
          return reply.status(400).send({ error: 'Album tối đa 10 hình.' });
        }
        cleanComponents.push(c);
      }
      if (cleanComponents.length === 0) {
        return reply.status(400).send({ error: 'Không có thành phần hợp lệ để lưu Khối.' });
      }

      // Verify folderId belongs to org (nếu có)
      if (body.folderId) {
        const folder = await prisma.blockFolder.findFirst({
          where: { id: body.folderId, orgId: user.orgId },
          select: { id: true },
        });
        if (!folder) return reply.status(400).send({ error: 'Folder không tồn tại' });
      }

      const created = await prisma.block.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          folderId: body.folderId ?? null,
          name: body.name,
          channel: 'zalo_user',
          actionType: 'send_message',
          content: { components: cleanComponents },
          tagIds: Array.isArray(body.tagIds) ? body.tagIds.filter((t) => typeof t === 'string') : [],
          createdById: user.id,
          isShared: true, // visibility ở Folder, Block.isShared deprecated nhưng vẫn set
        },
        include: {
          folder: { select: { id: true, name: true, visibility: true } },
        },
      });
      return reply.status(201).send(created);
    } catch (error) {
      logger.error('[block] from-composer error:', error);
      return reply.status(500).send({ error: 'Failed to save block from composer' });
    }
  });
}
