// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M5 — Event hooks pause/resume per-contact (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// Wire vào event listeners hiện có để pause sequence per-contact + fire notify:
//   1. friend_accepted → pause N giờ + enqueueSequenceStart + notifyFriendAccept
//   2. friend_rejected → KHÔNG pause (spam hết theo P3), notifyFriendReject
//   3. customer_reply → pause N giờ + cancel pending steps + notifyCustomerReply (KHẨN)
//   4. customer_block → cancel toàn bộ sequence + log
//   5. customer_reaction_negative → pause 48h (anh chốt 2026-06-01)
//   6. customer_reaction_positive → KHÔNG dừng, chỉ score++
//
// Pattern Redis pause flag (Section 18 v3 Fix B + Issue #4 4A):
//   redis.set(`contact:paused:${triggerId}:${contactId}`, '1', 'PX', pauseMs)
//   Worker check trước process job → moveToDelayed remaining TTL → DelayedError
//
// Memory references:
//   - M52: customer_reply pattern message-handler.ts:594-618 (reuse 100%)
//   - project_zalocrm_reaction_system: 4-bug + Zalo protocol (positive khong dung)
//   - feedback_zalocrm_per_nick_throttle_gate

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getBullMQRedis } from './redis-connection.js';
import { getSequenceStepQueue, buildSequenceStepJobId } from './queue-registry.js';
import {
  notifyFriendAccept,
  notifyFriendReject,
  notifyCustomerReply,
  notifyReactionPositive,
  notifyReactionNegative,
} from './internal-notify-worker.js';
import { enqueueSequenceStart } from './sequence-step-worker.js';
import {
  enrollFromTrigger,
  closeCareSessionsForContact,
} from '../care-session/care-session-service.js';

// ════════════════════════════════════════════════════════════════════════
// I13 2026-06-04 — Thông báo nội bộ per-event (Anh chốt bật/tắt riêng từng event)
// ════════════════════════════════════════════════════════════════════════
// Đọc trigger.notifyChannels[eventKey].owner. Mặc định BẬT (true) khi:
//   - notifyChannels null (trigger cũ chưa cấu hình → giữ hành vi cũ luôn báo)
//   - eventKey không có trong config
// Chỉ TẮT khi config rõ ràng owner=false. eventKey: welcome|thankYou|remind|rejected|
// reply|reactionPositive|reactionNegative|lead|block|friendAccept|friendReject.
export async function shouldNotifyOwner(triggerId: string, eventKey: string): Promise<boolean> {
  try {
    const t = await prisma.automationTrigger.findUnique({
      where: { id: triggerId },
      select: { notifyChannels: true },
    });
    const nc = t?.notifyChannels as Record<string, { owner?: boolean }> | null;
    if (!nc || typeof nc !== 'object') return true; // chưa cấu hình → giữ hành vi cũ
    const ev = nc[eventKey];
    if (!ev || ev.owner === undefined) return true; // event không cấu hình → mặc định báo
    return ev.owner !== false;
  } catch {
    return true; // lỗi đọc → an toàn: vẫn báo
  }
}

// ════════════════════════════════════════════════════════════════════════
// Pause flag helpers
// ════════════════════════════════════════════════════════════════════════
export async function setContactPauseFlag(
  triggerId: string,
  contactId: string,
  hours: number,
): Promise<void> {
  if (hours <= 0) return;
  const redis = getBullMQRedis();
  const key = `contact:paused:${triggerId}:${contactId}`;
  const ttlMs = hours * 3600 * 1000;
  await redis.set(key, '1', 'PX', ttlMs);
  logger.info(`[event-hooks] paused contact=${contactId} trigger=${triggerId} for ${hours}h`);
}

export async function clearContactPauseFlag(
  triggerId: string,
  contactId: string,
): Promise<void> {
  const redis = getBullMQRedis();
  const key = `contact:paused:${triggerId}:${contactId}`;
  await redis.del(key);
  logger.info(`[event-hooks] cleared pause flag contact=${contactId} trigger=${triggerId}`);
}

