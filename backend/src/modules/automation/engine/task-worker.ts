// Phase 7 Engine — Task worker.
//
// Polls automation_tasks for queued rows whose scheduledAt ≤ now, runs gate
// chain, executes action via dispatcher, advances sequence step or terminates.
//
// State machine:
//   queued → running → done | failed | skipped
//
// Worker is single-process for v1. To scale: pick row with FOR UPDATE SKIP
// LOCKED (Prisma raw query) for multi-worker safety. Not needed yet.

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  TASK_STATES,
  MAX_ATTEMPT_COUNT,
  RETRY_BACKOFF_MINUTES,
  type ActionContext,
  type SequenceRuntimeRules,
} from './types.js';
import {
  checkHourRange,
  checkPerNickThrottle,
  checkDailyCap,
  checkStopOnAccept,
  checkCrossNickRecency,
  checkBlockArchived,
  checkRuleEnabled,
} from './gate-evaluator.js';
import { dispatchAction } from './action-dispatcher.js';
import { pickNickForTask } from './nick-selector.js';
import type { SequenceStep } from '../sequences/types.js';
import type { BlockActionType } from '../blocks/types.js';

// ── Worker config ─────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000; // 10s — light load v1
const BATCH_SIZE = 10;

let workerHandle: NodeJS.Timeout | null = null;
let isRunning = false;

// ── Public API ────────────────────────────────────────────────────────────

export function startTaskWorker(): void {
  if (workerHandle) {
    logger.warn('[task-worker] already started');
    return;
  }
  logger.info('[task-worker] starting (poll every ' + POLL_INTERVAL_MS / 1000 + 's)');
  workerHandle = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  // Run immediately too
  void tick();
}

export function stopTaskWorker(): void {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
    logger.info('[task-worker] stopped');
  }
}

// Single tick — exposed for testing / manual run
export async function tick(): Promise<void> {
  if (isRunning) return; // overlap protection
  isRunning = true;
  try {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - 24 * 3600 * 1000);

    // FIX A7: lease recovery. Tasks stuck in 'running' state for > 5 minutes
    // are assumed crashed (container died mid-execution) — reset to queued
    // for retry. Uses updatedAt as the lease proxy (auto-updated by Prisma on
    // state transition). No schema change needed.
    const leaseExpiry = new Date(now.getTime() - 5 * 60 * 1000);
    const reclaimed = await prisma.automationTask.updateMany({
      where: {
        state: TASK_STATES.RUNNING,
        updatedAt: { lt: leaseExpiry },
      },
      data: { state: TASK_STATES.QUEUED },
    });
    if (reclaimed.count > 0) {
      logger.warn(`[task-worker] reclaimed ${reclaimed.count} stuck-running tasks (lease expired)`);
    }
    const tasks = await prisma.automationTask.findMany({
      where: {
        state: TASK_STATES.QUEUED,
        scheduledAt: { lte: now, gte: staleCutoff },
      },
      orderBy: [{ scheduledAt: 'asc' }],
      take: BATCH_SIZE,
    });
    if (tasks.length === 0) {
      // Cleanup stale tasks (any queued task scheduled > 24h ago is stale).
      // Single-shot per tick — doesn't run if there's actual work to do.
      await prisma.automationTask.updateMany({
        where: {
          state: TASK_STATES.QUEUED,
          scheduledAt: { lt: staleCutoff },
        },
        data: { state: TASK_STATES.SKIPPED, skipReason: 'stale_scheduled_at' },
      });
      return;
    }

    logger.debug('[task-worker] processing ' + tasks.length + ' tasks');
    for (const task of tasks) {
      await processTask(task.id);
    }
  } catch (err) {
    logger.error('[task-worker] tick error:', err);
  } finally {
    isRunning = false;
  }
}

// ── Per-task execution ────────────────────────────────────────────────────

