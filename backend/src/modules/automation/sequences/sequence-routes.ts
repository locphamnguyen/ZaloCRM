// Phase 7 — AutomationSequence CRUD routes.
//
// Sequence = multi-step drip with explicit delays. UI: vertical step diagram
// (anh chốt Q2 — không phải canvas, không phải flat list, mà là vertical flow
// với mỗi step là card + delay nằm giữa).
//
// Routes:
//   GET    /api/v1/automation/sequences             list
//   GET    /api/v1/automation/sequences/:id         detail (with steps + block refs)
//   POST   /api/v1/automation/sequences             create
//   PUT    /api/v1/automation/sequences/:id         update (steps/rules/name)
//   POST   /api/v1/automation/sequences/:id/enable  toggle on
//   POST   /api/v1/automation/sequences/:id/disable toggle off
//   POST   /api/v1/automation/sequences/:id/duplicate clone
//   DELETE /api/v1/automation/sequences/:id         hard delete (only if no campaigns)

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  validateSteps,
  validateRuntimeRules,
  DEFAULT_RUNTIME_RULES,
  type SequenceStep,
} from './types.js';
import { checkBlockReferences } from './block-refs.js';
import { getOwnerScope, applyOwnerScope } from '../../rbac/owner-scope.js';

// 2026-06-04 — Khối Phase 1: sync JSON steps → sequence_steps FK table.
// Worker dual-read (sequence-step-worker.ts loadSequenceSteps): ưu tiên FK table,
// fallback JSON nếu rows empty. Dual-write window 2 tuần → drop JSON 2026-06-18.
async function syncSequenceStepsTable(sequenceId: string, steps: SequenceStep[]): Promise<void> {
  try {
    await prisma.sequenceStep.deleteMany({ where: { sequenceId } });
    if (steps.length === 0) return;
    for (const [idx, s] of steps.entries()) {
      await prisma.sequenceStep.create({
        data: {
          id: randomUUID(),
          sequenceId,
          blockId: s.blockId || null,
          stepOrder: idx,
          delayMinutes: s.delayMinutes ?? 0,
          ...(s.exitCondition ? { exitCondition: s.exitCondition as unknown as object } : {}),
        },
      });
    }
  } catch (err) {
    logger.warn(`[sequence] syncSequenceStepsTable failed for ${sequenceId}: ${err}`);
    // Non-fatal: JSON write thành công, worker fallback đọc JSON cũ. Retry sweeper sau.
  }
}

const BASE = '/api/v1/automation/sequences';

