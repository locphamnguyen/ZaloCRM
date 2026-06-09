// Phase 7 — AutomationTrigger CRUD routes + catalog endpoint.
//
// Routes:
//   GET    /api/v1/automation/triggers              list configured triggers
//   GET    /api/v1/automation/triggers/catalog      catalog metadata (UI cards)
//   GET    /api/v1/automation/triggers/:id          detail
//   POST   /api/v1/automation/triggers              create
//   PUT    /api/v1/automation/triggers/:id          update
//   POST   /api/v1/automation/triggers/:id/enable
//   POST   /api/v1/automation/triggers/:id/disable
//   DELETE /api/v1/automation/triggers/:id          hard delete (only if no active campaigns)
//
// Event listener dispatch is wired up in Phase E engine. This module only
// owns trigger configuration storage + catalog metadata.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  isSupportedEventType,
  isSupportedCategory,
  isSupportedBindingKind,
  validateBinding,
  validateEventFilter,
  TRIGGER_CATALOG,
  type TriggerBindingKind,
} from './types.js';
import { automationEventBus } from '../engine/event-bus.js';
import { getOwnerScope, applyOwnerScope } from '../../rbac/owner-scope.js';
import { registerCronTrigger, unregisterCronTrigger } from '../engine/cron-event-scheduler.js';
import { deleteFriendInviteTrigger } from '../friend-invite/friend-invite-routes.js';

const BASE = '/api/v1/automation/triggers';

