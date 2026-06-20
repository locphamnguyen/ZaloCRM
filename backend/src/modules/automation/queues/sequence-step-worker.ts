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
import { withTenant } from '../../../shared/tenant/tenant-context.js';
import { getBullMQRedis } from './redis-connection.js';
import {
  QUEUE_NAMES,
  buildSequenceStepJobId,
  sequenceStepJobPrefix,
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
import { followMergedInto } from '../../contacts/resolve-contact.js';
import { stepDelayMs, nextAllowedTime } from '../engine/schedule-calculator.js';
import type { ActionContext } from '../engine/types.js';
// Observability "vì sao không gửi" 2026-06-18 — ghi lý do blocker có chống flood + xoá khoá khi resume.
import { logBlockOnce, clearBlockMarker } from '../shared/block-logger.js';
import { resolveBlockReason } from '../shared/block-reason-catalog.js';

export interface SequenceStepJobData {
  triggerId: string;
  contactId: string;
  sequenceId: string;
  nickId: string;
  orgId: string;
  stepIdx: number;
  totalSteps: number;
  // FIX code-review #2: snapshot runtimeRules (sendGap luật 2 + allowedHourRange luật 1)
  // chuyền theo job → enqueueNextStep tính delay đúng (trước đây dùng step.delayMinutes
  // thô → sendGap dead config). Optional: job cũ thiếu field → fallback step.delayMinutes.
  runtimeRules?: Record<string, unknown>;
  // 2026-06-15: số lần gắn (epoch) — gắn lại cùng luồng tăng epoch → jobId mới. Mọi step
  // của 1 lần gắn dùng CÙNG epoch (lazy-chain kế thừa). Optional: job cũ thiếu → coi = 1.
  enrollEpoch?: number;
  // 2026-06-15: lý do worker HOÃN job (ghi khi moveToDelayed) → nút "Gửi bước tiếp ngay"
  // đọc để báo sale câu dễ hiểu. 'nick_gap'|'outside_hour_window'|'quota_capped'|
  // 'nick_offline'|'awaiting_reply'|'unknown'. Xóa/ghi đè mỗi lần defer.
  deferReason?: string;
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
  delayJitterMinutes?: number; // 2026-06-19: ± random phút quanh delayMinutes (chống bot)
  exitCondition?: unknown;
}

// ════════════════════════════════════════════════════════════════════════
// 2026-06-04 — DUAL-READ pattern (Anh chốt: Khối Phase 1 + Reviewer R1)
// SequenceStep FK table mới + JSON `steps` cũ (deprecated 2026-06-18).
// Worker ưu tiên sequence_steps[], fallback steps JSON nếu empty.
// Khi drop JSON 2 tuần sau: chỉ giữ block đầu của function này.
// ════════════════════════════════════════════════════════════════════════
async function loadSequenceSteps(sequenceId: string): Promise<SequenceStepConfig[]> {
  const rows = await prisma.sequenceStep.findMany({
    where: { sequenceId },
    orderBy: { stepOrder: 'asc' },
    select: { id: true, blockId: true, delayMinutes: true, jitterMinutes: true, exitCondition: true },
  });
  if (rows.length > 0) {
    return rows
      .filter((r) => r.blockId != null) // skip step không có blockId (draft)
      .map((r) => ({
        stepId: r.id,
        blockId: r.blockId as string,
        delayMinutes: r.delayMinutes,
        delayJitterMinutes: r.jitterMinutes ?? 0,
        exitCondition: r.exitCondition ?? undefined,
      }));
  }
  // Fallback JSON cũ (dual-read window 2 tuần)
  const seq = await prisma.automationSequence.findUnique({
    where: { id: sequenceId },
    select: { steps: true },
  });
  return (seq?.steps as unknown as SequenceStepConfig[]) ?? [];
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
  jitterMinutes = 0,
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
  const nextJobId = buildSequenceStepJobId(data.triggerId, data.sequenceId, data.contactId, nextStepIdx, data.enrollEpoch ?? 1);

  // 2026-06-19: delay bước kế = delayMinutes CỐ ĐỊNH ± jitter (gộp Luật 2 vào step).
  // LUẬT 1 (giờ) — dời mốc gửi vào khung allowedTimeRange (rơi ngoài giờ → đầu khung kế).
  const rules = (data.runtimeRules ?? undefined) as import('../sequences/types.js').SequenceRuntimeRules | undefined;
  const baseDelayMs = stepDelayMs(delayMinutes, jitterMinutes);
  const runAt = nextAllowedTime(new Date(Date.now() + baseDelayMs), rules);
  const delayMs = Math.max(0, runAt.getTime() - Date.now());

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
    // P2 2026-06-02: enrich metadata để FE/consumer khỏi parse regex từ detail.
    // detail giữ nguyên cho backward compat.
    await prisma.automationEventLog
      .create({
        data: {
          orgId: data.orgId,
          triggerId: data.triggerId,
          contactId: data.contactId,
          // 2026-06-18: thiếu nickId → cột "Nick chăm" ở Log trống cho dòng "Lên lịch bước kế". data.nickId có sẵn.
          nickId: data.nickId,
          eventType: 'sequence_step_enqueued',
          detail: `step ${nextStepIdx}/${data.totalSteps}, jobId=${nextJobId}`,
          metadata: {
            stepIdx: nextStepIdx,
            totalSteps: data.totalSteps,
            jobId: nextJobId,
            delayMs,
            sequenceId: data.sequenceId, // FIX#4: sweeper check enqueuedExists đúng luồng
            enrollEpoch: data.enrollEpoch ?? 1, // FIX#4: đúng lần gắn (epoch)
          },
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
  const { triggerId, contactId: rawContactId, sequenceId, nickId, orgId, stepIdx, totalSteps } = job.data;
  // FIX 2026-06-20 (dedup merge): nếu KH đã bị GỘP vào hồ sơ khác, dùng hồ sơ ROOT (primary)
  // cho mọi query/log/Message + jobId bước kế. Job key theo contactId CŨ (secondary) → nếu
  // không follow, ghi/đọc hồ sơ mồ côi (tab Follow-up trống, careSession không thấy). depth≤5.
  const contactId = (await followMergedInto(rawContactId)).id;
  const tag = `[seq-step job=${job.id}]`;
  // Observability 2026-06-18: ghi "vì sao không gửi" lên monitor (chống flood qua logBlockOnce).
  const logBlocked = (reason: string, nextRunAt?: Date | null): void => {
    void logBlockOnce({
      orgId, triggerId, contactId, nickId, reason,
      nextRunAt: nextRunAt ?? null, extra: { stepIdx },
    });
  };

  // ── STEP 1: Load Sequence + Trigger + Nick ──
  const [sequence, trigger, nick] = await Promise.all([
    prisma.automationSequence.findUnique({
      where: { id: sequenceId },
      select: { id: true, name: true, steps: true, runtimeRules: true, enabled: true },
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

  if (!sequence) { logBlocked('sequence_not_found'); return { status: 'skipped', stepIdx, reason: 'sequence_not_found' }; }
  if (!sequence.enabled) { logBlocked('sequence_disabled'); return { status: 'skipped', stepIdx, reason: 'sequence_disabled' }; }
  if (!trigger) return { status: 'skipped', stepIdx, reason: 'trigger_not_found' };
  // 2026-06-02 — intentional asymmetry vs welcome-probe-worker L48-56 (which ignores
  // trigger.state for working-hours lookup so welcome can fire on completed triggers):
  // sequence steps respect trigger.state because paused/archived triggers must NOT
  // continue firing steps. Re-engage workflow uses a NEW trigger (new triggerId) under
  // the per-(contact, trigger) semantic — original trigger stays where it is.
  if (trigger.state !== 'active' && trigger.state !== 'on_hold') {
    return { status: 'skipped', stepIdx, reason: `trigger_${trigger.state}` };
  }
  if (!nick) return { status: 'skipped', stepIdx, reason: 'nick_not_found' };

  // ── Sprint v3 (2026-06-03) — Sửa 5.2 + 5.3 ──
  // Anh chốt: nick gốc offline → KHÔNG return 'skipped' bare (chuỗi gãy luôn).
  // Thay bằng moveToDelayed(30 phút) — BullMQ tự retry, sequence không gãy.
  // Đồng thời:
  // (a) Set entry.nickHoldSince (nếu NULL) → sweeper sticky-hold đếm 23h.
  // (b) Set campaign.nickFirstOfflineAt + flip state='on_hold' (nếu NULL).
  // (c) Khi nick hồi: delayed job fire → gửi xong → flip campaign='active' +
  //     clear nick_hold_since (logic ở STEP success path bên dưới).
  if (nick.status !== 'connected' && token) {
    const now = new Date();
    await Promise.all([
      // #2 2026-06-06 — nickHoldSince ở bảng nối per-trigger.
      prisma.triggerQueueEntry.updateMany({
        where: {
          contactId,
          triggerId,
          claimedByNickId: nickId,
          nickHoldSince: null,
        },
        data: { nickHoldSince: now },
      }),
      prisma.automationCampaign.updateMany({
        where: {
          triggerId,
          sequenceId,
          state: 'active',
        },
        data: {
          state: 'on_hold',
          nickFirstOfflineAt: now,
        },
      }),
    ]).catch((err) => {
      logger.warn(`${tag} set nickHoldSince failed nick=${nickId}: ${err?.message ?? err}`);
    });
    const delayMs = 30 * 60 * 1000;
    // 2026-06-15: ghi lý do hoãn để nút "Gửi bước tiếp ngay" báo cho sale câu dễ hiểu.
    await job.updateData({ ...job.data, deferReason: 'nick_offline' }).catch(() => {});
    logBlocked('nick_offline', new Date(Date.now() + delayMs));
    await job.moveToDelayed(Date.now() + delayMs, token);
    logger.info(
      `${tag} nick=${nickId} status=${nick.status} — hold 30 phút (Sprint v3 sticky 24h)`,
    );
    throw new DelayedError();
  }
  if (nick.status !== 'connected') {
    logBlocked(`nick_${nick.status}`);
    return { status: 'skipped', stepIdx, reason: `nick_${nick.status}` };
  }

  // ── CareSession SELF-HEAL (anh chốt 2026-06-07) ──
  // Luồng chạy nhiều STEP nhưng phiên chỉ tạo 1 lần ở STEP 0. Nếu phiên mồ côi
  // (bị xóa/chưa kịp tạo) → tái tạo để luồng + phiên luôn đồng bộ. KHÔNG hồi sinh
  // phiên đã đóng có chủ ý (chặn/sale/điều kiện). Fail không làm hỏng STEP.
  if (nick.ownerUserId) {
    try {
      const { ensureCareSessionForStep } = await import(
        '../care-session/care-session-service.js'
      );
      await ensureCareSessionForStep({
        orgId, triggerId, contactId, nickId, sequenceId,
        ownerUserId: nick.ownerUserId,
        // FIX3 self-heal 2026-06-17: phiên mồ côi tạo lại PHẢI lấy epoch từ job (không mặc
        // định NULL→1) — KH gắn-lại epoch≥2 mất phiên rồi heal về 1 sẽ lệch epoch → resume/đếm sai.
        enrollEpoch: job.data.enrollEpoch ?? 1,
      });
    } catch (err) {
      logger.warn(`${tag} care-session self-heal failed (non-fatal): ${(err as Error).message}`);
    }
  }

  const steps = await loadSequenceSteps(sequence.id); // 2026-06-04 dual-read
  if (stepIdx >= steps.length) {
    logBlocked('step_out_of_range');
    return { status: 'skipped', stepIdx, reason: 'step_out_of_range' };
  }
  const step = steps[stepIdx];

  // ── STEP 2: pause check (Redis flag NHANH + CareSession CHÂN LÝ) ──
  // FIX code-review #3: Redis pause flag TTL ngắn (24h) nhưng phiên đóng sau im-lặng (7
  // ngày) → khoảng hở 6 ngày job tỉnh dậy gửi đè khách đang chat. Bổ sung check DB:
  // nếu CareSession của cặp này còn pausedAtStepIdx (khách đã reply, CHƯA resume) → defer.
  // resume worker (cron) sẽ re-enqueue khi phiên đóng. CareSession là nguồn chân lý pause.
  const redis = getBullMQRedis();
  const pauseKey = `contact:paused:${triggerId}:${contactId}`;
  const pauseTtl = await redis.pttl(pauseKey);
  if (pauseTtl > 0 && token) {
    const resumeAt = Date.now() + pauseTtl;
    await job.updateData({ ...job.data, deferReason: 'awaiting_reply' }).catch(() => {});
    logBlocked('awaiting_reply', new Date(resumeAt));
    await job.moveToDelayed(resumeAt, token);
    logger.info(`${tag} paused contact ${contactId} (redis flag), defer ${pauseTtl}ms`);
    throw new DelayedError();
  }
  if (token) {
    // CHỈ defer khi phiên còn ACTIVE + có pausedAtStepIdx (khách reply, chưa hết phiên).
    // state='active' BẮT BUỘC (re-review MED #1): phiên đã đóng (sale xử lý / status-tag
    // match / block) mà pausedAtStepIdx chưa clear → KHÔNG defer mãi (zombie). Phiên active
    // còn pause → defer chờ resume; phiên đã đóng → cho job chạy (hoặc guard khác chặn).
    const pausedSession = await prisma.careSession.findFirst({
      where: { orgId, contactId, sourceSequenceId: sequenceId, state: 'active', pausedAtStepIdx: { not: null } },
      select: { id: true, pausedUntil: true },
    });
    if (pausedSession) {
      const pausedUntilMs = pausedSession.pausedUntil?.getTime() ?? 0;
      if (pausedUntilMs > Date.now()) {
        // CÒN trong cửa sổ hold (KH có thể vừa reply lại → reply handler đã bơm pausedUntil) →
        // đẩy thẳng tới ĐÚNG giờ hết hold, KHÔNG đẩy lùi cứng 1h/lần (tránh nextRunAt trôi dần).
        await job.updateData({ ...job.data, deferReason: 'awaiting_reply' }).catch(() => {});
        logBlocked('awaiting_reply', new Date(pausedUntilMs));
        await job.moveToDelayed(pausedUntilMs, token);
        logger.info(`${tag} LUẬT 4: còn hold → defer tới pausedUntil=${new Date(pausedUntilMs).toISOString()} contact=${contactId}`);
        throw new DelayedError();
      }
      // FIX2 2026-06-17 (anh chốt): HẾT HOLD mà phiên vẫn active → RESUME, KHÔNG defer +1h vô hạn.
      //   - clear pausedAtStepIdx TRƯỚC khi gửi (chống double-send với cron FIX1: nếu gửi xong
      //     rồi mới clear, cron chạy đúng lúc đó sẽ enqueue lại → KH nhận trùng).
      //   - clear cờ Redis (FOLD-1) bằng redis.del trực tiếp (tránh circular import event-hooks).
      //   - đổi queueStatus customer_reply→processing (FIX5): sale không thấy "KH Reply/đã dừng" oan.
      //   - KHÔNG defer → rơi xuống guard giờ-gửi/throttle bình thường rồi gửi.
      await prisma.careSession.update({ where: { id: pausedSession.id }, data: { pausedAtStepIdx: null } }).catch(() => {});
      await redis.del(pauseKey).catch(() => {});
      // NV-1: xoá khoá block để đợt chặn MỚI sau khi chạy lại được ghi log lại (không bị nuốt).
      await clearBlockMarker(triggerId, contactId, { redis });
      await prisma.triggerQueueEntry.updateMany({
        where: { triggerId, contactId, queueStatus: 'customer_reply' },
        data: { queueStatus: 'processing' },
      }).catch(() => {});
      logger.info(`${tag} LUẬT 4: hết hold → RESUME (clear marker+cờ Redis+block, cho job chạy) contact=${contactId}`);
    }
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
    quotaKind: 'message', // FIX 2026-06-12 — đếm hạn mức GỬI TIN, tách khỏi quota kết bạn.
  });

  if (!guard.passed) {
    if (guard.deferUntilMs && guard.deferUntilMs > Date.now() && token) {
      // guard.reason dạng "nick_gap (Xms remaining)" / "outside_hour_window (...)" /
      // "quota_capped (...)" → rút MÃ đầu (trước khoảng trắng) để nút advance báo đúng câu.
      const deferReason = (guard.reason ?? '').split(' ')[0] || 'unknown';
      await job.updateData({ ...job.data, deferReason }).catch(() => {});
      logBlocked(guard.reason ?? 'unknown', new Date(guard.deferUntilMs));
      await job.moveToDelayed(guard.deferUntilMs, token);
      throw new DelayedError();
    }
    // Skip hẳn (recency/multi_nick — không có deferUntilMs): ghi lý do bỏ qua.
    logBlocked(guard.reason ?? 'unknown');
    return { status: 'skipped', stepIdx, reason: guard.reason };
  }

  // ── STEP 4: Load Block snapshot ──
  const block = await prisma.block.findUnique({
    where: { id: step.blockId },
    select: { id: true, actionType: true, content: true, archivedAt: true },
  });

  if (!block) {
    logger.warn(`${tag} block ${step.blockId} not found, skipping step`);
    logBlocked('block_not_found');
    return { status: 'skipped', stepIdx, reason: 'block_not_found' };
  }
  if (block.archivedAt) {
    logger.warn(`${tag} block ${step.blockId} archived, skipping step`);
    logBlocked('block_archived');
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
    // 2026-06-06 — attribution cho badge "⚙️ Tự động · {sequence} · Bước N/M".
    sequenceMeta: {
      sequenceId: sequence.id,
      sequenceName: sequence.name ?? 'Luồng kịch bản',
      stepIdx,
      totalSteps,
    },
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
      logBlocked(`unsupported_action_${block.actionType}`);
      return { status: 'skipped', stepIdx, reason: `unsupported_action_${block.actionType}` };
    }
    // FIX review-epoch #3 (LỖI 3 — active job mồ côi sau gắn lại): nếu job này thuộc lần
    // gắn CŨ (epoch khác phiên active hiện tại) → luồng đã bị reenroll thay thế → DỪNG HẲN,
    // không gửi + không chain tiếp (tránh tin ma song song chain mới). Chỉ check khi epoch>1
    // hoặc có phiên active epoch khác (đường thường epoch=1 không có phiên epoch khác).
    {
      const jobEpoch = (job.data.enrollEpoch ?? 1);
      const activeSession = await prisma.careSession.findFirst({
        where: { orgId, contactId, sourceSequenceId: sequenceId, state: 'active' },
        orderBy: { openedAt: 'desc' },
        select: { enrollEpoch: true },
      });
      // Có phiên active với epoch KHÁC job này → job là epoch cũ mồ côi → dừng.
      if (activeSession && (activeSession.enrollEpoch ?? 1) !== jobEpoch) {
        logger.info(`${tag} epoch cũ mồ côi (job e${jobEpoch} vs phiên active e${activeSession.enrollEpoch ?? 1}) → dừng, không gửi`);
        return { status: 'skipped', stepIdx, reason: 'stale_epoch' };
      }
    }
    // LUẬT 4 GUARD (Codex #3 active-send race): RE-CHECK pause flag NGAY TRƯỚC send.
    // Giữa STEP 2 (pause check đầu job) và đây có runAllGuards + DB reads — khách có thể
    // vừa reply trong khoảng đó. Nếu pause → moveToDelayed lại, KHÔNG gửi (tránh gửi
    // sau khi khách đã trả lời). Tiến độ giữ ở pausedAtStepIdx (message-handler đã ghi).
    if (token) {
      const pauseTtlNow = await redis.pttl(pauseKey);
      // FIX #3: check CẢ Redis flag LẪN CareSession.pausedAtStepIdx (chân lý, không hết
      // hạn sau 24h). Khách reply giữa STEP 2 và đây → 1 trong 2 bắt được.
      const pausedNow = pauseTtlNow > 0
        ? true
        : !!(await prisma.careSession.findFirst({
            where: { orgId, contactId, sourceSequenceId: sequenceId, state: 'active', pausedAtStepIdx: { not: null } },
            select: { id: true },
          }));
      if (pausedNow) {
        const deferMs = pauseTtlNow > 0 ? pauseTtlNow : 60 * 60_000;
        logger.info(`${tag} LUẬT 4: KH vừa reply trước send — defer ${deferMs}ms (active-send race guard)`);
        await job.updateData({ ...job.data, deferReason: 'awaiting_reply' }).catch(() => {});
        logBlocked('awaiting_reply', new Date(Date.now() + deferMs));
        await job.moveToDelayed(Date.now() + deferMs, token);
        throw new DelayedError();
      }
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

    // Log event — Observability 2026-06-18: ca RATE_LIMITED (hết 200 tin/ngày, ca e7ade24c)
    // gắn summary tiếng Việt + category để lọc/gắn-nhãn; GIỮ detail nguyên cho sweeper/stats parse.
    const isQuotaMsg = actionResult.errorCode === 'RATE_LIMITED';
    const failInfo = isQuotaMsg ? resolveBlockReason('RATE_LIMITED') : null;
    await prisma.automationEventLog.create({
      data: {
        orgId,
        triggerId,
        contactId,
        nickId,
        eventType: 'sequence_step_failed',
        eventPriority: isQuotaMsg ? 'warning' : 'info',
        summary: failInfo ? failInfo.label : `Lỗi gửi (${actionResult.errorCode ?? 'unknown'})`,
        category: failInfo ? failInfo.category : null,
        detail: `step ${stepIdx}/${totalSteps} code=${actionResult.errorCode} msg=${(actionResult.errorMessage ?? '').slice(0, 200)}`,
      },
    });

    // 2026-06-18 FIX TRIỆT ĐỂ (ca e7ade24c kẹt 12 KH): RATE_LIMITED = đụng trần 200 tin/ngày.
    // TRƯỚC: coi là lỗi tạm → throw → retry 3 lần/30s → job FAIL → on('failed') chỉ log →
    // KHÔNG gì enqueue lại → bước chết hẳn (quota reset 00:00 cũng không tự chạy). SAU: hoãn job
    // tới 00:00 VN (như guard-peek) → job SỐNG, tự bật lại khi quota reset. Nhãn "Tự chạy lại 00:00" đúng.
    if (isQuotaMsg && token) {
      const vnNow = new Date(Date.now() + 7 * 3600_000);
      const vnMid = new Date(vnNow);
      vnMid.setUTCDate(vnMid.getUTCDate() + 1);
      vnMid.setUTCHours(0, 0, 0, 0);
      const resumeAt = vnMid.getTime() - 7 * 3600_000;
      await job.updateData({ ...job.data, deferReason: 'quota_capped' }).catch(() => {});
      await job.moveToDelayed(resumeAt, token);
      logger.info(`${tag} RATE_LIMITED → hoãn tới 00:00 VN (${new Date(resumeAt).toISOString()}) thay vì retry-chết`);
      throw new DelayedError();
    }

    if (actionResult.retryable === false || classified.classification === 'permanent') {
      throw new UnrecoverableError(`Permanent: ${actionResult.errorCode ?? classified.errorCode}`);
    }
    throw new Error(actionResult.errorMessage ?? 'transient failure');
  }

  // ── STEP 6: After success ──
  const messageId = (actionResult.data?.messageId as string | undefined) ??
    (actionResult.data?.zaloMsgId as string | undefined) ??
    `unknown-${taskPseudoId}`;

  await consumeQuotaAfterSend(nickId, nick.dailyMessageCap, 'message'); // FIX 2026-06-12 — đếm vào quota gửi tin.
  await recordNickSend(nickId);

  // ── Sprint v3 (2026-06-03) — Clear hold khi nick hồi + gửi step xong ──
  // Nick gốc đã hồi và gửi tin thành công → clear cờ hold cho entry này +
  // flip campaign về 'active'. KH tiếp tục bám đuổi bình thường.
  await Promise.all([
    // #2 2026-06-06 — clear nickHoldSince ở bảng nối per-trigger.
    prisma.triggerQueueEntry.updateMany({
      where: { contactId, triggerId, nickHoldSince: { not: null } },
      data: { nickHoldSince: null, lastResetReason: null },
    }),
    prisma.automationCampaign.updateMany({
      where: { triggerId, sequenceId, state: 'on_hold' },
      data: { state: 'active', nickFirstOfflineAt: null },
    }),
  ]).catch((err) => {
    logger.warn(`${tag} clear nickHoldSince failed: ${err?.message ?? err}`);
  });

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
  // P2 2026-06-02: enrich metadata để FE/consumer khỏi parse regex từ detail.
  // detail giữ nguyên cho backward compat (stats-routes.ts + sweeper vẫn parse string).
  await prisma.automationEventLog.create({
    data: {
      orgId,
      triggerId,
      contactId,
      nickId,
      eventType: 'sequence_step_sent',
      detail: `step ${stepIdx}/${totalSteps} jobId=${job.id} msgId=${messageId}`,
      metadata: {
        stepIdx,
        totalSteps,
        jobId: job.id,
        msgId: messageId,
        sequenceId, // LOW#3 fix: sweeper đọc trực tiếp thay vì đoán từ CareSession khi đa-luồng
        enrollEpoch: job.data.enrollEpoch ?? 1, // 2026-06-15: sweeper/resume dùng đúng epoch
      },
    },
  });

  // ── STEP 7: Lazy chain — enqueue step N+1 ──
  const nextStep = steps[stepIdx + 1];
  if (nextStep) {
    await enqueueNextStep(job.data, nextStep.delayMinutes ?? 60, nextStep.delayJitterMinutes ?? 0);
  } else {
    await incrCompletedCounter(sequenceId);
    // Fix #6 v2 (2026-06-02): KH này hoàn tất sequence → check xem CÒN KH nào của trigger
    // chưa hoàn tất không. Nếu hết → flip campaign.state='completed' để sweeper trigger
    // (sweepers.ts:runTriggerCompletionSweeper) có thể flip trigger.state='completed'.
    await tryCompleteCampaign({ triggerId, sequenceId, contactId, orgId, currentJobId: job.id });
  }

  return { status: 'sent', stepIdx, messageId };
}

/**
 * Sau khi 1 KH hoàn tất sequence (step cuối), check xem CÒN sequence-step jobs nào của
 * trigger này đang chờ trong BullMQ (delayed/wait/active) không. Nếu hết → flip
 * automation_campaigns.state='completed' để trigger-sweeper biết.
 *
 * Lưu ý: 1 campaign phục vụ nhiều KH cùng (triggerId, sequenceId). Phải đợi KH cuối cùng
 * hoàn thành step cuối thì campaign mới thực sự "xong".
 */
async function tryCompleteCampaign(input: {
  triggerId: string;
  sequenceId: string;
  contactId: string;
  orgId: string;
  /** FIX B 2026-06-08 — jobId của step cuối đang chạy, loại khỏi phép đếm (xem dưới). */
  currentJobId?: string;
}): Promise<void> {
  try {
    const queue = getSequenceStepQueue();
    // Đếm jobs PENDING CỦA RIÊNG TRIGGER NÀY (delayed + waiting + active).
    // P2 fix: getDelayedCount/getWaitingCount/getActiveCount KHÔNG filter triggerId
    // → đếm queue toàn cục → campaign bị "kẹt" active vĩnh viễn khi org có nhiều
    // trigger chạy song song. Dùng getJobs + filter jobId.startsWith(triggerId + '-')
    // (jobId pattern = `${triggerId}-${contactId}-${stepIdx}` — xem buildSequenceStepJobId).
    // Tradeoff: getJobs scan toàn queue (có thể chậm với 10k+ jobs) nhưng
    // tryCompleteCampaign chỉ chạy sau step cuối, tần suất rất thấp → chấp nhận được.
    //
    // FIX B 2026-06-08 — RACE: hàm này được gọi TỪ TRONG chính job step-cuối, lúc đó
    // job ấy vẫn nằm ở set 'active' của BullMQ → getJobs(['active']) đếm cả CHÍNH NÓ →
    // pendingForTrigger ≥ 1 → return sớm → campaign KHÔNG bao giờ flip 'completed' ngay,
    // phải chờ campaign-timeout-sweeper dọn sau 24h. Loại currentJobId khỏi phép đếm.
    // 2026-06-13: đếm theo prefix CÓ sequenceId → 2 luồng khác sequence cùng trigger
    // KHÔNG đếm lẫn nhau (trước đây prefix `${triggerId}-` gộp mọi luồng → completed sai).
    const jobs = await queue.getJobs(['delayed', 'waiting', 'active']);
    const prefix = sequenceStepJobPrefix(input.triggerId, input.sequenceId);
    const pendingForTrigger = jobs.filter(
      (j) => j.id?.startsWith(prefix) && j.id !== input.currentJobId,
    ).length;
    if (pendingForTrigger > 0) {
      // Còn jobs của trigger này đang chạy — chưa thể chắc chắn campaign xong.
      // Để sweeper kiểm tra chính xác hơn qua DB scan ở lần tick tiếp.
      logger.debug(
        `[sequence-step-worker] tryCompleteCampaign trigger=${input.triggerId} contact=${input.contactId} — còn ${pendingForTrigger} jobs pending in queue (scanned ${jobs.length} total)`,
      );
      return;
    }
    // Queue empty → flip campaign state. Atomic: chỉ flip nếu vẫn state='active'.
    const result = await prisma.automationCampaign.updateMany({
      where: { triggerId: input.triggerId, sequenceId: input.sequenceId, state: 'active' },
      data: { state: 'completed', completedAt: new Date() },
    });
    if (result.count > 0) {
      logger.info(
        `[sequence-step-worker] campaign completed trigger=${input.triggerId} sequence=${input.sequenceId} (last contact=${input.contactId})`,
      );
    }
  } catch (err) {
    logger.warn(`[sequence-step-worker] tryCompleteCampaign failed: ${(err as Error).message}`);
  }
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
    // Phase 1a 2026-06-08 — bọc withTenant(job.data.orgId) để mọi query của job
    // mang tenant context (tenant-guard + RLS khi enforce).
    // FIX 2026-06-12 — PHẢI truyền `token` của BullMQ xuống processJob. Thiếu nó,
    // mọi nhánh hoãn (job.moveToDelayed cần token: nick offline :253, contact pause
    // :319, ngoài giờ/quota :346) bị skip → rơi xuống `return skipped` → KHÔNG xếp
    // step kế (enqueueNextStep :507) → luồng bám đuổi gãy giữa chừng, đứng im vĩnh viễn.
    (job: Job<SequenceStepJobData, SequenceStepResult>, token?: string) =>
      withTenant(job.data.orgId, () => processJob(job, token)),
    {
      connection: getBullMQRedis(),
      // Per-nick concurrency = 1 (BullMQ global concurrency cao hơn cho cross-nick parallel).
      // Theo Issue #4 4A — quota INCR sau send, không race per-nick vì worker check
      // pause flag + guards trước.
      concurrency: 5,
    },
  );

  workerInstance.on('completed', (job) => {
    const rv = job.returnvalue;
    const reason = rv?.reason ? ` reason=${rv.reason}` : '';
    logger.info(
      `[sequence-step-worker] completed job=${job.id} step=${rv?.stepIdx} status=${rv?.status}${reason}`,
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
  enrollEpoch?: number; // 2026-06-15: số lần gắn — gắn lại tăng → jobId mới (không đụng job cũ).
}): Promise<void> {
  const seq = await prisma.automationSequence.findUnique({
    where: { id: input.sequenceId },
    select: { steps: true, enabled: true, runtimeRules: true },
  });

  if (!seq || !seq.enabled) {
    // 2026-06-18 (ca 1c76de9b): kịch bản bám đuổi tắt/không tìm thấy lúc KHỞI ĐỘNG → ghi rõ
    // lên monitor thay vì chỉ warn kỹ thuật (sale không biết vì sao bám đuổi không chạy).
    logger.warn(`[sequence-step] cannot start — sequence ${input.sequenceId} disabled/not found`);
    void logBlockOnce({
      orgId: input.orgId, triggerId: input.triggerId, contactId: input.contactId,
      nickId: input.nickId, reason: seq ? 'sequence_disabled' : 'sequence_not_found',
    });
    return;
  }

  const steps = await loadSequenceSteps(input.sequenceId); // 2026-06-04 dual-read
  if (steps.length === 0) {
    logger.warn(`[sequence-step] sequence ${input.sequenceId} has 0 steps`);
    void logBlockOnce({
      orgId: input.orgId, triggerId: input.triggerId, contactId: input.contactId,
      nickId: input.nickId, reason: 'step_out_of_range',
    });
    return;
  }

  const queue = getSequenceStepQueue();
  const epoch = input.enrollEpoch ?? 1;
  const jobId = buildSequenceStepJobId(input.triggerId, input.sequenceId, input.contactId, 0, epoch);
  // FIX #2: bước 0 cũng né ngoài giờ (luật 1). startDelayMinutes=0 (manual gửi ngay) → chỉ
  // dời nếu hiện tại ngoài khung giờ hoạt động.
  const startRules = (seq.runtimeRules ?? undefined) as import('../sequences/types.js').SequenceRuntimeRules | undefined;
  const startBaseMs = Math.max(0, (input.startDelayMinutes ?? 60) * 60_000);
  const startRunAt = nextAllowedTime(new Date(Date.now() + startBaseMs), startRules);
  const delayMs = Math.max(0, startRunAt.getTime() - Date.now());

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
        runtimeRules: (seq.runtimeRules as Record<string, unknown>) ?? undefined, // FIX #2 chuyền rules
        enrollEpoch: epoch, // 2026-06-15: lazy-chain kế thừa epoch cho mọi bước
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
    select: { id: true, triggerId: true, contactId: true, detail: true, metadata: true, createdAt: true },
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

    // ── Resolve sequenceId + epoch của EVENT NÀY trước (cần để check enqueuedExists đúng). ──
    // LOW#3 fix: ưu tiên metadata event (chính xác kể cả đa-luồng); fallback trigger / CareSession.
    const evtMeta = evt.metadata as { sequenceId?: string; enrollEpoch?: number } | null;
    const trigger = await prisma.automationTrigger.findUnique({
      where: { id: evt.triggerId },
      select: { sequenceId: true, orgId: true },
    });
    if (!trigger) continue;
    let sequenceId = evtMeta?.sequenceId ?? trigger.sequenceId ?? null;
    if (!sequenceId) {
      const session = await prisma.careSession.findFirst({
        where: { contactId: evt.contactId, sourceTriggerId: evt.triggerId, state: 'active', sourceSequenceId: { not: null } },
        orderBy: { openedAt: 'desc' },
        select: { sourceSequenceId: true },
      });
      sequenceId = session?.sourceSequenceId ?? null;
    }
    if (!sequenceId) continue; // không xác định được luồng → bỏ qua an toàn
    const evtEpoch = evtMeta?.enrollEpoch ?? 1;

    // FIX review-epoch #4 (LỖI 4 — sweeper bỏ sót do event cũ): check enqueuedExists phải
    // LỌC theo ĐÚNG sequenceId + enrollEpoch của event này. Trước đây chỉ match (trigger,
    // contact, "step N+1/") → event step N+1 của LẦN GẮN CŨ (e1) làm sweeper tưởng đã xếp →
    // bỏ qua → luồng mới (e2) đứng im. Giờ so metadata.sequenceId + enrollEpoch khớp mới skip.
    const enqueuedCandidates = await prisma.automationEventLog.findMany({
      where: {
        triggerId: evt.triggerId,
        contactId: evt.contactId,
        eventType: 'sequence_step_enqueued',
        detail: { contains: `step ${nextStepIdx}/` },
      },
      select: { metadata: true },
      orderBy: { createdAt: 'desc' }, // CLAIM 1-sweeper: mới nhất trước — epoch hiện tại không bị take:20 phân trang loại
      take: 20,
    });
    const alreadyEnqueued = enqueuedCandidates.some((e) => {
      const m = e.metadata as { sequenceId?: string; enrollEpoch?: number } | null;
      const mSeq = m?.sequenceId ?? sequenceId; // data cũ thiếu meta → coi cùng sequence
      const mEpoch = m?.enrollEpoch ?? 1;
      return mSeq === sequenceId && mEpoch === evtEpoch;
    });
    if (alreadyEnqueued) continue;

    // Sweeper recovery: enqueue step N+1 với jobId dedup (đúng sequenceId + epoch của event).
    const queue = getSequenceStepQueue();
    const nextJobId = buildSequenceStepJobId(evt.triggerId, sequenceId, evt.contactId, nextStepIdx, evtEpoch);
    const existingJob = await queue.getJob(nextJobId);
    if (existingJob) {
      logger.info(`[sweeper] job ${nextJobId} exists in queue, skip`);
      continue;
    }

    const steps = await loadSequenceSteps(sequenceId); // 2026-06-04 dual-read
    if (nextStepIdx >= steps.length) continue;

    // Find current nick assigned (from outbox or entry)
    const outbox = await prisma.friendRequestOutbox.findFirst({
      where: { triggerId: evt.triggerId, contactId: evt.contactId },
      select: { nickId: true },
    });
    if (!outbox) continue;

    // FIX #5: lấy runtimeRules để job recovery cũng đúng luật 1+4 (giống enqueue thường).
    const seqRules = await prisma.automationSequence.findUnique({
      where: { id: sequenceId },
      select: { runtimeRules: true },
    });

    // 2026-06-19: recovery dùng cùng công thức — delay ± jitter rồi né khung giờ (luật 1).
    const recRules = (seqRules?.runtimeRules as Record<string, unknown>) as import('../sequences/types.js').SequenceRuntimeRules | undefined;
    const recBaseMs = stepDelayMs(steps[nextStepIdx].delayMinutes ?? 60, steps[nextStepIdx].delayJitterMinutes ?? 0);
    const recRunAt = nextAllowedTime(new Date(Date.now() + recBaseMs), recRules);

    await queue.add(
      'sequence-step',
      {
        triggerId: evt.triggerId,
        contactId: evt.contactId,
        sequenceId,
        nickId: outbox.nickId,
        orgId: trigger.orgId,
        stepIdx: nextStepIdx,
        totalSteps: steps.length,
        runtimeRules: (seqRules?.runtimeRules as Record<string, unknown>) ?? undefined,
        enrollEpoch: evtEpoch,
      },
      { jobId: nextJobId, delay: Math.max(0, recRunAt.getTime() - Date.now()) },
    );

    await prisma.automationEventLog.create({
      data: {
        orgId: trigger.orgId,
        triggerId: evt.triggerId,
        contactId: evt.contactId,
        // 2026-06-18: thêm nickId → cột "Nick chăm" Log không trống; bỏ "(SWEEPER RECOVERY)" khỏi
        // detail (đã có ở metadata.source) để không lộ chữ nội bộ cho sale.
        nickId: outbox.nickId,
        eventType: 'sequence_step_enqueued',
        detail: `step ${nextStepIdx}/${steps.length}`,
        metadata: {
          stepIdx: nextStepIdx,
          totalSteps: steps.length,
          jobId: nextJobId,
          source: 'sweeper_recovery',
          sequenceId, // LỖI 4 self-consistency: vòng sweeper sau đọc lại event này phải biết đúng luồng
          enrollEpoch: evtEpoch, // ...và đúng epoch, nếu không fallback ?? 1 sẽ lệch với epoch>1
        },
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
