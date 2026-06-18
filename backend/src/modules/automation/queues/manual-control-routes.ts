// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M9 — Manual control endpoints (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// 5 endpoint sale chat /chat dùng để pause/stop/resume/enroll 1 KH ad-hoc
// vào Mục tiêu hệ thống "Bám đuổi khách hàng thủ công".
//
// Endpoints (Section 22.4 design doc):
//   POST /api/v1/automation/triggers/:tid/contacts/:cid/pause
//   POST /api/v1/automation/triggers/:tid/contacts/:cid/stop
//   POST /api/v1/automation/triggers/:tid/contacts/:cid/resume
//   POST /api/v1/chat/contacts/:cid/manual-enroll
//   GET  /api/v1/contacts/:cid/automation-status

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import {
  onManualPause,
  onManualStop,
  onManualResume,
  getContactPauseRemaining,
} from './event-hooks.js';
import { enqueueSequenceStart } from './sequence-step-worker.js';
import { getSequenceStepQueue, sequenceStepContactPrefix } from './queue-registry.js';

/**
 * Get-or-create system trigger "Bám đuổi khách hàng thủ công" cho 1 org.
 * Migration 20260601182155 STEP 8 đáng lẽ seed cái này per-org, nhưng org tạo
 * trước/sau migration hoặc DB restore có thể thiếu → tự tạo lazy để manual-enroll
 * không lỗi 500 (Anh chốt 2026-06-07). Idempotent: trả cái có sẵn nếu đã tồn tại.
 */
