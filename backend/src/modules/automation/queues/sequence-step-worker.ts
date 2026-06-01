// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M3 — Sequence-step BullMQ Worker (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// Replaces task-worker.ts DB-polling architecture.
// BullMQ Worker pull from queue 'sequence-step' với lazy chain pattern:
//   - Step 0 enqueued khi friend accepted (M5 event hook)
//   - on('completed') step N → enqueue step N+1 (transactional + outbox sweeper backup)
//   - jobId DASH pattern (BullMQ v5 cấm `:`)
//
// Job payload:
//   {
//     triggerId, contactId, sequenceId, nickId, orgId,
//     stepIdx, totalSteps,
//     blockId,           // resolve qua Sequence.steps[stepIdx].blockId
//     conversationId?,   // optional, resolve qua nick + contact zaloUid
//   }
//
// Pipeline (full guards):
//   1. Load Sequence + step config (steps[stepIdx])
//   2. 5 guards (worker-guards.ts): hour, nick gap, quota peek, recency, multi-nick
//   3. Pause flag check (M5 contact:paused:{triggerId}:{contactId})
//   4. Dispatch sendMessage qua action-handler có sẵn (REUSE 100%)
//   5. On success: INCR quota + write Message với automationTaskId + step_index
//                  + Stats counter increment (Sequence.completedCountCached if last step)
//                  + Outbox event log step_completed + enqueue step N+1
//   6. On error: classifyError T4A → permanent (UnrecoverableError) / transient (throw)

import { Worker, DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getBullMQRedis } from './redis-connection.js';
import {
  QUEUE_NAMES,
  buildSequenceStepJobId,
  getSequenceStepQueue,
} from './queue-registry.js';
import {
  runAllGuards,
  consumeQuotaAfterSend,
  recordNickSend,
  type TriggerGuardConfig,
} from './worker-guards.js';
import { classifyError } from './error-classify.js';
import { sendMessageHandler } from '../engine/action-handlers/send-message.js';
import type { ActionContext } from '../engine/types.js';

export interface SequenceStepJobData {
  triggerId: string;
  contactId: string;
  sequenceId: string;
  nickId: string;
  orgId: string;
  stepIdx: number;
  totalSteps: number;
}

export interface SequenceStepResult {
  status: 'sent' | 'skipped' | 'failed';
  stepIdx: number;
  reason?: string;
  messageId?: string;
}

interface SequenceStepConfig {
  stepId: string;
  blockId: string;
  delayMinutes: number;
  exitCondition?: unknown;
}

// ════════════════════════════════════════════════════════════════════════
// Stats counter helpers (M10 hồi sinh dead writer)
// ════════════════════════════════════════════════════════════════════════
async function incrEnrolledCounter(sequenceId: string): Promise<void> {
  try {
    await prisma.automationSequence.update({
      where: { id: sequenceId },
      data: { enrolledCountCached: { increment: 1 } },
    });
  } catch (err) {
    logger.warn(`[stats] failed incr enrolled sequenceId=${sequenceId}: ${(err as Error).message}`);
  }
}