export async function getContactPauseRemaining(
  triggerId: string,
  contactId: string,
): Promise<number> {
  const redis = getBullMQRedis();
  const key = `contact:paused:${triggerId}:${contactId}`;
  const ttl = await redis.pttl(key);
  return ttl > 0 ? ttl : 0;
}

// ════════════════════════════════════════════════════════════════════════
// Helper: Cancel pending sequence-step jobs cho 1 contact trong 1 trigger
// ════════════════════════════════════════════════════════════════════════
// I8 2026-06-03: export để message-handler (customer_reply path) tái dùng — trước
// đây nó dừng chuỗi qua automationTask stub (no-op) → BullMQ jobs vẫn fire (spam).
//
// T4 2026-06-07 (eng-review D6, regression R1): hủy theo deterministic jobId thay
// vì getJobs(1000) full-scan toàn queue. Bug cũ: chi phí tỉ lệ KÍCH THƯỚC QUEUE
// (lục 2000 job tìm vài cái của 1 contact) + bỏ sót nếu queue > 1000 job. CareSession
// gọi hàm này mỗi reply → khuếch đại. jobId = `${triggerId}-${contactId}-${stepIdx}`;
// lazy-chain nên tại 1 thời điểm contact chỉ có ≤1 step pending, nhưng stepIdx có thể
// là bất kỳ 0..N-1 → thử getJob từng stepIdx (chi phí O(số step) ≤ vài chục, KHÔNG
// theo kích thước queue). maxSteps optional: caller biết thì truyền, không thì query.
//
// ⚠️ Codex (eng-review): getJob chỉ xóa waiting/delayed, KHÔNG hủy job đang ACTIVE
// (đang chạy). → worker phải re-check pause flag trước send (đã có ở sequence-step-worker
// pause check) nên job active vẫn bị chặn gửi → ghost vô hại.
// 2026-06-13 (Sequence recode Đợt 1): jobId giờ có sequenceId → hàm này KHÔNG còn
// suy được jobId chỉ từ (trigger, contact). Khách có thể chạy NHIỀU luồng dưới 1
// trigger (gắn tay dùng chung system trigger, anh chốt đa-luồng). Nguồn chân lý
// "khách đang chạy luồng nào" = CareSession active (sourceSequenceId). Quét per-sequence.
//
// Dùng cho STOP THẬT (manual stop / customer block) — remove job hẳn. Reply-pause
// (luật 4) KHÔNG gọi hàm này nữa (chuyển sang ghi pausedAtStepIdx, không remove).
export async function cancelPendingStepsForContact(
  triggerId: string,
  contactId: string,
  maxSteps?: number,
): Promise<{ removed: number }> {
  const queue = getSequenceStepQueue();

  // Các sequence khách đang chạy dưới trigger này (CareSession active). Fallback:
  // nếu không có phiên (data cũ), dùng trigger.sequenceId.
  const sessions = await prisma.careSession.findMany({
    where: { contactId, sourceTriggerId: triggerId, state: 'active', sourceSequenceId: { not: null } },
    select: { sourceSequenceId: true },
  });
  let sequenceIds = [...new Set(sessions.map((s) => s.sourceSequenceId).filter((x): x is string => !!x))];
  if (sequenceIds.length === 0) {
    const trig = await prisma.automationTrigger.findUnique({
      where: { id: triggerId },
      select: { sequenceId: true },
    });
    if (trig?.sequenceId) sequenceIds = [trig.sequenceId];
  }

  let removed = 0;
  for (const sequenceId of sequenceIds) {
    // Upper bound số step để dò jobId. Caller biết totalSteps thì truyền (rẻ nhất).
    const upper = maxSteps ?? (await resolveSequenceStepCount(sequenceId));
    for (let stepIdx = 0; stepIdx < upper; stepIdx++) {
      const jobId = buildSequenceStepJobId(triggerId, sequenceId, contactId, stepIdx);
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          removed++;
        }
      } catch (err) {
        logger.warn(`[event-hooks] failed to remove job ${jobId}: ${(err as Error).message}`);
      }
    }
  }

  if (removed > 0) {
    logger.info(
      `[event-hooks] cancelled ${removed} pending step(s) for contact ${contactId} trigger ${triggerId} ` +
        `across ${sequenceIds.length} sequence(s) (jobId-direct)`,
    );
  }
  return { removed };
}

