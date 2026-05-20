// Phase 7 Engine — Campaign materializer.
//
// Bridges the gap between Trigger event firing and AutomationTask creation.
//
// Flow:
//   1. AutomationEvent arrives via event-bus
//   2. Find enabled triggers matching eventType in this org
//   3. For each trigger:
//      a. Pass eventFilter (loose equality on payload keys for now)
//      b. Resolve contactIds (single contactId from event, OR segment query)
//      c. For each contact: pass segmentSpec match → materialize Campaign + Task
//   4. Reuse existing active Campaign if same (triggerId, sequenceId) exists
//      to avoid spawning duplicate state machines per contact (idempotent on
//      double-fire). 1 contact may be in 1 active campaign per sequence.

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { DEFAULT_RUNTIME_RULES, type SequenceStep } from '../sequences/types.js';
import type { AutomationEvent } from './types.js';
import { sanitizeContactCriteria, sanitizeManualContactIds } from './segment-sanitizer.js';

export interface MaterializeResult {
  campaignsCreated: number;
  tasksEnqueued: number;
  skipped: number;
  reasons: string[];
}

// Loose event filter: every key in `filter` must equal (or includes for arrays)
// the value in payload at that key. Missing keys = no match.
function matchesEventFilter(
  filter: Record<string, unknown> | null,
  payload: unknown,
): boolean {
  if (!filter) return true;
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  for (const [k, expected] of Object.entries(filter)) {
    const actual = p[k];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

// segmentSpec evaluation. Phase 7 supports 'manual' (contactIds list) and
// 'filter' (Prisma where clause subset). 'import-batch' requires the import
// phase to ship a ContactImportBatch table — soft-checked here.
async function resolveSegmentContactIds(
  orgId: string,
  spec: unknown,
  hintContactId: string | null,
): Promise<string[]> {
  if (hintContactId) return [hintContactId]; // event already names the contact

  if (!spec || typeof spec !== 'object') return [];
  const s = spec as Record<string, unknown>;

  if (s.kind === 'manual' && Array.isArray(s.contactIds)) {
    // SECURITY FIX (A1): validate ids belong to this org before returning.
    const safeIds = sanitizeManualContactIds(s.contactIds);
    if (safeIds.length === 0) return [];
    const verified = await prisma.contact.findMany({
      where: { id: { in: safeIds }, orgId },
      select: { id: true },
    });
    return verified.map((c) => c.id);
  }

  if (s.kind === 'filter' && typeof s.criteria === 'object' && s.criteria !== null) {
    // SECURITY FIX (A1): force orgId AND-scope, strip non-whitelisted fields.
    // Previously `{ orgId, ...criteria }` allowed criteria.orgId override → cross-tenant leak.
    const result = sanitizeContactCriteria(orgId, s.criteria);
    if (!result.ok || !result.where) return [];
    if (result.rejected?.length) {
      logger.warn(`[materializer] segmentSpec criteria rejected fields: ${result.rejected.join(', ')}`);
    }
    const rows = await prisma.contact.findMany({
      where: result.where,
      select: { id: true },
      take: 10000,
    });
    return rows.map((r) => r.id);
  }

  // import-batch: soft reference (table ships later) — skip silently for now
  return [];
}

export async function materializeFromEvent(
  event: AutomationEvent,
): Promise<MaterializeResult> {
  const result: MaterializeResult = { campaignsCreated: 0, tasksEnqueued: 0, skipped: 0, reasons: [] };

  // Find enabled triggers matching eventType in this org
  const triggers = await prisma.automationTrigger.findMany({
    where: { orgId: event.orgId, eventType: event.type, enabled: true },
    include: {
      sequence: { select: { id: true, enabled: true, steps: true, runtimeRules: true } },
    },
  });

  if (triggers.length === 0) return result;

  for (const trigger of triggers) {
    // 1. eventFilter check
    if (!matchesEventFilter(trigger.eventFilter as Record<string, unknown> | null, event.payload)) {
      result.skipped++;
      result.reasons.push(`trigger ${trigger.id}: eventFilter mismatch`);
      continue;
    }

    // 2. Branch by bindingKind. Broadcast-bound triggers are out of scope here
    //    (Broadcast routes have their own dedicated materializer via fire-broadcast).
    if (trigger.bindingKind === 'broadcast') {
      result.skipped++;
      result.reasons.push(`trigger ${trigger.id}: broadcast bindingKind handled by broadcast-scheduler`);
      continue;
    }

    // ── Block-bound: single-task campaign that runs the block directly ────
    // FIX (overnight test bug): block-bound triggers were silently skipped
    // before — only sequences materialized. Now we create a single-block
    // campaign + 1 Task per resolved contact.
    if (trigger.bindingKind === 'block') {
      if (!trigger.blockId) {
        result.skipped++;
        result.reasons.push(`trigger ${trigger.id}: block bindingKind but no blockId`);
        continue;
      }
      const block = await prisma.block.findFirst({
        where: { id: trigger.blockId, orgId: event.orgId },
        select: { id: true, content: true, archivedAt: true },
      });
      if (!block || block.archivedAt) {
        result.skipped++;
        result.reasons.push(`trigger ${trigger.id}: block missing or archived`);
        continue;
      }

      const contactIds = await resolveSegmentContactIds(
        event.orgId,
        trigger.segmentSpec ?? event.segmentHint,
        event.contactId ?? null,
      );
      if (contactIds.length === 0) {
        result.skipped++;
        result.reasons.push(`trigger ${trigger.id}: no contacts resolved (block-bound)`);
        continue;
      }

      const rulesSnapshot = {
        ...DEFAULT_RUNTIME_RULES,
        ...((trigger.ruleOverrides as object) ?? {}),
      };

      // 1 campaign per trigger + 1 task per contact
      let blockCampaign = await prisma.automationCampaign.findFirst({
        where: {
          orgId: event.orgId,
          triggerId: trigger.id,
          blockId: trigger.blockId,
          state: 'active',
        },
        select: { id: true },
      });
      if (!blockCampaign) {
        blockCampaign = await prisma.automationCampaign.create({
          data: {
            id: randomUUID(),
            orgId: event.orgId,
            triggerId: trigger.id,
            executionKind: 'single_block',
            blockId: trigger.blockId,
            segmentSnapshot: { contactIds } as object,
            rulesSnapshot: rulesSnapshot as object,
            state: 'active',
          },
          select: { id: true },
        });
        result.campaignsCreated++;
      }

      // Apply jitter window for scheduling
      const jitterMin = (rulesSnapshot.randomDelayPerSend?.min ?? 0) * 60 * 1000;
      const jitterMax = (rulesSnapshot.randomDelayPerSend?.max ?? 0) * 60 * 1000;
      const baseNow = Date.now();

      for (const contactId of contactIds) {
        const existing = await prisma.automationTask.findFirst({
          where: { campaignId: blockCampaign.id, contactId },
          select: { id: true },
        });
        if (existing) {
          result.skipped++;
          result.reasons.push(`contact ${contactId}: already in block campaign ${blockCampaign.id}`);
          continue;
        }
        const jitter = jitterMin + Math.random() * Math.max(0, jitterMax - jitterMin);
        const scheduledAt = new Date(baseNow + jitter);
        await prisma.automationTask.create({
          data: {
            id: randomUUID(),
            orgId: event.orgId,
            campaignId: blockCampaign.id,
            contactId,
            // No sequence — block-bound tasks have currentStepIdx=null
            currentBlockId: block.id,
            blockSnapshot: block.content as object,
            scheduledAt,
            state: 'queued',
          },
        });
        result.tasksEnqueued++;
      }
      continue; // done with this trigger
    }

    // ── Sequence-bound: existing multi-step flow ──────────────────────────
    if (!trigger.sequenceId || !trigger.sequence) {
      result.skipped++;
      result.reasons.push(`trigger ${trigger.id}: sequence bindingKind but no sequenceId`);
      continue;
    }
    if (!trigger.sequence.enabled) {
      result.skipped++;
      result.reasons.push(`trigger ${trigger.id}: sequence disabled`);
      continue;
    }

    const steps = Array.isArray(trigger.sequence.steps)
      ? (trigger.sequence.steps as unknown as SequenceStep[])
      : [];
    if (steps.length === 0) {
      result.skipped++;
      result.reasons.push(`trigger ${trigger.id}: sequence has no steps`);
      continue;
    }

    // 3. Resolve contacts
    const contactIds = await resolveSegmentContactIds(
      event.orgId,
      trigger.segmentSpec ?? event.segmentHint,
      event.contactId ?? null,
    );
    if (contactIds.length === 0) {
      result.skipped++;
      result.reasons.push(`trigger ${trigger.id}: no contacts resolved`);
      continue;
    }

    // 4. Merge runtime rules: sequence defaults + sequence override + trigger override
    const rulesSnapshot = {
      ...DEFAULT_RUNTIME_RULES,
      ...(trigger.sequence.runtimeRules as object),
      ...((trigger.ruleOverrides as object) ?? {}),
    };

    // 5. Find or create active campaign for this trigger + sequence
    // (1 campaign per trigger × sequence; tasks span all contacts under it)
    let campaign = await prisma.automationCampaign.findFirst({
      where: {
        orgId: event.orgId,
        triggerId: trigger.id,
        sequenceId: trigger.sequenceId,
        state: 'active',
      },
      select: { id: true },
    });
    if (!campaign) {
      campaign = await prisma.automationCampaign.create({
        data: {
          id: randomUUID(),
          orgId: event.orgId,
          triggerId: trigger.id,
          executionKind: 'sequence',
          sequenceId: trigger.sequenceId,
          segmentSnapshot: { contactIds } as object,
          rulesSnapshot: rulesSnapshot as object,
          state: 'active',
        },
        select: { id: true },
      });
      result.campaignsCreated++;
    }

    // 6. Load the first step's block to snapshot content
    const firstStep = steps[0];
    const firstBlock = await prisma.block.findFirst({
      where: { id: firstStep.blockId, orgId: event.orgId },
      select: { id: true, content: true, archivedAt: true },
    });
    if (!firstBlock || firstBlock.archivedAt) {
      result.skipped++;
      result.reasons.push(`trigger ${trigger.id}: first block missing or archived`);
      continue;
    }

    // 7. For each contact: idempotent enrollment — skip if already has task for this campaign
    const now = Date.now();
    for (const contactId of contactIds) {
      const existing = await prisma.automationTask.findFirst({
        where: { campaignId: campaign.id, contactId },
        select: { id: true },
      });
      if (existing) {
        result.skipped++;
        result.reasons.push(`contact ${contactId}: already enrolled in campaign ${campaign.id}`);
        continue;
      }

      // Schedule first step. delayMinutes from step + jitter from runtime rule.
      const jitterMin = (rulesSnapshot.randomDelayPerSend?.min ?? 0) * 60 * 1000;
      const jitterMax = (rulesSnapshot.randomDelayPerSend?.max ?? 0) * 60 * 1000;
      const jitter = jitterMin + Math.random() * Math.max(0, jitterMax - jitterMin);
      const scheduledAt = new Date(now + firstStep.delayMinutes * 60 * 1000 + jitter);

      await prisma.automationTask.create({
        data: {
          id: randomUUID(),
          orgId: event.orgId,
          campaignId: campaign.id,
          contactId,
          sequenceId: trigger.sequenceId,
          currentStepIdx: 0,
          currentBlockId: firstBlock.id,
          blockSnapshot: firstBlock.content as object, // SNAPSHOT — frozen content
          scheduledAt,
          state: 'queued',
        },
      });
      result.tasksEnqueued++;
    }
  }

  if (result.tasksEnqueued > 0 || result.campaignsCreated > 0) {
    logger.info('[materializer] event handled', {
      type: event.type,
      campaigns: result.campaignsCreated,
      tasks: result.tasksEnqueued,
      skipped: result.skipped,
    });
  }

  return result;
}