async function incrCompletedCounter(sequenceId: string): Promise<void> {
  try {
    await prisma.automationSequence.update({
      where: { id: sequenceId },
      data: { completedCountCached: { increment: 1 } },
    });
  } catch (err) {
    logger.warn(`[stats] failed incr completed sequenceId=${sequenceId}: ${(err as Error).message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Chain enqueue: step N → step N+1 (lazy pattern)
// ════════════════════════════════════════════════════════════════════════
async function enqueueNextStep(
  data: SequenceStepJobData,
  delayMinutes: number,
): Promise<void> {
  const nextStepIdx = data.stepIdx + 1;
  if (nextStepIdx >= data.totalSteps) {
    // Sequence complete — last step
    await incrCompletedCounter(data.sequenceId);
    logger.info(
      `[sequence-step] sequence ${data.sequenceId} COMPLETE for contact ${data.contactId} (${data.totalSteps} steps)`,
    );
    return;
  }

  const queue = getSequenceStepQueue();
  const nextJobId = buildSequenceStepJobId(data.triggerId, data.contactId, nextStepIdx);
  const delayMs = Math.max(0, delayMinutes * 60_000);

  // Idempotent enqueue — jobId dedup (Issue #5 5A POC verified).
  // Nếu sweeper retry hoặc race, BullMQ dedup theo jobId.
  try {
    await queue.add(
      'sequence-step',
      { ...data, stepIdx: nextStepIdx },
      { jobId: nextJobId, delay: delayMs },
    );
    logger.info(
      `[sequence-step] enqueued next step ${nextStepIdx}/${data.totalSteps} ` +
        `jobId=${nextJobId} delay=${delayMs}ms`,
    );

    // Write event_log for outbox sweeper recovery (v4 Fix #1)
    await prisma.automationEventLog
      .create({
        data: {
          orgId: data.orgId,
          triggerId: data.triggerId,
          contactId: data.contactId,
          eventType: 'sequence_step_enqueued',
          detail: `step ${nextStepIdx}/${data.totalSteps}, jobId=${nextJobId}`,
        },
      })
      .catch((err) => {
        logger.warn(`[sequence-step] event_log write failed: ${(err as Error).message}`);
      });
  } catch (err) {
    // jobId dedup throw nếu đã tồn tại → safe ignore
    const msg = (err as Error).message ?? '';
    if (msg.includes('exists') || msg.includes('duplicate')) {
      logger.info(`[sequence-step] dedup: ${nextJobId} already enqueued`);
    } else {
      throw err;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// Job processor — single tick per step
// ════════════════════════════════════════════════════════════════════════
async function processJob(
  job: Job<SequenceStepJobData, SequenceStepResult>,
  token?: string,
): Promise<SequenceStepResult> {
  const { triggerId, contactId, sequenceId, nickId, orgId, stepIdx, totalSteps } = job.data;
  const tag = `[seq-step job=${job.id}]`;

  // ── STEP 1: Load Sequence + Trigger + Nick ──
  const [sequence, trigger, nick] = await Promise.all([
    prisma.automationSequence.findUnique({
      where: { id: sequenceId },
      select: { id: true, steps: true, runtimeRules: true, enabled: true },
    }),
    prisma.automationTrigger.findUnique({
      where: { id: triggerId },
      select: {
        id: true,
        state: true,
        createdById: true,
        sendHourStart: true,
        sendHourEnd: true,
        recencySkipDays: true,
        multiNickThreshold: true,
        minFriendReqGapMs: true,
        pauseOnActivityHours: true,
      },
    }),
    prisma.zaloAccount.findUnique({
      where: { id: nickId },
      select: { id: true, dailyMessageCap: true, status: true, ownerUserId: true },
    }),
  ]);

  if (!sequence) return { status: 'skipped', stepIdx, reason: 'sequence_not_found' };
  if (!sequence.enabled) return { status: 'skipped', stepIdx, reason: 'sequence_disabled' };
  if (!trigger) return { status: 'skipped', stepIdx, reason: 'trigger_not_found' };
  if (trigger.state !== 'active') return { status: 'skipped', stepIdx, reason: `trigger_${trigger.state}` };
  if (!nick) return { status: 'skipped', stepIdx, reason: 'nick_not_found' };
  if (nick.status !== 'connected') return { status: 'skipped', stepIdx, reason: `nick_${nick.status}` };

  const steps = (sequence.steps as unknown as SequenceStepConfig[]) ?? [];
  if (stepIdx >= steps.length) {
    return { status: 'skipped', stepIdx, reason: 'step_out_of_range' };
  }
  const step = steps[stepIdx];

  // ── STEP 2: M5 pause flag check ──
  const redis = getBullMQRedis();
  const pauseKey = `contact:paused:${triggerId}:${contactId}`;
  const pauseTtl = await redis.pttl(pauseKey);
  if (pauseTtl > 0 && token) {
    const resumeAt = Date.now() + pauseTtl;
    await job.moveToDelayed(resumeAt, token);
    logger.info(`${tag} paused contact ${contactId}, defer ${pauseTtl}ms`);
    throw new DelayedError();
  }

  // ── STEP 3: Run 5 guards ──
  const triggerCfg: TriggerGuardConfig = {
    triggerId: trigger.id,
    sendHourStart: trigger.sendHourStart,
    sendHourEnd: trigger.sendHourEnd,
    recencySkipDays: trigger.recencySkipDays,
    multiNickThreshold: trigger.multiNickThreshold,
    minFriendReqGapMs: trigger.minFriendReqGapMs,
    triggerOwnerUserId: trigger.createdById,
    orgId,
  };

  const guard = await runAllGuards({
    contactId,
    nickId,
    triggerCfg,
    nickCap: nick.dailyMessageCap,
  });

  if (!guard.passed) {
    if (guard.deferUntilMs && guard.deferUntilMs > Date.now() && token) {
      await job.moveToDelayed(guard.deferUntilMs, token);
      throw new DelayedError();
    }
    return { status: 'skipped', stepIdx, reason: guard.reason };
  }

  // ── STEP 4: Load Block snapshot ──
  const block = await prisma.block.findUnique({
    where: { id: step.blockId },
    select: { id: true, actionType: true, content: true, archivedAt: true },
  });

  if (!block) {
    logger.warn(`${tag} block ${step.blockId} not found, skipping step`);
    return { status: 'skipped', stepIdx, reason: 'block_not_found' };
  }
  if (block.archivedAt) {
    logger.warn(`${tag} block ${step.blockId} archived, skipping step`);
    return { status: 'skipped', stepIdx, reason: 'block_archived' };
  }

  // ── STEP 5: Dispatch action handler (M3.5 wire actual SDK) ──
  // sendMessageHandler tự đọc Friend row + zaloOps.sendMessage + persist Message
  // Reuse 100% logic existing path (Phase G full).
  const taskPseudoId = job.id ?? randomUUID();
  const ctx: ActionContext = {
    orgId,
    taskId: taskPseudoId,
    contactId,
    assignedNickId: nickId,
    blockSnapshot: block.content as Record<string, unknown>,
    actionType: block.actionType as ActionContext['actionType'],
    attemptCount: (job.attemptsMade ?? 0) + 1,
    rulesSnapshot: (sequence.runtimeRules as Record<string, unknown>) ?? undefined,
  };

  logger.info(
    `${tag} dispatching action=${block.actionType} contact=${contactId} nick=${nickId} step=${stepIdx}/${totalSteps}`,
  );

  let actionResult: Awaited<ReturnType<typeof sendMessageHandler>>;
  try {
    // M3.5: chỉ wire send_message ngay. Các action khác (request_friend, update_status)
    // có handler riêng nhưng KHÔNG nằm trong sequence-step path (do friend-invite có
    // worker riêng + update_status không cần queue).
    if (block.actionType !== 'send_message') {
      logger.warn(`${tag} unsupported action type=${block.actionType} in sequence-step worker`);
      return { status: 'skipped', stepIdx, reason: `unsupported_action_${block.actionType}` };
    }
    actionResult = await sendMessageHandler(ctx);
  } catch (err) {
    const classified = classifyError(err);
    logger.error(`${tag} action handler threw ${classified.classification}: ${classified.message}`);
    if (classified.classification === 'permanent') {
      throw new UnrecoverableError(`Permanent: ${classified.errorCode}`);
    }
    throw err;
  }

  if (actionResult.outcome === 'failure') {
    const classified = classifyError(new Error(actionResult.errorMessage ?? actionResult.errorCode ?? 'unknown'));
    logger.error(
      `${tag} action failed code=${actionResult.errorCode} msg=${actionResult.errorMessage} classified=${classified.classification}`,
    );

    // Log event
    await prisma.automationEventLog.create({
      data: {
        orgId,
        triggerId,
        contactId,
        nickId,
        eventType: 'sequence_step_failed',
        detail: `step ${stepIdx}/${totalSteps} code=${actionResult.errorCode} msg=${(actionResult.errorMessage ?? '').slice(0, 200)}`,
      },
    });

    if (actionResult.retryable === false || classified.classification === 'permanent') {
      throw new UnrecoverableError(`Permanent: ${actionResult.errorCode ?? classified.errorCode}`);
    }
    throw new Error(actionResult.errorMessage ?? 'transient failure');
  }

  // ── STEP 6: After success ──
  const messageId = (actionResult.data?.messageId as string | undefined) ??
    (actionResult.data?.zaloMsgId as string | undefined) ??
    `unknown-${taskPseudoId}`;

  await consumeQuotaAfterSend(nickId, nick.dailyMessageCap);
  await recordNickSend(nickId);

  // Increment enrolled counter (chỉ ở step 0)
  if (stepIdx === 0) {
    await incrEnrolledCounter(sequenceId);
  }

  // M11: Update Message row với automationTaskId + automation_step_index attribution
  // (sendMessageHandler create Message row, em update post-hoc với jobId)
  if (messageId && messageId !== `unknown-${taskPseudoId}`) {
    await prisma.message
      .updateMany({
        where: { zaloMsgId: messageId },
        data: {
          automationTaskId: taskPseudoId,
          automationStepIndex: stepIdx,
          sentVia: 'automation',
        },
      })
      .catch((err) => {
        logger.warn(`${tag} failed to update Message attribution: ${(err as Error).message}`);
      });
  }

  // Write event log step_sent
  await prisma.automationEventLog.create({
    data: {
      orgId,
      triggerId,
      contactId,
      nickId,
      eventType: 'sequence_step_sent',
      detail: `step ${stepIdx}/${totalSteps} jobId=${job.id} msgId=${messageId}`,
    },
  });

  // ── STEP 7: Lazy chain — enqueue step N+1 ──
  const nextStep = steps[stepIdx + 1];
  if (nextStep) {
    await enqueueNextStep(job.data, nextStep.delayMinutes ?? 60);
  } else {
    await incrCompletedCounter(sequenceId);
  }

  return { status: 'sent', stepIdx, messageId };
}

// ════════════════════════════════════════════════════════════════════════
// Worker lifecycle
// ════════════════════════════════════════════════════════════════════════
let workerInstance: Worker<SequenceStepJobData, SequenceStepResult> | null = null;

export function startSequenceStepWorker(): Worker {
  if (workerInstance) {
    logger.warn('[sequence-step-worker] already started');
    return workerInstance;
  }

  workerInstance = new Worker<SequenceStepJobData, SequenceStepResult>(
    QUEUE_NAMES.SEQUENCE_STEP,
    processJob,
    {
      connection: getBullMQRedis(),
      // Per-nick concurrency = 1 (BullMQ global concurrency cao hơn cho cross-nick parallel).
      // Theo Issue #4 4A — quota INCR sau send, không race per-nick vì worker check
      // pause flag + guards trước.
      concurrency: 5,
    },
  );

  workerInstance.on('completed', (job) => {
    logger.info(
      `[sequence-step-worker] completed job=${job.id} step=${job.returnvalue?.stepIdx} status=${job.returnvalue?.status}`,
    );
  });

  workerInstance.on('failed', (job, err) => {
    logger.error(
      `[sequence-step-worker] failed job=${job?.id} attempt=${job?.attemptsMade}/${job?.opts.attempts}: ${err.message}`,
    );
  });

  workerInstance.on('error', (err) => {
    logger.error(`[sequence-step-worker] error: ${err.message}`);
  });

  logger.info('[sequence-step-worker] started concurrency=5');
  return workerInstance;
}

export async function stopSequenceStepWorker(): Promise<void> {
  if (workerInstance) {
    logger.info('[sequence-step-worker] closing...');
    await workerInstance.close();
    workerInstance = null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Enqueue helper — gọi từ M5 event hooks (friend_accepted)
// ════════════════════════════════════════════════════════════════════════
export async function enqueueSequenceStart(input: {
  triggerId: string;
  contactId: string;
  sequenceId: string;
  nickId: string;
  orgId: string;
  startDelayMinutes?: number;
}): Promise<void> {
  const seq = await prisma.automationSequence.findUnique({
    where: { id: input.sequenceId },
    select: { steps: true, enabled: true },
  });

  if (!seq || !seq.enabled) {
    logger.warn(`[sequence-step] cannot start — sequence ${input.sequenceId} disabled/not found`);
    return;
  }

  const steps = (seq.steps as unknown as SequenceStepConfig[]) ?? [];
  if (steps.length === 0) {
    logger.warn(`[sequence-step] sequence ${input.sequenceId} has 0 steps`);
    return;
  }

  const queue = getSequenceStepQueue();
  const jobId = buildSequenceStepJobId(input.triggerId, input.contactId, 0);
  const delayMs = Math.max(0, (input.startDelayMinutes ?? 60) * 60_000);

  try {
    await queue.add(
      'sequence-step',
      {
        triggerId: input.triggerId,
        contactId: input.contactId,
        sequenceId: input.sequenceId,
        nickId: input.nickId,
        orgId: input.orgId,
        stepIdx: 0,
        totalSteps: steps.length,
      },
      { jobId, delay: delayMs },
    );
    logger.info(
      `[sequence-step] enqueued START sequence=${input.sequenceId} contact=${input.contactId} ` +
        `jobId=${jobId} delay=${delayMs}ms totalSteps=${steps.length}`,
    );
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('exists') || msg.includes('duplicate')) {
      logger.info(`[sequence-step] dedup: ${jobId} already enqueued`);
    } else {
      throw err;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// Outbox sweeper — recovery khi worker crash giữa 'completed' và 'enqueue next'
// (v4 Fix #1 + Issue #5 5A POC verified Redis crash recovery)
// ════════════════════════════════════════════════════════════════════════
export async function sweepMissingNextSteps(): Promise<{ recovered: number }> {
  const since = new Date(Date.now() - 10 * 60_000); // 10 phút gần nhất
  let recovered = 0;

  // Tìm event step_completed mà chưa có sequence_step_enqueued cho step N+1
  const completedEvents = await prisma.automationEventLog.findMany({
    where: {
      eventType: 'sequence_step_sent',
      createdAt: { gte: since },
    },
    select: { id: true, triggerId: true, contactId: true, detail: true, createdAt: true },
    take: 100,
  });

  for (const evt of completedEvents) {
    // Parse step idx từ detail "step N/M"
    const match = evt.detail?.match(/step (\d+)\/(\d+)/);
    if (!match) continue;
    const stepIdx = parseInt(match[1], 10);
    const totalSteps = parseInt(match[2], 10);
    const nextStepIdx = stepIdx + 1;
    if (nextStepIdx >= totalSteps) continue;

    if (!evt.triggerId || !evt.contactId) continue;

    // Check sequence_step_enqueued cho step N+1
    const enqueuedExists = await prisma.automationEventLog.findFirst({
      where: {
        triggerId: evt.triggerId,
        contactId: evt.contactId,
        eventType: 'sequence_step_enqueued',
        detail: { contains: `step ${nextStepIdx}/` },
      },
      select: { id: true },
    });

    if (enqueuedExists) continue;

    // Sweeper recovery: enqueue step N+1 với jobId dedup
    const queue = getSequenceStepQueue();
    const nextJobId = buildSequenceStepJobId(evt.triggerId, evt.contactId, nextStepIdx);
    const existingJob = await queue.getJob(nextJobId);
    if (existingJob) {
      logger.info(`[sweeper] job ${nextJobId} exists in queue, skip`);
      continue;
    }

    // Load context để enqueue
    const trigger = await prisma.automationTrigger.findUnique({
      where: { id: evt.triggerId },
      select: { sequenceId: true, orgId: true },
    });
    if (!trigger?.sequenceId) continue;

    const seq = await prisma.automationSequence.findUnique({
      where: { id: trigger.sequenceId },
      select: { steps: true },
    });
    const steps = (seq?.steps as unknown as SequenceStepConfig[]) ?? [];
    if (nextStepIdx >= steps.length) continue;

    // Find current nick assigned (from outbox or entry)
    const outbox = await prisma.friendRequestOutbox.findFirst({
      where: { triggerId: evt.triggerId, contactId: evt.contactId },
      select: { nickId: true },
    });
    if (!outbox) continue;

    await queue.add(
      'sequence-step',
      {
        triggerId: evt.triggerId,
        contactId: evt.contactId,
        sequenceId: trigger.sequenceId,
        nickId: outbox.nickId,
        orgId: trigger.orgId,
        stepIdx: nextStepIdx,
        totalSteps: steps.length,
      },
      { jobId: nextJobId, delay: (steps[nextStepIdx].delayMinutes ?? 60) * 60_000 },
    );

    await prisma.automationEventLog.create({
      data: {
        orgId: trigger.orgId,
        triggerId: evt.triggerId,
        contactId: evt.contactId,
        eventType: 'sequence_step_enqueued',
        detail: `step ${nextStepIdx}/${steps.length} (SWEEPER RECOVERY)`,
      },
    });

    recovered++;
    logger.warn(
      `[sweeper] RECOVERED missing step ${nextStepIdx} for contact ${evt.contactId} trigger ${evt.triggerId}`,
    );
  }

  if (recovered > 0) {
    logger.warn(`[sweeper] recovered ${recovered} missing next steps`);
  }
  return { recovered };
}

let sweeperHandle: NodeJS.Timeout | null = null;

export function startOutboxSweeper(intervalMs = 5 * 60_000): void {
  if (sweeperHandle) {
    logger.warn('[outbox-sweeper] already started');
    return;
  }
  sweeperHandle = setInterval(() => {
    void sweepMissingNextSteps().catch((err) => {
      logger.error(`[outbox-sweeper] error: ${(err as Error).message}`);
    });
  }, intervalMs);
  logger.info(`[outbox-sweeper] started (interval ${intervalMs}ms)`);
}

export function stopOutboxSweeper(): void {
  if (sweeperHandle) {
    clearInterval(sweeperHandle);
    sweeperHandle = null;
    logger.info('[outbox-sweeper] stopped');
  }
}