/**
 * Số step của sequence gắn với trigger — upper bound để dò jobId khi cancel.
 * Fallback 30 nếu không resolve được (an toàn: dò thừa vài jobId không tồn tại = no-op).
 */
async function resolveTriggerSequenceStepCount(triggerId: string): Promise<number> {
  try {
    const trigger = await prisma.automationTrigger.findUnique({
      where: { id: triggerId },
      select: { sequenceId: true, successorSequenceId: true },
    });
    const seqId = trigger?.successorSequenceId ?? trigger?.sequenceId;
    if (!seqId) return 30;
    return await resolveSequenceStepCount(seqId);
  } catch {
    return 30;
  }
}

/**
 * LUẬT 4: bước dở hiện tại của TỪNG luồng khách đang chạy (map sourceSequenceId →
 * stepIdx). Đọc CareSession active để biết các sequenceId, rồi dò job pending của mỗi
 * (trigger, sequence, contact). Dùng cho pause-mark khi khách reply.
 */
export async function getPendingStepIdxBySequence(
  triggerId: string,
  contactId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const sessions = await prisma.careSession.findMany({
    where: { contactId, sourceTriggerId: triggerId, state: 'active', sourceSequenceId: { not: null } },
    select: { sourceSequenceId: true },
  });
  const sequenceIds = [...new Set(sessions.map((s) => s.sourceSequenceId).filter((x): x is string => !!x))];
  if (sequenceIds.length === 0) return out;

  const queue = getSequenceStepQueue();
  for (const sequenceId of sequenceIds) {
    const upper = await resolveSequenceStepCount(sequenceId);
    for (let stepIdx = 0; stepIdx < upper; stepIdx++) {
      const jobId = buildSequenceStepJobId(triggerId, sequenceId, contactId, stepIdx);
      const job = await queue.getJob(jobId).catch(() => null);
      if (job) {
        out.set(sequenceId, stepIdx); // lazy-chain: tại 1 thời điểm ≤1 step pending/luồng
        break;
      }
    }
  }
  return out;
}

/** Đếm số step của 1 sequence cụ thể (jobId mới cần dò theo sequenceId). Default 30. */
async function resolveSequenceStepCount(sequenceId: string): Promise<number> {
  try {
    const seq = await prisma.automationSequence.findUnique({
      where: { id: sequenceId },
      select: { steps: true },
    });
    const steps = seq?.steps;
    if (Array.isArray(steps) && steps.length > 0) return steps.length;
    return 30;
  } catch {
    return 30;
  }
}