export async function sequenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List sequences (sidebar feed in /automation page)
  app.get(BASE, async (request: FastifyRequest) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = { orgId: user.orgId };
    if (q.channel) where.channel = q.channel;
    if (q.enabled === 'true') where.enabled = true;
    if (q.enabled === 'false') where.enabled = false;
    // Phase Marketing Scope 2026-05-27
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'sequence',
    });
    Object.assign(where, applyOwnerScope(ownerScope));

    const sequences = await prisma.automationSequence.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { campaigns: true } },
      },
    });
    return { sequences };
  });

  // Get one sequence with embedded block lookups for editor
  app.get(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    // Phase Marketing Scope 2026-05-27: scope detail
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'sequence',
    });
    const sWhere: any = { id, orgId: user.orgId };
    Object.assign(sWhere, applyOwnerScope(ownerScope));
    const sequence = await prisma.automationSequence.findFirst({
      where: sWhere,
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!sequence) return reply.status(404).send({ error: 'sequence not found' });

    // Eager-load referenced blocks for the UI editor (avoid N+1 in client)
    const steps = Array.isArray(sequence.steps) ? (sequence.steps as unknown as SequenceStep[]) : [];
    const blockIds = Array.from(new Set(steps.map((s) => s.blockId)));
    const blocks = blockIds.length
      ? await prisma.block.findMany({
          where: { id: { in: blockIds }, orgId: user.orgId },
          select: {
            id: true, name: true, actionType: true, archivedAt: true,
            ownerNick: { select: { id: true, displayName: true } },
          },
        })
      : [];

    return { ...sequence, blocks };
  });

  // Create sequence
  app.post(BASE, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }

      const stepsValidation = validateSteps(body.steps ?? []);
      if (!stepsValidation.ok) {
        return reply.status(400).send({ error: 'steps invalid', detail: stepsValidation.error });
      }

      const rulesValidation = validateRuntimeRules(body.runtimeRules);
      if (!rulesValidation.ok) {
        return reply.status(400).send({ error: 'runtimeRules invalid', detail: rulesValidation.error });
      }

      // Check all referenced blocks exist in this org, not archived
      const refCheck = await checkBlockReferences(user.orgId, stepsValidation.steps);
      if (!refCheck.ok) {
        return reply.status(400).send({
          error: 'block references invalid',
          missingBlockIds: refCheck.missingBlockIds,
          archivedBlockIds: refCheck.archivedBlockIds,
        });
      }

      const sequence = await prisma.automationSequence.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          name: body.name.trim(),
          description: body.description ?? null,
          channel: body.channel ?? 'zalo_user',
          steps: stepsValidation.steps as unknown as object,
          runtimeRules: { ...DEFAULT_RUNTIME_RULES, ...rulesValidation.rules } as unknown as object,
          enabled: body.enabled ?? true,
          createdById: user.id,
        },
      });
      // 2026-06-04: dual-write FK table
      await syncSequenceStepsTable(sequence.id, stepsValidation.steps);
      return reply.status(201).send(sequence);
    } catch (error) {
      logger.error('[sequence] create error:', error);
      return reply.status(500).send({ error: 'Failed to create sequence' });
    }
  });

  // Update sequence — steps/rules/name can all change. Existing campaigns/tasks
  // keep their rulesSnapshot at activation time → edit is safe for in-flight runs.
  app.put(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.automationSequence.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'sequence not found' });

      const data: Record<string, unknown> = {};

      if (body.name !== undefined) data.name = body.name.trim();
      if (body.description !== undefined) data.description = body.description;
      if (body.channel !== undefined) data.channel = body.channel;
      if (body.enabled !== undefined) data.enabled = body.enabled;

      if (body.steps !== undefined) {
        const v = validateSteps(body.steps);
        if (!v.ok) return reply.status(400).send({ error: 'steps invalid', detail: v.error });
        const refCheck = await checkBlockReferences(user.orgId, v.steps);
        if (!refCheck.ok) {
          return reply.status(400).send({
            error: 'block references invalid',
            missingBlockIds: refCheck.missingBlockIds,
            archivedBlockIds: refCheck.archivedBlockIds,
          });
        }
        data.steps = v.steps as unknown as object;
      }

      if (body.runtimeRules !== undefined) {
        const v = validateRuntimeRules(body.runtimeRules);
        if (!v.ok) return reply.status(400).send({ error: 'runtimeRules invalid', detail: v.error });
        data.runtimeRules = v.rules as unknown as object;
      }

      const sequence = await prisma.automationSequence.update({ where: { id }, data });
      // 2026-06-04: dual-write FK table khi steps thay đổi
      if (body.steps !== undefined) {
        await syncSequenceStepsTable(sequence.id, sequence.steps as unknown as SequenceStep[]);
      }
      return sequence;
    } catch (error) {
      logger.error('[sequence] update error:', error);
      return reply.status(500).send({ error: 'Failed to update sequence' });
    }
  });

  // Enable/disable toggles
  app.post(`${BASE}/:id/enable`, async (request: FastifyRequest, reply: FastifyReply) => {
    return toggleEnabled(request, reply, true);
  });
  app.post(`${BASE}/:id/disable`, async (request: FastifyRequest, reply: FastifyReply) => {
    return toggleEnabled(request, reply, false);
  });

  // Duplicate
  app.post(`${BASE}/:id/duplicate`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const source = await prisma.automationSequence.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!source) return reply.status(404).send({ error: 'sequence not found' });

      const copy = await prisma.automationSequence.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          name: `${source.name} (copy)`,
          description: source.description,
          channel: source.channel,
          steps: source.steps as object,
          runtimeRules: source.runtimeRules as object,
          enabled: false, // copy starts disabled to avoid accidental double-run
          createdById: user.id,
        },
      });
      // 2026-06-04: dual-write FK table cho copy
      await syncSequenceStepsTable(copy.id, source.steps as unknown as SequenceStep[]);
      return reply.status(201).send(copy);
    } catch (error) {
      logger.error('[sequence] duplicate error:', error);
      return reply.status(500).send({ error: 'Failed to duplicate sequence' });
    }
  });

  // Hard delete — disallow if any campaigns exist (state machine integrity).
  // To free up: pause+complete campaigns first, or rename and disable.
  app.delete(`${BASE}/:id`, { preHandler: requireGrant('sequence', 'delete') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.automationSequence.findFirst({
        where: { id, orgId: user.orgId },
        include: { _count: { select: { campaigns: true } } },
      });
      if (!existing) return reply.status(404).send({ error: 'sequence not found' });

      if (existing._count.campaigns > 0) {
        return reply.status(409).send({
          error: 'sequence has campaigns',
          detail: `${existing._count.campaigns} campaign(s) reference this sequence. Disable instead, or remove campaigns first.`,
        });
      }

      await prisma.automationSequence.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      logger.error('[sequence] delete error:', error);
      return reply.status(500).send({ error: 'Failed to delete sequence' });
    }
  });
}

async function toggleEnabled(request: FastifyRequest, reply: FastifyReply, enabled: boolean) {
  try {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const existing = await prisma.automationSequence.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'sequence not found' });
    const sequence = await prisma.automationSequence.update({
      where: { id },
      data: { enabled },
    });
    return sequence;
  } catch (error) {
    logger.error('[sequence] toggle error:', error);
    return reply.status(500).send({ error: 'Failed to toggle sequence' });
  }
}
