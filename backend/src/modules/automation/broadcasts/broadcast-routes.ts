// Phase F — Broadcast CRUD routes.
//
// Broadcast = one-shot mass send: 1 block + 1 segment + schedule + pacing.
// State machine: draft → scheduled → running → completed | paused | cancelled.
//
// Routes:
//   GET    /api/v1/automation/broadcasts          list
//   GET    /api/v1/automation/broadcasts/:id      detail
//   POST   /api/v1/automation/broadcasts          create (draft)
//   PUT    /api/v1/automation/broadcasts/:id      update
//   POST   /api/v1/automation/broadcasts/:id/start    draft|scheduled → running
//   POST   /api/v1/automation/broadcasts/:id/pause    running → paused
//   POST   /api/v1/automation/broadcasts/:id/resume   paused → running
//   POST   /api/v1/automation/broadcasts/:id/cancel   any → cancelled
//   POST   /api/v1/automation/broadcasts/:id/preview  dry-run: count recipients
//   DELETE /api/v1/automation/broadcasts/:id      hard delete (draft only)

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireRole } from '../../auth/role-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import { sanitizeContactCriteria, sanitizeManualContactIds } from '../engine/segment-sanitizer.js';

const BASE = '/api/v1/automation/broadcasts';

// Default pacing — anh chốt từ memory rules
const DEFAULT_PACING = {
  distributeAcrossNicks: true,
  maxPerNickPerHour: 50, // dưới cap 300 msg/day/nick chia đều giờ
  allowedHourRange: [6, 22] as [number, number],
  randomDelayBetweenSends: { min: 15, max: 45 },
};

// Resolve segment to contactIds (mirrors campaign-materializer logic)
async function resolveSegmentContactIds(orgId: string, spec: unknown): Promise<string[]> {
  if (!spec || typeof spec !== 'object') return [];
  const s = spec as Record<string, unknown>;

  if (s.kind === 'manual' && Array.isArray(s.contactIds)) {
    const safeIds = sanitizeManualContactIds(s.contactIds);
    if (safeIds.length === 0) return [];
    const verified = await prisma.contact.findMany({
      where: { id: { in: safeIds }, orgId },
      select: { id: true },
    });
    return verified.map((c) => c.id);
  }
  if (s.kind === 'filter' && typeof s.criteria === 'object' && s.criteria !== null) {
    const result = sanitizeContactCriteria(orgId, s.criteria);
    if (!result.ok || !result.where) return [];
    if (result.rejected?.length) {
      logger.warn(`[broadcast-routes] criteria rejected: ${result.rejected.join(', ')}`);
    }
    const rows = await prisma.contact.findMany({ where: result.where, select: { id: true }, take: 10000 });
    return rows.map((r) => r.id);
  }
  if (s.kind === 'customer-list' && typeof s.listId === 'string') {
    const entries = await prisma.customerListEntry.findMany({
      where: {
        customerListId: s.listId,
        status: { in: ['enriched', 'validated'] },
        phoneValid: true,
      },
      select: { phoneE164: true, contactId: true },
      take: 50000,
    });
    const linkedContactIds = entries.map((e) => e.contactId).filter((id): id is string => Boolean(id));
    const phones84 = entries
      .filter((e) => !e.contactId && e.phoneE164)
      .map((e) => e.phoneE164!.replace(/^\+/, ''));
    if (linkedContactIds.length === 0 && phones84.length === 0) return [];
    const allIds = new Set<string>(linkedContactIds);
    if (phones84.length > 0) {
      const matched = await prisma.contact.findMany({
        where: { orgId, phoneNormalized: { in: phones84 } },
        select: { id: true },
        take: 50000,
      });
      for (const c of matched) allIds.add(c.id);
    }
    return Array.from(allIds);
  }
  return [];
}

