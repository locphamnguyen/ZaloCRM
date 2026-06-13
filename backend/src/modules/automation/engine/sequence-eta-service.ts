// ════════════════════════════════════════════════════════════════════════
// sequence-eta-service — Timing/ETA cho UI (YC3, Sequence recode Đợt 2)
// ════════════════════════════════════════════════════════════════════════
//
// Anh chốt (eng-review D2=A): hiện 4 mốc timing cho mỗi luồng KH đang chạy —
//   1. Giờ gửi      : khung allowedHourRange (luật 1).
//   2. Bước kế (nextRunAt) : khi nào bước tiếp gửi — scan BullMQ delayed, CACHE 5-10s.
//   3. Lý do hold   : vì sao đang chờ (offline/ngoài-giờ/quota/chờ-phiên-reply).
//   4. Bao lâu nữa xong (etaCompleteAt) : cộng dồn delay bước còn lại — TỪ DB, KHÔNG scan
//      (PERF#1=A: tránh scan toàn queue mỗi lần mở panel).
//
// Tái dùng schedule-calculator (etaCompleteAt) — Codex #11 (1 calculator dùng chung).

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getSequenceStepQueue, sequenceStepJobPrefix } from '../queues/queue-registry.js';
import { etaCompleteAt } from './schedule-calculator.js';
import type { SequenceRuntimeRules, SequenceStep } from '../sequences/types.js';

export type HoldReason =
  | 'running' // không hold, đang chạy bình thường
  | 'waiting_reply' // khách đã reply → tạm dừng chờ hết phiên (luật 4)
  | 'out_of_hours' // ngoài khung giờ hoạt động (luật 1)
  | 'nick_offline' // nick gửi đang offline
  | 'completed' // đã gửi xong bước cuối
  | 'stopped'; // đã dừng (sale/khách chặn/stranger-blocked)

export interface SequenceTiming {
  sequenceId: string;
  sequenceName: string | null;
  currentStepIdx: number; // bước đang chờ gửi (0-based), -1 nếu xong
  totalSteps: number;
  nextRunAt: string | null; // ISO — bước kế gửi lúc nào
  etaCompleteAt: string | null; // ISO — cả luồng xong lúc nào
  holdReason: HoldReason;
  allowedHourRange: [number, number] | null;
}

// Cache nextRunAt theo contact — TTL 8s (PERF#1: tránh scan queue mỗi lần mở panel).
// Pattern giống preview-eta-service.ts. KHÔNG dùng Date.now() trong module test-pure;
// service này chạy runtime nên Date.now OK (không phải file pure).
const _scanCache = new Map<string, { at: number; jobs: { jobId: string; stepIdx: number; nextRunAt: Date; sequenceId: string }[] }>();
const SCAN_TTL_MS = 8_000;

/**
 * Scan BullMQ delayed/waiting/active 1 lần cho 1 trigger (cache 8s). Trả job pending sớm
 * nhất per sequenceId của contact.
 */
async function scanPendingForContact(
  triggerId: string,
  contactId: string,
): Promise<Map<string, { stepIdx: number; nextRunAt: Date }>> {
  const cacheKey = `${triggerId}:${contactId}`;
  const cached = _scanCache.get(cacheKey);
  const now = Date.now();
  let jobs = cached && now - cached.at < SCAN_TTL_MS ? cached.jobs : null;

  if (!jobs) {
    jobs = [];
    try {
      const queue = getSequenceStepQueue();
      const all = await queue.getJobs(['delayed', 'waiting', 'active'], 0, 5000);
      for (const job of all) {
        if (!job.id || !job.id.startsWith(`${triggerId}-`)) continue;
        const d = job.data as { contactId?: string; sequenceId?: string; stepIdx?: number };
        if (d?.contactId !== contactId) continue;
        jobs.push({
          jobId: job.id,
          stepIdx: typeof d.stepIdx === 'number' ? d.stepIdx : 0,
          nextRunAt: new Date((job.timestamp ?? now) + (job.opts?.delay ?? 0)),
          sequenceId: d.sequenceId ?? '',
        });
      }
      _scanCache.set(cacheKey, { at: now, jobs });
    } catch (err) {
      logger.warn(`[eta] scan failed: ${(err as Error).message}`);
    }
  }

  const out = new Map<string, { stepIdx: number; nextRunAt: Date }>();
  for (const j of jobs) {
    const cur = out.get(j.sequenceId);
    if (!cur || j.nextRunAt < cur.nextRunAt) out.set(j.sequenceId, { stepIdx: j.stepIdx, nextRunAt: j.nextRunAt });
  }
  return out;
}

