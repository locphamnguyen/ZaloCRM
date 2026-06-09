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
import { resolveSegmentToContactIds } from './segment-resolver.js';
import { automationTaskStub as _automationTaskStub } from './_automation-task-stub.js';
import {
  buildSequenceStepJobId,
  getSequenceStepQueue,
} from '../queues/queue-registry.js';

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

// segmentSpec evaluation — Refactored 2026-06-05: gọi shared resolver.
// Materializer KHÔNG cần hasZalo/excludeBlocked post-filter (gate-checks ở step
// worker đã handle), nên pass hasZalo=null + excludeBlocked=false để skip
// post-filter của shared resolver. Hint contactId vẫn ưu tiên (event đã chốt).
async function resolveSegmentContactIds(
  orgId: string,
  spec: unknown,
  hintContactId: string | null,
): Promise<string[]> {
  if (hintContactId) return [hintContactId];
  if (!spec || typeof spec !== 'object') return [];
  // Patch spec để skip post-filter của shared resolver (giữ behavior cũ).
  const specForMaterializer = { ...(spec as object), hasZalo: null, excludeBlocked: false };
  const result = await resolveSegmentToContactIds(prisma, orgId, specForMaterializer);
  if (result.rejected?.length) {
    logger.warn(`[materializer] segmentSpec criteria rejected fields: ${result.rejected.join(', ')}`);
  }
  return result.contactIds;
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
        const existing = await ((prisma as any).automationTask ?? _automationTaskStub).findFirst({
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
        await ((prisma as any).automationTask ?? _automationTaskStub).create({
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
      const existing = await ((prisma as any).automationTask ?? _automationTaskStub).findFirst({
        where: { campaignId: campaign.id, contactId },
        select: { id: true },
      });
      if (existing) {
        result.skipped++;
        result.reasons.push(`contact ${contactId}: already enrolled in campaign ${campaign.id}`);
        continue;
      }

      // Wave 1 #3.2 — Sequence mutex: skip enroll nếu KH đang trong Luồng khác active.
      // "Active" = task state in (queued, running) trong sequence-bound campaign khác (≠ campaign hiện tại)
      // cùng org. Đảm bảo 1 KH không bị fire song song nhiều Luồng cùng lúc.
      // Default: skip. Sau này có thể đổi sang queue nếu anh muốn override per-Sequence.
      const activeInOther = await ((prisma as any).automationTask ?? _automationTaskStub).findFirst({
        where: {
          orgId: event.orgId,
          contactId,
          campaignId: { not: campaign.id },
          state: { in: ['queued', 'running'] },
          sequenceId: { not: null }, // chỉ check Luồng kịch bản, block-bound 1-off không tính
        },
        select: { id: true, campaignId: true },
      });
      if (activeInOther) {
        result.skipped++;
        result.reasons.push(`contact ${contactId}: sequence_mutex — đang trong campaign ${activeInOther.campaignId}`);
        continue;
      }

      // Schedule first step. delayMinutes from step + jitter from runtime rule.
      const jitterMin = (rulesSnapshot.randomDelayPerSend?.min ?? 0) * 60 * 1000;
      const jitterMax = (rulesSnapshot.randomDelayPerSend?.max ?? 0) * 60 * 1000;
      const jitter = jitterMin + Math.random() * Math.max(0, jitterMax - jitterMin);
      const scheduledAt = new Date(now + firstStep.delayMinutes * 60 * 1000 + jitter);

      await ((prisma as any).automationTask ?? _automationTaskStub).create({
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

// =============================================================================
// Phase Friend Invite 2026-05-28 — Programmatic sequence enrollment helper.
//
// Called from task-worker post-execute hook khi request_friend task success
// AND trigger.successorSequenceId is set. Creates 1 Campaign per (trigger, contact)
// + enrolls step 0 task with assignedNickId continuity from friend-request task.
//
// Idempotent qua originTaskId — duplicate call no-op. Reuses Sequence step
// snapshot if Outbox row has sequenceVersionSnapshot.
// =============================================================================

export interface MaterializeSequenceForContactInput {
  orgId: string;
  contactId: string;
  sequenceId: string;
  triggerId: string;
  /** Nick continuity từ friend-request task — sequence tasks gắn cùng nick */
  assignedNickId: string | null;
  /** ID của request_friend task gốc — dùng cho idempotency */
  originTaskId: string;
  /** Snapshot từ Outbox (frozen at outbox insert time) — KHÔNG re-fetch sequence DB */
  sequenceSnapshot?: SequenceStep[] | null;
  /** Runtime rules từ trigger.ruleOverrides + sequence defaults */
  ruleOverrides?: Record<string, unknown> | null;
}

export async function materializeSequenceForContact(
  input: MaterializeSequenceForContactInput,
): Promise<{ campaignId: string; tasksEnqueued: number; skipped: boolean; reason?: string }> {
  // 1. Idempotency check — originTaskId may produce 1 campaign per (trigger, contact) tuple.
  //    We use AutomationTask.originTaskId field (added Wave 1.1) for explicit linkage,
  //    but for backwards compat we also check by (campaign, contact) existence.
  const existingCampaign = await prisma.automationCampaign.findFirst({
    where: {
      orgId: input.orgId,
      triggerId: input.triggerId,
      sequenceId: input.sequenceId,
      executionKind: 'sequence',
      state: 'active',
    },
    select: { id: true, rulesSnapshot: true },
  });

  // 2. Load Sequence (or use snapshot từ Outbox)
  let steps: SequenceStep[] = [];
  let baseRules: Record<string, unknown> = {};
  if (input.sequenceSnapshot && Array.isArray(input.sequenceSnapshot)) {
    steps = input.sequenceSnapshot;
  } else {
    const seq = await prisma.automationSequence.findUnique({
      where: { id: input.sequenceId },
      select: { steps: true, runtimeRules: true, enabled: true },
    });
    if (!seq || !seq.enabled) {
      return { campaignId: '', tasksEnqueued: 0, skipped: true, reason: 'sequence missing or disabled' };
    }
    steps = Array.isArray(seq.steps) ? (seq.steps as unknown as SequenceStep[]) : [];
    baseRules = (seq.runtimeRules as Record<string, unknown>) ?? {};
  }
  if (steps.length === 0) {
    return { campaignId: '', tasksEnqueued: 0, skipped: true, reason: 'sequence has no steps' };
  }

  // 3. Merge rules: sequence defaults + trigger override + input override
  const rulesSnapshot = {
    ...DEFAULT_RUNTIME_RULES,
    ...baseRules,
    ...((input.ruleOverrides as object) ?? {}),
  };

  // 4. Find or create active campaign for (trigger, sequence)
  let campaign = existingCampaign;
  if (!campaign) {
    campaign = await prisma.automationCampaign.create({
      data: {
        id: randomUUID(),
        orgId: input.orgId,
        triggerId: input.triggerId,
        executionKind: 'sequence',
        sequenceId: input.sequenceId,
        segmentSnapshot: { contactIds: [input.contactId], originTaskId: input.originTaskId } as object,
        rulesSnapshot: rulesSnapshot as object,
        state: 'active',
      },
      select: { id: true, rulesSnapshot: true },
    });
  }

  // 5. Fail-fast nếu chưa có nick continuity — worker sẽ skip nick_not_found,
  //    surface upstream để outbox-drainer log lastErrorMessage rõ ràng.
  if (!input.assignedNickId) {
    logger.warn(
      `[materializer] friend-invite enroll skipped — no assignedNickId: trigger=${input.triggerId} contact=${input.contactId} originTask=${input.originTaskId}`,
    );
    return { campaignId: campaign.id, tasksEnqueued: 0, skipped: true, reason: 'no_assigned_nick' };
  }

  // 6. Idempotency: probe BullMQ for step-0 job — replaces the dead AutomationTask
  //    stub lookup. Any state (waiting/delayed/active/completed/failed) counts as
  //    "already enrolled" — avoids re-enqueue spam from outbox-drainer retries.
  const stepZeroJobId = buildSequenceStepJobId(input.triggerId, input.contactId, 0);
  const queue = getSequenceStepQueue();
  try {
    const existingJob = await queue.getJob(stepZeroJobId);
    if (existingJob) {
      const state = await existingJob.getState().catch(() => 'unknown');
      logger.info(
        `[materializer] friend-invite dedup: step-0 job ${stepZeroJobId} already exists state=${state}`,
      );
      return {
        campaignId: campaign.id,
        tasksEnqueued: 0,
        skipped: true,
        reason: 'already_enqueued',
      };
    }
  } catch (err) {
    // getJob() should not throw, but guard against Redis blips. Fall through —
    // BullMQ jobId dedup at .add() time is the second line of defense.
    logger.warn(
      `[materializer] friend-invite getJob probe failed (will rely on add-dedup): ${(err as Error).message}`,
    );
  }

  // 7. Skip sequence mutex check (Friend Invite explicit override — anh đã chốt
  //    KH reject vẫn bám đuổi, KHÔNG cancel; sequence mutex chỉ áp dụng cho
  //    generic event-driven enrollment, KHÔNG cho friend-invite programmatic).

  // 8. Load first step's block snapshot — early-skip if archived. Worker re-checks
  //    block existence at STEP 4 (sequence-step-worker.ts:244-257), so this is a
  //    UX surface for outbox-drainer (clearer lastErrorMessage than nick_not_found).
  const firstStep = steps[0];
  const firstBlock = await prisma.block.findFirst({
    where: { id: firstStep.blockId, orgId: input.orgId },
    select: { id: true, archivedAt: true },
  });
  if (!firstBlock || firstBlock.archivedAt) {
    return {
      campaignId: campaign.id,
      tasksEnqueued: 0,
      skipped: true,
      reason: `first_block_${firstStep.blockId}_missing_or_archived`,
    };
  }

  // 9. Load trigger to read sequenceStartDelayMinutes (wizard B3 source of truth
  //    for "delay sau khi gửi lời mời → step 1 bám đuổi"). This matches the
  //    onFriendAccepted event-hook path (event-hooks.ts:168) — single source of
  //    truth across both enrollment paths.
  const trigger = await prisma.automationTrigger.findUnique({
    where: { id: input.triggerId },
    select: { sequenceStartDelayMinutes: true, state: true, enabled: true },
  });

  if (!trigger) {
    return {
      campaignId: campaign.id,
      tasksEnqueued: 0,
      skipped: true,
      reason: 'trigger_not_found',
    };
  }

  if (!trigger.enabled || trigger.state !== 'active') {
    logger.warn(
      `[materializer] friend-invite enroll skipped — trigger inactive: id=${input.triggerId} enabled=${trigger.enabled} state=${trigger.state}`,
    );
    return {
      campaignId: campaign.id,
      tasksEnqueued: 0,
      skipped: true,
      reason: `trigger_${trigger.enabled ? trigger.state : 'disabled'}`,
    };
  }

  // 10. Enqueue step 0 via BullMQ. jobId pattern DASH `${triggerId}-${contactId}-0`
  //     matches the worker's chain (sequence-step-worker.ts enqueueNextStep) so
  //     the lazy chain handoff is seamless.
  //
  //     Delay = trigger.sequenceStartDelayMinutes (wizard B3). The worker
  //     loads steps[0] fresh from DB at execution time, so we do NOT need to
  //     pass blockSnapshot here — worker re-fetches at STEP 4.
  const delayMs = Math.max(0, trigger.sequenceStartDelayMinutes * 60_000);

  try {
    await queue.add(
      'sequence-step',
      {
        triggerId: input.triggerId,
        contactId: input.contactId,
        sequenceId: input.sequenceId,
        nickId: input.assignedNickId,
        orgId: input.orgId,
        stepIdx: 0,
        totalSteps: steps.length,
      },
      {
        jobId: stepZeroJobId,
        delay: delayMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
    logger.info(
      `[sequence-step-worker] [materializer] enqueued STEP 0 friend-invite: trigger=${input.triggerId} ` +
        `contact=${input.contactId} nick=${input.assignedNickId} sequence=${input.sequenceId} ` +
        `jobId=${stepZeroJobId} delay=${delayMs}ms startDelayMin=${trigger.sequenceStartDelayMinutes} ` +
        `totalSteps=${steps.length} originTask=${input.originTaskId}`,
    );

    // ── CareSession 2026-06-07 (anh chốt): ENROLL PHIÊN ngay khi bám đuổi bắt đầu ──
    // Đây là path NGƯỜI LẠ (drainer materialize) — khách CHƯA accept vẫn nhận chuỗi
    // qua hộp lạ. Trước đây phiên chỉ sinh ở onFriendAccepted (khách bấm đồng ý), nên
    // khách "đã là bạn sẵn" hoặc "bám đuổi người lạ" KHÔNG có phiên → reply không ai báo.
    // Giờ enroll tại điểm bắt đầu bám đuổi → phiên phủ ĐÚNG BẰNG luồng. createCareSession
    // dedup theo (contact, nick, trigger, active) nên KHÔNG trùng với path accept.
    if (input.assignedNickId) {
      try {
        const nick = await prisma.zaloAccount.findUnique({
          where: { id: input.assignedNickId },
          select: { ownerUserId: true },
        });
        if (nick?.ownerUserId) {
          const { enrollFromTrigger } = await import(
            '../care-session/care-session-service.js'
          );
          await enrollFromTrigger({
            orgId: input.orgId,
            triggerId: input.triggerId,
            contactId: input.contactId,
            nickId: input.assignedNickId,
            ownerUserId: nick.ownerUserId,
            sequenceId: input.sequenceId,
            sequenceStartDelayMinutes: trigger.sequenceStartDelayMinutes,
            skipEnqueue: true, // materializer ĐÃ enqueue STEP 0 ở trên — chỉ tạo phiên.
          });
        }
      } catch (err) {
        logger.warn(
          `[materializer] care-session enroll failed (non-fatal) trigger=${input.triggerId} contact=${input.contactId}: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    // BullMQ jobId dedup — duplicate is benign (outbox-drainer retry race).
    const msg = (err as Error).message ?? '';
    if (msg.includes('exists') || msg.includes('duplicate')) {
      logger.info(
        `[sequence-step-worker] [materializer] dedup at add(): ${stepZeroJobId} already enqueued`,
      );
      return {
        campaignId: campaign.id,
        tasksEnqueued: 0,
        skipped: true,
        reason: 'already_enqueued',
      };
    }
    throw err;
  }

  // 11. Audit log — replaces the silent stub.create(). Lets outbox-drainer and
  //     UI Timeline see enrollment events. Uses 'sequence_enrolled' event type
  //     (distinct from 'sequence_step_sent' which fires only after send success).
  await prisma.automationEventLog
    .create({
      data: {
        orgId: input.orgId,
        triggerId: input.triggerId,
        contactId: input.contactId,
        nickId: input.assignedNickId,
        eventType: 'sequence_enrolled',
        detail:
          `campaign=${campaign.id} sequence=${input.sequenceId} ` +
          `jobId=${stepZeroJobId} delayMin=${trigger.sequenceStartDelayMinutes} ` +
          `originTask=${input.originTaskId}`,
      },
    })
    .catch((err) => {
      logger.warn(
        `[sequence-step-worker] [materializer] event_log write failed: ${(err as Error).message}`,
      );
    });

  logger.info(
    `[materializer] friend-invite sequence enrolled: trigger=${input.triggerId} ` +
      `contact=${input.contactId} nick=${input.assignedNickId} campaign=${campaign.id} ` +
      `originTask=${input.originTaskId}`,
  );

  return { campaignId: campaign.id, tasksEnqueued: 1, skipped: false };
}
