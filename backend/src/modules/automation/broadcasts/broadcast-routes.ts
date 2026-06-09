// ════════════════════════════════════════════════════════════════════════
// Broadcasts CRUD routes — Refactored cho Đợt 1 (2026-06-05)
// ════════════════════════════════════════════════════════════════════════
//
// Changes vs trước:
//   - Gọi shared resolveSegmentToContactIds (5 kind: manual/filter/customer-list/tag/preset-segment)
//   - Bỏ resolveSegmentContactIds duplicate (đã chuyển vào segment-resolver.ts)
//   - Đổi prisma.block → prisma.block (schema actual name)
//   - Thêm POST /preview-unsaved cho wizard (preview trước khi save)
//   - Thêm GET /helpers/preset-segments + /helpers/customer-lists + /helpers/tags
//   - Resume route giờ re-enqueue tick-0 cho worker BullMQ thật
//   - Default pacing đổi sang ms (3000-10000) + hourStart/hourEnd + nickDayCap
//
// Routes:
//   GET    /broadcasts                       list
//   GET    /broadcasts/:id                   detail
//   POST   /broadcasts                       create (draft)
//   PUT    /broadcasts/:id                   update
//   POST   /broadcasts/:id/start             draft|scheduled → running
//   POST   /broadcasts/:id/pause             running → paused
//   POST   /broadcasts/:id/resume            paused → running
//   POST   /broadcasts/:id/cancel            any → cancelled
//   POST   /broadcasts/:id/preview           dry-run for existing broadcast
//   POST   /broadcasts/preview-unsaved       dry-run for wizard (no DB write)
//   DELETE /broadcasts/:id                   hard delete (draft only)
//   GET    /broadcasts/helpers/preset-segments     list 8 pre-set segment
//   GET    /broadcasts/helpers/customer-lists      lookup CRM lists
//   GET    /broadcasts/helpers/tags                lookup Tag CRM v2

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma, tenantTransaction } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import { getOwnerScope, applyOwnerScope } from '../../rbac/owner-scope.js';
import { resolveSegmentToContactIds } from '../engine/segment-resolver.js';
import { PRESET_SEGMENTS } from '../engine/broadcasts-preset-segments.js';
import {
  getBroadcastFireQueue,
  buildBroadcastTickJobId,
} from '../queues/queue-registry.js';

const BASE = '/api/v1/automation/broadcasts';

// Default pacing — Anh chốt 2026-06-05
const DEFAULT_PACING = {
  randomDelayBetweenSends: { min: 3_000, max: 10_000 }, // ms
  hourStart: 6,
  hourEnd: 22,
  nickDayCap: 300,
  excludeBlocked: true,
  // Đợt 1 v2 2026-06-05 — Anh chốt 2-phase pipeline
  selectedNickIds: [] as string[],            // bắt buộc nhập ở wizard, validate ≥1
  allowStrangerSend: false,                    // Phase 2 default off
  strangerFindUserCapPerNick: 30,              // findUser cap/day/nick (Zalo throttle nặng)
  strangerFindUserCapPerHour: 5,
  strangerCooldownMs: 20_000,                  // delay sau mỗi findUser
  strangerSkipIfNoZaloDays: 30,                // cache PhoneSearchEvent no_zalo cross-broadcast
  strangerMaxPerBroadcast: 100,                // cap tổng Phase 2/broadcast
};