/**
 * Tính timing 4 mốc cho MỖI luồng KH đang/đã chạy dưới 1 trigger.
 * Nguồn: CareSession (luồng nào, pause chưa) + BullMQ (bước kế) + sequence.steps (ETA).
 */
export async function getSequenceTimingForContact(args: {
  orgId: string;
  triggerId: string;
  contactId: string;
}): Promise<SequenceTiming[]> {
  const { orgId, triggerId, contactId } = args;

  // 1. Các luồng KH dưới trigger này (CareSession — kể cả đã đóng để hiện trạng thái).
  const sessions = await prisma.careSession.findMany({
    where: { orgId, contactId, sourceTriggerId: triggerId, sourceSequenceId: { not: null } },
    orderBy: { openedAt: 'desc' },
    select: {
      sourceSequenceId: true,
      state: true,
      closedReason: true,
      pausedAtStepIdx: true,
      rulesSnapshot: true,
    },
  });
  if (sessions.length === 0) return [];

  // 2. Scan BullMQ 1 lần (cache) → bước kế per sequence.
  const pending = await scanPendingForContact(triggerId, contactId);

  // 3. Per luồng: gom 4 mốc.
  const result: SequenceTiming[] = [];
  const seen = new Set<string>();
  for (const s of sessions) {
    const sequenceId = s.sourceSequenceId!;
    if (seen.has(sequenceId)) continue; // 1 luồng 1 dòng (phiên mới nhất)
    seen.add(sequenceId);

    const seq = await prisma.automationSequence.findUnique({
      where: { id: sequenceId },
      select: { name: true, steps: true, runtimeRules: true },
    });
    const steps = (Array.isArray(seq?.steps) ? seq!.steps : []) as unknown as SequenceStep[];
    // Rules: ưu tiên snapshot lúc enroll (Codex #10), fallback live.
    const rules = ((s.rulesSnapshot as SequenceRuntimeRules) ?? (seq?.runtimeRules as SequenceRuntimeRules)) ?? {};
    const range = rules.allowedHourRange ?? null;

    const p = pending.get(sequenceId);
    let holdReason: HoldReason;
    let currentStepIdx: number;
    let nextRunAt: Date | null;

    if (s.state === 'closed') {
      holdReason = s.closedReason === 'janitor_silence' ? 'completed' : 'stopped';
      currentStepIdx = -1;
      nextRunAt = null;
    } else if (s.pausedAtStepIdx != null) {
      holdReason = 'waiting_reply'; // luật 4: khách reply → chờ hết phiên
      currentStepIdx = s.pausedAtStepIdx;
      nextRunAt = null;
    } else if (p) {
      currentStepIdx = p.stepIdx;
      nextRunAt = p.nextRunAt;
      // Hold do ngoài giờ? nếu nextRunAt > now + delay thường → dời vì giờ.
      holdReason = isOutOfHours(range) ? 'out_of_hours' : 'running';
    } else {
      // Không pending job + phiên active → vừa gửi xong hoặc đang xử lý.
      holdReason = 'running';
      currentStepIdx = -1;
      nextRunAt = null;
    }

    // etaCompleteAt: cộng dồn delay bước còn lại từ DB (KHÔNG scan).
    const fromStep = currentStepIdx >= 0 ? currentStepIdx : steps.length - 1;
    const fromTime = nextRunAt ?? new Date();
    const eta = currentStepIdx >= 0 ? etaCompleteAt(steps, fromStep, fromTime, rules) : null;

    result.push({
      sequenceId,
      sequenceName: seq?.name ?? null,
      currentStepIdx,
      totalSteps: steps.length,
      nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
      etaCompleteAt: eta ? eta.toISOString() : null,
      holdReason,
      allowedHourRange: range,
    });
  }

  return result;
}

/** Giờ hiện tại (VN UTC+7) có ngoài khung allowedHourRange không. */
function isOutOfHours(range: [number, number] | null): boolean {
  if (!range) return false;
  const [start, end] = range;
  if (start >= end) return false;
  const vnHour = (new Date().getUTCHours() + 7) % 24;
  return !(vnHour >= start && vnHour < end);
}