async function processTask(taskId: string): Promise<void> {
  // Atomic claim: queued → running. If another worker already claimed it,
  // updateMany returns 0 → skip.
  const claim = await prisma.automationTask.updateMany({
    where: { id: taskId, state: TASK_STATES.QUEUED },
    data: { state: TASK_STATES.RUNNING, attemptCount: { increment: 1 } },
  });
  if (claim.count === 0) return; // race lost

  const task = await prisma.automationTask.findUnique({
    where: { id: taskId },
    include: {
      campaign: {
        select: {
          id: true, state: true, sequenceId: true,
          rulesSnapshot: true,
          sequence: { select: { id: true, enabled: true, steps: true } },
        },
      },
      contact: { select: { id: true, acceptedNicksCount: true, lastInboundAt: true, lastOutboundAt: true } },
      block: { select: { id: true, archivedAt: true, actionType: true } },
    },
  });
  if (!task || !task.campaign || !task.block) {
    await markFailed(taskId, 'TASK_MISSING_REFS', 'Task missing campaign/block reference');
    return;
  }

  // Pre-flight gates ───────────────────────────────────────────────────────
  // 1. Campaign / Sequence still enabled?
  if (task.campaign.state !== 'active') {
    await markSkipped(taskId, 'rule_disabled', 'Campaign not active');
    return;
  }
  const ruleCheck = checkRuleEnabled(task.campaign.sequence?.enabled ?? true);
  if (!ruleCheck.passed) {
    await markSkipped(taskId, ruleCheck.failedGate!, ruleCheck.detail);
    return;
  }

  // 2. Block archived?
  const archCheck = checkBlockArchived(task.block.archivedAt);
  if (!archCheck.passed) {
    await markSkipped(taskId, archCheck.failedGate!, archCheck.detail);
    return;
  }

  const rules = (task.campaign.rulesSnapshot as object) as SequenceRuntimeRules;
  const actionType = task.block.actionType as BlockActionType;
  const now = new Date();

  // 3. Hour range
  const hourCheck = checkHourRange(now, rules);
  if (!hourCheck.passed) {
    await rescheduleForRetry(taskId, hourCheck.retryAfter!, hourCheck.detail);
    return;
  }

  // 4. Stop-on-accept — semantic ONLY applies to request_friend action.
  //    For send_message + update_status, sending to existing-friend is the
  //    whole point, so this gate would be wrong. (Bug found overnight test.)
  if (actionType === 'request_friend') {
    const stopCheck = checkStopOnAccept(rules, task.contact.acceptedNicksCount);
    if (!stopCheck.passed) {
      await markSkipped(taskId, stopCheck.failedGate!, stopCheck.detail);
      return;
    }
  }

  // 5. Cross-nick recency — query latest activity from OTHER nicks for this contact
  if ((rules.crossNickRecencyDays ?? 0) > 0) {
    // Use Contact.lastInboundAt as a proxy for "any nick had recent activity".
    // More precise: query Friend rows for this contact, max(lastActivityAt) across
    // assigned nicks excluding the one we're sending FROM. Defer that detail to
    // Phase E2/G when nick assignment is implemented.
    const latest = task.contact.lastInboundAt ?? task.contact.lastOutboundAt;
    const recencyCheck = checkCrossNickRecency(now, rules, latest);
    if (!recencyCheck.passed) {
      await markSkipped(taskId, recencyCheck.failedGate!, recencyCheck.detail);
      return;
    }
  }

  // 6. Nick assignment — pick from pool if task didn't pre-set one.
  //    pickNickForTask handles per-actionType selection:
  //      - send_message: must find existing Friend (accepted/pending)
  //      - request_friend: round-robin across connected nicks, dedup attempts, cap-aware
  let assignedNickId = task.assignedNickId;
  if (!assignedNickId && (actionType === 'request_friend' || actionType === 'send_message')) {
    const pick = await pickNickForTask({
      orgId: task.orgId,
      contactId: task.contact.id,
      actionType,
    });
    if (!pick) {
      const reason = actionType === 'send_message'
        ? 'no_friend_nick'
        : 'all_nicks_capped_or_attempted';
      await markSkipped(taskId, reason, 'pickNickForTask returned null');
      return;
    }
    assignedNickId = pick.nickId;
    // Persist the selection so retries reuse the same nick
    await prisma.automationTask.update({
      where: { id: taskId },
      data: { assignedNickId },
    });
  }

  // 7. Per-nick throttle + daily cap (Zalo-bound actions only)
  if (assignedNickId && (actionType === 'request_friend' || actionType === 'send_message')) {
    const nick = await prisma.zaloAccount.findFirst({
      where: { id: assignedNickId, orgId: task.orgId },
      select: {
        id: true, dailyFriendAddCap: true, dailyMessageCap: true,
        lastFriendReqSentAt: true, lastMessageSentAt: true,
      },
    });
    if (!nick) {
      await markFailed(taskId, 'NICK_MISSING', 'Assigned nick not found');
      return;
    }

    const lastSent = actionType === 'request_friend' ? nick.lastFriendReqSentAt : nick.lastMessageSentAt;
    const throttleCheck = checkPerNickThrottle(now, actionType, lastSent, rules);
    if (!throttleCheck.passed) {
      await rescheduleForRetry(taskId, throttleCheck.retryAfter!, throttleCheck.detail);
      return;
    }

    const cap = actionType === 'request_friend' ? nick.dailyFriendAddCap : nick.dailyMessageCap;
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const executedToday = await prisma.automationTask.count({
      where: {
        assignedNickId,
        state: TASK_STATES.DONE,
        executedAt: { gte: startOfDay },
        // Match action category via block actionType — JOIN through block
        block: { actionType },
      },
    });
    const capCheck = checkDailyCap(actionType, executedToday, cap);
    if (!capCheck.passed) {
      await rescheduleForRetry(taskId, capCheck.retryAfter!, capCheck.detail);
      return;
    }
  }

  // ── All gates passed — execute action ──────────────────────────────────
  const ctx: ActionContext = {
    orgId: task.orgId,
    taskId: task.id,
    contactId: task.contact.id,
    assignedNickId,
    blockSnapshot: task.blockSnapshot as Record<string, unknown>,
    actionType,
    attemptCount: task.attemptCount,
  };

  const result = await dispatchAction(ctx);

  // FIX A4: explicit outcome handling for all 4 ActionResult.outcome values.
  // Previously only 'success' was terminal-done; 'no_zalo' and 'already_friend'
  // fell through to retry+fail, burning quota on permanent failures.
  if (result.outcome === 'success') {
    await markDoneAndAdvance(task, result.data ?? null, assignedNickId, actionType, now);
    return;
  }

  if (result.outcome === 'no_zalo') {
    // Permanent: phone has no Zalo. Skip — sequence can advance, broadcast counts as failed.
    await markSkipped(taskId, 'no_zalo', result.errorMessage ?? 'Phone has no Zalo account');
    return;
  }

  if (result.outcome === 'already_friend') {
    // Idempotent: friendship already exists. Treat as success for sequence advance,
    // but data records the dedup so analytics shows "skipped, already friend".
    await markDoneAndAdvance(task, { ...(result.data ?? {}), alreadyFriend: true }, assignedNickId, actionType, now);
    return;
  }

  // outcome === 'failure' (or unknown): retry path
  if (result.retryable && task.attemptCount < MAX_ATTEMPT_COUNT) {
    const backoffMin = RETRY_BACKOFF_MINUTES[Math.min(task.attemptCount - 1, RETRY_BACKOFF_MINUTES.length - 1)];
    const retryAt = new Date(now.getTime() + backoffMin * 60 * 1000);
    await rescheduleForRetry(taskId, retryAt, `retry ${task.attemptCount}/${MAX_ATTEMPT_COUNT} after ${result.errorCode}: ${result.errorMessage}`);
    return;
  }

  await markFailed(taskId, result.errorCode ?? 'ACTION_FAILED', result.errorMessage ?? 'Unknown failure', result.data ?? null);
}