// ════════════════════════════════════════════════════════════════════════
// I10 2026-06-04 — Tin 2: gửi tin Cảm ơn KH đã đồng ý kết bạn
// ════════════════════════════════════════════════════════════════════════
// Gửi qua friend channel (KH đã accept) sau delaySeconds. Render template
// {gender}/{name}/{sale} (pattern welcome-probe renderGreeting). Resolve UID qua
// Friend (per-nick). Fire-and-forget với delay nhỏ (app process sống lâu).
async function sendThankYouMessage(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  template: string;
  delaySeconds: number;
}): Promise<void> {
  const { orgId, triggerId, contactId, nickId, template, delaySeconds } = input;

  const doSend = async (): Promise<void> => {
    const [friend, contact, ownerUser] = await Promise.all([
      prisma.friend.findFirst({
        where: { zaloAccountId: nickId, contactId },
        select: { zaloUidInNick: true },
      }),
      prisma.contact.findUnique({
        where: { id: contactId },
        select: { fullName: true, gender: true },
      }),
      prisma.user.findFirst({
        where: { zaloAccounts: { some: { id: nickId } } },
        select: { fullName: true },
      }),
    ]);
    if (!friend?.zaloUidInNick) {
      logger.warn(`[thank-you] no friend UID for contact=${contactId} nick=${nickId}, skip`);
      return;
    }
    // Render {gender}/{name}/{sale} — đồng nhất welcome-probe renderGreeting.
    const genderStr = contact?.gender === 'female' ? 'Chị' : contact?.gender === 'male' ? 'Anh' : 'Anh Chị';
    const name = (contact?.fullName ?? '').trim().split(/\s+/).pop() ?? 'Anh Chị';
    const sale = (ownerUser?.fullName ?? 'em').trim().split(/\s+/).pop() ?? 'em';
    const msg = template.replaceAll('{gender}', genderStr).replaceAll('{name}', name).replaceAll('{sale}', sale);

    const { zaloOps } = await import('../../../shared/zalo-operations.js');
    await zaloOps.sendMessage(nickId, friend.zaloUidInNick, 0, { msg });

    await prisma.automationEventLog.create({
      data: { orgId, triggerId, contactId, nickId, eventType: 'thank_you_sent', detail: msg.slice(0, 200) },
    }).catch(() => null);
    logger.info(`[thank-you] sent contact=${contactId} nick=${nickId}`);
  };

  const delayMs = Math.max(0, (delaySeconds ?? 60) * 1000);
  if (delayMs === 0) {
    await doSend();
  } else {
    // Delay nhỏ (mặc định 60s). Process app sống lâu → setTimeout an toàn cho ca này.
    setTimeout(() => { void doSend().catch((e) => logger.warn(`[thank-you] delayed send failed: ${e?.message ?? e}`)); }, delayMs);
  }
}

// ════════════════════════════════════════════════════════════════════════
// I12 2026-06-04 — Tin 3 (nhắc) + Tin 4 (từ chối): gửi qua HỘP NGƯỜI LẠ
// ════════════════════════════════════════════════════════════════════════
// Dùng chung Tin 3 + Tin 4 — gửi tin tới KH CHƯA là bạn (allowStrangerMessage=true),
// nhận UID trực tiếp. Render {gender}/{name}/{sale} + log eventType + audit.
export async function sendStrangerFollowUp(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  uid: string;
  template: string;
  eventType: string;
}): Promise<void> {
  const { orgId, triggerId, contactId, nickId, uid, template, eventType } = input;
  const [contact, ownerUser] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId }, select: { fullName: true, gender: true } }),
    prisma.user.findFirst({ where: { zaloAccounts: { some: { id: nickId } } }, select: { fullName: true } }),
  ]);
  const genderStr = contact?.gender === 'female' ? 'Chị' : contact?.gender === 'male' ? 'Anh' : 'Anh Chị';
  const name = (contact?.fullName ?? '').trim().split(/\s+/).pop() ?? 'Anh Chị';
  const sale = (ownerUser?.fullName ?? 'em').trim().split(/\s+/).pop() ?? 'em';
  const msg = template.replaceAll('{gender}', genderStr).replaceAll('{name}', name).replaceAll('{sale}', sale);

  const { zaloOps } = await import('../../../shared/zalo-operations.js');
  await zaloOps.sendMessage(nickId, uid, 0, { msg, allowStrangerMessage: true });

  await prisma.automationEventLog.create({
    data: { orgId, triggerId, contactId, nickId, eventType, detail: msg.slice(0, 200) },
  }).catch(() => null);
  logger.info(`[stranger-followup] sent ${eventType} contact=${contactId} nick=${nickId}`);
}