async function getOrCreateManualFollowupTrigger(
  orgId: string,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  const existing = await prisma.automationTrigger.findFirst({
    where: { orgId, isSystemTrigger: true, systemKind: 'manual_chat_followup' },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  try {
    // created_by_id NOT NULL — ưu tiên owner, fallback user gọi, fallback user bất kỳ.
    const owner = await prisma.user.findFirst({
      where: { orgId, role: 'owner' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const createdById = owner?.id ?? userId;

    const created = await prisma.automationTrigger.create({
      data: {
        orgId,
        name: 'Bám đuổi khách hàng thủ công',
        category: 'manual',
        eventType: 'manual_chat_followup',
        bindingKind: 'sequence',
        segmentSpec: {
          kind: 'manual',
          nickIds: [],
          skipRules: { recencyDays: 0, friendCap: 0, entryStatuses: [] },
        },
        state: 'active',
        enabled: true,
        isSystemTrigger: true,
        systemKind: 'manual_chat_followup',
        createdById,
        // Cấu hình khớp migration STEP 8: gửi ngay, bypass recency, pause 24h khi reply.
        sendHourStart: 6,
        sendHourEnd: 22,
        filterThreadType: 'user',
        multiNickThreshold: 0,
        recencySkipDays: 0,
        sequenceStartDelayMinutes: 0,
        pauseOnActivityHours: 24,
        minFriendReqGapMs: 60000,
        concurrencyPerNickPerMinute: 1,
      },
      select: { id: true, name: true },
    });
    logger.info(`[manual-enroll] auto-created system trigger for org=${orgId} id=${created.id}`);
    return created;
  } catch (err) {
    // Race: 2 request cùng tạo → unique/dup → đọc lại.
    logger.warn(`[manual-enroll] create system trigger failed, re-reading: ${(err as Error).message}`);
    return prisma.automationTrigger.findFirst({
      where: { orgId, isSystemTrigger: true, systemKind: 'manual_chat_followup' },
      select: { id: true, name: true },
    });
  }
}

// ════════════════════════════════════════════════════════════════════════
// Helpers dùng chung cho follow-up status (automation-status + manual-followup)
// ════════════════════════════════════════════════════════════════════════
type FollowupState = 'active' | 'paused' | 'completed' | 'stopped';

/** Derive trạng thái thật của 1 (trigger, contact) run từ tín hiệu đã thu thập. */
function deriveFollowupState(input: {
  hasPendingJob: boolean;
  pauseMs: number;
  isStopped: boolean;
  totalSteps: number | null;
}): FollowupState {
  if (input.isStopped) return 'stopped';
  if (input.hasPendingJob) return 'active';
  if (input.pauseMs > 0) return 'paused';
  // Hết job + không dừng/pause + đã biết tổng bước → coi như đi hết chuỗi.
  if (input.totalSteps && input.totalSteps > 0) return 'completed';
  return 'active';
}

/**
 * Scan BullMQ sequence-step queue 1 lần, trả map key → {stepIdx, nextRunAt, sequenceId}.
 *
 * 2026-06-13: jobId đổi sang `${triggerId}-${sequenceId}-${contactId}-${stepIdx}` (đa-luồng).
 * Hàm nhận (triggerId, contactIds) → match jobId theo regex, gom theo contactId. 1 KH có
 * thể nhiều luồng → giữ job SỚM NHẤT (bước kế gần nhất) cho cột hiển thị tổng. (ETA
 * per-luồng đầy đủ là Đợt 2 — xem TODO-CON-SOT.) Key = contactId.
 */
async function scanPendingSequenceJobs(
  triggerId: string,
  contactIds: string[],
): Promise<Map<string, { stepIdx: number; nextRunAt: Date; sequenceId: string }>> {
  const out = new Map<string, { stepIdx: number; nextRunAt: Date; sequenceId: string }>();
  if (contactIds.length === 0) return out;
  const now = Date.now();
  const wanted = new Set(contactIds);
  try {
    const queue = getSequenceStepQueue();
    const jobs = await queue.getJobs(['delayed', 'waiting', 'active'], 0, 5000);
    for (const job of jobs) {
      if (!job.id || !job.id.startsWith(`${triggerId}-`)) continue;
      // jobId = trigger-sequence-contact-step. trigger/sequence/contact là uuid (có dấu '-')
      // → KHÔNG split mù. Dùng job.data (đáng tin) thay vì parse jobId.
      const d = job.data as { contactId?: string; sequenceId?: string; stepIdx?: number };
      if (!d?.contactId || !wanted.has(d.contactId)) continue;
      const stepIdx = typeof d.stepIdx === 'number' ? d.stepIdx : 0;
      // FIX (anh test 2026-06-14): job bị moveToDelayed (nick offline/pause) → giờ chạy
      // thật = (processedOn ?? timestamp) + delay-mới, KHÔNG phải timestamp + opts.delay.
      const nextRunAt = new Date((job.processedOn ?? job.timestamp ?? now) + ((job as { delay?: number }).delay ?? job.opts?.delay ?? 0));
      const cur = out.get(d.contactId);
      if (!cur || nextRunAt < cur.nextRunAt) {
        out.set(d.contactId, { stepIdx, nextRunAt, sequenceId: d.sequenceId ?? '' });
      }
    }
  } catch (err) {
    logger.warn(`[followup] BullMQ scan failed: ${(err as Error).message}`);
  }
  return out;
}

interface ManualFollowupContact {
  // 2026-06-15 (anh chốt): mỗi LẦN GẮN = 1 dòng (không gom-đè theo contact nữa).
  enrollmentId: string;        // khóa duy nhất 1 dòng = contactId + thời điểm gắn (ổn định cho FE :key)
  enrollSeq: number;           // lần gắn thứ mấy của contact+luồng này (1,2,3…) → "Lần N"
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  sequenceName: string | null;
  enrolledByName: string | null;
  enrollReason: string | null;
  nickName: string | null;
  state: FollowupState;
  currentStep: number | null;
  totalSteps: number | null;
  enrolledAt: string;
  lastSentAt: string | null;   // lần gửi bước gần nhất CỦA LẦN GẮN NÀY
  nextRunAt: string | null;    // lần gửi tiếp (chỉ lần gắn mới nhất còn job sống)
  progressUnknown: boolean;    // đợt cũ thiếu dữ liệu (không đếm được bước) → FE "không rõ tiến độ"
}

interface EnrollmentRun {
  contactId: string;
  enrolledAt: Date;
  enrolledById: string | null;
  enrollReason: string | null;
  sequenceName: string | null;
  nickId: string | null;
  currentStep: number | null;
  totalSteps: number | null;
  lastSentAt: Date | null;
  isStopped: boolean;            // có manual_stop/customer_block sau lần gắn này
  isLatestForContact: boolean;   // lần gắn mới nhất của contact → mới gán job pending + pause
}

/**
 * Xây danh sách KH đã gắn tay (enroll thủ công) dưới 1 trigger hệ thống.
 * Dùng chung cho manual-followup/summary (đếm) + /contacts (list).
 * Nguồn: event manual_enroll (sale + reason + sequence) + sequence_step_sent (step)
 * + manual_stop/customer_block (stopped) + scan BullMQ (đang chạy).
 */
async function buildManualFollowupContacts(
  orgId: string,
  triggerId: string,
): Promise<ManualFollowupContact[]> {
  const since = new Date(Date.now() - 90 * 86400_000); // 90 ngày
  const events = await prisma.automationEventLog.findMany({
    where: { orgId, triggerId, contactId: { not: null }, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' }, // CŨ→MỚI: dựng từng lần gắn theo dòng thời gian
    take: 4000,
    select: { contactId: true, nickId: true, eventType: true, detail: true, createdAt: true },
  });

  // ── B1: MỖI manual_enroll = 1 LẦN GẮN (run) = 1 dòng. KHÔNG gom-đè theo contact. ──
  // Sự kiện step/dừng ghép vào run gần nhất TRƯỚC nó (asc) → đúng lần gắn đang chạy lúc đó.
  // Đợt cũ không có step trong khoảng → totalSteps=null → FE "không rõ tiến độ" (anh chốt).
  const runsByContact = new Map<string, EnrollmentRun[]>();
  for (const e of events) {
    if (!e.contactId) continue;
    if (e.eventType === 'manual_enroll') {
      const m = e.detail?.match(/^by (\S+) sequence=(.*) reason=(.*)$/s);
      const run: EnrollmentRun = {
        contactId: e.contactId,
        enrolledAt: e.createdAt,
        enrolledById: m?.[1] ?? null,
        sequenceName: m?.[2]?.trim() || null,
        enrollReason: m?.[3]?.trim() || null,
        nickId: e.nickId ?? null,
        currentStep: null, totalSteps: null, lastSentAt: null,
        isStopped: false, isLatestForContact: false,
      };
      const arr = runsByContact.get(e.contactId);
      if (arr) arr.push(run);
      else runsByContact.set(e.contactId, [run]);
      continue;
    }
    const arr = runsByContact.get(e.contactId);
    if (!arr || arr.length === 0) continue; // sự kiện trước lần gắn đầu → bỏ
    const run = arr[arr.length - 1];
    if (e.eventType === 'sequence_step_sent') {
      run.lastSentAt = e.createdAt; // asc → cái sau mới nhất
      if (e.nickId && !run.nickId) run.nickId = e.nickId;
      const sm = e.detail?.match(/step (\d+)\/(\d+)/);
      if (sm) { run.currentStep = parseInt(sm[1], 10) + 1; run.totalSteps = parseInt(sm[2], 10); }
    } else if (e.eventType === 'manual_stop' || e.eventType === 'customer_block') {
      run.isStopped = true;
    }
  }

  // Đánh dấu run mới nhất của mỗi contact (chỉ nó còn job sống + pause flag).
  const allRuns: EnrollmentRun[] = [];
  for (const arr of runsByContact.values()) {
    if (arr.length) arr[arr.length - 1].isLatestForContact = true;
    for (const r of arr) allRuns.push(r);
  }
  if (allRuns.length === 0) return [];

  const contactIds = [...runsByContact.keys()];

  // ── B2: batch tên KH + sale + nick. ──
  const nickIds = [...new Set(allRuns.map((r) => r.nickId).filter((x): x is string => !!x))];
  const enrollerIds = [...new Set(allRuns.map((r) => r.enrolledById).filter((x): x is string => !!x))];
  const [contacts, enrollers, nicks] = await Promise.all([
    prisma.contact.findMany({ where: { id: { in: contactIds }, orgId }, select: { id: true, fullName: true, phone: true } }),
    enrollerIds.length
      ? prisma.user.findMany({ where: { id: { in: enrollerIds } }, select: { id: true, fullName: true } })
      : Promise.resolve([] as { id: string; fullName: string }[]),
    nickIds.length
      ? prisma.zaloAccount.findMany({ where: { id: { in: nickIds }, orgId }, select: { id: true, displayName: true } })
      : Promise.resolve([] as { id: string; displayName: string | null }[]),
  ]);
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const enrollerName = new Map(enrollers.map((u) => [u.id, u.fullName]));
  const nickName = new Map(nicks.map((n) => [n.id, n.displayName]));

  // Scan BullMQ 1 lần (job pending chỉ thuộc run mới nhất của contact).
  const pendingByContact = await scanPendingSequenceJobs(triggerId, contactIds);
  // Pause flag 1 lần / contact.
  const pauseByContact = new Map<string, number>();
  await Promise.all(contactIds.map(async (cid) => {
    pauseByContact.set(cid, await getContactPauseRemaining(triggerId, cid));
  }));

  // ── B3: dựng dòng + đánh số "Lần N" theo (contact, luồng). ──
  const seqCounter = new Map<string, number>(); // key: contactId|sequenceName → đếm lần gắn
  const result: ManualFollowupContact[] = [];
  for (const r of allRuns) {
    const seqKey = `${r.contactId}|${r.sequenceName ?? '∅'}`;
    const enrollSeq = (seqCounter.get(seqKey) ?? 0) + 1;
    seqCounter.set(seqKey, enrollSeq);

    const pending = r.isLatestForContact ? pendingByContact.get(r.contactId) : undefined;
    const pauseMs = r.isLatestForContact ? (pauseByContact.get(r.contactId) ?? 0) : 0;
    // Đợt cũ thiếu dữ liệu (totalSteps=null, không phải run mới nhất, không có job) → coi là
    // 'completed' (đã qua), KHÔNG để deriveFollowupState fallback ra 'active' gây hiểu nhầm.
    const progressUnknown = r.totalSteps === null && !pending;
    let state: FollowupState;
    if (r.isStopped) state = 'stopped';
    else if (progressUnknown && !r.isLatestForContact) state = 'completed'; // lần gắn cũ đã bị thay
    else state = deriveFollowupState({ hasPendingJob: !!pending, pauseMs, isStopped: false, totalSteps: r.totalSteps });

    let currentStep = r.currentStep;
    if (pending) currentStep = pending.stepIdx + 1;
    else if (state === 'completed' && r.totalSteps) currentStep = r.totalSteps;

    const ct = contactMap.get(r.contactId);
    result.push({
      enrollmentId: `${r.contactId}-${r.enrolledAt.getTime()}`,
      enrollSeq,
      contactId: r.contactId,
      contactName: ct?.fullName ?? '(KH đã xoá)',
      contactPhone: ct?.phone ?? null,
      sequenceName: r.sequenceName,
      enrolledByName: r.enrolledById ? (enrollerName.get(r.enrolledById) ?? null) : null,
      enrollReason: r.enrollReason,
      nickName: r.nickId ? (nickName.get(r.nickId) ?? null) : null,
      state,
      currentStep,
      totalSteps: r.totalSteps,
      enrolledAt: r.enrolledAt.toISOString(),
      lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
      nextRunAt: pending ? pending.nextRunAt.toISOString() : null,
      progressUnknown,
    });
  }
  // Mới nhất lên trước.
  result.sort((a, b) => new Date(b.enrolledAt).getTime() - new Date(a.enrolledAt).getTime());
  return result;
}

export async function registerManualControlRoutes(app: FastifyInstance): Promise<void> {
  // ── POST pause-contact ──
  app.post<{
    Params: { tid: string; cid: string };
    Body: { hours: number; reason?: string };
  }>(
    '/api/v1/automation/triggers/:tid/contacts/:cid/pause',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tid, cid } = request.params;
      const { hours, reason } = request.body;
      const orgId = request.user!.orgId;

      // Verify trigger thuộc org
      const trigger = await prisma.automationTrigger.findFirst({
        where: { id: tid, orgId },
        select: { id: true },
      });
      if (!trigger) {
        reply.code(404);
        return { error: 'Mục tiêu không tồn tại' };
      }

      await onManualPause({
        orgId,
        triggerId: tid,
        contactId: cid,
        hours: Math.max(1, Math.min(720, hours)), // clamp 1h - 30 ngày
        reason,
        byUserId: request.user!.id,
      });

      return {
        ok: true,
        triggerId: tid,
        contactId: cid,
        pausedHours: hours,
      };
    },
  );

  // ── POST stop-contact ──
  app.post<{
    Params: { tid: string; cid: string };
    Body: { reason: string };
  }>(
    '/api/v1/automation/triggers/:tid/contacts/:cid/stop',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tid, cid } = request.params;
      const { reason } = request.body;
      const orgId = request.user!.orgId;

      if (!reason || reason.trim().length === 0) {
        reply.code(400);
        return { error: 'Lý do dừng bắt buộc nhập' };
      }

      const trigger = await prisma.automationTrigger.findFirst({
        where: { id: tid, orgId },
        select: { id: true },
      });
      if (!trigger) {
        reply.code(404);
        return { error: 'Mục tiêu không tồn tại' };
      }

      await onManualStop({
        orgId,
        triggerId: tid,
        contactId: cid,
        reason,
        byUserId: request.user!.id,
      });

      return {
        ok: true,
        triggerId: tid,
        contactId: cid,
      };
    },
  );

  // ── POST resume-contact ──
  app.post<{
    Params: { tid: string; cid: string };
  }>(
    '/api/v1/automation/triggers/:tid/contacts/:cid/resume',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tid, cid } = request.params;
      const orgId = request.user!.orgId;

      const trigger = await prisma.automationTrigger.findFirst({
        where: { id: tid, orgId },
        select: { id: true },
      });
      if (!trigger) {
        reply.code(404);
        return { error: 'Mục tiêu không tồn tại' };
      }

      await onManualResume({
        orgId,
        triggerId: tid,
        contactId: cid,
        byUserId: request.user!.id,
      });

      return { ok: true };
    },
  );

  // ── POST advance — "Gửi bước tiếp ngay" (YC3 Đợt 2): đẩy job bước kế về delay 0 ──
  app.post<{
    Params: { tid: string; cid: string };
    Body: { sequenceId?: string };
  }>(
    '/api/v1/automation/triggers/:tid/contacts/:cid/advance',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tid, cid } = request.params;
      const orgId = request.user!.orgId;
      const sequenceId = request.body?.sequenceId;

      // FIX review #1 (HIGH): BẮT BUỘC sequenceId. 1 KH chạy nhiều luồng song song dưới
      // CÙNG system trigger → thiếu sequenceId sẽ promote MỌI luồng = spam. Mỗi card 1 luồng.
      if (!sequenceId) {
        reply.code(400);
        return { error: 'Thiếu sequenceId — không xác định được luồng nào cần gửi ngay.' };
      }

      const trigger = await prisma.automationTrigger.findFirst({
        where: { id: tid, orgId },
        select: { id: true },
      });
      if (!trigger) {
        reply.code(404);
        return { error: 'Mục tiêu không tồn tại' };
      }

      // LẤY enrollEpoch của phiên active để promote ĐÚNG lần gắn (bỏ job mồ côi).
      const activeSession = await prisma.careSession.findFirst({
        where: { orgId, contactId: cid, sourceSequenceId: sequenceId, state: 'active' },
        orderBy: { openedAt: 'desc' },
        select: { id: true, pausedAtStepIdx: true, enrollEpoch: true, nickId: true },
      });
      if (!activeSession) {
        reply.code(409);
        return { error: 'Luồng này không còn chạy cho khách (đã xong hoặc đã dừng).' };
      }
      const activeEpoch = activeSession.enrollEpoch ?? 1;
      // 2026-06-17 (anh chốt): nút "Gửi bước tiếp theo ngay" là SALE CHỦ Ý gửi → KHÔNG chặn khi
      // đang reply-pause nữa (trước đây 409 "Khách vừa trả lời… không gửi" → nút vô tác dụng).
      // Thay vào: RESUME ngay (override hold) — clear pausedAtStepIdx + cờ Redis + queueStatus,
      // để worker KHÔNG re-defer job khi promote (worker check cờ Redis + marker DB trước khi gửi).
      const wasPausedStep = activeSession.pausedAtStepIdx; // bước đang hold (enqueue lại nếu job đã huỷ)
      if (wasPausedStep != null) {
        const { clearContactPauseFlag } = await import('./event-hooks.js');
        // NV-1 (2026-06-18): sale bấm gửi ngay → xoá khoá block để lần chặn kế ghi log lại.
        const { clearBlockMarker } = await import('../shared/block-logger.js');
        await prisma.careSession.update({ where: { id: activeSession.id }, data: { pausedAtStepIdx: null } }).catch(() => null);
        await clearContactPauseFlag(tid, cid).catch(() => null);
        await clearBlockMarker(tid, cid);
        await prisma.triggerQueueEntry.updateMany({
          where: { triggerId: tid, contactId: cid, queueStatus: 'customer_reply' },
          data: { queueStatus: 'processing' },
        }).catch(() => null);
        logger.info(`[advance] sale gửi tiếp ngay khi đang reply-pause → RESUME contact=${cid} step=${wasPausedStep}`);
      }

      // FIX bug anh báo 2026-06-15: promote CHỈ job ĐÚNG EPOCH của phiên active.
      // Trước đây prefix = `{tid}-{seq}-` KHÔNG có epoch → promote CẢ job mồ côi epoch cũ
      // (e2/e3/e4...) → worker chạy chúng nhưng guard stale_epoch chặn (không gửi) → UI vẫn
      // báo "đã gửi" SAI. Giờ prefix gồm epoch → chỉ đúng 1 job đang chờ của lần gắn này.
      const queue = getSequenceStepQueue();
      const PAGE = 5000;
      const jobs = await queue.getJobs(['delayed'], 0, PAGE);
      if (jobs.length >= PAGE) {
        logger.warn(`[advance] delayed queue ≥${PAGE} jobs — job mục tiêu có thể ngoài trang (xem TODO scale).`);
      }
      const epochPrefix = `${sequenceStepContactPrefix(tid, sequenceId, cid)}e${activeEpoch}-`; // `{tid}-{seq}-{cid}-e{epoch}-`
      const promotedJobRefs: Array<Awaited<ReturnType<typeof queue.getJob>>> = [];
      let promoted = 0;
      for (const job of jobs) {
        if (!job.id || !job.id.startsWith(epochPrefix)) continue;
        try {
          await job.promote(); // BullMQ v5: delayed → waiting (chạy ngay)
          promoted++;
          promotedJobRefs.push(job);
        } catch (err) {
          logger.warn(`[advance] promote job ${job.id} failed: ${(err as Error).message}`);
        }
      }

      // Nếu KHÔNG promote được job nào NHƯNG vừa resume reply-pause (job có thể đã bị huỷ bởi
      // onCustomerReply) → enqueue LẠI bước dở để gửi ngay (tránh orphan: đã clear marker mà
      // không có job nào chạy → KH kẹt). 2026-06-17.
      if (promoted === 0 && wasPausedStep != null) {
        const { buildSequenceStepJobId } = await import('./queue-registry.js');
        const seq = await prisma.automationSequence.findUnique({
          where: { id: sequenceId },
          select: { steps: true, runtimeRules: true },
        });
        const steps = Array.isArray(seq?.steps) ? (seq!.steps as unknown[]) : [];
        if (wasPausedStep < steps.length) {
          const jobId = buildSequenceStepJobId(tid, sequenceId, cid, wasPausedStep, activeEpoch);
          if (!(await queue.getJob(jobId))) {
            await queue.add(
              'sequence-step',
              {
                triggerId: tid, contactId: cid, sequenceId, nickId: activeSession.nickId,
                orgId, stepIdx: wasPausedStep, totalSteps: steps.length,
                runtimeRules: (seq?.runtimeRules as Record<string, unknown>) ?? undefined,
                enrollEpoch: activeEpoch,
              },
              { jobId, delay: 0 },
            );
          }
          const fresh = await queue.getJob(jobId);
          if (fresh) { promoted = 1; promotedJobRefs.push(fresh); }
          logger.info(`[advance] job đã huỷ → enqueue lại bước ${wasPausedStep} contact=${cid}`);
        }
      }

      if (promoted === 0) {
        reply.code(409);
        return { error: 'Không có bước nào đang chờ để gửi ngay (luồng đã xong hoặc đã dừng).' };
      }

      // FIX bug anh báo: CHỜ job thực sự CHẠY XONG (tối đa 8s) để báo ĐÚNG "đã gửi" vs "đang
      // xử lý". Trước đây trả ngay sau promote → UI báo "đã gửi" nhưng tin chưa qua (worker
      // chạy bất đồng bộ + còn guard giờ/nick). Giờ poll trạng thái job: completed=gửi thật,
      // delayed lại=bị hoãn (ngoài giờ/nick offline), còn waiting/active=đang xử lý.
      let actuallySent = false;
      let deferred = false;
      let deferReason: string | null = null; // lý do hoãn (worker ghi job.data) → FE báo câu dễ hiểu
      const deadline = Date.now() + 8000;
      const jobRef = promotedJobRefs[0];
      if (jobRef?.id) {
        while (Date.now() < deadline) {
          const fresh = await queue.getJob(jobRef.id).catch(() => null);
          if (!fresh) { actuallySent = true; break; } // job xong + removeOnComplete đã dọn
          const st = await fresh.getState().catch(() => 'unknown');
          if (st === 'completed') { actuallySent = true; break; }
          if (st === 'failed') { break; }
          if (st === 'delayed') {
            deferred = true;
            deferReason = ((fresh.data as { deferReason?: string })?.deferReason) ?? null;
            break;
          } // worker hoãn lại — đọc lý do cụ thể từ job.data
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      return {
        ok: true,
        promoted,
        actuallySent, // true = tin đã thực sự gửi; false = mới đẩy vào hàng đợi
        deferred,     // true = job bị hoãn lại
        deferReason,  // 'nick_gap'|'outside_hour_window'|'quota_capped'|'nick_offline'|'awaiting_reply'|null
      };
    },
  );

  // ── POST manual-enroll (sale chat / chat enroll vào system trigger) ──
  app.post<{
    Params: { cid: string };
    Body: { sequenceId: string; nickId: string; reason: string };
  }>(
    '/api/v1/chat/contacts/:cid/manual-enroll',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { cid } = request.params;
      const { sequenceId, nickId, reason } = request.body;
      const orgId = request.user!.orgId;
      const userId = request.user!.id;

      if (!reason || reason.trim().length === 0) {
        reply.code(400);
        return { error: 'Lý do bám đuổi bắt buộc nhập' };
      }

      // System trigger "Bám đuổi khách hàng thủ công" — get-or-create per org.
      // (Anh chốt 2026-06-07: migration seed không phủ hết org → tự tạo nếu thiếu
      //  để manual-enroll không bao giờ lỗi 500, kể cả org mới.)
      const systemTrigger = await getOrCreateManualFollowupTrigger(orgId, userId);
      if (!systemTrigger) {
        reply.code(500);
        return { error: 'Không khởi tạo được Mục tiêu hệ thống bám đuổi thủ công' };
      }

      // Verify sequence + nick thuộc org
      const [sequence, nick, contact] = await Promise.all([
        prisma.automationSequence.findFirst({
          where: { id: sequenceId, orgId, enabled: true },
          select: { id: true, name: true, steps: true, runtimeRules: true },
        }),
        prisma.zaloAccount.findFirst({
          where: { id: nickId, orgId, status: 'connected' },
          select: { id: true, displayName: true, ownerUserId: true },
        }),
        prisma.contact.findFirst({
          where: { id: cid, orgId },
          select: { id: true, fullName: true },
        }),
      ]);

      if (!sequence) {
        reply.code(404);
        return { error: 'Sequence không tồn tại hoặc đã tắt' };
      }
      if (!nick) {
        reply.code(404);
        return { error: 'Nick Zalo không tồn tại hoặc chưa kết nối' };
      }
      // FIX review-epoch (CLAIM 1): nick KHÔNG có chủ (ownerUserId null) → KHÔNG cho gắn.
      // Trước đây phiên chăm sóc chỉ tạo trong `if (nick.ownerUserId)`, nhưng job step 0
      // vẫn enqueue vô điều kiện → bám đuổi gửi mà KHÔNG có phiên (vô chủ: không pause khi
      // KH reply, không cooldown, không hiện ở /care-sessions). Chặn sớm, báo sale chọn nick khác.
      if (!nick.ownerUserId) {
        reply.code(422);
        return {
          error: 'nick_no_owner',
          detail: 'Nick Zalo này chưa được gán cho sale nào — không thể bám đuổi. Vào Quản lý nick để gán phụ trách, hoặc chọn nick khác.',
        };
      }
      if (!contact) {
        reply.code(404);
        return { error: 'Khách hàng không tồn tại' };
      }

      // 2026-06-13 (D4 + SEQ-C1): resolve UID NGAY lúc gắn. KH đang chat với nick này →
      // UID có sẵn; KH lạ (nick khác) → tìm qua SĐT + tạo Friend row. Fail → báo sale NGAY
      // (NO_PHONE/NO_ZALO/LOOKUP_CAPPED) thay vì enqueue mù.
      const { resolveManualNickForContact } = await import('../engine/nick-selector.js');
      const pick = await resolveManualNickForContact({ orgId, nickId: nick.id, contactId: cid });
      if (pick.nickId === null) {
        const msg: Record<string, string> = {
          NO_PHONE: 'Khách chưa có số điện thoại — không tìm được Zalo để bám đuổi bằng nick này.',
          NO_ZALO: 'Số điện thoại này không có Zalo / không tìm được. Chọn nick khác hoặc bỏ qua.',
          LOOKUP_CAPPED: 'Nick đã hết lượt tìm Zalo hôm nay. Thử nick khác hoặc mai.',
          NOT_CONNECTED: 'Nick Zalo chưa kết nối. Vào Quản lý nick để kết nối lại.',
        };
        reply.code(422);
        return { error: pick.reason, detail: msg[pick.reason] ?? 'Không gửi được tới khách bằng nick này.' };
      }

      // Luật 3 (chống spam): chặn gắn lại CÙNG luồng trong cooldown. Check TRƯỚC enqueue
      // (nếu enqueue trước thì cooldown vô nghĩa — job đã vào queue).
      const { checkReEnrollCooldown } = await import('../care-session/care-session-service.js');
      const seqRules = (sequence as { runtimeRules?: { reEnrollCooldownDays?: number } }).runtimeRules;
      const cooldownDays = typeof seqRules?.reEnrollCooldownDays === 'number' ? seqRules.reEnrollCooldownDays : 30;
      const cool = await checkReEnrollCooldown({ orgId, contactId: cid, sequenceId: sequence.id, cooldownDays });
      if (cool.blocked) {
        // Thông báo rõ (anh chốt 2026-06-15): tên luồng + ngày gắn + ngày hoàn thành
        // (hoặc "đang chạy" nếu phiên chưa đóng) + đếm ngược số ngày còn lại.
        const fmt = (d?: Date | null) => (d ? d.toLocaleDateString('vi-VN') : null);
        const startStr = fmt(cool.lastOpenedAt) ?? '—';
        const doneStr = cool.lastClosedAt ? fmt(cool.lastClosedAt) : 'đang chạy (chưa đóng phiên)';
        reply.code(409);
        return {
          error: 'reenroll_cooldown',
          detail:
            `Khách hàng này đã được bám đuổi luồng "${sequence.name}" vào ngày ${startStr}, ` +
            `hoàn thành ${doneStr}. ` +
            `Nếu muốn gắn lại luồng này cho khách, còn ${cool.daysLeft} ngày ` +
            `(được gắn lại từ ${fmt(cool.unlockAt) ?? '—'}).`,
          // Dữ liệu thô để FE tự render badge/đếm ngược nếu muốn.
          meta: {
            sequenceName: sequence.name,
            startedAt: cool.lastOpenedAt?.toISOString() ?? null,
            completedAt: cool.lastClosedAt?.toISOString() ?? null,
            unlockAt: cool.unlockAt?.toISOString() ?? null,
            daysLeft: cool.daysLeft ?? 0,
            cooldownDays: cool.cooldownDays ?? cooldownDays,
          },
        };
      }

      // 2026-06-15 (anh chốt A): GẮN LẠI cùng luồng cho KH đã chạy → epoch MỚI để jobId
      // không đụng job cũ đã completed (BullMQ dedup không nuốt). epoch = (số phiên cũ của
      // contact+sequence) + 1. Đồng thời ĐÓNG phiên cũ active (nếu có) → tạo phiên mới sạch,
      // tránh "reuse existing session" giữ epoch cũ.
      // FIX review-epoch (CLAIM 2): epoch = MAX(enrollEpoch cũ) + 1 (helper dùng chung với
      // auto-path materializer). KHÔNG dùng count+1 vì count không monotonic — xem
      // resolveNextEnrollEpoch. Phiên fail giữa chừng vẫn không tái dùng epoch cũ.
      const { resolveNextEnrollEpoch } = await import('../care-session/care-session-service.js');
      const enrollEpoch = await resolveNextEnrollEpoch(orgId, cid, sequence.id);
      if (enrollEpoch > 1) {
        // Đóng phiên cũ active + (FIX review-epoch #2 — LỖI 2) CLEAR pausedAtStepIdx của MỌI
        // phiên cũ (kể cả đã closed janitor_silence) → resume cron KHÔNG hồi sinh chain epoch cũ.
        await prisma.careSession.updateMany({
          where: { orgId, contactId: cid, sourceSequenceId: sequence.id, state: 'active' },
          data: { state: 'closed', closedReason: 'reenrolled', closedAt: new Date(), pausedAtStepIdx: null },
        }).catch((e) => logger.warn(`[manual-enroll] đóng phiên cũ lỗi: ${(e as Error).message}`));
        await prisma.careSession.updateMany({
          where: { orgId, contactId: cid, sourceSequenceId: sequence.id, pausedAtStepIdx: { not: null } },
          data: { pausedAtStepIdx: null }, // clear marker phiên cũ đã đóng → resume bỏ qua
        }).catch((e) => logger.warn(`[manual-enroll] clear pausedAtStepIdx cũ lỗi: ${(e as Error).message}`));
        // FIX review #2 (HIGH): DỌN job epoch cũ còn trong queue. Không dọn → job mồ côi tới
        // hạn vẫn gửi (worker không check phiên đã đóng) → tin ma song song chain mới.
        try {
          const { sequenceStepContactPrefix } = await import('./queue-registry.js');
          const newPrefix = `${sequenceStepContactPrefix(systemTrigger.id, sequence.id, cid)}e${enrollEpoch}-`;
          const oldPrefix = sequenceStepContactPrefix(systemTrigger.id, sequence.id, cid); // mọi epoch
          const queue = getSequenceStepQueue();
          const pend = await queue.getJobs(['delayed', 'waiting', 'active'], 0, 5000);
          for (const job of pend) {
            if (!job.id || !job.id.startsWith(oldPrefix) || job.id.startsWith(newPrefix)) continue;
            await job.remove().catch(() => null); // chỉ xóa job epoch CŨ, giữ epoch mới
          }
        } catch (e) {
          logger.warn(`[manual-enroll] dọn job epoch cũ lỗi: ${(e as Error).message}`);
        }
      }

      // FIX live 2026-06-15 (anh test Thành Phạm): gắn tay PHẢI xoá Redis pause flag
      // (contact:paused:{systemTrigger}:{contact}) — LUÔN, mọi epoch. KH reply trước đó →
      // luật 4 đặt flag TTL tới 7 ngày. Trước đây chỉ clear pausedAtStepIdx ở DB, KHÔNG xoá
      // flag Redis → job step 0 lần gắn mới vừa enqueue bị worker defer tới ~22h (paused).
      // Sale CHỦ ĐỘNG gắn = tín hiệu "gửi ngay" → xoá flag để luồng chạy liền. Đặt NGOÀI khối
      // epoch>1 để cả lần gắn đầu (epoch=1) sau khi KH reply cũng không bị flag cũ chặn.
      try {
        const { clearContactPauseFlag } = await import('./event-hooks.js');
        await clearContactPauseFlag(systemTrigger.id, cid);
      } catch (e) {
        logger.warn(`[manual-enroll] clear pause flag Redis lỗi: ${(e as Error).message}`);
      }

      // FIX review-epoch #6 (LỖI 6 — thứ tự): TẠO PHIÊN TRƯỚC, ENQUEUE SAU.
      // Job step 0 dưới đây có startDelayMinutes:0 → worker nhặt + chạy NGAY. Nếu enqueue
      // trước khi phiên epoch mới tồn tại, worker chạy lúc phiên active vẫn là phiên cũ
      // chưa đóng kịp / chưa có phiên mới → các guard dựa trên CareSession (epoch, pause,
      // cooldown) đọc sai trạng thái. Đảo thứ tự: phiên epoch mới commit xong mới enqueue.
      // (enrollFromTrigger TỰ snapshot rulesSnapshot + double-check cooldown — Codex #10.)
      // nick.ownerUserId đã chắc chắn không null (chặn ở trên — CLAIM 1).
      let sessionCreated = false;
      try {
        const { enrollFromTrigger } = await import('../care-session/care-session-service.js');
        const sessionId = await enrollFromTrigger({
          orgId,
          triggerId: systemTrigger.id,
          contactId: cid,
          nickId: nick.id,
          ownerUserId: nick.ownerUserId,
          sequenceId: sequence.id,
          skipEnqueue: true, // step 0 enqueue NGAY dưới đây (sau khi phiên đã commit)
          enrolledByUserId: userId, // sale gắn tay
          enrollEpoch,
        });
        sessionCreated = !!sessionId; // null = cooldown chặn (double-check) → KHÔNG enqueue mù
      } catch (err) {
        logger.warn(`[manual-enroll] care-session enroll failed contact=${cid}: ${(err as Error).message}`);
      }

      // FIX review-epoch (CLAIM 1+2): CHỈ enqueue khi phiên epoch mới đã commit. enrollFromTrigger
      // trả null = cooldown double-check chặn → nếu vẫn enqueue thì job gửi mà cooldown bị bỏ qua
      // + không có phiên theo dõi. Phiên fail/null → báo sale, KHÔNG gửi.
      if (!sessionCreated) {
        reply.code(409);
        return {
          error: 'enroll_failed',
          detail: 'Không tạo được phiên bám đuổi (có thể vừa qua kiểm tra chống làm phiền). Thử lại sau giây lát.',
        };
      }

      // Qua cooldown + phiên epoch mới đã commit → enqueue step 0 (epoch mới). Manual = gửi ngay.
      await enqueueSequenceStart({
        triggerId: systemTrigger.id,
        contactId: cid,
        sequenceId: sequence.id,
        nickId: nick.id,
        orgId,
        startDelayMinutes: 0, // Manual = gửi ngay
        enrollEpoch,
      });

      // Log enrollment event
      await prisma.automationEventLog.create({
        data: {
          orgId,
          triggerId: systemTrigger.id,
          contactId: cid,
          nickId: nick.id,
          eventType: 'manual_enroll',
          detail: `by ${userId} sequence=${sequence.name} reason=${reason}`,
        },
      });

      logger.info(
        `[manual-enroll] user=${userId} contact=${contact.fullName} sequence=${sequence.name} nick=${nick.displayName}`,
      );

      return {
        ok: true,
        systemTriggerId: systemTrigger.id,
        sequenceId: sequence.id,
        nickId: nick.id,
        contactId: cid,
        contactName: contact.fullName,
      };
    },
  );

  // ── GET automation-status (1 KH đang trong N luồng nào) ──
  app.get<{
    Params: { cid: string };
  }>(
    '/api/v1/contacts/:cid/automation-status',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { cid } = request.params;
      const orgId = request.user!.orgId;
      const now = Date.now();

      // ── 1) Event log 30 ngày → gom theo trigger (latestEvent + step N/M) ──
      const since = new Date(now - 30 * 86400_000);
      const events = await prisma.automationEventLog.findMany({
        where: { contactId: cid, orgId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { triggerId: true, eventType: true, detail: true, createdAt: true },
      });

      const byTrigger = new Map<string, {
        triggerId: string;
        latestEvent: string;
        latestAt: Date;
        currentStep: number | null;
        totalSteps: number | null;
        hasSentEvent: boolean;  // đã có ít nhất 1 lần gửi bước
        enrolledById: string | null;  // sale enroll thủ công (từ event manual_enroll)
        enrollReason: string | null;
      }>();

      for (const evt of events) {
        if (!evt.triggerId) continue;
        let ref = byTrigger.get(evt.triggerId);
        if (!ref) {
          ref = {
            triggerId: evt.triggerId,
            latestEvent: evt.eventType,
            latestAt: evt.createdAt,
            currentStep: null,
            totalSteps: null,
            hasSentEvent: false,
            enrolledById: null,
            enrollReason: null,
          };
          byTrigger.set(evt.triggerId, ref);
        }
        if (evt.eventType === 'sequence_step_sent') ref.hasSentEvent = true;
        // Manual enroll: detail = "by {userId} sequence={name} reason={text}".
        if (evt.eventType === 'manual_enroll' && ref.enrolledById === null) {
          const m = evt.detail?.match(/^by (\S+) sequence=.* reason=(.*)$/s);
          if (m) { ref.enrolledById = m[1]; ref.enrollReason = m[2]?.trim() || null; }
        }
        // step "N/M" — lấy lần mới nhất (events đã desc → set lần đầu gặp).
        const stepMatch = evt.detail?.match(/step (\d+)\/(\d+)/);
        if (stepMatch && ref.currentStep === null) {
          ref.currentStep = parseInt(stepMatch[1], 10);
          ref.totalSteps = parseInt(stepMatch[2], 10);
        }
      }

      const triggerIds = [...byTrigger.keys()];
      if (triggerIds.length === 0) return { contactId: cid, triggers: [] };

      // ── 2) Lọc trigger CÒN TỒN TẠI + ĐANG BẬT trong org (bỏ trigger đã xoá/tắt) ──
      // (Anh chốt 2026-06-07: KH từng dính trigger đã xoá/đã tắt KHÔNG hiện card nữa.)
      // Include Sequence binding — UI gom card theo Sequence (phase 2 mới là cái
      // chính KH đang đi qua), Trigger chỉ là "vào qua mục tiêu nào" (Anh 2026-06-07).
      const liveTriggers = await prisma.automationTrigger.findMany({
        where: { id: { in: triggerIds }, orgId, enabled: true },
        select: {
          id: true, name: true, isSystemTrigger: true, systemKind: true,
          sequenceId: true,
          sequence: { select: { id: true, name: true } },
        },
      });
      const triggerMeta = new Map(liveTriggers.map((t) => [t.id, t]));

      // Batch load tên sale đã enroll thủ công (cho cờ "Sale gắn tay" trên card).
      const enrollerIds = [...new Set(
        [...byTrigger.values()].map((s) => s.enrolledById).filter((x): x is string => !!x),
      )];
      const enrollerNames = new Map<string, string>();
      if (enrollerIds.length) {
        const users = await prisma.user.findMany({
          where: { id: { in: enrollerIds } },
          select: { id: true, fullName: true },
        });
        for (const u of users) enrollerNames.set(u.id, u.fullName);
      }

      // ── 3) Trạng thái THẬT từ BullMQ: còn job pending = đang chạy. jobId mới có
      //       sequenceId → scan per-trigger (1 contact), gom vào map theo triggerId. ──
      const pendingByTrigger = new Map<string, { stepIdx: number; nextRunAt: Date; sequenceId: string }>();
      for (const tid of triggerIds) {
        const m = await scanPendingSequenceJobs(tid, [cid]);
        const hit = m.get(cid);
        if (hit) pendingByTrigger.set(tid, hit);
      }

      // ── 4) Derive state per trigger + build cards (chỉ trigger còn sống) ──
      const result = await Promise.all(
        [...byTrigger.values()]
          .filter((s) => triggerMeta.has(s.triggerId))
          .map(async (s) => {
            const meta = triggerMeta.get(s.triggerId)!;
            const pending = pendingByTrigger.get(s.triggerId);
            const pauseMs = await getContactPauseRemaining(s.triggerId, cid);
            const isStopped = s.latestEvent === 'manual_stop' || s.latestEvent === 'customer_block';

            let currentStep = s.currentStep;
            const totalSteps = s.totalSteps;
            let nextRunAt: Date | null = null;
            if (pending) {
              currentStep = pending.stepIdx + 1; // stepIdx 0-based → bước đang chờ gửi
              nextRunAt = pending.nextRunAt;
            } else if (!isStopped && pauseMs <= 0 && totalSteps) {
              currentStep = totalSteps; // hết job + không dừng/pause → đi hết chuỗi
            }

            // YC3 (Đợt 2): timing 4 mốc per luồng (giờ/nextRunAt/lý do hold/etaCompleteAt).
            const { getSequenceTimingForContact } = await import('../engine/sequence-eta-service.js');
            const timing = await getSequenceTimingForContact({ orgId, triggerId: s.triggerId, contactId: cid })
              .catch(() => [] as Awaited<ReturnType<typeof getSequenceTimingForContact>>);
            const t0 = timing[0]; // 1 trigger ở đây thường 1 luồng; đa-luồng FE đọc mảng `timing`

            return {
              triggerId: s.triggerId,
              triggerName: meta.name ?? '',
              isSystemTrigger: meta.isSystemTrigger ?? false,
              systemKind: meta.systemKind,
              // Sequence binding (FE gom card theo cái này; null nếu trigger gắn block/broadcast)
              sequenceId: meta.sequenceId ?? null,
              sequenceName: meta.sequence?.name ?? null,
              latestEvent: s.latestEvent,
              latestAt: s.latestAt,
              currentStep,
              totalSteps,
              nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
              pausedUntilMs: pending ? 0 : pauseMs, // có job thì coi như đang chạy, bỏ pause
              pausedUntil: !pending && pauseMs > 0 ? new Date(now + pauseMs).toISOString() : null,
              stopped: isStopped,
              // YC3 timing — bao lâu nữa xong + lý do hold + khung giờ (per luồng đầu tiên).
              etaCompleteAt: t0?.etaCompleteAt ?? null,
              holdReason: t0?.holdReason ?? null,
              allowedHourRange: t0?.allowedHourRange ?? null,
              timing, // mảng đầy đủ per-luồng (đa-luồng) cho FE render nhiều badge
              // Cờ "Sale gắn tay" — KH vào luồng bằng enroll thủ công từ chat.
              isManual: meta.systemKind === 'manual_chat_followup' || !!s.enrolledById,
              enrolledByName: s.enrolledById ? (enrollerNames.get(s.enrolledById) ?? null) : null,
              enrollReason: s.enrollReason,
            };
          }),
      );

      // ── 5) "NỞ" card manual followup: 1 card/trigger (gom-đè epoch mới nhất) → mỗi LẦN
      //       GẮN 1 card riêng (anh chốt 2026-06-15: panel chat ẩn mất luồng đã chạy xong).
      //       Dùng buildManualFollowupContacts (per-enrollment, đã test trang Theo dõi) lọc
      //       theo contact này. Card tự động (sequence/block thường) GIỮ NGUYÊN.
      const hasManualCard = result.some((c) => c.systemKind === 'manual_chat_followup');
      if (hasManualCard) {
        const manualTrigger = liveTriggers.find((t) => t.systemKind === 'manual_chat_followup');
        const nonManual = result.filter((c) => c.systemKind !== 'manual_chat_followup');
        let manualRuns: typeof result = [];
        if (manualTrigger) {
          try {
            const allRuns = await buildManualFollowupContacts(orgId, manualTrigger.id);
            const myRuns = allRuns.filter((r) => r.contactId === cid);
            // Run chỉ có sequenceNAME (parse từ event detail) → tra sequenceId cho nút advance.
            const runNames = [...new Set(myRuns.map((r) => r.sequenceName).filter((x): x is string => !!x))];
            const seqIdByName = new Map<string, string>();
            if (runNames.length) {
              const seqs = await prisma.automationSequence.findMany({
                where: { orgId, name: { in: runNames } },
                select: { id: true, name: true },
              });
              for (const sq of seqs) seqIdByName.set(sq.name, sq.id);
            }
            // 2026-06-15 (anh báo): card đang HOLD do KH reply phải biết để hiện rõ "Chờ KH
            // trả lời · gửi tiếp [giờ]". Lấy phiên active đang pause (pausedAtStepIdx) của
            // contact này + pausedUntil → map theo sequenceId. 1 query cho 1 contact (rẻ).
            const pausedSessions = await prisma.careSession.findMany({
              where: { orgId, contactId: cid, state: 'active', pausedAtStepIdx: { not: null } },
              select: { sourceSequenceId: true, pausedUntil: true, enrollEpoch: true },
            });
            // Map theo sequenceId → pausedUntil. Lọc card nào áp hold đã có runOpen (chỉ run
            // ĐANG CHẠY, không phải lần đã xong 10/10) — xem isHoldByReply bên dưới.
            const pausedBySeq = new Map<string, Date | null>();
            for (const ps of pausedSessions) {
              if (ps.sourceSequenceId) pausedBySeq.set(ps.sourceSequenceId, ps.pausedUntil);
            }
            void pausedSessions;
            manualRuns = myRuns
              .map((r) => {
                const seqId = r.sequenceName ? (seqIdByName.get(r.sequenceName) ?? null) : null;
                // FIX 2026-06-15 (anh báo: card 10/10 đã XONG bị kéo lên "Tạm dừng"): CHỈ run
                // ĐANG CHẠY (chưa completed/stopped) mới được đánh hold. pausedBySeq key theo
                // sequenceId (không epoch) → nếu không lọc state, MỌI lần gắn cùng luồng (kể cả
                // lần đã xong 10/10) đều bị hold oan. Run đã xong giữ nguyên 'completed'.
                const runOpen = r.state !== 'completed' && r.state !== 'stopped';
                const isHoldByReply = runOpen && seqId != null && pausedBySeq.has(seqId);
                const holdUntil = isHoldByReply ? (pausedBySeq.get(seqId!) ?? null) : null;
                return {
                // Khóa duy nhất per-run cho FE :key (1 trigger đẻ nhiều run).
                enrollmentId: r.enrollmentId,
                enrollSeq: r.enrollSeq,
                triggerId: manualTrigger.id,
                triggerName: r.sequenceName ?? manualTrigger.name ?? 'Bám đuổi thủ công',
                isSystemTrigger: true,
                systemKind: 'manual_chat_followup' as string | null,
                // sequenceId THẬT: nút "Gửi bước tiếp ngay" (advance) cần nó (BE advance bắt
                // buộc sequenceId). FE group dùng enrollmentId nên KHÔNG gom các run lại.
                sequenceId: seqId,
                sequenceName: r.sequenceName,
                // BE đã biết chính xác state per-run (active/completed/stopped) → truyền thẳng
                // để FE KHÔNG tự derive sai (run cũ progressUnknown totalSteps=null sẽ bị
                // deriveState nhầm thành 'active'). FE ưu tiên derivedState nếu có.
                // Đang hold do KH reply → state 'paused' (FE hiện "Chờ KH trả lời").
                derivedState: isHoldByReply ? 'paused' : r.state,
                latestEvent: r.state === 'stopped' ? 'manual_stop' : 'manual_enroll',
                latestAt: new Date(r.lastSentAt ?? r.enrolledAt),
                currentStep: r.currentStep,
                totalSteps: r.totalSteps,
                // Khi hold do reply: nextRunAt = giờ gửi tiếp SAU HOLD (= pausedUntil).
                nextRunAt: isHoldByReply && holdUntil ? holdUntil.toISOString() : r.nextRunAt,
                pausedUntilMs: isHoldByReply && holdUntil ? Math.max(0, holdUntil.getTime() - Date.now()) : 0,
                pausedUntil: isHoldByReply && holdUntil ? holdUntil.toISOString() : null,
                // reenrolled/completed → KHÔNG phải "dừng" (tránh nhãn "Đã dừng" gây hiểu nhầm).
                // Chỉ stopped thật (sale dừng/KH chặn) mới stopped → vào nhóm Lịch sử.
                stopped: r.state === 'stopped',
                etaCompleteAt: null,
                // holdReason: 'waiting_reply' khi KH reply hold; 'completed' khi xong; else null.
                holdReason: (isHoldByReply ? 'waiting_reply' : (r.state === 'completed' ? 'completed' : null)) as string | null,
                allowedHourRange: null,
                timing: [] as unknown[],
                isManual: true,
                enrolledByName: r.enrolledByName,
                enrollReason: r.enrollReason,
                };
              }) as unknown as typeof result;
          } catch (err) {
            logger.warn(`[automation-status] nở manual runs lỗi (giữ card gộp): ${(err as Error).message}`);
            manualRuns = result.filter((c) => c.systemKind === 'manual_chat_followup');
          }
        }
        return { contactId: cid, triggers: [...nonManual, ...manualRuns] };
      }

      return { contactId: cid, triggers: result };
    },
  );

  // ── GET manual-followup/summary (system row trong trang Mục tiêu) ──────────
  // Đếm KH gắn tay theo trạng thái cho card "Bám đuổi khách hàng thủ công".
  app.get(
    '/api/v1/automation/manual-followup/summary',
    { preHandler: authMiddleware },
    async (request) => {
      const orgId = request.user!.orgId;
      const trigger = await prisma.automationTrigger.findFirst({
        where: { orgId, isSystemTrigger: true, systemKind: 'manual_chat_followup' },
        select: { id: true, name: true },
      });
      if (!trigger) {
        return { exists: false, triggerId: null, name: 'Bám đuổi khách hàng thủ công', counts: { active: 0, completed: 0, stopped: 0, total: 0 } };
      }

      const rows = await buildManualFollowupContacts(orgId, trigger.id);
      const counts = { active: 0, completed: 0, stopped: 0, total: rows.length };
      for (const r of rows) {
        if (r.state === 'active' || r.state === 'paused') counts.active++;
        else if (r.state === 'completed') counts.completed++;
        else if (r.state === 'stopped') counts.stopped++;
      }
      return { exists: true, triggerId: trigger.id, name: trigger.name, counts };
    },
  );

  // ── GET manual-followup/contacts (danh sách KH gắn tay cho side panel) ─────
  app.get<{ Querystring: { status?: string } }>(
    '/api/v1/automation/manual-followup/contacts',
    { preHandler: authMiddleware },
    async (request) => {
      const orgId = request.user!.orgId;
      const statusFilter = request.query.status;
      const trigger = await prisma.automationTrigger.findFirst({
        where: { orgId, isSystemTrigger: true, systemKind: 'manual_chat_followup' },
        select: { id: true, name: true },
      });
      if (!trigger) return { triggerId: null, name: 'Bám đuổi khách hàng thủ công', contacts: [] };

      let rows = await buildManualFollowupContacts(orgId, trigger.id);
      if (statusFilter && statusFilter !== 'all') {
        rows = rows.filter((r) =>
          statusFilter === 'active' ? (r.state === 'active' || r.state === 'paused') : r.state === statusFilter,
        );
      }
      return { triggerId: trigger.id, name: trigger.name, contacts: rows };
    },
  );

  logger.info('[manual-control-routes] registered 7 endpoints');
}