// ── State transitions ────────────────────────────────────────────────────

async function markSkipped(taskId: string, reason: string, detail?: string): Promise<void> {
  await prisma.automationTask.update({
    where: { id: taskId },
    data: {
      state: TASK_STATES.SKIPPED,
      skipReason: reason,
      errorMessage: detail,
      executedAt: new Date(),
    },
  });
  logger.debug(`[task-worker] task ${taskId} skipped: ${reason}`);
}

async function markFailed(
  taskId: string,
  errorCode: string,
  errorMessage: string,
  data: object | null = null,
): Promise<void> {
  await prisma.automationTask.update({
    where: { id: taskId },
    data: {
      state: TASK_STATES.FAILED,
      errorMessage: `${errorCode}: ${errorMessage}`,
      outcome: data ?? undefined, // Prisma JSON: undefined skips write, null requires JsonNull import
      executedAt: new Date(),
    },
  });
  logger.warn(`[task-worker] task ${taskId} failed: ${errorCode} ${errorMessage}`);
}

async function rescheduleForRetry(taskId: string, retryAt: Date, detail?: string): Promise<void> {
  await prisma.automationTask.update({
    where: { id: taskId },
    data: {
      state: TASK_STATES.QUEUED,
      scheduledAt: retryAt,
      errorMessage: detail,
    },
  });
  logger.debug(`[task-worker] task ${taskId} rescheduled to ${retryAt.toISOString()}: ${detail}`);
}