// ════════════════════════════════════════════════════════════════════════
// HOOK 1: friend_accepted
// ════════════════════════════════════════════════════════════════════════
export async function onFriendAccepted(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  acceptedAt?: Date;
}): Promise<void> {
  const { orgId, triggerId, contactId, nickId, acceptedAt } = input;

  // Load trigger + sequence + contact info
  const [trigger, contact, nick] = await Promise.all([
    prisma.automationTrigger.findUnique({
      where: { id: triggerId },
      select: {
        id: true,
        name: true,
        sequenceId: true,
        successorSequenceId: true,
        sequenceStartDelayMinutes: true,
        pauseOnActivityHours: true,
        // I10 2026-06-04 — Tin 2 Cảm ơn KH đã đồng ý KB (gửi sau khi accept).
        thankYouTemplate: true,
        thankYouDelaySeconds: true,
        enableThankYou: true,
        // CareSession 2026-06-07 — snapshot điều kiện đóng phiên.
        closeConditions: true,
      },
    }),
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, fullName: true, phone: true },
    }),
    prisma.zaloAccount.findUnique({
      where: { id: nickId },
      select: { id: true, displayName: true, ownerUserId: true },
    }),
  ]);

  if (!trigger) {
    logger.warn(`[hook:friend_accepted] trigger ${triggerId} not found`);
    return;
  }

  // #1 2026-06-06 — KHÔNG tạo eventLog 'friend_accepted' ở đây nữa: caller
  // (friend-event-handler) đã logEvent('friend_accepted') trước khi gọi hook này,
  // tạo thêm sẽ double dòng trong timeline Mục tiêu.

  // CareSession 2026-06-07 (D2): TẠO PHIÊN (Postgres chân lý) + enqueue sequence.
  // enrollFromTrigger lo thứ tự an toàn: INSERT phiên trước → enqueue BullMQ sau
  // (jobId dedup: luồng stranger drainer đã enroll thì no-op) → mark enqueued.
  // Phiên tạo NGAY cả khi không có sequence (vẫn cần lắng nghe event khách).
  const sequenceId = trigger.successorSequenceId ?? trigger.sequenceId;
  if (nick?.ownerUserId) {
    await enrollFromTrigger({
      orgId,
      triggerId,
      contactId,
      nickId,
      ownerUserId: nick.ownerUserId,
      sequenceId: sequenceId ?? null,
      sequenceStartDelayMinutes: trigger.sequenceStartDelayMinutes,
      // closeConditions đọc từ ORG (cấu hình lắng nghe chung) — không truyền per-trigger.
    });
  } else if (sequenceId) {
    // Nick không có owner (hiếm) → không tạo phiên được nhưng vẫn chạy sequence cũ.
    await enqueueSequenceStart({
      triggerId,
      contactId,
      sequenceId,
      nickId,
      orgId,
      startDelayMinutes: trigger.sequenceStartDelayMinutes,
    });
  }

  // ── I10 2026-06-04 — Tin 2: Cảm ơn KH đã đồng ý kết bạn ──
  // Gửi qua friend channel (KH đã accept) sau thankYouDelaySeconds. KHÁC Tin 1 welcome
  // (gửi sau khi MỜI, không chờ accept). Chỉ gửi khi bật + có template.
  if (trigger.enableThankYou && trigger.thankYouTemplate?.trim()) {
    void sendThankYouMessage({
      orgId,
      triggerId,
      contactId,
      nickId,
      template: trigger.thankYouTemplate,
      delaySeconds: trigger.thankYouDelaySeconds ?? 60,
    }).catch((err) => {
      logger.warn(`[hook:friend_accepted] sendThankYou failed contact=${contactId}: ${err?.message ?? err}`);
    });
  }

  // Fire internal notify (M51.4-a) — I13: tôn trọng cờ notifyChannels.friendAccept.
  if (nick?.ownerUserId && (await shouldNotifyOwner(triggerId, 'friendAccept'))) {
    await notifyFriendAccept({
      orgId,
      targetUserId: nick.ownerUserId,
      contactId,
      contactName: contact?.fullName ?? '',
      contactPhone: contact?.phone ?? '',
      nickId,
      nickName: nick?.displayName ?? '',
      triggerId,
      triggerName: trigger.name,
    });
  }
}