export async function triggerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Catalog endpoint — static metadata for UI cards (no DB hit)
  app.get(`${BASE}/catalog`, async () => {
    return { catalog: TRIGGER_CATALOG };
  });

  // List configured triggers
  app.get(BASE, async (request: FastifyRequest) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = { orgId: user.orgId };
    if (q.eventType) where.eventType = q.eventType;
    if (q.category) where.category = q.category;
    if (q.enabled === 'true') where.enabled = true;
    if (q.enabled === 'false') where.enabled = false;
    // Phase Marketing Scope 2026-05-27
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'trigger',
    });
    Object.assign(where, applyOwnerScope(ownerScope));

    const triggers = await prisma.automationTrigger.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        sequence: { select: { id: true, name: true } },
        broadcast: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { campaigns: true } },
      },
    });
    return { triggers };
  });

  // Get one trigger
  app.get(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    // Phase Marketing Scope 2026-05-27: scope detail
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'trigger',
    });
    const tWhere: any = { id, orgId: user.orgId };
    Object.assign(tWhere, applyOwnerScope(ownerScope));
    const trigger = await prisma.automationTrigger.findFirst({
      where: tWhere,
      include: {
        sequence: { select: { id: true, name: true } },
        broadcast: { select: { id: true, name: true } },
      },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger not found' });
    return trigger;
  });

  // Create trigger
  app.post(BASE, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      // Required fields
      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }
      if (!isSupportedEventType(body.eventType)) {
        return reply.status(400).send({ error: `eventType '${body.eventType}' not supported` });
      }
      if (!isSupportedBindingKind(body.bindingKind)) {
        return reply.status(400).send({ error: `bindingKind must be sequence | block | broadcast` });
      }
      const category = body.category ?? 'general';
      if (!isSupportedCategory(category)) {
        return reply.status(400).send({ error: `category '${category}' not supported` });
      }

      // Binding validation
      const bindingCheck = validateBinding(body.bindingKind as TriggerBindingKind, {
        sequenceId: body.sequenceId,
        blockId: body.blockId,
        broadcastId: body.broadcastId,
      });
      if (!bindingCheck.ok) return reply.status(400).send({ error: bindingCheck.error });

      // eventFilter shape guard
      const filterCheck = validateEventFilter(body.eventFilter);
      if (!filterCheck.ok) return reply.status(400).send({ error: filterCheck.error });

      // FK existence checks (per binding kind)
      if (body.bindingKind === 'sequence') {
        const seq = await prisma.automationSequence.findFirst({
          where: { id: body.sequenceId, orgId: user.orgId },
          select: { id: true },
        });
        if (!seq) return reply.status(400).send({ error: 'sequence not found' });
      } else if (body.bindingKind === 'broadcast') {
        const bc = await prisma.automationBroadcast.findFirst({
          where: { id: body.broadcastId, orgId: user.orgId },
          select: { id: true },
        });
        if (!bc) return reply.status(400).send({ error: 'broadcast not found' });
      } else if (body.bindingKind === 'block') {
        const blk = await prisma.block.findFirst({
          where: { id: body.blockId, orgId: user.orgId, archivedAt: null },
          select: { id: true },
        });
        if (!blk) return reply.status(400).send({ error: 'block not found or archived' });
      }

      const trigger = await prisma.automationTrigger.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          name: body.name.trim(),
          category,
          eventType: body.eventType,
          eventFilter: body.eventFilter ?? null,
          bindingKind: body.bindingKind,
          sequenceId: body.sequenceId ?? null,
          blockId: body.blockId ?? null,
          broadcastId: body.broadcastId ?? null,
          segmentSpec: body.segmentSpec ?? null,
          ruleOverrides: body.ruleOverrides ?? null,
          enabled: body.enabled ?? true,
          createdById: user.id,
        },
      });
      // Hot-reload cron scheduler if this is a scheduled_cron trigger
      if (trigger.eventType === 'scheduled_cron' && trigger.enabled) {
        void registerCronTrigger(trigger.id);
      }
      return reply.status(201).send(trigger);
    } catch (error) {
      logger.error('[trigger] create error:', error);
      return reply.status(500).send({ error: 'Failed to create trigger' });
    }
  });

  // Update trigger
  app.put(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.automationTrigger.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!existing) return reply.status(404).send({ error: 'trigger not found' });

      // Validate type/category if changed
      if (body.eventType !== undefined && !isSupportedEventType(body.eventType)) {
        return reply.status(400).send({ error: `eventType '${body.eventType}' not supported` });
      }
      if (body.category !== undefined && !isSupportedCategory(body.category)) {
        return reply.status(400).send({ error: `category '${body.category}' not supported` });
      }
      if (body.bindingKind !== undefined && !isSupportedBindingKind(body.bindingKind)) {
        return reply.status(400).send({ error: 'bindingKind invalid' });
      }

      // Effective binding fields (merge new + existing)
      const effectiveBinding = (body.bindingKind ?? existing.bindingKind) as TriggerBindingKind;
      const effectiveIds = {
        sequenceId: body.sequenceId === undefined ? existing.sequenceId : body.sequenceId,
        blockId: body.blockId === undefined ? existing.blockId : body.blockId,
        broadcastId: body.broadcastId === undefined ? existing.broadcastId : body.broadcastId,
      };
      const bindingCheck = validateBinding(effectiveBinding, effectiveIds);
      if (!bindingCheck.ok) return reply.status(400).send({ error: bindingCheck.error });

      if (body.eventFilter !== undefined) {
        const fc = validateEventFilter(body.eventFilter);
        if (!fc.ok) return reply.status(400).send({ error: fc.error });
      }

      const trigger = await prisma.automationTrigger.update({
        where: { id },
        data: {
          name: body.name?.trim(),
          category: body.category ?? undefined,
          eventType: body.eventType ?? undefined,
          eventFilter: body.eventFilter === null ? null : body.eventFilter ?? undefined,
          bindingKind: body.bindingKind ?? undefined,
          sequenceId: body.sequenceId === null ? null : body.sequenceId ?? undefined,
          blockId: body.blockId === null ? null : body.blockId ?? undefined,
          broadcastId: body.broadcastId === null ? null : body.broadcastId ?? undefined,
          segmentSpec: body.segmentSpec === null ? null : body.segmentSpec ?? undefined,
          ruleOverrides: body.ruleOverrides === null ? null : body.ruleOverrides ?? undefined,
          enabled: body.enabled ?? undefined,
        },
      });
      // Hot-reload cron schedule (handles enable→disable, expression change, etc.)
      if (trigger.eventType === 'scheduled_cron') {
        if (trigger.enabled) void registerCronTrigger(trigger.id);
        else                 unregisterCronTrigger(trigger.id);
      }
      return trigger;
    } catch (error) {
      logger.error('[trigger] update error:', error);
      return reply.status(500).send({ error: 'Failed to update trigger' });
    }
  });

  app.post(`${BASE}/:id/enable`, async (request: FastifyRequest, reply: FastifyReply) => {
    return toggleEnabled(request, reply, true);
  });
  app.post(`${BASE}/:id/disable`, async (request: FastifyRequest, reply: FastifyReply) => {
    return toggleEnabled(request, reply, false);
  });

  // Manual run — emits an AutomationEvent of the trigger's eventType.
  // Engine materializer picks it up, creates Campaign + Tasks for resolved contacts.
  // Body: optional { contactId, segmentHint, payload } to override trigger.segmentSpec.
  app.post(`${BASE}/:id/run`, { preHandler: requireGrant('trigger', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as Record<string, any>;

      const trigger = await prisma.automationTrigger.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, eventType: true, enabled: true },
      });
      if (!trigger) return reply.status(404).send({ error: 'trigger not found' });
      if (!trigger.enabled) return reply.status(409).send({ error: 'trigger is disabled' });

      // Emit event — async, returns immediately. Engine handles enrollment.
      automationEventBus.emit({
        type: trigger.eventType as never, // narrowed: eventType column constrained at trigger create
        orgId: user.orgId,
        occurredAt: new Date(),
        contactId: typeof body.contactId === 'string' ? body.contactId : undefined,
        segmentHint: body.segmentHint && typeof body.segmentHint === 'object' ? body.segmentHint : undefined,
        payload: body.payload,
      });

      return reply.status(202).send({
        accepted: true,
        triggerId: id,
        eventType: trigger.eventType,
        note: 'Event emitted; engine will materialize tasks asynchronously',
      });
    } catch (error) {
      logger.error('[trigger] manual run error:', error);
      return reply.status(500).send({ error: 'Failed to emit trigger event' });
    }
  });

  // Hard delete — phân luồng theo eventType (gộp 2026-06-06, Anh chốt).
  //  - friend_invite_to_list → deleteFriendInviteTrigger() (stop workers + unlink
  //    entries + xóa campaigns/outbox/eventlog; chỉ khi state cancelled/draft/completed).
  //  - còn lại → logic chung: disallow nếu còn active campaigns (state machine integrity).
  // Trước đây 2 file cùng khai báo DELETE /triggers/:id → FST_ERR_DUPLICATED_ROUTE.
  app.delete(`${BASE}/:id`, { preHandler: requireGrant('trigger', 'delete') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.automationTrigger.findFirst({
        where: { id, orgId: user.orgId },
        include: {
          _count: { select: { campaigns: { where: { state: 'active' } } } },
        },
      });
      if (!existing) return reply.status(404).send({ error: 'trigger not found' });

      // Mục tiêu friend-invite có quy tắc xóa riêng → delegate.
      if (existing.eventType === 'friend_invite_to_list') {
        const result = await deleteFriendInviteTrigger({ triggerId: id, orgId: user.orgId });
        if (!result.ok) {
          return reply.status(result.status).send({
            error: result.error,
            ...(result.current ? { current: result.current } : {}),
            ...(result.hint ? { hint: result.hint } : {}),
          });
        }
        unregisterCronTrigger(id); // safe no-op
        return { success: true };
      }

      if (existing._count.campaigns > 0) {
        return reply.status(409).send({
          error: 'trigger has active campaigns',
          detail: `${existing._count.campaigns} active campaign(s). Disable instead.`,
        });
      }

      await prisma.automationTrigger.delete({ where: { id } });
      unregisterCronTrigger(id); // safe no-op if not a cron trigger
      return { success: true };
    } catch (error) {
      logger.error('[trigger] delete error:', error);
      return reply.status(500).send({ error: 'Failed to delete trigger' });
    }
  });
}

async function toggleEnabled(request: FastifyRequest, reply: FastifyReply, enabled: boolean) {
  try {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const existing = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'trigger not found' });
    const trigger = await prisma.automationTrigger.update({
      where: { id },
      data: { enabled },
    });
    // Hot-reload cron schedule if applicable
    if (trigger.eventType === 'scheduled_cron') {
      if (enabled) void registerCronTrigger(trigger.id);
      else         unregisterCronTrigger(trigger.id);
    }
    return trigger;
  } catch (error) {
    logger.error('[trigger] toggle error:', error);
    return reply.status(500).send({ error: 'Failed to toggle trigger' });
  }
}