async function markDoneAndAdvance(
  task: { id: string; campaignId: string; sequenceId: string | null; currentStepIdx: number | null;
          contactId: string; orgId: string; campaign: { sequence: { steps: unknown } | null } },
  outcomeData: object | null,
  nickId: string | null,
  actionType: BlockActionType,
  now: Date,
): Promise<void> {
  await prisma.automationTask.update({
    where: { id: task.id },
    data: {
      state: TASK_STATES.DONE,
      outcome: outcomeData ?? undefined,
      executedAt: now,
    },
  });

  // Update nick last-sent timestamps for throttle gate
  if (nickId && (actionType === 'request_friend' || actionType === 'send_message')) {
    const field = actionType === 'request_friend' ? 'lastFriendReqSentAt' : 'lastMessageSentAt';
    await prisma.zaloAccount.update({
      where: { id: nickId },
      data: { [field]: now },
    });
  }

  // Sequence advance — schedule next step if any
  const steps = Array.isArray(task.campaign.sequence?.steps)
    ? (task.campaign.sequence!.steps as unknown as SequenceStep[])
    : null;
  if (!steps || task.currentStepIdx === null) return;

  const nextIdx = task.currentStepIdx + 1;
  if (nextIdx >= steps.length) {
    // Last step — terminate this contact's flow. Bump campaign completed counter.
    if (task.sequenceId) {
      await prisma.automationSequence.update({
        where: { id: task.sequenceId },
        data: { completedCount: { increment: 1 } },
      });
    }
    return;
  }

  const nextStep = steps[nextIdx];
  const block = await prisma.block.findFirst({
    where: { id: nextStep.blockId, orgId: task.orgId },
    select: { id: true, content: true, archivedAt: true },
  });
  if (!block) {
    logger.warn(`[task-worker] sequence step ${nextIdx} block ${nextStep.blockId} missing — terminating flow for task ${task.id}`);
    return;
  }

  // Schedule next task — delay from step + jitter (recompute per step to vary timing)
  const campaign = await prisma.automationCampaign.findUnique({
    where: { id: task.campaignId },
    select: { rulesSnapshot: true },
  });
  const rules = (campaign?.rulesSnapshot as object) as SequenceRuntimeRules;
  const jitterMin = (rules.randomDelayPerSend?.min ?? 0) * 60 * 1000;
  const jitterMax = (rules.randomDelayPerSend?.max ?? 0) * 60 * 1000;
  const jitter = jitterMin + Math.random() * Math.max(0, jitterMax - jitterMin);
  const scheduledAt = new Date(now.getTime() + nextStep.delayMinutes * 60 * 1000 + jitter);

  await prisma.automationTask.create({
    data: {
      id: randomUUID(),
      orgId: task.orgId,
      campaignId: task.campaignId,
      contactId: task.contactId,
      sequenceId: task.sequenceId,
      currentStepIdx: nextIdx,
      currentBlockId: block.id,
      blockSnapshot: block.content as object,
      scheduledAt,
      state: TASK_STATES.QUEUED,
    },
  });
}