// ════════════════════════════════════════════════════════════════════════
// HOOK 2: friend_rejected
// ════════════════════════════════════════════════════════════════════════
export async function onFriendRejected(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
}): Promise<void> {
  const { orgId, triggerId, contactId, nickId } = input;

  const [trigger, contact, nick] = await Promise.all([
    prisma.automationTrigger.findUnique({
      where: { id: triggerId },
      select: { id: true, name: true },
    }),
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, fullName: true, phone: true },
    }),
    prisma.zaloAccount.findUnique({
      where: { id: nickId },
      select: { id: true, displayName: true, ownerUserId: true },
    }),
  ]);

  if (!trigger) return;

  await prisma.automationEventLog.create({
    data: {
      orgId,
      triggerId,
      contactId,
      nickId,
      eventType: 'friend_rejected',
    },
  });

  // P3: KHÔNG pause — sequence vẫn chạy qua stranger inbox.
  // M51.4-b notify low priority — I13: tôn trọng cờ notifyChannels.friendReject.
  if (nick?.ownerUserId && (await shouldNotifyOwner(triggerId, 'friendReject'))) {
    await notifyFriendReject({
      orgId,
      targetUserId: nick.ownerUserId,
      contactId,
      contactName: contact?.fullName ?? '',
      contactPhone: contact?.phone ?? '',
      nickId,
      nickName: nick?.displayName ?? '',
      triggerId,
      triggerName: trigger.name,
    });
  }
}

// ════════════════════════════════════════════════════════════════════════
// HOOK 3: customer_reply (KHẨN — pause N giờ + cancel jobs)
// ════════════════════════════════════════════════════════════════════════
export async function onCustomerReply(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  replyText: string;
  conversationId?: string;
}): Promise<void> {
  const { orgId, triggerId, contactId, nickId, replyText } = input;

  const trigger = await prisma.automationTrigger.findUnique({
    where: { id: triggerId },
    select: {
      id: true,
      name: true,
      pauseOnActivityHours: true,
      sequenceId: true,
    },
  });
  if (!trigger) return;

  await prisma.automationEventLog.create({
    data: {
      orgId,
      triggerId,
      contactId,
      nickId,
      eventType: 'customer_reply',
      detail: replyText.slice(0, 200),
    },
  });

  // Set pause flag (P2 + P2.1 reset)
  await setContactPauseFlag(triggerId, contactId, trigger.pauseOnActivityHours);

  // Cancel pending steps (M52 customer_reply pattern — reuse logic)
  await cancelPendingStepsForContact(triggerId, contactId);

  // Get contact + nick + sequence step info cho rich notify
  const [contact, nick, currentStepInfo] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, fullName: true, phone: true, leadScore: true },
    }),
    prisma.zaloAccount.findUnique({
      where: { id: nickId },
      select: { id: true, displayName: true, ownerUserId: true },
    }),
    // Find latest step sent
    prisma.automationEventLog.findFirst({
      where: {
        triggerId,
        contactId,
        eventType: 'sequence_step_sent',
      },
      orderBy: { createdAt: 'desc' },
      select: { detail: true },
    }),
  ]);

  // Parse step idx from detail "step N/M"
  let stepInfo: { idx: number; total: number } | undefined;
  if (currentStepInfo?.detail) {
    const m = currentStepInfo.detail.match(/step (\d+)\/(\d+)/);
    if (m) stepInfo = { idx: parseInt(m[1], 10) + 1, total: parseInt(m[2], 10) };
  }

  // Get sequence name
  const seq = trigger.sequenceId
    ? await prisma.automationSequence.findUnique({
        where: { id: trigger.sequenceId },
        select: { name: true },
      })
    : null;

  // Fire KHẨN notify (M51.4-c) — I13: tôn trọng cờ notifyChannels.reply.
  if (nick?.ownerUserId && (await shouldNotifyOwner(triggerId, 'reply'))) {
    await notifyCustomerReply({
      orgId,
      targetUserId: nick.ownerUserId,
      contactId,
      contactName: contact?.fullName ?? '',
      contactPhone: contact?.phone ?? '',
      customerScore: contact?.leadScore ?? undefined,
      nickId,
      nickName: nick?.displayName ?? '',
      triggerId,
      triggerName: trigger.name,
      sequenceName: seq?.name ?? '',
      stepInfo,
      replyPreview: replyText,
    });
  }
}