export async function broadcastRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List
  app.get(BASE, async (request: FastifyRequest) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { orgId: user.orgId };
    if (q.state) where.state = q.state;
    if (q.channel) where.channel = q.channel;

    const broadcasts = await prisma.automationBroadcast.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    return { broadcasts };
  });

  // Detail
  app.get(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });

    // Eager-load referenced block
    const block = await prisma.block.findFirst({
      where: { id: bc.blockId, orgId: user.orgId },
      select: { id: true, name: true, actionType: true, content: true, archivedAt: true },
    });

    return { ...bc, block };
  });

  // Create (always starts as draft)
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

      // Validate block exists + not archived + actionType=send_message (broadcast = mass send)
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

  // Update (draft state only — running broadcasts are immutable for safety)
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

  // Preview — dry-run resolve segment to recipient count
  app.post(`${BASE}/:id/preview`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({
      where: { id, orgId: user.orgId },
      select: { segmentSpec: true, blockId: true },
    });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });

    const contactIds = await resolveSegmentContactIds(user.orgId, bc.segmentSpec);

    // Filter: only contacts with at least one accepted Friend (send_message needs friend)
    const friendableCount = contactIds.length === 0
      ? 0
      : await prisma.contact.count({
          where: {
            id: { in: contactIds },
            orgId: user.orgId,
            acceptedNicksCount: { gt: 0 },
          },
        });

    return {
      totalResolved: contactIds.length,
      friendableRecipients: friendableCount,
      nonFriendableSkipped: contactIds.length - friendableCount,
    };
  });

  // Start — atomic-claim broadcast and enqueue tasks via shared fire helper.
  // FIX A3: previously did find-then-update — concurrent scheduler + manual /start
  // could double-fire. Now both code paths route through resolveAndEnqueue()
  // which does updateMany({state: in [draft,scheduled,paused]}) → running atomically.
  app.post(`${BASE}/:id/start`, { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
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
      return { ok: true, recipientsEnqueued: result.recipients };
    } catch (error) {
      logger.error('[broadcast] start error:', error);
      return reply.status(500).send({ error: 'Failed to start broadcast' });
    }
  });

  // Pause — running → paused. Existing queued tasks stay queued but worker
  // skips them when it sees Campaign.state='paused'.
  app.post(`${BASE}/:id/pause`, { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({ where: { id, orgId: user.orgId }, select: { state: true } });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
    if (bc.state !== 'running') return reply.status(409).send({ error: `not running` });

    await prisma.$transaction([
      prisma.automationBroadcast.update({ where: { id }, data: { state: 'paused' } }),
      prisma.automationCampaign.updateMany({
        where: { broadcastId: id, state: 'active' },
        data: { state: 'paused' },
      }),
    ]);
    return { ok: true };
  });

  // Resume — paused → running
  app.post(`${BASE}/:id/resume`, { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({ where: { id, orgId: user.orgId }, select: { state: true } });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
    if (bc.state !== 'paused') return reply.status(409).send({ error: `not paused` });

    await prisma.$transaction([
      prisma.automationBroadcast.update({ where: { id }, data: { state: 'running' } }),
      prisma.automationCampaign.updateMany({
        where: { broadcastId: id, state: 'paused' },
        data: { state: 'active' },
      }),
    ]);
    return { ok: true };
  });

  // Cancel — any → cancelled. Marks queued tasks as skipped so worker won't pick them.
  app.post(`${BASE}/:id/cancel`, { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({ where: { id, orgId: user.orgId }, select: { state: true } });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });

    await prisma.$transaction([
      prisma.automationBroadcast.update({
        where: { id },
        data: { state: 'cancelled', completedAt: new Date() },
      }),
      prisma.automationCampaign.updateMany({
        where: { broadcastId: id, state: { in: ['active', 'paused'] } },
        data: { state: 'cancelled', completedAt: new Date() },
      }),
      prisma.automationTask.updateMany({
        where: {
          campaign: { broadcastId: id },
          state: 'queued',
        },
        data: { state: 'skipped', skipReason: 'broadcast_cancelled' },
      }),
    ]);
    return { ok: true };
  });

  // Delete — only draft state
  app.delete(`${BASE}/:id`, { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const bc = await prisma.automationBroadcast.findFirst({ where: { id, orgId: user.orgId }, select: { state: true } });
    if (!bc) return reply.status(404).send({ error: 'broadcast not found' });
    if (bc.state !== 'draft') return reply.status(409).send({ error: `cancel or complete first` });

    await prisma.automationBroadcast.delete({ where: { id } });
    return { ok: true };
  });
}

// (enqueueBroadcastTasks moved to fire-broadcast.ts — single source of truth
//  per FIX A3. Use resolveAndEnqueue() instead.)