export async function broadcastRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── List ───────────────────────────────────────────────────────────────
  app.get(BASE, async (request: FastifyRequest) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { orgId: user.orgId };
    if (q.state) where.state = q.state;
    if (q.channel) where.channel = q.channel;
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'broadcast',
    });
    Object.assign(where, applyOwnerScope(ownerScope));
    const broadcasts = await prisma.automationBroadcast.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    return { broadcasts };
  });

  // ── Detail ─────────────────────────────────────────────────────────────
  app.get(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'broadcast',
    });
    const dWhere: any = { id, orgId: user.orgId };
    Object.assign(dWhere, applyOwnerScope(ownerScope));
    const bc = await prisma.automationBroadcast.findFirst({
      where: dWhere,
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
    const block = await prisma.block.findFirst({
      where: { id: bc.blockId, orgId: user.orgId },
      select: { id: true, name: true, actionType: true, content: true, archivedAt: true },
    });

    // Đợt 1 v2 2026-06-05: query Message via automationTaskId pattern `bc-{broadcastId}-%`
    // để đếm delivered (Zalo server confirm device nhận) + seen (KH mở đọc).
    // Zalo SDK listeners `delivered_messages` + `seen_messages` đã set sẵn các field này.
    const taskIdPrefix = `bc-${bc.id}-`;
    const [deliveredCount, seenCount] = await Promise.all([
      prisma.message.count({
        where: {
          automationTaskId: { startsWith: taskIdPrefix },
          deliveredAt: { not: null },
        },
      }),
      prisma.message.count({
        where: {
          automationTaskId: { startsWith: taskIdPrefix },
          seenAt: { not: null },
        },
      }),
    ]);

    return { ...bc, block, deliveredCount, seenCount };
  });

  // ── Helpers (must be before /:id route to avoid path collision) ────────
  app.get(`${BASE}/helpers/preset-segments`, async () => ({ segments: PRESET_SEGMENTS }));

  app.get(`${BASE}/helpers/customer-lists`, async (request: FastifyRequest) => {
    const user = request.user!;
    const lists = await prisma.customerList.findMany({
      where: { orgId: user.orgId, status: { in: ['processing', 'done'] }, archivedAt: null },
      select: {
        id: true, name: true, iconEmoji: true, sourceType: true, status: true,
        totalEntries: true, hasZaloEntries: true, noZaloEntries: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { lists };
  });

  app.get(`${BASE}/helpers/tags`, async (request: FastifyRequest) => {
    const user = request.user!;
    const tags = await prisma.tag.findMany({
      where: { orgId: user.orgId, scope: 'crm', archivedAt: null },
      select: {
        id: true, name: true, slug: true, color: true, emoji: true, priority: true,
        usageCount: true,
      },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    return { tags };
  });

  // Đợt 1 v2 2026-06-05: nick picker cho wizard Step 3
  app.get(`${BASE}/helpers/nicks`, async (request: FastifyRequest) => {
    const user = request.user!;
    const nicks = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true, displayName: true, status: true, phone: true, avatarUrl: true,
      },
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
    });
    // Đếm tin tự động gửi 24h gần nhất per nick để hiển thị "Tin X/cap" trong UI
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const enriched = await Promise.all(
      nicks.map(async (n: { id: string }) => {
        const sentToday = await prisma.message.count({
          where: {
            conversation: { zaloAccountId: n.id },
            senderType: 'self',
            sentAt: { gte: dayAgo },
            sentVia: 'automation',
          },
        });
        return { ...n, sentToday };
      }),
    );
    return { nicks: enriched };
  });

  // ── Create (draft) ─────────────────────────────────────────────────────
  app.post(BASE, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;
      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }
      if (!body.blockId || typeof body.blockId !== 'string') {
        return reply.status(400).send({ error: 'blockId is required' });
      }
      if (!body.segmentSpec || typeof body.segmentSpec !== 'object') {
        return reply.status(400).send({ error: 'segmentSpec is required' });
      }
      const block = await prisma.block.findFirst({
        where: { id: body.blockId, orgId: user.orgId },
        select: { id: true, actionType: true, archivedAt: true },
      });
      if (!block) return reply.status(400).send({ error: 'block not found' });
      if (block.archivedAt) return reply.status(400).send({ error: 'block is archived' });
      if (block.actionType !== 'send_message') {
        return reply.status(400).send({
          error: `broadcast requires send_message block (got '${block.actionType}')`,
        });
      }

      // Đợt 1 v2 2026-06-05: validate pacing.selectedNickIds — bắt buộc ≥1, thuộc org
      const pacingIn = body.pacing ?? {};
      const selectedNickIds: string[] = Array.isArray(pacingIn.selectedNickIds) ? pacingIn.selectedNickIds : [];
      if (selectedNickIds.length === 0) {
        return reply.status(400).send({ error: 'pacing.selectedNickIds is required (chose ≥1 nick for broadcast)' });
      }
      const validNicks = await prisma.zaloAccount.findMany({
        where: { id: { in: selectedNickIds }, orgId: user.orgId },
        select: { id: true },
      });
      if (validNicks.length !== selectedNickIds.length) {
        return reply.status(400).send({ error: 'some selectedNickIds do not belong to this org' });
      }

      const bc = await prisma.automationBroadcast.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          name: body.name.trim(),
          description: body.description ?? null,
          channel: body.channel ?? 'zalo_user',
          blockId: body.blockId,
          segmentSpec: body.segmentSpec,
          scheduleKind: body.scheduleKind ?? 'now',
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
          recurringSpec: body.recurringSpec ?? null,
          pacing: { ...DEFAULT_PACING, ...(body.pacing ?? {}) },
          state: 'draft',
          createdById: user.id,
        },
      });
      return reply.status(201).send(bc);
    } catch (error) {
      logger.error('[broadcast] create error:', error);
      return reply.status(500).send({ error: 'Failed to create broadcast' });
    }
  });

  // ── Update (draft only) ────────────────────────────────────────────────
  app.put(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;
      const existing = await prisma.automationBroadcast.findFirst({
        where: { id, orgId: user.orgId },
        select: { state: true },
      });
      if (!existing) return reply.status(404).send({ error: 'broadcast not found' });
      if (existing.state !== 'draft') {
        return reply.status(409).send({
          error: `broadcast in state '${existing.state}' — only draft can be edited. Cancel + clone to modify.`,
        });
      }
      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name.trim();
      if (body.description !== undefined) data.description = body.description;
      if (body.blockId !== undefined) data.blockId = body.blockId;
      if (body.segmentSpec !== undefined) data.segmentSpec = body.segmentSpec;
      if (body.scheduleKind !== undefined) data.scheduleKind = body.scheduleKind;
      if (body.scheduledAt !== undefined) data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
      if (body.recurringSpec !== undefined) data.recurringSpec = body.recurringSpec;
      if (body.pacing !== undefined) data.pacing = { ...DEFAULT_PACING, ...body.pacing };
      const bc = await prisma.automationBroadcast.update({ where: { id }, data });
      return bc;
    } catch (error) {
      logger.error('[broadcast] update error:', error);
      return reply.status(500).send({ error: 'Failed to update broadcast' });
    }
  });

  // ── Preview dry-run for EXISTING broadcast ─────────────────────────────
  app.post(`${BASE}/:id/preview`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({
      where: { id, orgId: user.orgId },
      select: { segmentSpec: true },
    });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
    const resolved = await resolveSegmentToContactIds(prisma, user.orgId, bc.segmentSpec);
    const friendableCount = resolved.contactIds.length === 0
      ? 0
      : await prisma.contact.count({
          where: {
            id: { in: resolved.contactIds },
            orgId: user.orgId,
            acceptedNicksCount: { gt: 0 },
          },
        });
    return {
      totalResolved: resolved.totalResolved,
      friendableRecipients: friendableCount,
      nonFriendableSkipped: resolved.contactIds.length - friendableCount,
      skipReasons: resolved.skipped,
      kind: resolved.kind,
      rejected: resolved.rejected,
    };
  });

  // ── Preview dry-run UNSAVED (wizard) ───────────────────────────────────
  // Body: { segmentSpec, sampleSize? }
  app.post(`${BASE}/preview-unsaved`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = request.body as Record<string, any>;
    if (!body || typeof body.segmentSpec !== 'object') {
      return reply.status(400).send({ error: 'segmentSpec is required' });
    }
    const resolved = await resolveSegmentToContactIds(prisma, user.orgId, body.segmentSpec);
    const friendable = resolved.contactIds.length === 0
      ? []
      : await prisma.contact.findMany({
          where: {
            id: { in: resolved.contactIds },
            orgId: user.orgId,
            acceptedNicksCount: { gt: 0 },
          },
          select: { id: true, fullName: true, phoneNormalized: true, gender: true },
          take: typeof body.sampleSize === 'number' ? Math.min(body.sampleSize, 50) : 20,
        });
    return {
      totalResolved: resolved.totalResolved,
      friendableRecipients: resolved.contactIds.length - (resolved.contactIds.length - friendable.length),
      nonFriendableSkipped: resolved.contactIds.length - friendable.length,
      skipReasons: resolved.skipped,
      kind: resolved.kind,
      rejected: resolved.rejected,
      sample: friendable,
    };
  });

  // ── Start ──────────────────────────────────────────────────────────────
  app.post(`${BASE}/:id/start`, { preHandler: requireGrant('broadcast', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const bc = await prisma.automationBroadcast.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, orgId: true, blockId: true, segmentSpec: true, pacing: true, state: true },
      });
      if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
      if (!['draft', 'scheduled', 'paused'].includes(bc.state)) {
        return reply.status(409).send({ error: `cannot start from state '${bc.state}'` });
      }
      const { resolveAndEnqueue } = await import('./fire-broadcast.js');
      const result = await resolveAndEnqueue({
        id: bc.id,
        orgId: bc.orgId,
        blockId: bc.blockId,
        segmentSpec: bc.segmentSpec,
        pacing: bc.pacing,
      });
      if (!result.claimed) {
        return reply.status(409).send({ error: 'broadcast already claimed by another process' });
      }
      return {
        ok: true,
        recipientsEnqueued: result.recipients,
        skipReasons: result.skipReasons,
      };
    } catch (error) {
      logger.error('[broadcast] start error:', error);
      return reply.status(500).send({ error: 'Failed to start broadcast' });
    }
  });

  // ── Pause ──────────────────────────────────────────────────────────────
  app.post(`${BASE}/:id/pause`, { preHandler: requireGrant('broadcast', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({ where: { id, orgId: user.orgId }, select: { state: true } });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
    if (bc.state !== 'running') return reply.status(409).send({ error: `not running` });
    await tenantTransaction(async (tx) => {
      await tx.automationBroadcast.update({ where: { id }, data: { state: 'paused' } });
      await tx.automationCampaign.updateMany({
        where: { broadcastId: id, state: 'active' },
        data: { state: 'paused' },
      });
    });
    // Worker tự stop khi check state mid-tick (KHÔNG cần xoá job — worker tự thấy state changed)
    return { ok: true };
  });

  // ── Resume — re-enqueue worker tick để pickup từ resumeCursor ──────────
  app.post(`${BASE}/:id/resume`, { preHandler: requireGrant('broadcast', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({
      where: { id, orgId: user.orgId },
      select: { state: true, orgId: true },
    });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
    if (bc.state !== 'paused') return reply.status(409).send({ error: `not paused` });
    await tenantTransaction(async (tx) => {
      await tx.automationBroadcast.update({ where: { id }, data: { state: 'running' } });
      await tx.automationCampaign.updateMany({
        where: { broadcastId: id, state: 'paused' },
        data: { state: 'active' },
      });
    });
    // Re-enqueue tick worker — pickup từ resumeCursor đã lưu
    const resumeTickIdx = Date.now() % 1_000_000; // unique tick idx tránh dedup BullMQ
    await getBroadcastFireQueue().add(
      'tick',
      { broadcastId: id, orgId: bc.orgId, tickIdx: resumeTickIdx },
      { jobId: buildBroadcastTickJobId(id, resumeTickIdx) },
    );
    return { ok: true };
  });

  // ── Cancel ─────────────────────────────────────────────────────────────
  app.post(`${BASE}/:id/cancel`, { preHandler: requireGrant('broadcast', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({ where: { id, orgId: user.orgId }, select: { state: true } });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
    await tenantTransaction(async (tx) => {
      await tx.automationBroadcast.update({
        where: { id },
        data: { state: 'cancelled', completedAt: new Date() },
      });
      await tx.automationCampaign.updateMany({
        where: { broadcastId: id, state: { in: ['active', 'paused'] } },
        data: { state: 'cancelled', completedAt: new Date() },
      });
    });
    // Worker tự stop khi check state mid-tick
    return { ok: true };
  });

  // ── Delete (draft only) ────────────────────────────────────────────────
  app.delete(`${BASE}/:id`, { preHandler: requireGrant('broadcast', 'delete') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({ where: { id, orgId: user.orgId }, select: { state: true } });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
    if (bc.state !== 'draft') return reply.status(409).send({ error: `cancel or complete first` });
    await prisma.automationBroadcast.delete({ where: { id } });
    return { ok: true };
  });
}