// ════════════════════════════════════════════════════════════════════════
// HOOK 4: customer_block — cancel toàn bộ sequence
// ════════════════════════════════════════════════════════════════════════
export async function onCustomerBlock(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
}): Promise<void> {
  const { orgId, triggerId, contactId, nickId } = input;

  // FIX 2026-06-03 (code-review CONFIRMED): KHÔNG ghi automationEventLog ở đây nữa.
  // Caller duy nhất (friend-event-handler.ts:498) đã logEvent('customer_block') với
  // summary rich ("🚫 {tên} đã chặn nick {nick}") + metadata TRƯỚC khi gọi hook này.
  // Bản trước ghi 2 lần → timeline hiện block 2 dòng. onCustomerBlock giờ chỉ lo
  // cancel jobs + pause (副 effect), caller lo log + notify + entry status.
  const _ = { orgId, nickId }; void _; // giữ params cho signature ổn định

  // Cancel all pending steps (KH chặn → không gửi tin nữa)
  await cancelPendingStepsForContact(triggerId, contactId);
  // KHÔNG clear pause flag — keep paused forever (no point retry)
  await setContactPauseFlag(triggerId, contactId, 24 * 365); // 1 năm = practically forever

  // CareSession 2026-06-07 (T7): khách chặn = tín hiệu chấm dứt mạnh nhất → đóng
  // mọi phiên của khách trên nick này (event-driven, đóng ngay).
  try {
    await closeCareSessionsForContact({ orgId, contactId, nickId, reason: 'customer_blocked' });
  } catch (err) {
    logger.warn(`[hook:customer_block] close care session failed contact=${contactId}: ${(err as Error).message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// HOOK 5+6: customer_reaction (positive/negative)
// ════════════════════════════════════════════════════════════════════════
export type ReactionSentiment = 'positive' | 'negative' | 'neutral';

export function classifyReactionEmoji(emoji: string): ReactionSentiment {
  // Memory project_zalocrm_reaction_system: 4-bug + protocol mismatch
  // Positive: ❤️👍🌹😆
  // Negative: 😡👎💔
  // Neutral: 😮😭
  const positive = ['❤️', '👍', '🌹', '😆', '❤', '/-heart', '/-strong', ':>', '/-rose'];
  const negative = ['😡', '👎', '💔', ':-((', ':-h'];
  if (positive.some((e) => emoji.includes(e))) return 'positive';
  if (negative.some((e) => emoji.includes(e))) return 'negative';
  return 'neutral';
}

export async function onCustomerReaction(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  emoji: string;
  messageId?: string;
}): Promise<void> {
  const { orgId, triggerId, contactId, nickId, emoji } = input;
  const sentiment = classifyReactionEmoji(emoji);

  // FIX 2026-06-03 (code-review CONFIRMED) — DEDUP chống Zalo gửi ~10 reaction event
  // liên tiếp cho 1 lần thả (xem zalo-listener-factory.ts:96 "Zalo gửi 10 event liên tiếp").
  // Không guard → score ±5 chạy 10×, 10 event-log, 10 notify, pause re-set 10×. SETNX
  // TTL 30s trên (trigger, contact, sentiment): chỉ lần đầu trong 30s chạy thật.
  const redis = getBullMQRedis();
  const dedupKey = `reaction-dedup:${triggerId}:${contactId}:${sentiment}`;
  const firstTime = await redis.set(dedupKey, '1', 'EX', 30, 'NX');
  if (firstTime === null) {
    // Đã xử lý reaction cùng sentiment cho KH này trong 30s qua — bỏ qua bản lặp.
    return;
  }

  await prisma.automationEventLog.create({
    data: {
      orgId,
      triggerId,
      contactId,
      nickId,
      eventType: `customer_reaction_${sentiment}`,
      detail: emoji,
    },
  });

  // I5 2026-06-03 — resolve nick owner + contact name cho notify nội bộ.
  // Anh chốt: tích cực báo dạng tích cực, tiêu cực báo dạng tiêu cực.
  const [trigger, contact, nick] = await Promise.all([
    prisma.automationTrigger.findUnique({
      where: { id: triggerId },
      select: { name: true },
    }),
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { fullName: true, phone: true },
    }),
    prisma.zaloAccount.findUnique({
      where: { id: nickId },
      select: { displayName: true, ownerUserId: true },
    }),
  ]);

  // Anh chốt 2026-06-01:
  //   - positive: KHÔNG dừng, score++ , báo nội bộ dạng tích cực (normal)
  //   - negative: pause 48h (lâu hơn reply 24h) + score-- , báo nội bộ dạng tiêu cực (high)
  //   - neutral: KHÔNG hành động
  if (sentiment === 'negative') {
    await setContactPauseFlag(triggerId, contactId, 48);
    await cancelPendingStepsForContact(triggerId, contactId);

    // Decrease CRM score
    await prisma.contact
      .update({
        where: { id: contactId },
        data: { leadScore: { decrement: 5 } },
      })
      .catch(() => null);

    if (nick?.ownerUserId && (await shouldNotifyOwner(triggerId, 'reactionNegative'))) {
      await notifyReactionNegative({
        orgId,
        targetUserId: nick.ownerUserId,
        contactId,
        contactName: contact?.fullName ?? '',
        contactPhone: contact?.phone ?? '',
        nickId,
        nickName: nick.displayName ?? '',
        triggerId,
        triggerName: trigger?.name ?? '',
        emoji,
      });
    }
  } else if (sentiment === 'positive') {
    // Score++, KHÔNG dừng
    await prisma.contact
      .update({
        where: { id: contactId },
        data: { leadScore: { increment: 5 } },
      })
      .catch(() => null);

    if (nick?.ownerUserId && (await shouldNotifyOwner(triggerId, 'reactionPositive'))) {
      await notifyReactionPositive({
        orgId,
        targetUserId: nick.ownerUserId,
        contactId,
        contactName: contact?.fullName ?? '',
        contactPhone: contact?.phone ?? '',
        nickId,
        nickName: nick.displayName ?? '',
        triggerId,
        triggerName: trigger?.name ?? '',
        emoji,
      });
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// Manual control (gọi từ M9 endpoint /pause /stop /resume)
// ════════════════════════════════════════════════════════════════════════
export async function onManualPause(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  hours: number;
  reason?: string;
  byUserId: string;
}): Promise<void> {
  await setContactPauseFlag(input.triggerId, input.contactId, input.hours);
  await prisma.automationEventLog.create({
    data: {
      orgId: input.orgId,
      triggerId: input.triggerId,
      contactId: input.contactId,
      eventType: 'manual_pause',
      detail: `by ${input.byUserId}, ${input.hours}h, reason: ${input.reason ?? ''}`,
    },
  });
}

export async function onManualStop(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  reason: string;
  byUserId: string;
}): Promise<void> {
  await setContactPauseFlag(input.triggerId, input.contactId, 24 * 365); // forever
  await cancelPendingStepsForContact(input.triggerId, input.contactId);
  await prisma.automationEventLog.create({
    data: {
      orgId: input.orgId,
      triggerId: input.triggerId,
      contactId: input.contactId,
      eventType: 'manual_stop',
      detail: `by ${input.byUserId}, reason: ${input.reason}`,
    },
  });
}

export async function onManualResume(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  byUserId: string;
}): Promise<void> {
  await clearContactPauseFlag(input.triggerId, input.contactId);
  await prisma.automationEventLog.create({
    data: {
      orgId: input.orgId,
      triggerId: input.triggerId,
      contactId: input.contactId,
      eventType: 'manual_resume',
      detail: `by ${input.byUserId}`,
    },
  });
}
